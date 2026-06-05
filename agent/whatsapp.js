const axios = require('axios');

// ============================================================
// TWILIO WHATSAPP SENDER
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

// ── TIER DEFINITIONS ─────────────────────────────────────────
// listing_tier values in DB: 'free' | 'standard' | 'pro' | 'premium'
// Position logic:
//   premium → solo spotlight bubble sent BEFORE the list
//   pro     → always #1 in the list with badge
//   standard → #2–4, ordered by rating
//   free    → #5+, name + phone only

function getTier(b) {
  return b.listing_tier || 'free';
}

// ── PREMIUM SPOTLIGHT ─────────────────────────────────────────
// Sent as a separate bubble before the results list.
// Only fires if a premium business is in the result set.
async function sendPremiumSpotlight(to, business, lang) {
  const divider = '━━━━━━━━━━━━━━━━━━━━';

  const label = {
    ht: '🌟 *BIZNIS FEATYÈ BAZ* 🌟',
    en: '🌟 *BAZ FEATURED BUSINESS* 🌟',
    fr: '🌟 *ENTREPRISE EN VEDETTE BAZ* 🌟',
  };

  const hours = business.meta?.hours || null;
  const hoursLine = hours ? `\n🕐 ${hours}` : '';
  const websiteLine = business.website ? `\n🌐 ${business.website}` : '';
  const waNum = business.whatsapp?.replace(/[^0-9]/g, '');
  const waLine = waNum ? `\n💬 wa.me/${waNum}` : '';

  const lines = [
    divider,
    label[lang] || label.en,
    divider,
    '',
    `👑 *${business.name.toUpperCase()}* ✅`,
    business.description ? `_${business.description}_` : '',
    '',
    `📍 ${[business.address, business.city].filter(Boolean).join(', ')}`,
    `📞 ${business.phone}`,
    websiteLine,
    waLine,
    hoursLine,
    '',
    divider,
  ].filter(l => l !== null && l !== undefined).join('\n');

  return sendText(to, lines);
}

// ── BUSINESS RESULTS ─────────────────────────────────────────
async function sendBusinessResults(to, businesses, lang, hasMore = false, showSpotlight = true) {
  if (!businesses.length) return null;

  // ── Sort by tier: premium → pro → standard → free ──────────
  const tierOrder = { premium: 0, pro: 1, standard: 2, free: 3 };
  const sorted = [...businesses].sort((a, b) => {
    const tDiff = (tierOrder[getTier(a)] ?? 3) - (tierOrder[getTier(b)] ?? 3);
    if (tDiff !== 0) return tDiff;
    return (b.avg_rating || 0) - (a.avg_rating || 0);
  });

  // ── Premium: send spotlight first (page 1 only) ─────────────
  // If a premium business exists → show it. If not → show placeholder.
  // Skipped on pagination (page 2+) to avoid repetition.
  if (showSpotlight) {
    const premium = sorted.find(b => getTier(b) === 'premium') || null;
    await sendPremiumSpotlight(to, premium, lang);
  }

  // ── Build the numbered list ─────────────────────────────────
  const headers = {
    ht: '📋 *Rezilta yo:*',
    en: '📋 *Results:*',
    fr: '📋 *Résultats:*',
  };

  const morePrompt = {
    ht: '_Ekri *plis* pou wè plis · *menu* pou retounen_',
    en: '_Type *more* for more results · *menu* to go back_',
    fr: '_Tapez *plus* pour voir plus · *menu* pour revenir_',
  };

  const noMorePrompt = {
    ht: '_Ekri *menu* pou retounen nan meni prensipal_',
    en: '_Type *menu* to go back to main menu_',
    fr: '_Tapez *menu* pour revenir au menu principal_',
  };

  const lines = [headers[lang] || headers.en, ''];

  sorted.forEach((b, i) => {
    const tier     = getTier(b);
    const verified = b.is_verified ? ' ✅' : '';
    const rating   = b.avg_rating > 0 ? ` ⭐${b.avg_rating}` : '';

    if (tier === 'premium') {
      // Premium already shown in spotlight — show compact entry in list
      lines.push(`${i + 1}. 👑 *${b.name}*${verified}${rating} _[Featured]_`);
      if (b.address) lines.push(`   📍 ${b.address}`);
      if (b.phone)   lines.push(`   📞 ${b.phone}`);

    } else if (tier === 'pro') {
      // Pro: full card with description + separator
      lines.push(`${i + 1}. 🔥 *${b.name}*${verified}${rating}`);
      if (b.description) lines.push(`   _${b.description}_`);
      if (b.address) lines.push(`   📍 ${[b.address, b.city].filter(Boolean).join(', ')}`);
      if (b.phone)   lines.push(`   📞 ${b.phone}`);
      if (b.website) lines.push(`   🌐 ${b.website}`);
      const waNum = b.whatsapp?.replace(/\D/g, '');
      if (waNum)     lines.push(`   💬 wa.me/${waNum}`);

    } else if (tier === 'standard') {
      // Standard: name + address + phone + website
      lines.push(`${i + 1}. *${b.name}*${verified}${rating}`);
      if (b.address) lines.push(`   🏠 ${b.address}`);
      if (b.phone)   lines.push(`   📞 ${b.phone}`);

    } else {
      // Free: name + phone only
      lines.push(`${i + 1}. ${b.name}`);
      if (b.phone) lines.push(`   📞 ${b.phone}`);
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
  const hours   = business.meta?.hours || null;

  const lines = [
    `${icon} *${business.name}*`,
    catName ? `_${catName}_` : '',
    '',
    business.description || '',
    '',
    business.address   ? `📍 ${[business.address, business.city].filter(Boolean).join(', ')}` : '',
    business.phone     ? `📞 ${business.phone}`                                                : '',
    business.whatsapp  ? `💬 wa.me/${business.whatsapp.replace(/\D/g, '')}`                   : '',
    business.website   ? `🌐 ${business.website}`                                              : '',
    hours              ? `🕐 ${hours}`                                                          : '',
    business.avg_rating > 0
      ? `⭐ ${business.avg_rating} (${business.review_count} reviews)`
      : '',
    business.is_verified ? '✅ Verified business' : '',
    '',
    lang === 'ht' ? '_Ekri *menu* pou retounen_'
    : lang === 'fr' ? '_Tapez *menu* pour revenir_'
    : '_Type *menu* to go back_',
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
