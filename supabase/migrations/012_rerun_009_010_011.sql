-- Migration 012: Drop and re-run migrations 009, 010, 011
-- Safe to run even if the objects already exist.

-- ── 009: pool_messages ────────────────────────────────────────────────────────

DROP TABLE IF EXISTS pool_messages CASCADE;

CREATE TABLE pool_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id    UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id),
  message    TEXT NOT NULL CHECK (char_length(message) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pool_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pool messages are viewable by everyone"
  ON pool_messages FOR SELECT USING (true);

CREATE POLICY "Authenticated users can post messages"
  ON pool_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pool_messages_pool ON pool_messages(pool_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE pool_messages;

-- ── 010: Fix leaderboard view ─────────────────────────────────────────────────

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

-- ── 011: Remove bid retraction RLS policy ─────────────────────────────────────

DROP POLICY IF EXISTS "async_bids: users delete own during async_bidding" ON async_bids;
