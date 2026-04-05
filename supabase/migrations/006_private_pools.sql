-- Migration 006: Private pools, invite codes, pool membership

-- ── Add columns to pools ──────────────────────────────────────────────────────
ALTER TABLE pools ADD COLUMN is_private    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pools ADD COLUMN join_password TEXT;
ALTER TABLE pools ADD COLUMN invite_code   TEXT UNIQUE
  DEFAULT substring(gen_random_uuid()::text, 1, 8);

-- Backfill invite codes for any pools that got NULL (shouldn't happen with DEFAULT, but safe)
UPDATE pools SET invite_code = substring(gen_random_uuid()::text, 1, 8)
 WHERE invite_code IS NULL;

-- ── pool_members ──────────────────────────────────────────────────────────────
CREATE TABLE pool_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id   UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pool_id, user_id)
);

ALTER TABLE pool_members ENABLE ROW LEVEL SECURITY;

-- Members see their own rows; commissioners see all rows for their pool
CREATE POLICY "pool_members: select"
  ON pool_members FOR SELECT USING (
    auth.uid() = user_id OR
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

-- Anyone can add themselves
CREATE POLICY "pool_members: insert self"
  ON pool_members FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Members can leave; commissioners can remove anyone
CREATE POLICY "pool_members: delete"
  ON pool_members FOR DELETE USING (
    auth.uid() = user_id OR
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

CREATE INDEX idx_pool_members_pool ON pool_members(pool_id);
CREATE INDEX idx_pool_members_user ON pool_members(user_id);

-- ── Auto-add commissioner as member on pool creation ─────────────────────────
CREATE OR REPLACE FUNCTION add_commissioner_as_member()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pool_members (pool_id, user_id)
  VALUES (NEW.id, NEW.commissioner_id)
  ON CONFLICT (pool_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_pool_created_add_member
  AFTER INSERT ON pools
  FOR EACH ROW EXECUTE FUNCTION add_commissioner_as_member();

-- ── Backfill: existing commissioners become members ───────────────────────────
INSERT INTO pool_members (pool_id, user_id)
SELECT id, commissioner_id FROM pools
ON CONFLICT (pool_id, user_id) DO NOTHING;
