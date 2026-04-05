-- Migration 007: Update async_high_bids view to expose high bidder info
-- The view already bypasses RLS (runs as view owner), so this is safe to expose publicly.

DROP VIEW IF EXISTS async_high_bids;

CREATE VIEW async_high_bids AS
  SELECT DISTINCT ON (b.golfer_id)
    b.golfer_id,
    b.pool_id,
    b.amount         AS high_bid,
    b.user_id        AS high_bidder_id,
    p.display_name   AS high_bidder_name,
    b.created_at
  FROM async_bids b
  JOIN profiles p ON p.id = b.user_id
  ORDER BY b.golfer_id, b.amount DESC;
