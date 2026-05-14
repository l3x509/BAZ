const axios = require('axios');

// ============================================================
// TWILIO WHATSAPP SENDER
//
// Twilio does NOT support interactive buttons or lists —
// those are Meta-only. Everything is plain text for now.
// When you migrate to Meta, swap this file back.
// ============================================================

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:')
  ? process.env.TWILIO_WHATSAPP_NUMBER
  : `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
const API_URL      = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

async function sendText(to, body) {
  try {
    await axios.post(
      API_URL,
      new URLSearchParams({
        From: FROM_NUMBER,
        To:   `whatsapp:${to}`,
        Body: body,
      }),
      {
        auth: { username: ACCOUNT_SID, password: AUTH_TOKEN },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Twilio send error:', JSON.stringify(detail));
    throw err;
  }
}

// ============================================================
// BUTTONS → plain text with numbered options
// ============================================================

async function sendButtons(to, bodyText, buttons) {
  const options = buttons
    .map((b, i) => `${i + 1}. ${b.title}`)
    .join('\n');
  return sendText(to, `${bodyText}\n\n${options}\n\n_Reply with the number of your choice._`);
}

// ============================================================
// LIST → plain text with numbered rows
// ============================================================

async function sendList(to, bodyText, buttonLabel, sections) {
  const lines = [bodyText, ''];
  sections.forEach(s => {
    if (s.title) lines.push(`*${s.title}*`);
    s.rows.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`);
    });
  });
  lines.push('\n_Reply with the number of your choice._');
  return sendText(to, lines.join('\n'));
}

// ============================================================
// LANGUAGE SELECTION
// ============================================================

async function sendLanguageSelection(to) {
  return sendText(to,
    '👋 Welcome to Baz!\n\nPlease choose your language:\nKouman ou vle pale?\nChoisissez votre langue:\n\n1. 🇭🇹 Kreyòl — reply *lang_ht*\n2. 🇺🇸 English — reply *lang_en*\n3. 🇫🇷 Français — reply *lang_fr*'
  );
}

// ============================================================
// BUSINESS RESULTS
// ============================================================

async function sendBusinessResults(to, businesses, lang) {
  if (!businesses.length) return null;

  const headers = { ht: '📋 Rezilta yo:', en: '📋 Results:', fr: '📋 Résultats:' };
  const footer  = { ht: '_Reponn ak nimewo biznis ou vle a._', en: '_Reply with the number to learn more._', fr: '_Répondez avec le numéro pour en savoir plus._' };

  const lines = [headers[lang] || headers.en, ''];
  businesses.forEach((b, i) => {
    const verified = b.is_verified ? ' ✅' : '';
    const rating   = b.avg_rating > 0 ? ` ⭐${b.avg_rating}` : '';
    const location = b.neighborhood || b.city || '';
    lines.push(`${i + 1}. *${b.name}*${verified}${rating}`);
    if (location) lines.push(`   📍 ${location}`);
  });
  lines.push('');
  lines.push(footer[lang] || footer.en);

  return sendText(to, lines.join('\n'));
}

// ============================================================
// BUSINESS DETAIL
// ============================================================

async function sendBusinessDetail(to, business, lang) {
  const cat     = business.service_categories;
  const icon    = cat?.icon || '🏢';
  const catName = lang === 'ht' ? cat?.name_ht : lang === 'fr' ? cat?.name_fr : cat?.name_en;

  const lines = [
    `${icon} *${business.name}*`,
    catName ? `_${catName}_` : '',
    '',
    business.description || '',
    '',
    business.neighborhood ? `📍 ${business.neighborhood}, ${business.city}` : `📍 ${business.city || ''}`,
    business.phone   ? `📞 ${business.phone}` : '',
    business.whatsapp ? `💬 wa.me/${business.whatsapp.replace(/\D/g, '')}` : '',
    business.avg_rating > 0 ? `⭐ ${business.avg_rating} (${business.review_count} reviews)` : '',
    business.is_verified ? '✅ Verified business' : '',
  ].filter(Boolean).join('\n');

  return sendText(to, lines);
}

module.exports = {
  sendText,
  sendButtons,
  sendList,
  sendLanguageSelection,
  sendBusinessResults,
  sendBusinessDetail,
};
