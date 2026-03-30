-- ============================================================
-- Trident Peptide OS -- Full Database Schema
-- Run this entire script in Supabase SQL Editor:
-- Dashboard > SQL Editor > New Query > paste > Run
-- Safe to re-run (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ============================================================

-- ============================================================
-- TABLE: user_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL,
  status                  TEXT DEFAULT 'none',
  plan                    TEXT DEFAULT 'monthly',
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  trial_ends_at           TIMESTAMPTZ,
  period_end              TIMESTAMPTZ,
  ref_code                TEXT,
  amount                  NUMERIC DEFAULT 19.99,
  product_id              TEXT,
  bankful_order_id        TEXT,
  bankful_transaction_id  TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email)
);

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS plan                   TEXT DEFAULT 'monthly';
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS period_end             TIMESTAMPTZ;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS ref_code               TEXT;

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own subscription"   ON user_subscriptions;
DROP POLICY IF EXISTS "Users insert own subscription"  ON user_subscriptions;
DROP POLICY IF EXISTS "Users update own subscription"  ON user_subscriptions;

CREATE POLICY "Users read own subscription"
  ON user_subscriptions FOR SELECT
  USING (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "Users insert own subscription"
  ON user_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "Users update own subscription"
  ON user_subscriptions FOR UPDATE
  USING (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS user_subscriptions_email_idx       ON user_subscriptions (email);
CREATE INDEX IF NOT EXISTS user_subscriptions_user_id_idx     ON user_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS user_subscriptions_stripe_cust_idx ON user_subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS user_subscriptions_status_idx      ON user_subscriptions (status);

-- ============================================================
-- TABLE: user_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  name             TEXT,
  goal             TEXT,
  intake           JSONB,
  protocol         JSONB,
  tracker          JSONB,
  advisor_context  TEXT,
  alex_memory      JSONB,
  cycle_history    JSONB,
  weekly_recaps    JSONB,
  protocol_start   BIGINT,
  body_metrics     JSONB,
  response_profile JSONB,
  aff_code         TEXT,
  auth_pw          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email)
);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email            TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS name             TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS goal             TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS intake           JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS protocol         JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS tracker          JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS advisor_context  TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS alex_memory      JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS cycle_history    JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weekly_recaps    JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS protocol_start   BIGINT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS body_metrics     JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS response_profile JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS aff_code         TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS auth_pw          TEXT;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own profile" ON user_profiles;

CREATE POLICY "Users manage own profile"
  ON user_profiles FOR ALL
  USING (auth.uid() = user_id OR auth.role() = 'service_role')
  WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS user_profiles_email_idx   ON user_profiles (email);
CREATE INDEX IF NOT EXISTS user_profiles_user_id_idx ON user_profiles (user_id);

-- ============================================================
-- TABLE: user_stacks
-- ============================================================
CREATE TABLE IF NOT EXISTS user_stacks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  peptide_ids TEXT[] DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_stacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own stack" ON user_stacks;

CREATE POLICY "Users manage own stack"
  ON user_stacks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TABLE: journal_entries
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  mood       TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own journal" ON journal_entries;

CREATE POLICY "Users manage own journal"
  ON journal_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS journal_entries_user_id_idx    ON journal_entries (user_id);
CREATE INDEX IF NOT EXISTS journal_entries_created_at_idx ON journal_entries (created_at DESC);

-- ============================================================
-- TABLE: affiliate_accounts
-- Stripe Connect accounts for affiliates
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_accounts (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ref_code            TEXT NOT NULL UNIQUE,
  email               TEXT NOT NULL,
  stripe_account_id   TEXT,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE affiliate_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages affiliate accounts" ON affiliate_accounts;
CREATE POLICY "Service role manages affiliate accounts"
  ON affiliate_accounts FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS affiliate_accounts_ref_code_idx       ON affiliate_accounts (ref_code);
CREATE INDEX IF NOT EXISTS affiliate_accounts_stripe_account_idx ON affiliate_accounts (stripe_account_id);

-- ============================================================
-- TABLE: affiliate_commissions
-- Every commission event — pending or paid
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ref_code            TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  invoice_id          TEXT,
  stripe_charge_id    TEXT,   -- for dispute matching
  stripe_customer_id  TEXT,   -- for dispute matching
  stripe_transfer_id  TEXT,
  status              TEXT DEFAULT 'pending',  -- pending | released | paid | cancelled | disputed
  release_at          TIMESTAMPTZ,             -- 30 days after commission earned
  paid_at             TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages commissions" ON affiliate_commissions;
CREATE POLICY "Service role manages commissions"
  ON affiliate_commissions FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS affiliate_commissions_ref_code_idx    ON affiliate_commissions (ref_code);
CREATE INDEX IF NOT EXISTS affiliate_commissions_status_idx      ON affiliate_commissions (status);
CREATE INDEX IF NOT EXISTS affiliate_commissions_invoice_id_idx  ON affiliate_commissions (invoice_id);
CREATE INDEX IF NOT EXISTS affiliate_commissions_charge_id_idx   ON affiliate_commissions (stripe_charge_id);
CREATE INDEX IF NOT EXISTS affiliate_commissions_release_at_idx  ON affiliate_commissions (release_at);
