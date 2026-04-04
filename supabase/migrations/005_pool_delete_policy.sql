-- Migration 005: Allow commissioners to delete their own pools
-- The pools table was missing a DELETE RLS policy, causing deletes to silently fail.

CREATE POLICY "pools: commissioner can delete"
  ON pools FOR DELETE USING (auth.uid() = commissioner_id);
