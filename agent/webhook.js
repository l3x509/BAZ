'use strict';

const twilio             = require('twilio');
const { processMessage } = require('./router');

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;

// ── TWILIO SIGNATURE VALIDATION ───────────────────────────────
// Railway terminates SSL at the proxy layer — req.protocol returns
// 'http' but Twilio always signs with 'https'. Force https here
// so the URL used for validation matches what Twilio signed.
function validateTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'] || '';
  const protocol  = req.headers['x-forwarded-proto'] || 'https';
  const url       = `${protocol}://${req.get('host')}${req.originalUrl}`;
  const valid     = twilio.validateRequest(AUTH_TOKEN, signature, url, req.body);

  if (!valid) {
    console.warn('[webhook] Invalid Twilio signature — rejected');
    console.warn('[webhook] URL used:', url);
    return res.status(403).type('text/xml').send('<Response></Response>');
  }
  next();
}

// ── INBOUND MESSAGE HANDLER ───────────────────────────────────
async function handleWebhook(req, res) {
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
