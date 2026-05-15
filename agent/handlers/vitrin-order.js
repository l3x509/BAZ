// ============================================================
// VITRIN — ORDER HANDLER
// Handles the 'order' mode — food and delivery orders.
// For restaurant, cook, grocery, and food_products categories.
//
// STATUS: Stub — Phase 2
// Flow (when built):
//   1. Find businesses/vendors in category + user's city
//   2. Present numbered list (name, rating, delivery time)
//   3. User selects a vendor
//   4. Show menu / available items
//   5. User selects items + quantity
//   6. Confirm order summary + delivery details
//   7. Generate Stripe payment link
//   8. Create order record
//   9. Notify vendor via WhatsApp
// ============================================================

const { sendText } = require('../whatsapp');

const COMING_SOON = {
  ht: `🍽️ Kòmand livrezon ap vini byento!\n\nW ap ka kòmande manje ak pwodui dirèkteman sou WhatsApp. Rete tann!`,
  en: `🍽️ Food & delivery ordering is coming soon!\n\nYou'll be able to order food and products directly on WhatsApp. Stay tuned!`,
  fr: `🍽️ Les commandes de livraison arrivent bientôt!\n\nVous pourrez commander de la nourriture et des produits directement sur WhatsApp. Restez à l'écoute!`,
};

async function handle({ user, message, lang, conversationHistory, category, mode }) {
  console.log(`[vitrin-order] category=${category} user=${user.whatsapp_id}`);
  return sendText(user.whatsapp_id, COMING_SOON[lang] || COMING_SOON.en);
}

module.exports = { handle };
