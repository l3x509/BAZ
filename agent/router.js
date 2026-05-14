const db = require('./db');
const wa = require('./whatsapp');
const { detectIntent, chat } = require('./claude');
const { handleFind, handleBusinessSelected, handleContactBusiness } = require('./handlers/find');
const { handlePay, handlePayConfirm, handlePayCancel } = require('./handlers/pay');
const { handleOnboard } = require('./handlers/onboard');
const { handleStatus } = require('./handlers/status');
const { emit } = require('./utils/events');

// ============================================================
// MAIN ENTRY POINT
// Called by webhook.js for every valid inbound message
// ============================================================

async function processMessage({ waId, displayName, messageId, messageType, content }) {
  // 1. Get or create user
  const user = await db.getOrCreateUser(waId, displayName);
  const lang = user.language || 'en';

  // 2. Get or create active conversation
  let conversation = await db.getActiveConversation(user.id);
  if (!conversation) {
    conversation = await db.createConversation(user.id, waId);
  }

  // 3. Log inbound message
  await db.logMessage({
    conversationId: conversation.id,
    userId: user.id,
    direction: 'inbound',
    messageType,
    content,
    metaMessageId: messageId,
  });

  // 4. Emit session event
  await emit('message_received', { user, conversation });

  // ============================================================
  // FIRST-TIME USER: language selection
  // ============================================================
  if (!user.language) {
    // Check if this is a language button reply
    if (content === 'lang_ht' || content === 'lang_en' || content === 'lang_fr') {
      const lang = content.replace('lang_', '');
      await db.setUserLanguage(user.id, lang);
      await emit('language_selected', { user, conversation, payload: { language: lang } });
      await sendWelcomeMessage(user, conversation, lang);
      return;
    }

    // Not yet set — send language selection
    await wa.sendLanguageSelection(waId);
    return;
  }

  // ============================================================
  // BUTTON / LIST REPLY ROUTING
  // Handle interactive responses first (they have structured IDs)
  // ============================================================
  if (messageType === 'button' || messageType === 'list') {
    await routeInteractive({ user, conversation, content, lang });
    return;
  }

  // ============================================================
  // IN-PROGRESS ONBOARDING
  // If user is mid-flow, continue that flow
  // ============================================================
  if (conversation.intent === 'onboard' && conversation.state?.onboard_step) {
    await handleOnboard({ user, conversation, content, lang });
    return;
  }

  // ============================================================
  // INTENT DETECTION
  // ============================================================
  const { intent, params } = await detectIntent(content, lang, buildHistory(conversation));

  // ============================================================
  // ROUTE BY INTENT
  // ============================================================
  switch (intent) {
    case 'find':
      await handleFind({ user, conversation, content, lang, params });
      break;

    case 'pay':
      await handlePay({ user, conversation, content, lang });
      break;

    case 'onboard':
      await handleOnboard({ user, conversation, content: 'start', lang });
      break;

    case 'status':
      await handleStatus({ user, conversation, lang });
      break;

    case 'greeting':
      await handleGreeting({ user, conversation, lang });
      break;

    default:
      // Fall back to general Claude conversation
      const reply = await chat(content, lang, buildHistory(conversation));
      await wa.sendText(waId, reply);
  }
}

// ============================================================
// INTERACTIVE BUTTON/LIST ROUTING
// ============================================================

async function routeInteractive({ user, conversation, content, lang }) {
  // Business selected from list
  if (content.startsWith('biz_')) {
    const businessId = content.replace('biz_', '');
    await handleBusinessSelected({ user, conversation, businessId, lang });
    return;
  }

  // Contact a business
  if (content.startsWith('contact_')) {
    const businessId = content.replace('contact_', '');
    await handleContactBusiness({ user, conversation, businessId, lang });
    return;
  }

  // Book a business
  if (content.startsWith('book_')) {
    const businessId = content.replace('book_', '');
    await wa.sendText(user.whatsapp_id, getMsg('booking_coming_soon', lang));
    return;
  }

  // Pay flow
  if (content === 'pay_confirm') {
    await handlePayConfirm({ user, conversation, lang });
    return;
  }

  if (content === 'pay_cancel') {
    await handlePayCancel({ user, conversation, lang });
    return;
  }

  // Onboard flow
  if (content === 'onboard_confirm' || content === 'onboard_cancel') {
    await handleOnboard({ user, conversation, content, lang });
    return;
  }

  // Category selected during onboarding
  if (content.startsWith('cat_')) {
    const slug = content.replace('cat_', '');
    await handleOnboard({ user, conversation, content: slug, lang });
    return;
  }

  // Unknown interactive — treat as text
  await processMessage({ waId: user.whatsapp_id, messageType: 'text', content });
}

// ============================================================
// GREETING
// ============================================================

async function handleGreeting({ user, conversation, lang }) {
  const name = user.name ? `, ${user.name.split(' ')[0]}` : '';
  const msgs = {
    ht: `👋 Bonjou${name}! Mwen se Baz.\n\nKijan mwen ka ede ou jodi a?\n\n• 🔍 Jwenn yon biznis (plonbye, chofè, pwofesè...)\n• 💸 Peye pou yon sèvis an Ayiti\n• 🏪 Anrejistre biznis ou`,
    en: `👋 Hey${name}! I'm Baz.\n\nHow can I help you today?\n\n• 🔍 Find a business (plumber, driver, tutor...)\n• 💸 Pay for a service in Haiti\n• 🏪 List your business`,
    fr: `👋 Bonjour${name}! Je suis Baz.\n\nComment puis-je vous aider?\n\n• 🔍 Trouver une entreprise (plombier, chauffeur, tuteur...)\n• 💸 Payer pour un service en Haïti\n• 🏪 Lister votre entreprise`,
  };
  await wa.sendText(user.whatsapp_id, msgs[lang] || msgs.en);
}

// ============================================================
// WELCOME MESSAGE (after language selected)
// ============================================================

async function sendWelcomeMessage(user, conversation, lang) {
  const msgs = {
    ht: `✅ *Bon chwazi!*\n\n👋 Byenveni sou *Baz* — anyè ak mache sèvis pou kominote ayisyen an.\n\nMwen ka ede ou:\n• 🔍 Jwenn yon biznis oswa pwofesyonèl\n• 💸 Peye pou sèvis an Ayiti (ekolaj, komisyon, elektrisite)\n• 🏪 Anrejistre pwòp biznis ou\n\nKomanse pale — di m sa ou bezwen!`,
    en: `✅ *Great choice!*\n\n👋 Welcome to *Baz* — the directory and marketplace for the Haitian community.\n\nI can help you:\n• 🔍 Find a business or professional\n• 💸 Pay for services in Haiti (school fees, groceries, electricity)\n• 🏪 List your own business\n\nJust tell me what you need!`,
    fr: `✅ *Excellent choix!*\n\n👋 Bienvenue sur *Baz* — l'annuaire et marketplace pour la communauté haïtienne.\n\nJe peux vous aider à:\n• 🔍 Trouver une entreprise ou un professionnel\n• 💸 Payer des services en Haïti (frais scolaires, courses, électricité)\n• 🏪 Inscrire votre propre entreprise\n\nDites-moi ce dont vous avez besoin!`,
  };
  await wa.sendText(user.whatsapp_id, msgs[lang] || msgs.en);
}

// ============================================================
// HELPERS
// ============================================================

function buildHistory(conversation) {
  // Lightweight — just the state context for now
  // Full message history would require a separate query
  return [];
}

function getMsg(key, lang) {
  const msgs = {
    booking_coming_soon: {
      ht: '📅 Fonksyon rezèvasyon an ap vini byento. Pou kounye a, kontakte biznis la dirèkteman.',
      en: '📅 Booking feature coming soon. For now, contact the business directly.',
      fr: '📅 La fonction de réservation arrive bientôt. Pour l\'instant, contactez l\'entreprise directement.',
    },
  };
  return msgs[key]?.[lang] || msgs[key]?.en || '';
}

module.exports = { processMessage };
