// ============================================================
// VITRIN — SELL HANDLER
// Handles the 'sell' mode — vendor product listing creation.
// Voice note → Whisper transcription → Claude draft → confirm → live.
//
// STATUS: Stub — Phase 2
// Flow (when built):
//   1. Check if user is already a vendor (users.role === 'vendor')
//      → If not: route to onboard flow first
//   2. Ask for product details (via voice note or text)
//   3. Transcribe voice note via Whisper (utils/whisper.js)
//   4. Extract product details via Claude (name, price, description)
//   5. Show draft listing for confirmation
//   6. On confirm: create product record (status: draft → pending review)
//   7. Notify vendor when listing goes live
// ============================================================

const { sendText } = require('../whatsapp');

const COMING_SOON = {
  ht: `🏪 Fonksyon pou *vann sou Vitrin* ap vini byento!\n\nPou kòmanse, ale sou *bazht.com* epi enskri kòm vandè. N ap kontakte w lè ou ka komanse fè lis pwodui ou yo sou WhatsApp.`,
  en: `🏪 *Sell on Vitrin* is coming soon!\n\nTo get started, visit *bazht.com* and register as a vendor. We'll reach out when you can start listing products on WhatsApp.`,
  fr: `🏪 La fonction *vendre sur Vitrin* arrive bientôt!\n\nPour commencer, visitez *bazht.com* et inscrivez-vous comme vendeur. Nous vous contacterons quand vous pourrez commencer à lister vos produits sur WhatsApp.`,
};

async function handle({ user, message, lang, conversationHistory, category, mode }) {
  console.log(`[vitrin-sell] category=${category} user=${user.whatsapp_id}`);
  return sendText(user.whatsapp_id, COMING_SOON[lang] || COMING_SOON.en);
}

module.exports = { handle };
