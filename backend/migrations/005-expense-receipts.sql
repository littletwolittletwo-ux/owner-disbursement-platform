-- Migration 005: Add receipt storage columns to owner_expenses
-- Allows attaching PDF/photo receipts to individual expenses

ALTER TABLE owner_expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE owner_expenses ADD COLUMN IF NOT EXISTS receipt_filename TEXT;
