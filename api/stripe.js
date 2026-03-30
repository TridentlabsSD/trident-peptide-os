// /api/stripe.js
// Unified Stripe handler — routes by ?action= param
// Actions: config | status | lookup | portal
const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  // ── CONFIG (publishable key) ───────────────────────────────
  if (action === 'config') {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!pk) return res.status(500).json({ error: 'Stripe not configured' });
    return res.status(200).json({ pk });
  }

  // ── STATUS (subscription status by customerId) ─────────────
  if (action === 'status') {
    res.setHeader('Cache-Control', 's-maxage=60');
    const { customerId } = req.query;
    if (!customerId || !customerId.startsWith('cus_'))
      return res.status(400).json({ error: 'Invalid customerId' });
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId, status: 'all', limit: 1,
        expand: ['data.default_payment_method'],
      });
      if (!subscriptions.data.length) return res.status(200).json({ status: 'none' });
      const sub = subscriptions.data[0];
      const now = Math.floor(Date.now() / 1000);
      const trialDaysLeft = (sub.trial_end && sub.trial_end > now)
        ? Math.ceil((sub.trial_end - now) / 86400) : null;
      const nextBillingDate = new Date(sub.current_period_end * 1000)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const interval = sub.items.data[0]?.price?.recurring?.interval || 'month';
      const plan = interval === 'year' ? 'annual' : 'monthly';
      const amount = sub.items.data[0]?.price?.unit_amount || 0;
      const amountStr = interval === 'year'
        ? `$${Math.round(amount / 100 / 12)}/mo · billed $${(amount / 100).toFixed(0)}/yr`
        : `$${(amount / 100).toFixed(2)}/mo`;
      const card = sub.default_payment_method?.card;
      return res.status(200).json({
        status: sub.status, plan, amountStr, trialDaysLeft, nextBillingDate,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cardLast4: card?.last4 || null,
        subscriptionId: sub.id,
      });
    } catch (err) { return res.status(400).json({ error: err.message }); }
  }

  // ── LOOKUP (customer by email) ─────────────────────────────
  if (action === 'lookup') {
    if (req.method !== 'GET') return res.status(405).end();
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Missing email' });
    try {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (!customers.data.length) return res.status(200).json({ found: false });
      const customer = customers.data[0];
      const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 1 });
      const sub = subs.data[0];
      return res.status(200).json({
        found: true, customerId: customer.id,
        subscriptionStatus: sub ? sub.status : 'none',
        hasActiveSubscription: sub ? ['active', 'trialing'].includes(sub.status) : false,
      });
    } catch (err) { return res.status(400).json({ error: err.message }); }
  }

  // ── PORTAL (billing portal session) ───────────────────────
  if (action === 'portal') {
    if (req.method !== 'POST') return res.status(405).end();
    const { customerId, returnUrl } = req.body;
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || 'https://www.peptrak.com/account',
      });
      return res.status(200).json({ url: session.url });
    } catch (err) { return res.status(400).json({ error: err.message }); }
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=config|status|lookup|portal' });
};
