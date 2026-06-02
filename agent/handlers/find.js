const db = require('../db');
const wa = require('../whatsapp');
const { chat } = require('../claude');
const { emit } = require('../utils/events');

// ============================================================
// FIND HANDLER
// Entry point called by router.js: handler.handle(context)
//
// Context shape from router:
//   { user, message, lang, conversationHistory,
//     category, city, country, mode }
//
// category, city, country are already extracted by detectTopic()
// in claude.js — no second Claude API call needed here.
// ============================================================

async function handle({ user, message, lang, conversationHistory, category, city, country, mode }) {
  // Get or create active conversation
  let conversation = await db.getActiveConversation(user.id);
  if (!conversation) {
    conversation = await db.createConversation(user.id, user.whatsapp_id, 'find');
  }

  // Search using params already extracted by the router
  // category, city, country come directly from detectTopic() — no extra API call
  const businesses = await db.searchBusinesses({
    query:        message,
    categorySlug: category || null,
    city:         city     || null,
    country:      country  || null,
    limit: 5,
  });

  // Log search event (TwinZile — off by default)
  await emit('search_performed', {
    user,
    conversation,
    payload: {
      query:        message,
      category,
      city,
      country,
      result_count: businesses.length,
    },
  });

  if (!businesses.length) {
    const noResults = {
      ht: `😔 Mwen pa jwenn okenn biznis ki koresponn ak rechèch ou a.\n\nEsaye ak yon lòt mo, oswa di m plis sou sa ou bezwen.`,
      en: `😔 No businesses found matching your search.\n\nTry different terms, or tell me more about what you need.`,
      fr: `😔 Aucune entreprise trouvée correspondant à votre recherche.\n\nEssayez d'autres termes, ou dites-moi ce dont vous avez besoin.`,
    };
    await wa.sendText(user.whatsapp_id, noResults[lang] || noResults.en);
    return;
  }

  // Store results in conversation context for follow-up selections
  await db.updateConversation(conversation.id, {
    intent: 'find',
    context: {
      ...conversation.context,
      last_search:  { category, city, country, query: message },
      last_results: businesses.map(b => b.id),
    },
  });

  // Send formatted results
  await wa.sendBusinessResults(user.whatsapp_id, businesses, lang);
}

// ============================================================
// BUSINESS SELECTED
// User tapped on a business from the results list
// ============================================================

async function handleBusinessSelected({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);

  if (!business) {
    const err = {
      ht: 'Mwen pa ka jwenn biznis sa a. Tanpri eseye ankò.',
      en: 'Could not find that business. Please try again.',
      fr: 'Impossible de trouver cette entreprise. Veuillez réessayer.',
    };
    await wa.sendText(user.whatsapp_id, err[lang] || err.en);
    return;
  }

  await emit('business_viewed', {
    user,
    conversation,
    entityType: 'business',
    entityId:   business.id,
    payload: {
      business_name: business.name,
      city:          business.city,
      country:       business.country,
    },
  });

  await db.updateConversation(conversation.id, {
    context: { ...conversation.context, selected_business: business.id },
  });

  await wa.sendBusinessDetail(user.whatsapp_id, business, lang);
}

// ============================================================
// CONTACT BUSINESS
// User wants to contact or inquire about a business
// ============================================================

async function handleContactBusiness({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) return;

  await db.createInquiry({
    userId:     user.id,
    businessId: business.id,
    message:    'Contact request via WhatsApp',
  });

  await emit('inquiry_created', {
    user,
    conversation,
    entityType: 'business',
    entityId:   business.id,
  });

  const waNumber = business.whatsapp?.replace(/\D/g, '');
  const contactMsg = {
    ht: waNumber
      ? `✅ *${business.name}*\n\nOu ka kontakte yo dirèkteman:\n📱 wa.me/${waNumber}\n📞 ${business.phone || ''}`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Nimewo pa disponib'}`,
    en: waNumber
      ? `✅ *${business.name}*\n\nContact them directly:\n📱 wa.me/${waNumber}\n📞 ${business.phone || ''}`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Phone not available'}`,
    fr: waNumber
      ? `✅ *${business.name}*\n\nContactez-les directement:\n📱 wa.me/${waNumber}\n📞 ${business.phone || ''}`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Numéro non disponible'}`,
  };

  await wa.sendText(user.whatsapp_id, contactMsg[lang] || contactMsg.en);
}

module.exports = { handle, handleFind: handle, handleBusinessSelected, handleContactBusiness };
