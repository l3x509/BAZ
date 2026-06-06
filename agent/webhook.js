'use strict';

// ============================================================
// META CLOUD API — WEBHOOK HANDLER
// Exports handleVerification (GET) and handleWebhook (POST)
// matching the existing server.js mount pattern.
// ============================================================

const { processMessage } = require('./router');
const { markAsRead }     = require('./whatsapp');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// ── GET /webhook — Meta verification challenge ────────────────
// Called once when you configure the webhook URL in Meta Business Manager.
// Must echo back hub.challenge to confirm ownership.
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
// Meta sends messages AND status updates (delivered/read) here.
// Respond 200 immediately — never block on processing.
function handleWebhook(req, res) {
  // Respond immediately — Meta retries if response is slow
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body?.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];

    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') continue;

        const value    = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        // Status updates (delivered/read receipts) have no messages array
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
          // audio/image/sticker etc → content stays '' → router sends unknown

          const contact     = contacts.find(c => c.wa_id === msg.from) || contacts[0] || {};
          const waId        = msg.from;
          const displayName = contact.profile?.name || '';
          const messageId   = msg.id;

          if (!waId) continue;

          console.log(`[webhook] ${new Date().toISOString()} | from=${waId} type=${messageType} body="${content.slice(0, 60)}"`);

          // Mark as read — blue checkmarks (fire-and-forget)
          markAsRead(messageId).catch(() => {});

          // Process message fully async — response already sent above
          processMessage({ waId, displayName, messageId, messageType, content })
            .catch(err => console.error('[webhook] processMessage error:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('[webhook] parse error:', err.message);
  }
}

module.exports = { handleWebhook, handleVerification };
