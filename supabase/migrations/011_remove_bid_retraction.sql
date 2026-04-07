-- Migration 011: Remove async bid retraction
--
-- Bids are now permanent from the user's perspective. Once placed, a bid
-- cannot be retracted — only raised. The server still replaces a user's own
-- bid record internally when they post a higher bid (using the service role),
-- but users no longer have direct DELETE access.

DROP POLICY IF EXISTS "async_bids: users delete own during async_bidding" ON async_bids;
