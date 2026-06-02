const db = require('../db');
const wa = require('../whatsapp');
const { emit } = require('../utils/events');

const PAGE_SIZE = 5;

// ============================================================
// FIND HANDLER
// ============================================================

async function handle({ user, message, lang, conversationHistory, category, city, country, mode }) {
  let conversation = null;
  try {
    conversation = await db.getActiveConversation(user.id);
    if (!conversation) conversation = await db.createConversation(user.id, user.whatsapp_id, 'find');
  } catch {}

  const businesses = await db.searchBusinesses({
    query:        message,
    categorySlug: category || null,
    city:         city     || null,
    country:      country  || null,
    limit:        PAGE_SIZE,
    offset:       0,
  });

  // Log event
  await emit('search_performed', {
    user, conversation,
    payload: { query: message, category, city, country, result_count: businesses.length },
  }).catch(() => {});

  if (!businesses.length) {
    const noResults = {
      ht: `😔 Mwen pa jwenn okenn biznis.\n\nEsaye ak lòt mo, oswa di m plis sou sa w bezwen.\n\n_*0* pou retounen_`,
      en: `😔 No businesses found.\n\nTry different terms or tell me more about what you need.\n\n_*0* to go back_`,
      fr: `😔 Aucune entreprise trouvée.\n\nEssayez d'autres termes ou dites-moi ce dont vous avez besoin.\n\n_*0* pour revenir_`,
    };
    return wa.sendText(user.whatsapp_id, noResults[lang] || noResults.en);
  }

  // Save search params for "more" pagination
  try {
    await db.updateSessionState(user.id, {
      ...user.session_state,
      last_category: category,
      last_search: {
        categorySlug: category,
        city:         city    || null,
        country:      country || null,
        query:        message,
        offset:       0,
      },
    });
  } catch (err) {
    console.warn('[find] Could not save last_search:', err.message);
  }

  // Save to conversation context
  if (conversation?.id) {
    await db.updateConversation(conversation.id, {
      intent:  'find',
      context: {
        last_search:  { categorySlug: category, city, country, query: message },
        last_results: businesses.map(b => b.id),
      },
    }).catch(() => {});
  }

  // hasMore: true if we got a full page (likely more exist)
  const hasMore = businesses.length === PAGE_SIZE;
  return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, hasMore);
}

// ── BUSINESS SELECTED ─────────────────────────────────────────
async function handleBusinessSelected({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) {
    const err = {
      ht: 'Mwen pa ka jwenn biznis sa a. Tanpri eseye ankò.',
      en: 'Could not find that business. Please try again.',
      fr: 'Impossible de trouver cette entreprise. Veuillez réessayer.',
    };
    return wa.sendText(user.whatsapp_id, err[lang] || err.en);
  }

  await emit('business_viewed', {
    user, conversation,
    entityType: 'business',
    entityId:   business.id,
    payload: { business_name: business.name, city: business.city },
  }).catch(() => {});

  if (conversation?.id) {
    await db.updateConversation(conversation.id, {
      context: { selected_business: business.id },
    }).catch(() => {});
  }

  return wa.sendBusinessDetail(user.whatsapp_id, business, lang);
}

// ── CONTACT BUSINESS ──────────────────────────────────────────
async function handleContactBusiness({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) return;

  await db.createInquiry({
    userId:     user.id,
    businessId: business.id,
    message:    'Contact request via WhatsApp',
  }).catch(() => {});

  await emit('inquiry_created', {
    user, conversation,
    entityType: 'business',
    entityId:   business.id,
  }).catch(() => {});

  const waNumber = business.whatsapp?.replace(/\D/g, '');
  const contactMsg = {
    ht: waNumber
      ? `✅ *${business.name}*\n\nOu ka kontakte yo dirèkteman:\n📱 wa.me/${waNumber}\n📞 ${business.phone || ''}\n\n_*0* pou retounen_`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Nimewo pa disponib'}\n\n_*0* pou retounen_`,
    en: waNumber
      ? `✅ *${business.name}*\n\nContact them directly:\n📱 wa.me/${waNumber}\n📞 ${business.phone || ''}\n\n_*0* to go back_`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Phone not available'}\n\n_*0* to go back_`,
    fr: waNumber
      ? `✅ *${business.name}*\n\nContactez-les directement:\n📱 wa.me/${waNumber}\n📞 ${business.phone || ''}\n\n_*0* pour revenir_`
      : `✅ *${business.name}*\n\n📞 ${business.phone || 'Numéro non disponible'}\n\n_*0* pour revenir_`,
  };

  return wa.sendText(user.whatsapp_id, contactMsg[lang] || contactMsg.en);
}

module.exports = { handle, handleFind: handle, handleBusinessSelected, handleContactBusiness };
