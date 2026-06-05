'use strict';

const db = require('../db');
const { normalize } = require('../utils/normalize');
const wa = require('../whatsapp');
const { emit } = require('../utils/events');

const PAGE_SIZE = 5;

// ============================================================
// FIND HANDLER
// ============================================================
async function handle({ user, message, lang, conversationHistory, category, city, userCity, country, mode }) {
  let conversation = null;
  try {
    conversation = await db.getActiveConversation(user.id);
    if (!conversation) conversation = await db.createConversation(user.id, user.whatsapp_id, 'find');
  } catch {}

  // city    = explicit city from message (hard filter)
  // userCity = saved location_city (soft preference, falls back to national)
  const searchCity    = city    || null;
  const searchUserCity = userCity || user.location_city || null;
  const searchCountry = country || user.location_country || null;

  const { results: businesses, broadened, triedCity, citiesSearched } = await db.searchWithCluster({
    query:        message,
    categorySlug: category      || null,
    city:         searchCity,
    country:      searchCountry,
    limit:        PAGE_SIZE,
    offset:       0,
    userCity:     searchUserCity,
    userCountry:  searchCountry,
  });

  // TWINZILE event (gated — off by default)
  await emit('search_performed', {
    user, conversation,
    payload: { query: message, category, city: searchCity || searchUserCity, country: searchCountry, result_count: businesses.length },
  }).catch(() => {});

  if (!businesses.length) {
    // Only show city in no-results if user explicitly mentioned it.
    // Never show saved location_city — user typed "Hair" not "Hair Brockton".
    return sendNoResults({ user, lang, category, city: searchCity || null });
  }

  // ── If we broadened past the requested city, show a soft note ─
  // "Pa gen nan Randolph — men lòt biznis:"
  // Never a dead end — users always see something.
  if (broadened && triedCity) {
    const nearby = (citiesSearched || [])
      .filter(c => c !== triedCity && c !== searchCity)
      .slice(0, 3)
      .map(c => c.charAt(0).toUpperCase() + c.slice(1))
      .join(', ');

    const note = {
      ht: `📍 Pa gen anpil nan *${triedCity}* — n ap montre w sa ki pre w tou${nearby ? ` (${nearby})` : ''}:\n`,
      en: `📍 Showing nearby results too${nearby ? ` (${nearby})` : ''}:\n`,
      fr: `📍 Résultats des environs inclus${nearby ? ` (${nearby})` : ''}:\n`,
    };
    await wa.sendText(user.whatsapp_id, note[lang] || note.en);
  }

  // ── Save search state + result IDs ───────────────────────────
  try {
    // Prune stale keys before writing — prevents session state bloat
    const { last_search: _ls, last_result_ids: _lr, last_category: _lc, ...cleanState } = user.session_state || {};

    await db.updateSessionState(user.id, {
      ...cleanState,
      last_category:   category,
      last_result_ids: businesses.map(b => b.id),
      last_result_ts:  Date.now(), // expiry timestamp for result IDs
      last_search: {
        categorySlug: category,
        city:         searchCity || searchUserCity,
        country:      searchCountry,
        query:        message,
        offset:       0,
        cluster:      true,
        ts:           Date.now(), // expiry timestamp
      },
    });
  } catch (err) { console.warn('[find] Could not save session state:', err.message); }

  // ── Save to conversation context ─────────────────────────────
  if (conversation?.id) {
    db.updateConversation(conversation.id, {
      intent: 'find',
      context: {
        last_search:  { categorySlug: category, city: searchCity || searchUserCity },
        last_results: businesses.map(b => b.id),
      },
    }).catch(() => {});
  }

  const hasMore = businesses.length === PAGE_SIZE;
  await wa.sendBusinessResults(user.whatsapp_id, businesses, lang, hasMore);

  // ── Log impressions — fire and forget ────────────────────────
  businesses.forEach((b, i) => {
    db.logBusinessEvent({
      businessId:     b.id,
      eventType:      'impression',
      userId:         user.id,
      searchQuery:    message,
      categorySlug:   category,
      city:           searchCity || searchUserCity,
      resultPosition: i + 1,
    });
  });
}

// ── NO RESULTS ────────────────────────────────────────────────
// Only shown when national broadening also found nothing.
async function sendNoResults({ user, lang, category, city }) {
  const loc = city ? { ht: ` nan *${city}*`, en: ` in *${city}*`, fr: ` à *${city}*` }
                   : { ht: '', en: '', fr: '' };

  // Category-aware coming-soon hint
  const hint = {
    ht: `_N ap ajoute plis biznis chak semèn. Voye non yon biznis ou konnen: *bazht.com*_`,
    en: `_We add new businesses every week. Know one? Submit at: *bazht.com*_`,
    fr: `_Nous ajoutons de nouvelles entreprises chaque semaine. Vous en connaissez une? *bazht.com*_`,
  };

  const msg = {
    ht: `😔 Pa gen biznis${loc.ht} nan kategori sa kounye a.\n\n${hint.ht}\n\nEsaye:\n• Yon lòt kategori\n• *menu* pou retounen`,
    en: `😔 No businesses${loc.en} in this category yet.\n\n${hint.en}\n\nTry:\n• A different category\n• *menu* to go back`,
    fr: `😔 Aucune entreprise${loc.fr} dans cette catégorie pour l'instant.\n\n${hint.fr}\n\nEssayez:\n• Une autre catégorie\n• *menu* pour revenir`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

// ── BUSINESS SELECTED ─────────────────────────────────────────
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

  await emit('business_viewed', {
    user, conversation,
    entityType: 'business',
    entityId:   business.id,
    payload:    { business_name: business.name },
  }).catch(() => {});

  return wa.sendBusinessDetail(user.whatsapp_id, business, lang);
}

// ── CONTACT BUSINESS ──────────────────────────────────────────
async function handleContactBusiness({ user, conversation = null, businessId, lang }) {
  const business = await db.getBusinessById(businessId);
  if (!business) return;

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
async function handleVendorStats({ user, lang }) {
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

  const since7d  = new Date(Date.now() - 7  * 86400000).toISOString();
  const since14d = new Date(Date.now() - 14 * 86400000).toISOString();

  const [events7d, events14d] = await Promise.all([
    db.supabase.from('business_events').select('search_query').eq('business_id', business.id).eq('event_type', 'impression').gte('created_at', since7d),
    db.supabase.from('business_events').select('id').eq('business_id', business.id).eq('event_type', 'impression').gte('created_at', since14d).lt('created_at', since7d),
  ]).then(results => results.map(r => r.data || [])).catch(() => [[], []]);

  const impressions7d     = events7d.length;
  const impressions7dPrev = events14d.length;

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
