'use strict';

const { sendText } = require('../whatsapp');

// ============================================================
// STATUS HANDLER
// Order / payment / booking status
// ============================================================

async function handle({ user, message, lang, conversationHistory }) {
  const msg = {
    ht: `📦 *Estati Kòmand ou*\n\nPou tcheke estati:\n• Voye nimewo kòmand ou (egzanp: *#BZ-1041*)\n• Oswa kontakte vandè a dirèkteman\n\nFonksyon suivi otomatik ap vini byento.\n\n_Ekri *0* pou retounen_`,
    en: `📦 *Order Status*\n\nTo check your status:\n• Send your order number (e.g. *#BZ-1041*)\n• Or contact the vendor directly\n\nAutomatic tracking is coming soon.\n\n_Type *0* to go back_`,
    fr: `📦 *Statut de Commande*\n\nPour vérifier votre statut:\n• Envoyez votre numéro de commande (ex: *#BZ-1041*)\n• Ou contactez le vendeur directement\n\n_Tapez *0* pour revenir_`,
  };
  return sendText(user.whatsapp_id, msg[lang] || msg.en);
}

module.exports = { handle };
