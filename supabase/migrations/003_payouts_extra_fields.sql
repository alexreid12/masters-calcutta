-- Migration 003: Add missing columns to payouts table
-- These fields are computed by the payout engine but were not being persisted.

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS award_score     INTEGER,
  ADD COLUMN IF NOT EXISTS award_round     INTEGER,
  ADD COLUMN IF NOT EXISTS award_label     TEXT,
  ADD COLUMN IF NOT EXISTS applied_percentage NUMERIC(8, 4);
