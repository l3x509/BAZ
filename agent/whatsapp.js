'use strict';

const axios = require('axios');

// ============================================================
// TWILIO WHATSAPP SENDER
// ============================================================

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_WHATSAPP_NUMBER?.startsWith('whatsapp:')
  ? process.env.TWILIO_WHATSAPP_NUMBER
  : `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
const API_URL      = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

async function sendText(to, body) {
  if (!body || !body.trim()) return; // never send empty messages
  try {
    await axios.post(
      API_URL,
      new URLSearchParams({
        From: FROM_NUMBER,
        To:   `whatsapp:${to}`,
        Body: body.trim(),
      }),
      {
        auth:    { username: ACCOUNT_SID, password: AUTH_TOKEN },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[whatsapp] sendText error:', JSON.stringify(detail));
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

// ── TIER HELPER ───────────────────────────────────────────────
function getTier(b) {
  return (b && b.listing_tier) ? b.listing_tier : 'free';
}

// ── PREMIUM SPOTLIGHT ─────────────────────────────────────────
// Sent as a separate bubble before results.
// ALWAYS wrapped in try/catch — a spotlight failure must NEVER
// crash the search results. It's a display enhancement only.
// business = null → show placeholder to drive upgrades.
async function sendPremiumSpotlight(to, business, lang) {
  try {
    const divider = '──────────────────────';

    if (business) {
      // Safe field extraction — every field guarded against null
      const name    = business.name        || 'Business';
      const city    = business.city        || '';
      const address = business.address     || '';
      const phone   = business.phone       || null;
      const website = business.website     || null;
      const desc    = business.description || null;
      const hours   = (business.meta && business.meta.hours) ? business.meta.hours : null;
      const waRaw   = business.whatsapp    || null;
      const waNum   = waRaw ? waRaw.replace(/[^0-9]/g, '') : null;
      const cityLine = [address, city].filter(Boolean).join(', ');

      const lines = [
        `💎 *${name}*`,
        cityLine ? `✅ Verifye · 📍 ${cityLine}` : '✅ Verifye',
        phone   ? `📞 ${phone}`          : null,
        website ? `🌐 ${website}`        : null,
        waNum   ? `💬 wa.me/${waNum}`    : null,
        hours   ? `🕐 ${hours}`          : null,
        divider,
        desc    ? `_${desc}_`            : null,
      ].filter(Boolean).join('\n');

      return await sendText(to, lines);
    }

    // Placeholder — no premium business in this category/area
    const placeholder = {
      ht: `💎 *[Biznis Paw La]*\n✅ Verifye · 📍 Vil Ou, MA\n📞 (XXX) XXX-XXXX\n🌐 yourwebsite.com\n🕐 Lendi–Samdi 9AM–9PM\n${divider}\n_Ou Vle plas sa a? Ekri *JOIN*_`,
      en: `💎 *[Your Business Here]*\n✅ Verified · 📍 Your City, MA\n📞 (XXX) XXX-XXXX\n🌐 yourwebsite.com\n🕐 Mon–Sat 9AM–9PM\n${divider}\n_Want this spot? Type *JOIN*_`,
      fr: `💎 *[Votre Entreprise Ici]*\n✅ Vérifié · 📍 Votre Ville, MA\n📞 (XXX) XXX-XXXX\n🌐 votresite.com\n🕐 Lun–Sam 9AM–9PM\n${divider}\n_Vous voulez cette place? Tapez *JOIN*_`,
    };

    return await sendText(to, placeholder[lang] || placeholder.en);

  } catch (err) {
    // Spotlight failure is non-fatal — log and continue
    console.warn('[whatsapp] sendPremiumSpotlight failed (non-fatal):', err.message);
  }
}

// ── BUSINESS RESULTS ─────────────────────────────────────────
async function sendBusinessResults(to, businesses, lang, hasMore = false, showSpotlight = true) {
  if (!businesses?.length) return null;

  // Sort by tier: premium → pro → standard → free, then rating
  const tierOrder = { premium: 0, pro: 1, standard: 2, free: 3 };
  const sorted = [...businesses].sort((a, b) => {
    const tDiff = (tierOrder[getTier(a)] ?? 3) - (tierOrder[getTier(b)] ?? 3);
    if (tDiff !== 0) return tDiff;
    return (b.avg_rating || 0) - (a.avg_rating || 0);
  });

  // Send premium spotlight (page 1 only) — non-fatal if it fails
  if (showSpotlight) {
    const premium = sorted.find(b => getTier(b) === 'premium') || null;
    await sendPremiumSpotlight(to, premium, lang);
  }

  // Build results list — this ALWAYS sends regardless of spotlight
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
      // Free — name + phone only
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
  if (!business) return;

  const cat     = business.service_categories;
  const icon    = cat?.icon    || '🏢';
  const catName = lang === 'ht' ? cat?.name_ht
                : lang === 'fr' ? cat?.name_fr
                : cat?.name_en;
  const hours   = (business.meta && business.meta.hours) ? business.meta.hours : null;
  const waNum   = business.whatsapp?.replace(/[^0-9]/g, '');
  const cityLine = [business.address, business.city].filter(Boolean).join(', ');

  const lines = [
    `${icon} *${business.name}*`,
    catName    ? `_${catName}_`                          : null,
    '',
    business.description || null,
    '',
    cityLine   ? `📍 ${cityLine}`                        : null,
    business.phone   ? `📞 ${business.phone}`            : null,
    waNum            ? `💬 wa.me/${waNum}`               : null,
    business.website ? `🌐 ${business.website}`          : null,
    hours            ? `🕐 ${hours}`                     : null,
    business.avg_rating > 0
      ? `⭐ ${business.avg_rating} (${business.review_count} reviews)` : null,
    business.is_verified ? '✅ Verified business'         : null,
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
