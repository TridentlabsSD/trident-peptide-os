// /api/admin.js — PepTrak Full Admin API
const https = require('https');
const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

function sbFetch(path, method='GET', body=null, extra={}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname, path: url.pathname + url.search, method,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation', ...extra,
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(opts, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b || '[]') }); }
        catch (e) { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function auth(req) {
  const s = req.headers['x-admin-secret'] || req.query.secret;
  return ADMIN_SECRET && s === ADMIN_SECRET;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query.action;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  // ── STATS ──────────────────────────────────────────────────
  if (action === 'stats') {
    try {
      const [subsRes, commsRes, profRes] = await Promise.all([
        sbFetch('/rest/v1/user_subscriptions?select=status,plan,created_at,ref_code,stripe_customer_id,stripe_subscription_id,updated_at'),
        sbFetch('/rest/v1/affiliate_commissions?select=amount_cents,status,created_at'),
        sbFetch('/rest/v1/user_profiles?select=protocol,intake,tracker,created_at,goal'),
      ]);
      const subs = subsRes.data || [];
      const comms = commsRes.data || [];
      const profs = profRes.data || [];

      const now = new Date();
      const d30 = new Date(now - 30*86400000).toISOString();
      const d7  = new Date(now - 7*86400000).toISOString();
      const d3  = new Date(now - 3*86400000).toISOString();

      const active    = subs.filter(s => s.status === 'active').length;
      const trialing  = subs.filter(s => s.status === 'trialing').length;
      const pastDue   = subs.filter(s => ['past_due','unpaid'].includes(s.status)).length;
      const cancelled = subs.filter(s => ['cancelled','canceled'].includes(s.status)).length;
      const newLast30 = subs.filter(s => s.created_at >= d30).length;
      const newLast7  = subs.filter(s => s.created_at >= d7).length;
      const annual    = subs.filter(s => s.plan === 'annual' && ['active','trialing'].includes(s.status)).length;
      const monthly   = subs.filter(s => s.plan !== 'annual' && ['active','trialing'].includes(s.status)).length;
      const withRef   = subs.filter(s => s.ref_code).length;

      // Churn: cancelled this month / active at start
      const cancelledThisMonth = subs.filter(s => ['cancelled','canceled'].includes(s.status) && s.updated_at >= d30).length;
      const churnRate = active > 0 ? ((cancelledThisMonth / (active + cancelledThisMonth)) * 100).toFixed(1) : '0.0';

      // Activation: has protocol
      const hasProtocol = profs.filter(p => p.protocol).length;
      const activationRate = subs.length > 0 ? ((hasProtocol / subs.length) * 100).toFixed(0) : '0';

      // Goal breakdown
      const goals = {};
      profs.forEach(p => { if (p.goal) goals[p.goal] = (goals[p.goal] || 0) + 1; });
      const topGoal = Object.entries(goals).sort((a,b) => b[1]-a[1])[0] || ['—', 0];

      // Trials ending soon (next 7 days)
      const pendingCommCents = comms.filter(c => c.status === 'pending').reduce((a,c) => a+(c.amount_cents||0), 0);
      const paidCommCents    = comms.filter(c => c.status === 'paid').reduce((a,c) => a+(c.amount_cents||0), 0);

      // Pull real MRR/ARR from Stripe
      let mrrCents = 0, arrCents = 0, stripeActive = 0, stripeTrialing = 0;
      try {
        const [activeSubs, trialSubs] = await Promise.all([
          stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.items.data.price'] }),
          stripe.subscriptions.list({ status: 'trialing', limit: 100 }),
        ]);
        stripeActive   = activeSubs.data.length;
        stripeTrialing = trialSubs.data.length;
        for (const sub of activeSubs.data) {
          for (const item of sub.items.data) {
            const amt = item.price?.unit_amount || 0;
            if (item.price?.recurring?.interval === 'year') {
              arrCents += amt; mrrCents += Math.round(amt / 12);
            } else {
              mrrCents += amt; arrCents += amt * 12;
            }
          }
        }
      } catch(e) {
        mrrCents = (monthly * 2499) + Math.round(annual * 1241);
        arrCents = mrrCents * 12;
      }

      // Signups by day (last 30 days)
      const signupsByDay = {};
      for (let i = 0; i < 30; i++) {
        const d = new Date(now - i*86400000);
        signupsByDay[d.toISOString().slice(0,10)] = 0;
      }
      subs.filter(s => s.created_at >= d30).forEach(s => {
        const day = s.created_at.slice(0,10);
        if (signupsByDay[day] !== undefined) signupsByDay[day]++;
      });

      return res.status(200).json({
        total: subs.length, active, trialing, pastDue, cancelled,
        newLast30, newLast7, annual, monthly, withRef,
        churnRate, activationRate, topGoal: topGoal[0],
        stripeActive, stripeTrialing,
        mrr: (mrrCents/100).toFixed(2),
        arr: (arrCents/100).toFixed(2),
        ltv: mrrCents > 0 && (active+trialing) > 0
          ? ((mrrCents/100) / (active+trialing) * 24).toFixed(0) : '0',
        pendingComm: (pendingCommCents/100).toFixed(2),
        paidComm: (paidCommCents/100).toFixed(2),
        signupsByDay,
        goals,
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── USERS ──────────────────────────────────────────────────
  if (action === 'users') {
    try {
      const limit  = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || '';
      const statusFilter = req.query.status || '';

      let query = `/rest/v1/user_subscriptions?select=email,status,plan,created_at,stripe_customer_id,stripe_subscription_id,ref_code,trial_ends_at,period_end&order=created_at.desc&limit=${limit}&offset=${offset}`;
      if (statusFilter) query += `&status=eq.${encodeURIComponent(statusFilter)}`;
      if (search) query += `&email=ilike.*${encodeURIComponent(search)}*`;

      const [usersRes] = await Promise.all([sbFetch(query)]);
      const users = usersRes.data || [];

      // Enrich with profile data
      const emails = users.map(u => u.email).filter(Boolean);
      let profiles = [];
      if (emails.length) {
        const profRes = await sbFetch(`/rest/v1/user_profiles?email=in.(${emails.map(e => `"${e}"`).join(',')})&select=email,goal,protocol,tracker,intake,name`);
        profiles = profRes.data || [];
      }
      const profMap = {};
      profiles.forEach(p => { profMap[p.email] = p; });

      const enriched = users.map(u => ({
        ...u,
        profile: profMap[u.email] || null,
      }));

      return res.status(200).json({ users: enriched, total: enriched.length });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── AT-RISK USERS ──────────────────────────────────────────
  if (action === 'at-risk') {
    try {
      const now = new Date();
      const in7 = new Date(now.getTime() + 7*86400000).toISOString();
      const in3 = new Date(now.getTime() + 3*86400000).toISOString();

      // Trials ending soon
      const trialRes = await sbFetch(`/rest/v1/user_subscriptions?status=eq.trialing&select=email,trial_ends_at,plan,created_at&order=trial_ends_at.asc&limit=50`);
      const trials = (trialRes.data || []).filter(u => u.trial_ends_at && u.trial_ends_at <= in7);

      // Past due
      const pastDueRes = await sbFetch(`/rest/v1/user_subscriptions?status=eq.past_due&select=email,updated_at,stripe_customer_id&order=updated_at.desc&limit=20`);

      // Users who signed up but never activated (no profile)
      const subsRes  = await sbFetch('/rest/v1/user_subscriptions?select=email,created_at,status&order=created_at.desc&limit=100');
      const profRes  = await sbFetch('/rest/v1/user_profiles?select=email,protocol,intake&limit=200');
      const profEmails = new Set((profRes.data || []).filter(p => p.protocol || p.intake).map(p => p.email));
      const unactivated = (subsRes.data || []).filter(u => !profEmails.has(u.email) && ['trialing','active'].includes(u.status));

      return res.status(200).json({
        trialsEndingSoon: trials,
        trialsIn3Days: trials.filter(u => u.trial_ends_at <= in3),
        pastDue: pastDueRes.data || [],
        unactivated: unactivated.slice(0, 20),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── STRIPE CUSTOMERS ──────────────────────────────────────
  if (action === 'stripe-users') {
    try {
      const [active, trialing] = await Promise.all([
        stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer','data.items.data.price'] }),
        stripe.subscriptions.list({ status: 'trialing', limit: 100, expand: ['data.customer'] }),
      ]);
      const all = [...active.data, ...trialing.data].map(sub => ({
        email: typeof sub.customer === 'object' ? sub.customer.email : sub.customer,
        customerId: typeof sub.customer === 'object' ? sub.customer.id : sub.customer,
        subscriptionId: sub.id,
        stripe_status: sub.status,
        plan: sub.items.data[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
        amount: sub.items.data[0]?.price?.unit_amount || 0,
        trial_end: sub.trial_end ? new Date(sub.trial_end*1000).toISOString() : null,
        period_end: new Date(sub.current_period_end*1000).toISOString(),
        created: new Date(sub.created*1000).toISOString(),
      }));
      return res.status(200).json({ users: all });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── USAGE ANALYTICS ───────────────────────────────────────
  if (action === 'analytics') {
    try {
      const profRes = await sbFetch('/rest/v1/user_profiles?select=goal,protocol,tracker,intake,created_at&limit=500');
      const profs = profRes.data || [];

      // Goals breakdown
      const goals = {};
      profs.forEach(p => { if(p.goal) goals[p.goal] = (goals[p.goal]||0)+1; });

      // Compound frequency across all protocols
      const compoundFreq = {};
      profs.forEach(p => {
        if (!p.protocol) return;
        const proto = typeof p.protocol === 'string' ? JSON.parse(p.protocol) : p.protocol;
        const compounds = proto.compounds || [];
        compounds.forEach(c => {
          const name = c.name || c.compound || '';
          if (name) compoundFreq[name] = (compoundFreq[name]||0)+1;
        });
      });
      const topCompounds = Object.entries(compoundFreq).sort((a,b)=>b[1]-a[1]).slice(0,10);

      // Activation funnel
      const hasIntake    = profs.filter(p => p.intake).length;
      const hasProtocol  = profs.filter(p => p.protocol).length;
      const hasTracker   = profs.filter(p => p.tracker).length;

      // Avg compounds per protocol
      let totalCompounds = 0, protocolCount = 0;
      profs.forEach(p => {
        if (!p.protocol) return;
        const proto = typeof p.protocol === 'string' ? JSON.parse(p.protocol) : p.protocol;
        const n = (proto.compounds||[]).length;
        if (n > 0) { totalCompounds += n; protocolCount++; }
      });
      const avgCompounds = protocolCount > 0 ? (totalCompounds/protocolCount).toFixed(1) : '0';

      return res.status(200).json({
        goals,
        topCompounds,
        funnel: { hasIntake, hasProtocol, hasTracker, total: profs.length },
        avgCompounds,
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── AFFILIATES ─────────────────────────────────────────────
  if (action === 'affiliates') {
    try {
      const [subsRes, commsRes, accRes] = await Promise.all([
        sbFetch('/rest/v1/user_subscriptions?select=ref_code,status,plan,created_at&not=ref_code.is.null'),
        sbFetch('/rest/v1/affiliate_commissions?select=ref_code,amount_cents,status,created_at,release_at&order=created_at.desc&limit=200'),
        sbFetch('/rest/v1/affiliate_accounts?select=ref_code,email,onboarding_complete,stripe_account_id'),
      ]);
      const subs  = subsRes.data  || [];
      const comms = commsRes.data || [];
      const accs  = accRes.data   || [];

      // Group by ref code
      const codes = {};
      subs.forEach(u => {
        const c = u.ref_code;
        if (!c) return;
        if (!codes[c]) codes[c] = { code:c, signups:0, active:0, annual:0, monthly:0 };
        codes[c].signups++;
        if (['active','trialing'].includes(u.status)) codes[c].active++;
        if (u.plan === 'annual') codes[c].annual++; else codes[c].monthly++;
      });

      // Attach commission data
      const commByCode = {};
      comms.forEach(c => {
        if (!commByCode[c.ref_code]) commByCode[c.ref_code] = { pending:0, paid:0, total:0 };
        commByCode[c.ref_code].total += c.amount_cents||0;
        if (c.status === 'pending') commByCode[c.ref_code].pending += c.amount_cents||0;
        if (c.status === 'paid')    commByCode[c.ref_code].paid    += c.amount_cents||0;
      });

      const accMap = {};
      accs.forEach(a => { accMap[a.ref_code] = a; });

      const result = Object.values(codes).map(c => ({
        ...c,
        comms: commByCode[c.code] || { pending:0, paid:0, total:0 },
        account: accMap[c.code] || null,
      })).sort((a,b) => b.signups - a.signups);

      return res.status(200).json({
        affiliates: result,
        recentComms: comms.slice(0, 20),
        totalPending: comms.filter(c=>c.status==='pending').reduce((a,c)=>a+(c.amount_cents||0),0),
        totalPaid:    comms.filter(c=>c.status==='paid').reduce((a,c)=>a+(c.amount_cents||0),0),
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── USER DETAIL ────────────────────────────────────────────
  if (action === 'user-detail') {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email required' });
    try {
      const enc = encodeURIComponent(email.toLowerCase().trim());
      const [subRes, profRes] = await Promise.all([
        sbFetch(`/rest/v1/user_subscriptions?email=eq.${enc}&limit=1`),
        sbFetch(`/rest/v1/user_profiles?email=eq.${enc}&limit=1`),
      ]);
      const sub  = (subRes.data||[])[0]  || null;
      const prof = (profRes.data||[])[0] || null;

      let stripeData = null;
      if (sub?.stripe_customer_id) {
        try {
          const stripeSubs = await stripe.subscriptions.list({
            customer: sub.stripe_customer_id, limit:1, status:'all',
            expand: ['data.default_payment_method'],
          });
          const s = stripeSubs.data[0];
          if (s) stripeData = {
            status: s.status,
            cancelAtPeriodEnd: s.cancel_at_period_end,
            currentPeriodEnd: new Date(s.current_period_end*1000).toISOString(),
            trialEnd: s.trial_end ? new Date(s.trial_end*1000).toISOString() : null,
            amount: s.items.data[0]?.price?.unit_amount || 0,
            interval: s.items.data[0]?.price?.recurring?.interval || 'month',
            cardLast4: s.default_payment_method?.card?.last4 || null,
            cardBrand: s.default_payment_method?.card?.brand || null,
          };
        } catch(e) {}
      }

      // Parse tracker stats
      let trackerStats = null;
      if (prof?.tracker) {
        try {
          const t = typeof prof.tracker === 'string' ? JSON.parse(prof.tracker) : prof.tracker;
          const logs = t.logs || [];
          const completedDays = logs.filter(l => l.complete).length;
          trackerStats = { totalDays: logs.length, completedDays, streak: t.streak || 0 };
        } catch(e) {}
      }

      // Parse protocol info
      let protocolInfo = null;
      if (prof?.protocol) {
        try {
          const p = typeof prof.protocol === 'string' ? JSON.parse(prof.protocol) : prof.protocol;
          protocolInfo = {
            headline: p.headline || '',
            duration: p.duration || '',
            compoundCount: (p.compounds||[]).length,
            compounds: (p.compounds||[]).map(c => c.name||c.compound||'').filter(Boolean),
          };
        } catch(e) {}
      }

      return res.status(200).json({
        sub, stripeData,
        prof: prof ? {
          name: prof.name, goal: prof.goal,
          hasProtocol: !!prof.protocol, hasTracker: !!prof.tracker, hasIntake: !!prof.intake,
          createdAt: prof.created_at,
        } : null,
        trackerStats, protocolInfo,
      });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── SET STATUS ─────────────────────────────────────────────
  if (action === 'set-status' && req.method === 'POST') {
    const { email, status } = req.body;
    if (!email || !status) return res.status(400).json({ error: 'email and status required' });
    if (!['active','trialing','past_due','cancelled','canceled'].includes(status))
      return res.status(400).json({ error: 'invalid status' });
    try {
      const enc = encodeURIComponent(email.toLowerCase().trim());
      const r = await sbFetch(`/rest/v1/user_subscriptions?email=eq.${enc}`, 'PATCH',
        { status, updated_at: new Date().toISOString() }, { 'Prefer':'return=minimal' });
      return res.status(200).json({ success: r.status < 300 });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── GRANT ACCESS ───────────────────────────────────────────
  if (action === 'grant-access' && req.method === 'POST') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    try {
      const enc = encodeURIComponent(email.toLowerCase().trim());
      const now = new Date().toISOString();
      const upd = await sbFetch(`/rest/v1/user_subscriptions?email=eq.${enc}`, 'PATCH',
        { status:'active', updated_at:now }, { 'Prefer':'return=representation' });
      if (!(upd.data||[]).length) {
        await sbFetch('/rest/v1/user_subscriptions', 'POST',
          { email:email.toLowerCase().trim(), status:'active', plan:'manual', created_at:now, updated_at:now },
          { 'Prefer':'return=minimal' });
      }
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── CANCEL IN STRIPE ───────────────────────────────────────
  if (action === 'cancel-stripe' && req.method === 'POST') {
    const { subscriptionId } = req.body;
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId required' });
    try {
      await stripe.subscriptions.cancel(subscriptionId);
      return res.status(200).json({ success: true });
    } catch (err) { return res.status(400).json({ error: err.message }); }
  }

  // ── RELEASE AFFILIATE COMMISSION ───────────────────────────
  if (action === 'release-commission' && req.method === 'POST') {
    const { commissionId } = req.body;
    if (!commissionId) return res.status(400).json({ error: 'commissionId required' });
    try {
      const r = await sbFetch(`/rest/v1/affiliate_commissions?id=eq.${commissionId}`, 'PATCH',
        { status:'released', release_at: new Date().toISOString() }, { 'Prefer':'return=minimal' });
      return res.status(200).json({ success: r.status < 300 });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
};
