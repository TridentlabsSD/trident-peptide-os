# Trident Peptide OS — Deployment Guide

## Stack
- **Frontend**: Static HTML/JS in `/public` served by Vercel
- **Backend**: Vercel serverless functions in `/api`
- **Database**: Supabase (Postgres)
- **Payments**: Stripe

---

## Step 1 — Supabase setup

1. Supabase Dashboard → SQL Editor → New Query
2. Paste everything from `SUPABASE_SETUP.sql` and run
3. Go to Authentication → Providers → Email → turn **off** "Confirm email"
4. Go to Settings → API and copy:
   - Project URL (used as `SUPABASE_URL`)
   - `service_role` key (used as `SUPABASE_SERVICE_KEY`)

---

## Step 2 — Stripe setup

1. Create account at stripe.com
2. Create two recurring products (or one with two prices):
   - Monthly: `$19.99/mo`
   - Annual: `$199/yr`
3. Copy the Price IDs for each
4. Go to Developers → API Keys, copy the **Secret key** and **Publishable key**
5. Go to Developers → Webhooks → Add endpoint:
   - URL: `https://your-domain.com/api/stripe-webhook`
   - Events: `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`, `account.updated`, `charge.dispute.created`
   - Copy the Webhook signing secret

---

## Step 3 — Deploy to Vercel

### Via GitHub (recommended)
1. Push this repo to GitHub
2. vercel.com → New Project → Import your repo
3. Click **Deploy** — Vercel detects the config automatically

### Via CLI
```bash
npm install -g vercel
vercel
```

---

## Step 4 — Set Vercel environment variables

In Vercel → Project → Settings → Environment Variables, add ALL of these:

| Variable                  | Value                                  | Notes                          |
|---------------------------|----------------------------------------|--------------------------------|
| `SUPABASE_URL`            | `https://xxxx.supabase.co`            | From Supabase Settings → API   |
| `SUPABASE_SERVICE_KEY`    | `eyJ...`                               | service_role key — keep secret |
| `STRIPE_SECRET_KEY`       | `sk_live_...`                          | Stripe secret key              |
| `STRIPE_PUBLISHABLE_KEY`  | `pk_live_...`                          | Served via /api/stripe-config  |
| `STRIPE_WEBHOOK_SECRET`   | `whsec_...`                            | From Stripe webhook endpoint   |
| `STRIPE_PRICE_MONTHLY`    | `price_...`                            | Monthly price ID               |
| `STRIPE_PRICE_ANNUAL`     | `price_...`                            | Annual price ID                |
| `ANTHROPIC_API_KEY`       | `sk-ant-...`                           | For /api/chat                  |
| `APP_BASE_URL`            | `https://app.usetridentlabs.com`       | Your production domain         |
| `CRON_SECRET`             | any random string (e.g. `openssl rand -hex 32`) | Protects the daily payout cron |

---

## Step 2b — Stripe Connect (affiliate auto-payouts)

1. In your Stripe dashboard → Settings → Connect → enable **Express accounts**
2. Under Connect settings → Branding — add your platform name (PepTrak) and logo
3. No extra env vars needed — uses the same `STRIPE_SECRET_KEY`

Affiliates click "Set Up Payouts via Stripe" in their account page, go through a 2-minute Stripe onboarding (bank account + ID), and from then on every commission is transferred to their bank automatically within 2-7 days of each referral payment. You never touch it.

> **Never put secrets in source code.** All keys live only in Vercel env vars.

---

## Step 5 — Custom domain

Vercel → Project → Settings → Domains → Add `app.usetridentlabs.com`
Follow DNS instructions (usually takes 5-10 min).

---

## File structure

```
/
├── public/              Static HTML pages (served by Vercel)
│   ├── index.html       Landing page
│   ├── signin.html      Sign in
│   ├── onboarding.html  Onboarding wizard
│   ├── questionnaire.html
│   ├── checkout.html    Stripe checkout
│   ├── protocol.html    AI protocol reveal
│   ├── chat.html        Alex AI advisor
│   ├── tracker.html     Daily tracker
│   ├── library.html     Compound library
│   ├── stack.html       My stack
│   ├── account.html     Account & billing
│   └── tools.html       Calculator etc.
├── api/                 Vercel serverless functions
│   ├── chat.js          Anthropic proxy
│   ├── stripe-config.js Return Stripe publishable key
│   ├── create-subscription.js
│   ├── subscription-status.js
│   ├── billing-portal.js
│   ├── lookup-customer.js
│   ├── stripe-webhook.js
│   ├── supabase-upsert-user.js
│   ├── supabase-get-user.js
│   ├── supabase-save-data.js
│   ├── supabase-load-data.js
│   └── supabase-update-status.js
├── SUPABASE_SETUP.sql   Run once in Supabase SQL editor
├── vercel.json          Vercel routing config
└── package.json
```

---

## What syncs to Supabase

| Data                | Table                | When              |
|---------------------|----------------------|-------------------|
| Subscription status | user_subscriptions   | On checkout + webhook |
| Protocol / intake   | user_profiles.intake | Periodically      |
| Chat memory         | user_profiles.alex_memory | On message   |
| Tracker data        | user_profiles.tracker | Daily            |
| Cycle history       | user_profiles.cycle_history | On cycle end |
