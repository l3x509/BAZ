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

  const searchCity    = city    || user.location_city    || null;
  const searchCountry = country || user.location_country || null;

  const businesses = await db.searchBusinesses({
    query:        message,
    categorySlug: category     || null,
    city:         searchCity,
    country:      searchCountry,
    limit:        PAGE_SIZE,
    offset:       0,
    userCity:     user.location_city    || null,
    userCountry:  user.location_country || null,
  });

  // TWINZILE event (gated — off by default)
  await emit('search_performed', {
    user, conversation,
    payload: { query: message, category, city: searchCity, country: searchCountry, result_count: businesses.length },
  }).catch(() => {});

  if (!businesses.length) {
    return sendNoResults({ user, lang, category, city: searchCity });
  }

  // ── Save search state + result IDs ───────────────────────────
  // last_result_ids enables number selection ("1" → show business #1)
  // last_search enables "plis" pagination and city refinement
  try {
    await db.updateSessionState(user.id, {
      ...user.session_state,
      last_category:   category,
      last_result_ids: businesses.map(b => b.id),   // ← enables number selection
      last_search: {
        categorySlug: category,
        city:         searchCity,
        country:      searchCountry,
        query:        message,
        offset:       0,
      },
    });
  } catch (err) { console.warn('[find] Could not save session state:', err.message); }

  // ── Save to conversation context ─────────────────────────────
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
  await wa.sendBusinessResults(user.whatsapp_id, businesses, lang, hasMore);

  // ── Log impressions — fire and forget, never blocks user ─────
  // Runs AFTER message is sent so analytics never delays response
  businesses.forEach((b, i) => {
    db.logBusinessEvent({
      businessId:     b.id,
      eventType:      'impression',
      userId:         user.id,
      searchQuery:    message,
      categorySlug:   category,
      city:           searchCity,
      resultPosition: i + 1,
    }).catch(() => {});
  });
}

// ── NO RESULTS ────────────────────────────────────────────────
async function sendNoResults({ user, lang, category, city }) {
  const loc = city ? { ht: ` nan *${city}*`, en: ` in *${city}*`, fr: ` à *${city}*` }
                   : { ht: '', en: '', fr: '' };

  const msg = {
    ht: `😔 Mwen pa jwenn biznis${loc.ht} kounye a.\n\nEsaye:\n• Ekri yon lòt kategori\n• Ekri non vil la — *Boston*, *Miami*, *PAP*\n• *menu* pou retounen`,
    en: `😔 No businesses found${loc.en} right now.\n\nTry:\n• A different category\n• A city name — *Boston*, *Miami*, *PAP*\n• *menu* to go back`,
    fr: `😔 Aucune entreprise trouvée${loc.fr}.\n\nEssayez:\n• Une autre catégorie\n• Un nom de ville — *Boston*, *Miami*, *PAP*\n• *menu* pour revenir`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

// ── BUSINESS SELECTED (user typed "1", "2", etc.) ────────────
// Called from router.js when user picks a result number.
// Logs a contact_reveal event — the strongest intent signal we have.
async function handleBusinessSelected({ user, businessId, lang, conversation = null }) {
  const business = await db.getBusinessById(businessId);
  if (!business) {
    const err = {
      ht: 'Mwen pa ka jwenn biznis sa a. Eseye ankò.',
      en: 'Could not find that business. Please try again.',
      fr: 'Impossible de trouver cette entreprise. Réessayez.',
    };
    return wa.sendText(user.whatsapp_id, err[lang] || err.en);
  }

  // TWINZILE event (gated)
  await emit('business_viewed', {
    user, conversation,
    entityType: 'business',
    entityId:   business.id,
    payload:    { business_name: business.name },
  }).catch(() => {});

  return wa.sendBusinessDetail(user.whatsapp_id, business, lang);
}

// ── CONTACT BUSINESS ──────────────────────────────────────────
// Called when user explicitly requests contact info.
// Logs a contact_request event (stronger signal than contact_reveal).
async function handleContactBusiness({ user, conversation = null, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) return;

  // Log as inquiry in DB
  await db.createInquiry({
    userId:     user.id,
    businessId: business.id,
    message:    'Contact request via WhatsApp',
  }).catch(() => {});

  const waNum = business.whatsapp?.replace(/\D/g, '');
  const msg = {
    ht: `✅ *${business.name}*\n\n${waNum ? `📱 wa.me/${waNum}\n` : ''}📞 ${business.phone || 'Pa disponib'}\n\n_*menu* pou retounen_`,
    en: `✅ *${business.name}*\n\n${waNum ? `📱 wa.me/${waNum}\n` : ''}📞 ${business.phone || 'Not available'}\n\n_*menu* to go back_`,
    fr: `✅ *${business.name}*\n\n${waNum ? `📱 wa.me/${waNum}\n` : ''}📞 ${business.phone || 'Non disponible'}\n\n_*menu* pour revenir_`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

// ── VENDOR STATS ──────────────────────────────────────────────
// Triggered when a vendor WhatsApps "stats".
// Shows them their business performance for the last 7 days.
async function handleVendorStats({ user, lang }) {
  // Find business owned by this user
  const { data: business } = await db.supabase
    .from('businesses')
    .select('id, name, impression_count, contact_count')
    .eq('owner_id', user.id)
    .single()
    .catch(() => ({ data: null }));

  if (!business) {
    const noB = {
      ht: `Ou pa gen biznis enrejistre nan Baz.\n\nAl sou *bazht.com/vendor* pou anrejistre.`,
      en: `You don't have a business registered on Baz.\n\nVisit *bazht.com/vendor* to register.`,
      fr: `Vous n'avez pas d'entreprise sur Baz.\n\nVisitez *bazht.com/vendor* pour vous inscrire.`,
    };
    return wa.sendText(user.whatsapp_id, noB[lang] || noB.en);
  }

  // Fetch 7-day stats from business_events
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const since14d = new Date(Date.now() - 14 * 86400000).toISOString();

  const [events7d, events14d] = await Promise.all([
    db.supabase.from('business_events').select('search_query').eq('business_id', business.id).eq('event_type', 'impression').gte('created_at', since7d),
    db.supabase.from('business_events').select('id').eq('business_id', business.id).eq('event_type', 'impression').gte('created_at', since14d).lt('created_at', since7d),
  ]).then(results => results.map(r => r.data || [])).catch(() => [[], []]);

  const impressions7d     = events7d.length;
  const impressions7dPrev = events14d.length;

  // Top search queries
  const queryMap = {};
  events7d.filter(e => e.search_query).forEach(e => {
    const q = e.search_query.toLowerCase().trim();
    queryMap[q] = (queryMap[q] || 0) + 1;
  });
  const topQueries = Object.entries(queryMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([q, n]) => `  • "${q}" — ${n}x`)
    .join('\n');

  // Week-over-week trend
  const trend = impressions7dPrev > 0
    ? ` (${impressions7d >= impressions7dPrev ? '+' : ''}${Math.round((impressions7d - impressions7dPrev) / impressions7dPrev * 100)}% vs last week)`
    : '';

  const msg = {
    ht: `📊 *Estatistik — ${business.name}*\n_7 dènye jou_\n\n👁️ Parèt nan rechèch: *${impressions7d}*${trend}\n\n${topQueries ? `🔍 *Rechèch ki mennen nan ou:*\n${topQueries}\n\n` : ''}_Total depi debi: ${business.impression_count} rechèch_`,
    en: `📊 *Stats — ${business.name}*\n_Last 7 days_\n\n👁️ Appeared in searches: *${impressions7d}*${trend}\n\n${topQueries ? `🔍 *Searches that found you:*\n${topQueries}\n\n` : ''}_All time: ${business.impression_count} searches_`,
    fr: `📊 *Statistiques — ${business.name}*\n_7 derniers jours_\n\n👁️ Apparu dans les recherches: *${impressions7d}*${trend}\n\n${topQueries ? `🔍 *Recherches qui ont trouvé votre entreprise:*\n${topQueries}\n\n` : ''}_Total depuis le début: ${business.impression_count} recherches_`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

module.exports = { handle, handleFind: handle, handleBusinessSelected, handleContactBusiness, handleVendorStats };
