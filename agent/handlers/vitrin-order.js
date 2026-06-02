'use strict';
const { sendText } = require('../whatsapp');
async function handle({ user, message, lang }) {
  const msg = {
    ht: `📦 Kòmand ak livrezon ap vini byento!\n\n_Ekri *0* pou retounen_`,
    en: `📦 Ordering and delivery is coming soon!\n\n_Type *0* to go back_`,
    fr: `📦 Les commandes et livraisons arrivent bientôt!\n\n_Tapez *0* pour revenir_`,
  };
  return sendText(user.whatsapp_id, msg[lang] || msg.en);
}
module.exports = { handle };
