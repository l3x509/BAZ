-- ============================================================
-- BAZ SEED DATA — businesses table
-- Run this in Supabase SQL Editor
-- Categories are already seeded in schema.sql
-- ⚠️  Review names/details before using in production
--     Generated from general knowledge, not direct cultural source
-- ============================================================

INSERT INTO businesses (
  category_id, name, description, phone, whatsapp,
  city, country, neighborhood,
  status, is_verified, languages, listing_tier,
  avg_rating, review_count
)

SELECT
  c.id,
  b.name, b.description, b.phone, b.whatsapp,
  b.city, b.country, b.neighborhood,
  'active'::business_status,
  b.is_verified,
  b.languages,
  'free',
  b.avg_rating,
  b.review_count
FROM (VALUES

  -- ── PORT-AU-PRINCE ──────────────────────────────────────────

  ('plumber',     'Plonbye Rapid PAP',
   'Plonbye eksperyanse pou tout reparasyon dlo. Disponib 7j/7.',
   '+50937000001', '+50937000001',
   'Port-au-Prince', 'HT', 'Delmas',
   true, ARRAY['ht','fr'], 4.7, 12),

  ('electrician', 'Elektro Ayiti',
   'Entèpozisyon ak reparasyon sistèm elektrik. Kaye biznis ak kay.',
   '+50937000002', '+50937000002',
   'Port-au-Prince', 'HT', 'Pétion-Ville',
   true, ARRAY['ht','fr'], 4.5, 8),

  ('restaurant',  'Resto Kay Manman',
   'Manje ayisyen otantik. Griyo, tasso, legim, soup joumou chak dimanch.',
   '+50937000003', '+50937000003',
   'Port-au-Prince', 'HT', 'Turgeau',
   true, ARRAY['ht','fr'], 4.9, 34),

  ('driver',      'Chofè Servis Pétion-Ville',
   'Transpò fiyab nan tout zòn Port-au-Prince. Rézèvasyon avan prefere.',
   '+50937000004', '+50937000004',
   'Port-au-Prince', 'HT', 'Pétion-Ville',
   false, ARRAY['ht','fr'], 4.3, 5),

  ('grocery',     'Komisyon Lakay',
   'Livrezon komisyon nan tout Delmas ak Pétion-Ville. Mache Salomon ak Marché en Fer.',
   '+50937000005', '+50937000005',
   'Port-au-Prince', 'HT', 'Delmas',
   true, ARRAY['ht'], 4.6, 19),

  ('contractor',  'Konstriksyon Toussaint',
   'Konstriksyon, renovasyon, ak entretyen batiman. Devis gratis.',
   '+50937000006', '+50937000006',
   'Port-au-Prince', 'HT', 'Tabarre',
   true, ARRAY['ht','fr'], 4.4, 7),

  ('tutor',       'Pwofesè Matematik Marie',
   'Kours prive matematik ak syans pou elèv primè ak segondè.',
   '+50937000007', '+50937000007',
   'Port-au-Prince', 'HT', 'Bourdon',
   false, ARRAY['ht','fr'], 5.0, 3),

  ('cleaner',     'Netwayaj Propre',
   'Netwayaj kay, biwo, ak apre evènman. Ekip pwofesyonèl.',
   '+50937000008', '+50937000008',
   'Port-au-Prince', 'HT', 'Delmas',
   false, ARRAY['ht'], 4.2, 6),

  ('mechanic',    'Mekanisyen Auto Jean-Pierre',
   'Reparasyon tout mak machin. Espesyalize nan Toyota ak Nissan.',
   '+50937000009', '+50937000009',
   'Port-au-Prince', 'HT', 'Fontamara',
   true, ARRAY['ht','fr'], 4.8, 22),

  ('medical',     'Klinik Sante Espwa',
   'Konsiltasyon jeneral, pediátri, ak swen prenatal. Ouvrèt lendi-samdi.',
   '+50937000010', '+50937000010',
   'Port-au-Prince', 'HT', 'Pétion-Ville',
   true, ARRAY['ht','fr','en'], 4.6, 41),

  -- ── CAP-HAÏTIEN ─────────────────────────────────────────────

  ('restaurant',  'Lakou Resto Cap',
   'Pwason fre ak manje lokal. Prè plaj Cormier.',
   '+50939000001', '+50939000001',
   'Cap-Haïtien', 'HT', 'Centre-ville',
   true, ARRAY['ht','fr'], 4.7, 15),

  ('driver',      'Taxi Nord Ekspres',
   'Transpò Cap-Haïtien a Port-au-Prince. Vwayaj chak jou.',
   '+50939000002', '+50939000002',
   'Cap-Haïtien', 'HT', 'Vertières',
   false, ARRAY['ht'], 4.1, 9),

  ('contractor',  'Bâtisseur du Nord',
   'Konstriksyon kay ak renovasyon. Ekip eksperyanse nan Nò.',
   '+50939000003', '+50939000003',
   'Cap-Haïtien', 'HT', 'Lizon',
   false, ARRAY['ht','fr'], 4.3, 4),

  -- ── BOSTON DIASPORA ──────────────────────────────────────────

  ('restaurant',  'Chez Claudette Boston',
   'Authentic Haitian food in Mattapan. Griot, pikliz, diri ak pwa.',
   '+16175550001', '+16175550001',
   'Boston', 'US', 'Mattapan',
   true, ARRAY['ht','en','fr'], 4.8, 67),

  ('tutor',       'Boston Haitian Tutors',
   'Academic tutoring for K-12. Bilingual Kreyòl/English. Math, reading, science.',
   '+16175550002', '+16175550002',
   'Boston', 'US', 'Hyde Park',
   true, ARRAY['ht','en'], 4.9, 18),

  ('contractor',  'Jobin Construction LLC',
   'Residential construction and renovation. Licensed & insured in Massachusetts.',
   '+16175550003', '+16175550003',
   'Boston', 'US', 'Dorchester',
   true, ARRAY['ht','en'], 4.5, 11),

  -- ── MIAMI DIASPORA ───────────────────────────────────────────

  ('grocery',     'Little Haiti Market Miami',
   'Haitian groceries, spices, and fresh produce. NW 2nd Ave.',
   '+13055550001', '+13055550001',
   'Miami', 'US', 'Little Haiti',
   true, ARRAY['ht','en','fr'], 4.6, 29),

  ('restaurant',  'Tap Tap Restaurant Miami',
   'Famous Haitian restaurant on Miami Beach. Art, culture, and great food.',
   '+13055550002', '+13055550002',
   'Miami', 'US', 'Little Haiti',
   true, ARRAY['ht','en','fr'], 4.7, 112),

  ('driver',      'Miami Haitian Car Service',
   'Airport transfers and local rides. Haitian-owned, dependable service.',
   '+13055550003', '+13055550003',
   'Miami', 'US', 'Little Haiti',
   false, ARRAY['ht','en'], 4.4, 8),

  -- ── MONTREAL DIASPORA ────────────────────────────────────────

  ('restaurant',  'Resto Tropicana Montreal',
   'Cuisine haïtienne authentique à Saint-Michel. Livraison disponible.',
   '+15145550001', '+15145550001',
   'Montreal', 'CA', 'Saint-Michel',
   true, ARRAY['ht','fr'], 4.8, 44),

  ('tutor',       'Cours Créole Montréal',
   'Cours particuliers en français, math et sciences. Bilingue kreyòl/français.',
   '+15145550002', '+15145550002',
   'Montreal', 'CA', 'Montréal-Nord',
   false, ARRAY['ht','fr'], 4.7, 6),

  -- ── NEW YORK DIASPORA ────────────────────────────────────────

  ('restaurant',  'Flatbush Haitian Kitchen',
   'Haitian home cooking in Brooklyn. Soup joumou every Sunday.',
   '+17185550001', '+17185550001',
   'New York', 'US', 'Flatbush',
   true, ARRAY['ht','en'], 4.9, 88),

  ('contractor',  'Brooklyn Haitian Builders',
   'NYC-licensed contractors. Residential renovations, basements, roofing.',
   '+17185550002', '+17185550002',
   'New York', 'US', 'Crown Heights',
   true, ARRAY['ht','en'], 4.5, 16)

) AS b(
  category_slug, name, description, phone, whatsapp,
  city, country, neighborhood,
  is_verified, languages, avg_rating, review_count
)
JOIN service_categories c ON c.slug = b.category_slug;
