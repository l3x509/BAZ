const axios = require('axios');

// ============================================================
// TWILIO WHATSAPP SENDER
// Plain text only — interactive buttons/lists require Meta API.
// Those will work automatically once Meta verification clears.
// ============================================================

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:')
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
        auth:    { username: ACCOUNT_SID, password: AUTH_TOKEN },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Twilio send error:', JSON.stringify(detail));
    throw err;
  }
}

// ── BUTTONS → numbered plain text ────────────────────────────
async function sendButtons(to, bodyText, buttons) {
  const options = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  return sendText(to, `${bodyText}\n\n${options}\n\n_Reply with the number of your choice._`);
}

// ── LIST → numbered plain text ────────────────────────────────
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

// ── LANGUAGE SELECTION ────────────────────────────────────────
async function sendLanguageSelection(to) {
  return sendText(to,
    '👋 Welcome to Baz!\n\n1. 🇭🇹 Kreyòl — type *lang_ht*\n2. 🇺🇸 English — type *lang_en*\n3. 🇫🇷 Français — type *lang_fr*'
  );
}

// ── BUSINESS RESULTS ─────────────────────────────────────────
// Shows name, rating, location, address, and phone.
// Includes "more" prompt for pagination and "back" to return.
async function sendBusinessResults(to, businesses, lang, hasMore = false) {
  if (!businesses.length) return null;

  const headers = {
    ht: '📋 *Rezilta yo:*',
    en: '📋 *Results:*',
    fr: '📋 *Résultats:*',
  };
  const morePrompt = {
    ht: '_Ekri *plis* pou wè plis · *0* pou retounen_',
    en: '_Type *more* for more results · *0* to go back_',
    fr: '_Tapez *plus* pour voir plus · *0* pour revenir_',
  };
  const noMorePrompt = {
    ht: '_Reponn ak nimewo pou kontakte · *0* pou retounen_',
    en: '_Reply with a number to contact · *0* to go back_',
    fr: '_Répondez avec un numéro · *0* pour revenir_',
  };

  const lines = [headers[lang] || headers.en, ''];

  businesses.forEach((b, i) => {
    const verified  = b.is_verified ? ' ✅' : '';
    const rating    = b.avg_rating > 0 ? ` ⭐${b.avg_rating}` : '';
    const location  = [b.neighborhood, b.city].filter(Boolean).join(', ');

    lines.push(`${i + 1}. *${b.name}*${verified}${rating}`);
    if (location)   lines.push(`   📍 ${location}`);
    if (b.address)  lines.push(`   🏠 ${b.address}`);
    if (b.phone)    lines.push(`   📞 ${b.phone}`);
    if (b.whatsapp && b.whatsapp !== b.phone) {
      lines.push(`   💬 wa.me/${b.whatsapp.replace(/\D/g, '')}`);
    }
    lines.push('');
  });

  const footer = hasMore
    ? (morePrompt[lang]   || morePrompt.en)
    : (noMorePrompt[lang] || noMorePrompt.en);
  lines.push(footer);

  return sendText(to, lines.join('\n'));
}

// ── BUSINESS DETAIL ───────────────────────────────────────────
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
    business.neighborhood
      ? `📍 ${business.neighborhood}, ${business.city}`
      : `📍 ${business.city || ''}`,
    business.address   ? `🏠 ${business.address}`                              : '',
    business.phone     ? `📞 ${business.phone}`                                : '',
    business.whatsapp  ? `💬 wa.me/${business.whatsapp.replace(/\D/g, '')}`   : '',
    business.website   ? `🌐 ${business.website}`                              : '',
    business.avg_rating > 0
      ? `⭐ ${business.avg_rating} (${business.review_count} reviews)`
      : '',
    business.is_verified ? '✅ Verified business' : '',
    '',
    '_Type *0* to go back_',
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
