// /api/check-access.js
// Called by every gated page on load.
// Returns {access: true/false, status, redirect}
// Uses Supabase as source of truth (updated by webhook in real-time).
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function supabaseFetch(path) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_URL) return reject(new Error('SUPABASE_URL not set'));
    const url = new URL(SUPABASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '[]') }); }
        catch (e) { resolve({ status: res.statusCode, data: [] }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Short cache — 60s is fine, webhook updates Supabase within seconds of payment event
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return res.status(500).json({ access: true, status: 'unknown' }); // fail open — don't lock out on misconfiguration

  const email = req.query.email;
  if (!email) return res.status(400).json({ access: false, status: 'unauthenticated', redirect: '/signin' });

  // Test account always passes
  if (email.toLowerCase().trim() === 'test@peptrak.com')
    return res.status(200).json({ access: true, status: 'trialing' });

  try {
    const encoded = encodeURIComponent(email.toLowerCase().trim());
    const result = await supabaseFetch(`/rest/v1/user_subscriptions?email=eq.${encoded}&limit=1`);
    const sub = result.data[0] || null;

    if (!sub) {
      return res.status(200).json({ access: false, status: 'none', redirect: '/checkout' });
    }

    const accessStatuses = ['trialing', 'active'];
    const pastDueStatuses = ['past_due', 'unpaid'];
    const cancelledStatuses = ['cancelled', 'canceled'];

    if (accessStatuses.includes(sub.status)) {
      return res.status(200).json({ access: true, status: sub.status });
    }

    if (pastDueStatuses.includes(sub.status)) {
      return res.status(200).json({ access: false, status: 'past_due', redirect: '/rebill',
        stripeCustomerId: sub.stripe_customer_id });
    }

    if (cancelledStatuses.includes(sub.status)) {
      return res.status(200).json({ access: false, status: 'cancelled', redirect: '/checkout' });
    }

    // Unknown status — fail open (better than locking out a paying customer)
    return res.status(200).json({ access: true, status: sub.status });

  } catch (err) {
    console.error('check-access error:', err.message);
    // Fail open on errors — don't lock out users because of a DB blip
    return res.status(200).json({ access: true, status: 'unknown' });
  }
};
