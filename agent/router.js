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

const HANDLERS = {
  find: findHandler,
};

const PENDING_TTL_MS     = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;
const CLAUDE_TIMEOUT_MS  = 8000;

// ════════════════════════════════════════════════════════════
// KEYWORD PRE-ROUTER
// Keys are stored normalized — lookups work with or without diacritics.
// e.g. 'kwafiè' and 'kwafie' both hit 'hair_beauty'.
// ════════════════════════════════════════════════════════════
const KEYWORD_MAP_RAW = {
  // Creole
  'cheve': 'hair_beauty', 'bote': 'hair_beauty', 'kwafiè': 'hair_beauty',
  'trese': 'hair_beauty', 'tres': 'hair_beauty', 'zong': 'hair_beauty',
  'manje': 'restaurant',  'restoran': 'restaurant', 'griyo': 'restaurant',
  'diri': 'restaurant',   'poul': 'restaurant',
  'avoka': 'legal',       'imigrasyon': 'legal',   'viza': 'legal',
  'gadri': 'childcare',   'timoun': 'childcare',   'ti moun': 'childcare',
  'kago': 'shipping',     'barèl': 'shipping',     'kolis': 'shipping',
  'taks': 'tax_notary',   'notè': 'tax_notary',
  'sèvis': 'services',
  'legliz': 'church',
  'komisyon': 'grocery',  'mache': 'grocery',
  'rad': 'fashion',       'mòd': 'fashion',
  'plonbye': 'plumber',   'tiyo': 'plumber',       'tuyò': 'plumber',
  'elektrisyen': 'electrician',
  'mekanisyen': 'mechanic',
  'netwayaj': 'cleaner',
  'transpò': 'driver',    'chofè': 'driver',       'taksi': 'driver',
  'kizinyè': 'cook',      'trètè': 'cook',         'boulanjri': 'cook',
  'pwofesè': 'tutor',     'lekòl': 'tutor',
  'doktè': 'medical',     'klinik': 'medical',     'famasi': 'medical',
  'imobilye': 'real_estate',
  // English
  'hair': 'hair_beauty',  'salon': 'hair_beauty',  'braids': 'hair_beauty',
  'nails': 'hair_beauty', 'barber': 'hair_beauty',
  'food': 'restaurant',   'restaurant': 'restaurant', 'eat': 'restaurant',
  'lawyer': 'legal',      'attorney': 'legal',     'immigration': 'legal',
  'childcare': 'childcare', 'daycare': 'childcare', 'preschool': 'childcare',
  'shipping': 'shipping', 'cargo': 'shipping',     'barrel': 'shipping',
  'tax': 'tax_notary',    'notary': 'tax_notary',  'taxes': 'tax_notary',
  'services': 'services',
  'church': 'church',
  'grocery': 'grocery',   'market': 'grocery',
  'fashion': 'fashion',   'clothing': 'fashion',
  'plumber': 'plumber',   'plumbing': 'plumber',
  'electrician': 'electrician',
  'mechanic': 'mechanic',
  'cleaning': 'cleaner',  'cleaner': 'cleaner',
  'driver': 'driver',     'transport': 'driver',
  'catering': 'cook',     'bakery': 'cook',        'chef': 'cook',
  'tutor': 'tutor',       'school': 'tutor',
  'medical': 'medical',   'doctor': 'medical',     'pharmacy': 'medical',
  'realtor': 'real_estate', 'real estate': 'real_estate',
  // French
  'cheveux': 'hair_beauty', 'coiffure': 'hair_beauty',
  'manger': 'restaurant',   'nourriture': 'restaurant',
  'avocat': 'legal',
  'garderie': 'childcare',
  'expédition': 'shipping',
  'impôts': 'tax_notary',   'notaire': 'tax_notary',
  'église': 'church',
  'épicerie': 'grocery',
  'mode': 'fashion',
};

// Pre-normalize all keys at startup — lookups are then O(1) regardless of diacritics
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
  '🚗': 'driver',      '🚌': 'driver',
  '🏠': 'real_estate', '🏡': 'real_estate',
};

// ════════════════════════════════════════════════════════════
// CITY EXTRACTOR
// All city names normalized at startup. extractCity() normalizes
// input before matching — works with/without accents.
// Sorted by length descending to avoid partial matches
// (e.g. 'west bridgewater' matched before 'bridgewater').
// ════════════════════════════════════════════════════════════
const KNOWN_CITIES_RAW = [
  // Greater Boston / South Shore
  'boston', 'brockton', 'mattapan', 'dorchester', 'randolph',
  'somerville', 'everett', 'malden', 'cambridge', 'stoughton',
  'hyde park', 'roxbury', 'quincy', 'lynn', 'lowell',
  'holbrook', 'west bridgewater', 'east bridgewater', 'bridgewater',
  'canton', 'sharon', 'easton', 'avon', 'abington', 'whitman',
  'hanover', 'norwood', 'westwood', 'dedham', 'milton',
  'chelsea', 'winthrop', 'revere', 'medford', 'woburn',
  'newton', 'brookline', 'waltham', 'watertown', 'framingham',
  'marlborough', 'worcester', 'springfield', 'lawrence', 'haverhill',
  // Florida
  'miami', 'miami gardens', 'north miami', 'miramar', 'pompano beach',
  'fort lauderdale', 'west palm beach', 'orlando', 'tampa',
  // New York
  'new york', 'brooklyn', 'bronx', 'queens', 'manhattan',
  'staten island', 'yonkers', 'mount vernon',
  // Canada
  'montreal', 'laval', 'longueuil',
  // Haiti
  'port-au-prince', 'pap', 'cap-haïtien', 'cap haitien',
  'gonaïves', 'gonaives', 'les cayes', 'jacmel', 'pétion-ville',
  'petion-ville', 'delmas', 'tabarre',
];

// Normalize all cities and sort longest first
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
    if (withoutCity && KEYWORD_MAP[withoutCity]) {
      return { slug: KEYWORD_MAP[withoutCity], city };
    }
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
const SERVICE_OPTIONS = [
  { num: 1,  slug: 'plumber',     icon: '🔧', label: { en: 'Plumber',           ht: 'Plonbye',    fr: 'Plombier'     }},
  { num: 2,  slug: 'electrician', icon: '⚡', label: { en: 'Electrician',        ht: 'Elektrisyen', fr: 'Électricien' }},
  { num: 3,  slug: 'contractor',  icon: '🏗️', label: { en: 'Contractor',         ht: 'Kontraktè',  fr: 'Entrepreneur' }},
  { num: 4,  slug: 'mechanic',    icon: '🔩', label: { en: 'Mechanic',           ht: 'Mekanisyen', fr: 'Mécanicien'   }},
  { num: 5,  slug: 'cleaner',     icon: '🧹', label: { en: 'Cleaning',           ht: 'Netwayaj',   fr: 'Nettoyage'    }},
  { num: 6,  slug: 'driver',      icon: '🚗', label: { en: 'Driver / Transport', ht: 'Transpò',    fr: 'Transport'    }},
  { num: 7,  slug: 'cook',        icon: '👨‍🍳', label: { en: 'Cook / Catering',    ht: 'Kizinyè',   fr: 'Traiteur'     }},
  { num: 8,  slug: 'tutor',       icon: '📚', label: { en: 'Tutor / School',     ht: 'Pwofesè',    fr: 'Tuteur'       }},
  { num: 9,  slug: 'medical',     icon: '🏥', label: { en: 'Medical',            ht: 'Medikal',    fr: 'Médical'      }},
  { num: 10, slug: 'real_estate', icon: '🏠', label: { en: 'Real Estate',        ht: 'Imobilye',   fr: 'Immobilier'   }},
];

const ALL_CATEGORIES_TEXT = {
  ht: `📋 *Tout kategori Baz:*\n\n💇‍♀️ *cheve* — hair & beauty\n🍲 *manje* — restaurant\n🛒 *komisyon* — grocery\n👗 *rad* — fashion\n⚖️ *avoka* — legal & immigration\n🧒 *gadri* — childcare\n🎉 *evènman* — upcoming events\n🚢 *kago* — shipping to Haiti\n💼 *taks* — tax & notary\n⛪ *legliz* — church & community\n🛠️ *sèvis* — plumber, electrician & more\n📋 *lòt* — other services\n\n_Ekri non kategori a pou jwenn biznis._`,
  en: `📋 *All Baz categories:*\n\n💇‍♀️ *hair* — hair & beauty\n🍲 *food* — restaurant\n🛒 *grocery* — grocery store\n👗 *fashion* — clothing\n⚖️ *lawyer* — legal & immigration\n🧒 *childcare* — daycare & preschool\n🎉 *events* — upcoming events\n🚢 *shipping* — cargo to Haiti\n💼 *tax* — tax & notary\n⛪ *church* — church & community\n🛠️ *services* — plumber, electrician & more\n📋 *other* — other services\n\n_Type any category to find businesses._`,
  fr: `📋 *Toutes les catégories Baz:*\n\n💇‍♀️ *cheveux* — coiffure & beauté\n🍲 *restaurant* — restaurant\n🛒 *épicerie* — épicerie\n👗 *mode* — vêtements\n⚖️ *avocat* — juridique & immigration\n🧒 *garderie* — garde d'enfants\n🎉 *événements* — événements à venir\n🚢 *expédition* — colis vers Haïti\n💼 *impôts* — impôts & notaire\n⛪ *église* — église & communauté\n🛠️ *services* — plombier, électricien & plus\n📋 *autre* — autres services\n\n_Tapez un nom de catégorie pour trouver des entreprises._`,
};

const COPY = {
  greeting: {
    ht: `👋 Byenvini nan *Baz* — Zone Biznis Ayisyen.\n\nEkri sa w bezwen:\n\n💇‍♀️ *cheve* — hair & beauty\n🍲 *manje* — restaurant\n⚖️ *avoka* — legal & immigration\n🧒 *gadri* — childcare\n🎉 *evènman* — upcoming events\n🚢 *kago* — shipping to Haiti\n💼 *taks* — tax & notary\n🛠️ *sèvis* — plumber, electrician & more\n\n_Ekri *tout* pou wè tout kategori yo_`,
    en: `👋 Welcome to *Baz* — The Haitian Business Zone.\n\nTell me what you need:\n\n💇‍♀️ *hair* — hair & beauty\n🍲 *food* — restaurant\n⚖️ *lawyer* — legal & immigration\n🧒 *childcare* — daycare & preschool\n🎉 *events* — upcoming events\n🚢 *shipping* — cargo to Haiti\n💼 *tax* — tax & notary\n🛠️ *services* — plumber, electrician & more\n\n_Type *all* to see all categories_`,
    fr: `👋 Bienvenir sur *Baz* — Zone Business Haitien.\n\nDites-moi ce dont vous avez besoin:\n\n💇‍♀️ *cheveux* — coiffure & beauté\n🍲 *restaurant* — restaurant\n⚖️ *avocat* — juridique & immigration\n🧒 *garderie* — garde d'enfants\n🎉 *événements* — événements à venir\n🚢 *expédition* — colis vers Haïti\n💼 *impôts* — impôts & notaire\n🛠️ *services* — plombier, électricien & plus\n\n_Tapez *tout* pour voir toutes les catégories_`,
  },
  unknown: {
    ht: `Mwen pa konprann. Eseye:\n• Ekri sa w *chèche* (restoran, avoka, cheve...)\n• *menu* — pou retounen nan meni prensipal\n• *tout* — pou wè tout kategori yo\n\n_Konsèy: ajoute vil la — "cheve Boston" oswa "avoka Brockton"_`,
    en: `I didn't catch that. Try:\n• What you're *looking for* (restaurant, lawyer, hair...)\n• *menu* — to go back to the main menu\n• *all* — to see all categories\n\n_Tip: include a city — "hair Boston" or "lawyer Brockton"_`,
    fr: `Je n'ai pas compris. Essayez:\n• Ce que vous *cherchez* (restaurant, avocat...)\n• *menu* — pour revenir au menu principal\n• *tout* — pour voir toutes les catégories\n\n_Conseil: précisez la ville — "cheveux Boston" ou "avocat Brockton"_`,
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
// Parallel fetch of user + conversation — saves ~200ms per message.
// logMessage is fire-and-forget — user response not blocked by it.
// conversationHistory is lazy — only loaded before Claude calls.
// ════════════════════════════════════════════════════════════
async function processMessage({ waId, displayName, messageId, messageType, content }) {
  const message = sanitize(content);
  if (!message) return;

  if (isDuplicateInbound(waId, message)) {
    console.log(`[router] Duplicate dropped: ${waId}`);
    return;
  }

  try {
    // ── Parallel: user + conversation fetched simultaneously ──
    const [user, existingConvo] = await Promise.all([
      db.getOrCreateUser(waId, displayName),
      db.getConversationByWaId(waId),
    ]);

    let lang = user.language || 'en';

    // ── Area code → city (new users only) ────────────────────
    if (!user.location_city) {
      const inferredCity = inferCityFromPhone(waId);
      if (inferredCity) {
        db.updateUser(user.id, { location_city: inferredCity })
          .then(updated => { if (updated) user.location_city = inferredCity; })
          .catch(() => {});
      }
    }

    // ── Ensure conversation exists ────────────────────────────
    let conversation = existingConvo;
    if (!conversation) {
      try { conversation = await db.createConversation(user.id, waId); } catch {}
    }

    // ── Log inbound message (fire-and-forget) ─────────────────
    // User response is NOT blocked by this write.
    if (conversation?.id) {
      db.logMessage({
        conversationId: conversation.id,
        userId:         user.id,
        direction:      'inbound',
        messageType,
        content:        message,
        metaMessageId:  messageId,
      });
    }

    // Pass conversationId so route() can lazy-load history if needed
    await route({ user, message, lang, conversationId: conversation?.id || null });

  } catch (err) {
    console.error('[router] processMessage error:', err.message, err.stack);
  }
}

// ════════════════════════════════════════════════════════════
// ROUTE
// text     = message lowercased (for nav checks)
// normText = message fully normalized (for keyword/city lookups)
// ════════════════════════════════════════════════════════════
async function route({ user, message, lang, conversationId }) {
  try {
    const sessionState = user.session_state || {};
    const text         = message.trim().toLowerCase();
    const normText     = normalize(message); // diacritics stripped, lowercased

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
        } catch (err) {
          return sendText(user.whatsapp_id, 'Error: ' + err.message);
        }
      }
    }

    // ── BACK / MENU ───────────────────────────────────────────
    const backWords = new Set(['0', 'back', 'retounen', 'retour', 'menu']);
    if (backWords.has(text)) {
      await clearPendingMode(user);
      await clearServiceCategory(user);
      return sendText(user.whatsapp_id, COPY.greeting[lang] || COPY.greeting.en);
    }

    // ── ALL CATEGORIES ────────────────────────────────────────
    const allWords = new Set(['tout', 'all', 'tout kategori', 'all categories', 'categories', 'tout bagay']);
    if (allWords.has(text)) {
      return sendText(user.whatsapp_id, ALL_CATEGORIES_TEXT[lang] || ALL_CATEGORIES_TEXT.en);
    }

    // ── OPTIONS ───────────────────────────────────────────────
    if (text === 'options' && sessionState.last_category) {
      await clearPendingMode(user);
      await clearServiceCategory(user);
      return await handleCategory({
        topic: { type: 'category', category_slug: sessionState.last_category, city: null, country: null },
        user, message, lang, conversationId, forceMenu: true,
      });
    }

    // ── MORE RESULTS ──────────────────────────────────────────
    const moreWords = new Set(['more', 'plis', 'plus', 'next']);
    if (moreWords.has(text) && sessionState.last_search) {
      return await showMoreResults(user, lang);
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
    // Normalize event words for matching
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
    if (text === 'stats' || text === 'estatistik') {
      return await findHandler.handleVendorStats({ user, lang });
    }

    // ── EMOJI MAP ─────────────────────────────────────────────
    // Check before name lookup — emojis are never business names
    if (EMOJI_MAP[message.trim()]) {
      const slug = EMOJI_MAP[message.trim()];
      console.log(`[router] Emoji: ${message.trim()} → ${slug}`);
      return await handleCategory({
        topic: { type: 'category', category_slug: slug, city: user.location_city || null, country: null },
        user, message, lang, conversationId,
      });
    }

    // ── KEYWORD PRE-ROUTER ────────────────────────────────────
    // Uses normalized text — works with/without diacritics
    const preRouted = preRoute(normText);
    if (preRouted) {
      console.log(`[router] Keyword: "${normText}" → ${preRouted.slug}${preRouted.city ? ' / ' + preRouted.city : ''}`);
      return await handleCategory({
        topic: {
          type: 'category',
          category_slug: preRouted.slug,
          city: preRouted.city || user.location_city || null,
          country: null,
        },
        user, message, lang, conversationId,
      });
    }

    // ── BUSINESS NAME LOOKUP ──────────────────────────────────
    // Only runs after keyword pre-router fails — avoids DB call
    // for the ~80% of messages that are category keywords.
    // Uses RPC with unaccent — "pibonan" finds "PiBonAn".
    if (normText.length >= 3) {
      try {
        const nameMatches = await db.findBusinessByName(normText);
        if (nameMatches?.length === 1) {
          console.log(`[router] Name match: "${normText}" → ${nameMatches[0].name}`);
          return await findHandler.handleBusinessSelected({ user, businessId: nameMatches[0].id, lang });
        }
        if (nameMatches?.length > 1) {
          console.log(`[router] Name ambiguous: ${nameMatches.length} matches for "${normText}"`);
          await db.updateSessionState(user.id, {
            ...sessionState,
            last_result_ids: nameMatches.map(b => b.id),
            last_search: { query: normText, categorySlug: null, city: null, offset: 0 },
          });
          return wa.sendBusinessResults(user.whatsapp_id, nameMatches, lang, false);
        }
      } catch (err) {
        console.warn('[router] findBusinessByName error (non-fatal):', err.message);
      }
    }

    // ── BUSINESS SELECTION — number after results ─────────────
    if (sessionState.last_result_ids?.length) {
      const sel = parseInt(text, 10);
      if (!isNaN(sel) && sel >= 1 && sel <= sessionState.last_result_ids.length) {
        return await findHandler.handleBusinessSelected({
          user, businessId: sessionState.last_result_ids[sel - 1], lang,
        });
      }
    }

    // ── SESSION-AWARE CITY REFINEMENT ─────────────────────────
    const extractedCity = extractCity(normText);
    if (extractedCity && normText === extractedCity && sessionState.last_search) {
      console.log(`[router] City refinement: ${extractedCity}`);
      return await refineSearchWithCity(user, extractedCity, lang);
    }

    // ── DETECT TOPIC (Claude) ─────────────────────────────────
    // Only reaches here for natural language queries.
    // Lazy-load conversation history only now — no cost for keyword hits.
    let conversationHistory = [];
    try {
      if (conversationId) conversationHistory = await db.getConversationHistory(conversationId);
    } catch {}

    const topic = await detectTopicSafe(message, lang);
    console.log(`[router] Claude: ${JSON.stringify(topic)} user=${user.whatsapp_id}`);

    if (!topic || (topic.type === 'unknown' && !topic.category_slug)) {
      if (extractedCity && sessionState.last_search) {
        return await refineSearchWithCity(user, extractedCity, lang);
      }
      return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
    }

    // Auto-update language (multi-word messages only)
    const isSubstantive = message.trim().split(/\s+/).length >= 2;
    if (topic.lang && topic.lang !== lang && isSubstantive) {
      db.updateUser(user.id, { language: topic.lang }).catch(() => {});
      lang = topic.lang;
    }

    // Auto-save detected city
    const detectedCity = topic.city || extractedCity || null;
    if (detectedCity && normalize(detectedCity) !== normalize(user.location_city || '')) {
      db.updateUser(user.id, {
        location_city:    detectedCity,
        location_country: topic.country || user.location_country,
      }).catch(() => {});
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
        return sendText(user.whatsapp_id, COPY.greeting[lang] || COPY.greeting.en);
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

  if (category_slug === 'services') return await handleServicesMenu(user, lang);

  const sessionState = user.session_state || {};
  const cat          = bySlug(category_slug);
  const allOptions   = getModeOptions(category_slug, lang);

  if (!allOptions.length || !cat) {
    return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  }

  const resolvedCity    = city    || user.location_city    || null;
  const resolvedCountry = country || user.location_country || null;

  if (allOptions.length === 1) {
    try { await db.updateSessionState(user.id, { ...sessionState, last_category: category_slug }); } catch {}
    return dispatch(allOptions[0].handler, {
      user, message, lang, conversationHistory,
      category: category_slug,
      city:     resolvedCity,
      country:  resolvedCountry,
      mode:     allOptions[0].mode,
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
    const businesses = await db.searchBusinesses({
      query:        lastSearch.query,
      categorySlug: lastSearch.categorySlug,
      city,
      country:      lastSearch.country,
      limit:        5,
      offset:       0,
    });

    if (!businesses.length) {
      const noResults = {
        ht: `📋 Pa gen rezilta pou *${city}*.\n\n_Eseye yon lòt vil oswa ekri *menu* pou retounen_`,
        en: `📋 No results in *${city}*.\n\n_Try another city or type *menu* to go back_`,
        fr: `📋 Aucun résultat à *${city}*.\n\n_Essayez une autre ville ou tapez *menu* pour revenir_`,
      };
      return sendText(user.whatsapp_id, noResults[lang] || noResults.en);
    }

    await db.updateSessionState(user.id, { ...sessionState, last_search: { ...lastSearch, city, offset: 0 } });
    return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, businesses.length === 5);
  } catch (err) {
    console.error('[router] refineSearchWithCity error:', err.message);
    return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  }
}

// ════════════════════════════════════════════════════════════
// SERVICES SUBMENU
// ════════════════════════════════════════════════════════════
async function handleServicesMenu(user, lang) {
  const header = { ht: `🛠️ *Ki sèvis ou bezwen?*\n`, en: `🛠️ *What service do you need?*\n`, fr: `🛠️ *Quel service cherchez-vous?*\n` };
  const back   = { ht: `0. 🏠 Meni prensipal`, en: `0. 🏠 Main menu`, fr: `0. 🏠 Menu principal` };
  const list   = SERVICE_OPTIONS.map(s => `${s.num}. ${s.icon} ${s.label[lang] || s.label.en}`).join('\n');
  try {
    await db.updateSessionState(user.id, {
      ...(user.session_state || {}),
      pending_service_cat: { options: SERVICE_OPTIONS, expires_at: Date.now() + PENDING_TTL_MS },
    });
  } catch {}
  return sendText(user.whatsapp_id, `${header[lang] || header.en}\n${list}\n${back[lang] || back.en}`);
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
    city:     user.location_city    || null,
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
    city:     pending.city    || user.location_city    || null,
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
    const businesses = await db.searchBusinesses({
      query: lastSearch.query, categorySlug: lastSearch.categorySlug,
      city:  lastSearch.city,  country: lastSearch.country,
      limit: 5, offset: newOffset,
    });
    if (!businesses.length) {
      const noMore = { ht: `📋 Pa gen plis rezilta.\n\n_Ekri *menu* pou retounen_`, en: `📋 No more results.\n\n_Type *menu* to go back_`, fr: `📋 Plus de résultats.\n\n_Tapez *menu* pour revenir_` };
      return sendText(user.whatsapp_id, noMore[lang] || noMore.en);
    }
    await db.updateSessionState(user.id, { ...sessionState, last_search: { ...lastSearch, offset: newOffset } });
    return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, businesses.length === 5);
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

module.exports = { route, processMessage };
