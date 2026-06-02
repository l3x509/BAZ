'use strict';

// ============================================================
// BAZ + VITRIN — ROUTER
// ============================================================

const { detectTopic }              = require('./claude');
const { getModeOptions, bySlug }   = require('./config/categories');
const { sendText }                 = require('./whatsapp');
const db                           = require('./db');

// ── HANDLERS ─────────────────────────────────────────────────
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

const PENDING_TTL_MS     = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;

// ── COPY ─────────────────────────────────────────────────────
const COPY = {
  greeting: {
    ht: `👋 Byenvini nan*Baz* — Zone Biznis Ayisyen.\n\nEkri sa w bezwen, pa egzanp:\n\n💇 *cheve* — jwenn salon, achte oswa vann\n🍽️ *manje* — jwenn restoran\n🔧 *plonbye* — jwenn yon plonbye\n💸 *voye lajan* — voye lajan ann Ayiti\n👗 *rad* — mode ak fashon\n🛒 *komisyon* — livrezon manje\n\nOswa ekri nenpòt sa w bezwen!`,
    en: `👋 Welcome to *Baz* — The Haitian Business Zone.\n\nTell me what you need, for example:\n\n💇 *hair* — find a salon, buy or sell products\n🍽️ *food* — find a restaurant\n🔧 *plumber* — find a plumber\n💸 *send money* — send money to Haiti\n👗 *fashion* — clothing & accessories\n🛒 *grocery* — grocery delivery\n\nOr just type anything you need!`,
    fr: `👋 Je suis *Baz* — Zone Business Haitien.\n\nDites-moi ce dont vous avez besoin, par exemple:\n\n💇 *cheveux* — trouver un salon, acheter ou vendre\n🍽️ *restaurant* — trouver un restaurant\n🔧 *plombier* — trouver un plombier\n💸 *envoyer argent* — envoyer de l'argent en Haïti\n👗 *mode* — vêtements & accessoires\n\nOu écrivez simplement ce dont vous avez besoin!`,
  },
  unknown: {
    ht: `Mwen pa konprann. Eseye di m:\n• Sa w ap *chèche* (restoran, plonbye, chofè...)\n• Sa w vle *achte* oswa *vann*\n• Ou vle *voye lajan* ann Ayiti`,
    en: `I didn't catch that. Try:\n• What you're *looking for* (restaurant, plumber, driver...)\n• What you want to *buy* or *sell*\n• *Sending money* to Haiti`,
    fr: `Je n'ai pas compris. Essayez:\n• Ce que vous *cherchez* (restaurant, plombier...)\n• Ce que vous voulez *acheter* ou *vendre*\n• Envoyer de *l'argent en Haïti*`,
  },
  comingSoon: {
    ht: `⏳ Fonksyon sa a ap vini byento! Ekri yon lòt bagay.`,
    en: `⏳ This feature is coming soon! Type something else.`,
    fr: `⏳ Cette fonctionnalité arrive bientôt!`,
  },
};

// ── INJECTION PATTERNS ────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /forget\s+(everything|all|your|previous)/i,
  /new\s+instructions?\s*:/i,
];

function sanitize(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return null;
  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) {
      console.warn('[router] Potential injection detected:', text.slice(0, 80));
      break;
    }
  }
  return text;
}

// ════════════════════════════════════════════════════════════
// PROCESS MESSAGE — entry point from webhook.js
// ════════════════════════════════════════════════════════════

async function processMessage({ waId, displayName, messageId, messageType, content }) {
  const message = sanitize(content);
  if (!message) {
    console.log('[router] Empty or invalid message, skipping');
    return;
  }

  try {
    // Get or create user
    const user = await db.getOrCreateUser(waId, displayName);
    const lang = user.language || 'en';

    // Get or create conversation — wrapped so a Supabase failure
    // doesn't crash the process
    let conversation = null;
    try {
      conversation = await db.getActiveConversation(user.id);
      if (!conversation) {
        conversation = await db.createConversation(user.id, waId);
      }
    } catch (err) {
      console.warn('[router] Conversation fetch/create failed (non-fatal):', err.message);
    }

    // Conversation history for Claude context
    let conversationHistory = [];
    try {
      if (conversation?.id) {
        conversationHistory = await db.getConversationHistory(conversation.id);
      }
    } catch (err) {
      console.warn('[router] History fetch failed (non-fatal):', err.message);
    }

    // Log inbound message
    try {
      if (conversation?.id) {
        await db.logMessage({
          conversationId: conversation.id,
          userId:         user.id,
          direction:      'inbound',
          messageType,
          content:        message,
          metaMessageId:  messageId,
        });
      }
    } catch (err) {
      console.warn('[router] Message log failed (non-fatal):', err.message);
    }

    // Route
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
    const text = message.trim().toLowerCase();

    // ── BACK navigation ───────────────────────────────────────
    // "0", "back", "retounen" re-shows the last category menu
    const backWords = ['0', 'back', 'retounen', 'retour'];
    if (backWords.includes(text) && sessionState.last_category) {
      await clearPendingMode(user);
      return await handleCategory({
        topic: {
          type:          'category',
          category_slug: sessionState.last_category,
          city:          sessionState.last_search?.city    || null,
          country:       sessionState.last_search?.country || null,
        },
        user, message, lang, conversationHistory,
      });
    }

    // ── MORE results ──────────────────────────────────────────
    // "more", "plis", "plus" loads the next page of search results
    const moreWords = ['more', 'plis', 'plus', 'next', 'more results'];
    if (moreWords.some(k => text === k || text.startsWith(k + ' ')) && sessionState.last_search) {
      return await showMoreResults(user, lang);
    }

    // STEP 1 — Resolve pending mode selection
    if (sessionState.pending_mode) {
      const handled = await resolvePendingMode({
        pending: sessionState.pending_mode,
        message, user, lang, conversationHistory,
      });
      if (handled) return;
      await clearPendingMode(user);
    }

    // STEP 2 — Detect topic
    const topic = await detectTopic(message, lang);
    console.log(`[router] topic=${JSON.stringify(topic)} lang=${lang} user=${user.whatsapp_id}`);

    // STEP 3 — Route
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
        return await sendText(user.whatsapp_id, COPY.greeting[lang] || COPY.greeting.en);
      default:
        return await sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
    }
  } catch (err) {
    console.error('[router] route error:', err.message, err.stack);
    try {
      await sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
    } catch {}
  }
}

// ════════════════════════════════════════════════════════════
// CATEGORY HANDLER
// ════════════════════════════════════════════════════════════

async function handleCategory({ topic, user, message, lang, conversationHistory }) {
  const { category_slug, city, country } = topic;
  const options = getModeOptions(category_slug, lang);

  if (!options.length) {
    return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
  }

  // Single mode — route directly
  if (options.length === 1) {
    return dispatch(options[0].handler, {
      user, message, lang, conversationHistory,
      category: category_slug,
      city:     city    || null,
      country:  country || null,
      mode:     options[0].mode,
    });
  }

  // Multiple modes — show menu
  const cat      = bySlug(category_slug);
  const menuText = buildModeMenu(cat, options, lang);

  // Save last_category so "back" knows where to return
  try {
    await db.updateSessionState(user.id, {
      ...user.session_state,
      last_category: category_slug,
    });
  } catch {}
  await savePendingMode(user, { category_slug, city, country, options });
  return sendText(user.whatsapp_id, menuText);
}

// ════════════════════════════════════════════════════════════
// PENDING MODE RESOLUTION
// ════════════════════════════════════════════════════════════

async function resolvePendingMode({ pending, message, user, lang, conversationHistory }) {
  if (Date.now() > pending.expires_at) return false;

  const selected = parseSelection(message, pending.options, lang);
  if (!selected) return false;

  await clearPendingMode(user);
  await dispatch(selected.handler, {
    user, message, lang, conversationHistory,
    category: pending.category_slug,
    city:     pending.city    || null,
    country:  pending.country || null,
    mode:     selected.mode,
  });
  return true;
}

// ── SELECTION PARSER ─────────────────────────────────────────
const MODE_KEYWORDS = {
  find:  ['find', 'jwenn', 'trouver', 'chercher', 'search', 'chèche'],
  buy:   ['buy', 'achte', 'acheter', 'purchase', 'achète', 'shop'],
  sell:  ['sell', 'vann', 'vendre', 'list', 'vandè'],
  order: ['order', 'kòmande', 'commander', 'delivery', 'livrezon'],
};

function parseSelection(message, options, lang) {
  const text = message.trim().toLowerCase();
  const num  = parseInt(text, 10);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return options.find(o => o.num === num) || null;
  }
  for (const option of options) {
    const keywords = MODE_KEYWORDS[option.mode] || [];
    if (keywords.some(kw => text.includes(kw))) return option;
  }
  return null;
}

// ── DISPATCH ─────────────────────────────────────────────────
async function dispatch(handlerName, context) {
  const handler = HANDLERS[handlerName];
  if (!handler || typeof handler.handle !== 'function') {
    console.warn('[router] No handler for:', handlerName);
    return sendText(
      context.user.whatsapp_id,
      COPY.comingSoon[context.lang] || COPY.comingSoon.en
    );
  }
  try {
    return await handler.handle(context);
  } catch (err) {
    console.error(`[router] Handler ${handlerName} error:`, err.message, err.stack);
    return sendText(
      context.user.whatsapp_id,
      COPY.unknown[context.lang] || COPY.unknown.en
    );
  }
}

// ── MENU BUILDER ─────────────────────────────────────────────
function buildModeMenu(cat, options, lang) {
  const header = {
    ht: `Ki sa w bezwen pou *${cat.name.ht}*? ${cat.icon}`,
    en: `What do you need for *${cat.name.en}*? ${cat.icon}`,
    fr: `Qu'avez-vous besoin pour *${cat.name.fr}*? ${cat.icon}`,
  };
  const back = {
    ht: '0. 🔙 Retounen nan meni',
    en: '0. 🔙 Back to menu',
    fr: '0. 🔙 Retour au menu',
  };
  const list = options.map(o => `${o.num}. ${o.label}`).join('\n');
  return `${header[lang] || header.en}\n\n${list}\n${back[lang] || back.en}`;
}

// ── SESSION HELPERS ───────────────────────────────────────────
async function savePendingMode(user, { category_slug, city, country, options }) {
  try {
    await db.updateSessionState(user.id, {
      ...user.session_state,
      pending_mode: {
        category_slug,
        city:       city    || null,
        country:    country || null,
        options,
        expires_at: Date.now() + PENDING_TTL_MS,
      },
    });
  } catch (err) {
    console.warn('[router] savePendingMode failed (non-fatal):', err.message);
  }
}

async function clearPendingMode(user) {
  try {
    const state = { ...(user.session_state || {}) };
    delete state.pending_mode;
    await db.updateSessionState(user.id, state);
  } catch (err) {
    console.warn('[router] clearPendingMode failed (non-fatal):', err.message);
  }
}

// ── SHOW MORE RESULTS ────────────────────────────────────────
async function showMoreResults(user, lang) {
  const sessionState = user.session_state || {};
  const lastSearch   = sessionState.last_search;
  if (!lastSearch) return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);

  const newOffset = (lastSearch.offset || 0) + 5;
  const businesses = await db.searchBusinesses({
    query:        lastSearch.query,
    categorySlug: lastSearch.categorySlug,
    city:         lastSearch.city    || null,
    country:      lastSearch.country || null,
    limit:        5,
    offset:       newOffset,
  });

  if (!businesses.length) {
    const noMore = {
      ht: `📋 Pa gen plis rezilta.

_*0* pou retounen_`,
      en: `📋 No more results.

_*0* to go back_`,
      fr: `📋 Plus de résultats.

_*0* pour revenir_`,
    };
    return sendText(user.whatsapp_id, noMore[lang] || noMore.en);
  }

  // Update offset in session state
  try {
    await db.updateSessionState(user.id, {
      ...sessionState,
      last_search: { ...lastSearch, offset: newOffset },
    });
  } catch {}

  const wa = require('./whatsapp');
  const hasMore = businesses.length === 5;
  return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, hasMore);
}

module.exports = { route, processMessage };
