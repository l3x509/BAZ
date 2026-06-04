'use strict';

const { createClient } = require('@supabase/supabase-js');
const { normalize }    = require('./utils/normalize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// CATEGORY CACHE
// Loaded once on startup — eliminates all resolveCategory DB calls.
// Structure:
//   _bySlug:    Map<slug, categoryRow>
//   _byKeyword: Map<normalizedKeyword, categoryRow>
//
// Rebuilt by calling loadCategoryCache() — called automatically
// on first use and can be called again if categories change.
// In practice, Railway restarts on every deploy so it's always fresh.
// ============================================================
let _bySlug    = new Map();
let _byKeyword = new Map();
let _cacheLoaded = false;

async function loadCategoryCache() {
  try {
    const { data, error } = await supabase
      .from('service_categories')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    _bySlug    = new Map();
    _byKeyword = new Map();

    for (const cat of (data || [])) {
      _bySlug.set(cat.slug, cat);

      // Index every keyword (all languages) normalized
      const kws = cat.keywords || {};
      for (const lang of ['en', 'ht', 'fr']) {
        for (const kw of (kws[lang] || [])) {
          _byKeyword.set(normalize(kw), cat);
        }
      }
      // Also index the slug itself and name_en
      _byKeyword.set(normalize(cat.slug),    cat);
      _byKeyword.set(normalize(cat.name_en), cat);
    }

    _cacheLoaded = true;
    console.log(`[db] Category cache loaded: ${_bySlug.size} categories, ${_byKeyword.size} keywords`);
  } catch (err) {
    console.error('[db] loadCategoryCache failed:', err.message);
    // Non-fatal — resolveCategory falls back to DB query
  }
}

// Load on startup (non-blocking)
loadCategoryCache();

// ── resolveCategory ───────────────────────────────────────────
// Resolves any word (EN/HT/FR, with or without diacritics)
// to a category row. Pure in-memory after cache load.
// Falls back to DB query if cache isn't ready.
async function resolveCategory(word) {
  if (!word) return null;
  const term = normalize(word);

  // ── Fast path: in-memory cache ──────────────────────────────
  if (_cacheLoaded) {
    return _bySlug.get(term) || _byKeyword.get(term) || null;
  }

  // ── Fallback: DB query (only during cold start) ─────────────
  console.warn('[db] resolveCategory: cache not ready, falling back to DB');
  const { data: bySlug } = await supabase
    .from('service_categories')
    .select('*')
    .eq('slug', term)
    .eq('is_active', true)
    .single();
  if (bySlug) return bySlug;

  const { data: byKeyword } = await supabase
    .from('service_categories')
    .select('*')
    .or(
      `keywords->en.cs.["${term}"],` +
      `keywords->ht.cs.["${term}"],` +
      `keywords->fr.cs.["${term}"]`
    )
    .eq('is_active', true)
    .limit(1)
    .single();

  return byKeyword || null;
}

// ============================================================
// USERS
// ============================================================

// ── In-memory user cache ─────────────────────────────────────
// 60s TTL. Eliminates getOrCreateUser DB call on repeat messages.
// Invalidated on any updateUser call.
const _userCache    = new Map();
const USER_CACHE_TTL = 60 * 1000;

function _cacheUser(user) {
  _userCache.set(user.whatsapp_id, { user, ts: Date.now() });
}
function _getCachedUser(waId) {
  const entry = _userCache.get(waId);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) { _userCache.delete(waId); return null; }
  return entry.user;
}
function _invalidateUser(waId) {
  _userCache.delete(waId);
}

async function getOrCreateUser(waId, displayName = '') {
  const cached = _getCachedUser(waId);
  if (cached) return cached;

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('whatsapp_id', waId)
    .single();

  if (existing) {
    // Fire-and-forget last_seen update — don't block on it
    supabase.from('users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id)
      .then(() => {}).catch(() => {});
    _cacheUser(existing);
    return existing;
  }

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      whatsapp_id:  waId,
      name:         displayName || null,
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  _cacheUser(newUser);
  return newUser;
}

async function updateUser(userId, updates) {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw new Error(`Failed to update user: ${error.message}`);
  // Invalidate cache so next fetch gets fresh data
  if (data?.whatsapp_id) _invalidateUser(data.whatsapp_id);
  return data;
}

async function setUserLanguage(userId, language) {
  return updateUser(userId, { language });
}
async function setUserSessionState(userId, state) {
  return updateUser(userId, { session_state: state });
}
async function updateSessionState(userId, state) {
  return setUserSessionState(userId, state);
}

// ============================================================
// CONVERSATIONS
// ============================================================

// Returns active conversation by waId directly — no userId needed.
// Enables parallel fetch with getOrCreateUser in processMessage.
async function getConversationByWaId(waId) {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('whatsapp_id', waId)
    .eq('is_active', true)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

async function getActiveConversation(userId) {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

async function createConversation(userId, waId, intent = 'unknown') {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id:         userId,
      whatsapp_id:     waId,
      intent,
      last_message_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data;
}

async function updateConversation(conversationId, updates) {
  const { error } = await supabase
    .from('conversations')
    .update({ ...updates, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw new Error(`Failed to update conversation: ${error.message}`);
}

async function closeConversation(conversationId) {
  return updateConversation(conversationId, { is_active: false });
}

// ============================================================
// MESSAGES
// ============================================================

// Fire-and-forget — never awaited. User response is not blocked
// on message logging. Errors are swallowed intentionally.
function logMessage({ conversationId, userId, direction, messageType, content, mediaUrl, metaMessageId }) {
  supabase.from('messages').insert({
    conversation_id: conversationId,
    user_id:         userId,
    direction,
    message_type:    messageType,
    content,
    media_url:       mediaUrl      || null,
    meta_message_id: metaMessageId || null,
  }).then(() => {}).catch(err => console.error('[db] logMessage failed:', err.message));
}

async function isDuplicate(metaMessageId) {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('meta_message_id', metaMessageId)
    .limit(1)
    .single();
  return !!data;
}

// Lazy — only called when Claude will actually be invoked.
// Don't call this for keyword/emoji/name hits.
async function getConversationHistory(conversationId, limit = 10) {
  if (!conversationId) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data?.length) return [];
  return data
    .reverse()
    .map(m => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.content.trim() }))
    .filter(m => m.content);
}

// ============================================================
// BUSINESSES
// ============================================================

const CITY_ALIASES = {
  'pap':            'Port-au-Prince',
  'port au prince': 'Port-au-Prince',
  'potoprens':      'Port-au-Prince',
  'cap':            'Cap-Haïtien',
  'cap haitien':    'Cap-Haïtien',
  'petit goave':    'Petit-Goâve',
  'gonaives':       'Gonaïves',
};

// ── searchBusinesses ─────────────────────────────────────────
// Single RPC call to Postgres — replaces the old 3-strategy
// sequential query chain. Unaccent handled server-side.
// Falls back to JS-side ilike if RPC unavailable.
async function searchBusinesses({
  query, categorySlug, city, country,
  limit = 5, offset = 0,
  userCity = null, userCountry = null,
}) {
  // Normalize all inputs
  const normQuery = query ? normalize(query) : null;
  let   resolvedCity    = city     ? (CITY_ALIASES[normalize(city)]     || city)     : null;
  const resolvedUserCity = userCity ? (CITY_ALIASES[normalize(userCity)] || userCity) : null;

  // Resolve category UUID from cache (free)
  const cat        = categorySlug ? await resolveCategory(categorySlug) : null;
  const categoryId = cat?.id || null;

  // Determine effective search term:
  // If we have a category, the term is used only for text search fallback.
  // If no category, the term IS the search.
  const searchTerm = normQuery || (categorySlug ? normalize(categorySlug) : null);

  // ── RPC call: one round-trip, unaccent both sides ──────────
  async function rpcSearch(cityOverride) {
    const { data, error } = await supabase.rpc('search_businesses', {
      p_term:    categoryId ? null : searchTerm,  // don't text-search when we have a category UUID
      p_cat_id:  categoryId || null,
      p_city:    cityOverride || null,
      p_country: country || null,
      p_limit:   limit,
      p_offset:  offset,
    });
    if (error) {
      console.warn('[db] search_businesses RPC error:', error.message);
      return [];
    }
    return data || [];
  }

  // Strategy 1: explicit city from message
  if (resolvedCity) {
    const results = await rpcSearch(resolvedCity);
    if (results.length) return { results, usedCity: resolvedCity, broadened: false };
  }

  // Strategy 2: user's saved city (no explicit city in message)
  if (!resolvedCity && resolvedUserCity) {
    const results = await rpcSearch(resolvedUserCity);
    if (results.length) return { results, usedCity: resolvedUserCity, broadened: false };
  }

  // Strategy 3: ALWAYS broaden to national if city search found nothing.
  // This ensures users never hit a dead end just because their saved city
  // has no listings yet. Show results with a "broadened" flag so the
  // router can add a soft note like "Pa gen nan Randolph — men lòt rezilta:"
  const broadResults = await rpcSearch(null);
  if (broadResults.length) {
    return {
      results:   broadResults,
      usedCity:  null,
      broadened: !!(resolvedCity || resolvedUserCity), // true = we had a city but fell back
      triedCity: resolvedCity || resolvedUserCity || null,
    };
  }

  return { results: [], usedCity: null, broadened: false, triedCity: null };
}

// ── findBusinessByName ────────────────────────────────────────
// Called from router when user types a business name directly.
// Uses find_business_by_name RPC — unaccent both sides.
async function findBusinessByName(input) {
  if (!input || normalize(input).length < 3) return [];

  const { data, error } = await supabase.rpc('find_business_by_name', {
    p_term:  normalize(input),
    p_limit: 5,
  });

  if (error) {
    console.warn('[db] find_business_by_name RPC error:', error.message);
    return [];
  }
  return data || [];
}

async function getBusinessById(id) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*, service_categories (slug, name_en, name_ht, name_fr, icon)')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

async function getCategories() {
  // Serve from cache if available
  if (_cacheLoaded && _bySlug.size > 0) {
    return [..._bySlug.values()].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }
  const { data } = await supabase
    .from('service_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  return data || [];
}

// ============================================================
// BOOKINGS
// ============================================================

async function createBooking({ userId, businessId, categoryId, description, scheduledAt, priceEstimate, notes }) {
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id:        userId,
      business_id:    businessId,
      category_id:    categoryId,
      description,
      scheduled_at:   scheduledAt   || null,
      price_estimate: priceEstimate || null,
      notes:          notes         || null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create booking: ${error.message}`);
  return data;
}

// ============================================================
// INQUIRIES
// ============================================================

async function createInquiry({ userId, businessId, message }) {
  const { data, error } = await supabase
    .from('inquiries')
    .insert({ user_id: userId, business_id: businessId, message })
    .select()
    .single();
  if (error) throw new Error(`Failed to create inquiry: ${error.message}`);
  supabase.rpc('increment_inquiry_count', { business_id: businessId }).catch(() => {});
  return data;
}

// ============================================================
// BUSINESS ANALYTICS
// ============================================================

function logBusinessEvent({ businessId, eventType, userId, searchQuery, categorySlug, city, resultPosition }) {
  if (!businessId || !eventType) return;
  supabase.from('business_events').insert({
    business_id:     businessId,
    event_type:      eventType,
    user_id:         userId         || null,
    search_query:    searchQuery    || null,
    category_slug:   categorySlug   || null,
    city:            city           || null,
    result_position: resultPosition || null,
  }).then(({ error }) => {
    if (error) { console.warn('[db] logBusinessEvent failed:', error.message); return; }
    if (eventType === 'impression') {
      supabase.rpc('increment_impression_count', { p_business_id: businessId }).catch(() => {});
    }
  }).catch(() => {});
}

// ============================================================
// TWINZILE EVENTS (gated — never enable in Baz)
// ============================================================

function logEvent({ eventType, userId, sessionId, entityType, entityId, payload, city, country }) {
  if (process.env.TWINZILE_ENABLED !== 'true') return;
  supabase.from('twinzile_logs').insert({
    event_type:  eventType,
    user_id:     userId      || null,
    session_id:  sessionId   || null,
    entity_type: entityType  || null,
    entity_id:   entityId    || null,
    payload:     payload     || {},
    city:        city        || null,
    country:     country     || null,
  }).catch(err => console.error('[db] logEvent failed:', err.message));
}

// ============================================================
// EVENT MANAGEMENT
// ============================================================

async function getPendingEvent(eventId) {
  let query = supabase.from('events').select('*').eq('status', 'pending');
  if (eventId) query = query.eq('id', eventId);
  else         query = query.order('created_at', { ascending: false }).limit(1);
  const { data } = await query.single();
  return data || null;
}

async function updateEventStatus(eventId, status) {
  const { data, error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', eventId)
    .select('id, title, city, status, organizer, contact')
    .single();
  if (error) throw new Error(`Failed to update event: ${error.message}`);
  return data;
}

async function getPendingEventsCount() {
  const { count } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return count || 0;
}

// ============================================================
// CITY CLUSTERS
// Ordered expansion rings for proximity search without coordinates.
// Ring 0 = the city itself (handled by caller)
// Ring 1 = immediate neighbors (~5-10 miles)
// Ring 2 = broader area (~15-25 miles)
// Add cities as Baz expands to new markets.
// ============================================================
const CITY_CLUSTERS = {
  // ── Greater Boston / South Shore ──────────────────────────
  randolph:         [['holbrook','stoughton','canton','milton'],         ['brockton','quincy','boston','dedham']],
  holbrook:         [['randolph','stoughton','brockton','avon'],         ['canton','milton','quincy','easton']],
  brockton:         [['stoughton','easton','avon','west bridgewater'],   ['randolph','holbrook','bridgewater','taunton']],
  stoughton:        [['randolph','holbrook','canton','easton'],          ['brockton','dedham','norwood','avon']],
  canton:           [['randolph','stoughton','norwood','dedham'],        ['milton','quincy','holbrook','westwood']],
  milton:           [['boston','quincy','canton','randolph'],            ['dedham','norwood','holbrook','stoughton']],
  boston:           [['dorchester','mattapan','roxbury','hyde park'],    ['randolph','milton','chelsea','quincy']],
  dorchester:       [['boston','mattapan','roxbury','hyde park'],        ['randolph','milton','quincy','chelsea']],
  mattapan:         [['boston','dorchester','hyde park','milton'],       ['randolph','stoughton','quincy','roslindale']],
  roxbury:          [['boston','dorchester','mattapan','jamaica plain'], ['cambridge','somerville','chelsea']],
  quincy:           [['boston','milton','randolph','braintree'],         ['holbrook','randolph','stoughton','weymouth']],
  cambridge:        [['boston','somerville','medford','everett'],        ['malden','chelsea','watertown','waltham']],
  somerville:       [['cambridge','boston','medford','everett'],         ['malden','chelsea','revere','winthrop']],
  everett:          [['somerville','malden','medford','chelsea'],        ['boston','revere','winthrop','cambridge']],
  malden:           [['everett','medford','somerville','revere'],        ['cambridge','chelsea','woburn','lynn']],
  chelsea:          [['boston','everett','revere','winthrop'],           ['somerville','malden','cambridge']],
  revere:           [['chelsea','winthrop','everett','malden'],          ['boston','somerville','lynn']],
  lynn:             [['revere','malden','everett','chelsea'],            ['boston','somerville','medford','woburn']],
  // ── Florida ────────────────────────────────────────────────
  miami:            [['miami gardens','north miami','miramar'],          ['pompano beach','fort lauderdale','west palm beach']],
  'miami gardens':  [['miami','north miami','miramar'],                  ['pompano beach','fort lauderdale']],
  'north miami':    [['miami','miami gardens','miramar'],                ['pompano beach','fort lauderdale']],
  miramar:          [['miami','miami gardens','pompano beach'],          ['fort lauderdale','west palm beach']],
  // ── New York ───────────────────────────────────────────────
  brooklyn:         [['bronx','queens','manhattan'],                     ['staten island','yonkers','mount vernon']],
  bronx:            [['brooklyn','queens','manhattan','yonkers'],        ['mount vernon','new rochelle']],
  queens:           [['brooklyn','bronx','manhattan'],                   ['staten island','yonkers']],
  // ── Canada ─────────────────────────────────────────────────
  montreal:         [['laval','longueuil'],                              []],
};

// Normalize cluster keys for lookup
const CLUSTER_MAP = {};
for (const [city, rings] of Object.entries(CITY_CLUSTERS)) {
  CLUSTER_MAP[normalize(city)] = rings.map(ring => ring.map(normalize));
}

// ── searchWithCluster ─────────────────────────────────────────
// Wraps searchBusinesses with city cluster expansion.
// Expands outward ring by ring until PAGE_SIZE results are found.
// Returns { results, citiesSearched } so find.js can show city labels
// on results from expanded rings.
async function searchWithCluster({
  query, categorySlug, city, country,
  limit = 5, offset = 0,
  userCity = null, userCountry = null,
}) {
  const effectiveCity = city || userCity || null;

  // No city → no cluster, search nationally as before
  if (!effectiveCity) {
    const { results, broadened, triedCity } = await searchBusinesses({
      query, categorySlug, city: null, country, limit, offset, userCity: null, userCountry,
    });
    return { results, broadened, triedCity, citiesSearched: [] };
  }

  const normCity   = normalize(effectiveCity);
  const rings      = CLUSTER_MAP[normCity] || [];
  const collected  = [];
  const seen       = new Set();
  const citiesSearched = [effectiveCity];

  // ── Ring 0: exact city ────────────────────────────────────
  const ring0 = await searchBusinesses({
    query, categorySlug,
    city:      effectiveCity,
    country,
    limit:     limit,
    offset:    0,
    userCity:  null,
    userCountry,
  });

  for (const b of ring0.results) {
    if (!seen.has(b.id)) { seen.add(b.id); collected.push(b); }
  }

  // ── Expand rings until full ───────────────────────────────
  for (const ring of rings) {
    if (collected.length >= limit) break;
    const needed = limit - collected.length;

    for (const ringCity of ring) {
      if (collected.length >= limit) break;

      const ringResults = await searchBusinesses({
        query, categorySlug,
        city:      ringCity,
        country,
        limit:     needed,
        offset:    0,
        userCity:  null,
        userCountry,
      });

      for (const b of ringResults.results) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          collected.push({ ...b, _fromCity: ringCity }); // tag with source city
          citiesSearched.push(ringCity);
        }
        if (collected.length >= limit) break;
      }
    }
  }

  // ── Sort: premium → pro → standard → free, then rating ───
  const tierOrder = { premium: 0, pro: 1, standard: 2, free: 3 };
  collected.sort((a, b) => {
    const tDiff = (tierOrder[a.listing_tier || 'free'] ?? 3) - (tierOrder[b.listing_tier || 'free'] ?? 3);
    if (tDiff !== 0) return tDiff;
    return (b.avg_rating || 0) - (a.avg_rating || 0);
  });

  const broadened    = collected.some(b => b._fromCity);
  const triedCity    = broadened ? effectiveCity : null;

  return {
    results:       collected.slice(0, limit),
    broadened,
    triedCity,
    citiesSearched: [...new Set(citiesSearched)],
  };
}

module.exports = {
  // Cache management
  loadCategoryCache,
  // Users
  getOrCreateUser,
  updateUser,
  setUserLanguage,
  setUserSessionState,
  updateSessionState,
  // Conversations
  getConversationByWaId,
  getActiveConversation,
  createConversation,
  updateConversation,
  closeConversation,
  getConversationHistory,
  // Messages
  logMessage,
  isDuplicate,
  // Businesses
  resolveCategory,
  findBusinessByName,
  searchBusinesses,
  searchWithCluster,
  getBusinessById,
  getCategories,
  // Bookings & Inquiries
  createBooking,
  createInquiry,
  // Analytics (fire-and-forget)
  logBusinessEvent,
  logEvent,
  // Event management
  getPendingEvent,
  updateEventStatus,
  getPendingEventsCount,
  // Supabase client
  supabase,
};
