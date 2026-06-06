'use strict';

// ============================================================
// META CLOUD API — WEBHOOK HANDLER
// Replaces Twilio webhook. Handles:
//   GET  /webhook — Meta verification challenge
//   POST /webhook — Inbound messages + status updates
// ============================================================

const { processMessage } = require('./router');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// ── MOUNT THIS IN server.js / app.js ─────────────────────────
// app.get('/webhook',  handleVerification);
// app.post('/webhook', handleWebhook);
// OR: app.use('/webhook', webhookRouter);

const express = require('express');
const router  = express.Router();

// ── VERIFICATION ──────────────────────────────────────────────
// Meta sends a GET with hub.mode=subscribe and hub.verify_token
// on first setup. Must echo back hub.challenge to confirm.
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] Meta verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] Meta verification failed — token mismatch');
  return res.sendStatus(403);
});

// ── INBOUND MESSAGES ──────────────────────────────────────────
// Meta sends ALL events here: messages, delivery receipts, read receipts.
// Must respond 200 immediately — Meta will retry if response is slow.
// Process message AFTER responding (fire-and-forget pattern).
router.post('/', (req, res) => {
  // Respond 200 immediately — never block on processing
  res.sendStatus(200);

  try {
    const body = req.body;

    // Ignore non-WhatsApp events
    if (body?.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value    = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        // Status updates (delivered / read receipts) — skip
        if (!messages.length) continue;

        for (const msg of messages) {
          // Only handle inbound text for now
          // Extend here for audio, image, etc. as needed
          const messageType = msg.type || 'text';
          let content = '';

          if (messageType === 'text') {
            content = msg.text?.body || '';
          } else if (messageType === 'interactive') {
            // Button/list replies
            content = msg.interactive?.button_reply?.title
                   || msg.interactive?.list_reply?.title
                   || '';
          } else {
            // Audio, image, sticker, etc. — send unknown response
            content = '';
          }

          // Match contact to message by wa_id
          const contact     = contacts.find(c => c.wa_id === msg.from) || contacts[0] || {};
          const waId        = msg.from;
          const displayName = contact.profile?.name || '';
          const messageId   = msg.id;

          if (!waId) continue;

          console.log(`[webhook] ${new Date().toISOString()} | from=${waId} type=${messageType} body="${content.slice(0, 60)}"`);

          // Mark as read — shows blue checkmarks (fire-and-forget)
          try {
            const { markAsRead } = require('./whatsapp');
            markAsRead(messageId).catch(() => {});
          } catch {}

          // Process message — fully async, response already sent
          processMessage({
            waId,
            displayName,
            messageId,
            messageType,
            content,
          }).catch(err => {
            console.error('[webhook] processMessage error:', err.message, err.stack);
          });
        }
      }
    }
  } catch (err) {
    console.error('[webhook] parse error:', err.message);
  }
});

module.exports = router;
