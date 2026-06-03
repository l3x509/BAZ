'use strict';

// ============================================================
// BAZ — CATEGORIES (v3 — directory only, no Vitrin)
// Single source of truth for all categories.
// Synced to Supabase on every deploy via prestart.
// ============================================================

const MODE_HANDLERS = {
  find: 'find',
};

const MODE_LABELS = {
  find: { en: 'Find', ht: 'Jwenn', fr: 'Trouver' },
};

const categories = [

  // ── FEATURED ON MAIN MENU ────────────────────────────────────

  {
    slug: 'restaurant', type: 'service', modes: ['find'],
    icon: '🍽️', sort_order: 1, is_active: true,
    name: { en: 'Restaurant', ht: 'Restoran', fr: 'Restaurant' },
    description: { en: 'Restaurants and Haitian food', ht: 'Restoran ak manje ayisyen', fr: 'Restaurants et cuisine haïtienne' },
    keywords: {
      en: ['restaurant', 'food', 'eat', 'dining', 'meal', 'lunch', 'dinner', 'breakfast', 'takeout', 'cuisine', 'haitian food'],
      ht: ['restoran', 'manje', 'bwè', 'kafe', 'kizin', 'griyo', 'diri', 'poul', 'lalo', 'soup joumou'],
      fr: ['restaurant', 'manger', 'repas', 'cuisine', 'nourriture', 'déjeuner', 'dîner'],
    },
  },

  {
    slug: 'hair_beauty', type: 'service', modes: ['find'],
    icon: '💇', sort_order: 2, is_active: true,
    name: { en: 'Hair & Beauty', ht: 'Cheve ak Bote', fr: 'Cheveux & Beauté' },
    description: { en: 'Hair salons, beauty products, and personal care', ht: 'Salon cheve, pwodui bote, ak swen pèsonèl', fr: 'Salons de coiffure, produits de beauté et soins personnels' },
    keywords: {
      en: ['hair', 'beauty', 'salon', 'barber', 'nails', 'braids', 'locs', 'wig', 'extensions', 'stylist'],
      ht: ['cheve', 'bote', 'salon', 'kwafiè', 'zong', 'tres', 'pèwik', 'trese cheve'],
      fr: ['cheveux', 'beauté', 'salon', 'coiffure', 'ongles', 'tresses', 'perruque'],
    },
  },

  {
    slug: 'legal', type: 'service', modes: ['find'],
    icon: '⚖️', sort_order: 3, is_active: true,
    name: { en: 'Legal & Immigration', ht: 'Legal ak Imigrasyon', fr: 'Juridique & Immigration' },
    description: { en: 'Immigration lawyers, legal aid, and advocacy', ht: 'Avoka imigrasyon, èd legal, ak defans', fr: 'Avocats immigration, aide juridique et défense' },
    keywords: {
      en: ['lawyer', 'attorney', 'immigration', 'legal', 'visa', 'green card', 'citizenship', 'deportation', 'legal aid', 'immigration lawyer'],
      ht: ['avoka', 'imigrasyon', 'legal', 'viza', 'kat vèt', 'sitwayènte', 'depòtasyon', 'èd legal', 'dwa imigrasyon'],
      fr: ['avocat', 'immigration', 'juridique', 'visa', 'carte verte', 'citoyenneté', 'aide juridique'],
    },
  },

  {
    slug: 'childcare', type: 'service', modes: ['find'],
    icon: '👶', sort_order: 4, is_active: true,
    name: { en: 'Childcare', ht: 'Gadri', fr: "Garde d'enfants" },
    description: { en: 'Daycare, preschool, and childcare services', ht: 'Gadri, preskòl, ak sèvis pou timoun', fr: "Crèche, préscolaire et services pour enfants" },
    keywords: {
      en: ['childcare', 'daycare', 'preschool', 'babysitter', 'after school', 'kids', 'child', 'nursery'],
      ht: ['gadri', 'swen timoun', 'preskòl', 'gad timoun', 'ti moun', 'timoun', 'jaden timoun'],
      fr: ['garde enfants', 'crèche', 'garderie', 'préscolaire', 'babysitter', 'enfants'],
    },
  },

  {
    slug: 'shipping', type: 'service', modes: ['find'],
    icon: '📦', sort_order: 5, is_active: true,
    name: { en: 'Shipping to Haiti', ht: 'Kago pou Ayiti', fr: 'Expédition vers Haïti' },
    description: { en: 'Cargo shipping and freight forwarding to Haiti', ht: 'Kago ak ekspedisyon machandiz pou Ayiti', fr: 'Envoi de colis et fret vers Haïti' },
    keywords: {
      en: ['shipping', 'cargo', 'freight', 'send package', 'barrel', 'haiti shipping', 'ship to haiti'],
      ht: ['kago', 'barèl', 'voye kolis', 'ekspedisyon', 'machandiz', 'fret', 'voye pake'],
      fr: ['expédition', 'cargo', 'colis', 'fret', 'barrel', 'envoi haïti'],
    },
  },

  {
    slug: 'tax_notary', type: 'service', modes: ['find'],
    icon: '🧾', sort_order: 6, is_active: true,
    name: { en: 'Tax & Notary', ht: 'Taks ak Notè', fr: 'Impôts & Notaire' },
    description: { en: 'Tax preparation, notary, and business services', ht: 'Preparasyon taks, notè, ak sèvis biznis', fr: 'Préparation fiscale, notaire et services aux entreprises' },
    keywords: {
      en: ['tax', 'taxes', 'notary', 'tax preparation', 'tax prep', 'business services', 'filing', 'tax return'],
      ht: ['taks', 'notè', 'deklarasyon taks', 'sèvis biznis', 'preparasyon taks', 'deklarasyon'],
      fr: ['impôts', 'notaire', 'déclaration fiscale', 'services entreprises', 'déclaration impôts'],
    },
  },

  {
    // Services umbrella — shows submenu of individual service workers
    // Individual slugs (plumber, electrician, etc.) still exist for direct routing
    slug: 'services', type: 'service', modes: ['find'],
    icon: '🔧', sort_order: 7, is_active: true,
    name: { en: 'Services', ht: 'Sèvis', fr: 'Services' },
    description: { en: 'Plumber, electrician, mechanic, cleaner and more', ht: 'Plonbye, elektrisyen, mekanisyen, netwayaj ak plis', fr: 'Plombier, électricien, mécanicien, nettoyage et plus' },
    keywords: {
      en: ['service', 'services', 'repair', 'hire', 'fix', 'home service'],
      ht: ['sèvis', 'reparasyon', 'engaje', 'fiks'],
      fr: ['service', 'services', 'réparation', 'embaucher'],
    },
  },

  // ── AVAILABLE VIA "TOUT" / DIRECT SEARCH — NOT ON MAIN MENU ─

  {
    slug: 'grocery', type: 'service', modes: ['find'],
    icon: '🛒', sort_order: 8, is_active: true,
    name: { en: 'Grocery', ht: 'Komisyon', fr: 'Épicerie' },
    description: { en: 'Grocery stores and Haitian food markets', ht: 'Magazen komisyon ak mache manje ayisyen', fr: 'Épiceries et marchés alimentaires haïtiens' },
    keywords: {
      en: ['grocery', 'supermarket', 'market', 'provisions', 'haitian market', 'food store'],
      ht: ['komisyon', 'mache', 'magazen manje', 'pwovizyon'],
      fr: ['épicerie', 'supermarché', 'marché', 'provisions'],
    },
  },

  {
    slug: 'fashion', type: 'service', modes: ['find'],
    icon: '👗', sort_order: 9, is_active: true,
    name: { en: 'Fashion & Clothing', ht: 'Rad ak Mòd', fr: 'Mode & Vêtements' },
    description: { en: 'Clothing, fashion, and accessories', ht: 'Rad, mòd, ak akseswa', fr: 'Vêtements, mode et accessoires' },
    keywords: {
      en: ['fashion', 'clothing', 'clothes', 'dress', 'outfit', 'boutique', 'apparel', 'shirt', 'shoes'],
      ht: ['rad', 'mòd', 'abiman', 'chemiz', 'boutik', 'soulye'],
      fr: ['mode', 'vêtements', 'robe', 'boutique', 'tenue', 'chaussures'],
    },
  },

  {
    slug: 'church', type: 'service', modes: ['find'],
    icon: '⛪', sort_order: 10, is_active: true,
    name: { en: 'Church & Community', ht: 'Legliz ak Kominote', fr: 'Église & Communauté' },
    description: { en: 'Haitian churches and community organizations', ht: 'Legliz ak òganizasyon kominote ayisyen', fr: 'Églises haïtiennes et organisations communautaires' },
    keywords: {
      en: ['church', 'congregation', 'pastor', 'worship', 'ministry', 'community', 'haitian church'],
      ht: ['legliz', 'kominote', 'kongregasyon', 'pastè', 'adorasyon', 'ministè', 'lapriyè'],
      fr: ['église', 'communauté', 'congrégation', 'pasteur', 'culte', 'ministère'],
    },
  },

  // ── INDIVIDUAL SERVICE WORKERS — accessed via Services submenu ─
  // These slugs still exist for direct keyword routing (e.g. "plonbye Boston")
  // but are not listed on the main menu.

  {
    slug: 'plumber', type: 'service', modes: ['find'],
    icon: '🔧', sort_order: 20, is_active: true,
    name: { en: 'Plumber', ht: 'Plonbye', fr: 'Plombier' },
    description: { en: 'Plumbers and pipe repair services', ht: 'Plonbye ak sèvis reparasyon tuyò', fr: 'Plombiers et services de réparation de tuyaux' },
    keywords: {
      en: ['plumber', 'plumbing', 'pipe', 'leak', 'drain', 'water repair'],
      ht: ['plonbye', 'tiyo', 'tuyò', 'dlo koule', 'plombri', 'fuit dlo'],
      fr: ['plombier', 'plomberie', 'tuyau', 'fuite', 'canalisation'],
    },
  },

  {
    slug: 'electrician', type: 'service', modes: ['find'],
    icon: '⚡', sort_order: 21, is_active: true,
    name: { en: 'Electrician', ht: 'Elektrisyen', fr: 'Électricien' },
    description: { en: 'Electricians and electrical repair', ht: 'Elektrisyen ak reparasyon elektrik', fr: 'Électriciens et réparations électriques' },
    keywords: {
      en: ['electrician', 'electrical', 'wiring', 'power outlet', 'circuit'],
      ht: ['elektrisyen', 'elektrik', 'kouran', 'fil elektrik', 'lumyè'],
      fr: ['électricien', 'électrique', 'électricité', 'câblage', 'courant'],
    },
  },

  {
    slug: 'contractor', type: 'service', modes: ['find'],
    icon: '🏗️', sort_order: 22, is_active: true,
    name: { en: 'Contractor', ht: 'Kontraktè', fr: 'Entrepreneur' },
    description: { en: 'General contractors and construction services', ht: 'Kontraktè jeneral ak sèvis konstriksyon', fr: 'Entrepreneurs généraux et services de construction' },
    keywords: {
      en: ['contractor', 'construction', 'builder', 'renovation', 'remodel', 'handyman'],
      ht: ['kontraktè', 'konstriksyon', 'reparasyon kay', 'renovasyon', 'maçon'],
      fr: ['entrepreneur', 'construction', 'rénovation', 'maçon', 'bâtisseur'],
    },
  },

  {
    slug: 'mechanic', type: 'service', modes: ['find'],
    icon: '🔩', sort_order: 23, is_active: true,
    name: { en: 'Mechanic', ht: 'Mekanisyen', fr: 'Mécanicien' },
    description: { en: 'Auto mechanics and vehicle repair', ht: 'Mekanisyen otomobil ak reparasyon veyikil', fr: 'Mécaniciens automobiles et réparation de véhicules' },
    keywords: {
      en: ['mechanic', 'auto repair', 'car repair', 'oil change', 'brake', 'tire'],
      ht: ['mekanisyen', 'reparasyon machin', 'garaj', 'lwil machin'],
      fr: ['mécanicien', 'réparation auto', 'garage', 'vidange'],
    },
  },

  {
    slug: 'cleaner', type: 'service', modes: ['find'],
    icon: '🧹', sort_order: 24, is_active: true,
    name: { en: 'Cleaning', ht: 'Netwayaj', fr: 'Nettoyage' },
    description: { en: 'House cleaning and janitorial services', ht: 'Netwayaj kay ak sèvis janitoryal', fr: 'Nettoyage de maison et services de conciergerie' },
    keywords: {
      en: ['cleaning', 'house cleaning', 'housekeeping', 'maid', 'janitorial'],
      ht: ['netwayaj', 'fè kay pwòp', 'bale kay'],
      fr: ['nettoyage', 'ménage', 'femme de ménage', 'conciergerie'],
    },
  },

  {
    slug: 'driver', type: 'service', modes: ['find'],
    icon: '🚗', sort_order: 25, is_active: true,
    name: { en: 'Driver / Transport', ht: 'Transpò', fr: 'Transport' },
    description: { en: 'Drivers, car services, and transportation', ht: 'Chofè, sèvis vwati, ak transpò', fr: 'Chauffeurs, services de voiture et transport' },
    keywords: {
      en: ['driver', 'car service', 'taxi', 'ride', 'chauffeur', 'airport ride', 'transport'],
      ht: ['chofè', 'transpò', 'vwati', 'taksi', 'machin'],
      fr: ['chauffeur', 'transport', 'voiture', 'taxi', 'aéroport'],
    },
  },

  {
    slug: 'cook', type: 'service', modes: ['find'],
    icon: '👨‍🍳', sort_order: 26, is_active: true,
    name: { en: 'Cook / Catering', ht: 'Kizinyè', fr: 'Cuisinier / Traiteur' },
    description: { en: 'Private cooks, chefs, and catering services', ht: 'Kizinyè prive, chèf, ak sèvis trètè', fr: 'Cuisiniers privés, chefs et services traiteur' },
    keywords: {
      en: ['catering', 'private chef', 'event catering', 'personal cook', 'cook for party', 'bakery'],
      ht: ['kizinyè prive', 'trètè', 'chèf', 'manje pou evènman', 'fè manje', 'boulanjri'],
      fr: ['cuisinier privé', 'traiteur', 'chef', 'cuisine privée', 'repas événement'],
    },
  },

  {
    slug: 'tutor', type: 'service', modes: ['find'],
    icon: '📚', sort_order: 27, is_active: true,
    name: { en: 'Tutor / School', ht: 'Pwofesè', fr: 'Tuteur' },
    description: { en: 'Tutors, teachers, and educational services', ht: 'Pwofesè, ansegnèt, ak sèvis edikasyon', fr: 'Tuteurs, enseignants et services éducatifs' },
    keywords: {
      en: ['tutor', 'teacher', 'lesson', 'homework help', 'after school', 'learning', 'school'],
      ht: ['pwofesè', 'lekòl', 'kou', 'devwa', 'aprann'],
      fr: ['tuteur', 'professeur', 'cours', 'éducation', 'leçon'],
    },
  },

  {
    slug: 'medical', type: 'service', modes: ['find'],
    icon: '🏥', sort_order: 28, is_active: true,
    name: { en: 'Medical', ht: 'Medikal', fr: 'Médical' },
    description: { en: 'Doctors, clinics, and health services', ht: 'Doktè, klinik, ak sèvis sante', fr: 'Médecins, cliniques et services de santé' },
    keywords: {
      en: ['doctor', 'medical', 'clinic', 'health', 'hospital', 'nurse', 'pharmacy', 'dentist', 'therapy'],
      ht: ['doktè', 'medikal', 'klinik', 'sante', 'enfimyè', 'famasi', 'dantis'],
      fr: ['médecin', 'clinique', 'santé', 'hôpital', 'infirmière', 'pharmacie'],
    },
  },

  {
    slug: 'real_estate', type: 'service', modes: ['find'],
    icon: '🏠', sort_order: 29, is_active: true,
    name: { en: 'Real Estate', ht: 'Imobilye', fr: 'Immobilier' },
    description: { en: 'Real estate agents and property services', ht: 'Ajan imobilye ak sèvis pwopriyete', fr: 'Agents immobiliers et services de propriété' },
    keywords: {
      en: ['real estate', 'realtor', 'house', 'property', 'apartment', 'rent', 'buy house'],
      ht: ['imobilye', 'ajan imobilye', 'kay', 'pwopriyete', 'lwaye', 'achte kay'],
      fr: ['immobilier', 'agent immobilier', 'maison', 'propriété', 'appartement', 'louer'],
    },
  },

  {
    slug: 'other', type: 'service', modes: ['find'],
    icon: '📋', sort_order: 99, is_active: true,
    name: { en: 'Other', ht: 'Lòt', fr: 'Autre' },
    description: { en: 'Other services and businesses', ht: 'Lòt sèvis ak biznis', fr: 'Autres services et entreprises' },
    keywords: {
      en: ['other', 'something else', 'not listed', 'different service'],
      ht: ['lòt', 'lòt bagay', 'pa nan lis'],
      fr: ['autre', 'autre chose', 'pas dans la liste'],
    },
  },

  // ── DEACTIVATED — Vitrin product categories (re-enable for Phase 2) ──
  { slug: 'food_products', type: 'product', modes: [], icon: '🫙', sort_order: 50, is_active: false, name: { en: 'Food Products', ht: 'Pwodui Manje', fr: 'Produits Alimentaires' }, description: { en: '', ht: '', fr: '' }, keywords: { en: [], ht: [], fr: [] } },
  { slug: 'crafts',        type: 'product', modes: [], icon: '🧺', sort_order: 51, is_active: false, name: { en: 'Crafts',        ht: 'Atizana',       fr: 'Artisanat'           }, description: { en: '', ht: '', fr: '' }, keywords: { en: [], ht: [], fr: [] } },
  { slug: 'art',           type: 'product', modes: [], icon: '🎨', sort_order: 52, is_active: false, name: { en: 'Art',           ht: 'Atizay',        fr: 'Art'                 }, description: { en: '', ht: '', fr: '' }, keywords: { en: [], ht: [], fr: [] } },
  { slug: 'jewelry',       type: 'product', modes: [], icon: '💎', sort_order: 53, is_active: false, name: { en: 'Jewelry',       ht: 'Bijou',         fr: 'Bijoux'              }, description: { en: '', ht: '', fr: '' }, keywords: { en: [], ht: [], fr: [] } },
  { slug: 'home_decor',    type: 'product', modes: [], icon: '🏡', sort_order: 54, is_active: false, name: { en: 'Home Decor',    ht: 'Dekorasyon',    fr: 'Décoration'          }, description: { en: '', ht: '', fr: '' }, keywords: { en: [], ht: [], fr: [] } },
];

// ── HELPERS ───────────────────────────────────────────────────
const active            = () => categories.filter(c => c.is_active);
const serviceCategories = () => categories.filter(c => c.is_active && c.type !== 'product');
const productCategories = () => categories.filter(c => c.is_active && c.type !== 'service');
const slugs             = () => active().map(c => c.slug);
const bySlug            = slug => categories.find(c => c.slug === slug) || null;

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

// Generates the keyword map injected into detectTopic system prompt.
// Cache is cleared on each Railway deploy (process restart).
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
