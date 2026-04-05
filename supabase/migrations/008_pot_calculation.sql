-- Migration 008: Dynamic pot calculation from async bids + ownership
--
-- The old trigger only summed ownership.purchase_price (sold golfers only).
-- The new function includes highest async bids for unsold golfers during
-- async_bidding and live_auction phases.

-- ── 1. Core calculation function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_pool_pot(p_pool_id UUID)
RETURNS DECIMAL(10,2) AS $$
DECLARE
  owned_total DECIMAL(10,2);
  bid_total   DECIMAL(10,2);
  v_status    pool_status;
BEGIN
  SELECT status INTO v_status FROM pools WHERE id = p_pool_id;

  -- Sum of all finalized purchase prices (sold golfers)
  SELECT COALESCE(SUM(purchase_price), 0) INTO owned_total
  FROM ownership WHERE pool_id = p_pool_id;

  -- During bidding phases, also include the highest async bid per unsold golfer
  IF v_status IN ('async_bidding', 'live_auction') THEN
    SELECT COALESCE(SUM(high_bid), 0) INTO bid_total
    FROM (
      SELECT golfer_id, MAX(amount) AS high_bid
      FROM async_bids
      WHERE pool_id = p_pool_id
        AND golfer_id NOT IN (
          SELECT golfer_id FROM ownership WHERE pool_id = p_pool_id
        )
      GROUP BY golfer_id
    ) AS unsold_bids;
  ELSE
    bid_total := 0;
  END IF;

  RETURN owned_total + bid_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Trigger function (SECURITY DEFINER so it can UPDATE pools) ─────────────

CREATE OR REPLACE FUNCTION trigger_update_pool_pot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pool_id UUID;
BEGIN
  v_pool_id := COALESCE(NEW.pool_id, OLD.pool_id);
  UPDATE pools SET total_pot = calculate_pool_pot(v_pool_id) WHERE id = v_pool_id;
  RETURN NEW;
END;
$$;

-- ── 3. Remove old ownership-only trigger ─────────────────────────────────────

DROP TRIGGER IF EXISTS on_ownership_insert ON ownership;
DROP FUNCTION IF EXISTS recalculate_total_pot();

-- ── 4. Triggers on async_bids (insert / delete cover bid placements + retractions) ──

DROP TRIGGER IF EXISTS async_bids_pot_trigger ON async_bids;
CREATE TRIGGER async_bids_pot_trigger
  AFTER INSERT OR DELETE ON async_bids
  FOR EACH ROW EXECUTE FUNCTION trigger_update_pool_pot();

-- ── 5. Trigger on ownership (insert covers live auction sales) ───────────────

DROP TRIGGER IF EXISTS ownership_pot_trigger ON ownership;
CREATE TRIGGER ownership_pot_trigger
  AFTER INSERT OR DELETE ON ownership
  FOR EACH ROW EXECUTE FUNCTION trigger_update_pool_pot();

-- ── 6. Backfill: recalculate pot for all existing pools ──────────────────────

UPDATE pools
SET total_pot = calculate_pool_pot(id);
