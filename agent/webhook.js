const { processMessage }  = require('./router');
const { isDuplicate }     = require('./db');
const { transcribeAudio } = require('./utils/whisper');

// ============================================================
// TWILIO WHATSAPP WEBHOOK
// POST /webhook
//
// Key differences from Meta:
// - Payload is form-encoded (not JSON) — express needs urlencoded middleware
// - From field includes 'whatsapp:' prefix — must strip it
// - MessageSid is the unique message ID
// - Audio comes as MediaUrl0, downloaded with Twilio credentials
// - No GET verification endpoint needed
// ============================================================

async function handleWebhook(req, res) {
  // Twilio expects 200 immediately
  res.sendStatus(200);

  try {
    const body = req.body;

    // Strip 'whatsapp:+15551234567' → '+15551234567'
    const waId        = (body.From || '').replace('whatsapp:', '');
    const displayName = body.ProfileName || '';
    const messageId   = body.MessageSid;
    const numMedia    = parseInt(body.NumMedia || '0', 10);

    if (!waId || !messageId) return;

    // Deduplicate
    if (await isDuplicate(messageId)) {
      console.log(`Duplicate message ${messageId}, skipping`);
      return;
    }

    let content     = null;
    let messageType = 'text';

    if (numMedia > 0) {
      const mediaType = body.MediaContentType0 || '';
      const mediaUrl  = body.MediaUrl0 || '';

      if (mediaType.startsWith('audio/')) {
        // Voice note — transcribe via Whisper
        content     = await transcribeAudio(mediaUrl);
        messageType = 'voice';
      } else {
        // Images, docs, etc. not supported yet
        return;
      }

    } else {
      content = (body.Body || '').trim();
    }

    if (!content) return;

    await processMessage({ waId, displayName, messageId, messageType, content });

  } catch (err) {
    console.error('Webhook error:', err);
  }
}

module.exports = { handleWebhook };
