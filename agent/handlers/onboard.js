'use strict';

const { sendText } = require('../whatsapp');

// ============================================================
// ONBOARD HANDLER
// Vendor registration — directs to bazht.com/vendor
// ============================================================

async function handle({ user, message, lang, conversationHistory }) {
  const msg = {
    ht: `🏪 *Vin Vandè sou Baz!*\n\nPou enskri biznis ou oswa pwodui ou:\n\n🌐 *bazht.com/vendor*\n\nOu ka:\n• Anrejistre biznis ou gratis\n• Vann pwodui sou Vitrin\n• Resevwa kòmand sou WhatsApp\n\nFòm lan pran 5 minit. Nou kontakte w nan 24è.\n\n_Ekri *0* pou retounen_`,
    en: `🏪 *Become a Baz Vendor!*\n\nTo register your business or products:\n\n🌐 *bazht.com/vendor*\n\nYou can:\n• List your business for free\n• Sell products on Vitrin\n• Receive orders on WhatsApp\n\nThe form takes 5 minutes. We contact you within 24 hours.\n\n_Type *0* to go back_`,
    fr: `🏪 *Devenez Vendeur Baz!*\n\nPour enregistrer votre entreprise:\n\n🌐 *bazht.com/vendor*\n\nVous pouvez:\n• Inscrire votre entreprise gratuitement\n• Vendre sur Vitrin\n• Recevoir des commandes sur WhatsApp\n\n_Tapez *0* pour revenir_`,
  };
  return sendText(user.whatsapp_id, msg[lang] || msg.en);
}

module.exports = { handle };
