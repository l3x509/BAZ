'use strict';

// ============================================================
// VENDOR REGISTER HANDLER
// POST /vendor/register
//
// Flow:
//   1. Validate required fields
//   2. Check for duplicate WhatsApp
//   3. Look up category_id from service_categories or vitrin_categories
//   4. Get or create user (role: vendor)
//   5. Insert business (status: pending)
//   6. WhatsApp confirmation to vendor
//   7. WhatsApp notification to admin
//   8. Return { success: true }
//
// WhatsApp sends are fire-and-forget — a failed send
// never blocks a successful registration.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const db               = require('../db');
const { sendText }     = require('../whatsapp');

// Module-level client — created once, reused across requests
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── COPY ─────────────────────────────────────────────────────

const CONFIRM = {
  ht: name => `✅ Nou resevwa aplikasyon ou a pou *${name}*.\n\nN ap revize l nan 24è epi kontakte w sou WhatsApp.\n\nMèsi pou konfyans ou nan Baz! 🙏`,
  en: name => `✅ We received your application for *${name}*.\n\nWe'll review it within 24 hours and contact you on WhatsApp.\n\nThank you for joining Baz! 🙏`,
  fr: name => `✅ Nous avons reçu votre candidature pour *${name}*.\n\nNous la réviserons dans les 24h et vous contacterons sur WhatsApp.\n\nMerci de rejoindre Baz! 🙏`,
};

const DUPLICATE = {
  ht: `⚠️ Nimewo WhatsApp sa a deja anrejistre sou Baz.\nKontakte nou: hello@bazht.com`,
  en: `⚠️ This WhatsApp number is already registered on Baz.\nContact us: hello@bazht.com`,
  fr: `⚠️ Ce numéro WhatsApp est déjà enregistré sur Baz.\nContactez-nous: hello@bazht.com`,
};

const adminMsg = d =>
  `🔔 *New Vendor Application*\n\n` +
  `*${d.name}*\n` +
  `📂 ${d.category}\n` +
  `📍 ${d.city}, ${d.country}\n` +
  `📱 ${d.whatsapp}\n` +
  `${d.email ? `📧 ${d.email}\n` : ''}` +
  `\nReview in Supabase → businesses table`;

// ── HELPERS ──────────────────────────────────────────────────

// Map form language value → short lang code for CONFIRM copy
function resolveLang(language) {
  if (!language) return 'en';
  if (language.startsWith('ht') && !language.includes('en') && !language.includes('fr')) return 'ht';
  if (language.includes('fr') && !language.includes('en')) return 'fr';
  return 'en';
}

// Map form language → languages array for DB
function resolveLanguages(language) {
  if (!language) return ['ht'];
  const langs = ['ht'];
  if (language.includes('en')) langs.push('en');
  if (language.includes('fr')) langs.push('fr');
  return langs;
}

// Look up category_id — checks service_categories first, then vitrin_categories
async function resolveCategoryId(slug) {
  if (!slug) return null;
  const { data: sc } = await supabase
    .from('service_categories')
    .select('id')
    .eq('slug', slug)
    .single();
  if (sc?.id) return sc.id;

  const { data: vc } = await supabase
    .from('vitrin_categories')
    .select('id')
    .eq('slug', slug)
    .single();
  return vc?.id || null;
}

// ── MAIN HANDLER ─────────────────────────────────────────────

async function handleVendorRegister(req, res) {
  const {
    name, category, description,
    city, country, whatsapp,
    phone, email, website,
    language, referral, source,
  } = req.body || {};

  // ── 1. Validate ──────────────────────────────────────────
  const missing = [];
  if (!name?.trim())        missing.push('name');
  if (!category?.trim())    missing.push('category');
  if (!description?.trim()) missing.push('description');
  if (!city?.trim())        missing.push('city');
  if (!country?.trim())     missing.push('country');
  if (!whatsapp?.trim())    missing.push('whatsapp');

  if (missing.length) {
    return res.status(400).json({
      success: false,
      error:   'Missing required fields',
      fields:  missing,
    });
  }

  // Normalize WhatsApp — strip spaces, ensure + prefix
  const waId = whatsapp.trim().replace(/\s/g, '');
  const lang = resolveLang(language);

  // ── 2. Duplicate check ───────────────────────────────────
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, status')
    .eq('whatsapp', waId)
    .limit(1)
    .single();

  if (existing) {
    sendText(waId, DUPLICATE[lang]).catch(() => {});
    return res.status(409).json({
      success: false,
      error:   'WhatsApp number already registered',
    });
  }

  // ── 3. Category ID ───────────────────────────────────────
  const categoryId = await resolveCategoryId(category.trim());

  // ── 4. User record ───────────────────────────────────────
  let userId = null;
  try {
    const user = await db.getOrCreateUser(waId, name.trim());
    await db.updateUser(user.id, { role: 'vendor' });
    userId = user.id;
  } catch (err) {
    // Non-fatal — business can still be created without a user link
    console.warn('[vendor-register] User upsert failed (non-fatal):', err.message);
  }

  // ── 5. Business insert ───────────────────────────────────
  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .insert({
      owner_id:    userId,
      category_id: categoryId,
      name:        name.trim(),
      description: description.trim(),
      city:        city.trim(),
      country:     country.trim(),
      whatsapp:    waId,
      phone:       phone?.trim()   || null,
      email:       email?.trim()   || null,
      website:     website?.trim() || null,
      status:      'pending',
      languages:   resolveLanguages(language),
      meta: {
        source:     source   || 'bazht.com',
        referral:   referral || null,
        applied_at: new Date().toISOString(),
        form_lang:  language || null,
      },
    })
    .select('id')
    .single();

  if (bizErr) {
    console.error('[vendor-register] Business insert failed:', bizErr.message);
    return res.status(500).json({
      success: false,
      error:   'Registration failed. Please try again.',
    });
  }

  console.log(`[vendor-register] ✓ ${name.trim()} | ${category} | ${city} | ${waId}`);

  // ── 6. WhatsApp confirmation to vendor ───────────────────
  const confirmMsg = CONFIRM[lang]?.(name.trim()) || CONFIRM.en(name.trim());
  sendText(waId, confirmMsg).catch(err =>
    console.error('[vendor-register] Vendor notify failed:', err.message)
  );

  // ── 7. WhatsApp notification to admin ────────────────────
  const adminWa = process.env.ADMIN_WHATSAPP;
  if (adminWa) {
    sendText(adminWa, adminMsg({
      name:     name.trim(),
      category: category.trim(),
      city:     city.trim(),
      country:  country.trim(),
      whatsapp: waId,
      email:    email?.trim() || null,
    })).catch(err =>
      console.error('[vendor-register] Admin notify failed:', err.message)
    );
  }

  return res.status(200).json({ success: true, id: business.id });
}

module.exports = { handleVendorRegister };
