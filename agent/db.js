// ============================================================
// ADD TO db.js — paste above the module.exports block
// ============================================================

// ── BUSINESS IMPRESSION LOGGER ────────────────────────────────
// Logs when a business appears in search results.
// Always non-blocking — callers use .catch(() => {}).
//
// Call tracking is not implemented — phone numbers are already
// visible in the results card and we have no visibility into
// what happens after the message is delivered.
// Future: Twilio forwarding numbers for premium vendors.
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

  // Only increment for impressions — the only event we reliably track
  if (eventType === 'impression') {
    await supabase
      .rpc('increment_impression_count', { p_business_id: businessId })
      .catch(err => console.warn('[db] increment_impression_count failed:', err.message));
  }
}

// ── ADD logBusinessEvent TO module.exports in db.js ──────────
