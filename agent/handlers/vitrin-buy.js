// ============================================================
// VITRIN — BUY HANDLER
// Handles the 'buy' mode for product categories.
// Users browse and purchase products from the Vitrin marketplace.
//
// STATUS: Stub — Phase 2
// Flow (when built):
//   1. Search active_products by category + optional filters
//   2. Present numbered product list with price + vendor
//   3. User selects a product
//   4. Confirm order details (quantity, delivery method)
//   5. Generate Stripe payment link
//   6. Create order record (status: pending)
//   7. Send payment link to user
//   8. On Stripe webhook: update order to paid, notify vendor
// ============================================================

const { sendText } = require('../whatsapp');

const COMING_SOON = {
  ht: `🛍️ *Vitrin* ap vini byento!\n\nW ap ka achte pwodui dirèkteman sou WhatsApp. Rete tann — n ap voye yon mesaj lè li prèt.`,
  en: `🛍️ *Vitrin* marketplace is coming soon!\n\nYou'll be able to browse and buy products directly on WhatsApp. Stay tuned!`,
  fr: `🛍️ La marketplace *Vitrin* arrive bientôt!\n\nVous pourrez parcourir et acheter des produits directement sur WhatsApp. Restez à l'écoute!`,
};

async function handle({ user, message, lang, conversationHistory, category, mode }) {
  console.log(`[vitrin-buy] category=${category} user=${user.whatsapp_id}`);
  return sendText(user.whatsapp_id, COMING_SOON[lang] || COMING_SOON.en);
}

module.exports = { handle };
