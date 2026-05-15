// ============================================================
// BAZ + VITRIN — ROUTER
// Two-step routing: topic detection → mode resolution → handler
//
// FLOW:
//   Message arrives
//     ↓
//   [Pending mode?] → user responded to a menu → resolve → dispatch
//     ↓ (no pending)
//   detectTopic() → what is this about?
//     ↓
//   Category?  → getModeOptions()
//     → 1 mode  → dispatch directly (no menu)
//     → N modes → present numbered menu, save pending state
//   Pay/Onboard/Status/Greeting → dispatch directly
//   Unknown → ask for clarification
//
// SESSION STATE (stored in users.session_state JSONB):
//   pending_mode: {
//     category_slug: 'hair_beauty',
//     options: [{ num, mode, label, handler }],
//     expires_at: <timestamp ms>
//   }
// ============================================================

const { detectTopic }                              = require('./claude');
const { getModeOptions, bySlug }                   = require('./config/categories');
const { sendText }                                 = require('./whatsapp');
const db                                           = require('./db');

// ── HANDLERS ────────────────────────────────────────────────
const findHandler    = require('./handlers/find');
const payHandler     = require('./handlers/pay');
const onboardHandler = require('./handlers/onboard');
const statusHandler  = require('./handlers/status');
const vitrinBuy      = require('./handlers/vitrin-buy');
const vitrinSell     = require('./handlers/vitrin-sell');
const vitrinOrder    = require('./handlers/vitrin-order');

// Handler registry — keyed by MODE_HANDLERS values in categories.js
const HANDLERS = {
  find:         findHandler,
  vitrin_buy:   vitrinBuy,
  vitrin_sell:  vitrinSell,
  vitrin_order: vitrinOrder,
};

// Pending mode menu expires after 5 minutes of inactivity
const PENDING_TTL_MS = 5 * 60 * 1000;

// ── GREETING COPY (by language) ──────────────────────────────
const GREETINGS = {
  ht: `Bonjou! 👋 Mwen se *Baz*.\n\nMwen ka ede w:\n• Jwenn biznis ak sèvis ann Ayiti 🔍\n• Achte ak vann pwodui sou Vitrin 🛍️\n• Peye bil ak voye lajan 💸\n\nEkri sa w bezwen epi m ap ede w!`,
  en: `Hello! 👋 I'm *Baz*.\n\nI can help you:\n• Find businesses & services in Haiti 🔍\n• Buy & sell products on Vitrin 🛍️\n• Pay bills & send money 💸\n\nJust tell me what you need!`,
  fr: `Bonjour! 👋 Je suis *Baz*.\n\nJe peux vous aider à:\n• Trouver des entreprises & services en Haïti 🔍\n• Acheter & vendre des produits sur Vitrin 🛍️\n• Payer des factures & envoyer de l'argent 💸\n\nDites-moi ce dont vous avez besoin!`,
};

// ── UNKNOWN COPY (by language) ───────────────────────────────
const UNKNOWN = {
  ht: `Mwen pa konprann. Eseye di m:\n• Sa w ap *chèche* (restoran, plonbye, chofè...)\n• Sa w vle *achte* oswa *vann*\n• Yon *sèvis* ou vle peye`,
  en: `I didn't quite catch that. Try telling me:\n• What you're *looking for* (restaurant, plumber, driver...)\n• What you want to *buy* or *sell*\n• A *service* you want to pay for`,
  fr: `Je n'ai pas compris. Essayez de me dire:\n• Ce que vous *cherchez* (restaurant, plombier, chauffeur...)\n• Ce que vous voulez *acheter* ou *vendre*\n• Un *service* que vous souhaitez payer`,
};

// ── COMING SOON COPY (for unbuilt handlers) ──────────────────
const COMING_SOON = {
  ht: `⏳ Fonksyon sa a ap vini byento! Ekri yon lòt bagay pou mwen ede w.`,
  en: `⏳ This feature is coming soon! Type something else and I'll help you.`,
  fr: `⏳ Cette fonctionnalité arrive bientôt! Écrivez autre chose pour que je vous aide.`,
};

// ════════════════════════════════════════════════════════════
// MAIN ROUTE FUNCTION
// Called by webhook.js for every incoming message
// ════════════════════════════════════════════════════════════

async function route({ user, message, lang, conversationHistory }) {
  const sessionState = user.session_state || {};

  // ── STEP 1: Resolve pending mode selection ─────────────────
  // User may be responding to a mode menu we sent previously
  if (sessionState.pending_mode) {
    const result = await resolvePendingMode({
      pending: sessionState.pending_mode,
      message,
      user,
      lang,
      conversationHistory,
    });

    // Resolved — handler already dispatched, we're done
    if (result === true) return;

    // Not a menu response — clear pending state and fall through
    await clearPendingMode(user);
  }

  // ── STEP 2: Detect topic ───────────────────────────────────
  const topic = await detectTopic(message, lang, conversationHistory);

  console.log(`[router] topic=${JSON.stringify(topic)} lang=${lang}`);

  // ── STEP 3: Route ──────────────────────────────────────────
  switch (topic.type) {

    case 'category':
      return handleCategory({
        slug: topic.category_slug,
        user, message, lang, conversationHistory,
      });

    case 'pay':
      return payHandler.handle({ user, message, lang, conversationHistory });

    case 'onboard':
      return onboardHandler.handle({ user, message, lang, conversationHistory });

    case 'status':
      return statusHandler.handle({ user, message, lang, conversationHistory });

    case 'greeting':
      return sendText(user.whatsapp_id, GREETINGS[lang] || GREETINGS.en);

    default:
      return sendText(user.whatsapp_id, UNKNOWN[lang] || UNKNOWN.en);
  }
}

// ════════════════════════════════════════════════════════════
// CATEGORY HANDLER
// Checks available modes and either routes directly or shows a menu
// ════════════════════════════════════════════════════════════

async function handleCategory({ slug, user, message, lang, conversationHistory }) {
  const options = getModeOptions(slug, lang);

  if (!options.length) {
    return sendText(user.whatsapp_id, UNKNOWN[lang] || UNKNOWN.en);
  }

  // Single mode — route directly, no menu friction
  if (options.length === 1) {
    return dispatch(options[0].handler, {
      user, message, lang, conversationHistory,
      category: slug,
      mode: options[0].mode,
    });
  }

  // Multiple modes — present numbered menu
  const cat = bySlug(slug);
  const menuText = buildModeMenu(cat, options, lang);

  await savePendingMode(user, slug, options);
  return sendText(user.whatsapp_id, menuText);
}

// ════════════════════════════════════════════════════════════
// PENDING MODE RESOLUTION
// User sent a follow-up to a mode menu
// ════════════════════════════════════════════════════════════

async function resolvePendingMode({ pending, message, user, lang, conversationHistory }) {
  // Expired — treat as a fresh message
  if (Date.now() > pending.expires_at) {
    return false;
  }

  const selected = parseSelection(message, pending.options, lang);

  if (!selected) {
    // User didn't pick from the menu — re-route their message fresh
    return false;
  }

  // Valid selection — dispatch to handler
  await dispatch(selected.handler, {
    user, message, lang, conversationHistory,
    category: pending.category_slug,
    mode: selected.mode,
  });

  return true; // signal: handled, stop processing
}

// ════════════════════════════════════════════════════════════
// SELECTION PARSER
// Accepts numbers ("1", "2", "3") or mode keywords in any language
// ════════════════════════════════════════════════════════════

const MODE_KEYWORDS = {
  find:         ['find', 'jwenn', 'trouver', 'chercher', 'search', 'chèche', 'look'],
  buy:          ['buy', 'achte', 'acheter', 'purchase', 'achète', 'shop'],
  sell:         ['sell', 'vann', 'vendre', 'list', 'vendor', 'vandè'],
  order:        ['order', 'kòmande', 'commander', 'delivery', 'livrezon', 'livraison'],
};

function parseSelection(message, options, lang) {
  const text = message.trim().toLowerCase();

  // Number match — most reliable (we present numbered lists)
  const num = parseInt(text, 10);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return options.find(o => o.num === num) || null;
  }

  // Keyword match across all languages
  for (const option of options) {
    const keywords = MODE_KEYWORDS[option.mode] || [];
    if (keywords.some(kw => text.includes(kw))) {
      return option;
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════
// HANDLER DISPATCH
// Routes to the right handler module
// ════════════════════════════════════════════════════════════

async function dispatch(handlerName, context) {
  const handler = HANDLERS[handlerName];

  if (!handler || typeof handler.handle !== 'function') {
    console.warn(`[router] No handler for: ${handlerName}`);
    return sendText(
      context.user.whatsapp_id,
      COMING_SOON[context.lang] || COMING_SOON.en
    );
  }

  return handler.handle(context);
}

// ════════════════════════════════════════════════════════════
// MODE MENU BUILDER
// Builds the WhatsApp-ready numbered option string
// ════════════════════════════════════════════════════════════

function buildModeMenu(cat, options, lang) {
  const prompts = {
    ht: `Ki sa w bezwen pou *${cat.name.ht}*? ${cat.icon}`,
    en: `What do you need for *${cat.name.en}*? ${cat.icon}`,
    fr: `Qu'avez-vous besoin pour *${cat.name.fr}*? ${cat.icon}`,
  };

  const header = prompts[lang] || prompts.en;
  const list   = options.map(o => `${o.num}. ${o.label}`).join('\n');

  return `${header}\n\n${list}`;
}

// ════════════════════════════════════════════════════════════
// SESSION STATE HELPERS
// ════════════════════════════════════════════════════════════

async function savePendingMode(user, slug, options) {
  await db.updateSessionState(user.id, {
    ...user.session_state,
    pending_mode: {
      category_slug: slug,
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

module.exports = { route };
