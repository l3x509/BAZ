'use strict';

const { detectTopic }            = require('./claude');
const { getModeOptions, bySlug } = require('./config/categories');
const { sendText }               = require('./whatsapp');
const wa                         = require('./whatsapp');
const db                         = require('./db');

const findHandler    = require('./handlers/find');
const payHandler     = require('./handlers/pay');
const onboardHandler = require('./handlers/onboard');
const statusHandler  = require('./handlers/status');

const HANDLERS = {
  find: findHandler,
  // vitrin_buy / vitrin_sell / vitrin_order removed — Vitrin is Phase 2
};

const PENDING_TTL_MS     = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;

// ── SERVICES SUBMENU ─────────────────────────────────────────
// Individual service worker slugs — accessed via the "sèvis" umbrella.
// Listed in the order they appear in the submenu.
const SERVICE_OPTIONS = [
  { num: 1,  slug: 'plumber',     icon: '🔧', label: { en: 'Plumber',          ht: 'Plonbye',    fr: 'Plombier'     }},
  { num: 2,  slug: 'electrician', icon: '⚡', label: { en: 'Electrician',       ht: 'Elektrisyen', fr: 'Électricien' }},
  { num: 3,  slug: 'contractor',  icon: '🏗️', label: { en: 'Contractor',        ht: 'Kontraktè',  fr: 'Entrepreneur' }},
  { num: 4,  slug: 'mechanic',    icon: '🔩', label: { en: 'Mechanic',          ht: 'Mekanisyen', fr: 'Mécanicien'   }},
  { num: 5,  slug: 'cleaner',     icon: '🧹', label: { en: 'Cleaning',          ht: 'Netwayaj',   fr: 'Nettoyage'    }},
  { num: 6,  slug: 'driver',      icon: '🚗', label: { en: 'Driver / Transport', ht: 'Transpò',   fr: 'Transport'    }},
  { num: 7,  slug: 'cook',        icon: '👨‍🍳', label: { en: 'Cook / Catering',   ht: 'Kizinyè',   fr: 'Traiteur'     }},
  { num: 8,  slug: 'tutor',       icon: '📚', label: { en: 'Tutor / School',    ht: 'Pwofesè',    fr: 'Tuteur'       }},
  { num: 9,  slug: 'medical',     icon: '🏥', label: { en: 'Medical',           ht: 'Medikal',    fr: 'Médical'      }},
  { num: 10, slug: 'real_estate', icon: '🏠', label: { en: 'Real Estate',       ht: 'Imobilye',   fr: 'Immobilier'   }},
];

// ── ALL CATEGORIES LIST — shown when user types "tout" ────────
const ALL_CATEGORIES_TEXT = {
  ht: `📋 *Tout kategori Baz:*\n\n💇 *cheve* — hair & beauty\n🍽️ *manje* — restaurant\n🛒 *komisyon* — grocery\n👗 *rad* — fashion\n⚖️ *avoka* — legal & immigration\n👶 *gadri* — childcare\n📦 *kago* — shipping to Haiti\n🧾 *taks* — tax & notary\n⛪ *legliz* — church & community\n🔧 *sèvis* — plumber, electrician & more\n📋 *lòt* — other services\n\n_Ekri non kategori a pou jwenn biznis._`,
  en: `📋 *All Baz categories:*\n\n💇 *hair* — hair & beauty\n🍽️ *food* — restaurant\n🛒 *grocery* — grocery store\n👗 *fashion* — clothing\n⚖️ *lawyer* — legal & immigration\n👶 *childcare* — daycare & preschool\n📦 *shipping* — cargo to Haiti\n🧾 *tax* — tax & notary\n⛪ *church* — church & community\n🔧 *services* — plumber, electrician & more\n📋 *other* — other services\n\n_Type any category to find businesses._`,
  fr: `📋 *Toutes les catégories Baz:*\n\n💇 *cheveux* — coiffure & beauté\n🍽️ *restaurant* — restaurant\n🛒 *épicerie* — épicerie\n👗 *mode* — vêtements\n⚖️ *avocat* — juridique & immigration\n👶 *garderie* — garde d'enfants\n📦 *expédition* — colis vers Haïti\n🧾 *impôts* — impôts & notaire\n⛪ *église* — église & communauté\n🔧 *services* — plombier, électricien & plus\n📋 *autre* — autres services\n\n_Tapez un nom de catégorie pour trouver des entreprises._`,
};

const COPY = {
  greeting: {
    ht: `👋 Byenvini nan *Baz* — Zone Biznis Ayisyen.\n\nEkri sa w bezwen:\n\n💇 *cheve* — hair & beauty\n🍽️ *manje* — restaurant\n⚖️ *avoka* — legal & immigration\n👶 *gadri* — childcare\n📦 *kago* — shipping to Haiti\n🧾 *taks* — tax & notary\n🔧 *sèvis* — plumber, electrician & more\n\n_Ekri *tout* pou wè tout kategori yo_`,
    en: `👋 Welcome to *Baz* — The Haitian Business Zone.\n\nTell me what you need:\n\n💇 *hair* — hair & beauty\n🍽️ *food* — restaurant\n⚖️ *lawyer* — legal & immigration\n👶 *childcare* — daycare & preschool\n📦 *shipping* — cargo to Haiti\n🧾 *tax* — tax & notary\n🔧 *services* — plumber, electrician & more\n\n_Type *all* to see all categories_`,
    fr: `👋 Bienvenir sur *Baz* — Zone Business Haitien.\n\nDites-moi ce dont vous avez besoin:\n\n💇 *cheveux* — coiffure & beauté\n🍽️ *restaurant* — restaurant\n⚖️ *avocat* — juridique & immigration\n👶 *garderie* — garde d'enfants\n📦 *expédition* — colis vers Haïti\n🧾 *impôts* — impôts & notaire\n🔧 *services* — plombier, électricien & plus\n\n_Tapez *tout* pour voir toutes les catégories_`,
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
    if (p.test(text)) { console.warn('[router] Potential injection:', text.slice(0, 80)); break; }
  }
  return text;
}

// ════════════════════════════════════════════════════════════
// PROCESS MESSAGE
// ════════════════════════════════════════════════════════════
async function processMessage({ waId, displayName, messageId, messageType, content }) {
  const message = sanitize(content);
  if (!message) return;

  try {
    const user = await db.getOrCreateUser(waId, displayName);
    let lang   = user.language || 'en';

    let conversation = null;
    try {
      conversation = await db.getActiveConversation(user.id);
      if (!conversation) conversation = await db.createConversation(user.id, waId);
    } catch (err) { console.warn('[router] Conversation error (non-fatal):', err.message); }

    let conversationHistory = [];
    try {
      if (conversation?.id) conversationHistory = await db.getConversationHistory(conversation.id);
    } catch {}

    try {
      if (conversation?.id) await db.logMessage({
        conversationId: conversation.id, userId: user.id,
        direction: 'inbound', messageType, content: message, metaMessageId: messageId,
      });
    } catch {}

    await route({ user, message, lang, conversationHistory });

  } catch (err) {
    console.error('[router] processMessage error:', err.message, err.stack);
  }
}

// ════════════════════════════════════════════════════════════
// ROUTE
// ════════════════════════════════════════════════════════════
async function route({ user, message, lang, conversationHistory }) {
  try {
    const sessionState = user.session_state || {};
    const text         = message.trim().toLowerCase();

    // ── BACK / 0 / MENU — always returns to main greeting ────
    const backWords = new Set(['0', 'back', 'retounen', 'retour', 'menu']);
    if (backWords.has(text)) {
      await clearPendingMode(user);
      await clearServiceCategory(user);
      return sendText(user.whatsapp_id, COPY.greeting[lang] || COPY.greeting.en);
    }

    // ── ALL CATEGORIES — show full category list ──────────────
    const allWords = new Set(['tout', 'all', 'tout kategori', 'all categories', 'categories', 'tout bagay']);
    if (allWords.has(text)) {
      return sendText(user.whatsapp_id, ALL_CATEGORIES_TEXT[lang] || ALL_CATEGORIES_TEXT.en);
    }

    // ── OPTIONS — force category menu re-show ─────────────────
    if (text === 'options' && sessionState.last_category) {
      await clearPendingMode(user);
      await clearServiceCategory(user);
      return await handleCategory({
        topic: { type: 'category', category_slug: sessionState.last_category, city: null, country: null },
        user, message, lang, conversationHistory,
        forceMenu: true,
      });
    }

    // ── MORE results ──────────────────────────────────────────
    const moreWords = new Set(['more', 'plis', 'plus', 'next']);
    if (moreWords.has(text) && sessionState.last_search) {
      return await showMoreResults(user, lang);
    }

    // ── Resolve pending SERVICE CATEGORY selection ────────────
    // Must run before pending_mode so number inputs go to right handler
    if (sessionState.pending_service_cat) {
      const handled = await resolveServiceCategory({
        pending: sessionState.pending_service_cat, message, user, lang, conversationHistory,
      });
      if (handled) return;
      await clearServiceCategory(user);
    }

    // ── Resolve pending mode selection ────────────────────────
    if (sessionState.pending_mode) {
      const handled = await resolvePendingMode({
        pending: sessionState.pending_mode, message, user, lang, conversationHistory,
      });
      if (handled) return;
      await clearPendingMode(user);
    }

    // ── Detect topic ──────────────────────────────────────────
    const topic = await detectTopic(message, lang);
    console.log(`[router] topic=${JSON.stringify(topic)} user=${user.whatsapp_id}`);

    // ── Auto-update language (only on multi-word messages) ────
    // Single words like "Boston", "0", city names must not override
    // the user's saved language mid-conversation.
    const isSubstantiveMessage = message.trim().split(/\s+/).length >= 2;
    if (topic.lang && topic.lang !== lang && isSubstantiveMessage) {
      try { await db.updateUser(user.id, { language: topic.lang }); } catch {}
      lang = topic.lang;
    }

    // ── Auto-save detected city as user location ──────────────
    if (topic.city && topic.city !== user.location_city) {
      try {
        await db.updateUser(user.id, {
          location_city: topic.city,
          location_country: topic.country || user.location_country,
        });
      } catch {}
    }

    switch (topic.type) {
      case 'category':
        return await handleCategory({ topic, user, message, lang, conversationHistory });
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
async function handleCategory({ topic, user, message, lang, conversationHistory, forceMenu = false, ignorePreference = false }) {
  const { category_slug, city, country } = topic;

  // ── Services umbrella → show service worker submenu ───────
  if (category_slug === 'services') {
    return await handleServicesMenu(user, lang);
  }

  const sessionState = user.session_state || {};
  const cat          = bySlug(category_slug);
  const allOptions   = getModeOptions(category_slug, lang);

  if (!allOptions.length || !cat) {
    return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  }

  const resolvedCity    = city    || user.location_city    || null;
  const resolvedCountry = country || user.location_country || null;

  // All categories are find-only now — single mode, dispatch directly
  if (allOptions.length === 1) {
    try {
      await db.updateSessionState(user.id, { ...sessionState, last_category: category_slug });
    } catch {}
    return dispatch(allOptions[0].handler, {
      user, message, lang, conversationHistory,
      category: category_slug,
      city:     resolvedCity,
      country:  resolvedCountry,
      mode:     allOptions[0].mode,
    });
  }

  // Multi-mode fallback (future-proofing)
  const menuText = buildModeMenu(cat, allOptions, lang);
  try {
    await db.updateSessionState(user.id, { ...sessionState, last_category: category_slug });
  } catch {}
  await savePendingMode(user, { category_slug, city: resolvedCity, country: resolvedCountry, options: allOptions });
  return sendText(user.whatsapp_id, menuText);
}

// ════════════════════════════════════════════════════════════
// SERVICES SUBMENU
// ════════════════════════════════════════════════════════════
async function handleServicesMenu(user, lang) {
  const header = {
    ht: `🔧 *Ki sèvis ou bezwen?*\n`,
    en: `🔧 *How can I help you?*\n`,
    fr: `🔧 *Comment puis je vous aider?*\n`,
  };
  const back = {
    ht: `0. 🏠 Meni prensipal`,
    en: `0. 🏠 Main menu`,
    fr: `0. 🏠 Menu principal`,
  };
  const list = SERVICE_OPTIONS
    .map(s => `${s.num}. ${s.icon} ${s.label[lang] || s.label.en}`)
    .join('\n');

  // Save pending service selection so next message resolves it
  try {
    await db.updateSessionState(user.id, {
      ...(user.session_state || {}),
      pending_service_cat: {
        options:    SERVICE_OPTIONS,
        expires_at: Date.now() + PENDING_TTL_MS,
      },
    });
  } catch (err) { console.warn('[router] handleServicesMenu save failed:', err.message); }

  return sendText(
    user.whatsapp_id,
    `${header[lang] || header.en}\n${list}\n${back[lang] || back.en}`
  );
}

// ════════════════════════════════════════════════════════════
// RESOLVE SERVICE CATEGORY SELECTION
// ════════════════════════════════════════════════════════════
async function resolveServiceCategory({ pending, message, user, lang, conversationHistory }) {
  if (Date.now() > pending.expires_at) return false;

  const text    = message.trim().toLowerCase();
  const num     = parseInt(text, 10);
  let selected  = null;

  // Numeric selection
  if (!isNaN(num) && num >= 1 && num <= SERVICE_OPTIONS.length) {
    selected = SERVICE_OPTIONS.find(s => s.num === num) || null;
  }

  // Text match against labels (all languages)
  if (!selected) {
    for (const svc of SERVICE_OPTIONS) {
      const labels = Object.values(svc.label).map(l => l.toLowerCase());
      if (labels.some(l => text.includes(l))) { selected = svc; break; }
    }
  }

  if (!selected) return false;

  await clearServiceCategory(user);

  return await dispatch('find', {
    user, message, lang, conversationHistory,
    category: selected.slug,
    city:     user.location_city    || null,
    country:  user.location_country || null,
    mode:     'find',
  });
}

// ════════════════════════════════════════════════════════════
// PENDING MODE RESOLUTION
// ════════════════════════════════════════════════════════════
async function resolvePendingMode({ pending, message, user, lang, conversationHistory }) {
  if (Date.now() > pending.expires_at) return false;

  if (message.trim().toLowerCase() === 'options') {
    await clearPendingMode(user);
    return await handleCategory({
      topic: { type: 'category', category_slug: pending.category_slug, city: pending.city, country: pending.country },
      user, message, lang, conversationHistory,
      forceMenu: true,
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
    user, message, lang, conversationHistory,
    category: pending.category_slug,
    city:     pending.city    || user.location_city    || null,
    country:  pending.country || user.location_country || null,
    mode:     selected.mode,
  });
  return true;
}

const MODE_KEYWORDS = {
  find: ['find', 'jwenn', 'trouver', 'chercher', 'search', 'chèche'],
};

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
  const back = {
    ht: `0. 🏠 Meni prensipal`,
    en: `0. 🏠 Main menu`,
    fr: `0. 🏠 Menu principal`,
  };
  const list = options.map(o => `${o.num}. ${o.label}`).join('\n');
  return `${header[lang] || header.en}\n\n${list}\n${back[lang] || back.en}`;
}

// ════════════════════════════════════════════════════════════
// MORE RESULTS
// ════════════════════════════════════════════════════════════
async function showMoreResults(user, lang) {
  const sessionState = user.session_state || {};
  const lastSearch   = sessionState.last_search;
  if (!lastSearch) return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);

  const newOffset  = (lastSearch.offset || 0) + 5;
  const businesses = await db.searchBusinesses({
    query: lastSearch.query, categorySlug: lastSearch.categorySlug,
    city: lastSearch.city, country: lastSearch.country,
    limit: 5, offset: newOffset,
  });

  if (!businesses.length) {
    const noMore = {
      ht: `📋 Pa gen plis rezilta.\n\n_Ekri *menu* pou retounen_`,
      en: `📋 No more results.\n\n_Type *menu* to go back_`,
      fr: `📋 Plus de résultats.\n\n_Tapez *menu* pour revenir_`,
    };
    return sendText(user.whatsapp_id, noMore[lang] || noMore.en);
  }

  try {
    await db.updateSessionState(user.id, {
      ...sessionState,
      last_search: { ...lastSearch, offset: newOffset },
    });
  } catch {}

  const hasMore = businesses.length === 5;
  return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, hasMore);
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
  try {
    const state = { ...(user.session_state || {}) };
    delete state.pending_mode;
    await db.updateSessionState(user.id, state);
  } catch {}
}

async function clearServiceCategory(user) {
  try {
    const state = { ...(user.session_state || {}) };
    delete state.pending_service_cat;
    await db.updateSessionState(user.id, state);
  } catch {}
}

module.exports = { route, processMessage };
