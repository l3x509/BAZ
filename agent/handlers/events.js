'use strict';

const { supabase } = require('../db');
const wa           = require('../whatsapp');

// ============================================================
// EVENTS HANDLER
// Shows upcoming paid event listings by city.
// Events are manually managed by Baz admin — organizers pay
// a fee to be listed. Featured events appear first with ⭐.
// ============================================================

const PAGE_SIZE = 5;

async function handle({ user, message, lang, city }) {
  const searchCity = city || user.location_city || null;
  const today      = new Date().toISOString().slice(0, 10);
  const in30days   = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  try {
    let query = supabase
      .from('events')
      .select('*')
      .eq('status', 'active')
      .gte('event_date', today)
      .lte('event_date', in30days)
      .order('is_featured', { ascending: false })
      .order('event_date',  { ascending: true })
      .limit(PAGE_SIZE);

    // Filter by city if known
    if (searchCity) {
      const normalized = searchCity.toLowerCase();
      query = query.eq('city_slug', normalized);
    }

    const { data: events, error } = await query;

    if (error) throw error;

    if (!events?.length) {
      return sendNoEvents({ user, lang, city: searchCity });
    }

    // Save for "plis" pagination
    try {
      await supabase
        .from('users')
        .update({
          session_state: {
            ...(user.session_state || {}),
            last_events_search: {
              city:     searchCity,
              offset:   0,
              expires:  Date.now() + 5 * 60 * 1000,
            },
          },
        })
        .eq('id', user.id);
    } catch {}

    return sendEvents(user.whatsapp_id, events, lang, false, searchCity);

  } catch (err) {
    console.error('[events] handle error:', err.message);
    const errMsg = {
      ht: `Mwen pa ka jwenn evènman kounye a. Eseye ankò.`,
      en: `Could not load events right now. Please try again.`,
      fr: `Impossible de charger les événements. Réessayez.`,
    };
    return wa.sendText(user.whatsapp_id, errMsg[lang] || errMsg.en);
  }
}

// ── FORMAT AND SEND EVENTS ────────────────────────────────────
function sendEvents(to, events, lang, hasMore, city) {
  const header = {
    ht: city ? `📅 *Evènman k ap vini nan ${titleCase(city)}:*` : `📅 *Evènman k ap vini:*`,
    en: city ? `📅 *Upcoming events in ${titleCase(city)}:*`    : `📅 *Upcoming events:*`,
    fr: city ? `📅 *Événements à venir à ${titleCase(city)}:*`  : `📅 *Événements à venir:*`,
  };

  const lines = [header[lang] || header.en, ''];

  events.forEach(ev => {
    const featured = ev.is_featured ? '⭐ ' : '🎉 ';
    const dateStr  = formatDate(ev.event_date, lang);
    const timeStr  = ev.event_time ? ` · ${ev.event_time}` : '';
    const priceStr = ev.price ? ` · ${ev.price}` : '';

    lines.push(`${featured}*${ev.title}*`);
    if (ev.venue) lines.push(`📍 ${ev.venue}`);
    lines.push(`📆 ${dateStr}${timeStr}${priceStr}`);
    if (ev.contact) lines.push(`📞 ${ev.contact}`);
    lines.push('');
  });

  const footer = hasMore
    ? { ht: `_Ekri *plis* pou wè plis · *menu* pou retounen_`,     en: `_Type *more* for more · *menu* to go back_`,     fr: `_Tapez *plus* pour voir plus · *menu* pour revenir_`     }
    : { ht: `_Ekri *menu* pou retounen nan meni prensipal_`,        en: `_Type *menu* to go back to main menu_`,           fr: `_Tapez *menu* pour revenir au menu principal_`           };

  lines.push(footer[lang] || footer.en);

  // Upsell hint — subtle, not pushy
  const upsell = {
    ht: `\n_Ou vle ajoute yon evènman? → sakpase@bazht.com_`,
    en: `\n_Want to list your event? → sakpase@bazht.com_`,
    fr: `\n_Vous voulez lister votre événement? → sakpase@bazht.com_`,
  };
  lines.push(upsell[lang] || upsell.en);

  return wa.sendText(to, lines.join('\n'));
}

// ── NO EVENTS ─────────────────────────────────────────────────
function sendNoEvents({ user, lang, city }) {
  const loc = city ? { ht: ` nan ${titleCase(city)}`, en: ` in ${titleCase(city)}`, fr: ` à ${titleCase(city)}` }
                   : { ht: '', en: '', fr: '' };

  const msg = {
    ht: `😔 Pa gen evènman k ap vini${loc.ht} kounye a.\n\n_Ou gen yon evènman ayisyen? Kontakte nou:_\n📧 sakpase@bazht.com`,
    en: `😔 No upcoming events${loc.en} right now.\n\n_Have a Haitian event to promote? Contact us:_\n📧 sakpase@bazht.com`,
    fr: `😔 Aucun événement à venir${loc.fr}.\n\n_Vous avez un événement haïtien à promouvoir? Contactez-nous:_\n📧 sakpase@bazht.com`,
  };
  return wa.sendText(user.whatsapp_id, msg[lang] || msg.en);
}

// ── MORE EVENTS (pagination) ──────────────────────────────────
async function handleMore({ user, lang }) {
  const state = user.session_state?.last_events_search;
  if (!state || Date.now() > state.expires) return null; // let router handle as "more results"

  const today    = new Date().toISOString().slice(0, 10);
  const in30days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const newOffset = (state.offset || 0) + PAGE_SIZE;

  let query = supabase
    .from('events')
    .select('*')
    .eq('status', 'active')
    .gte('event_date', today)
    .lte('event_date', in30days)
    .order('is_featured', { ascending: false })
    .order('event_date',  { ascending: true })
    .range(newOffset, newOffset + PAGE_SIZE - 1);

  if (state.city) query = query.eq('city_slug', state.city.toLowerCase());

  const { data: events } = await query;

  if (!events?.length) {
    const noMore = {
      ht: `📋 Pa gen plis evènman.\n\n_Ekri *menu* pou retounen_`,
      en: `📋 No more events.\n\n_Type *menu* to go back_`,
      fr: `📋 Plus d'événements.\n\n_Tapez *menu* pour revenir_`,
    };
    return wa.sendText(user.whatsapp_id, noMore[lang] || noMore.en);
  }

  // Update offset
  try {
    await supabase.from('users').update({
      session_state: { ...(user.session_state || {}), last_events_search: { ...state, offset: newOffset } },
    }).eq('id', user.id);
  } catch {}

  return sendEvents(user.whatsapp_id, events, lang, events.length === PAGE_SIZE, state.city);
}

// ── HELPERS ───────────────────────────────────────────────────
function titleCase(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

const MONTHS = {
  en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  ht: ['Jan','Fev','Mas','Avr','Me','Jen','Jiy','Out','Sep','Okt','Nov','Des'],
  fr: ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'],
};
const DAYS = {
  en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  ht: ['Dim','Lun','Mar','Mèk','Jed','Ven','Sam'],
  fr: ['dim','lun','mar','mer','jeu','ven','sam'],
};

function formatDate(dateStr, lang) {
  const d   = new Date(dateStr + 'T12:00:00'); // noon to avoid timezone issues
  const l   = DAYS[lang]   || DAYS.en;
  const m   = MONTHS[lang] || MONTHS.en;
  return `${l[d.getDay()]} ${d.getDate()} ${m[d.getMonth()]}`;
}


// ── SUBMIT EVENT (from BazEventFlow.jsx) ─────────────────────
// Called by POST /events/submit from the React intake component.
// Saves as status:'pending' — Dulex approves in Supabase to go live.
async function handleSubmit(req, res) {
  const {
    title, date, time, venue, city, city_slug,
    price, contact, organizer, tier,
  } = req.body || {};

  if (!title || !city || !date) {
    return res.status(400).json({ error: 'Missing required fields: title, city, date' });
  }

  // Normalise city_slug — lowercase, no spaces
  const slug = city_slug
    || city.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const isFeatured = tier === 'featured' || tier === 'premium';

  const { data, error } = await supabase
    .from('events')
    .insert({
      title:        title.trim(),
      description:  null,
      city:         city.trim(),
      city_slug:    slug,
      venue:        venue        || null,
      event_date:   date,
      event_time:   time         || null,
      price:        price        || null,
      contact:      contact      || null,
      organizer:    organizer    || null,
      listing_tier: tier         || 'basic',
      is_featured:  isFeatured,
      status:       'pending',   // Dulex flips to 'active' in Supabase to publish
    })
    .select('id, title, city, status')
    .single();

  if (error) {
    console.error('[events/submit]', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[events/submit] New pending event: "${data.title}" in ${data.city} (${data.id})`);

  // ── Notify Dulex via WhatsApp ─────────────────────────────
  // Admin replies YES/NO to approve or reject
  const adminNumber = process.env.ADMIN_WHATSAPP;
  if (adminNumber) {
    const tierLabel = { basic:'Basic $25', featured:'Featured $50', extended:'Extended $40', premium:'Premium $75' };
    const notify = [
      `📬 *New event submitted:*`,
      ``,
      `🎉 *${data.title}*`,
      data.venue   ? `📍 ${data.venue}` : null,
      data.event_date ? `📆 ${data.event_date}${data.event_time ? ' · ' + data.event_time : ''}` : null,
      data.price   ? `🎟 ${data.price}` : null,
      data.organizer ? `👤 ${data.organizer}` : null,
      data.contact ? `📞 ${data.contact}` : null,
      `🏷 ${tierLabel[data.listing_tier] || data.listing_tier}`,
      ``,
      `Reply *YES* to publish · *NO* to reject`,
      `_ID: ${data.id}_`,
    ].filter(l => l !== null).join('\n');

    wa.sendText(adminNumber, notify).catch(err =>
      console.warn('[events/submit] Admin notify failed:', err.message)
    );
  }

  return res.json({ success: true, id: data.id, status: data.status });
}


// ── EXTRACT EVENT FROM FLYER (Claude Vision proxy) ───────────
// Called by events.html on bazht.com.
// Keeps ANTHROPIC_API_KEY server-side — never exposed to browser.
async function handleExtract(req, res) {
  const { image, mediaType } = req.body || {};
  if (!image || !mediaType) {
    return res.status(400).json({ error: 'Missing image or mediaType' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text',  text: 'Extract event details from this flyer. Return ONLY valid JSON, no markdown, no extra text:\n{"title":"","date":"","time":"","venue":"","city":"","price":"","contact":"","organizer":""}' },
          ]
        }]
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const raw       = data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
    const extracted = JSON.parse(raw);
    console.log(`[events/extract] Extracted: "${extracted.title}" in ${extracted.city}`);
    return res.json(extracted);
  } catch (err) {
    console.error('[events/extract]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { handle, handleMore, handleSubmit, handleExtract };
