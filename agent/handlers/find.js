'use strict';

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

  // Use user's saved location as fallback
  const searchCity    = city    || user.location_city    || null;
  const searchCountry = country || user.location_country || null;

  const businesses = await db.searchBusinesses({
    query:       message,
    categorySlug: category   || null,
    city:         searchCity,
    country:      searchCountry,
    limit:        PAGE_SIZE,
    offset:       0,
    userCity:     user.location_city    || null,
    userCountry:  user.location_country || null,
  });

  await emit('search_performed', {
    user, conversation,
    payload: { query: message, category, city: searchCity, country: searchCountry, result_count: businesses.length },
  }).catch(() => {});

  if (!businesses.length) {
    return sendNoResults({ user, lang, category, city: searchCity, country: searchCountry });
  }

  // Save search state for "more" pagination and "back" navigation
  try {
    await db.updateSessionState(user.id, {
      ...user.session_state,
      last_category: category,
      last_search: {
        categorySlug: category,
        city:         searchCity,
        country:      searchCountry,
        query:        message,
        offset:       0,
      },
    });
  } catch (err) { console.warn('[find] Could not save last_search:', err.message); }

  if (conversation?.id) {
    await db.updateConversation(conversation.id, {
      intent: 'find',
      context: {
        last_search:  { categorySlug: category, city: searchCity },
        last_results: businesses.map(b => b.id),
      },
    }).catch(() => {});
  }

  const hasMore = businesses.length === PAGE_SIZE;
  return wa.sendBusinessResults(user.whatsapp_id, businesses, lang, hasMore);
}

// ── NO RESULTS — give actionable options ──────────────────────
async function sendNoResults({ user, lang, category, city, country }) {
  const locationNote = city
    ? { ht: `nan *${city}*`, en: `in *${city}*`, fr: `à *${city}*` }
    : { ht: '', en: '', fr: '' };

  const msg = {
    ht: `😔 Mwen pa jwenn biznis${locationNote.ht ? ` ${locationNote.ht}` : ''} kounye a.\n\nEsaye:\n• Ekri yon lòt kategori\n• Ekri non vil la — *Boston*, *Miami*, *PAP*\n• *0* pou retounen nan meni`,
    en: `😔 No businesses found${locationNote.en ? ` ${locationNote.en}` : ''} right now.\n\nTry:\n• A different category\n• A city name — *Boston*, *Miami*, *PAP*\n• *0* to go back to the menu`,
    fr: `😔 Aucune entreprise trouvée${locationNote.fr ? ` ${locationNote.fr}` : ''} pour l'instant.\n\nEssayez:\n• Une autre catégorie\n• Un nom de ville — *Boston*, *Miami*, *PAP*\n• *0* pour revenir au menu`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

// ── BUSINESS SELECTED ─────────────────────────────────────────
async function handleBusinessSelected({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) {
    const err = {
      ht: 'Mwen pa ka jwenn biznis sa a. Eseye ankò.',
      en: 'Could not find that business. Please try again.',
      fr: 'Impossible de trouver cette entreprise. Réessayez.',
    };
    return wa.sendText(user.whatsapp_id, err[lang] || err.en);
  }
  await emit('business_viewed', { user, conversation, entityType: 'business', entityId: business.id, payload: { business_name: business.name } }).catch(() => {});
  return wa.sendBusinessDetail(user.whatsapp_id, business, lang);
}

// ── CONTACT BUSINESS ──────────────────────────────────────────
async function handleContactBusiness({ user, conversation, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) return;
  await db.createInquiry({ userId: user.id, businessId: business.id, message: 'Contact request via WhatsApp' }).catch(() => {});
  const waNum = business.whatsapp?.replace(/\D/g, '');
  const msg = {
    ht: waNum ? `✅ *${business.name}*\n\n📱 wa.me/${waNum}\n📞 ${business.phone || ''}\n\n_*0* pou retounen_` : `✅ *${business.name}*\n\n📞 ${business.phone || 'Pa disponib'}\n\n_*0* pou retounen_`,
    en: waNum ? `✅ *${business.name}*\n\n📱 wa.me/${waNum}\n📞 ${business.phone || ''}\n\n_*0* to go back_`  : `✅ *${business.name}*\n\n📞 ${business.phone || 'Not available'}\n\n_*0* to go back_`,
    fr: waNum ? `✅ *${business.name}*\n\n📱 wa.me/${waNum}\n📞 ${business.phone || ''}\n\n_*0* pour revenir_` : `✅ *${business.name}*\n\n📞 ${business.phone || 'Non disponible'}\n\n_*0* pour revenir_`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

module.exports = { handle, handleFind: handle, handleBusinessSelected, handleContactBusiness };
