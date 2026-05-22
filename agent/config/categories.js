// ============================================================
// BAZ + VITRIN — CATEGORY CONFIG
// Single source of truth for all categories across:
//   - WhatsApp agent (intent detection, routing, mode options)
//   - Baz directory / find flow (service_categories table)
//   - Vitrin marketplace / buy+sell flow (vitrin_categories table)
//   - Website (via /api/categories endpoint)
//   - TwinZile (analytics + keyword mapping)
//
// CATEGORY TYPES:
//   service  → Baz directory only (find a plumber, doctor, driver)
//   product  → Vitrin marketplace only (buy/sell crafts, art, fashion)
//   hybrid   → Both directory AND marketplace (hair salon + hair products)
//
// MODES (what actions are available per category):
//   find     → Search Baz directory for a business/provider
//   buy      → Browse and purchase from Vitrin marketplace
//   sell     → List products on Vitrin as a vendor
//   order    → Place a food/delivery order (restaurant, grocery, cook)
//
// TO ADD A CATEGORY:
//   1. Add an entry below
//   2. Run: node agent/scripts/sync-categories.js
//   Done. Router, agent prompts, and DB all update automatically.
//
// ⚠️  CULTURAL NOTE (TwinZile protocol):
//   Keywords for crafts, art, jewelry, music, and food_products categories
//   were generated from general knowledge. Review and correct with direct
//   cultural knowledge before pushing to production.
// ============================================================

// ─────────────────────────────────────────────
// MODE LABELS
// Used by the router to generate WhatsApp option lists in any language.
// ─────────────────────────────────────────────

const MODE_LABELS = {
  find:  { en: 'Find',   ht: 'Jwenn',   fr: 'Trouver'   },
  buy:   { en: 'Buy',    ht: 'Achte',   fr: 'Acheter'   },
  sell:  { en: 'Sell',   ht: 'Vann',    fr: 'Vendre'    },
  order: { en: 'Order',  ht: 'Kòmande', fr: 'Commander' },
};

// Maps modes to agent handlers
const MODE_HANDLERS = {
  find:  'find',
  buy:   'vitrin_buy',
  sell:  'vitrin_sell',
  order: 'vitrin_order',
};

// ─────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────

const categories = [

  // ══ SERVICE CATEGORIES (Baz directory only) ══════════════

  {
    slug: 'plumber',
    type: 'service',
    modes: ['find'],
    icon: '🔧',
    sort_order: 1,
    is_active: true,
    name: { en: 'Plumber',      ht: 'Plonbye',     fr: 'Plombier'      },
    description: {
      en: 'Plumbing, pipe repair, and water system services',
      ht: 'Sèvis plonbri, reparasyon tiyo, ak sistèm dlo',
      fr: 'Services de plomberie, réparation de tuyaux et systèmes d\'eau',
    },
    keywords: {
      en: ['plumber', 'plumbing', 'pipe', 'water leak', 'faucet', 'toilet', 'drain', 'clog', 'sink'],
      ht: ['plonbye', 'dlo', 'tiyo', 'fuit dlo', 'robine', 'twalèt', 'egou', 'bouche'],
      fr: ['plombier', 'plomberie', 'tuyau', 'fuite', 'robinet', 'toilette', 'évier', 'bouché'],
    },
  },

  {
    slug: 'electrician',
    type: 'service',
    modes: ['find'],
    icon: '⚡',
    sort_order: 2,
    is_active: true,
    name: { en: 'Electrician',  ht: 'Elektrisyen', fr: 'Électricien'   },
    description: {
      en: 'Electrical installation, wiring, and power system repair',
      ht: 'Entèpozisyon elektrik, kablaj, ak reparasyon sistèm kouran',
      fr: 'Installation électrique, câblage et réparation de systèmes électriques',
    },
    keywords: {
      en: ['electrician', 'electrical', 'wiring', 'power', 'outlet', 'circuit', 'generator', 'lights'],
      ht: ['elektrisyen', 'kouran', 'limyè', 'priz', 'fil', 'jeneratè', 'disjonktè', 'elektrisite'],
      fr: ['électricien', 'électricité', 'câblage', 'courant', 'prise', 'disjoncteur', 'générateur'],
    },
  },

  {
    slug: 'driver',
    type: 'service',
    modes: ['find'],
    icon: '🚗',
    sort_order: 3,
    is_active: true,
    name: { en: 'Driver',       ht: 'Chofè',       fr: 'Chauffeur'     },
    description: {
      en: 'Transportation, taxi, and car service',
      ht: 'Transpò, taksi, ak sèvis machin',
      fr: 'Transport, taxi et service de voiture',
    },
    keywords: {
      en: ['driver', 'taxi', 'ride', 'transport', 'car service', 'pick up', 'airport', 'drop off'],
      ht: ['chofè', 'transpò', 'machin', 'taksi', 'mennen mwen', 'pote mwen', 'ayewopò'],
      fr: ['chauffeur', 'taxi', 'transport', 'voiture', 'aéroport', 'trajet', 'navette'],
    },
  },

  {
    slug: 'tutor',
    type: 'service',
    modes: ['find'],
    icon: '📚',
    sort_order: 4,
    is_active: true,
    name: { en: 'Tutor',        ht: 'Pwofesè',     fr: 'Tuteur'        },
    description: {
      en: 'Private tutoring, lessons, and academic support',
      ht: 'Kours prive, leson, ak sipò akademik',
      fr: 'Cours particuliers, leçons et soutien scolaire',
    },
    keywords: {
      en: ['tutor', 'teacher', 'lesson', 'homework', 'school', 'study', 'class', 'math', 'reading'],
      ht: ['pwofesè', 'leson', 'devwa', 'lekòl', 'etidye', 'klas', 'matematik', 'aprann'],
      fr: ['tuteur', 'professeur', 'leçon', 'cours', 'école', 'étudier', 'mathématiques', 'soutien'],
    },
  },

  {
    slug: 'contractor',
    type: 'service',
    modes: ['find'],
    icon: '🏗️',
    sort_order: 5,
    is_active: true,
    name: { en: 'Contractor',   ht: 'Kontraktè',   fr: 'Entrepreneur'  },
    description: {
      en: 'Construction, renovation, and building repair',
      ht: 'Konstriksyon, renovasyon, ak reparasyon batiman',
      fr: 'Construction, rénovation et réparation de bâtiments',
    },
    keywords: {
      en: ['contractor', 'construction', 'build', 'renovation', 'repair', 'house', 'roof', 'mason'],
      ht: ['kontraktè', 'konstriksyon', 'renovasyon', 'kay', 'bati', 'reparasyon', 'siman', 'mason'],
      fr: ['entrepreneur', 'construction', 'rénovation', 'bâtiment', 'maison', 'réparer', 'maçon'],
    },
  },

  {
    slug: 'cook',
    type: 'service',
    modes: ['find', 'order'],
    icon: '👨‍🍳',
    sort_order: 6,
    is_active: true,
    name: { en: 'Cook / Chef',  ht: 'Kizinyè',     fr: 'Cuisinier'     },
    description: {
      en: 'Cooking, catering, and meal preparation services',
      ht: 'Kwit manje, traitè, ak preparasyon repa',
      fr: 'Cuisine, traiteur et préparation de repas',
    },
    keywords: {
      en: ['cook', 'chef', 'catering', 'meal', 'food prep', 'event cooking', 'private chef', 'dinner'],
      ht: ['kizinyè', 'kwit manje', 'traitè', 'repa', 'manje evènman', 'fèt', 'preparasyon'],
      fr: ['cuisinier', 'chef', 'traiteur', 'repas', 'cuisine', 'événement', 'dîner', 'festin'],
    },
  },

  {
    slug: 'cleaner',
    type: 'service',
    modes: ['find'],
    icon: '🧹',
    sort_order: 8,
    is_active: true,
    name: { en: 'Cleaning',     ht: 'Netwayaj',    fr: 'Nettoyage'     },
    description: {
      en: 'House and office cleaning services',
      ht: 'Netwayaj kay ak biwo',
      fr: 'Services de nettoyage de maisons et bureaux',
    },
    keywords: {
      en: ['cleaner', 'cleaning', 'housekeeping', 'maid', 'sweep', 'mop', 'janitor', 'tidy'],
      ht: ['netwayaj', 'mennaj', 'balye', 'mòp', 'pwòp', 'lave', 'ranje'],
      fr: ['nettoyage', 'ménage', 'femme de ménage', 'balayer', 'propre', 'laver', 'ranger'],
    },
  },

  {
    slug: 'mechanic',
    type: 'service',
    modes: ['find'],
    icon: '🔩',
    sort_order: 9,
    is_active: true,
    name: { en: 'Mechanic',     ht: 'Mekanisyen',  fr: 'Mécanicien'    },
    description: {
      en: 'Car and vehicle repair services',
      ht: 'Reparasyon machin ak veyikil',
      fr: 'Services de réparation automobile',
    },
    keywords: {
      en: ['mechanic', 'car repair', 'auto', 'engine', 'tire', 'oil change', 'brake', 'garage'],
      ht: ['mekanisyen', 'machin', 'motè', 'kawotchou', 'lwil', 'fren', 'garaj'],
      fr: ['mécanicien', 'voiture', 'moteur', 'pneu', 'vidange', 'frein', 'garage'],
    },
  },

  {
    slug: 'restaurant',
    type: 'service',
    modes: ['find', 'order'],
    icon: '🍽️',
    sort_order: 10,
    is_active: true,
    name: { en: 'Restaurant',   ht: 'Restoran',    fr: 'Restaurant'    },
    description: {
      en: 'Restaurants, food spots, and takeout',
      ht: 'Restoran, kote manje, ak manje pou pote',
      fr: 'Restaurants, snacks et plats à emporter',
    },
    keywords: {
      en: ['restaurant', 'food', 'eat', 'dine', 'takeout', 'delivery', 'lunch', 'dinner', 'griyo'],
      ht: ['restoran', 'manje', 'manje deyò', 'kòmande manje', 'griyo', 'soup joumou', 'diri'],
      fr: ['restaurant', 'manger', 'cuisine', 'livraison', 'commander', 'déjeuner', 'dîner'],
    },
  },

  {
    slug: 'medical',
    type: 'service',
    modes: ['find'],
    icon: '🏥',
    sort_order: 11,
    is_active: true,
    name: { en: 'Medical',      ht: 'Medikal',     fr: 'Médical'       },
    description: {
      en: 'Medical consultations, clinics, and health services',
      ht: 'Konsiltasyon medikal, klinik, ak sèvis sante',
      fr: 'Consultations médicales, cliniques et services de santé',
    },
    keywords: {
      en: ['doctor', 'medical', 'health', 'clinic', 'nurse', 'sick', 'pharmacy', 'hospital'],
      ht: ['doktè', 'medikal', 'sante', 'klinik', 'enfimyè', 'malad', 'famasi', 'lopital'],
      fr: ['médecin', 'médical', 'santé', 'clinique', 'infirmière', 'malade', 'pharmacie', 'hôpital'],
    },
  },

  // ══ HYBRID CATEGORIES (Baz directory + Vitrin marketplace) ══

  {
    slug: 'grocery',
    type: 'hybrid',
    modes: ['find', 'buy', 'order'],
    icon: '🛒',
    sort_order: 20,
    is_active: true,
    name: { en: 'Grocery',      ht: 'Komisyon',    fr: 'Épicerie'      },
    description: {
      en: 'Grocery shopping, delivery, and food suppliers',
      ht: 'Komisyon, livrezon manje, ak founisè',
      fr: 'Courses, livraison et fournisseurs alimentaires',
    },
    keywords: {
      en: ['grocery', 'food delivery', 'market', 'shopping', 'provisions', 'supermarket', 'supplies'],
      ht: ['komisyon', 'manje', 'makèt', 'pwovizyon', 'livrezon', 'achte manje', 'supèmakèt'],
      fr: ['épicerie', 'courses', 'livraison', 'provisions', 'supermarché', 'marché', 'alimentation'],
    },
  },

  {
    slug: 'hair_beauty',
    type: 'hybrid',
    modes: ['find', 'buy', 'sell'],
    icon: '💇',
    sort_order: 21,
    is_active: true,
    name: { en: 'Hair & Beauty', ht: 'Cheve ak Bote', fr: 'Cheveux & Beauté' },
    description: {
      en: 'Hair salons, stylists, and hair & beauty products',
      ht: 'Salon cheve, koafè, ak pwodui cheve ak bote',
      fr: 'Salons de coiffure, coiffeurs, et produits capillaires',
    },
    keywords: {
      en: ['hair', 'beauty', 'salon', 'stylist', 'braids', 'wig', 'extensions', 'weave', 'nails', 'makeup', 'locs'],
      ht: ['cheve', 'bote', 'salon', 'koafè', 'tres', 'pèwik', 'ekstansyon', 'zong', 'maquiyaj', 'po', 'lòk'],
      fr: ['cheveux', 'beauté', 'salon', 'coiffeur', 'tresses', 'perruque', 'extensions', 'ongles', 'maquillage'],
    },
  },

  {
    slug: 'fashion',
    type: 'hybrid',
    modes: ['find', 'buy', 'sell'],
    icon: '👗',
    sort_order: 22,
    is_active: true,
    name: { en: 'Fashion & Clothing', ht: 'Rad ak Mòd', fr: 'Mode & Vêtements' },
    description: {
      en: 'Clothing, shoes, accessories, and fashion design',
      ht: 'Rad, soulye, akseswa, ak kreyasyon mòd',
      fr: 'Vêtements, chaussures, accessoires et créations de mode',
    },
    keywords: {
      en: ['fashion', 'clothing', 'clothes', 'shoes', 'dress', 'outfit', 'accessories', 'designer', 'boutique'],
      ht: ['rad', 'mòd', 'soulye', 'wòb', 'abiman', 'akseswa', 'chemiz', 'pantalon', 'boutik'],
      fr: ['mode', 'vêtements', 'chaussures', 'robe', 'tenue', 'accessoires', 'chemise', 'boutique'],
    },
  },

  {
    slug: 'food_products',
    type: 'hybrid',
    modes: ['buy', 'sell', 'order'],
    icon: '🫙',
    sort_order: 23,
    is_active: true,
    name: { en: 'Food Products', ht: 'Pwodui Manje', fr: 'Produits Alimentaires' },
    description: {
      en: 'Packaged Haitian food, sauces, spices, and specialty foods',
      ht: 'Manje ayisyen an bwat, sòs, epis, ak manje espesyal',
      fr: 'Plats haïtiens emballés, sauces, épices et spécialités culinaires',
    },
    // ⚠️ CULTURAL FLAG: Review Kreyòl food terms with direct knowledge
    keywords: {
      en: ['food products', 'sauce', 'spices', 'packaged food', 'hot sauce', 'pikliz', 'seasoning', 'epis'],
      ht: ['pwodui manje', 'sòs', 'epis', 'manje an bwat', 'pikliz', 'asaizonman', 'bon gou'],
      fr: ['produits alimentaires', 'sauce', 'épices', 'aliments emballés', 'condiments', 'assaisonnement'],
    },
  },

  // ══ VITRIN PRODUCT CATEGORIES (marketplace only) ═══════════
  // ⚠️ CULTURAL FLAG: Keywords below generated from general knowledge.
  //    Review and correct with direct cultural knowledge before production.

  {
    slug: 'crafts',
    type: 'product',
    modes: ['buy', 'sell'],
    icon: '🧺',
    sort_order: 30,
    is_active: true,
    name: { en: 'Crafts & Handmade', ht: 'Atizana', fr: 'Artisanat' },
    description: {
      en: 'Handmade Haitian crafts, baskets, pottery, and woodwork',
      ht: 'Atizana ayisyen, panye, potri, ak travay bwa',
      fr: 'Artisanat haïtien fait main, paniers, poterie et travail du bois',
    },
    keywords: {
      en: ['crafts', 'handmade', 'artisan', 'basket', 'pottery', 'woodwork', 'woven', 'traditional'],
      ht: ['atizana', 'fèt alamen', 'panye', 'potri', 'travay bwa', 'trese', 'tradisyonèl'],
      fr: ['artisanat', 'fait main', 'artisan', 'panier', 'poterie', 'bois', 'tissé', 'traditionnel'],
    },
  },

  {
    slug: 'art',
    type: 'product',
    modes: ['buy', 'sell'],
    icon: '🎨',
    sort_order: 31,
    is_active: true,
    name: { en: 'Art & Paintings', ht: 'Atizay ak Penti', fr: 'Art & Peintures' },
    description: {
      en: 'Haitian paintings, prints, sculptures, and visual art',
      ht: 'Penti ayisyen, enpresyon, eskilti, ak atizay vizyal',
      fr: 'Peintures haïtiennes, gravures, sculptures et art visuel',
    },
    keywords: {
      en: ['art', 'painting', 'print', 'sculpture', 'canvas', 'haitian art', 'naïve art', 'artist'],
      ht: ['atizay', 'penti', 'enpresyon', 'eskilti', 'towal', 'atizay ayisyen', 'atis'],
      fr: ['art', 'peinture', 'impression', 'sculpture', 'toile', 'art haïtien', 'artiste'],
    },
  },

  {
    slug: 'jewelry',
    type: 'product',
    modes: ['buy', 'sell'],
    icon: '💎',
    sort_order: 32,
    is_active: true,
    name: { en: 'Jewelry & Accessories', ht: 'Bijou ak Akseswa', fr: 'Bijoux & Accessoires' },
    description: {
      en: 'Handmade jewelry, beaded accessories, and adornments',
      ht: 'Bijou fèt alamen, akseswa grenn, ak orneman',
      fr: 'Bijoux faits main, accessoires perlés et parures',
    },
    keywords: {
      en: ['jewelry', 'accessories', 'beads', 'necklace', 'bracelet', 'earrings', 'ring', 'handmade'],
      ht: ['bijou', 'akseswa', 'grenn', 'kolye', 'braslè', 'zanno', 'bag'],
      fr: ['bijoux', 'accessoires', 'perles', 'collier', 'bracelet', 'boucles d\'oreilles', 'bague'],
    },
  },

  {
    slug: 'music',
    type: 'product',
    modes: ['buy', 'sell'],
    icon: '🎵',
    sort_order: 33,
    is_active: true,
    name: { en: 'Music & Instruments', ht: 'Mizik ak Enstriman', fr: 'Musique & Instruments' },
    description: {
      en: 'Haitian music, instruments, recordings, and digital content',
      ht: 'Mizik ayisyen, enstriman, anrejistreman, ak kontni dijital',
      fr: 'Musique haïtienne, instruments, enregistrements et contenu numérique',
    },
    keywords: {
      en: ['music', 'instrument', 'recording', 'album', 'kompa', 'rara', 'beats', 'haitian music'],
      ht: ['mizik', 'enstriman', 'anrejistreman', 'konpa', 'rara', 'mizik ayisyen', 'chan', 'albòm'],
      fr: ['musique', 'instrument', 'enregistrement', 'album', 'kompa', 'rara', 'musique haïtienne'],
    },
  },

  {
    slug: 'home_decor',
    type: 'product',
    modes: ['buy', 'sell'],
    icon: '🏠',
    sort_order: 34,
    is_active: true,
    name: { en: 'Home & Decor', ht: 'Kay ak Dekorasyon', fr: 'Maison & Décoration' },
    description: {
      en: 'Home décor, furniture, and household items',
      ht: 'Dekorasyon kay, mèb, ak atik pou kay',
      fr: 'Décoration d\'intérieur, meubles et articles ménagers',
    },
    keywords: {
      en: ['home decor', 'furniture', 'decoration', 'household', 'interior', 'lamp', 'rug'],
      ht: ['dekorasyon', 'mèb', 'dekorasyon kay', 'atik kay', 'enteryè', 'lanp', 'tapi'],
      fr: ['décoration', 'meubles', 'décor', 'maison', 'intérieur', 'lampe', 'tapis'],
    },
  },

  // ══ CATCH-ALL ══════════════════════════════════════════════

  {
    slug: 'other',
    type: 'service',
    modes: ['find'],
    icon: '📋',
    sort_order: 99,
    is_active: true,
    name: { en: 'Other',        ht: 'Lòt',         fr: 'Autre'         },
    description: {
      en: 'Other services not listed above',
      ht: 'Lòt sèvis ki pa nan lis la',
      fr: 'Autres services non listés ci-dessus',
    },
    keywords: {
      en: ['other', 'service', 'help', 'need', 'looking for', 'find'],
      ht: ['lòt', 'sèvis', 'èd', 'bezwen', 'chèche', 'jwenn'],
      fr: ['autre', 'service', 'aide', 'besoin', 'chercher', 'trouver'],
    },
  },

];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** All active categories */
const active = () => categories.filter(c => c.is_active);

/** Service + hybrid categories (for Baz directory) */
const serviceCategories = () => active().filter(c => c.type === 'service' || c.type === 'hybrid');

/** Product + hybrid categories (for Vitrin marketplace) */
const productCategories = () => active().filter(c => c.type === 'product' || c.type === 'hybrid');

/** All active slugs */
const slugs = () => active().map(c => c.slug);

/** Category by slug */
const bySlug = (slug) => categories.find(c => c.slug === slug) || null;

/** Check if a category supports a given mode */
const supportsMode = (slug, mode) => {
  const cat = bySlug(slug);
  return cat ? cat.modes.includes(mode) : false;
};

/**
 * Get available mode options for a category in a given language.
 * Used by the router to build the numbered WhatsApp option list.
 *
 * Example — getModeOptions('hair_beauty', 'ht'):
 * [
 *   { num: 1, mode: 'find', label: 'Jwenn Cheve ak Bote', handler: 'find' },
 *   { num: 2, mode: 'buy',  label: 'Achte Cheve ak Bote', handler: 'vitrin_buy' },
 *   { num: 3, mode: 'sell', label: 'Vann Cheve ak Bote',  handler: 'vitrin_sell' },
 * ]
 */
const getModeOptions = (slug, lang = 'en') => {
  const cat = bySlug(slug);
  if (!cat) return [];
  return cat.modes.map((mode, i) => ({
    num: i + 1,
    mode,
    label: `${MODE_LABELS[mode][lang]} ${cat.name[lang]}`,
    handler: MODE_HANDLERS[mode],
  }));
};

/**
 * Format mode options as a WhatsApp-ready numbered string.
 *
 * Example — formatModeOptions('hair_beauty', 'ht'):
 * "1. Jwenn Cheve ak Bote
 *  2. Achte Cheve ak Bote
 *  3. Vann Cheve ak Bote"
 */
const formatModeOptions = (slug, lang = 'en') =>
  getModeOptions(slug, lang)
    .map(o => `${o.num}. ${o.label}`)
    .join('\n');

/**
 * Build keyword prompt for Claude intent + search detection.
 * Includes all keywords across all 3 languages.
 */
const buildKeywordPrompt = () =>
  active()
    .map(c => {
      const all = [c.slug, ...c.keywords.en, ...c.keywords.ht, ...c.keywords.fr];
      const unique = [...new Set(all)];
      return `- ${c.slug} (${c.name.en} / ${c.name.ht} / ${c.name.fr}): ${unique.join(', ')}`;
    })
    .join('\n');

/** Localized name for a slug. Falls back to English. */
const localName = (slug, lang = 'en') => {
  const cat = bySlug(slug);
  if (!cat) return slug;
  return cat.name[lang] || cat.name.en;
};

module.exports = {
  categories,
  MODE_LABELS,
  MODE_HANDLERS,
  active,
  serviceCategories,
  productCategories,
  slugs,
  bySlug,
  supportsMode,
  getModeOptions,
  formatModeOptions,
  buildKeywordPrompt,
  localName,
};
