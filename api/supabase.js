// /api/supabase.js
// Unified Supabase handler — routes by ?action= param
// Actions: upsert-user | get-user | load-data | save-data | update-status
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return res.status(500).json({ error: 'Supabase not configured' });

  const action = req.query.action;

  // ── GET-USER ──────────────────────────────────────────────
  if (action === 'get-user') {
    if (req.method !== 'GET') return res.status(405).end();
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
      const encoded = encodeURIComponent(email.toLowerCase().trim());
      const [subRes, profRes] = await Promise.all([
        sbFetch(`/rest/v1/user_subscriptions?email=eq.${encoded}&limit=1`),
        sbFetch(`/rest/v1/user_profiles?email=eq.${encoded}&limit=1`),
      ]);
      const sub = subRes.data[0] || null;
      const prof = profRes.data[0] || null;
      if (!sub) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({
        email: sub.email, name: prof ? prof.name : null, goal: prof ? prof.goal : null,
        stripeCustomerId: sub.stripe_customer_id, stripeSubscriptionId: sub.stripe_subscription_id,
        status: sub.status, plan: sub.plan, trialEnd: sub.trial_ends_at,
        refCode: sub.ref_code, createdAt: sub.created_at,
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── LOAD-DATA ─────────────────────────────────────────────
  if (action === 'load-data') {
    if (req.method !== 'GET') return res.status(405).end();
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
      const encoded = encodeURIComponent(email.toLowerCase().trim());
      const [profRes, subRes] = await Promise.all([
        sbFetch(`/rest/v1/user_profiles?email=eq.${encoded}&limit=1`),
        sbFetch(`/rest/v1/user_subscriptions?email=eq.${encoded}&limit=1`),
      ]);
      const prof = profRes.data[0] || null;
      const sub = subRes.data[0] || null;
      if (!sub && !prof) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({
        stripeCustomerId: sub ? sub.stripe_customer_id : null,
        stripeSubscriptionId: sub ? sub.stripe_subscription_id : null,
        status: sub ? sub.status : null, plan: sub ? sub.plan : null,
        trialEnd: sub ? sub.trial_ends_at : null, refCode: sub ? sub.ref_code : null,
        name: prof ? prof.name : null, intake: prof ? prof.intake : null,
        protocol: prof ? prof.protocol : null, tracker: prof ? prof.tracker : null,
        advisorContext: prof ? prof.advisor_context : null, alexMemory: prof ? prof.alex_memory : null,
        cycleHistory: prof ? prof.cycle_history : null, weeklyRecaps: prof ? prof.weekly_recaps : null,
        protocolStart: prof ? prof.protocol_start : null, bodyMetrics: prof ? prof.body_metrics : null,
        responseProfile: prof ? prof.response_profile : null, affCode: prof ? prof.aff_code : null,
        authPw: prof ? prof.auth_pw : null,
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── SAVE-DATA ─────────────────────────────────────────────
  if (action === 'save-data') {
    if (req.method !== 'POST') return res.status(405).end();
    const { email, intake, protocol, tracker, advisorContext, alexMemory,
            cycleHistory, weeklyRecaps, protocolStart, bodyMetrics,
            responseProfile, affCode, authPw } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
      const result = await sbFetch('/rest/v1/user_profiles', 'POST', {
        email: email.toLowerCase().trim(),
        intake: intake || null, protocol: protocol || null, tracker: tracker || null,
        advisor_context: advisorContext || null, alex_memory: alexMemory || null,
        cycle_history: cycleHistory || null, weekly_recaps: weeklyRecaps || null,
        protocol_start: protocolStart || null, body_metrics: bodyMetrics || null,
        response_profile: responseProfile || null, aff_code: affCode || null,
        auth_pw: authPw || null, updated_at: new Date().toISOString(),
      }, { 'Prefer': 'return=minimal,resolution=merge-duplicates' });
      return res.status(200).json({ success: result.status < 300 });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── UPDATE-STATUS ─────────────────────────────────────────
  if (action === 'update-status') {
    if (req.method !== 'POST') return res.status(405).end();
    const { stripeCustomerId, status, trialEnd, periodEnd } = req.body;
    if (!stripeCustomerId) return res.status(400).json({ error: 'stripeCustomerId required' });
    try {
      const result = await sbFetch(
        `/rest/v1/user_subscriptions?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}`,
        'PATCH',
        { status: status || 'active', trial_ends_at: trialEnd || null,
          period_end: periodEnd || null, updated_at: new Date().toISOString() },
        { 'Prefer': 'return=minimal' }
      );
      return res.status(200).json({ success: result.status < 300 });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── UPSERT-USER ───────────────────────────────────────────
  if (action === 'upsert-user') {
    if (req.method !== 'POST') return res.status(405).end();
    const { email, name, plan, customerId, subscriptionId, status, trialEnd, goal, refCode } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const now = new Date().toISOString();
    try {
      const prefer = { 'Prefer': 'return=representation,resolution=merge-duplicates' };
      const [subResult, profResult] = await Promise.all([
        sbFetch('/rest/v1/user_subscriptions', 'POST', {
          email: email.toLowerCase().trim(),
          stripe_customer_id: customerId || null, stripe_subscription_id: subscriptionId || null,
          status: status || 'trialing', plan: plan || 'monthly',
          trial_ends_at: trialEnd || null, ref_code: refCode || null,
          created_at: now, updated_at: now,
        }, prefer),
        sbFetch('/rest/v1/user_profiles', 'POST', {
          email: email.toLowerCase().trim(), name: name || null, goal: goal || null,
          created_at: now, updated_at: now,
        }, prefer),
      ]);
      return res.status(200).json({
        success: true,
        subscription: subResult.status < 300,
        profile: profResult.status < 300,
      });
    } catch (err) {
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=get-user|load-data|save-data|update-status|upsert-user' });
};
