'use strict';
const { sendText } = require('../whatsapp');
async function handle({ user, message, lang }) {
  const msg = {
    ht: `🛍️ Vitrin ap vini byento! Ou pral ka achte pwodui ayisyen dirèkteman sou WhatsApp.\n\n_Ekri *0* pou retounen_`,
    en: `🛍️ Vitrin marketplace is coming soon! You'll be able to buy Haitian products directly on WhatsApp.\n\n_Type *0* to go back_`,
    fr: `🛍️ Le marketplace Vitrin arrive bientôt!\n\n_Tapez *0* pour revenir_`,
  };
  return sendText(user.whatsapp_id, msg[lang] || msg.en);
}
module.exports = { handle };
