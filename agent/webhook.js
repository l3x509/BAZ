const { processMessage } = require('./router');

// ============================================================
// META WEBHOOK VERIFICATION
// GET /webhook
// ============================================================
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }

  console.error('Webhook verification failed');
  res.sendStatus(403);
}

// ============================================================
// INCOMING MESSAGES
// POST /webhook
// ============================================================
async function handleWebhook(req, res) {
  // Always respond 200 immediately — Meta retries if we don't
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    const waId = message.from;
    const displayName = contact?.profile?.name || '';
    const messageId = message.id;

    // Deduplicate — Meta sometimes sends the same message twice
    const { isDuplicate } = require('./db');
    if (await isDuplicate(messageId)) {
      console.log(`Duplicate message ${messageId}, skipping`);
      return;
    }

    // Parse the message content
    let content = null;
    let messageType = message.type;

    if (messageType === 'text') {
      content = message.text?.body?.trim();
    } else if (messageType === 'audio') {
      // Voice note — transcribe via Whisper
      const { transcribeAudio } = require('./utils/whisper');
      content = await transcribeAudio(message.audio.id);
      messageType = 'voice';
    } else if (messageType === 'interactive') {
      // Button or list reply
      const interactive = message.interactive;
      if (interactive.type === 'button_reply') {
        content = interactive.button_reply.id; // use the button ID as content
        messageType = 'button';
      } else if (interactive.type === 'list_reply') {
        content = interactive.list_reply.id;
        messageType = 'list';
      }
    } else {
      // Unsupported type — ignore silently
      return;
    }

    if (!content) return;

    await processMessage({
      waId,
      displayName,
      messageId,
      messageType,
      content,
    });

  } catch (err) {
    console.error('Webhook error:', err);
  }
}

module.exports = { verifyWebhook, handleWebhook };
