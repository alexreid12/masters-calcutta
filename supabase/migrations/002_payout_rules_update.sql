-- ============================================================
-- Migration 002: Extended payout rules + amateur flag
-- ============================================================

-- New enum for rule type
CREATE TYPE payout_rule_type AS ENUM ('position', 'low_round', 'high_round', 'low_amateur');

-- Add columns to payout_rules (backwards compatible: existing rows default to 'position')
ALTER TABLE payout_rules
  ADD COLUMN rule_type payout_rule_type NOT NULL DEFAULT 'position',
  ADD COLUMN round_number INTEGER;  -- 1-4 for low_round rules, NULL otherwise

-- Add amateur flag to golfers
ALTER TABLE golfers
  ADD COLUMN is_amateur BOOLEAN NOT NULL DEFAULT false;

-- Add rule_type to payouts table so we can query by section
ALTER TABLE payouts
  ADD COLUMN rule_type payout_rule_type NOT NULL DEFAULT 'position';

-- ============================================================
-- Replace the default payout rules trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION create_default_payout_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payout_rules
    (pool_id, finish_position, payout_percentage, label, is_active, rule_type, round_number)
  VALUES
    -- Position payouts
    (NEW.id,  1,  40.00, '1st Place',               true, 'position',    NULL),
    (NEW.id,  2,  18.00, '2nd Place',               true, 'position',    NULL),
    (NEW.id,  3,  10.00, '3rd Place',               true, 'position',    NULL),
    (NEW.id,  4,   6.00, '4th Place',               true, 'position',    NULL),
    (NEW.id,  5,   5.50, '5th Place',               true, 'position',    NULL),
    (NEW.id,  6,   4.00, '6th Place',               true, 'position',    NULL),
    (NEW.id,  7,   3.00, '7th Place',               true, 'position',    NULL),
    (NEW.id,  8,   2.50, '8th Place',               true, 'position',    NULL),
    (NEW.id,  9,   2.00, '9th Place',               true, 'position',    NULL),
    (NEW.id, 10,   1.50, '10th Place',              true, 'position',    NULL),
    -- Special awards (negative finish_position to avoid conflict)
    (NEW.id, -1,   1.50, 'Low Round — Day 1',       true, 'low_round',   1),
    (NEW.id, -2,   1.50, 'Low Round — Day 2',       true, 'low_round',   2),
    (NEW.id, -3,   1.50, 'Low Round — Day 3',       true, 'low_round',   3),
    (NEW.id, -4,   1.50, 'Low Round — Day 4',       true, 'low_round',   4),
    (NEW.id, -5,   1.50, 'High Round (Tournament)', true, 'high_round',  NULL),
    (NEW.id, -6,   0.00, 'Low Amateur',             true, 'low_amateur', NULL);
  RETURN NEW;
END;
$$;

-- ============================================================
-- Migrate existing pools to the new rule set
-- (Only pools that still have the old 5-rule default set)
-- ============================================================
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM pools LOOP
    -- Only migrate if the pool has exactly the old 5 default rules (top-5)
    -- and none of the new special awards
    IF (
      (SELECT COUNT(*) FROM payout_rules WHERE pool_id = p.id) = 5
      AND NOT EXISTS (
        SELECT 1 FROM payout_rules WHERE pool_id = p.id AND finish_position > 5
      )
    ) THEN
      -- Delete old rules and insert new ones
      DELETE FROM payout_rules WHERE pool_id = p.id;
      INSERT INTO payout_rules
        (pool_id, finish_position, payout_percentage, label, is_active, rule_type, round_number)
      VALUES
        (p.id,  1,  40.00, '1st Place',               true, 'position',    NULL),
        (p.id,  2,  18.00, '2nd Place',               true, 'position',    NULL),
        (p.id,  3,  10.00, '3rd Place',               true, 'position',    NULL),
        (p.id,  4,   6.00, '4th Place',               true, 'position',    NULL),
        (p.id,  5,   5.50, '5th Place',               true, 'position',    NULL),
        (p.id,  6,   4.00, '6th Place',               true, 'position',    NULL),
        (p.id,  7,   3.00, '7th Place',               true, 'position',    NULL),
        (p.id,  8,   2.50, '8th Place',               true, 'position',    NULL),
        (p.id,  9,   2.00, '9th Place',               true, 'position',    NULL),
        (p.id, 10,   1.50, '10th Place',              true, 'position',    NULL),
        (p.id, -1,   1.50, 'Low Round — Day 1',       true, 'low_round',   1),
        (p.id, -2,   1.50, 'Low Round — Day 2',       true, 'low_round',   2),
        (p.id, -3,   1.50, 'Low Round — Day 3',       true, 'low_round',   3),
        (p.id, -4,   1.50, 'Low Round — Day 4',       true, 'low_round',   4),
        (p.id, -5,   1.50, 'High Round (Tournament)', true, 'high_round',  NULL),
        (p.id, -6,   0.00, 'Low Amateur',             true, 'low_amateur', NULL);
    END IF;
  END LOOP;
END;
$$;
