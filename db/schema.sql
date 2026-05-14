-- ============================================================
-- BAZ DATABASE SCHEMA
-- Shared by: WhatsApp Agent (now) + Website (later) + TwinZile (future)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy search on business names

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('diaspora', 'vendor', 'admin');
CREATE TYPE user_language AS ENUM ('ht', 'en', 'fr'); -- Haitian Creole, English, French
CREATE TYPE business_status AS ENUM ('pending', 'active', 'suspended', 'inactive');
CREATE TYPE booking_status AS ENUM ('inquiry', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded');
CREATE TYPE remittance_type AS ENUM ('grocery', 'school_fee', 'contractor', 'electricity', 'medical', 'general');
CREATE TYPE event_type AS ENUM (
  'session_start', 'language_selected', 'message_received', 'message_sent',
  'search_performed', 'business_viewed', 'inquiry_created', 'booking_created',
  'booking_updated', 'transaction_initiated', 'transaction_completed',
  'remittance_initiated', 'remittance_completed', 'vendor_onboarded'
);

-- ============================================================
-- CORE: USERS
-- ============================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whatsapp_id     TEXT UNIQUE NOT NULL,         -- Meta's wa_id (phone number)
  phone           TEXT,
  name            TEXT,
  language        user_language DEFAULT 'en',
  role            user_role DEFAULT 'diaspora',
  location_city   TEXT,                          -- e.g. "Boston", "Port-au-Prince"
  location_country TEXT,                         -- e.g. "US", "HT"
  is_verified     BOOLEAN DEFAULT FALSE,
  session_state   JSONB DEFAULT '{}',            -- current conversation state
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_whatsapp_id ON users(whatsapp_id);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- CORE: SERVICE CATEGORIES
-- ============================================================

CREATE TABLE service_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT UNIQUE NOT NULL,   -- e.g. "plumber", "driver", "tutor"
  name_en     TEXT NOT NULL,
  name_ht     TEXT NOT NULL,
  name_fr     TEXT NOT NULL,
  icon        TEXT,                   -- emoji or icon name
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO service_categories (slug, name_en, name_ht, name_fr, icon, sort_order) VALUES
  ('plumber',      'Plumber',          'Plonbye',         'Plombier',          '🔧', 1),
  ('electrician',  'Electrician',      'Elektrisyen',     'Électricien',       '⚡', 2),
  ('driver',       'Driver',           'Chofè',           'Chauffeur',         '🚗', 3),
  ('tutor',        'Tutor',            'Pwofesè',         'Tuteur',            '📚', 4),
  ('contractor',   'Contractor',       'Kontraktè',       'Entrepreneur',      '🏗️', 5),
  ('cook',         'Cook / Chef',      'Kizinyè',         'Cuisinier',         '👨‍🍳', 6),
  ('grocery',      'Grocery Delivery', 'Livrezon Manje',  'Épicerie',          '🛒', 7),
  ('cleaner',      'Cleaning Service', 'Netwayaj',        'Nettoyage',         '🧹', 8),
  ('mechanic',     'Mechanic',         'Mekanisyen',      'Mécanicien',        '🔩', 9),
  ('restaurant',   'Restaurant',       'Restoran',        'Restaurant',        '🍽️', 10),
  ('medical',      'Medical / Health', 'Medikal',         'Médical',           '🏥', 11),
  ('other',        'Other',            'Lòt',             'Autre',             '📋', 99);

-- ============================================================
-- CORE: BUSINESSES (BAZ DIRECTORY)
-- ============================================================

CREATE TABLE businesses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  category_id         UUID REFERENCES service_categories(id),
  name                TEXT NOT NULL,
  description         TEXT,
  phone               TEXT,
  whatsapp            TEXT,
  email               TEXT,
  website             TEXT,

  -- Location
  city                TEXT NOT NULL,
  country             TEXT NOT NULL DEFAULT 'HT',  -- HT or diaspora city
  neighborhood        TEXT,
  address             TEXT,
  lat                 NUMERIC(10, 7),
  lng                 NUMERIC(10, 7),

  -- Trust & verification
  status              business_status DEFAULT 'pending',
  is_verified         BOOLEAN DEFAULT FALSE,
  verification_notes  TEXT,
  verified_at         TIMESTAMPTZ,

  -- Listing tier
  is_featured         BOOLEAN DEFAULT FALSE,
  listing_tier        TEXT DEFAULT 'free',         -- 'free', 'basic', 'pro'
  listing_expires_at  TIMESTAMPTZ,

  -- Stats (denormalized for speed)
  review_count        INTEGER DEFAULT 0,
  avg_rating          NUMERIC(3,2) DEFAULT 0,
  inquiry_count       INTEGER DEFAULT 0,

  -- Languages spoken
  languages           TEXT[] DEFAULT ARRAY['ht'],

  -- TwinZile: raw metadata bag
  meta                JSONB DEFAULT '{}',

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_businesses_category ON businesses(category_id);
CREATE INDEX idx_businesses_city ON businesses(city);
CREATE INDEX idx_businesses_country ON businesses(country);
CREATE INDEX idx_businesses_status ON businesses(status);
CREATE INDEX idx_businesses_name_trgm ON businesses USING GIN (name gin_trgm_ops);

-- ============================================================
-- CORE: REVIEWS
-- ============================================================

CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID REFERENCES businesses(id) ON DELETE CASCADE,
  reviewer_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  is_verified   BOOLEAN DEFAULT FALSE,   -- verified transaction
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_business ON reviews(business_id);

-- ============================================================
-- CONVERSATIONS: SESSION STATE
-- ============================================================

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  whatsapp_id     TEXT NOT NULL,
  intent          TEXT,                    -- 'find', 'pay', 'onboard', 'status', 'unknown'
  state           JSONB DEFAULT '{}',      -- full conversation state machine data
  context         JSONB DEFAULT '{}',      -- search params, selected business, etc.
  is_active       BOOLEAN DEFAULT TRUE,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_whatsapp ON conversations(whatsapp_id);
CREATE INDEX idx_conversations_active ON conversations(is_active, last_message_at);

-- ============================================================
-- CONVERSATIONS: MESSAGE LOG
-- ============================================================

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type    TEXT DEFAULT 'text',     -- 'text', 'voice', 'image', 'template'
  content         TEXT,                    -- text content or transcription
  media_url       TEXT,                    -- original media URL if voice/image
  meta_message_id TEXT,                    -- Meta's message ID for dedup
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_meta_id ON messages(meta_message_id);

-- ============================================================
-- TRANSACTIONS: INQUIRIES
-- ============================================================

CREATE TABLE inquiries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  business_id   UUID REFERENCES businesses(id) ON DELETE SET NULL,
  message       TEXT,
  status        TEXT DEFAULT 'open',       -- 'open', 'responded', 'closed'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRANSACTIONS: BOOKINGS
-- ============================================================

CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  business_id     UUID REFERENCES businesses(id) ON DELETE SET NULL,
  category_id     UUID REFERENCES service_categories(id),
  description     TEXT,
  scheduled_at    TIMESTAMPTZ,
  status          booking_status DEFAULT 'inquiry',
  price_estimate  NUMERIC(10,2),
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  meta            JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_business ON bookings(business_id);
CREATE INDEX idx_bookings_status ON bookings(status);

-- ============================================================
-- TRANSACTIONS: PAYMENTS
-- ============================================================

CREATE TABLE transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  booking_id          UUID REFERENCES bookings(id) ON DELETE SET NULL,
  stripe_payment_id   TEXT UNIQUE,
  stripe_payment_link TEXT,
  amount              NUMERIC(10,2) NOT NULL,
  fee                 NUMERIC(10,2),
  currency            TEXT DEFAULT 'USD',
  status              transaction_status DEFAULT 'pending',
  description         TEXT,
  meta                JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);

-- ============================================================
-- TRANSACTIONS: REMITTANCES
-- ============================================================

CREATE TABLE remittances (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_name    TEXT NOT NULL,
  recipient_phone   TEXT,
  total_amount      NUMERIC(10,2) NOT NULL,
  fee               NUMERIC(10,2),
  currency          TEXT DEFAULT 'USD',
  status            transaction_status DEFAULT 'pending',

  -- Structured splits (the key differentiator vs raw cash)
  splits            JSONB DEFAULT '[]',
  -- e.g. [{"type": "grocery", "amount": 80, "vendor_id": "uuid", "note": "Marché Salomon"},
  --        {"type": "school_fee", "amount": 120, "vendor_id": "uuid", "note": "École Nationale"}]

  stripe_payment_id TEXT,
  stripe_payment_link TEXT,
  meta              JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_remittances_sender ON remittances(sender_id);
CREATE INDEX idx_remittances_status ON remittances(status);

-- ============================================================
-- TWINZILE: EVENT STREAM (append-only, never update)
-- ============================================================

CREATE TABLE events (
  id            BIGSERIAL PRIMARY KEY,             -- serial for ordering
  event_type    event_type NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id    UUID,                              -- conversation id
  entity_type   TEXT,                             -- 'business', 'booking', 'transaction', etc.
  entity_id     UUID,
  payload       JSONB DEFAULT '{}',               -- full context snapshot
  city          TEXT,                             -- denormalized for fast geo queries
  country       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_user ON events(user_id);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_city ON events(city);
-- No updates ever on this table — append only

-- ============================================================
-- HELPERS: updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_remittances_updated_at
  BEFORE UPDATE ON remittances FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (enable when using Supabase auth)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by the agent)
-- Website will add user-specific policies later
