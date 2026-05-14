const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// USERS
// ============================================================

async function getOrCreateUser(waId, displayName = '') {
  // Try to find existing user
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('whatsapp_id', waId)
    .single();

  if (existing) {
    // Update last seen
    await supabase
      .from('users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id);
    return existing;
  }

  // Create new user
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
      user_id: userId,
      direction,
      message_type: messageType,
      content,
      media_url: mediaUrl || null,
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
// BUSINESSES (BAZ DIRECTORY)
// ============================================================

async function searchBusinesses({ query, categorySlug, city, country, limit = 5 }) {
  let q = supabase
    .from('businesses')
    .select(`
      *,
      service_categories (slug, name_en, name_ht, name_fr, icon)
    `)
    .eq('status', 'active')
    .limit(limit);

  if (categorySlug) {
    // Join through category
    const { data: cat } = await supabase
      .from('service_categories')
      .select('id')
      .eq('slug', categorySlug)
      .single();
    if (cat) q = q.eq('category_id', cat.id);
  }

  if (city) q = q.ilike('city', `%${city}%`);
  if (country) q = q.eq('country', country);

  if (query) {
    q = q.or(`name.ilike.%${query}%,description.ilike.%${query}%`);
  }

  // Featured first, then by rating
  q = q.order('is_featured', { ascending: false })
       .order('avg_rating', { ascending: false });

  const { data, error } = await q;
  if (error) throw new Error(`Search failed: ${error.message}`);
  return data || [];
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
      user_id: userId,
      business_id: businessId,
      category_id: categoryId,
      description,
      scheduled_at: scheduledAt || null,
      price_estimate: priceEstimate || null,
      notes: notes || null,
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

  // Increment business inquiry count
  await supabase.rpc('increment_inquiry_count', { business_id: businessId }).catch(() => {});

  return data;
}

// ============================================================
// EVENTS (TWINZILE FEED — append only)
// ============================================================

async function logEvent({ eventType, userId, sessionId, entityType, entityId, payload, city, country }) {
  if (process.env.TWINZILE_ENABLED !== 'true') return; // off by default

  const { error } = await supabase
    .from('events')
    .insert({
      event_type: eventType,
      user_id: userId || null,
      session_id: sessionId || null,
      entity_type: entityType || null,
      entity_id: entityId || null,
      payload: payload || {},
      city: city || null,
      country: country || null,
    });

  if (error) console.error('Event log failed:', error.message);
}

module.exports = {
  getOrCreateUser,
  updateUser,
  setUserLanguage,
  setUserSessionState,
  getActiveConversation,
  createConversation,
  updateConversation,
  closeConversation,
  logMessage,
  isDuplicate,
  searchBusinesses,
  getBusinessById,
  getCategories,
  createBooking,
  createInquiry,
  logEvent,
};
