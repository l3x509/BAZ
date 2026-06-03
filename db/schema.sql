-- ============================================================
-- BAZ — COMPLETE DATABASE SCHEMA
-- Single source of truth. Run this on a fresh Supabase project
-- to recreate the entire database from scratch.
--
-- Last updated: 2026-06-03
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fast text search

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp_id       TEXT        NOT NULL UNIQUE,
  name              TEXT,
  language          TEXT        DEFAULT 'en',       -- 'en' | 'ht' | 'fr'
  role              TEXT        DEFAULT 'user',      -- 'user' | 'vendor' | 'admin'
  location_city     TEXT,
  location_country  TEXT,
  session_state     JSONB       DEFAULT '{}',
  last_seen_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_whatsapp    ON users (whatsapp_id);
CREATE INDEX IF NOT EXISTS idx_users_last_seen   ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_role        ON users (role);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_categories (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  name_en         TEXT    NOT NULL,
  name_ht         TEXT    NOT NULL,
  name_fr         TEXT    NOT NULL,
  icon            TEXT,
  description_en  TEXT,
  description_ht  TEXT,
  description_fr  TEXT,
  is_active       BOOLEAN DEFAULT true,
  sort_order      INTEGER DEFAULT 99,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug   ON service_categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_active ON service_categories (is_active, sort_order);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS businesses (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT,
  category_id      UUID    REFERENCES service_categories (id) ON DELETE SET NULL,
  owner_id         UUID    REFERENCES users (id) ON DELETE SET NULL,

  -- Status & visibility
  status           TEXT    DEFAULT 'pending',   -- 'active' | 'pending' | 'inactive'
  is_featured      BOOLEAN DEFAULT false,       -- paid premium placement
  is_verified      BOOLEAN DEFAULT false,       -- manually verified by Baz team

  -- Ratings & analytics
  avg_rating       NUMERIC (3,2) DEFAULT 0,
  review_count     INTEGER DEFAULT 0,
  inquiry_count    INTEGER DEFAULT 0,
  impression_count INTEGER DEFAULT 0,          -- appears in search results

  -- Contact
  phone            TEXT,
  whatsapp         TEXT,
  website          TEXT,
  email            TEXT,

  -- Location
  address          TEXT,
  neighborhood     TEXT,
  city             TEXT,
  country          TEXT,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses (category_id);
CREATE INDEX IF NOT EXISTS idx_businesses_status   ON businesses (status);
CREATE INDEX IF NOT EXISTS idx_businesses_city     ON businesses (city);
CREATE INDEX IF NOT EXISTS idx_businesses_featured ON businesses (is_featured DESC, avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_businesses_owner    ON businesses (owner_id);

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  whatsapp_id     TEXT,
  intent          TEXT        DEFAULT 'unknown',
  context         JSONB       DEFAULT '{}',
  is_active       BOOLEAN     DEFAULT true,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_convos_user       ON conversations (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_convos_last_msg   ON conversations (last_message_at DESC);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id  UUID        REFERENCES conversations (id) ON DELETE CASCADE,
  user_id          UUID        REFERENCES users (id) ON DELETE SET NULL,
  direction        TEXT        NOT NULL,   -- 'inbound' | 'outbound'
  message_type     TEXT        DEFAULT 'text',
  content          TEXT,
  media_url        TEXT,
  meta_message_id  TEXT        UNIQUE,     -- Twilio message SID, prevents duplicates
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_convo   ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user    ON messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_meta_id ON messages (meta_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_date    ON messages (created_at DESC);

-- ============================================================
-- BOOKINGS & INQUIRIES
-- ============================================================

CREATE TABLE IF NOT EXISTS bookings (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        REFERENCES users (id) ON DELETE SET NULL,
  business_id    UUID        REFERENCES businesses (id) ON DELETE SET NULL,
  category_id    UUID        REFERENCES service_categories (id) ON DELETE SET NULL,
  description    TEXT,
  scheduled_at   TIMESTAMPTZ,
  price_estimate NUMERIC (10,2),
  notes          TEXT,
  status         TEXT        DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user     ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings (business_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inquiries (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES users (id) ON DELETE SET NULL,
  business_id UUID        REFERENCES businesses (id) ON DELETE CASCADE,
  message     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_business ON inquiries (business_id);

-- ============================================================
-- ANALYTICS: BUSINESS EVENTS
-- Impression tracking for vendor stats.
-- Call tracking not implemented — phone numbers are visible
-- in results. Future: Twilio forwarding numbers for premium.
-- ============================================================

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

-- ============================================================
-- COMMUNITY EVENTS CALENDAR
-- Paid listings managed by Baz admin.
-- Organizers submit via WhatsApp flyer intake → Dulex approves.
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT        NOT NULL,
  description  TEXT,

  -- Location
  city         TEXT        NOT NULL,
  city_slug    TEXT        NOT NULL,  -- lowercase, no spaces: 'boston', 'miami'
  venue        TEXT,

  -- Timing
  event_date   DATE        NOT NULL,
  event_time   TEXT,                  -- e.g. "7:00 PM", "10PM–2AM"

  -- Commercial
  price        TEXT,                  -- e.g. "Free", "$25", "$35–50"
  contact      TEXT,
  organizer    TEXT,
  listing_tier TEXT        DEFAULT 'basic',  -- 'basic' | 'featured' | 'extended' | 'premium'
  is_featured  BOOLEAN     DEFAULT false,    -- paid upgrade — appears first

  -- Media
  flyer_url    TEXT,                  -- stored in Supabase Storage

  -- Workflow
  status       TEXT        DEFAULT 'pending',  -- 'pending' | 'active' | 'cancelled' | 'expired'
  submitted_by TEXT,                           -- whatsapp_id of organizer

  created_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_events_city_date
  ON events (city_slug, event_date);
CREATE INDEX IF NOT EXISTS idx_events_status_date
  ON events (status, event_date);
CREATE INDEX IF NOT EXISTS idx_events_featured
  ON events (is_featured DESC, event_date ASC);

-- ============================================================
-- VITRIN MARKETPLACE — Phase 2
-- Deactivated. Tables retained for future activation.
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id  UUID        REFERENCES businesses (id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT,
  price        NUMERIC (10,2),
  currency     TEXT        DEFAULT 'USD',
  category_id  UUID        REFERENCES service_categories (id) ON DELETE SET NULL,
  image_url    TEXT,
  stock        INTEGER     DEFAULT 0,
  status       TEXT        DEFAULT 'draft',   -- 'draft' | 'active' | 'sold_out'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        REFERENCES users (id) ON DELETE SET NULL,
  business_id  UUID        REFERENCES businesses (id) ON DELETE SET NULL,
  product_id   UUID        REFERENCES products (id) ON DELETE SET NULL,
  quantity     INTEGER     DEFAULT 1,
  total_amount NUMERIC (10,2),
  currency     TEXT        DEFAULT 'USD',
  status       TEXT        DEFAULT 'pending',
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TWINZILE EVENT LOG — append only
-- Gated by TWINZILE_ENABLED=true env var. Off by default.
-- Separate project — do not enable in Baz.
-- ============================================================

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

CREATE INDEX IF NOT EXISTS idx_twinzile_type ON twinzile_logs (event_type, created_at DESC);

-- ============================================================
-- POSTGRES FUNCTIONS
-- ============================================================

-- Increment business inquiry count (called by createInquiry in db.js)
CREATE OR REPLACE FUNCTION increment_inquiry_count(business_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE businesses
  SET inquiry_count = COALESCE(inquiry_count, 0) + 1
  WHERE id = business_id;
END;
$$;

-- Increment impression count (called by logBusinessEvent in db.js)
CREATE OR REPLACE FUNCTION increment_impression_count(p_business_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE businesses
  SET impression_count = COALESCE(impression_count, 0) + 1
  WHERE id = p_business_id;
END;
$$;

-- Auto-update businesses.updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS businesses_updated_at ON businesses;
CREATE TRIGGER businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
