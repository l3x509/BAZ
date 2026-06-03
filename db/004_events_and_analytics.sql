-- ============================================================
-- MIGRATION 004 — Events Calendar + Business Analytics
-- Date: 2026-06-03
-- Safe to run multiple times (IF NOT EXISTS / OR REPLACE).
--
-- What this adds:
--   1. impression_count + owner_id columns on businesses
--   2. business_events table (impression tracking)
--   3. events table (community events calendar)
--   4. twinzile_logs table (renamed from 'events' if it existed)
--   5. Postgres functions for atomic counter increments
-- ============================================================

-- ── 1. Add columns to businesses ─────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_id         UUID REFERENCES users (id) ON DELETE SET NULL;

-- ── 2. business_events (impression tracking) ─────────────────
CREATE TABLE IF NOT EXISTS business_events (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     UUID        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN ('impression','call','whatsapp','feedback')),
  user_id         UUID        REFERENCES users (id) ON DELETE SET NULL,
  search_query    TEXT,
  category_slug   TEXT,
  city            TEXT,
  result_position INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biz_events_business_date
  ON business_events (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biz_events_type_date
  ON business_events (event_type, created_at DESC);

-- ── 3. events (community events calendar) ────────────────────
-- NOTE: If you had a TwinZile 'events' table, rename it first:
--   ALTER TABLE events RENAME TO twinzile_logs;
-- Then run this migration.
CREATE TABLE IF NOT EXISTS events (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT        NOT NULL,
  description  TEXT,
  city         TEXT        NOT NULL,
  city_slug    TEXT        NOT NULL,
  venue        TEXT,
  event_date   DATE        NOT NULL,
  event_time   TEXT,
  price        TEXT,
  contact      TEXT,
  organizer    TEXT,
  listing_tier TEXT        DEFAULT 'basic',
  is_featured  BOOLEAN     DEFAULT false,
  flyer_url    TEXT,
  status       TEXT        DEFAULT 'pending',
  submitted_by TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_events_city_date
  ON events (city_slug, event_date);
CREATE INDEX IF NOT EXISTS idx_events_status_date
  ON events (status, event_date);

-- ── 4. twinzile_logs (renamed from events if existed) ────────
CREATE TABLE IF NOT EXISTS twinzile_logs (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  user_id      UUID        REFERENCES users (id) ON DELETE SET NULL,
  session_id   TEXT,
  entity_type  TEXT,
  entity_id    UUID,
  payload      JSONB       DEFAULT '{}',
  city         TEXT,
  country      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Functions ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_impression_count(p_business_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE businesses
  SET impression_count = COALESCE(impression_count, 0) + 1
  WHERE id = p_business_id;
END;
$$;

CREATE OR REPLACE FUNCTION increment_inquiry_count(business_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE businesses
  SET inquiry_count = COALESCE(inquiry_count, 0) + 1
  WHERE id = business_id;
END;
$$;

-- ── 6. Backfill owner_id for existing vendors ─────────────────
UPDATE businesses b
SET owner_id = u.id
FROM users u
WHERE u.role = 'vendor'
  AND b.owner_id IS NULL
  AND b.status IN ('active', 'pending');

-- ── 7. Verify ─────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM business_events) AS business_events,
  (SELECT COUNT(*) FROM events)          AS events,
  (SELECT COUNT(*) FROM twinzile_logs)   AS twinzile_logs,
  (SELECT COUNT(*) FROM businesses WHERE impression_count >= 0) AS businesses_with_counter;
