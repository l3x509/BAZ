'use strict';
const { sendText } = require('../whatsapp');
async function handle({ user, message, lang }) {
  const msg = {
    ht: `🏪 Vann sou Vitrin ap vini byento!\n\nPou kòmanse vann kounye a:\n🌐 *bazht.com/vendor*\n\n_Ekri *0* pou retounen_`,
    en: `🏪 Selling on Vitrin is coming soon!\n\nTo start selling now:\n🌐 *bazht.com/vendor*\n\n_Type *0* to go back_`,
    fr: `🏪 Vendre sur Vitrin arrive bientôt!\n\nPour commencer:\n🌐 *bazht.com/vendor*\n\n_Tapez *0* pour revenir_`,
  };
  return sendText(user.whatsapp_id, msg[lang] || msg.en);
}
module.exports = { handle };
