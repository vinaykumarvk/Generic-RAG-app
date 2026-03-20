-- Migration 022: add structured details payload for review queue items

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
