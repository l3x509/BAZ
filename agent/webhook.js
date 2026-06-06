'use strict';

const { processMessage } = require('./router');
const { markAsRead }     = require('./whatsapp');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// ── GET /webhook — Meta verification challenge ────────────────
function handleVerification(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] Meta verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] Meta verification failed — token mismatch');
  return res.sendStatus(403);
}

// ── POST /webhook — Inbound messages ─────────────────────────
function handleWebhook(req, res) {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') continue;

        const value    = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        if (!messages.length) continue;

        for (const msg of messages) {
          const messageType = msg.type || 'text';
          let content = '';

          if (messageType === 'text') {
            content = msg.text?.body || '';
          } else if (messageType === 'interactive') {
            content = msg.interactive?.button_reply?.title
                   || msg.interactive?.list_reply?.title
                   || '';
          }

          const contact     = contacts.find(c => c.wa_id === msg.from) || contacts[0] || {};
          const waId        = msg.from;
          const displayName = contact.profile?.name || '';
          const messageId   = msg.id;

          if (!waId) continue;

          console.log(`[webhook] ${new Date().toISOString()} | from=${waId} type=${messageType} body="${content.slice(0, 60)}"`);

          markAsRead(messageId).catch(() => {});

          processMessage({ waId, displayName, messageId, messageType, content })
            .catch(err => console.error('[webhook] processMessage error:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('[webhook] parse error:', err.message);
  }
}

// ── PASSTHROUGH ───────────────────────────────────────────────
// validateTwilioSignature is still imported by the current server.js.
// This no-op keeps server.js working until it's updated to the new version.
// Safe to remove once server.js is updated.
function validateTwilioSignature(req, res, next) { next(); }

module.exports = { handleWebhook, handleVerification, validateTwilioSignature };
