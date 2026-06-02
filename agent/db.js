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
      name: displayName || null,
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
      user_id: userId,
      whatsapp_id: waId,
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
      media_url:       mediaUrl    || null,
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
// Called by router.js to give Claude conversation context.
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

  // Reverse to chronological order, format for Claude API
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
// Maps common user inputs to searchable city names
const CITY_ALIASES = {
  'pap': 'Port-au-Prince', 'port au prince': 'Port-au-Prince',
  'pòtoprens': 'Port-au-Prince', 'potoprens': 'Port-au-Prince',
  'cap': 'Cap-Haïtien', 'cap haitien': 'Cap-Haïtien',
  'petit goave': 'Petit-Goâve', 'gonaives': 'Gonaïves',
};

// ── CATEGORY KEYWORDS ────────────────────────────────────────
// Strategy 3 fallback: catches businesses with NULL category_id.
// FIX: replaced single generic words ('hair', 'beauty', 'food') with
// compound/specific terms so community orgs and churches don't bleed
// into unrelated searches. Each keyword must be specific enough that
// only businesses in that category would have it in their name/description.
const CATEGORY_KEYWORDS = {
  restaurant:    ['restaurant', 'cuisine haïtienne', 'grill', 'bistro', 'lounge', 'traiteur', 'food court'],
  hair_beauty:   ['hair salon', 'nail salon', 'beauty salon', 'braiding salon', 'barbershop', 'coiffure', 'trese cheve', 'natural hair', 'locs', 'weave'],
  grocery:       ['grocery store', 'supermarket', 'provisions', 'épicerie', 'komisyon'],
  medical:       ['medical center', 'health clinic', 'pharmacy', 'doktè', 'sante'],
  contractor:    ['construction', 'contractor', 'renovation', 'builder', 'remodeling'],
  driver:        ['car service', 'taxi service', 'school bus', 'chauffeur', 'transpò'],
  cook:          ['catering', 'private chef', 'bakery', 'pastry shop', 'traiteur'],
  tutor:         ['tutoring', 'learning center', 'after school', 'training center', 'lekòl'],
  mechanic:      ['auto repair', 'auto mechanic', 'car repair', 'garage'],
  cleaner:       ['cleaning service', 'maid service', 'janitorial', 'housekeeping', 'nettoyage'],
  fashion:       ['fashion boutique', 'clothing store', 'boutique', 'apparel'],
  food_products: ['food product', 'sauce ayisyen', 'epis', 'pwodui manje', 'haitian spice'],
  jewelry:       ['jewelry', 'bijou', 'jewellery', 'accessories store'],
  crafts:        ['handmade crafts', 'artisan', 'haitian art', 'craft store'],
  plumber:       ['plumbing', 'plombier', 'pipe repair'],
  electrician:   ['electrician', 'electrical contractor', 'elektrisyen'],
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
  // Normalise city aliases
  if (city)     city     = CITY_ALIASES[city.toLowerCase()]     || city;
  if (userCity) userCity = CITY_ALIASES[userCity.toLowerCase()] || userCity;

  // ── Resolve category_id once — reused across all strategies ──
  // FIX: was resolved only in strategy 1 and lost afterward.
  // Now resolved upfront so strategy 2 can scope to it as well.
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
    // Try with user-specified city first
    const { data } = await applyLocation(
      buildBase().eq('category_id', categoryId).range(offset, offset + limit - 1),
      { city, country }
    );
    if (data?.length) return data;

    // Fall back to user's saved location city
    if (!city && userCity) {
      const { data: data2 } = await applyLocation(
        buildBase().eq('category_id', categoryId).range(offset, offset + limit - 1),
        { city: userCity, country: userCountry }
      );
      if (data2?.length) return data2;
    }

    // Broaden — no city filter at all
    if (city || userCity) {
      const { data: data3 } = await buildBase()
        .eq('category_id', categoryId)
        .range(offset, offset + limit - 1);
      if (data3?.length) return data3;
    }
  }

  // ── Strategy 2: text search — SCOPED to category when known ──
  // FIX: was a global unscoped search. When categoryId is known, filter
  // to that category first — prevents "manje" / "cheve" matching community
  // orgs, churches, or radio stations across the whole businesses table.
  // Only drops the category scope if no categoryId was resolved (e.g. query
  // came in without a slug, which should be rare).
  if (query) {
    let base = buildBase().or(`name.ilike.%${query}%,description.ilike.%${query}%`);
    if (categoryId) base = base.eq('category_id', categoryId);
    const { data } = await applyLocation(
      base.range(offset, offset + limit - 1),
      { city, country }
    );
    if (data?.length) return data;
  }

  // ── Strategy 3: keyword fallback for known categories ─────
  // Catches businesses with NULL category_id by matching on name/description.
  // Uses compound/specific keywords (see CATEGORY_KEYWORDS above) to avoid
  // false positives. Also FIX: was using .limit(limit) with no offset support,
  // which broke pagination on fallback results — now uses .range().
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
    .select(`*, service_categories (slug, name_en, name_ht, name_fr, icon)`)
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
      scheduled_at:   scheduledAt    || null,
      price_estimate: priceEstimate  || null,
      notes:          notes          || null,
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
// EVENTS (TWINZILE FEED — append only)
// Enable by setting TWINZILE_ENABLED=true in Railway env vars.
// ============================================================

async function logEvent({ eventType, userId, sessionId, entityType, entityId, payload, city, country }) {
  if (process.env.TWINZILE_ENABLED !== 'true') return;

  const { error } = await supabase
    .from('events')
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
  // Events
  logEvent,
};
