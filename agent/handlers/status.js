const db = require('../db');
const wa = require('../whatsapp');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// STATUS HANDLER
// User asking about existing bookings or payments
// ============================================================

async function handleStatus({ user, conversation, lang }) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get recent bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, businesses(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(3);

  // Get recent remittances
  const { data: remittances } = await supabase
    .from('remittances')
    .select('*')
    .eq('sender_id', user.id)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!bookings?.length && !remittances?.length) {
    const noActivity = {
      ht: '📭 Ou pa gen okenn rezèvasyon oswa peman resan.\n\nEsaye di: "Mwen bezwen yon plonbye" pou kòmanse!',
      en: '📭 You have no recent bookings or payments.\n\nTry saying: "I need a plumber" to get started!',
      fr: '📭 Vous n\'avez pas de réservations ou paiements récents.\n\nEssayez: "J\'ai besoin d\'un plombier" pour commencer!',
    };
    await wa.sendText(user.whatsapp_id, noActivity[lang] || noActivity.en);
    return;
  }

  const lines = [];

  const bookingHeader = { ht: '📅 *Rezèvasyon resan:*', en: '📅 *Recent bookings:*', fr: '📅 *Réservations récentes:*' };
  const remitHeader = { ht: '💸 *Peman resan:*', en: '💸 *Recent payments:*', fr: '💸 *Paiements récents:*' };

  const statusEmoji = {
    inquiry: '🔵', confirmed: '✅', in_progress: '🔄',
    completed: '✅', cancelled: '❌', pending: '⏳',
    processing: '🔄', failed: '❌', refunded: '↩️',
  };

  if (bookings?.length) {
    lines.push(bookingHeader[lang] || bookingHeader.en);
    bookings.forEach(b => {
      const emoji = statusEmoji[b.status] || '🔵';
      lines.push(`${emoji} ${b.businesses?.name || 'Business'} — ${b.status}`);
    });
  }

  if (remittances?.length) {
    if (lines.length) lines.push('');
    lines.push(remitHeader[lang] || remitHeader.en);
    remittances.forEach(r => {
      const emoji = statusEmoji[r.status] || '⏳';
      lines.push(`${emoji} $${r.total_amount} → ${r.recipient_name} — ${r.status}`);
    });
  }

  await wa.sendText(user.whatsapp_id, lines.join('\n'));
}

module.exports = { handleStatus };
