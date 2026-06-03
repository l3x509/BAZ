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
  'pap':          'Port-au-Prince',
  'port au prince': 'Port-au-Prince',
  'pòtoprens':    'Port-au-Prince',
  'potoprens':    'Port-au-Prince',
  'cap':          'Cap-Haïtien',
  'cap haitien':  'Cap-Haïtien',
  'petit goave':  'Petit-Goâve',
  'gonaives':     'Gonaïves',
};

// ── CATEGORY KEYWORDS ────────────────────────────────────────
// Strategy 3 fallback: catches businesses with NULL category_id.
// Compound/specific terms to avoid false positives on generic words.
const CATEGORY_KEYWORDS = {
  restaurant:    ['restaurant', 'cuisine haïtienne', 'grill', 'bistro', 'lounge', 'traiteur', 'food court'],
  hair_beauty:   ['hair salon', 'nail salon', 'beauty salon', 'braiding salon', 'barbershop', 'coiffure', 'trese cheve', 'natural hair', 'locs', 'weave'],
  grocery:       ['grocery store', 'supermarket', 'provisions', 'épicerie', 'komisyon'],
  medical:       ['medical center', 'health clinic', 'pharmacy', 'doktè', 'sante'],
  contractor:    ['construction', 'contractor', 'renovation', 'builder', 'remodeling'],
  driver:        ['car service', 'taxi service', 'school bus', 'chauffeur', 'transpò'],
  cook:          ['catering', 'private chef', 'bakery', 'pastry shop', 'traiteur', 'boulangerie'],
  tutor:         ['tutoring', 'learning center', 'after school', 'training center', 'lekòl', 'dual language'],
  mechanic:      ['auto repair', 'auto mechanic', 'car repair', 'garage'],
  cleaner:       ['cleaning service', 'maid service', 'janitorial', 'housekeeping', 'nettoyage'],
  fashion:       ['fashion boutique', 'clothing store', 'boutique', 'apparel'],
  plumber:       ['plumbing', 'plombier', 'pipe repair', 'tiyo'],
  electrician:   ['electrician', 'electrical contractor', 'elektrisyen'],
  // New categories
  legal:         ['immigration lawyer', 'immigration attorney', 'legal aid', 'immigration services', 'law office', 'legal advocacy', 'avoka', 'immigration counseling'],
  childcare:     ['childcare', 'daycare', 'day care', 'preschool', 'early education', 'gadri', 'child care center', 'learning academy'],
  shipping:      ['cargo', 'shipping', 'freight', 'kago', 'freight forwarding', 'haiti cargo'],
  tax_notary:    ['tax preparation', 'tax prep', 'notary', 'notè', 'tax service', 'multi services', 'business services'],
  real_estate:   ['realtor', 'real estate', 'imobilye', 'realty', 'property', 'real estate agent'],
  church:        ['church', 'legliz', 'congregation', 'haitian church', 'baptist', 'adventist', 'pentecostal', 'parish', 'ministry'],
  services:      ['service', 'sèvis', 'multi-service', 'community service'],
};

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

async function searchBusinesses({ query, categorySlug, city, country, limit = 5, offset = 0, userCity = null, userCountry = null }) {
  if (city)     city     = CITY_ALIASES[city.toLowerCase()]     || city;
  if (userCity) userCity = CITY_ALIASES[userCity.toLowerCase()] || userCity;

  // Resolve category_id once — reused across all strategies
  let categoryId = null;
  if (categorySlug) {
    const { data: cat } = await supabase
      .from('service_categories')
      .select('id, name_en')
      .eq('slug', categorySlug)
      .single();
    if (cat) categoryId = cat.id;
  }

  // ── Strategy 1: category_id exact match ──────────────────
  if (categoryId) {
    const { data } = await applyLocation(
      buildBase().eq('category_id', categoryId).range(offset, offset + limit - 1),
      { city, country }
    );
    if (data?.length) return data;

    if (!city && userCity) {
      const { data: data2 } = await applyLocation(
        buildBase().eq('category_id', categoryId).range(offset, offset + limit - 1),
        { city: userCity, country: userCountry }
      );
      if (data2?.length) return data2;
    }

    if (city || userCity) {
      const { data: data3 } = await buildBase()
        .eq('category_id', categoryId)
        .range(offset, offset + limit - 1);
      if (data3?.length) return data3;
    }
  }

  // ── Strategy 2: text search — scoped to category ─────────
  if (query) {
    let base = buildBase().or(`name.ilike.%${query}%,description.ilike.%${query}%`);
    if (categoryId) base = base.eq('category_id', categoryId);
    const { data } = await applyLocation(
      base.range(offset, offset + limit - 1),
      { city, country }
    );
    if (data?.length) return data;
  }

  // ── Strategy 3: keyword fallback for NULL category_id ─────
  if (categorySlug) {
    const keywords = CATEGORY_KEYWORDS[categorySlug] || [categorySlug];
    for (const kw of keywords) {
      const { data } = await applyLocation(
        buildBase()
          .or(`name.ilike.%${kw}%,description.ilike.%${kw}%`)
          .range(offset, offset + limit - 1),
        { city, country }
      );
      if (data?.length) return data;
    }
  }

  return [];
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
// Logs search impressions to business_events table.
// Call tracking not implemented — phone numbers are visible in
// the results card so we have no visibility into actual calls.
// Future: Twilio forwarding numbers for premium vendors.
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

  // Only impressions have a counter — the only event we reliably track
  if (eventType === 'impression') {
    await supabase
      .rpc('increment_impression_count', { p_business_id: businessId })
      .catch(err => console.warn('[db] increment_impression_count failed:', err.message));
  }
}

// ============================================================
// EVENTS (TWINZILE FEED — append only)
// Enable by setting TWINZILE_ENABLED=true in Railway env vars.
// Off by default — separate project, do not enable in Baz.
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


// ── EVENT MANAGEMENT ─────────────────────────────────────────
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
