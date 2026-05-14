const db = require('../db');

// ============================================================
// TWINZILE EVENT LOGGER
// Wraps db.logEvent with context enrichment
// Silent — never throws, never blocks the main flow
// ============================================================

async function emit(eventType, { user, conversation, entityType, entityId, payload } = {}) {
  try {
    await db.logEvent({
      eventType,
      userId: user?.id || null,
      sessionId: conversation?.id || null,
      entityType: entityType || null,
      entityId: entityId || null,
      payload: {
        ...payload,
        user_language: user?.language,
        user_role: user?.role,
      },
      city: user?.location_city || payload?.city || null,
      country: user?.location_country || payload?.country || null,
    });
  } catch (err) {
    // Never surface TwinZile errors to the main flow
    console.error('TwinZile event failed silently:', err.message);
  }
}

module.exports = { emit };
