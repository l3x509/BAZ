'use strict';

const axios = require('axios');

// ============================================================
// META CLOUD API — WHATSAPP SENDER
// ============================================================

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN           = process.env.WHATSAPP_TOKEN;
const API_URL         = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

async function sendText(to, body) {
  if (!body || !body.trim()) return;
  try {
    await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        to:                to.replace(/[^0-9]/g, ''),
        type:              'text',
        text:              { body: body.trim(), preview_url: false },
      },
      {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type':  'application/json',
        },
      }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[whatsapp] sendText error:', JSON.stringify(detail));
    throw err;
  }
}

async function markAsRead(messageId) {
  if (!messageId) return;
  try {
    await axios.post(
      API_URL,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch {}
}

async function sendButtons(to, bodyText, buttons) {
  // Max 3 buttons for WhatsApp interactive button messages
  if (!buttons?.length) return;
  try {
    await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        to:   to.replace(/[^0-9]/g, ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map((b, i) => ({
              type:  'reply',
              reply: { id: b.id || String(i + 1), title: b.title.slice(0, 20) },
            })),
          },
        },
      },
      { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch {
    // Fallback to plain text if interactive fails
    const options = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    return sendText(to, `${bodyText}\n\n${options}\n\n_Reply with the number of your choice._`);
  }
}

async function sendList(to, bodyText, buttonLabel, sections) {
  // WhatsApp interactive list — max 10 rows total, row titles max 24 chars
  const totalRows = sections.reduce((n, s) => n + (s.rows?.length || 0), 0);

  if (totalRows > 10) {
    // Fallback to plain text for large lists
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

  try {
    await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        to:   to.replace(/[^0-9]/g, ''),
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: (buttonLabel || 'View Options').slice(0, 20),
            sections: sections.map(s => ({
              title: (s.title || '').slice(0, 24),
              rows:  (s.rows || []).map(r => ({
                id:          (r.id || r.title).slice(0, 200),
                title:       r.title.slice(0, 24),
                description: (r.description || '').slice(0, 72),
              })),
            })),
          },
        },
      },
      { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch {
    // Fallback to plain text
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
}

async function sendLanguageSelection(to) {
  return sendText(to,
    '👋 Welcome to Baz!\n\n1. 🇭🇹 Kreyòl — type *lang_ht*\n2. 🇺🇸 English — type *lang_en*\n3. 🇫🇷 Français — type *lang_fr*'
  );
}

function getTier(b) {
  return (b && b.listing_tier) ? b.listing_tier : 'free';
}

async function sendPremiumSpotlight(to, business, lang) {
  try {
    const divider = '──────────────────────';
    if (business) {
      const name     = business.name        || 'Business';
      const city     = business.city        || '';
      const address  = business.address     || '';
      const phone    = business.phone       || null;
      const website  = business.website     || null;
      const desc     = business.description || null;
      const hours    = (business.meta && business.meta.hours) ? business.meta.hours : null;
      const waRaw    = business.whatsapp    || null;
      const waNum    = waRaw ? waRaw.replace(/[^0-9]/g, '') : null;
      const cityLine = [address, city].filter(Boolean).join(', ');
      const lines = [
        `💎 *${name}* ✅`,
        cityLine ? `📍 ${cityLine}` : null,
        phone    ? `📞 ${phone}`    : null,
        website  ? `🌐 ${website}`  : null,
        waNum    ? `💬 wa.me/${waNum}` : null,
        hours    ? `🕐 ${hours}`    : null,
        divider,
        desc     ? `_${desc}_`      : null,
      ].filter(Boolean).join('\n');
      return await sendText(to, lines);
    }
    const placeholder = {
      ht: `💎 *[Biznis Paw La]*\n✅ Verifye · 📍 Vil Ou, MA\n📞 (XXX) XXX-XXXX\n🌐 yourwebsite.com\n🕐 Lendi–Samdi 9AM–9PM\n${divider}\n_Vle plas sa a? Ekri *JOIN*_`,
      en: `💎 *[Your Business Here]*\n✅ Verified · 📍 Your City, MA\n📞 (XXX) XXX-XXXX\n🌐 yourwebsite.com\n🕐 Mon–Sat 9AM–9PM\n${divider}\n_Want this spot? Type *JOIN*_`,
      fr: `💎 *[Votre Entreprise Ici]*\n✅ Vérifié · 📍 Votre Ville, MA\n📞 (XXX) XXX-XXXX\n🌐 votresite.com\n🕐 Lun–Sam 9AM–9PM\n${divider}\n_Vous voulez cette place? Tapez *JOIN*_`,
    };
    return await sendText(to, placeholder[lang] || placeholder.en);
  } catch (err) {
    console.warn('[whatsapp] sendPremiumSpotlight failed (non-fatal):', err.message);
  }
}

async function sendBusinessResults(to, businesses, lang, hasMore = false, showSpotlight = true) {
  if (!businesses?.length) return null;
  const tierOrder = { premium: 0, pro: 1, standard: 2, free: 3 };
  const sorted = [...businesses].sort((a, b) => {
    const tDiff = (tierOrder[getTier(a)] ?? 3) - (tierOrder[getTier(b)] ?? 3);
    if (tDiff !== 0) return tDiff;
    return (b.avg_rating || 0) - (a.avg_rating || 0);
  });
  if (showSpotlight) {
    const premium = sorted.find(b => getTier(b) === 'premium') || null;
    await sendPremiumSpotlight(to, premium, lang);
  }
  const headers    = { ht: '📋 *Rezilta yo:*', en: '📋 *Results:*', fr: '📋 *Résultats:*' };
  const lines = [headers[lang] || headers.en, ''];
  sorted.forEach((b, i) => {
    const tier     = getTier(b);
    const verified = b.is_verified ? ' ✅' : '';
    const rating   = b.avg_rating > 0 ? ` ⭐${b.avg_rating}` : '';
    const cityLine = [b.address, b.city].filter(Boolean).join(', ');
    const waNum    = b.whatsapp?.replace(/[^0-9]/g, '');
    if (tier === 'premium') {
      lines.push(`${i + 1}. 👑 *${b.name}*${verified}${rating} _[Featured]_`);
      if (b.address) lines.push(`   📍 ${b.address}`);
      if (b.phone)   lines.push(`   📞 ${b.phone}`);
    } else if (tier === 'pro') {
      lines.push(`${i + 1}. 🔥 *${b.name}*${verified}${rating}`);
      if (b.description) lines.push(`   _${b.description}_`);
      if (cityLine)      lines.push(`   📍 ${cityLine}`);
      if (b.phone)       lines.push(`   📞 ${b.phone}`);
      if (b.website)     lines.push(`   🌐 ${b.website}`);
      if (waNum)         lines.push(`   💬 wa.me/${waNum}`);
    } else if (tier === 'standard') {
      lines.push(`${i + 1}. *${b.name}*${verified}${rating}`);
      if (b.address) lines.push(`   🏠 ${b.address}`);
      if (b.phone)   lines.push(`   📞 ${b.phone}`);
    } else {
      lines.push(`${i + 1}. ${b.name}`);
      if (b.phone) lines.push(`   📞 ${b.phone}`);
    }
    lines.push('');
  });
  // Send results text
  await sendText(to, lines.join('\n'));

  // Navigation buttons — replaces having to type "plis" or "menu"
  await new Promise(r => setTimeout(r, 800));
  try {
    const navBody = {
      ht: hasMore ? 'Ou vle wè plis rezilta?' : 'Ou wè tout rezilta yo.',
      en: hasMore ? 'Want to see more results?' : "You've seen all results.",
      fr: hasMore ? 'Voir plus de résultats?' : 'Résultats terminés.',
    };
    const navButtons = hasMore
      ? [{ id: 'plis', title: '📋 Plis rezilta' }, { id: 'menu', title: '🏠 Menu' }]
      : [{ id: 'menu', title: '🏠 Retounen menu' }];
    await sendButtons(to, navBody[lang] || navBody.en, navButtons);
  } catch {}
}

async function sendBusinessDetail(to, business, lang) {
  if (!business) return;
  const cat      = business.service_categories;
  const icon     = cat?.icon || '🏢';
  const catName  = lang === 'ht' ? cat?.name_ht : lang === 'fr' ? cat?.name_fr : cat?.name_en;
  const hours    = (business.meta && business.meta.hours) ? business.meta.hours : null;
  const waNum    = business.whatsapp?.replace(/[^0-9]/g, '');
  const cityLine = [business.address, business.city].filter(Boolean).join(', ');
  const lines = [
    `${icon} *${business.name}*`,
    catName ? `_${catName}_` : null,
    '',
    business.description || null,
    '',
    cityLine           ? `📍 ${cityLine}`   : null,
    business.phone     ? `📞 ${business.phone}` : null,
    waNum              ? `💬 wa.me/${waNum}` : null,
    business.website   ? `🌐 ${business.website}` : null,
    hours              ? `🕐 ${hours}`      : null,
    business.avg_rating > 0 ? `⭐ ${business.avg_rating} (${business.review_count} reviews)` : null,
    business.is_verified ? '✅ Verified business' : null,
    '',
    lang === 'ht' ? '_Ekri *menu* pou retounen_' : lang === 'fr' ? '_Tapez *menu* pour revenir_' : '_Type *menu* to go back_',
  ].filter(Boolean).join('\n');
  return sendText(to, lines);
}

module.exports = { sendText, sendButtons, sendList, sendLanguageSelection, sendBusinessResults, sendBusinessDetail, markAsRead, sendGreeting };

// ── GREETING WITH QUICK REPLY BUTTONS ────────────────────────
// Replaces plain text greeting. Three tappable buttons cover
// the most common entry points — IDs map directly to router keywords.
async function sendGreeting(to, lang) {
  const body = {
    ht: `👋 Byenvini nan *Baz* — Zone Biznis Ayisyen!\n\nEkri sa w bezwen oswa chwazi:`,
    en: `👋 Welcome to *Baz* — The Haitian Business Zone!\n\nTell me what you need or tap below:`,
    fr: `👋 Bienvenir sur *Baz* — Zone Business Haitien!\n\nDites-moi ce dont vous avez besoin:`,
  };
  const buttons = {
    ht: [
      { id: 'manje', title: '🍲 Manje / Food' },
      { id: 'ayiti', title: '⚽ Grenadye' },
      { id: 'tout',  title: '📋 Tout kategori' },
    ],
    en: [
      { id: 'food',  title: '🍲 Food' },
      { id: 'ayiti', title: '⚽ Grenadye' },
      { id: 'all',   title: '📋 All Categories' },
    ],
    fr: [
      { id: 'restaurant', title: '🍲 Restaurant' },
      { id: 'ayiti',      title: '⚽ Grenadye' },
      { id: 'tout',       title: '📋 Toutes catégories' },
    ],
  };
  return sendButtons(to, body[lang] || body.en, buttons[lang] || buttons.en);
}
