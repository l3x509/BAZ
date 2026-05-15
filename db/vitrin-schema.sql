-- ============================================================
-- VITRIN SCHEMA — Marketplace layer inside Baz
-- Run this in Supabase SQL Editor AFTER schema.sql
--
-- Adds:
--   vitrin_categories  — product category registry
--   products           — vendor product listings
--   orders             — buyer purchase orders
--   order_items        — line items per order
--
-- Also:
--   Updates event_type enum with Vitrin events
--   Adds updated_at triggers for new tables
--   Adds RLS to new tables
-- ============================================================

-- ─────────────────────────────────────────────
-- EXTEND EVENT TYPE ENUM
-- Adds Vitrin-specific events to the TwinZile stream
-- ─────────────────────────────────────────────

ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'product_viewed';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'product_created';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'product_updated';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'order_created';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'order_confirmed';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'order_completed';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'order_cancelled';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'vitrin_search';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'mode_selected';  -- when user picks find/buy/sell

-- ─────────────────────────────────────────────
-- VITRIN CATEGORIES
-- Product categories for the marketplace.
-- Separate from service_categories (Baz directory).
-- Synced from categories.js via sync-categories.js
-- ─────────────────────────────────────────────

CREATE TABLE vitrin_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT UNIQUE NOT NULL,   -- matches categories.js slug
  name_en     TEXT NOT NULL,
  name_ht     TEXT NOT NULL,
  name_fr     TEXT NOT NULL,
  icon        TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed from categories.js product + hybrid types
-- (sync-categories.js handles this — manual seed shown for reference)
INSERT INTO vitrin_categories (slug, name_en, name_ht, name_fr, icon, sort_order) VALUES
  ('grocery',        'Grocery',               'Komisyon',           'Épicerie',                  '🛒', 20),
  ('hair_beauty',    'Hair & Beauty',          'Cheve ak Bote',      'Cheveux & Beauté',           '💇', 21),
  ('fashion',        'Fashion & Clothing',     'Rad ak Mòd',         'Mode & Vêtements',           '👗', 22),
  ('food_products',  'Food Products',          'Pwodui Manje',       'Produits Alimentaires',      '🫙', 23),
  ('crafts',         'Crafts & Handmade',      'Atizana',            'Artisanat',                  '🧺', 30),
  ('art',            'Art & Paintings',        'Atizay ak Penti',    'Art & Peintures',            '🎨', 31),
  ('jewelry',        'Jewelry & Accessories',  'Bijou ak Akseswa',   'Bijoux & Accessoires',       '💎', 32),
  ('music',          'Music & Instruments',    'Mizik ak Enstriman', 'Musique & Instruments',      '🎵', 33),
  ('home_decor',     'Home & Decor',           'Kay ak Dekorasyon',  'Maison & Décoration',        '🏠', 34)
ON CONFLICT (slug) DO UPDATE SET
  name_en    = EXCLUDED.name_en,
  name_ht    = EXCLUDED.name_ht,
  name_fr    = EXCLUDED.name_fr,
  icon       = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────
-- PRODUCTS
-- Vendor product listings on Vitrin.
-- Supports voice note creation (Whisper transcription → draft → active).
-- Trilingual: vendors list in Kreyòl, agent serves in user's language.
-- ─────────────────────────────────────────────

CREATE TYPE product_status AS ENUM ('draft', 'pending', 'active', 'sold_out', 'inactive');

CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  business_id     UUID REFERENCES businesses(id) ON DELETE SET NULL,
  category_id     UUID REFERENCES vitrin_categories(id),

  -- Trilingual content
  -- Vendors create in any language; agent fills gaps via Claude translation
  name_ht         TEXT,
  name_en         TEXT,
  name_fr         TEXT,
  description_ht  TEXT,
  description_en  TEXT,
  description_fr  TEXT,

  -- Primary display name (used when specific lang not available)
  name            TEXT GENERATED ALWAYS AS (
    COALESCE(name_ht, name_en, name_fr)
  ) STORED,

  -- Pricing
  price_usd       NUMERIC(10,2) NOT NULL,
  price_htg       NUMERIC(10,2),       -- Haitian Gourde (optional)
  currency        TEXT DEFAULT 'USD',

  -- Inventory
  stock_quantity  INTEGER,             -- NULL = unlimited / made to order
  is_in_stock     BOOLEAN DEFAULT TRUE,

  -- Media
  images          TEXT[] DEFAULT ARRAY[]::TEXT[],  -- image URLs (Supabase Storage)
  voice_note_url  TEXT,               -- original voice note URL (Whisper source)

  -- Delivery options
  ships_to        TEXT[] DEFAULT ARRAY['HT'],  -- e.g. ['HT','US','CA']
  delivery_note   TEXT,               -- "Ships in 3-5 days", "Pickup only", etc.

  -- Status + visibility
  status          product_status DEFAULT 'draft',
  is_featured     BOOLEAN DEFAULT FALSE,
  listing_tier    TEXT DEFAULT 'free',  -- 'free', 'basic', 'pro'

  -- External sync — future (TikTok Shop, Etsy)
  tiktok_product_id   TEXT,
  etsy_listing_id     TEXT,
  last_synced_at      TIMESTAMPTZ,

  -- Stats (denormalized)
  view_count      INTEGER DEFAULT 0,
  order_count     INTEGER DEFAULT 0,
  avg_rating      NUMERIC(3,2) DEFAULT 0,

  -- Vitrin fee (% charged on each sale)
  fee_percent     NUMERIC(4,2) DEFAULT 8.00,  -- 8% default

  -- Metadata
  meta            JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_vendor       ON products(vendor_id);
CREATE INDEX idx_products_category     ON products(category_id);
CREATE INDEX idx_products_status       ON products(status);
CREATE INDEX idx_products_in_stock     ON products(is_in_stock);
CREATE INDEX idx_products_featured     ON products(is_featured);
CREATE INDEX idx_products_name_trgm    ON products USING GIN (name gin_trgm_ops);

-- ─────────────────────────────────────────────
-- ORDERS
-- Purchase orders placed via Vitrin.
-- Created in WhatsApp, managed on website dashboard.
-- ─────────────────────────────────────────────

CREATE TYPE order_status AS ENUM (
  'pending',      -- created, awaiting payment
  'paid',         -- payment confirmed
  'confirmed',    -- vendor confirmed
  'processing',   -- vendor preparing
  'shipped',      -- in transit
  'delivered',    -- delivered to buyer
  'cancelled',    -- cancelled before fulfillment
  'refunded'      -- refunded after payment
);

CREATE TYPE delivery_method AS ENUM ('pickup', 'local_delivery', 'shipping', 'digital');

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  vendor_id           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Financials
  subtotal            NUMERIC(10,2) NOT NULL,
  vitrin_fee          NUMERIC(10,2),         -- 8% of subtotal
  total               NUMERIC(10,2) NOT NULL,
  currency            TEXT DEFAULT 'USD',

  -- Delivery
  delivery_method     delivery_method DEFAULT 'pickup',
  delivery_address    TEXT,
  delivery_city       TEXT,
  delivery_country    TEXT DEFAULT 'HT',
  delivery_note       TEXT,

  -- Status
  status              order_status DEFAULT 'pending',
  status_note         TEXT,                   -- vendor/admin note on status change

  -- Payment
  stripe_payment_id   TEXT,
  stripe_payment_link TEXT,
  paid_at             TIMESTAMPTZ,

  -- Conversation context (for WhatsApp order tracking)
  conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Notes
  buyer_note          TEXT,
  vendor_note         TEXT,

  -- Metadata
  meta                JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_buyer        ON orders(buyer_id);
CREATE INDEX idx_orders_vendor       ON orders(vendor_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_created      ON orders(created_at);

-- ─────────────────────────────────────────────
-- ORDER ITEMS
-- Line items for each order.
-- Snapshot of product at time of purchase (price may change later).
-- ─────────────────────────────────────────────

CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Snapshot at time of purchase
  product_name    TEXT NOT NULL,         -- denormalized in case product changes
  product_image   TEXT,                  -- first image URL at time of purchase
  unit_price      NUMERIC(10,2) NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  subtotal        NUMERIC(10,2) NOT NULL, -- unit_price × quantity

  -- Metadata
  meta            JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ─────────────────────────────────────────────
-- PRODUCT REVIEWS
-- Separate from business reviews (reviews table in schema.sql)
-- ─────────────────────────────────────────────

CREATE TABLE product_reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  reviewer_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,  -- bought via Vitrin
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_product_reviews_product ON product_reviews(product_id);

-- ─────────────────────────────────────────────
-- UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────────

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

ALTER TABLE vitrin_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews    ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by the agent and sync scripts)
-- Website will add user-specific policies:
--   - Vendors can only edit their own products
--   - Buyers can only see their own orders
--   - Products with status='active' are publicly readable

-- ─────────────────────────────────────────────
-- USEFUL VIEWS (optional, for website dashboard)
-- ─────────────────────────────────────────────

-- Vendor dashboard summary
CREATE OR REPLACE VIEW vendor_summary AS
SELECT
  u.id                                          AS vendor_id,
  u.name                                        AS vendor_name,
  COUNT(DISTINCT p.id)                          AS total_products,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active')     AS active_products,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'draft')      AS draft_products,
  COUNT(DISTINCT o.id)                          AS total_orders,
  COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'delivered')  AS completed_orders,
  COALESCE(SUM(o.subtotal) FILTER (WHERE o.status = 'delivered'), 0) AS total_revenue,
  COALESCE(SUM(p.view_count), 0)                AS total_views
FROM users u
LEFT JOIN products p  ON p.vendor_id = u.id
LEFT JOIN orders o    ON o.vendor_id = u.id
WHERE u.role = 'vendor'
GROUP BY u.id, u.name;

-- Active product listing with category info
CREATE OR REPLACE VIEW active_products AS
SELECT
  p.*,
  vc.name_en   AS category_en,
  vc.name_ht   AS category_ht,
  vc.name_fr   AS category_fr,
  vc.icon      AS category_icon,
  u.name       AS vendor_name,
  u.phone      AS vendor_phone
FROM products p
JOIN vitrin_categories vc ON vc.id = p.category_id
JOIN users u              ON u.id  = p.vendor_id
WHERE p.status = 'active'
  AND p.is_in_stock = TRUE;
