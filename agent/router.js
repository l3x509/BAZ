'use strict';

const { detectTopic }             = require('./claude');
const { getModeOptions, bySlug }  = require('./config/categories');
const { sendText }                = require('./whatsapp');
const wa                          = require('./whatsapp');
const db                          = require('./db');

const findHandler    = require('./handlers/find');
const payHandler     = require('./handlers/pay');
const onboardHandler = require('./handlers/onboard');
const statusHandler  = require('./handlers/status');
const vitrinBuy      = require('./handlers/vitrin-buy');
const vitrinSell     = require('./handlers/vitrin-sell');
const vitrinOrder    = require('./handlers/vitrin-order');

const HANDLERS = {
  find:         findHandler,
  vitrin_buy:   vitrinBuy,
  vitrin_sell:  vitrinSell,
  vitrin_order: vitrinOrder,
};

// Handlers that are stubs (coming soon) — filtered out of menus
const STUB_HANDLERS = new Set(['vitrin_buy', 'vitrin_sell', 'vitrin_order']);

const PENDING_TTL_MS     = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;

const COPY = {
  greeting: {
    ht: `Bonjou! 👋 Mwen se *Baz* — asistan ayisyen ou sou WhatsApp.\n\nEkri sa w bezwen, pa egzanp:\n\n💇 *cheve* — jwenn salon, achte oswa vann\n🍽️ *manje* — jwenn restoran\n🔧 *plonbye* — jwenn yon plonbye\n💸 *voye lajan* — voye lajan ann Ayiti\n👗 *rad* — mode ak fashon\n🛒 *komisyon* — livrezon manje\n\nOswa ekri nenpòt sa w bezwen!`,
    en: `Hello! 👋 I'm *Baz* — your Haitian community assistant on WhatsApp.\n\nTell me what you need, for example:\n\n💇 *hair* — find a salon, buy or sell products\n🍽️ *food* — find a restaurant\n🔧 *plumber* — find a plumber\n💸 *send money* — send money to Haiti\n👗 *fashion* — clothing & accessories\n🛒 *grocery* — grocery delivery\n\nOr just type anything you need!`,
    fr: `Bonjour! 👋 Je suis *Baz* — votre assistant haïtien sur WhatsApp.\n\nDites-moi ce dont vous avez besoin:\n\n💇 *cheveux* — trouver un salon, acheter ou vendre\n🍽️ *restaurant* — trouver un restaurant\n🔧 *plombier* — trouver un plombier\n💸 *envoyer argent* — envoyer de l'argent en Haïti\n\nOu écrivez simplement ce dont vous avez besoin!`,
  },
  unknown: {
    ht: `Mwen pa konprann. Eseye:\n• Ekri sa w *chèche* (restoran, plonbye, cheve...)\n• *voye lajan* — pou voye lajan ann Ayiti\n• *0* — pou retounen nan meni`,
    en: `I didn't catch that. Try:\n• What you're *looking for* (restaurant, plumber, hair...)\n• *send money* — to send money to Haiti\n• *0* — to go back to the menu`,
    fr: `Je n'ai pas compris. Essayez:\n• Ce que vous *cherchez* (restaurant, plombier...)\n• *envoyer argent* — pour envoyer de l'argent en Haïti\n• *0* — pour revenir au menu`,
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

    // ── BACK / 0 ─────────────────────────────────────────────
    const backWords = ['0', 'back', 'retounen', 'retour', 'menu'];
    if (backWords.includes(text)) {
      await clearPendingMode(user);
      // If they have a last category, re-show that menu; else show greeting
      if (sessionState.last_category) {
        return await handleCategory({
          topic: {
            type: 'category',
            category_slug: sessionState.last_category,
            city: null, country: null,
          },
          user, message, lang, conversationHistory,
          forceMenu: false,       // still filter stubs on back
          ignorePreference: true, // but always show menu (ignore saved mode preference)
        });
      }
      return sendText(user.whatsapp_id, COPY.greeting[lang] || COPY.greeting.en);
    }

    // ── MORE results ──────────────────────────────────────────
    const moreWords = ['more', 'plis', 'plus', 'next'];
    if (moreWords.includes(text) && sessionState.last_search) {
      return await showMoreResults(user, lang);
    }

    // ── Resolve pending mode selection ────────────────────────
    if (sessionState.pending_mode) {
      const handled = await resolvePendingMode({ pending: sessionState.pending_mode, message, user, lang, conversationHistory });
      if (handled) return;
      await clearPendingMode(user);
    }

    // ── Detect topic ──────────────────────────────────────────
    const topic = await detectTopic(message, lang);
    console.log(`[router] topic=${JSON.stringify(topic)} user=${user.whatsapp_id}`);

    // ── Auto-update language ──────────────────────────────────
    if (topic.lang && topic.lang !== lang) {
      try { await db.updateUser(user.id, { language: topic.lang }); } catch {}
      lang = topic.lang;
    }

    // ── Auto-save detected city as user location ──────────────
    if (topic.city && topic.city !== user.location_city) {
      try { await db.updateUser(user.id, { location_city: topic.city, location_country: topic.country || user.location_country }); } catch {}
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
  const sessionState = user.session_state || {};
  const cat          = bySlug(category_slug);
  const allOptions   = getModeOptions(category_slug, lang);

  if (!allOptions.length || !cat) return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);

  // Filter out stub handlers — only show modes that actually work
  const options = forceMenu
    ? allOptions
    : allOptions.filter(o => !STUB_HANDLERS.has(o.handler));

  // ALL modes are stubs → single coming-soon message, no menu
  if (!options.length) {
    const msg = {
      ht: `🛍️ *${cat.name.ht}* ap vini sou Vitrin byento!\n\nVandè ayisyen yo pral ka vann dirèkteman sou WhatsApp. Rete tann!\n\n_Ekri *0* pou retounen_`,
      en: `🛍️ *${cat.name.en}* is coming soon on Vitrin!\n\nHaitian vendors will sell directly through WhatsApp. Stay tuned!\n\n_Type *0* to go back_`,
      fr: `🛍️ *${cat.name.fr}* arrive bientôt sur Vitrin!\n\nLes vendeurs haïtiens vendront directement sur WhatsApp.\n\n_Tapez *0* pour revenir_`,
    };
    return sendText(user.whatsapp_id, msg[lang] || msg.en);
  }

  const resolvedCity    = city    || user.location_city    || null;
  const resolvedCountry = country || user.location_country || null;

  // Single real mode → dispatch directly, no menu
  if (options.length === 1) {
    return dispatch(options[0].handler, {
      user, message, lang, conversationHistory,
      category: category_slug,
      city:     resolvedCity,
      country:  resolvedCountry,
      mode:     options[0].mode,
    });
  }

  // If user has a saved mode preference AND not ignoring it → skip menu
  if (!forceMenu && !ignorePreference && sessionState.mode_preferences?.[category_slug]) {
    const preferredMode = sessionState.mode_preferences[category_slug];
    const preferred     = options.find(o => o.mode === preferredMode);
    if (preferred) {
      const hint = {
        ht: `_Ekri *options* pou wè tout chwa yo_`,
        en: `_Type *options* to see all choices_`,
        fr: `_Tapez *options* pour voir tous les choix_`,
      };
      await dispatch(preferred.handler, {
        user, message, lang, conversationHistory,
        category: category_slug,
        city:     resolvedCity,
        country:  resolvedCountry,
        mode:     preferred.mode,
      });
      setTimeout(() => {
        sendText(user.whatsapp_id, hint[lang] || hint.en).catch(() => {});
      }, 1500);
      return;
    }
  }

  // Show mode menu with real options only
  const menuText = buildModeMenu(cat, options, lang);

  try {
    await db.updateSessionState(user.id, {
      ...sessionState,
      last_category: category_slug,
    });
  } catch {}

  await savePendingMode(user, { category_slug, city: resolvedCity, country: resolvedCountry, options });
  return sendText(user.whatsapp_id, menuText);
}

// ════════════════════════════════════════════════════════════
// PENDING MODE RESOLUTION
// ════════════════════════════════════════════════════════════
async function resolvePendingMode({ pending, message, user, lang, conversationHistory }) {
  if (Date.now() > pending.expires_at) return false;

  // "options" overrides preference and forces menu re-show
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

  // Save mode preference for this category
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
  find:  ['find', 'jwenn', 'trouver', 'chercher', 'search', 'chèche'],
  buy:   ['buy', 'achte', 'acheter', 'purchase'],
  sell:  ['sell', 'vann', 'vendre'],
  order: ['order', 'kòmande', 'commander', 'delivery'],
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
    ht: `0. 🔙 Retounen`,
    en: `0. 🔙 Back`,
    fr: `0. 🔙 Retour`,
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
      ht: `📋 Pa gen plis rezilta.\n\n_Ekri *0* pou retounen_`,
      en: `📋 No more results.\n\n_Type *0* to go back_`,
      fr: `📋 Plus de résultats.\n\n_Tapez *0* pour revenir_`,
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

module.exports = { route, processMessage };
