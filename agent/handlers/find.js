const db = require('../db');
const wa = require('../whatsapp');
const { extractSearchParams, chat } = require('../claude');
const { emit } = require('../utils/events');

// ============================================================
// FIND HANDLER
// User wants to find a business or service
// ============================================================

async function handleFind({ user, conversation, content, lang }) {
  // Extract structured search params from the natural language message
  const params = await extractSearchParams(content, lang);

  // Search the directory
  const businesses = await db.searchBusinesses({
    query: params.query,
    categorySlug: params.category,
    city: params.city,
    country: params.country,
    limit: 5,
  });

  // Log event (TwinZile)
  await emit('search_performed', {
    user,
    conversation,
    payload: { query: content, params, result_count: businesses.length },
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

  // Store results in conversation context for follow-up
  await db.updateConversation(conversation.id, {
    intent: 'find',
    context: { ...conversation.context, last_search: params, last_results: businesses.map(b => b.id) },
  });

  // Send results as interactive list
  await wa.sendBusinessResults(user.whatsapp_id, businesses, lang);
}

// ============================================================
// BUSINESS SELECTED
// User tapped on a business from the list
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
    entityId: business.id,
    payload: { business_name: business.name, city: business.city, country: business.country },
  });

  await db.updateConversation(conversation.id, {
    context: { ...conversation.context, selected_business: business.id },
  });

  await wa.sendBusinessDetail(user.whatsapp_id, business, lang);
}

// ============================================================
// CONTACT BUSINESS
// User wants to contact/inquire about a business
// ============================================================

async function handleContactBusiness({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) return;

  await db.createInquiry({
    userId: user.id,
    businessId: business.id,
    message: `Contact request via WhatsApp`,
  });

  await emit('inquiry_created', {
    user,
    conversation,
    entityType: 'business',
    entityId: business.id,
  });

  const contactMsg = {
    ht: business.whatsapp
      ? `✅ *${business.name}*\n\nOu ka kontakte yo dirèkteman:\n📱 wa.me/${business.whatsapp.replace(/\D/g, '')}\n📞 ${business.phone || ''}`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Nimewo pa disponib'}`,
    en: business.whatsapp
      ? `✅ *${business.name}*\n\nContact them directly:\n📱 wa.me/${business.whatsapp.replace(/\D/g, '')}\n📞 ${business.phone || ''}`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Phone not available'}`,
    fr: business.whatsapp
      ? `✅ *${business.name}*\n\nContactez-les directement:\n📱 wa.me/${business.whatsapp.replace(/\D/g, '')}\n📞 ${business.phone || ''}`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Numéro non disponible'}`,
  };

  await wa.sendText(user.whatsapp_id, contactMsg[lang] || contactMsg.en);
}

module.exports = { handleFind, handleBusinessSelected, handleContactBusiness };
