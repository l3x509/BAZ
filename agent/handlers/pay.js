'use strict';

const { sendText } = require('../whatsapp');

// ============================================================
// PAY HANDLER
// Voye lajan / Send money to Haiti
// Phase 1: Guided conversation — collects recipient + amount
// Phase 2: Stripe integration (coming soon)
// ============================================================

async function handle({ user, message, lang, conversationHistory }) {
  const msg = {
    ht: `💸 *Voye Lajan ann Ayiti*\n\nFonksyon sa a ap vini byento!\n\nKounye a ou ka itilize:\n• MonCash\n• Western Union\n• CAM Transfer\n• Unitransfer\n\n_Ekri *0* pou retounen_`,
    en: `💸 *Send Money to Haiti*\n\nThis feature is coming soon!\n\nFor now you can use:\n• MonCash\n• Western Union\n• CAM Transfer\n• Unitransfer\n\n_Type *0* to go back_`,
    fr: `💸 *Envoyer de l'argent en Haïti*\n\nCette fonctionnalité arrive bientôt!\n\nPour l'instant utilisez:\n• MonCash\n• Western Union\n• CAM Transfer\n• Unitransfer\n\n_Tapez *0* pour revenir_`,
  };
  return sendText(user.whatsapp_id, msg[lang] || msg.en);
}

module.exports = { handle };
