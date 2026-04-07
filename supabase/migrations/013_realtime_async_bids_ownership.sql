-- Migration 013: Add async_bids and ownership to realtime publication
--
-- async_bids was missing, causing the async bidding page to show stale high
-- bids — other users' new bids would not appear until a manual reload.
--
-- ownership was missing, causing the standings page's ownership subscription
-- to silently never fire.

ALTER PUBLICATION supabase_realtime ADD TABLE async_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE ownership;
