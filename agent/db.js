const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// USERS
// ============================================================

async function getOrCreateUser(waId, displayName = '') {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('whatsapp_id', waId)
    .single();

  if (existing) {
    await supabase
      .from('users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id);
    return existing;
  }

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      whatsapp_id: waId,
      name:        displayName || null,
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return newUser;
}

async function updateUser(userId, updates) {
  const { error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId);
  if (error) throw new Error(`Failed to update user: ${error.message}`);
}

async function setUserLanguage(userId, language) {
  return updateUser(userId, { language });
}

async function setUserSessionState(userId, state) {
  return updateUser(userId, { session_state: state });
}

// Alias used by router.js
async function updateSessionState(userId, state) {
  return setUserSessionState(userId, state);
}

// ============================================================
// CONVERSATIONS
// ============================================================

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

async function logMessage({ conversationId, userId, direction, messageType, content, mediaUrl, metaMessageId }) {
  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id:         userId,
      direction,
      message_type:    messageType,
      content,
      media_url:       mediaUrl      || null,
      meta_message_id: metaMessageId || null,
    });
  if (error) console.error('Failed to log message:', error.message);
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

// ============================================================
// CONVERSATION HISTORY
// Returns the last N messages formatted for Claude:
//   [{ role: 'user'|'assistant', content: string }]
// ============================================================

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
    .map(m => ({
      role:    m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content.trim(),
    }))
    .filter(m => m.content);
}

// ============================================================
// BUSINESSES (BAZ DIRECTORY)
// ============================================================

// ── CITY ALIASES ─────────────────────────────────────────────
const CITY_ALIASES = {
  'pap':            'Port-au-Prince',
  'port au prince': 'Port-au-Prince',
  'pòtoprens':      'Port-au-Prince',
  'potoprens':      'Port-au-Prince',
  'cap':            'Cap-Haïtien',
  'cap haitien':    'Cap-Haïtien',
  'petit goave':    'Petit-Goâve',
  'gonaives':       'Gonaïves',
};

// ── CATEGORY RESOLUTION ──────────────────────────────────────
// Resolves any word (EN/HT/FR) to a category row via the
// keywords JSONB column in service_categories.
// This is the single lookup path — no hardcoded slug maps.
async function resolveCategory(word) {
  if (!word) return null;
  const term = word.toLowerCase().trim();

  // First try exact slug match (fast path for internal calls)
  const { data: bySlug } = await supabase
    .from('service_categories')
    .select('id, slug, name_en, name_ht, name_fr, icon')
    .eq('slug', term)
    .eq('is_active', true)
    .single();
  if (bySlug) return bySlug;

  // Then search keywords JSONB across all three languages
  const { data: byKeyword } = await supabase
    .from('service_categories')
    .select('id, slug, name_en, name_ht, name_fr, icon')
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

function buildBase() {
  return supabase
    .from('businesses')
    .select('*, service_categories (slug, name_en, name_ht, name_fr, icon)')
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('avg_rating',  { ascending: false });
}

function applyLocation(q, { city, country }) {
  if (city)    q = q.ilike('city', `%${city}%`);
  if (country) q = q.eq('country', country);
  return q;
}

// ── searchBusinesses ─────────────────────────────────────────
// query       : raw word/phrase the user typed (any language)
// categorySlug: optional — passed by router for direct category hits
// city        : explicit city from message
// userCity    : saved city from user profile (fallback)
// Resolves category via keywords — no hardcoded mapping needed.
async function searchBusinesses({ query, categorySlug, city, country, limit = 5, offset = 0, userCity = null, userCountry = null }) {
  if (city)     city     = CITY_ALIASES[city.toLowerCase()]     || city;
  if (userCity) userCity = CITY_ALIASES[userCity.toLowerCase()] || userCity;

  // Resolve category — try slug first, then query word
  const term = categorySlug || query || '';
  const cat  = await resolveCategory(term);
  const categoryId = cat?.id || null;

  // ── Strategy 1: category match with explicit city ─────────
  if (categoryId) {
    const { data } = await applyLocation(
      buildBase().eq('category_id', categoryId).range(offset, offset + limit - 1),
      { city, country }
    );
    if (data?.length) return data;

    // Strategy 1b: fall back to user's saved city
    if (!city && userCity) {
      const { data: data2 } = await applyLocation(
        buildBase().eq('category_id', categoryId).range(offset, offset + limit - 1),
        { city: userCity, country: userCountry }
      );
      if (data2?.length) return data2;
    }

    // Strategy 1c: no city filter — return any matching category
    if (city || userCity) {
      const { data: data3 } = await buildBase()
        .eq('category_id', categoryId)
        .range(offset, offset + limit - 1);
      if (data3?.length) return data3;
    }
  }

  // ── Strategy 2: name/description text search ─────────────
  if (query) {
    let q = buildBase().or(`name.ilike.%${query}%,description.ilike.%${query}%`);
    if (categoryId) q = q.eq('category_id', categoryId);
    const { data } = await applyLocation(
      q.range(offset, offset + limit - 1),
      { city, country }
    );
    if (data?.length) return data;
  }

  return [];
}


// ── BUSINESS NAME LOOKUP ─────────────────────────────────────
// Finds businesses by name match (case-insensitive, partial ok).
// Used by router for direct name queries like "PiBonAn".
// Returns up to 5 matches. Zero matches returns [].
async function findBusinessByName(input) {
  if (!input || input.trim().length < 3) return [];
  const term = input.trim();

  const { data, error } = await supabase
    .from('businesses')
    .select('*, service_categories (slug, name_en, name_ht, name_fr, icon)')
    .eq('status', 'active')
    .ilike('name', `%${term}%`)
    .order('is_featured', { ascending: false })
    .order('avg_rating',   { ascending: false })
    .limit(5);

  if (error) {
    console.warn('[db] findBusinessByName error:', error.message);
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

  await supabase.rpc('increment_inquiry_count', { business_id: businessId }).catch(() => {});

  return data;
}

// ============================================================
// BUSINESS ANALYTICS
// ============================================================

async function logBusinessEvent({ businessId, eventType, userId, searchQuery, categorySlug, city, resultPosition }) {
  if (!businessId || !eventType) return;

  const { error } = await supabase
    .from('business_events')
    .insert({
      business_id:     businessId,
      event_type:      eventType,
      user_id:         userId         || null,
      search_query:    searchQuery    || null,
      category_slug:   categorySlug   || null,
      city:            city           || null,
      result_position: resultPosition || null,
    });

  if (error) {
    console.warn('[db] logBusinessEvent failed:', error.message);
    return;
  }

  if (eventType === 'impression') {
    await supabase
      .rpc('increment_impression_count', { p_business_id: businessId })
      .catch(err => console.warn('[db] increment_impression_count failed:', err.message));
  }
}

// ============================================================
// TWINZILE EVENTS (gated — never enable in Baz)
// ============================================================

async function logEvent({ eventType, userId, sessionId, entityType, entityId, payload, city, country }) {
  if (process.env.TWINZILE_ENABLED !== 'true') return;

  const { error } = await supabase
    .from('twinzile_logs')
    .insert({
      event_type:  eventType,
      user_id:     userId      || null,
      session_id:  sessionId   || null,
      entity_type: entityType  || null,
      entity_id:   entityId    || null,
      payload:     payload     || {},
      city:        city        || null,
      country:     country     || null,
    });

  if (error) console.error('Event log failed:', error.message);
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

module.exports = {
  // Users
  getOrCreateUser,
  updateUser,
  setUserLanguage,
  setUserSessionState,
  updateSessionState,
  // Conversations
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
  getBusinessById,
  getCategories,
  // Bookings & Inquiries
  createBooking,
  createInquiry,
  // Business analytics
  logBusinessEvent,
  // TwinZile events (gated)
  logEvent,
  // Event management
  getPendingEvent,
  updateEventStatus,
  getPendingEventsCount,
  // Supabase client — exposed for direct queries in find.js vendor stats
  supabase,
};
