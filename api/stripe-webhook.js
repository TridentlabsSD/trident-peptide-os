// /api/stripe-webhook.js
module.exports.config = { api: { bodyParser: false } };

const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const BASE_URL = process.env.APP_BASE_URL || 'https://app.usetridentlabs.com';

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // ── invoice.payment_succeeded ──
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      const sub = await stripe.subscriptions.retrieve(invoice.subscription);
      const refCode = sub.metadata && sub.metadata.ref_code;
      // Update Supabase subscription status
      try {
        await fetch(`${BASE_URL}/api/supabase?action=update-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stripeCustomerId: invoice.customer,
            status: 'active',
            periodEnd: invoice.period_end
              ? new Date(invoice.period_end * 1000).toISOString()
              : null,
          }),
        });
      } catch (e) {
        console.error('Supabase status sync failed:', e.message);
      }

      // ── Affiliate commission ──
      // Monthly plan: 50% of every recurring payment (subscription_cycle), forever.
      // Annual plan:  50% of the first real payment only (subscription_create).
      //               Annual renewals (subsequent subscription_cycle on annual) get nothing.
      if (refCode && invoice.amount_paid > 0) {
        const interval = sub.items.data[0]?.price?.recurring?.interval || 'month';
        const isAnnual = interval === 'year';
        const reason = invoice.billing_reason;

        // Determine whether this invoice earns a commission
        let earnCommission = false;
        if (isAnnual) {
          // Annual: only the first post-trial payment (subscription_create fires after trial ends)
          earnCommission = reason === 'subscription_create';
        } else {
          // Monthly: every real payment after trial
          earnCommission = reason === 'subscription_cycle' || reason === 'subscription_update';
        }

        if (earnCommission) {
          const amount = invoice.amount_paid;
          const commission = Math.round(amount * 0.50); // 50%

          console.log('COMMISSION EVENT:', {
            refCode,
            invoiceId: invoice.id,
            plan: isAnnual ? 'annual' : 'monthly',
            billingReason: reason,
            amountPaid: amount / 100,
            commission: commission / 100,
            customerId: invoice.customer,
          });

          // Log commission with 30-day hold (dispute protection)
          try {
            await fetch(`${BASE_URL}/api/affiliate?action=connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                refCode,
                amountCents: commission,
                invoiceId: invoice.id,
                chargeId: invoice.charge || null,
                stripeCustomerId: invoice.customer || null,
              }),
            });
          } catch (e) {
            console.error('Commission log failed:', e.message);
          }
        }
      }
    }
  }

  // ── customer.subscription.updated — catch trialing→active, past_due, etc ──
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    try {
      await fetch(`${BASE_URL}/api/supabase?action=update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripeCustomerId: sub.customer,
          status: sub.status,
          periodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        }),
      });
    } catch (e) {
      console.error('Supabase subscription.updated sync failed:', e.message);
    }
  }

  // ── customer.subscription.deleted ──
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    try {
      await fetch(`${BASE_URL}/api/supabase?action=update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripeCustomerId: sub.customer,
          status: 'cancelled',
          periodEnd: null,
        }),
      });
    } catch (e) {
      console.error('Supabase cancel sync failed:', e.message);
    }
  }

  // ── invoice.payment_failed ──
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    try {
      await fetch(`${BASE_URL}/api/supabase?action=update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripeCustomerId: invoice.customer,
          status: 'past_due',
          periodEnd: null,
        }),
      });
    } catch (e) {
      console.error('Supabase past_due sync failed:', e.message);
    }
    console.log('PAYMENT FAILED:', { invoiceId: invoice.id, customerId: invoice.customer });
  }

  // ── account.updated — Stripe Connect onboarding completed ──
  if (event.type === 'account.updated') {
    const account = event.data.object;
    // Mark affiliate account as fully onboarded when they complete Stripe's flow
    if (account.details_submitted && account.charges_enabled) {
      try {
        const https = require('https');
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
        if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
          const url = new URL(SUPABASE_URL + `/rest/v1/affiliate_accounts?stripe_account_id=eq.${account.id}`);
          const data = JSON.stringify({ onboarding_complete: true, updated_at: new Date().toISOString() });
          await new Promise((resolve, reject) => {
            const r = https.request({
              hostname: url.hostname,
              path: url.pathname + url.search,
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
                'Content-Length': Buffer.byteLength(data),
              },
            }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
            r.on('error', reject);
            r.write(data);
            r.end();
          });
          console.log('Affiliate account onboarding complete:', account.id);
        }
      } catch (e) {
        console.error('Affiliate onboarding update failed:', e.message);
      }
    }
  }

  // ── charge.dispute.created — cancel pending commission immediately ──
  // If a customer disputes a charge before the 30-day hold expires,
  // we cancel the commission before it ever pays out.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object;
    const chargeId = dispute.charge;
    const customerId = dispute.payment_intent
      ? null // will match by charge_id
      : null;

    console.log('DISPUTE RECEIVED:', {
      disputeId: dispute.id,
      chargeId,
      amount: dispute.amount / 100,
      reason: dispute.reason,
    });

    // Cancel any pending commission that matches this charge
    try {
      const https = require('https');
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const url = new URL(
          SUPABASE_URL + `/rest/v1/affiliate_commissions?stripe_charge_id=eq.${encodeURIComponent(chargeId)}&status=eq.pending`
        );
        const data = JSON.stringify({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: `dispute:${dispute.id}`,
        });
        await new Promise((resolve, reject) => {
          const r = require('https').request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
              'Content-Length': Buffer.byteLength(data),
            },
          }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
          r.on('error', reject);
          r.write(data);
          r.end();
        });
        console.log('Commission cancelled due to dispute:', chargeId);
      }
    } catch (e) {
      console.error('Failed to cancel commission on dispute:', e.message);
    }
  }

  return res.status(200).json({ received: true });
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
