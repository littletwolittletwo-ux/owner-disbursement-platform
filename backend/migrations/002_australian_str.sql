-- Migration 002: Australian STR Business Rules
-- LiveLuxe disbursement platform - correct channel fees, calculation order, ABA export

-- 1. Fix default platform fee rates (was 3%/15%/5%, now 16.5%/16.5%/12%/0%)
ALTER TABLE listings
  ALTER COLUMN platform_fee_rates SET DEFAULT '{"airbnb":0.165,"booking.com":0.165,"vrbo":0.12,"direct":0}';

-- Update existing listings with old defaults
UPDATE listings SET platform_fee_rates = '{"airbnb":0.165,"booking.com":0.165,"vrbo":0.12,"direct":0}'
WHERE platform_fee_rates = '{"airbnb":0.03,"booking.com":0.15,"vrbo":0.05}';

-- 2. Add monthly software fee per listing ($65.99 default)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS monthly_software_fee NUMERIC(12,2) NOT NULL DEFAULT 65.99;

-- 3. Add cleaning fee and payout tracking to reservations
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cleaning_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS channel_payout NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payout_received BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payout_received_date DATE;

-- 4. Add GST and software fee columns to disbursements
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS management_fee_base NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS management_fee_gst NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS software_fees NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS net_income NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 5. Update commission_rules CHECK constraint to support au_management type
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_type_check;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_type_check
  CHECK (type IN ('percentage_gross','percentage_net','flat_fee','tiered','au_management'));

-- 6. Create trust account config table for ABA export
CREATE TABLE IF NOT EXISTS trust_account_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bsb TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT 'LiveLuxe Trust Account',
  bank_name TEXT NOT NULL DEFAULT 'NAB',
  financial_institution_code TEXT NOT NULL DEFAULT 'NAB',
  apca_user_id TEXT NOT NULL DEFAULT '000000',
  description TEXT NOT NULL DEFAULT 'Trust Account',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Create ABA export log table
CREATE TABLE IF NOT EXISTS aba_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month TEXT NOT NULL,
  filename TEXT NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Insert default trust account config (to be updated with real details)
INSERT INTO trust_account_config (bsb, account_number, account_name, bank_name)
VALUES ('', '', 'LiveLuxe Trust Account', 'NAB')
ON CONFLICT DO NOTHING;

-- 9. Add indexes for new query patterns
CREATE INDEX IF NOT EXISTS idx_reservations_checkout ON reservations(check_out);
CREATE INDEX IF NOT EXISTS idx_reservations_payout_received ON reservations(payout_received);
