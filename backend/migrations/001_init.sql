CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  banking_details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  airbnb_listing_id TEXT,
  booking_property_id TEXT,
  vrbo_id TEXT,
  hostaway_listing_id TEXT,
  cleaning_fee_baseline NUMERIC(12,2) NOT NULL DEFAULT 0,
  utility_cap NUMERIC(12,2),
  platform_fee_rates JSONB NOT NULL DEFAULT '{"airbnb":0.03,"booking.com":0.15,"vrbo":0.05}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percentage_gross','percentage_net','flat_fee','tiered')),
  rate NUMERIC(12,4) NOT NULL DEFAULT 0,
  flat_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tiers JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  guest_name TEXT,
  platform TEXT NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  booking_date DATE,
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_payout_date DATE,
  disbursement_month TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS trust_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_document TEXT,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  processor TEXT,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_reservation_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trust_transaction_id UUID REFERENCES trust_transactions(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL DEFAULT 'auto',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(trust_transaction_id, reservation_id)
);

CREATE TABLE IF NOT EXISTS owner_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  source_document TEXT,
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'miscellaneous',
  amount NUMERIC(12,2) NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cleaning_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  source_document TEXT,
  cleaning_date DATE NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS utility_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  source_document TEXT,
  utility_type TEXT NOT NULL,
  billing_period TEXT,
  utility_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disbursements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  gross_channel_payout NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_channel_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  management_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
  owner_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  cleaning_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  utilities NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_owner_payout NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, month)
);

CREATE TABLE IF NOT EXISTS disbursement_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  disbursement_id UUID REFERENCES disbursements(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  source_table TEXT,
  source_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  disbursement_id UUID REFERENCES disbursements(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (email, password_hash)
VALUES ('admin@example.com', '$2a$10$HYaQdCBpTl7L8rCWuFmZE.PB0IGJCY6BxUh2gq7WfZ2uZnl33RL2K')
ON CONFLICT (email) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_reservations_month ON reservations(disbursement_month);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_channel ON trust_transactions(channel, transaction_date);
CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_id);
