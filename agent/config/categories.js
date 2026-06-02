'use strict';

// ============================================================
// BAZ — CATEGORIES
// Single source of truth for all categories.
// Synced to Supabase on every deploy via prestart.
// ============================================================

// ── MODE → HANDLER MAPPING ───────────────────────────────────
const MODE_HANDLERS = {
  find:  'find',
  buy:   'vitrin_buy',
  sell:  'vitrin_sell',
  order: 'vitrin_order',
};

// ── MODE LABELS ───────────────────────────────────────────────
const MODE_LABELS = {
  find:  { en: 'Find',  ht: 'Jwenn',   fr: 'Trouver' },
  buy:   { en: 'Buy',   ht: 'Achte',   fr: 'Acheter'  },
  sell:  { en: 'Sell',  ht: 'Vann',    fr: 'Vendre'   },
  order: { en: 'Order', ht: 'Kòmande', fr: 'Commander' },
};

// ── CATEGORIES ────────────────────────────────────────────────
// type:
//   'service'  — directory only (find)
//   'product'  — Vitrin only (buy/sell)
//   'hybrid'   — both directory and Vitrin
//
// modes: which flows are available for this category
// keywords: words that trigger this category in detectTopic

const categories = [

  // ── SERVICE CATEGORIES ──────────────────────────────────────

  {
    slug: 'plumber', type: 'service', modes: ['find'],
    icon: '🔧', sort_order: 1, is_active: true,
    name: { en: 'Plumber', ht: 'Plonbye', fr: 'Plombier' },
    description: {
      en: 'Plumbers and pipe repair services',
      ht: 'Plonbye ak sèvis reparasyon tuyò',
      fr: 'Plombiers et services de réparation de tuyaux',
    },
    keywords: {
      en: ['plumber', 'plumbing', 'pipe', 'leak', 'drain', 'water repair'],
      ht: ['plonbye', 'tuyò', 'dlo', 'fuites', 'plombri'],
      fr: ['plombier', 'plomberie', 'tuyau', 'fuite', 'canalisation'],
    },
  },

  {
    slug: 'electrician', type: 'service', modes: ['find'],
    icon: '⚡', sort_order: 2, is_active: true,
    name: { en: 'Electrician', ht: 'Elektrisyen', fr: 'Électricien' },
    description: {
      en: 'Electricians and electrical repair',
      ht: 'Elektrisyen ak reparasyon elektrik',
      fr: 'Électriciens et réparations électriques',
    },
    keywords: {
      en: ['electrician', 'electrical', 'electric', 'wiring', 'power', 'outlet'],
      ht: ['elektrisyen', 'elektrik', 'kouran', 'fil', 'lumyè'],
      fr: ['électricien', 'électrique', 'électricité', 'câblage', 'courant'],
    },
  },

  {
    slug: 'driver', type: 'service', modes: ['find'],
    icon: '🚗', sort_order: 3, is_active: true,
    name: { en: 'Driver', ht: 'Chofè', fr: 'Chauffeur' },
    description: {
      en: 'Drivers, car services, and transportation',
      ht: 'Chofè, sèvis vwati, ak transpò',
      fr: 'Chauffeurs, services de voiture et transport',
    },
    keywords: {
      en: ['driver', 'car service', 'taxi', 'transport', 'ride', 'chauffeur', 'airport'],
      ht: ['chofè', 'transpò', 'vwati', 'taksi', 'lestasyon'],
      fr: ['chauffeur', 'transport', 'voiture', 'taxi', 'aéroport'],
    },
  },

  {
    slug: 'tutor', type: 'service', modes: ['find'],
    icon: '📚', sort_order: 4, is_active: true,
    name: { en: 'Tutor', ht: 'Pwofesè', fr: 'Tuteur' },
    description: {
      en: 'Tutors, teachers, and educational services',
      ht: 'Pwofesè, ansegnèt, ak sèvis edikasyon',
      fr: 'Tuteurs, enseignants et services éducatifs',
    },
    keywords: {
      en: ['tutor', 'teacher', 'education', 'school', 'lesson', 'learning', 'homework', 'class'],
      ht: ['pwofesè', 'lekòl', 'kou', 'edikasyon', 'devwa', 'aprann'],
      fr: ['tuteur', 'professeur', 'école', 'cours', 'éducation', 'leçon'],
    },
  },

  {
    slug: 'contractor', type: 'service', modes: ['find'],
    icon: '🏗️', sort_order: 5, is_active: true,
    name: { en: 'Contractor', ht: 'Kontraktè', fr: 'Entrepreneur' },
    description: {
      en: 'General contractors and construction services',
      ht: 'Kontraktè jeneral ak sèvis konstriksyon',
      fr: 'Entrepreneurs généraux et services de construction',
    },
    keywords: {
      en: ['contractor', 'construction', 'builder', 'renovation', 'remodel', 'repair home', 'handyman'],
      ht: ['kontraktè', 'konstriksyon', 'reparasyon kay', 'renovasyon', 'maçon'],
      fr: ['entrepreneur', 'construction', 'rénovation', 'maçon', 'bâtisseur'],
    },
  },

  {
    slug: 'cook', type: 'service', modes: ['find'],
    icon: '👨‍🍳', sort_order: 6, is_active: true,
    name: { en: 'Cook / Catering', ht: 'Kizinyè', fr: 'Cuisinier / Traiteur' },
    description: {
      en: 'Private cooks, chefs, and catering services',
      ht: 'Kizinyè prive, chèf, ak sèvis trètè',
      fr: 'Cuisiniers privés, chefs et services traiteur',
    },
    keywords: {
      en: ['cook', 'catering', 'chef', 'private chef', 'event food', 'food service'],
      ht: ['kizinyè', 'trètè', 'chèf', 'manje pou evènman'],
      fr: ['cuisinier', 'traiteur', 'chef', 'cuisine privée'],
    },
  },

  {
    slug: 'cleaner', type: 'service', modes: ['find'],
    icon: '🧹', sort_order: 8, is_active: true,
    name: { en: 'Cleaning', ht: 'Netwayaj', fr: 'Nettoyage' },
    description: {
      en: 'House cleaning and janitorial services',
      ht: 'Netwayaj kay ak sèvis janitoryal',
      fr: 'Nettoyage de maison et services de conciergerie',
    },
    keywords: {
      en: ['cleaning', 'cleaner', 'housekeeping', 'maid', 'janitorial', 'sweep', 'mop'],
      ht: ['netwayaj', 'fè kay pwòp', 'bale', 'mòp'],
      fr: ['nettoyage', 'ménage', 'femme de ménage', 'conciergerie'],
    },
  },

  {
    slug: 'mechanic', type: 'service', modes: ['find'],
    icon: '🔩', sort_order: 9, is_active: true,
    name: { en: 'Mechanic', ht: 'Mekanisyen', fr: 'Mécanicien' },
    description: {
      en: 'Auto mechanics and vehicle repair',
      ht: 'Mekanisyen otomobil ak reparasyon veyikil',
      fr: 'Mécaniciens automobiles et réparation de véhicules',
    },
    keywords: {
      en: ['mechanic', 'auto repair', 'car repair', 'garage', 'oil change', 'brake', 'tire'],
      ht: ['mekanisyen', 'reparasyon machin', 'garaj', 'lwil'],
      fr: ['mécanicien', 'réparation auto', 'garage', 'vidange'],
    },
  },

  {
    slug: 'medical', type: 'service', modes: ['find'],
    icon: '🏥', sort_order: 11, is_active: true,
    name: { en: 'Medical', ht: 'Medikal', fr: 'Médical' },
    description: {
      en: 'Doctors, clinics, and health services',
      ht: 'Doktè, klinik, ak sèvis sante',
      fr: 'Médecins, cliniques et services de santé',
    },
    keywords: {
      en: ['doctor', 'medical', 'clinic', 'health', 'hospital', 'nurse', 'pharmacy', 'dentist', 'therapy'],
      ht: ['doktè', 'medikal', 'klinik', 'sante', 'enfimyè', 'famasi', 'dantis'],
      fr: ['médecin', 'clinique', 'santé', 'hôpital', 'infirmière', 'pharmacie'],
    },
  },

  // ── HYBRID CATEGORIES ────────────────────────────────────────

  {
    slug: 'restaurant', type: 'hybrid', modes: ['find'],
    icon: '🍽️', sort_order: 10, is_active: true,
    name: { en: 'Restaurant', ht: 'Restoran', fr: 'Restaurant' },
    description: {
      en: 'Restaurants and Haitian food',
      ht: 'Restoran ak manje ayisyen',
      fr: 'Restaurants et cuisine haïtienne',
    },
    keywords: {
      en: ['restaurant', 'food', 'eat', 'dining', 'meal', 'lunch', 'dinner', 'breakfast', 'takeout', 'cuisine', 'haitian food'],
      ht: ['restoran', 'manje', 'bwè', 'kafe', 'kizin', 'griyo', 'diri', 'poul'],
      fr: ['restaurant', 'manger', 'repas', 'cuisine', 'nourriture', 'déjeuner', 'dîner'],
    },
  },

  {
    slug: 'grocery', type: 'hybrid', modes: ['find'],
    icon: '🛒', sort_order: 20, is_active: true,
    name: { en: 'Grocery', ht: 'Komisyon', fr: 'Épicerie' },
    description: {
      en: 'Grocery stores and Haitian food markets',
      ht: 'Magazen komisyon ak mache manje ayisyen',
      fr: 'Épiceries et marchés alimentaires haïtiens',
    },
    keywords: {
      en: ['grocery', 'supermarket', 'market', 'provisions', 'haitian market', 'food store'],
      ht: ['komisyon', 'mache', 'magazen', 'pwovizyon', 'manje an gwo'],
      fr: ['épicerie', 'supermarché', 'marché', 'provisions'],
    },
  },

  {
    slug: 'hair_beauty', type: 'hybrid', modes: ['find', 'buy', 'sell'],
    icon: '💇', sort_order: 21, is_active: true,
    name: { en: 'Hair & Beauty', ht: 'Cheve ak Bote', fr: 'Cheveux & Beauté' },
    description: {
      en: 'Hair salons, beauty products, and personal care',
      ht: 'Salon cheve, pwodui bote, ak swen pèsonèl',
      fr: 'Salons de coiffure, produits de beauté et soins personnels',
    },
    keywords: {
      en: ['hair', 'beauty', 'salon', 'barber', 'nails', 'braids', 'locs', 'wig', 'extensions', 'stylist'],
      ht: ['cheve', 'bote', 'salon', 'kwafiè', 'zong', 'tres', 'pèwik'],
      fr: ['cheveux', 'beauté', 'salon', 'coiffure', 'ongles', 'tresses', 'perruque'],
    },
  },

  {
    slug: 'fashion', type: 'hybrid', modes: ['find', 'buy', 'sell'],
    icon: '👗', sort_order: 22, is_active: true,
    name: { en: 'Fashion & Clothing', ht: 'Rad ak Mòd', fr: 'Mode & Vêtements' },
    description: {
      en: 'Clothing, fashion, and accessories',
      ht: 'Rad, mòd, ak akseswa',
      fr: 'Vêtements, mode et accessoires',
    },
    keywords: {
      en: ['fashion', 'clothing', 'clothes', 'dress', 'outfit', 'boutique', 'apparel', 'shirt', 'shoes'],
      ht: ['rad', 'mòd', 'abiman', 'chemiz', 'boutik', 'soulye'],
      fr: ['mode', 'vêtements', 'robe', 'boutique', 'tenue', 'chaussures'],
    },
  },

  // ── PRODUCT CATEGORIES (Vitrin only) ─────────────────────────
  // All modes are stubs for now — filtered out of menus
  // Users see "coming soon" message for these categories

  {
    slug: 'food_products', type: 'product', modes: ['buy', 'sell'],
    icon: '🫙', sort_order: 23, is_active: true,
    name: { en: 'Food Products', ht: 'Pwodui Manje', fr: 'Produits Alimentaires' },
    description: {
      en: 'Haitian sauces, spices, and packaged food products',
      ht: 'Sòs, epis, ak pwodui manje ayisyen',
      fr: 'Sauces, épices et produits alimentaires haïtiens',
    },
    keywords: {
      en: ['food products', 'haitian sauce', 'epis', 'seasoning', 'spice', 'kondiman', 'haitian spices', 'pikliz'],
      ht: ['pwodui manje', 'sòs', 'epis', 'kondiman', 'piman', 'pikliz'],
      fr: ['produits alimentaires', 'sauce haïtienne', 'épices', 'condiment'],
    },
  },

  {
    slug: 'crafts', type: 'product', modes: ['buy', 'sell'],
    icon: '🧺', sort_order: 30, is_active: true,
    name: { en: 'Crafts & Handmade', ht: 'Atizana', fr: 'Artisanat' },
    description: {
      en: 'Haitian crafts, handmade goods, and artisan products',
      ht: 'Atizana ayisyen, pwodui fèt alamen',
      fr: 'Artisanat haïtien et produits faits main',
    },
    keywords: {
      en: ['crafts', 'handmade', 'artisan', 'basket', 'haitian art', 'woven'],
      ht: ['atizana', 'fèt alamen', 'panye', 'atizay'],
      fr: ['artisanat', 'fait main', 'panier', 'artisan'],
    },
  },

  {
    slug: 'art', type: 'product', modes: ['buy', 'sell'],
    icon: '🎨', sort_order: 31, is_active: true,
    name: { en: 'Art & Paintings', ht: 'Atizay ak Penti', fr: 'Art & Peintures' },
    description: {
      en: 'Haitian paintings, sculptures, and artwork',
      ht: 'Penti, eskilti, ak travay atistik ayisyen',
      fr: 'Peintures, sculptures et œuvres d\'art haïtiennes',
    },
    keywords: {
      en: ['art', 'painting', 'artwork', 'haitian art', 'sculpture', 'canvas', 'artist'],
      ht: ['penti', 'atizay', 'eskilti', 'atisan', 'tablo'],
      fr: ['art', 'peinture', 'sculpture', 'tableau', 'artiste'],
    },
  },

  {
    slug: 'jewelry', type: 'product', modes: ['buy', 'sell'],
    icon: '💎', sort_order: 32, is_active: true,
    name: { en: 'Jewelry', ht: 'Bijou ak Akseswa', fr: 'Bijoux & Accessoires' },
    description: {
      en: 'Haitian jewelry, accessories, and beads',
      ht: 'Bijou ayisyen, akseswa, ak grenn',
      fr: 'Bijoux haïtiens, accessoires et perles',
    },
    keywords: {
      en: ['jewelry', 'jewellery', 'necklace', 'bracelet', 'earring', 'ring', 'beads', 'accessory'],
      ht: ['bijou', 'kolye', 'braslè', 'zanno', 'bag', 'grenn'],
      fr: ['bijoux', 'collier', 'bracelet', 'boucles', 'bague', 'perles'],
    },
  },

  {
    slug: 'home_decor', type: 'product', modes: ['buy', 'sell'],
    icon: '🏠', sort_order: 34, is_active: true,
    name: { en: 'Home & Decor', ht: 'Kay ak Dekorasyon', fr: 'Maison & Décoration' },
    description: {
      en: 'Home decor, furniture, and household items',
      ht: 'Dekorasyon kay, mèb, ak atik kay',
      fr: 'Décoration intérieure, meubles et articles ménagers',
    },
    keywords: {
      en: ['home decor', 'furniture', 'decoration', 'interior', 'household', 'haitian decor'],
      ht: ['dekorasyon', 'mèb', 'atik kay', 'orneman'],
      fr: ['décoration', 'mobilier', 'meuble', 'intérieur', 'maison'],
    },
  },

  {
    slug: 'other', type: 'service', modes: ['find'],
    icon: '📋', sort_order: 99, is_active: true,
    name: { en: 'Other', ht: 'Lòt', fr: 'Autre' },
    description: {
      en: 'Other services and businesses',
      ht: 'Lòt sèvis ak biznis',
      fr: 'Autres services et entreprises',
    },
    keywords: {
      en: ['other', 'service', 'business', 'help', 'find'],
      ht: ['lòt', 'sèvis', 'biznis', 'ede'],
      fr: ['autre', 'service', 'entreprise', 'aide'],
    },
  },

];

// ── HELPERS ───────────────────────────────────────────────────
const active           = () => categories.filter(c => c.is_active);
const serviceCategories = () => categories.filter(c => c.is_active && c.type !== 'product');
const productCategories = () => categories.filter(c => c.is_active && c.type !== 'service');
const slugs            = () => active().map(c => c.slug);
const bySlug           = slug => categories.find(c => c.slug === slug) || null;

// ── MODE OPTIONS ──────────────────────────────────────────────
// Returns array of { num, mode, label, handler } for a category.
// handler maps to the HANDLERS object in router.js.
function getModeOptions(slug, lang = 'en') {
  const cat = bySlug(slug);
  if (!cat) return [];
  return cat.modes.map((mode, i) => ({
    num:     i + 1,
    mode,
    label:   `${MODE_LABELS[mode]?.[lang] || mode} ${cat.name[lang] || cat.name.en}`,
    handler: MODE_HANDLERS[mode] || mode,
  }));
}

function supportsMode(slug, mode) {
  const cat = bySlug(slug);
  return cat ? cat.modes.includes(mode) : false;
}

// ── BUILD KEYWORD PROMPT ──────────────────────────────────────
// Generates the keyword map injected into detectTopic system prompt.
let _keywordCache = null;
function buildKeywordPrompt() {
  if (_keywordCache) return _keywordCache;
  const lines = active().map(cat => {
    const all = [
      ...(cat.keywords.en || []),
      ...(cat.keywords.ht || []),
      ...(cat.keywords.fr || []),
    ].filter((v, i, a) => a.indexOf(v) === i);
    return `${cat.slug}: ${all.join(', ')}`;
  });
  _keywordCache = lines.join('\n');
  return _keywordCache;
}

module.exports = {
  categories,
  active,
  serviceCategories,
  productCategories,
  slugs,
  bySlug,
  getModeOptions,
  supportsMode,
  buildKeywordPrompt,
  MODE_LABELS,
  MODE_HANDLERS,
};
