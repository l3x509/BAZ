'use strict';

const twilio         = require('twilio');
const { processMessage } = require('./router');

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;

// ── TWILIO SIGNATURE VALIDATION ───────────────────────────────
// Rejects anything not genuinely from Twilio's servers.
function validateTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'] || '';
  const url       = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const valid     = twilio.validateRequest(AUTH_TOKEN, signature, url, req.body);
  if (!valid) {
    console.warn('[webhook] Invalid Twilio signature — rejected');
    return res.status(403).type('text/xml').send('<Response></Response>');
  }
  next();
}

// ── INBOUND MESSAGE HANDLER ───────────────────────────────────
// Twilio sends form-encoded POST. Must always return TwiML XML.
async function handleWebhook(req, res) {
  // Respond immediately with empty TwiML — Twilio requires this.
  // Actual response sent via REST API in whatsapp.js.
  res.type('text/xml').send('<Response></Response>');

  try {
    const waId        = (req.body.From || '').replace('whatsapp:', '');
    const displayName = req.body.ProfileName || '';
    const messageId   = req.body.MessageSid  || '';
    const messageType = req.body.MediaUrl0   ? 'image' : 'text';
    const content     = req.body.Body        || '';

    if (!waId) return;

    console.log(`[webhook] ${new Date().toISOString()} | from=${waId} type=${messageType} body="${content.slice(0, 60)}"`);

    await processMessage({ waId, displayName, messageId, messageType, content });

  } catch (err) {
    console.error('[webhook] error:', err.message, err.stack);
  }
}

module.exports = { handleWebhook, validateTwilioSignature };
