-- Migration 003: Property Deals — per-listing management fee, pro-rating audit, deduplication
-- Supports disbursement spec: §4 pro-rating, §6 cleaning fee resolution, §7 deduplication

-- 1. Per-listing management fee override: NULL = use commission_rules or default 18%
ALTER TABLE listings ADD COLUMN IF NOT EXISTS management_fee_pct NUMERIC(5,4);

-- 2. Pro-rating audit columns on line items
ALTER TABLE disbursement_line_items
  ADD COLUMN IF NOT EXISTS period_nights INTEGER,
  ADD COLUMN IF NOT EXISTS total_nights INTEGER,
  ADD COLUMN IF NOT EXISTS prorate_share NUMERIC(8,6);

-- 3. Deduplication index on reservations (composite key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_dedup
  ON reservations (listing_id, check_in, check_out, guest_name)
  WHERE listing_id IS NOT NULL AND guest_name IS NOT NULL;
