-- Migration 014: Track which data source last populated scores
--
-- score_source     — 'masters.com' | 'espn' | 'none'
-- score_updated_at — timestamp of the last successful score sync

ALTER TABLE pools
  ADD COLUMN IF NOT EXISTS score_source      text         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS score_updated_at  timestamptz  DEFAULT NULL;
