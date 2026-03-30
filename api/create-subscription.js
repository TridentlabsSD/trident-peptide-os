const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const { paymentMethodId, email, name, plan, refCode } = req.body;

  if (!paymentMethodId || !email)
    return res.status(400).json({ error: 'Missing required fields' });

  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId)
    return res.status(500).json({ error: 'Price not configured. Contact support@peptrak.com' });

  try {
    // Find or create customer
    const existing = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existing.data.length > 0) {
      customer = existing.data[0];
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    } else {
      customer = await stripe.customers.create({
        email,
        name,
        payment_method: paymentMethodId,
        metadata: {
          source: 'peptrak_app',
          ref_code: refCode || '',   // store affiliate ref on customer
        },
      });
    }

    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: 21,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      metadata: {
        plan,
        source: 'peptrak_app',
        ref_code: refCode || '',    // store on subscription for webhook
      },
    });

    return res.status(200).json({
      customerId: customer.id,
      subscriptionId: subscription.id,
      status: subscription.status,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(400).json({ error: err.message });
  }
};
