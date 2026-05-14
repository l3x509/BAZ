const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}`;

const headers = () => ({
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

// ============================================================
// CORE SEND
// ============================================================

async function sendRaw(payload) {
  try {
    const res = await axios.post(`${BASE_URL}/messages`, payload, { headers: headers() });
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('WhatsApp send error:', JSON.stringify(detail));
    throw err;
  }
}

// ============================================================
// TEXT MESSAGE
// ============================================================

async function sendText(to, text) {
  return sendRaw({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text, preview_url: false },
  });
}

// ============================================================
// BUTTONS (up to 3)
// ============================================================

async function sendButtons(to, bodyText, buttons) {
  // buttons: [{ id: 'btn_id', title: 'Label' }]
  return sendRaw({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.substring(0, 20) }, // Meta limit: 20 chars
        })),
      },
    },
  });
}

// ============================================================
// LIST (up to 10 items)
// ============================================================

async function sendList(to, bodyText, buttonLabel, sections) {
  // sections: [{ title: 'Section', rows: [{ id, title, description }] }]
  return sendRaw({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonLabel.substring(0, 20),
        sections: sections.map(s => ({
          title: s.title.substring(0, 24),
          rows: s.rows.map(r => ({
            id: r.id.substring(0, 200),
            title: r.title.substring(0, 24),
            description: (r.description || '').substring(0, 72),
          })),
        })),
      },
    },
  });
}

// ============================================================
// LANGUAGE SELECTION — special first-session message
// ============================================================

async function sendLanguageSelection(to) {
  return sendButtons(to,
    '👋 Welcome to Baz!\n\nPlease choose your language:\nKouman ou vle pale?\nChoisissez votre langue:',
    [
      { id: 'lang_ht', title: '🇭🇹 Kreyòl' },
      { id: 'lang_en', title: '🇺🇸 English' },
      { id: 'lang_fr', title: '🇫🇷 Français' },
    ]
  );
}

// ============================================================
// BUSINESS RESULTS LIST
// ============================================================

async function sendBusinessResults(to, businesses, lang) {
  if (!businesses.length) return null;

  const labels = {
    ht: { header: 'Rezilta yo', button: 'Wè plis', verified: '✅ Verifye' },
    en: { header: 'Results', button: 'See more', verified: '✅ Verified' },
    fr: { header: 'Résultats', button: 'Voir plus', verified: '✅ Vérifié' },
  };
  const l = labels[lang] || labels.en;

  const rows = businesses.map(b => ({
    id: `biz_${b.id}`,
    title: b.name.substring(0, 24),
    description: [
      b.is_verified ? l.verified : '',
      b.avg_rating > 0 ? `⭐ ${b.avg_rating}` : '',
      b.neighborhood || b.city || '',
    ].filter(Boolean).join(' · ').substring(0, 72),
  }));

  return sendList(to, `📋 ${l.header}`, l.button, [{ title: l.header, rows }]);
}

// ============================================================
// BUSINESS DETAIL CARD
// ============================================================

async function sendBusinessDetail(to, business, lang) {
  const cat = business.service_categories;
  const icon = cat?.icon || '🏢';
  const catName = lang === 'ht' ? cat?.name_ht : lang === 'fr' ? cat?.name_fr : cat?.name_en;

  const lines = [
    `${icon} *${business.name}*`,
    catName ? `_${catName}_` : '',
    '',
    business.description || '',
    '',
    business.neighborhood ? `📍 ${business.neighborhood}, ${business.city}` : `📍 ${business.city}`,
    business.phone ? `📞 ${business.phone}` : '',
    business.whatsapp ? `💬 wa.me/${business.whatsapp.replace(/\D/g, '')}` : '',
    business.avg_rating > 0 ? `⭐ ${business.avg_rating} (${business.review_count} reviews)` : '',
    business.is_verified ? '✅ Verified business' : '',
  ].filter(Boolean).join('\n');

  const contactButtons = {
    ht: 'Kontakte',
    en: 'Contact',
    fr: 'Contacter',
  };

  return sendButtons(to, lines, [
    { id: `contact_${business.id}`, title: contactButtons[lang] || 'Contact' },
    { id: `book_${business.id}`, title: '📅 Book' },
  ]);
}

module.exports = {
  sendText,
  sendButtons,
  sendList,
  sendLanguageSelection,
  sendBusinessResults,
  sendBusinessDetail,
};
