-- ============================================================
-- Masters Calcutta Pool — Initial Schema
-- ============================================================

-- Enums
CREATE TYPE pool_status AS ENUM (
  'setup','async_bidding','live_auction','locked',
  'tournament_active','completed'
);
CREATE TYPE golfer_status AS ENUM ('active','withdrawn','missed_cut');
CREATE TYPE auction_item_status AS ENUM (
  'pending','open','going_once','going_twice','sold'
);
CREATE TYPE acquired_via AS ENUM ('async_auction','live_auction');

-- ============================================================
-- profiles
-- ============================================================
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  email         text NOT NULL,
  is_commissioner boolean NOT NULL DEFAULT false,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: users read own"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles: users update own"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles: anyone can read"
  ON profiles FOR SELECT USING (true);

-- Auto-create profile on auth user insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- pools
-- ============================================================
CREATE TABLE pools (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  year                integer NOT NULL DEFAULT EXTRACT(year FROM now()),
  status              pool_status NOT NULL DEFAULT 'setup',
  async_bid_start     timestamptz,
  async_bid_deadline  timestamptz,
  live_auction_start  timestamptz,
  total_pot           decimal(10,2) NOT NULL DEFAULT 0,
  commissioner_id     uuid NOT NULL REFERENCES profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pools: anyone can read"
  ON pools FOR SELECT USING (true);

CREATE POLICY "pools: commissioner can update"
  ON pools FOR UPDATE USING (auth.uid() = commissioner_id);

CREATE POLICY "pools: authenticated can insert"
  ON pools FOR INSERT WITH CHECK (auth.uid() = commissioner_id);

-- Auto-create default payout rules on pool insert
CREATE OR REPLACE FUNCTION create_default_payout_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payout_rules (pool_id, finish_position, payout_percentage, label)
  VALUES
    (NEW.id, 1, 50, 'Winner'),
    (NEW.id, 2, 25, 'Runner-up'),
    (NEW.id, 3, 15, '3rd Place'),
    (NEW.id, 4, 7,  '4th Place'),
    (NEW.id, 5, 3,  '5th Place');
  RETURN NEW;
END;
$$;

-- ============================================================
-- golfers
-- ============================================================
CREATE TABLE golfers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id               uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  country               text,
  world_ranking         integer,
  sportsdata_player_id  integer,
  image_url             text,
  status                golfer_status NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX golfers_pool_id_idx ON golfers(pool_id);
CREATE INDEX golfers_sportsdata_idx ON golfers(sportsdata_player_id);

ALTER TABLE golfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "golfers: anyone can read"
  ON golfers FOR SELECT USING (true);

CREATE POLICY "golfers: commissioner can insert"
  ON golfers FOR INSERT WITH CHECK (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

CREATE POLICY "golfers: commissioner can update"
  ON golfers FOR UPDATE USING (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

CREATE POLICY "golfers: commissioner can delete"
  ON golfers FOR DELETE USING (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

-- ============================================================
-- async_bids
-- ============================================================
CREATE TABLE async_bids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id     uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  golfer_id   uuid NOT NULL REFERENCES golfers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id),
  amount      decimal(10,2) NOT NULL CHECK (amount > 0),
  is_max_bid  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX async_bids_pool_id_idx ON async_bids(pool_id);
CREATE INDEX async_bids_golfer_id_idx ON async_bids(golfer_id);
CREATE INDEX async_bids_user_id_idx ON async_bids(user_id);

ALTER TABLE async_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "async_bids: users see own"
  ON async_bids FOR SELECT
  USING (
    auth.uid() = user_id OR
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

CREATE POLICY "async_bids: users insert during async_bidding"
  ON async_bids FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    (SELECT status FROM pools WHERE id = pool_id) = 'async_bidding'
  );

CREATE POLICY "async_bids: users delete own during async_bidding"
  ON async_bids FOR DELETE USING (
    auth.uid() = user_id AND
    (SELECT status FROM pools WHERE id = pool_id) = 'async_bidding'
  );

-- View: highest async bid per golfer (public)
CREATE VIEW async_high_bids AS
  SELECT DISTINCT ON (golfer_id)
    golfer_id,
    pool_id,
    amount AS high_bid,
    -- hide who bid; show only the amount
    created_at
  FROM async_bids
  ORDER BY golfer_id, amount DESC;

-- ============================================================
-- live_auction
-- ============================================================
CREATE TABLE live_auction (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id           uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  golfer_id         uuid NOT NULL REFERENCES golfers(id) ON DELETE CASCADE UNIQUE,
  floor_price       decimal(10,2) NOT NULL DEFAULT 1,
  current_bid       decimal(10,2) NOT NULL DEFAULT 0,
  current_bidder_id uuid REFERENCES profiles(id),
  bid_count         integer NOT NULL DEFAULT 0,
  status            auction_item_status NOT NULL DEFAULT 'pending',
  opened_at         timestamptz,
  sold_at           timestamptz
);

ALTER TABLE live_auction REPLICA IDENTITY FULL;

CREATE INDEX live_auction_pool_id_idx ON live_auction(pool_id);
CREATE INDEX live_auction_status_idx ON live_auction(status);

ALTER TABLE live_auction ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_auction: anyone can read"
  ON live_auction FOR SELECT USING (true);

CREATE POLICY "live_auction: authenticated can update bid"
  ON live_auction FOR UPDATE USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "live_auction: commissioner can insert"
  ON live_auction FOR INSERT WITH CHECK (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

-- Publish to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE live_auction;

-- ============================================================
-- ownership
-- ============================================================
CREATE TABLE ownership (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id        uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  golfer_id      uuid NOT NULL REFERENCES golfers(id) ON DELETE CASCADE UNIQUE,
  user_id        uuid NOT NULL REFERENCES profiles(id),
  purchase_price decimal(10,2) NOT NULL,
  acquired_via   acquired_via NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ownership_pool_id_idx ON ownership(pool_id);
CREATE INDEX ownership_user_id_idx ON ownership(user_id);

ALTER TABLE ownership ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ownership: anyone can read"
  ON ownership FOR SELECT USING (true);

CREATE POLICY "ownership: commissioner/service can insert"
  ON ownership FOR INSERT WITH CHECK (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

-- Trigger: recalculate pools.total_pot on ownership insert
CREATE OR REPLACE FUNCTION recalculate_total_pot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pools
  SET total_pot = (
    SELECT COALESCE(SUM(purchase_price), 0)
    FROM ownership
    WHERE pool_id = NEW.pool_id
  )
  WHERE id = NEW.pool_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_ownership_insert
  AFTER INSERT ON ownership
  FOR EACH ROW EXECUTE FUNCTION recalculate_total_pot();

-- ============================================================
-- scores
-- ============================================================
CREATE TABLE scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id          uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  golfer_id        uuid NOT NULL REFERENCES golfers(id) ON DELETE CASCADE,
  round            integer NOT NULL CHECK (round BETWEEN 1 AND 4),
  score_to_par     integer,
  total_to_par     integer,
  thru             integer,
  position         integer,
  position_display text,
  is_active        boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pool_id, golfer_id, round)
);

ALTER TABLE scores REPLICA IDENTITY FULL;

CREATE INDEX scores_pool_id_idx ON scores(pool_id);
CREATE INDEX scores_golfer_id_idx ON scores(golfer_id);
CREATE INDEX scores_position_idx ON scores(pool_id, total_to_par);

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scores: anyone can read"
  ON scores FOR SELECT USING (true);

-- Service role only writes (cron job uses service role key)

ALTER PUBLICATION supabase_realtime ADD TABLE scores;

-- ============================================================
-- payout_rules
-- ============================================================
CREATE TABLE payout_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id           uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  finish_position   integer NOT NULL,
  payout_percentage decimal(5,2) NOT NULL CHECK (payout_percentage >= 0 AND payout_percentage <= 100),
  label             text NOT NULL DEFAULT '',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pool_id, finish_position)
);

ALTER TABLE payout_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payout_rules: anyone can read"
  ON payout_rules FOR SELECT USING (true);

CREATE POLICY "payout_rules: commissioner can modify"
  ON payout_rules FOR ALL USING (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

-- ============================================================
-- payouts
-- ============================================================
CREATE TABLE payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id         uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id),
  golfer_id       uuid NOT NULL REFERENCES golfers(id),
  finish_position integer NOT NULL,
  payout_rule_id  uuid REFERENCES payout_rules(id),
  payout_amount   decimal(10,2) NOT NULL,
  net_profit      decimal(10,2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payouts_pool_id_idx ON payouts(pool_id);
CREATE INDEX payouts_user_id_idx ON payouts(user_id);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payouts: anyone can read"
  ON payouts FOR SELECT USING (true);

CREATE POLICY "payouts: commissioner can insert"
  ON payouts FOR INSERT WITH CHECK (
    auth.uid() = (SELECT commissioner_id FROM pools WHERE id = pool_id)
  );

-- Now add the trigger for default payout rules (after payout_rules table exists)
CREATE TRIGGER on_pool_created
  AFTER INSERT ON pools
  FOR EACH ROW EXECUTE FUNCTION create_default_payout_rules();

-- ============================================================
-- Realtime: also publish pools table
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE pools;

-- ============================================================
-- Helpful views
-- ============================================================

-- Leaderboard view: best score per golfer (latest round)
CREATE VIEW leaderboard AS
  SELECT DISTINCT ON (s.golfer_id)
    s.pool_id,
    s.golfer_id,
    g.name,
    g.country,
    g.status AS golfer_status,
    s.total_to_par,
    s.thru,
    s.position,
    s.position_display,
    s.round,
    s.updated_at,
    o.user_id AS owner_id,
    p.display_name AS owner_name,
    o.purchase_price
  FROM scores s
  JOIN golfers g ON g.id = s.golfer_id
  LEFT JOIN ownership o ON o.golfer_id = s.golfer_id
  LEFT JOIN profiles p ON p.id = o.user_id
  ORDER BY s.golfer_id, s.round DESC;
