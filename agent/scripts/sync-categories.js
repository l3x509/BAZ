'use strict';

// ============================================================
// scripts/sync-categories.js
// Runs on every deploy via "prestart" in package.json.
// Upserts all categories + keywords into service_categories.
// This is the single source of truth for category definitions.
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Category definitions ─────────────────────────────────────
// slug        : DB identifier — never change once set
// name_en     : display name
// icon        : WhatsApp menu emoji
// sort_order  : menu display order
// is_active   : false = hidden from menu but still searchable
// keywords    : ALL words users might type to reach this category
//               Add freely — no deploy needed after migration runs once
// ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    slug: 'restaurant', name_en: 'Restaurant', icon: '🍲', is_active: true, sort_order: 1,
    keywords: {
      en: ['restaurant', 'food', 'eat', 'dining', 'meal', 'lunch', 'dinner', 'breakfast', 'takeout', 'haitian food', 'cuisine'],
      ht: ['manje', 'restoran', 'griyo', 'kizin', 'bwè', 'manje ayisyen', 'diri', 'soup joumou', 'poul', 'lalo'],
      fr: ['restaurant', 'manger', 'repas', 'nourriture', 'cuisine', 'déjeuner', 'dîner'],
    },
  },
  {
    slug: 'hair_beauty', name_en: 'Hair & Beauty', icon: '💇', is_active: true, sort_order: 2,
    keywords: {
      en: ['hair', 'salon', 'barber', 'beauty', 'nails', 'braids', 'locs', 'wig', 'extensions', 'stylist', 'haircut'],
      ht: ['cheve', 'bote', 'salon', 'kwafiè', 'zong', 'tres', 'pèwik', 'koupe cheve', 'estilès'],
      fr: ['coiffure', 'salon', 'beauté', 'cheveux', 'coiffeur', 'ongles', 'tresses'],
    },
  },
  {
    slug: 'legal', name_en: 'Legal & Immigration', icon: '⚖️', is_active: true, sort_order: 3,
    keywords: {
      en: ['lawyer', 'legal', 'immigration', 'attorney', 'visa', 'asylum', 'citizenship', 'green card', 'law', 'immigration lawyer'],
      ht: ['avoka', 'legal', 'imigrasyon', 'viza', 'sitwayènte', 'kat vèt', 'lwa', 'jistis', 'azil'],
      fr: ['avocat', 'juridique', 'immigration', 'visa', 'citoyenneté', 'droit', 'asile'],
    },
  },
  {
    slug: 'childcare', name_en: 'Childcare', icon: '🧒', is_active: true, sort_order: 4,
    keywords: {
      en: ['childcare', 'daycare', 'babysitter', 'kids', 'children', 'nursery', 'after school', 'babysitting'],
      ht: ['gadri', 'timoun', 'fanm ki gade timoun', 'apre lekòl', 'swen timoun', 'gade timoun'],
      fr: ['garderie', 'enfants', 'babysitter', 'crèche', 'garde enfants', 'nounou'],
    },
  },
  {
    slug: 'shipping', name_en: 'Shipping to Haiti', icon: '🚢', is_active: true, sort_order: 5,
    keywords: {
      en: ['shipping', 'cargo', 'freight', 'send to haiti', 'package', 'barrel', 'haiti shipping', 'ship'],
      ht: ['kago', 'voye', 'pakè', 'baril', 'ekspedisyon', 'voye ann ayiti', 'kolis'],
      fr: ['cargo', 'expédition', 'envoi', 'colis', 'fret', 'baril', 'envoi haïti'],
    },
  },
  {
    slug: 'tax_notary', name_en: 'Tax & Notary', icon: '💼', is_active: true, sort_order: 6,
    keywords: {
      en: ['tax', 'taxes', 'notary', 'accounting', 'accountant', 'filing', 'irs', 'tax prep', 'tax return'],
      ht: ['taks', 'notè', 'kontab', 'deklarasyon', 'impô', 'taks revni', 'lajan taks'],
      fr: ['impôts', 'notaire', 'comptable', 'fiscalité', 'déclaration', 'taxes'],
    },
  },
  {
    slug: 'real_estate', name_en: 'Real Estate', icon: '🏠', is_active: true, sort_order: 7,
    keywords: {
      en: ['real estate', 'realtor', 'house', 'apartment', 'rent', 'buy', 'property', 'housing', 'home'],
      ht: ['imobilye', 'kay', 'apatman', 'lwaye', 'achte', 'pwopriyete', 'kay pou lwaye', 'kay pou vann'],
      fr: ['immobilier', 'maison', 'appartement', 'loyer', 'propriété', 'logement', 'agence'],
    },
  },
  {
    slug: 'church', name_en: 'Church & Organization', icon: '⛪', is_active: true, sort_order: 8,
    keywords: {
      en: ['church', 'ministry', 'pastor', 'worship', 'faith', 'prayer', 'religion', 'organization', 'community'],
      ht: ['legliz', 'ministè', 'pastè', 'lapriyè', 'relijyon', 'kwayan', 'revi', 'òganizasyon'],
      fr: ['église', 'ministère', 'pasteur', 'prière', 'culte', 'religion', 'organisation'],
    },
  },
  {
    slug: 'plumber', name_en: 'Plumber', icon: '🔧', is_active: true, sort_order: 9,
    keywords: {
      en: ['plumber', 'plumbing', 'pipes', 'leak', 'water', 'drain', 'faucet'],
      ht: ['plonbye', 'tiyo', 'dlo', 'fwit', 'kanalizasyon', 'robinè'],
      fr: ['plombier', 'plomberie', 'tuyaux', 'fuite', 'eau', 'robinet'],
    },
  },
  {
    slug: 'electrician', name_en: 'Electrician', icon: '⚡', is_active: true, sort_order: 10,
    keywords: {
      en: ['electrician', 'electrical', 'wiring', 'power', 'outlet', 'electric', 'lights'],
      ht: ['elektrisyen', 'kouran', 'fil elektrik', 'priz', 'elektrik', 'limyè'],
      fr: ['électricien', 'électricité', 'câblage', 'courant', 'prise', 'lumière'],
    },
  },
  {
    slug: 'mechanic', name_en: 'Mechanic', icon: '🔩', is_active: true, sort_order: 11,
    keywords: {
      en: ['mechanic', 'car repair', 'auto', 'vehicle', 'engine', 'brakes', 'oil change', 'car'],
      ht: ['mekanisyen', 'machin', 'reparasyon machin', 'otomobil', 'motè', 'fren', 'vwati'],
      fr: ['mécanicien', 'réparation voiture', 'auto', 'véhicule', 'moteur', 'freins'],
    },
  },
  {
    slug: 'cleaner', name_en: 'Cleaning Service', icon: '🧹', is_active: true, sort_order: 12,
    keywords: {
      en: ['cleaner', 'cleaning', 'maid', 'housekeeping', 'janitorial', 'deep clean', 'house cleaning'],
      ht: ['netwaye', 'sèvis netwayaj', 'bòn', 'kay pwòp', 'menaj', 'netwayaj'],
      fr: ['nettoyage', 'ménage', 'femme de ménage', 'nettoyant', 'entretien', 'propreté'],
    },
  },
  {
    slug: 'driver', name_en: 'Driver', icon: '🚗', is_active: true, sort_order: 13,
    keywords: {
      en: ['driver', 'transportation', 'rides', 'taxi', 'chauffeur', 'airport', 'ride'],
      ht: ['chofè', 'transpò', 'taksi', 'ayewopò', 'machin', 'kondwi', 'vwati'],
      fr: ['chauffeur', 'transport', 'taxi', 'conducteur', 'aéroport', 'voiture'],
    },
  },
  {
    slug: 'cook', name_en: 'Cook / Chef', icon: '👨‍🍳', is_active: true, sort_order: 14,
    keywords: {
      en: ['cook', 'chef', 'catering', 'meal prep', 'food prep', 'private chef', 'cooking'],
      ht: ['kizinyè', 'chef', 'trète', 'prepare manje', 'katerin', 'manje lakay', 'kwit manje'],
      fr: ['cuisinier', 'chef', 'traiteur', 'préparation repas', 'cuisine', 'repas maison'],
    },
  },
  {
    slug: 'tutor', name_en: 'Tutor', icon: '📚', is_active: true, sort_order: 15,
    keywords: {
      en: ['tutor', 'teacher', 'tutoring', 'lessons', 'homework', 'education', 'school', 'learning'],
      ht: ['pwofesè', 'klas', 'edikasyon', 'leson', 'devwa', 'lekòl', 'etid', 'aprann'],
      fr: ['tuteur', 'professeur', 'cours', 'leçons', 'éducation', 'école', 'apprentissage'],
    },
  },
  {
    slug: 'contractor', name_en: 'Contractor', icon: '🏗️', is_active: true, sort_order: 16,
    keywords: {
      en: ['contractor', 'construction', 'renovation', 'building', 'remodeling', 'handyman', 'repairs'],
      ht: ['kontraktè', 'konstriksyon', 'renovasyon', 'bati', 'reparasyon kay', 'travay kay'],
      fr: ['entrepreneur', 'construction', 'rénovation', 'bâtiment', 'travaux', 'réparations'],
    },
  },
  {
    slug: 'grocery', name_en: 'Grocery Delivery', icon: '🛒', is_active: true, sort_order: 17,
    keywords: {
      en: ['grocery', 'groceries', 'delivery', 'food delivery', 'supermarket', 'provisions', 'market'],
      ht: ['makèt', 'pwovizyon', 'livrezon', 'manje lakay', 'komisyon', 'boutik'],
      fr: ['épicerie', 'courses', 'livraison', 'supermarché', 'provisions', 'marché'],
    },
  },
  {
    slug: 'medical', name_en: 'Medical / Health', icon: '🏥', is_active: true, sort_order: 18,
    keywords: {
      en: ['medical', 'health', 'doctor', 'clinic', 'nurse', 'pharmacy', 'healthcare', 'dentist', 'hospital'],
      ht: ['medikal', 'sante', 'doktè', 'klinik', 'enfimyè', 'famasi', 'swen sante', 'dantis', 'lopital'],
      fr: ['médical', 'santé', 'médecin', 'clinique', 'infirmier', 'pharmacie', 'soins', 'dentiste'],
    },
  },
  {
    slug: 'other', name_en: 'Other', icon: '🔹', is_active: true, sort_order: 19,
    keywords: {
      en: ['other', 'miscellaneous', 'general', 'services', 'misc'],
      ht: ['lòt', 'jeneral', 'sèvis', 'lòt bagay'],
      fr: ['autre', 'divers', 'général', 'services', 'miscellaneous'],
    },
  },
];

async function syncCategories() {
  console.log('[sync-categories] Starting...');

  // Normalize all keywords before upserting so DB stores pre-normalized values.
  // This ensures resolveCategory() cache matches work with/without diacritics.
  const rows = CATEGORIES.map(c => {
    const keywords = {};
    for (const [lang, kws] of Object.entries(c.keywords || {})) {
      keywords[lang] = [...new Set(kws.map(normalize))]; // normalize + dedupe
    }
    return {
      slug:       c.slug,
      name_en:    c.name_en,
      name_ht:    c.name_ht,
      name_fr:    c.name_fr,
      icon:       c.icon,
      is_active:  c.is_active,
      sort_order: c.sort_order,
      keywords,
    };
  });

  const { error } = await supabase
    .from('service_categories')
    .upsert(rows, { onConflict: 'slug' });

  if (error) {
    console.error('[sync-categories] FAILED:', error.message);
    process.exit(1); // Abort deploy if sync fails
  }

  console.log(`[sync-categories] Synced ${rows.length} categories OK`);
}

syncCategories();
