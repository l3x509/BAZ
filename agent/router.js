// ============================================================
// BAZ + VITRIN — ROUTER
//
// Two-step routing: topic detection → mode resolution → handler
//
// FLOW:
//   processMessage()            ← called by webhook.js
//     → sanitize input
//     → get/create user
//     → get conversation history
//     → route()
//         → pending mode?  → resolve selection → dispatch
//         → detectTopic()  → category | pay | onboard | status | greeting
//             → category, 1 mode  → dispatch directly
//             → category, N modes → present menu, save pending state
//             → pay/onboard/status/greeting → dispatch directly
//
// SESSION STATE (users.session_state JSONB):
//   pending_mode: {
//     category_slug: string,
//     city:          string | null,   ← preserved from original message
//     country:       string | null,
//     options:       [{ num, mode, label, handler }],
//     expires_at:    number (ms timestamp)
//   }
// ============================================================

'use strict';

const { detectTopic }          = require('./claude');
const { getModeOptions, bySlug } = require('./config/categories');
const { sendText }             = require('./whatsapp');
const db                       = require('./db');

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

// Pending mode menu expires after 5 minutes
const PENDING_TTL_MS = 5 * 60 * 1000;

// Max message length we'll process (WhatsApp max is 4096)
const MAX_MESSAGE_LENGTH = 1000;

// ── COPY ─────────────────────────────────────────────────────
const COPY = {
  greeting: {
    ht: `Bonjou! 👋 Mwen se *Baz*.\n\nMwen ka ede w:\n• Jwenn biznis ak sèvis ann Ayiti 🔍\n• Achte ak vann sou Vitrin 🛍️\n• Voye lajan ann Ayiti 💸\n\nEkri sa w bezwen!`,
    en: `Hello! 👋 I'm *Baz*.\n\nI can help you:\n• Find businesses & services in Haiti 🔍\n• Buy & sell on Vitrin 🛍️\n• Send money to Haiti 💸\n\nJust tell me what you need!`,
    fr: `Bonjour! 👋 Je suis *Baz*.\n\nJe peux vous aider à:\n• Trouver des entreprises en Haïti 🔍\n• Acheter & vendre sur Vitrin 🛍️\n• Envoyer de l'argent en Haïti 💸\n\nDites-moi ce dont vous avez besoin!`,
  },
  unknown: {
    ht: `Mwen pa konprann. Eseye di m:\n• Sa w ap *chèche* (restoran, plonbye, chofè...)\n• Sa w vle *achte* oswa *vann*\n• Ou vle *voye lajan* ann Ayiti`,
    en: `I didn't catch that. Try:\n• What you're *looking for* (restaurant, plumber, driver...)\n• What you want to *buy* or *sell*\n• Sending *money to Haiti*`,
    fr: `Je n'ai pas compris. Essayez:\n• Ce que vous *cherchez* (restaurant, plombier, chauffeur...)\n• Ce que vous voulez *acheter* ou *vendre*\n• Envoyer de *l'argent en Haïti*`,
  },
  comingSoon: {
    ht: `⏳ Fonksyon sa a ap vini byento! Ekri yon lòt bagay.`,
    en: `⏳ This feature is coming soon! Type something else.`,
    fr: `⏳ Cette fonctionnalité arrive bientôt! Écrivez autre chose.`,
  },
};

// ── INJECTION PATTERNS ────────────────────────────────────────
// Heuristic detection only — Claude's system prompt takes priority,
// but we log suspicious messages for monitoring.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /forget\s+(everything|all|your|previous)/i,
  /new\s+instructions?\s*:/i,
  /\[SYSTEM\]/i,
  /<<SYS>>/i,
];

// ════════════════════════════════════════════════════════════
// INPUT SANITIZATION
// Call this on every raw message before processing.
// ════════════════════════════════════════════════════════════

function sanitize(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Trim and enforce length cap
  let text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);

  if (!text) return null;

  // Log potential prompt injection attempts (don't block — Claude's
  // system prompt is authoritative, but we want visibility)
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      console.warn('[router] Potential injection detected:', text.slice(0, 120));
      break;
    }
  }

  return text;
}

// ════════════════════════════════════════════════════════════
// PROCESS MESSAGE
// Entry point called by webhook.js.
// ════════════════════════════════════════════════════════════

async function processMessage({ waId, displayName, messageId, messageType, content }) {
  // Sanitize first — before any DB or API calls
  const message = sanitize(content);
  if (!message) {
    console.log('[router] Empty or invalid message, skipping');
    return;
  }

  // Get or create user
  const user = await db.getOrCreateUser(waId, displayName);
  const lang = user.language || 'en';

  // Get or create active conversation
  let conversation = await db.getActiveConversation(user.id);
  if (!conversation) {
    conversation = await db.createConversation(user.id, waId);
  }

  // Pull recent messages as Claude context
  const conversationHistory = await db.getConversationHistory(conversation.id);

  // Log inbound message with correct signature
  await db.logMessage({
    conversationId: conversation.id,
    userId:         user.id,
    direction:      'inbound',
    messageType,
    content:        message,
    metaMessageId:  messageId,
  });

  // Route
  await route({ user, message, lang, conversationHistory });
}

// ════════════════════════════════════════════════════════════
// ROUTE
// ════════════════════════════════════════════════════════════

async function route({ user, message, lang, conversationHistory }) {
  const sessionState = user.session_state || {};

  // STEP 1 — Resolve pending mode selection
  if (sessionState.pending_mode) {
    const handled = await resolvePendingMode({
      pending: sessionState.pending_mode,
      message,
      user,
      lang,
      conversationHistory,
    });
    if (handled) return;
    // Not a menu response — clear and fall through to fresh routing
    await clearPendingMode(user);
  }

  // STEP 2 — Detect topic (single API call: intent + category + location)
  const topic = await detectTopic(message, lang, conversationHistory);

  console.log(`[router] topic=${JSON.stringify(topic)} lang=${lang} user=${user.whatsapp_id}`);

  // STEP 3 — Route
  switch (topic.type) {
    case 'category':
      return handleCategory({ topic, user, message, lang, conversationHistory });

    case 'pay':
      return payHandler.handle({ user, message, lang, conversationHistory });

    case 'onboard':
      return onboardHandler.handle({ user, message, lang, conversationHistory });

    case 'status':
      return statusHandler.handle({ user, message, lang, conversationHistory });

    case 'greeting':
      return sendText(user.whatsapp_id, COPY.greeting[lang] || COPY.greeting.en);

    default:
      return sendText(user.whatsapp_id, COPY.unknown[lang] || COPY.unknown.en);
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

  // Single mode — dispatch directly, no menu
  if (options.length === 1) {
    return dispatch(options[0].handler, {
      user, message, lang, conversationHistory,
      category: category_slug,
      city:     city   || null,
      country:  country || null,
      mode:     options[0].mode,
    });
  }

  // Multiple modes — present menu, save pending state with location
  const cat      = bySlug(category_slug);
  const menuText = buildModeMenu(cat, options, lang);

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

  // Pass location preserved from the original message
  await dispatch(selected.handler, {
    user, message, lang, conversationHistory,
    category: pending.category_slug,
    city:     pending.city    || null,
    country:  pending.country || null,
    mode:     selected.mode,
  });

  return true;
}

// ════════════════════════════════════════════════════════════
// SELECTION PARSER
// Accepts numbers (1/2/3) or mode keywords in any language
// ════════════════════════════════════════════════════════════

const MODE_KEYWORDS = {
  find:        ['find', 'jwenn', 'trouver', 'chercher', 'search', 'chèche'],
  buy:         ['buy', 'achte', 'acheter', 'purchase', 'achète', 'shop'],
  sell:        ['sell', 'vann', 'vendre', 'list', 'vandè'],
  order:       ['order', 'kòmande', 'commander', 'delivery', 'livrezon'],
};

function parseSelection(message, options, lang) {
  const text = message.trim().toLowerCase();

  // Number match — most reliable
  const num = parseInt(text, 10);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return options.find(o => o.num === num) || null;
  }

  // Keyword match
  for (const option of options) {
    const keywords = MODE_KEYWORDS[option.mode] || [];
    if (keywords.some(kw => text.includes(kw))) return option;
  }

  return null;
}

// ════════════════════════════════════════════════════════════
// DISPATCH
// ════════════════════════════════════════════════════════════

async function dispatch(handlerName, context) {
  const handler = HANDLERS[handlerName];

  if (!handler || typeof handler.handle !== 'function') {
    console.warn('[router] No handler for:', handlerName);
    return sendText(
      context.user.whatsapp_id,
      COPY.comingSoon[context.lang] || COPY.comingSoon.en
    );
  }

  return handler.handle(context);
}

// ════════════════════════════════════════════════════════════
// MENU BUILDER
// ════════════════════════════════════════════════════════════

function buildModeMenu(cat, options, lang) {
  const header = {
    ht: `Ki sa w bezwen pou *${cat.name.ht}*? ${cat.icon}`,
    en: `What do you need for *${cat.name.en}*? ${cat.icon}`,
    fr: `Qu'avez-vous besoin pour *${cat.name.fr}*? ${cat.icon}`,
  };
  const list = options.map(o => `${o.num}. ${o.label}`).join('\n');
  return `${header[lang] || header.en}\n\n${list}`;
}

// ════════════════════════════════════════════════════════════
// SESSION HELPERS
// ════════════════════════════════════════════════════════════

async function savePendingMode(user, { category_slug, city, country, options }) {
  await db.updateSessionState(user.id, {
    ...user.session_state,
    pending_mode: {
      category_slug,
      city:       city   || null,
      country:    country || null,
      options,
      expires_at: Date.now() + PENDING_TTL_MS,
    },
  });
}

async function clearPendingMode(user) {
  const state = { ...(user.session_state || {}) };
  delete state.pending_mode;
  await db.updateSessionState(user.id, state);
}

module.exports = { route, processMessage };
