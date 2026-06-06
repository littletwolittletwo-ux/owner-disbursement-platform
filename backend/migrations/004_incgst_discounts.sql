-- Migration 004: incGST management fees, waiver/boost discounts, remove software fee
-- Fixes: real report uses incGST rates (no separate GST line), supports per-listing waivers/boosts

-- 1. Per-listing management fee discount columns
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS mgmt_fee_waiver_pct NUMERIC(5,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mgmt_fee_boost NUMERIC(10,2) DEFAULT 0;

-- 2. Software fee default to 0 (not charged in real disbursements)
ALTER TABLE listings ALTER COLUMN monthly_software_fee SET DEFAULT 0;

-- 3. Discount tracking on disbursements
ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS mgmt_fee_discount NUMERIC(10,2) DEFAULT 0;

-- 4. Convert existing au_management commission rules from excGST to incGST
--    e.g., 0.18 (18% excGST) → 0.198 (19.8% incGST)
--    This is a one-way migration: code will now apply rate directly without adding GST
UPDATE commission_rules SET rate = ROUND(rate * 1.1, 4) WHERE type = 'au_management';
