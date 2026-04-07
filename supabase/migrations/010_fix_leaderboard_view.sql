-- Migration 010: Fix leaderboard view
--
-- Two bugs in the original view:
--
-- 1. DISTINCT ON (s.golfer_id) — scoped per golfer globally, not per pool.
--    If golfer X is in pools A and B, the view emits ONE row for X (whichever
--    pool sorts first), so querying `WHERE pool_id = A` could return 0 rows.
--    Fix: DISTINCT ON (s.pool_id, s.golfer_id).
--
-- 2. LEFT JOIN ownership o ON o.golfer_id = s.golfer_id — no pool filter.
--    If golfer X is owned by Alice in pool A and Bob in pool B, the JOIN
--    matches both ownership rows and the winner is undefined (Postgres picks
--    one arbitrarily). Fix: add AND o.pool_id = s.pool_id.

DROP VIEW IF EXISTS leaderboard;

CREATE VIEW leaderboard AS
  SELECT DISTINCT ON (s.pool_id, s.golfer_id)
    s.pool_id,
    s.golfer_id,
    g.name,
    g.country,
    g.status            AS golfer_status,
    s.total_to_par,
    s.thru,
    s.position,
    s.position_display,
    s.round,
    s.updated_at,
    o.user_id           AS owner_id,
    p.display_name      AS owner_name,
    o.purchase_price
  FROM scores s
  JOIN golfers g  ON g.id = s.golfer_id
  LEFT JOIN ownership o ON o.golfer_id = s.golfer_id AND o.pool_id = s.pool_id
  LEFT JOIN profiles p  ON p.id = o.user_id
  ORDER BY s.pool_id, s.golfer_id, s.round DESC;
