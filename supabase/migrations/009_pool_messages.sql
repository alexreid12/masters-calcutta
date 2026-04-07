-- Migration 009: Pool message board (trash talk chat)

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
