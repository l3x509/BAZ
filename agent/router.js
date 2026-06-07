'use strict';

const { detectTopic }              = require('./claude');
const { getModeOptions, bySlug }   = require('./config/categories');
const { sendText }                 = require('./whatsapp');
const wa                           = require('./whatsapp');
const db                           = require('./db');
const { normalize, normalizeMap, normalizeList } = require('./utils/normalize');

const findHandler    = require('./handlers/find');
const eventsHandler  = require('./handlers/events');
const payHandler     = require('./handlers/pay');
const onboardHandler = require('./handlers/onboard');
const statusHandler  = require('./handlers/status');
const { handleWorldCupKeywords } = require('./worldcup');

const HANDLERS = { find: findHandler };

const PENDING_TTL_MS     = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;
const CLAUDE_TIMEOUT_MS  = 8000;

// ════════════════════════════════════════════════════════════
// KEYWORD MAP
// ════════════════════════════════════════════════════════════
const KEYWORD_MAP_RAW = {
  // ── Creole ───────────────────────────────────────────────
  'cheve': 'hair_beauty', 'bote': 'hair_beauty', 'kwafiè': 'hair_beauty',
  'trese': 'hair_beauty', 'tres': 'hair_beauty', 'zong': 'hair_beauty',
  'manje': 'restaurant',  'restoran': 'restaurant', 'griyo': 'restaurant',
  'diri': 'restaurant',   'poul': 'restaurant',
  'tonmtonm': 'restaurant', 'lalo': 'restaurant', 'bouyon': 'restaurant',
  'soup': 'restaurant',   'joumou': 'restaurant', 'soup joumou': 'restaurant',
  'ze': 'restaurant',     'akasan': 'restaurant', 'ju lam': 'restaurant',
  'ju manioc': 'restaurant', 'bannann': 'restaurant', 'pikliz': 'restaurant',
  'legim': 'restaurant',  'tassot': 'restaurant', 'lanbi': 'restaurant',
  'pate': 'restaurant',   'akra': 'restaurant',
  'avoka': 'legal',       'imigrasyon': 'legal',  'viza': 'legal',
  'gadri': 'childcare',   'timoun': 'childcare',  'ti moun': 'childcare',
  'kago': 'shipping',     'barèl': 'shipping',    'kolis': 'shipping',
  'taks': 'tax_notary',   'notè': 'tax_notary',
  'sèvis': 'services',
  'legliz': 'church',
  'komisyon': 'grocery',  'mache': 'grocery',
  'rad': 'fashion',       'mòd': 'fashion',
  'plonbye': 'plumber',   'tiyo': 'plumber',      'tuyò': 'plumber',
  'elektrisyen': 'electrician',
  'netwayaj': 'cleaner',
  'kizinyè': 'cook',      'trètè': 'cook',        'boulanjri': 'cook',
  'pwofesè': 'tutor',     'lekòl': 'tutor',
  'doktè': 'medical',     'klinik': 'medical',    'famasi': 'medical',
  'imobilye': 'real_estate',
  // ── Car / Machin — top level category ────────────────────
  'machin': 'car_services',    'kamyon': 'car_services',
  'toyota': 'car_services',    'nissan': 'car_services',   'jeep': 'car_services',
  'transpò': 'car_services',   'chofè': 'car_services',    'taksi': 'car_services',
  'mekanisyen': 'car_services',
  'achte machin': 'car_services', 'vann machin': 'car_services',
  'lavaj machin': 'car_services', 'lave machin': 'car_services',
  'pati machin': 'car_services',
  'asirans machin': 'car_services',
  'transpò machin': 'car_services', 'transpò pou ayiti': 'car_services',
  // ── English ───────────────────────────────────────────────
  'hair': 'hair_beauty',  'salon': 'hair_beauty', 'braids': 'hair_beauty',
  'nails': 'hair_beauty', 'barber': 'hair_beauty',
  'food': 'restaurant',   'restaurant': 'restaurant', 'eat': 'restaurant',
  'lawyer': 'legal',      'attorney': 'legal',    'immigration': 'legal',
  'childcare': 'childcare', 'daycare': 'childcare', 'preschool': 'childcare',
  'shipping': 'shipping', 'cargo': 'shipping',    'barrel': 'shipping',
  'tax': 'tax_notary',    'notary': 'tax_notary', 'taxes': 'tax_notary',
  'services': 'services',
  'church': 'church',
  'grocery': 'grocery',   'market': 'grocery',
  'fashion': 'fashion',   'clothing': 'fashion',
  'plumber': 'plumber',   'plumbing': 'plumber',
  'electrician': 'electrician',
  'cleaning': 'cleaner',  'cleaner': 'cleaner',
  'catering': 'cook',     'bakery': 'cook',       'chef': 'cook',
  'tutor': 'tutor',       'school': 'tutor',
  'medical': 'medical',   'doctor': 'medical',    'pharmacy': 'medical',
  'realtor': 'real_estate', 'real estate': 'real_estate',
  'car': 'car_services',  'cars': 'car_services', 'auto': 'car_services',
  'vehicle': 'car_services', 'mechanic': 'car_services', 'driver': 'car_services',
  'transport': 'car_services',
  'car wash': 'car_services',    'detailing': 'car_services',
  'auto parts': 'car_services',
  'car insurance': 'car_services',
  'car shipping': 'car_services', 'ship car': 'car_services',
  // ── French ────────────────────────────────────────────────
  'cheveux': 'hair_beauty', 'coiffure': 'hair_beauty',
  'manger': 'restaurant',   'nourriture': 'restaurant',
  'avocat': 'legal',
  'garderie': 'childcare',
  'expédition': 'shipping',
  'impôts': 'tax_notary',   'notaire': 'tax_notary',
  'église': 'church',
  'épicerie': 'grocery',
  'mode': 'fashion',
  'voiture': 'car_services',  'automobile': 'car_services',
  'mécanicien': 'car_services', 'assurance auto': 'car_services',
  'lavage voiture': 'car_services', 'pièces auto': 'car_services',
};

const KEYWORD_MAP = normalizeMap(KEYWORD_MAP_RAW);

// ════════════════════════════════════════════════════════════
// EMOJI MAP
// ════════════════════════════════════════════════════════════
const EMOJI_MAP = {
  '💇': 'hair_beauty', '💇‍♀️': 'hair_beauty', '💅': 'hair_beauty', '✂️': 'hair_beauty',
  '🍽️': 'restaurant',  '🍲': 'restaurant',  '🥘': 'restaurant', '🍗': 'restaurant', '🍛': 'restaurant',
  '⚖️': 'legal',
  '👶': 'childcare',   '🧒': 'childcare',
  '📦': 'shipping',    '🚢': 'shipping',
  '🧾': 'tax_notary',  '💼': 'tax_notary',
  '🛠️': 'services',    '🔧': 'services',
  '🛒': 'grocery',
  '👗': 'fashion',     '👚': 'fashion',
  '🎉': 'events',      '🎊': 'events',      '🎤': 'events',
  '⛪': 'church',      '🙏': 'church',
  '🏥': 'medical',     '💊': 'medical',
  '🚗': 'car_services', '🚌': 'car_services', '🚕': 'car_services',
  '🏠': 'real_estate', '🏡': 'real_estate',
};

// ════════════════════════════════════════════════════════════
// CITY EXTRACTOR
// ════════════════════════════════════════════════════════════
const KNOWN_CITIES_RAW = [
  'boston', 'dorchester', 'mattapan', 'roxbury', 'hyde park',
  'jamaica plain', 'roslindale', 'east boston', 'charlestown',
  'fenway', 'west roxbury', 'allston', 'brighton',
  'cambridge', 'somerville', 'everett', 'malden', 'chelsea',
  'revere', 'winthrop', 'medford', 'quincy', 'milton',
  'brookline', 'newton', 'waltham', 'watertown', 'dedham',
  'norwood', 'woburn', 'belmont', 'arlington', 'stoneham',
  'braintree', 'weymouth', 'needham', 'westwood', 'sharon',
  'randolph', 'holbrook', 'brockton', 'stoughton', 'canton',
  'avon', 'easton', 'abington', 'west bridgewater', 'bridgewater',
  'whitman', 'taunton', 'hanover', 'rockland', 'hanson',
  'pembroke', 'duxbury', 'hingham', 'cohasset', 'scituate',
  'east bridgewater', 'middleboro', 'raynham',
  'framingham', 'marlborough', 'natick', 'ashland', 'hopkinton',
  'milford', 'northborough', 'southborough', 'hudson', 'shrewsbury',
  'worcester', 'grafton', 'westborough', 'holliston',
  'lynn', 'lowell', 'lawrence', 'haverhill', 'saugus',
  'peabody', 'salem', 'swampscott', 'methuen', 'andover',
  'north andover', 'amesbury', 'newburyport', 'beverly', 'gloucester',
  'miami', 'miami gardens', 'north miami', 'north miami beach',
  'hialeah', 'miramar', 'hollywood', 'fort lauderdale',
  'pompano beach', 'deerfield beach', 'west palm beach',
  'pembroke pines', 'hallandale beach', 'aventura',
  'coral gables', 'south miami', 'doral', 'opa-locka',
  'davie', 'plantation', 'sunrise', 'coral springs', 'margate',
  'coconut creek', 'boca raton', 'boynton beach', 'delray beach',
  'lake worth', 'riviera beach', 'palm beach gardens',
  'orlando', 'kissimmee', 'tampa', 'st petersburg', 'clearwater',
  'weston', 'wellington',
  'new york', 'brooklyn', 'bronx', 'queens', 'manhattan',
  'staten island', 'yonkers', 'mount vernon', 'new rochelle',
  'white plains', 'flushing', 'long island city',
  'hempstead', 'freeport', 'valley stream', 'uniondale', 'elmont',
  'newark', 'irvington', 'east orange', 'orange', 'jersey city',
  'elizabeth', 'hoboken', 'paterson', 'bloomfield', 'montclair',
  'union city', 'bayonne', 'south orange', 'maplewood',
  'bridgeport', 'stamford', 'new haven', 'norwalk', 'stratford',
  'milford', 'trumbull', 'fairfield', 'shelton', 'greenwich',
  'montreal', 'laval', 'longueuil', 'brossard', 'saint-hubert',
  'saint-leonard', 'montreal-nord', 'rivière-des-prairies',
  'repentigny', 'terrebonne', 'blainville', 'boisbriand',
  'rosemère', 'saint-eustache', 'mascouche', 'laprairie',
  'port-au-prince', 'pap', 'pétionville', 'petion-ville',
  'delmas', 'tabarre', 'carrefour', 'cité soleil',
  'croix-des-bouquets', 'gressier', 'léogâne', 'kenscoff',
  'cap-haïtien', 'cap haitien', 'limonade', 'milot',
  'gonaïves', 'gonaives', 'saint-marc', 'ennery',
  'les cayes', 'jacmel', 'marigot', 'aquin',
  'grand-goâve', 'petit-goâve', 'miragoane',
];

const KNOWN_CITIES = normalizeList(KNOWN_CITIES_RAW)
  .sort((a, b) => b.length - a.length);

function extractCity(normalizedText) {
  for (const city of KNOWN_CITIES) {
    if (normalizedText.includes(city)) return city;
  }
  return null;
}

function preRoute(normalizedText) {
  if (KEYWORD_MAP[normalizedText]) return { slug: KEYWORD_MAP[normalizedText], city: null };
  const city = extractCity(normalizedText);
  if (city) {
    const withoutCity = normalizedText.replace(city, '').trim();
    if (withoutCity && KEYWORD_MAP[withoutCity]) return { slug: KEYWORD_MAP[withoutCity], city };
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// AREA CODE → CITY
// ════════════════════════════════════════════════════════════
const AREA_CODE_CITY = {
  '617': 'Boston',   '857': 'Boston',   '781': 'Boston',   '339': 'Boston',
  '508': 'Brockton', '774': 'Brockton',
  '305': 'Miami',    '786': 'Miami',    '954': 'Miami',
  '718': 'New York', '347': 'New York', '929': 'New York', '646': 'New York',
  '438': 'Montreal', '514': 'Montreal',
};

function inferCityFromPhone(waId) {
  const digits = (waId || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return AREA_CODE_CITY[digits.slice(1, 4)] || null;
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// DEDUPLICATION
// ════════════════════════════════════════════════════════════
const _recentMsgs = new Map();
function isDuplicateInbound(waId, message) {
  const key  = `${waId}:${message.slice(0, 80)}`;
  const last = _recentMsgs.get(key);
  if (last && Date.now() - last < 3000) return true;
  _recentMsgs.set(key, Date.now());
  setTimeout(() => _recentMsgs.delete(key), 10000);
  return false;
}

// ════════════════════════════════════════════════════════════
// CLAUDE SAFE WRAPPER
// ════════════════════════════════════════════════════════════
async function detectTopicSafe(message, lang) {
  try {
    return await Promise.race([
      detectTopic(message, lang),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), CLAUDE_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.warn('[router] detectTopic failed:', err.message);
    return { type: 'unknown', lang, city: null, country: null, category_slug: null };
  }
}

// ════════════════════════════════════════════════════════════
// STATIC DATA
// ════════════════════════════════════════════════════════════

// Services submenu — 8 items (car moved to its own top-level category)
const SERVICE_OPTIONS = [
  { num: 1, slug: 'plumber',     icon: '🔧', label: { en: 'Plumber',           ht: 'Plonbye',    fr: 'Plombier'     }},
  { num: 2, slug: 'electrician', icon: '⚡', label: { en: 'Electrician',        ht: 'Elektrisyen', fr: 'Électricien' }},
  { num: 3, slug: 'contractor',  icon: '🏗️', label: { en: 'Contractor',         ht: 'Kontraktè',  fr: 'Entrepreneur' }},
  { num: 4, slug: 'cleaner',     icon: '🧹', label: { en: 'Cleaning',           ht: 'Netwayaj',   fr: 'Nettoyage'    }},
  { num: 5, slug: 'cook',        icon: '👨‍🍳', label: { en: 'Cook / Catering',    ht: 'Kizinyè',   fr: 'Traiteur'     }},
  { num: 6, slug: 'tutor',       icon: '📚', label: { en: 'Tutor / School',     ht: 'Pwofesè',    fr: 'Tuteur'       }},
  { num: 7, slug: 'medical',     icon: '🏥', label: { en: 'Medical',            ht: 'Medikal',    fr: 'Médical'      }},
  { num: 8, slug: 'real_estate', icon: '🏠', label: { en: 'Real Estate',        ht: 'Imobilye',   fr: 'Immobilier'   }},
];

// Car category — 7 subcategories (top-level, peer of restaurant/hair/legal)
// DB slugs needed: detailing, auto_parts, car_insurance, car_shipping_haiti
// (driver and mechanic already exist in DB)
const CAR_OPTIONS = [
  { num: 1, slug: 'driver',              icon: '🚗', label: { en: 'Transport / Driver', ht: 'Transpò',          fr: 'Transport'        }},
  { num: 2, slug: 'mechanic',            icon: '🔩', label: { en: 'Mechanic',            ht: 'Mekanisyen',       fr: 'Mécanicien'       }},
  { num: 3, slug: 'achte_machin',        icon: '🏎️', label: { en: 'Buy & Sell Cars',    ht: 'Achte & Vann',     fr: 'Acheter & Vendre' }},
  { num: 4, slug: 'detailing',           icon: '✨', label: { en: 'Car Detailing',       ht: 'Detailing',        fr: 'Détailing'        }},
  { num: 5, slug: 'auto_parts',          icon: '🔧', label: { en: 'Auto Parts',          ht: 'Pati Machin',      fr: 'Pièces Auto'      }},
  { num: 6, slug: 'car_insurance',       icon: '🛡️', label: { en: 'Car Insurance',       ht: 'Asirans Machin',   fr: 'Assurance Auto'   }},
  { num: 7, slug: 'car_shipping_haiti',  icon: '🚢', label: { en: 'Ship Car to Haiti',  ht: 'Transpò pou Ayiti', fr: 'Transport Haïti' }},
];

// Solutions LLC — premium business for Achte & Vann Machin
const SOLUTIONS_LLC = {
  name:         'Solutions LLC',
  city:         'Boston',
  address:      '',
  phone:        '(857) 229-5384',
  whatsapp:     '3392086659',
  website:      null,
  description:  'Achte & vann machin — Boston, MA',
  meta:         { hours: null },
  listing_tier: 'premium',
  is_verified:  true,
  avg_rating:   0,
};

const ALL_CATEGORIES_TEXT = {
  ht: `📋 *Tout kategori Baz:*\n\n⚽ *AYITI* — World Cup 2026 🇭🇹\n💇‍♀️ *cheve* — hair & beauty\n🍲 *manje* — restaurant\n🛒 *komisyon* — grocery\n👗 *rad* — fashion\n⚖️ *avoka* — legal & immigration\n🧒 *gadri* — childcare\n🎉 *evènman* — upcoming events\n🚢 *kago* — shipping to Haiti\n💼 *taks* — tax & notary\n⛪ *legliz* — church & community\n🚗 *machin* — transpò, mekanisyen, achte machin & plis\n🛠️ *sèvis* — plumber, electrician & more\n\n_Ekri non kategori a pou jwenn biznis._`,
  en: `📋 *All Baz categories:*\n\n⚽ *AYITI* — World Cup 2026 🇭🇹\n💇‍♀️ *hair* — hair & beauty\n🍲 *food* — restaurant\n🛒 *grocery* — grocery store\n👗 *fashion* — clothing\n⚖️ *lawyer* — legal & immigration\n🧒 *childcare* — daycare & preschool\n🎉 *events* — upcoming events\n🚢 *shipping* — cargo to Haiti\n💼 *tax* — tax & notary\n⛪ *church* — church & community\n🚗 *car* — transport, mechanic, buy/sell & more\n🛠️ *services* — plumber, electrician & more\n\n_Type any category to find businesses._`,
  fr: `📋 *Toutes les catégories Baz:*\n\n⚽ *AYITI* — Coupe du Monde 2026 🇭🇹\n💇‍♀️ *cheveux* — coiffure & beauté\n🍲 *restaurant* — restaurant\n🛒 *épicerie* — épicerie\n👗 *mode* — vêtements\n⚖️ *avocat* — juridique & immigration\n🧒 *garderie* — garde d'enfants\n🎉 *événements* — événements à venir\n🚢 *expédition* — colis vers Haïti\n💼 *impôts* — impôts & notaire\n⛪ *église* — église & communauté\n🚗 *voiture* — transport, mécanique, achat/vente & plus\n🛠️ *services* — plombier, électricien & plus\n\n_Tapez un nom de catégorie pour trouver des entreprises._`,
};

const COPY = {
  greeting: {
    ht: `👋 Byenvini nan *Baz* — Zone Biznis Ayisyen.\n\nEkri sa w bezwen:\n\n⚽ *AYITI* — World Cup 2026 🇭🇹\n💇‍♀️ *cheve* — hair & beauty\n🍲 *manje* — restaurant\n🚗 *machin* — transpò, mekanisyen & plis\n⚖️ *avoka* — legal & immigration\n🧒 *gadri* — childcare\n🎉 *evènman* — upcoming events\n🚢 *kago* — shipping to Haiti\n💼 *taks* — tax & notary\n🛠️ *sèvis* — plumber, electrician & more\n\n_Ekri *tout* pou wè tout kategori yo_`,
    en: `👋 Welcome to *Baz* — The Haitian Business Zone.\n\nTell me what you need:\n\n⚽ *AYITI* — World Cup 2026 🇭🇹\n💇‍♀️ *hair* — hair & beauty\n🍲 *food* — restaurant\n🚗 *car* — transport, mechanic & more\n⚖️ *lawyer* — legal & immigration\n🧒 *childcare* — daycare & preschool\n🎉 *events* — upcoming events\n🚢 *shipping* — cargo to Haiti\n💼 *tax* — tax & notary\n🛠️ *services* — plumber, electrician & more\n\n_Type *all* to see all categories_`,
    fr: `👋 Bienvenir sur *Baz* — Zone Business Haitien.\n\nDites-moi ce dont vous avez besoin:\n\n⚽ *AYITI* — Coupe du Monde 2026 🇭🇹\n💇‍♀️ *cheveux* — coiffure & beauté\n🍲 *restaurant* — restaurant\n🚗 *voiture* — transport, mécanique & plus\n⚖️ *avocat* — juridique & immigration\n🧒 *garderie* — garde d'enfants\n🎉 *événements* — événements à venir\n🚢 *expédition* — colis vers Haïti\n💼 *impôts* — impôts & notaire\n🛠️ *services* — plombier, électricien & plus\n\n_Tapez *tout* pour voir toutes les catégories_`,
  },
  unknown: {
    ht: `Mwen pa konprann. Eseye:\n• Ekri sa w *chèche* (restoran, avoka, machin...)\n• *menu* — pou retounen nan meni prensipal\n• *tout* — pou wè tout kategori yo\n\n_Konsèy: ajoute vil la — "cheve Boston" oswa "avoka Brockton"_`,
    en: `I didn't catch that. Try:\n• What you're *looking for* (restaurant, lawyer, car...)\n• *menu* — to go back to the main menu\n• *all* — to see all categories\n\n_Tip: include a city — "hair Boston" or "car Brockton"_`,
    fr: `Je n'ai pas compris. Essayez:\n• Ce que vous *cherchez* (restaurant, avocat, voiture...)\n• *menu* — pour revenir au menu principal\n• *tout* — pour voir toutes les catégories\n\n_Conseil: précisez la ville — "cheveux Boston" ou "avocat Brockton"_`,
  },
  comingSoon: {
    ht: `⏳ Fonksyon sa a ap vini byento!`,
    en: `⏳ This feature is coming soon!`,
    fr: `⏳ Cette fonctionnalité arrive bientôt!`,
  },
};

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /forget\s+(everything|all|your|previous)/i,
];

function sanitize(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return null;
  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) { console.warn('[router] Injection blocked:', text.slice(0, 80)); break; }
  }
  return text;
}

// ════════════════════════════════════════════════════════════
// PROCESS MESSAGE
// ════════════════════════════════════════════════════════════
async function processMessage({ waId, displayName, messageId, messageType, content }) {
  const message = sanitize(content);
  if (!message) return;
  if (isDuplicateInbound(waId, message)) { console.log(`[router] Duplicate dropped: ${waId}`); return; }
  try {
    const [user, existingConvo] = await Promise.all([
      db.getOrCreateUser(waId, displayName),
      db.getConversationByWaId(waId),
    ]);
    let lang = user.language || 'en';
    if (!user.location_city) {
      const inferredCity = inferCityFromPhone(waId);
      if (inferredCity) {
        db.updateUser(user.id, { location_city: inferredCity })
          .then(updated => { if (updated) user.location_city = inferredCity; })
          .catch(() => {});
      }
    }
    let conversation = existingConvo;
    if (!conversation) { try { conversation = await db.createConversation(user.id, waId); } catch {} }
    if (conversation?.id) {
      db.logMessage({ conversationId: conversation.id, userId: user.id, direction: 'inbound', messageType, content: message, metaMessageId: messageId });
    }
    await route({ user, message, lang, conversationId: conversation?.id || null });
  } catch (err) {
    console.error('[router] processMessage error:', err.message, err.stack);
  }
}

// ════════════════════════════════════════════════════════════
// ROUTE
// ════════════════════════════════════════════════════════════
async function route({ user, message, lang, conversationId }) {
  try {
    const sessionState = user.session_state || {};
    const text         = message.trim().toLowerCase();
    const normText     = normalize(message);

    // ── ADMIN EVENT APPROVAL ──────────────────────────────────
    const ADMIN_WA = process.env.ADMIN_WHATSAPP;
    if (ADMIN_WA && user.whatsapp_id === ADMIN_WA) {
      const approveRx = /^(yes|wi|aprove|approve|ok)(\s+[0-9a-f-]{36})?$/i;
      const rejectRx  = /^(no|non|rejete|reject)(\s+[0-9a-f-]{36})?$/i;
      if (approveRx.test(text) || rejectRx.test(text)) {
        const isApprove = approveRx.test(text);
        const idMatch   = text.match(/[0-9a-f-]{36}/i);
        const eventId   = idMatch ? idMatch[0] : null;
        try {
          const pending = await db.getPendingEvent(eventId);
          if (!pending) return sendText(user.whatsapp_id, 'Pa gen evenman an atant.');
          const updated   = await db.updateEventStatus(pending.id, isApprove ? 'active' : 'rejected');
          const remaining = await db.getPendingEventsCount();
          return sendText(user.whatsapp_id, isApprove
            ? `LIVE: ${updated.title} (${remaining > 0 ? remaining + ' more pending' : 'none pending'})`
            : `Rejected: ${updated.title}`
          );
        } catch (err) { return sendText(user.whatsapp_id, 'Error: ' + err.message); }
      }
    }

    // ── BACK / MENU ───────────────────────────────────────────
    const backWords = new Set(['0', 'back', 'retounen', 'retour', 'menu']);
    if (backWords.has(text)) {
      await clearPendingMode(user);
      await clearServiceCategory(user);
      await clearCarCategory(user);
      return wa.sendGreeting(user.whatsapp_id, lang);
    }

    // ── ALL CATEGORIES ────────────────────────────────────────
    const allWords = new Set(['tout', 'all', 'tout kategori', 'all categories', 'categories', 'tout bagay']);
    if (allWords.has(text)) {
      return sendText(user.whatsapp_id, ALL_CATEGORIES_TEXT[lang] || ALL_CATEGORIES_TEXT.en);
    }

    // ── WORLD CUP ─────────────────────────────────────────────
    const wcRaw      = handleWorldCupKeywords(message, user.whatsapp_id);
    const wcResponse = (wcRaw instanceof Promise) ? await wcRaw : wcRaw;
    if (wcResponse !== null) {
      if (Array.isArray(wcResponse)) {
        await sendText(user.whatsapp_id, wcResponse[0]);
        for (let i = 1; i < wcResponse.length; i++) {
          await new Promise(r => setTimeout(r, 1500));
          await sendText(user.whatsapp_id, wcResponse[i]);
        }
      } else {
        await sendText(user.whatsapp_id, wcResponse);
      }
      return;
    }

    // ── OPTIONS ───────────────────────────────────────────────
    if (text === 'options' && sessionState.last_category) {
      await clearPendingMode(user);
      await clearServiceCategory(user);
      await clearCarCategory(user);
      return await handleCategory({
        topic: { type: 'category', category_slug: sessionState.last_category, city: null, country: null },
        user, message, lang, conversationId, forceMenu: true,
      });
    }

    // ── MORE RESULTS ──────────────────────────────────────────
    const moreWords = new Set(['more', 'plis', 'plus', 'next']);
    const SEARCH_TTL = 30 * 60 * 1000;
    const lastSearchFresh = sessionState.last_search &&
      (Date.now() - (sessionState.last_search.ts || 0)) < SEARCH_TTL;
    if (moreWords.has(text) && lastSearchFresh) return await showMoreResults(user, lang);

    // ── PENDING CAR CATEGORY ──────────────────────────────────
    if (sessionState.pending_car_cat) {
      const handled = await resolveCarCategory({
        pending: sessionState.pending_car_cat, message, user, lang, conversationId,
      });
      if (handled) return;
      await clearCarCategory(user);
    }

    // ── PENDING SERVICE CATEGORY ──────────────────────────────
    if (sessionState.pending_service_cat) {
      const handled = await resolveServiceCategory({
        pending: sessionState.pending_service_cat, message, user, lang, conversationId,
      });
      if (handled) return;
      await clearServiceCategory(user);
    }

    // ── PENDING MODE ──────────────────────────────────────────
    if (sessionState.pending_mode) {
      const handled = await resolvePendingMode({
        pending: sessionState.pending_mode, message, user, lang, conversationId,
      });
      if (handled) return;
      await clearPendingMode(user);
    }

    // ── COMMUNITY EVENTS ──────────────────────────────────────
    const EVENT_WORDS_RAW = new Set([
      'evènman', 'fèt', 'aktivite', 'events', 'event', 'événements',
      'ki pase', "what's on", 'whats on', 'eveman', 'evenman',
    ]);
    const EVENT_NORMS = new Set([...EVENT_WORDS_RAW].map(normalize));
    if (EVENT_NORMS.has(normText) || [...EVENT_NORMS].some(w => normText.startsWith(w + ' '))) {
      const evCity = extractCity(normText) || user.location_city || null;
      return await eventsHandler.handle({ user, message, lang, city: evCity });
    }

    // ── EVENTS PAGINATION ─────────────────────────────────────
    if (moreWords.has(text) && sessionState.last_events_search) {
      const handled = await eventsHandler.handleMore({ user, lang });
      if (handled) return;
    }

    // ── VENDOR STATS ──────────────────────────────────────────
    if (text === 'stats' || text === 'estatistik') return await findHandler.handleVendorStats({ user, lang });

    // ── JOIN ──────────────────────────────────────────────────
    if (text === 'join') {
      const join = {
        ht: `💎 *Vle yon plas Premium sou Baz?*\n\nBiznis Premium yo:\n• 👑 Parèt an premye nan tout rechèch\n• 💬 Kati espesyal ak deskripsyon ou\n• ✅ Badge verifye\n• 📊 Estatistik chak semèn\n\n*$39/mwa* — Kontakte Baz: bazht.com`,
        en: `💎 *Want a Premium spot on Baz?*\n\nPremium businesses get:\n• 👑 First position in every search\n• 💬 Featured card with your description\n• ✅ Verified badge\n• 📊 Weekly impression stats\n\n*$39/month* — bazht.com`,
        fr: `💎 *Vous voulez une place Premium sur Baz?*\n\nLes entreprises Premium obtiennent:\n• 👑 Première position dans chaque recherche\n• 💬 Carte vedette avec votre description\n• ✅ Badge vérifié\n• 📊 Statistiques hebdomadaires\n\n*39$/mois* — bazht.com`,
      };
      return sendText(user.whatsapp_id, join[lang] || join.en);
    }

    // ── EMOJI MAP ─────────────────────────────────────────────
    if (EMOJI_MAP[message.trim()]) {
      const slug = EMOJI_MAP[message.trim()];
      console.log(`[router] Emoji: ${message.trim()} → ${slug}`);
      return await handleCategory({
        topic: { type: 'category', category_slug: slug, city: null, country: null },
        user, message, lang, conversationId,
      });
    }

    // ── KEYWORD PRE-ROUTER ────────────────────────────────────
    const preRouted = preRoute(normText);
    if (preRouted) {
      console.log(`[router] Keyword: "${normText}" → ${preRouted.slug}${preRouted.city ? ' / ' + preRouted.city : ''}`);
      return await handleCategory({
        topic: { type: 'category', category_slug: preRouted.slug, city: preRouted.city || null, country: null },
        user, message, lang, conversationId,
      });
    }

    // ── BUSINESS NAME LOOKUP ──────────────────────────────────
    const inputIsCity    = extractCity(normText) === normText;
    const hasActiveSearch = lastSearchFresh;
    if (normText.length >= 3 && !(inputIsCity && hasActiveSearch)) {
      try {
        const nameMatches = await db.findBusinessByName(normText);
        if (nameMatches?.length === 1) {
          console.log(`[router] Name match: "${normText}" → ${nameMatches[0].name}`);
          return await findHandler.handleBusinessSelected({ user, businessId: nameMatches[0].id, lang });
        }
        if (nameMatches?.length > 1) {
          const { last_search: _ls, last_result_ids: _lr, last_category: _lc, ...cleanState } = sessionState;
          await db.updateSessionState(user.id, {
            ...cleanState,
            last_result_ids: nameMatches.map(b => b.id),
            last_result_ts:  Date.now(),
            last_search: { query: normText, categorySlug: null, city: null, offset: 0, ts: Date.now() },
          });
          return wa.sendBusinessResults(user.whatsapp_id, nameMatches, lang, false);
        }
      } catch (err) { console.warn('[router] findBusinessByName error (non-fatal):', err.message); }
    }

    // ── BUSINESS SELECTION ────────────────────────────────────
    const RESULT_TTL = 10 * 60 * 1000;
    const resultsFresh = sessionState.last_result_ids?.length &&
      (Date.now() - (sessionState.last_result_ts || 0)) < RESULT_TTL;
    if (resultsFresh) {
      const sel = parseInt(text, 10);
      if (!isNaN(sel) && sel >= 1 && sel <= sessionState.last_result_ids.length) {
        return await findHandler.handleBusinessSelected({ user, businessId: sessionState.last_result_ids[sel - 1], lang });
      }
    }

    // ── CITY REFINEMENT ───────────────────────────────────────
    const extractedCity = extractCity(normText);
    if (extractedCity && normText === extractedCity && sessionState.last_search) {
      return await refineSearchWithCity(user, extractedCity, lang);
    }

    // ── DETECT TOPIC (Claude) ─────────────────────────────────
    let conversationHistory = [];
    try { if (conversationId) conversationHistory = await db.getConversationHistory(conversationId); } catch {}

    const topic = await detectTopicSafe(message, lang);
    console.log(`[router] Claude: ${JSON.stringify(topic)} user=${user.whatsapp_id}`);

    if (!topic || (topic.type === 'unknown' && !topic.category_slug)) {
      if (extractedCity && sessionState.last_search) return await refineSearchWithCity(user, extractedCity, lang);
      return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
    }

    const isSubstantive = message.trim().split(/\s+/).length >= 2;
    if (topic.lang && topic.lang !== lang && isSubstantive) {
      db.updateUser(user.id, { language: topic.lang }).catch(() => {});
      lang = topic.lang;
    }

    switch (topic.type) {
      case 'category':
        return await handleCategory({ topic, user, message, lang, conversationId, conversationHistory });
      case 'pay':
        return await payHandler.handle({ user, message, lang, conversationHistory });
      case 'onboard':
        return await onboardHandler.handle({ user, message, lang, conversationHistory });
      case 'status':
        return await statusHandler.handle({ user, message, lang, conversationHistory });
      case 'greeting':
        return wa.sendGreeting(user.whatsapp_id, lang);
      default:
        return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
    }
  } catch (err) {
    console.error('[router] route error:', err.message, err.stack);
    try { await sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en); } catch {}
  }
}

// ════════════════════════════════════════════════════════════
// CATEGORY HANDLER
// ════════════════════════════════════════════════════════════
async function handleCategory({ topic, user, message, lang, conversationId, conversationHistory = [], forceMenu = false }) {
  const { category_slug, city, country } = topic;

  // Special menu categories — bypass DB lookup
  if (category_slug === 'services')     return await handleServicesMenu(user, lang);
  if (category_slug === 'car_services') return await handleCarMenu(user, lang);

  const sessionState    = user.session_state || {};
  const cat             = bySlug(category_slug);
  const allOptions      = getModeOptions(category_slug, lang);
  const resolvedCity    = city    || null;
  const resolvedCountry = country || user.location_country || null;

  if (!allOptions.length || !cat) return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);

  if (allOptions.length === 1) {
    try { await db.updateSessionState(user.id, { ...sessionState, last_category: category_slug }); } catch {}
    return dispatch(allOptions[0].handler, {
      user, message, lang, conversationHistory,
      category: category_slug, city: resolvedCity,
      userCity: user.location_city || null, country: resolvedCountry, mode: allOptions[0].mode,
    });
  }

  const menuText = buildModeMenu(cat, allOptions, lang);
  try { await db.updateSessionState(user.id, { ...sessionState, last_category: category_slug }); } catch {}
  await savePendingMode(user, { category_slug, city: resolvedCity, country: resolvedCountry, options: allOptions });
  return sendText(user.whatsapp_id, menuText);
}

// ════════════════════════════════════════════════════════════
// CITY REFINEMENT
// ════════════════════════════════════════════════════════════
async function refineSearchWithCity(user, city, lang) {
  const sessionState = user.session_state || {};
  const lastSearch   = sessionState.last_search;
  if (!lastSearch) return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  try {
    const { results: businesses, broadened, triedCity } = await db.searchBusinesses({
      query: lastSearch.query, categorySlug: lastSearch.categorySlug,
      city, country: lastSearch.country, limit: 5, offset: 0,
    });
    if (!businesses.length) {
      const noResults = {
        ht: `😔 Pa gen biznis nan *${city}* kounye a.\n\n_Eseye yon lòt vil oswa ekri *menu* pou retounen_`,
        en: `😔 No businesses in *${city}* yet.\n\n_Try another city or type *menu* to go back_`,
        fr: `😔 Aucun résultat à *${city}* pour l'instant.\n\n_Essayez une autre ville ou tapez *menu* pour revenir_`,
      };
      return sendText(user.whatsapp_id, noResults[lang] || noResults.en);
    }
    if (broadened && triedCity) {
      const note = {
        ht: `📍 Pa gen rezilta nan *${triedCity}* — men lòt biznis:\n\n`,
        en: `📍 None in *${triedCity}* yet — showing nearby results:\n\n`,
        fr: `📍 Aucun résultat à *${triedCity}* — voici d'autres résultats:\n\n`,
      };
      await sendText(user.whatsapp_id, note[lang] || note.en);
    }
    await db.updateSessionState(user.id, { ...sessionState, last_search: { ...lastSearch, city, offset: 0 } });
    return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, businesses.length === 5);
  } catch (err) {
    console.error('[router] refineSearchWithCity error:', err.message);
    return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  }
}

// ════════════════════════════════════════════════════════════
// SERVICES SUBMENU — 8 items
// ════════════════════════════════════════════════════════════
async function handleServicesMenu(user, lang) {
  const header = {
    ht: `🛠️ *Ki sèvis ou bezwen?*\nChwazi nan lis la oswa ekri nimewo a.`,
    en: `🛠️ *What service do you need?*\nChoose from the list or type a number.`,
    fr: `🛠️ *Quel service cherchez-vous?*\nChoisissez dans la liste ou tapez un numéro.`,
  };
  try {
    await db.updateSessionState(user.id, {
      ...(user.session_state || {}),
      pending_service_cat: { options: SERVICE_OPTIONS, expires_at: Date.now() + PENDING_TTL_MS },
    });
  } catch {}
  return wa.sendList(
    user.whatsapp_id, header[lang] || header.en,
    lang === 'ht' ? 'Wè sèvis yo' : lang === 'fr' ? 'Voir services' : 'View Services',
    [{ title: lang === 'ht' ? 'Sèvis disponib' : lang === 'fr' ? 'Services disponibles' : 'Available Services',
       rows: SERVICE_OPTIONS.map(s => ({ id: s.slug, title: `${s.icon} ${(s.label[lang] || s.label.en)}`.slice(0, 24), description: '' })) }]
  );
}

// ════════════════════════════════════════════════════════════
// CAR MENU — 7 subcategories (top-level category)
// ════════════════════════════════════════════════════════════
async function handleCarMenu(user, lang) {
  const header = {
    ht: `🚗 *Ki sèvis machin ou bezwen?*\nChwazi nan lis la:`,
    en: `🚗 *What car service do you need?*\nChoose from the list:`,
    fr: `🚗 *Quel service auto cherchez-vous?*\nChoisissez dans la liste:`,
  };
  try {
    await db.updateSessionState(user.id, {
      ...(user.session_state || {}),
      pending_car_cat: { options: CAR_OPTIONS, expires_at: Date.now() + PENDING_TTL_MS },
    });
  } catch {}
  return wa.sendList(
    user.whatsapp_id, header[lang] || header.en,
    lang === 'ht' ? 'Wè opsyon yo' : lang === 'fr' ? 'Voir options' : 'View Options',
    [{ title: lang === 'ht' ? 'Opsyon machin' : lang === 'fr' ? 'Options auto' : 'Car options',
       rows: CAR_OPTIONS.map(s => ({ id: s.slug, title: `${s.icon} ${(s.label[lang] || s.label.en)}`.slice(0, 24), description: '' })) }]
  );
}

// ════════════════════════════════════════════════════════════
// RESOLVE CAR CATEGORY
// ════════════════════════════════════════════════════════════
async function resolveCarCategory({ pending, message, user, lang, conversationId }) {
  if (Date.now() > pending.expires_at) return false;
  const normMsg = normalize(message);
  const num     = parseInt(message.trim(), 10);
  let selected  = null;

  if (!isNaN(num) && num >= 1 && num <= CAR_OPTIONS.length) {
    selected = CAR_OPTIONS.find(s => s.num === num) || null;
  }
  if (!selected) {
    selected = CAR_OPTIONS.find(s => s.slug === message.trim().toLowerCase()) || null;
  }
  if (!selected) {
    for (const opt of CAR_OPTIONS) {
      const labels = Object.values(opt.label).map(l => normalize(l));
      if (labels.some(l => normMsg.includes(l))) { selected = opt; break; }
    }
  }
  if (!selected) return false;

  await clearCarCategory(user);

  // Achte & Vann Machin → Solutions LLC premium spotlight (no DB search)
  if (selected.slug === 'achte_machin') {
    await wa.sendPremiumSpotlight(user.whatsapp_id, SOLUTIONS_LLC, lang);
    return true;
  }

  // All other subcategories → search DB by slug
  return await dispatch('find', {
    user, message, lang, conversationHistory: [],
    category: selected.slug,
    city:     null,
    userCity: user.location_city    || null,
    country:  user.location_country || null,
    mode:     'find',
  });
}

// ════════════════════════════════════════════════════════════
// RESOLVE SERVICE CATEGORY
// ════════════════════════════════════════════════════════════
async function resolveServiceCategory({ pending, message, user, lang, conversationId }) {
  if (Date.now() > pending.expires_at) return false;
  const normMsg = normalize(message);
  const num     = parseInt(message.trim(), 10);
  let selected  = null;

  if (!isNaN(num) && num >= 1 && num <= SERVICE_OPTIONS.length) {
    selected = SERVICE_OPTIONS.find(s => s.num === num) || null;
  }
  if (!selected) {
    selected = SERVICE_OPTIONS.find(s => s.slug === message.trim().toLowerCase()) || null;
  }
  if (!selected) {
    for (const svc of SERVICE_OPTIONS) {
      const labels = Object.values(svc.label).map(l => normalize(l));
      if (labels.some(l => normMsg.includes(l))) { selected = svc; break; }
    }
  }
  if (!selected) return false;

  await clearServiceCategory(user);
  return await dispatch('find', {
    user, message, lang, conversationHistory: [],
    category: selected.slug,
    city:     null,
    userCity: user.location_city    || null,
    country:  user.location_country || null,
    mode:     'find',
  });
}

// ════════════════════════════════════════════════════════════
// PENDING MODE RESOLUTION
// ════════════════════════════════════════════════════════════
async function resolvePendingMode({ pending, message, user, lang, conversationId }) {
  if (Date.now() > pending.expires_at) return false;
  if (message.trim().toLowerCase() === 'options') {
    await clearPendingMode(user);
    return await handleCategory({
      topic: { type: 'category', category_slug: pending.category_slug, city: pending.city, country: pending.country },
      user, message, lang, conversationId, forceMenu: true,
    });
  }
  const selected = parseSelection(message, pending.options, lang);
  if (!selected) return false;
  try {
    const state = user.session_state || {};
    await db.updateSessionState(user.id, {
      ...state,
      mode_preferences: { ...(state.mode_preferences || {}), [pending.category_slug]: selected.mode },
    });
  } catch {}
  await clearPendingMode(user);
  await dispatch(selected.handler, {
    user, message, lang, conversationHistory: [],
    category: pending.category_slug,
    city:     pending.city    || null,
    userCity: user.location_city    || null,
    country:  pending.country || user.location_country || null,
    mode:     selected.mode,
  });
  return true;
}

const MODE_KEYWORDS = { find: ['find', 'jwenn', 'trouver', 'chercher', 'search', 'chèche'] };

function parseSelection(message, options, lang) {
  const text = message.trim().toLowerCase();
  const num  = parseInt(text, 10);
  if (!isNaN(num) && num >= 1 && num <= options.length) return options.find(o => o.num === num) || null;
  for (const option of options) {
    const keywords = MODE_KEYWORDS[option.mode] || [];
    if (keywords.some(kw => text.includes(kw))) return option;
  }
  return null;
}

async function dispatch(handlerName, context) {
  const handler = HANDLERS[handlerName];
  if (!handler || typeof handler.handle !== 'function') {
    console.warn('[router] No handler for:', handlerName);
    return sendText(context.user.whatsapp_id, COPY.comingSoon[context.lang] || COPY.comingSoon.en);
  }
  try {
    return await handler.handle(context);
  } catch (err) {
    console.error(`[router] Handler ${handlerName} error:`, err.message, err.stack);
    return sendText(context.user.whatsapp_id, COPY.unknown[context.lang] || COPY.unknown.en);
  }
}

function buildModeMenu(cat, options, lang) {
  const header = {
    ht: `Ki sa w bezwen pou *${cat.name.ht}*? ${cat.icon}`,
    en: `What do you need for *${cat.name.en}*? ${cat.icon}`,
    fr: `Qu'avez-vous besoin pour *${cat.name.fr}*? ${cat.icon}`,
  };
  const back = { ht: `0. 🏠 Meni prensipal`, en: `0. 🏠 Main menu`, fr: `0. 🏠 Menu principal` };
  return `${header[lang] || header.en}\n\n${options.map(o => `${o.num}. ${o.label}`).join('\n')}\n${back[lang] || back.en}`;
}

// ════════════════════════════════════════════════════════════
// MORE RESULTS
// ════════════════════════════════════════════════════════════
async function showMoreResults(user, lang) {
  const sessionState = user.session_state || {};
  const lastSearch   = sessionState.last_search;
  if (!lastSearch) return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  const newOffset = (lastSearch.offset || 0) + 5;
  try {
    const { results: businesses } = await db.searchWithCluster({
      query: lastSearch.query, categorySlug: lastSearch.categorySlug,
      city: lastSearch.city, country: lastSearch.country, limit: 5, offset: newOffset,
    });
    if (!businesses.length) {
      const noMore = { ht: `📋 Pa gen plis rezilta.\n\n_Ekri *menu* pou retounen_`, en: `📋 No more results.\n\n_Type *menu* to go back_`, fr: `📋 Plus de résultats.\n\n_Tapez *menu* pour revenir_` };
      return sendText(user.whatsapp_id, noMore[lang] || noMore.en);
    }
    await db.updateSessionState(user.id, { ...sessionState, last_search: { ...lastSearch, offset: newOffset } });
    return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, businesses.length === 5, false);
  } catch (err) {
    console.error('[router] showMoreResults error:', err.message);
    return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  }
}

// ════════════════════════════════════════════════════════════
// SESSION HELPERS
// ════════════════════════════════════════════════════════════
async function savePendingMode(user, { category_slug, city, country, options }) {
  try {
    await db.updateSessionState(user.id, {
      ...user.session_state,
      pending_mode: { category_slug, city, country, options, expires_at: Date.now() + PENDING_TTL_MS },
    });
  } catch (err) { console.warn('[router] savePendingMode failed:', err.message); }
}

async function clearPendingMode(user) {
  try { const s = { ...(user.session_state || {}) }; delete s.pending_mode; await db.updateSessionState(user.id, s); } catch {}
}
async function clearServiceCategory(user) {
  try { const s = { ...(user.session_state || {}) }; delete s.pending_service_cat; await db.updateSessionState(user.id, s); } catch {}
}
async function clearCarCategory(user) {
  try { const s = { ...(user.session_state || {}) }; delete s.pending_car_cat; await db.updateSessionState(user.id, s); } catch {}
}

module.exports = { route, processMessage };
