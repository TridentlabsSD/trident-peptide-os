// /api/affiliate.js
// Unified affiliate handler — routes by ?action= param
// Actions: stats | connect | release
const Stripe = require('stripe');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE_URL = process.env.APP_BASE_URL || 'https://app.usetridentlabs.com';

function sbFetch(path, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_URL) return reject(new Error('SUPABASE_URL not set'));
    const url = new URL(SUPABASE_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b || '[]') }); }
        catch (e) { resolve({ status: res.statusCode, data: [] }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  // ── STATS ─────────────────────────────────────────────────
  if (action === 'stats') {
    res.setHeader('Cache-Control', 'private, max-age=300');
    const { refCode } = req.query;
    if (!refCode) return res.status(400).json({ error: 'refCode required' });
    try {
      const encoded = encodeURIComponent(refCode.toUpperCase().trim());
      const [rowsRes, commRes] = await Promise.all([
        sbFetch(`/rest/v1/user_subscriptions?ref_code=eq.${encoded}&select=status,plan,amount,created_at`),
        sbFetch(`/rest/v1/affiliate_commissions?ref_code=eq.${encoded}&select=amount_cents,status,release_at,paid_at`),
      ]);
      const rows = rowsRes.data || [];
      const commRows = commRes.data || [];
      const referrals = rows.length;
      const active = rows.filter(r => ['active','trialing'].includes(r.status)).length;
      const monthlyEst = rows.filter(r => r.status === 'active' && r.plan !== 'annual')
        .reduce((s) => s + 12.50, 0);
      const pendingRows = commRows.filter(r => r.status === 'pending');
      const pendingCents = pendingRows.reduce((s, r) => s + (r.amount_cents || 0), 0);
      const nextRelease = pendingRows.length
        ? pendingRows.sort((a, b) => new Date(a.release_at) - new Date(b.release_at))[0].release_at
        : null;
      const availableCents = commRows.filter(r => r.status === 'released').reduce((s, r) => s + (r.amount_cents || 0), 0);
      const paidCents = commRows.filter(r => r.status === 'paid').reduce((s, r) => s + (r.amount_cents || 0), 0);
      const totalEarned = (pendingCents + availableCents + paidCents) / 100;
      return res.status(200).json({
        referrals, active,
        totalEarned: totalEarned.toFixed(2),
        totalPaid: (paidCents / 100).toFixed(2),
        pendingCents, pendingDollars: (pendingCents / 100).toFixed(2),
        availableDollars: (availableCents / 100).toFixed(2),
        unpaid: ((pendingCents + availableCents) / 100).toFixed(2),
        nextRelease, monthlyEstimate: monthlyEst.toFixed(2),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── CONNECT (onboarding link) ──────────────────────────────
  if (action === 'connect') {
    if (req.method === 'GET') {
      const { refCode, email } = req.query;
      if (!refCode || !email) return res.status(400).json({ error: 'refCode and email required' });
      try {
        const encoded = encodeURIComponent(refCode.toUpperCase().trim());
        const result = await sbFetch(`/rest/v1/affiliate_accounts?ref_code=eq.${encoded}&limit=1`);
        const existing = result.data[0] || null;
        if (existing && existing.stripe_account_id && existing.onboarding_complete) {
          const loginLink = await stripe.accounts.createLoginLink(existing.stripe_account_id);
          return res.status(200).json({ url: loginLink.url, connected: true });
        }
        let accountId = existing ? existing.stripe_account_id : null;
        if (!accountId) {
          const account = await stripe.accounts.create({
            type: 'express', email,
            capabilities: { transfers: { requested: true } },
            business_type: 'individual',
            metadata: { ref_code: refCode.toUpperCase(), source: 'peptrak_affiliate' },
          });
          accountId = account.id;
          await sbFetch('/rest/v1/affiliate_accounts', 'POST', {
            ref_code: refCode.toUpperCase().trim(), email: email.toLowerCase().trim(),
            stripe_account_id: accountId, onboarding_complete: false,
            created_at: new Date().toISOString(),
          }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
        }
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${BASE_URL}/account?connect_refresh=1`,
          return_url: `${BASE_URL}/account?connect_success=1`,
          type: 'account_onboarding',
        });
        return res.status(200).json({ url: accountLink.url, connected: false });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }

    // POST — log new commission with 30-day hold
    if (req.method === 'POST') {
      const { refCode, amountCents, invoiceId, chargeId, stripeCustomerId } = req.body;
      if (!refCode || !amountCents) return res.status(400).json({ error: 'refCode and amountCents required' });
      const now = new Date();
      const releaseAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      try {
        await sbFetch('/rest/v1/affiliate_commissions', 'POST', {
          ref_code: refCode.toUpperCase().trim(), amount_cents: amountCents,
          invoice_id: invoiceId || null, stripe_charge_id: chargeId || null,
          stripe_customer_id: stripeCustomerId || null, status: 'pending',
          release_at: releaseAt.toISOString(), created_at: now.toISOString(),
        }, { 'Prefer': 'return=minimal' });
        return res.status(200).json({ success: true, status: 'pending', releaseAt: releaseAt.toISOString() });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  }

  // ── RELEASE (cron) ────────────────────────────────────────
  if (action === 'release') {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'];
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`)
      return res.status(401).json({ error: 'Unauthorized' });

    const now = new Date().toISOString();
    const results = { transferred: 0, skipped: 0, errors: 0, total_cents: 0 };
    try {
      const commResult = await sbFetch(
        `/rest/v1/affiliate_commissions?status=eq.pending&release_at=lte.${encodeURIComponent(now)}&select=*`
      );
      const due = commResult.data || [];
      for (const commission of due) {
        try {
          const accResult = await sbFetch(
            `/rest/v1/affiliate_accounts?ref_code=eq.${encodeURIComponent(commission.ref_code)}&limit=1`
          );
          const account = accResult.data[0] || null;
          if (!account || !account.stripe_account_id || !account.onboarding_complete) {
            await sbFetch(`/rest/v1/affiliate_commissions?id=eq.${commission.id}`, 'PATCH',
              { status: 'released' }, { 'Prefer': 'return=minimal' });
            results.skipped++;
            continue;
          }
          const transfer = await stripe.transfers.create({
            amount: commission.amount_cents, currency: 'usd',
            destination: account.stripe_account_id,
            metadata: { ref_code: commission.ref_code, invoice_id: commission.invoice_id || '', commission_id: commission.id },
          });
          await sbFetch(`/rest/v1/affiliate_commissions?id=eq.${commission.id}`, 'PATCH',
            { status: 'paid', stripe_transfer_id: transfer.id, paid_at: now },
            { 'Prefer': 'return=minimal' });
          results.transferred++;
          results.total_cents += commission.amount_cents;
        } catch (err) { console.error(`Commission ${commission.id} failed:`, err.message); results.errors++; }
      }
      return res.status(200).json({ ...results, total_dollars: (results.total_cents / 100).toFixed(2), ran_at: now });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=stats|connect|release' });
};
