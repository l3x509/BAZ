// agent/worldcup.js — Baz World Cup handler
// Haiti Group C: Brazil · Morocco · Scotland — First WC in 52 years 🇭🇹⚽

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

const BAZ_NUMBER = process.env.BAZ_NUMBER || '14155238886';

// ─── SCHEDULE ────────────────────────────────────────────────────────────────

const HAITI_SCHEDULE = [
  {
    match:     '🇭🇹 Ayiti vs Ekòs 🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    opponent:  'Scotland',
    aliases:   ['eks', 'ekos', 'ekòs', 'scotland', 'skotland', 'ekoss'],
    shortName: 'Ekòs',
    dateStr:   'Sam 13 Jen 2026',
    dateISO:   '2026-06-13',
    time:      '9PM ET',
    venue:     'Gillette Stadium',
    city:      'Foxborough, MA',
    note:      '🏠 Lakay nou!',
  },
  {
    match:     '🇧🇷 Brezil vs Ayiti 🇭🇹',
    opponent:  'Brazil',
    aliases:   ['brezil', 'brazil', 'bresil', 'br', 'brezl'],
    shortName: 'Brezil',
    dateStr:   'Van 19 Jen 2026',
    dateISO:   '2026-06-19',
    time:      '9PM ET',
    venue:     'Lincoln Financial Field',
    city:      'Philadelphia, PA',
    note:      '⚡ Gwo match!',
  },
  {
    match:     '🇲🇦 Marok vs Ayiti 🇭🇹',
    opponent:  'Morocco',
    aliases:   ['marok', 'maroc', 'morocco', 'maro'],
    shortName: 'Marok',
    dateStr:   'Mèk 24 Jen 2026',
    dateISO:   '2026-06-24',
    time:      '6PM ET',
    venue:     'Mercedes-Benz Stadium',
    city:      'Atlanta, GA',
    note:      '🎯 Dènyè chans la',
  },
];

// ─── GROUP C STANDINGS ────────────────────────────────────────────────────────
// Update manually after each match — push to GitHub, Railway redeploys ~90s

let GROUP_C_STANDINGS = [
  { team: '🇧🇷 Brezil', flag: '🇧🇷', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
  { team: '🇲🇦 Marok',  flag: '🇲🇦', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
  { team: '🇭🇹 Ayiti',  flag: '🇭🇹', P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
  { team: '🏴 Ekos',    flag: '🏴',  P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
];

function getSortedStandings() {
  return [...GROUP_C_STANDINGS].sort((a, b) => {
    if (b.P !== a.P) return b.P - a.P;
    const gdA = a.GF - a.GA, gdB = b.GF - b.GA;
    if (gdB !== gdA) return gdB - gdA;
    return b.GF - a.GF;
  });
}

function formatStandings() {
  const sorted   = getSortedStandings();
  const pos      = ['1.', '2.', '3.', '4.'];
  const rows     = sorted.map((t, i) => {
    const gd    = t.GF - t.GA;
    const gdStr = gd > 0 ? `+${gd}` : `${gd}`;
    const mark  = t.flag === '🇭🇹' ? ' ◀' : '';
    return `${pos[i]} ${t.team}  ${t.P}pt  ${t.W}V ${t.D}N ${t.L}D  GD${gdStr}${mark}`;
  });
  return (
    `📊 *Gwoup C — Klasman*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    rows.join('\n') +
    `\n━━━━━━━━━━━━━━━━━━\n` +
    `_2 premye yo avanse — 3yem yo ka avanse tou_`
  );
}

// ─── MATCH SCORES ─────────────────────────────────────────────────────────────

const SCORES = {
  '2026-06-13': null,  // { ayiti: 1, opponent: 0, label: 'Ayiti 1 — Ekos 0 🎉' }
  '2026-06-19': null,
  '2026-06-24': null,
};

// ─── UTILS ───────────────────────────────────────────────────────────────────

function daysFromNow(dateISO) {
  const days = Math.ceil((new Date(dateISO + 'T00:00:00') - new Date()) / 86400000);
  if (days < 0) return 'Fini';
  if (days === 0) return 'JODI A!';
  if (days === 1) return 'Demen!';
  return `${days} jou anko`;
}

function isMatchDay(dateISO) {
  const now = new Date(), t = new Date(dateISO + 'T00:00:00');
  return now.getFullYear() === t.getFullYear() &&
         now.getMonth()    === t.getMonth()    &&
         now.getDate()     === t.getDate();
}

function isMatchLocked(dateISO) {
  const kickoffs = {
    '2026-06-13': new Date('2026-06-13T21:00:00-04:00'),
    '2026-06-19': new Date('2026-06-19T21:00:00-04:00'),
    '2026-06-24': new Date('2026-06-24T18:00:00-04:00'),
  };
  return kickoffs[dateISO] ? new Date() >= kickoffs[dateISO] : true;
}

function isMatchPast(dateISO) {
  return new Date(dateISO + 'T23:59:59') < new Date();
}

function getNextMatch() {
  return HAITI_SCHEDULE.find(g => !isMatchPast(g.dateISO)) || null;
}

// No 📅 emoji — WhatsApp renders it as today's date on Android regardless of context
function formatSchedule() {
  return HAITI_SCHEDULE.map((g, i) => {
    const status  = daysFromNow(g.dateISO);
    const today   = isMatchDay(g.dateISO) ? ' 🔥 *JODI A!*' : '';
    const locked  = isMatchLocked(g.dateISO) && !isMatchPast(g.dateISO) ? ' 🔴' : '';
    const past    = isMatchPast(g.dateISO);
    const score   = SCORES[g.dateISO];
    const result  = past && score ? `\n   ⚽ ${score.label}` : '';
    return (
      `${i + 1}. *${g.match}*${today}${locked}\n` +
      `   ${g.dateStr} · ${g.time}\n` +
      `   ${g.venue}, ${g.city}\n` +
      `   ${g.note} · ${status}${result}`
    );
  }).join('\n\n');
}

const SHARE_LINE =
  `_Si ou se yon vre Ayisyen, voye sa bay 5 moun ou konnen 🇭🇹_\n` +
  `wa.me/${BAZ_NUMBER}`;

// ─── ENGAGEMENT TRACKING ──────────────────────────────────────────────────────

function trackEngagement(waId) {
  if (!waId) return;
  getSupabase().rpc('upsert_wc_engaged', { p_wa_id: waId }).catch(() => {});
}

// ─── RESPONSE BUILDERS ───────────────────────────────────────────────────────

function handleAyiti(waId) {
  trackEngagement(waId);
  const next    = getNextMatch();
  const urgency = next && isMatchDay(next.dateISO)
    ? `Match la JODI A — ${next.time}!\n${next.venue}, ${next.city}\n\n`
    : next ? `Pwochen match: *${next.opponent}* — ${daysFromNow(next.dateISO)}\n\n`
    : `Gwoup stage fini!\n\n`;
  return (
    `🇭🇹 *VIV AYITI!*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Premye fwa depi *52 an!*\n` +
    `Les Grenadiers yo la! 💪\n\n` +
    urgency +
    `Ekri *MATCH* — orè match yo\n` +
    `Ekri *WATCH PARTY* — kote gade match la\n` +
    `Ekri *TRANSPÒ* — transpò pou ale nan match\n` +
    `Ekri *PREDIKSYON* — fè pwediksyon pou tout 3 match\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    SHARE_LINE
  );
}

function handleMatch(waId) {
  trackEngagement(waId);
  const next   = getNextMatch();
  const banner = next && isMatchDay(next.dateISO)
    ? `🔥 *MATCH LA JODI A! ${next.time} — ${next.venue}*\n━━━━━━━━━━━━━━━━━━\n\n`
    : '';
  const msg1 =
    `🇭🇹⚽ *Ore Match Ayiti — World Cup 2026*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    banner + formatSchedule() + `\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *GRENADYE ALASO* pou sipote ekip la\n` +
    `Ekri *WATCH PARTY* pou jwenn kote gade match la\n` +
    `Ekri *PREDIKSYON* pou fè pwediksyon ou pou tout match yo\n` +
    `Ekri *SCORE* pou wè klasman an`;
  return [msg1, formatStandings()];
}

function handleGrenadye(waId) {
  trackEngagement(waId);
  const next = getNextMatch();
  const countdownLine = next
    ? isMatchDay(next.dateISO)
      ? `Match la *JODI A* — ${next.time} — ${next.venue}!`
      : `${daysFromNow(next.dateISO)} pou match *${next.opponent}* la!`
    : `Les Grenadiers yo kontinye goumen!`;
  const msg1 =
    `🇭🇹🔥 *GRENADYE ALASO!*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `Nan 1803, zanse nou yo te kraze chen lan.\n` +
    `Nan 2026, Les Grenadiers ap pote drapo a.\n\n` +
    `${countdownLine}\n\n` +
    `Ayiti. Premye repiblik nwa lib nan istwa.\n` +
    `Premye fwa nan World Cup depi *52 an.*\n` +
    `*Sa pa chans — sa destin.*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *PREDIKSYON* pou fè pwediksyon pou tout match yo\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    SHARE_LINE;
  return [msg1, formatSchedule()];
}

function handleWatchParty(waId) {
  trackEngagement(waId);
  const next      = getNextMatch();
  const matchLine = next
    ? `match *${next.match}* — ${next.dateStr} ${next.time}`
    : `pwochen match Ayiti a`;
  return (
    `📺 *Watch Party — ${matchLine}*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `Chèche kote gade match la:\n\n` +
    `👉 Ekri *"Resto Ayisyen Boston"*\n` +
    `👉 Ekri *"Bar Sports Miami"*\n` +
    `👉 Ekri *"Resto Philadelphia"* — match Brezil\n` +
    `👉 Ekri *"Resto Atlanta"* — match Marok\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🏪 *Ou gen yon restoran oswa bar?*\n` +
    `Anrejistre Watch Party ou: bazht.com\n\n` +
    `_Baz ap konekte kominote a 🇭🇹_`
  );
}

function handleTransport(waId) {
  trackEngagement(waId);
  const next       = getNextMatch();
  const isGillette = next && next.dateISO === '2026-06-13';
  const venueLine  = isGillette
    ? `🏟️ *Gillette Stadium — Foxborough, MA*\nMatch lakay nou! Boston Ayisyen yo ap anpil!\n\n`
    : next ? `🏟️ *${next.venue}, ${next.city}*\n\n` : '';
  return (
    `🚗 *Transpò pou Match Ayiti*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    venueLine +
    `Chèche chofè Ayisyen:\n\n` +
    `👉 Ekri *"Chofè Boston"*\n` +
    `👉 Ekri *"Transpò Foxborough"*\n` +
    `👉 Ekri *"Driver Miami"*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🚗 *Ou se chofè?* Anrejistre sou Baz: bazht.com\n\n` +
    `_Baz — Ayiti pa lwen 🇭🇹_`
  );
}

function handleGillette(waId) {
  trackEngagement(waId);
  return (
    `🏟️ *GILLETTE STADIUM — 13 JEN 2026*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `🇭🇹 Ayiti vs Ekòs 🏴󠁧󠁢󠁳󠁣󠁴󠁿\n` +
    `Sam 13 Jen 2026 · 9PM ET\n` +
    `Foxborough, MA — *Lakay nou!*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📍 *Plan jou match la:*\n\n` +
    `🍲 *"Manje Boston"* — manje anvan match\n` +
    `🚗 *"Chofè Boston"* — transpò Foxborough\n` +
    `📺 *"Resto Boston"* — gade si ou pa gen tikè\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *PREDIKSYON EKS 2-1* pou bay pwediksyon ou!\n\n` +
    SHARE_LINE
  );
}

const GOAL_RESPONSES = [
  `🇭🇹🔥 GOOOOOOL AYITI!!!\n\nGRENADYE ALASO!\nNan pye nou, nou pa pran!\n\n${SHARE_LINE}`,
  `🇭🇹 GOAL!!!\n\n52 AN APRE — NOU LA!\nLes Grenadiers yo pa janm mouri!\n\n${SHARE_LINE}`,
  `🎉🇭🇹 AYITI MAKE!\n\nZanse nou yo ap rele nan syel la!\nVIV AYITI — VIV LES GRENADIERS!\n\n${SHARE_LINE}`,
];
let goalIndex = 0;
function handleGoal(waId) {
  trackEngagement(waId);
  return GOAL_RESPONSES[(goalIndex++) % GOAL_RESPONSES.length];
}

function handleScore(waId) {
  trackEngagement(waId);
  const lines = HAITI_SCHEDULE.map(g => {
    const past  = isMatchPast(g.dateISO);
    const score = SCORES[g.dateISO];
    if (past) return score
      ? `✅ ${g.match}\n   ${score.label}`
      : `⏳ ${g.match}\n   Rezilta ap vini...`;
    return `${g.match} — ${daysFromNow(g.dateISO)}`;
  });
  const msg1 =
    `🇭🇹⚽ *Rezilta — Ayiti World Cup 2026*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    lines.join('\n\n') +
    `\n\n━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *PREDIKSYON* pou wè oswa chanje pwediksyon ou yo 🎯`;
  return [msg1, formatStandings()];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREDIKSYON SYSTEM
// Keyword: PREDIKSYON (was PARI)
// "PREDIKSYON"              → dashboard — all 3 matches + current predictions
// "PREDIKSYON EKS 2-1"      → Scotland prediction
// "PREDIKSYON BREZIL 1-0"   → Brazil prediction
// "PREDIKSYON MAROK 0-1"    → Morocco prediction
// "PREDIKSYON 2-1"          → next upcoming match (fallback)
// "PREDIKSYON MWE"          → show all predictions with results
// ═══════════════════════════════════════════════════════════════════════════════

function identifyMatchFromMessage(msg) {
  for (const game of HAITI_SCHEDULE) {
    if (game.aliases.some(a => msg.includes(a))) return game;
  }
  return null;
}

function parseScore(msg) {
  const nums = msg.match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  const a = parseInt(nums[0], 10);
  const o = parseInt(nums[1], 10);
  if (a > 20 || o > 20) return null;
  return { ayiti: a, opponent: o };
}

async function loadUserPredictions(waId) {
  const { data, error } = await getSupabase()
    .from('wc_predictions')
    .select('match_date, opponent, ayiti_score, opponent_score, result')
    .eq('whatsapp_id', waId)
    .order('match_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function savePrediction(waId, game, score) {
  const { error } = await getSupabase()
    .from('wc_predictions')
    .upsert({
      whatsapp_id:    waId,
      match_date:     game.dateISO,
      opponent:       game.opponent,
      ayiti_score:    score.ayiti,
      opponent_score: score.opponent,
    }, { onConflict: 'whatsapp_id,match_date' });
  if (error) throw error;
}

// ── Dashboard — all 3 matches + current predictions ───────────────────────────

async function handlePrediksyonDashboard(waId) {
  trackEngagement(waId);

  let predictions = [];
  try { predictions = await loadUserPredictions(waId); } catch {}

  const predMap = {};
  predictions.forEach(p => { predMap[p.match_date] = p; });

  const lines = HAITI_SCHEDULE.map((g, i) => {
    const pred   = predMap[g.dateISO];
    const past   = isMatchPast(g.dateISO);
    const locked = isMatchLocked(g.dateISO);
    const score  = SCORES[g.dateISO];

    let statusLine = '';
    let predLine   = '';

    if (past && score) {
      statusLine = `✅ ${score.label}`;
      if (pred) {
        const exact     = pred.ayiti_score === score.ayiti && pred.opponent_score === score.opponent;
        const rightSide = (pred.ayiti_score > pred.opponent_score) === (score.ayiti > score.opponent) &&
                          (pred.ayiti_score === pred.opponent_score) === (score.ayiti === score.opponent);
        predLine = exact      ? `   🎯 Pwediksyon: ${pred.ayiti_score}-${pred.opponent_score} — *EGZAK!* 🏆`
                 : rightSide  ? `   ✅ Pwediksyon: ${pred.ayiti_score}-${pred.opponent_score} — Bon bò!`
                              : `   ❌ Pwediksyon: ${pred.ayiti_score}-${pred.opponent_score}`;
      } else {
        predLine = `   ⚠️ Ou pa t fè pwediksyon pou match sa`;
      }
    } else if (locked) {
      statusLine = `🔴 Match kòmanse — pwediksyon fèmen`;
      predLine   = pred
        ? `   Pwediksyon: *Ayiti ${pred.ayiti_score} — ${pred.opponent_score} ${g.shortName}*`
        : `   Pa fè pwediksyon ⏳`;
    } else {
      statusLine = `${g.dateStr} · ${g.time} · ${daysFromNow(g.dateISO)}`;
      predLine   = pred
        ? `   Pwediksyon: *Ayiti ${pred.ayiti_score} — ${pred.opponent_score} ${g.shortName}* ✏️`
        : `   Pa fè — *Ekri PREDIKSYON ${g.shortName.toUpperCase()} 2-1*`;
    }

    return `${i + 1}. *${g.match}*\n   ${statusLine}\n${predLine}`;
  });

  const openCount = HAITI_SCHEDULE.filter(g => !isMatchLocked(g.dateISO)).length;
  const footer    = openCount > 0
    ? `━━━━━━━━━━━━━━━━━━\n` +
      `Fè oswa chanje pwediksyon:\n` +
      `⚽ *PREDIKSYON EKS 2-1*\n` +
      `⚽ *PREDIKSYON BREZIL 1-0*\n` +
      `⚽ *PREDIKSYON MAROK 0-1*\n\n` +
      `_Score Ayiti toujou an premye_\n` +
      `_Pwediksyon fèmen lè match kòmanse_`
    : `━━━━━━━━━━━━━━━━━━\n` +
      `_Tout pwediksyon fèmen. Mèsi pou sipò ou! 🇭🇹_`;

  return (
    `⚽ *Pwediksyon Ou — World Cup 2026 🇭🇹*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    lines.join('\n\n') +
    `\n\n` + footer
  );
}

// ── Set prediction for a specific match ───────────────────────────────────────

async function handlePrediksyonSet(game, score, waId) {
  if (isMatchLocked(game.dateISO)) {
    return (
      `🔒 *Pwediksyon pou ${game.opponent} fèmen!*\n\n` +
      `Match la deja kòmanse.\n` +
      (getNextMatch() ? `Ekri *PREDIKSYON* pou wè pwochen match la.` : ``)
    );
  }

  try {
    await savePrediction(waId, game, score);
  } catch (err) {
    console.error('[worldcup] prediksyon save error:', err.message);
    return `😔 Pwoblèm teknik. Eseye ankò.`;
  }

  const vibe = score.ayiti > score.opponent && score.ayiti >= 3 ? `💪 Ou gen konfyans!`
             : score.ayiti > score.opponent                      ? `👍 Bon pwediksyon!`
             : score.ayiti === score.opponent                    ? `🤝 Ou panse match egal?`
             : score.opponent >= 3                               ? `😅 Ou twò pessimis...`
                                                                 : `😬 Se posib...`;

  let betCount = 0;
  try { betCount = (await loadUserPredictions(waId)).length; } catch {}
  const remaining = 3 - betCount;
  const nudge     = remaining > 0
    ? `\n_${remaining} match rete — ekri *PREDIKSYON* pou wè tout_`
    : `\n_✅ Ou fè pwediksyon pou tout 3 match!_`;

  return (
    `✅ *Pwediksyon anrejistre — ${game.opponent}!*\n\n` +
    `🇭🇹 Ayiti *${score.ayiti}* — *${score.opponent}* ${game.shortName}\n` +
    `${vibe}\n\n` +
    `${game.dateStr} · ${game.time}\n` +
    `${game.venue}, ${game.city}\n` +
    nudge
  );
}

// ── Main PREDIKSYON dispatcher ────────────────────────────────────────────────

async function handlePrediksyon(message, waId) {
  trackEngagement(waId);

  const msg   = message.trim().toLowerCase().replace(/[!¡]/g, '');
  const game  = identifyMatchFromMessage(msg);
  const score = parseScore(msg);

  // "PREDIKSYON" alone or "PREDIKSYON MWE" → dashboard
  if (!score) return handlePrediksyonDashboard(waId);

  // "PREDIKSYON BREZIL" with no score → show current bet + instructions
  if (game && !score) {
    let existing = null;
    try {
      const preds = await loadUserPredictions(waId);
      existing    = preds.find(p => p.match_date === game.dateISO) || null;
    } catch {}

    if (isMatchPast(game.dateISO)) {
      const result = SCORES[game.dateISO];
      return (
        `📊 *Match ${game.opponent} — Rezilta*\n\n` +
        (result ? `⚽ ${result.label}\n\n` : `Rezilta ap vini...\n\n`) +
        (existing ? `Pwediksyon ou: Ayiti ${existing.ayiti_score} — ${existing.opponent_score}` : `Ou pa t fè pwediksyon pou match sa.`)
      );
    }

    if (isMatchLocked(game.dateISO)) {
      return (
        `🔒 *Pwediksyon ${game.opponent} fèmen — match kòmanse!*\n\n` +
        (existing ? `Pwediksyon ou: Ayiti *${existing.ayiti_score} — ${existing.opponent_score}* ${game.shortName}` : `Ou pa t fè pwediksyon.`)
      );
    }

    return (
      `⚽ *Pwediksyon pou match ${game.opponent}*\n\n` +
      (existing
        ? `Pwediksyon aktyèl: *Ayiti ${existing.ayiti_score} — ${existing.opponent_score} ${game.shortName}*\n\nPou chanje li:\n`
        : `Ou pa fè pwediksyon ankò pou match sa.\n\n`) +
      `Ekri: *PREDIKSYON ${game.shortName.toUpperCase()} [score]-[score]*\n\n` +
      `Egzanp:\n` +
      `👉 *PREDIKSYON ${game.shortName.toUpperCase()} 2-1* — Ayiti genyen 2-1\n` +
      `👉 *PREDIKSYON ${game.shortName.toUpperCase()} 1-1* — Match egal\n\n` +
      `_Score Ayiti toujou an premye_`
    );
  }

  // "PREDIKSYON 2-1" with no opponent → next upcoming match
  if (!game && score) {
    const next = getNextMatch();
    if (!next) return `⚽ Tout match fini. Pwediksyon fèmen. Mèsi! 🇭🇹`;
    return handlePrediksyonSet(next, score, waId);
  }

  // "PREDIKSYON BREZIL 1-0" — full prediction
  return handlePrediksyonSet(game, score, waId);
}

// ─── KEYWORD ROUTER ───────────────────────────────────────────────────────────
// Returns: string | string[] | Promise<string> | null

function handleWorldCupKeywords(message, waId) {
  const msg = message.trim().toLowerCase().replace(/[!¡]/g, '');

  if (['ayiti', 'viv ayiti', 'viva haiti', 'viv haiti'].includes(msg))
    return handleAyiti(waId);

  if (['match', 'matches', 'match ayiti', 'ore', 'schedule'].includes(msg))
    return handleMatch(waId);

  if (['grenadye alaso', 'grenadye', 'alaso', 'les grenadiers', 'grenadiers'].includes(msg))
    return handleGrenadye(waId);

  if (['goal', 'gol', 'gooool', 'goool', 'make'].includes(msg))
    return handleGoal(waId);

  if (['score', 'rezilta', 'ki score', 'ki rezilta', 'klasman'].includes(msg))
    return handleScore(waId);

  if (['watch party', 'watch', 'party', 'fet match', 'kote gade', 'gade match', 'gade'].includes(msg))
    return handleWatchParty(waId);

  if (['transpò', 'transpo', 'transport', 'chofè', 'chofe', 'ride'].includes(msg))
    return handleTransport(waId);

  if (['gillette', 'gillette stadium', 'foxborough'].includes(msg))
    return handleGillette(waId);

  // PREDIKSYON — catches all variants
  if (msg === 'prediksyon' || msg === 'prediksyon mwe' || msg === 'prediksyon mwen' ||
      msg === 'prediction' || msg === 'my prediction' || msg.startsWith('prediksyon '))
    return handlePrediksyon(message, waId); // Promise

  return null;
}

// ─── UPDATE HELPERS ───────────────────────────────────────────────────────────

function updateScore(dateISO, ayiti, opponent, label) {
  if (!Object.prototype.hasOwnProperty.call(SCORES, dateISO)) return false;
  SCORES[dateISO] = { ayiti, opponent, label };
  return true;
}

function updateStandings(patch) {
  const entry = GROUP_C_STANDINGS.find(
    t => t.team.toLowerCase().includes(patch.team.toLowerCase())
  );
  if (!entry) return false;
  entry.W  += patch.W  || 0;
  entry.D  += patch.D  || 0;
  entry.L  += patch.L  || 0;
  entry.GF += patch.GF || 0;
  entry.GA += patch.GA || 0;
  entry.P   = entry.W * 3 + entry.D;
  return true;
}

async function getPredictorsForMatch(matchDate) {
  const { data, error } = await getSupabase()
    .from('wc_predictions')
    .select('whatsapp_id, ayiti_score, opponent_score')
    .eq('match_date', matchDate);
  if (error) throw error;
  return data || [];
}

async function getAllEngagedUsers() {
  const { data, error } = await getSupabase()
    .from('wc_engaged_users')
    .select('whatsapp_id')
    .order('last_seen', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => r.whatsapp_id);
}

async function markPredictionResult(waId, matchDate, result) {
  await getSupabase()
    .from('wc_predictions')
    .update({ result })
    .eq('whatsapp_id', waId)
    .eq('match_date', matchDate);
}

module.exports = {
  handleWorldCupKeywords,
  updateScore,
  updateStandings,
  getNextMatch,
  formatStandings,
  HAITI_SCHEDULE,
  SCORES,
  getPredictorsForMatch,
  getAllEngagedUsers,
  markPredictionResult,
};
