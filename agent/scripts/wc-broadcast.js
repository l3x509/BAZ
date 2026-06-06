#!/usr/bin/env node
// agent/scripts/wc-broadcast.js
// Post-match broadcast via Meta Cloud API.
// Run manually after each Haiti match.
//
// Usage:
//   node scripts/wc-broadcast.js <match_date> <ayiti_score> <opponent_score>
//
// Examples:
//   node scripts/wc-broadcast.js 2026-06-13 2 1
//   node scripts/wc-broadcast.js 2026-06-19 1 1
//   node scripts/wc-broadcast.js 2026-06-24 0 2

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');
const {
  getPredictorsForMatch,
  getAllEngagedUsers,
  markPredictionResult,
  HAITI_SCHEDULE,
  formatStandings,
} = require('../worldcup');

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN           = process.env.WHATSAPP_TOKEN;
const API_URL         = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
const DELAY_MS        = 1200; // stay well under Meta rate limits

// ─── CLI ARGS ────────────────────────────────────────────────────────────────

const [,, matchDate, ayitiArg, opponentArg] = process.argv;

if (!matchDate || !ayitiArg || !opponentArg) {
  console.error('Usage: node scripts/wc-broadcast.js <match_date> <ayiti_score> <opponent_score>');
  console.error('Example: node scripts/wc-broadcast.js 2026-06-13 2 1');
  process.exit(1);
}

const ayitiScore    = parseInt(ayitiArg, 10);
const opponentScore = parseInt(opponentArg, 10);
const matchInfo     = HAITI_SCHEDULE.find(g => g.dateISO === matchDate);

if (!matchInfo) {
  console.error(`Unknown match date: ${matchDate}`);
  console.error('Valid: 2026-06-13 | 2026-06-19 | 2026-06-24');
  process.exit(1);
}

// ─── META SEND HELPER ────────────────────────────────────────────────────────

async function send(waId, body) {
  try {
    await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        to:                waId.replace(/[^0-9]/g, ''),
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
    return true;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error(`  ✗ Failed ${waId}: ${detail}`);
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── MESSAGE BUILDERS ─────────────────────────────────────────────────────────

function buildResultHeader() {
  const won  = ayitiScore > opponentScore;
  const drew = ayitiScore === opponentScore;

  if (won) return (
    `🇭🇹🔥 *AYITI GENYEN!!!*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `*${matchInfo.match}*\n` +
    `⚽ *${ayitiScore} — ${opponentScore}*\n\n` +
    `Les Grenadiers yo fè nou fyè!\n` +
    `GRENADYE ALASO 💪\n`
  );

  if (drew) return (
    `🇭🇹 *Match Egal — Men Nou La!*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `*${matchInfo.match}*\n` +
    `⚽ *${ayitiScore} — ${opponentScore}*\n\n` +
    `Yon pwen enpòtan! Nou kontinye goumen! 💪\n`
  );

  return (
    `🇭🇹 *Ayiti — Nou Pa Kase!*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `*${matchInfo.match}*\n` +
    `⚽ *${ayitiScore} — ${opponentScore}*\n\n` +
    `Nou pa bay lage. Pwochen match la ap la! 💙\n`
  );
}

function buildPredictionResult(predictor) {
  const { ayiti_score: pa, opponent_score: po } = predictor;
  const exact      = pa === ayitiScore && po === opponentScore;
  const rightSide  = (pa > po) === (ayitiScore > opponentScore) &&
                     (pa === po) === (ayitiScore === opponentScore);
  const close      = Math.abs(pa - ayitiScore) <= 1 && Math.abs(po - opponentScore) <= 1;

  if (exact)     return { result: 'correct', msg: `🎯 *EGZAK! Ou te gen rezon!*\nOu te di ${pa}-${po} — se sa ki pase! Chapeau! 🎩` };
  if (rightSide) return { result: 'correct', msg: `✅ *Bon rezilta!*\nOu te di ${pa}-${po}. Ou te konn ki bò ki t ap genyen! 👍` };
  if (close)     return { result: 'close',   msg: `🎯 *Prèske!*\nOu te di ${pa}-${po}. Ou te pwòch anpil! 😄` };
  return           { result: 'wrong',   msg: `😅 *Ou pa t gen rezon fwa sa...*\nOu te di ${pa}-${po}. Gen 2 match ankò — pa abandone!` };
}

function buildNextMatchLine() {
  const next = HAITI_SCHEDULE.find(g => g.dateISO > matchDate);
  if (!next) return `\n🏆 *Gwoup stage Ayiti a fini! Swiv pwogrè ekip la!*`;
  return (
    `\n📅 *Pwochen match:*\n` +
    `${next.match}\n` +
    `${next.dateStr} · ${next.time}\n` +
    `${next.venue}, ${next.city}\n\n` +
    `Ekri *PARI* pou fè pwediksyon ou!`
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🇭🇹 Post-match broadcast — ${matchDate}`);
  console.log(`   Result: Ayiti ${ayitiScore} — ${opponentScore} ${matchInfo.opponent}`);
  console.log(`   Won: ${ayitiScore > opponentScore} | Drew: ${ayitiScore === opponentScore}\n`);

  const resultHeader  = buildResultHeader();
  const nextMatchLine = buildNextMatchLine();
  const standingsMsg  = formatStandings();

  // ── PHASE 1: Personalized messages to predictors ─────────────────────────
  console.log('Phase 1: Personalized predictor messages...');
  const predictors   = await getPredictorsForMatch(matchDate);
  const predictorSet = new Set(predictors.map(p => p.whatsapp_id));
  console.log(`  Found ${predictors.length} predictors\n`);

  let correctCount = 0;

  for (const p of predictors) {
    const { msg, result } = buildPredictionResult(p);
    const body =
      resultHeader +
      `━━━━━━━━━━━━━━━━━━\n` +
      `⚽ *Pari ou te fè:* Ayiti ${p.ayiti_score} — ${p.opponent_score}\n` +
      `${msg}\n` +
      nextMatchLine;

    process.stdout.write(`  Sending to ${p.whatsapp_id}... `);
    const ok = await send(p.whatsapp_id, body);
    if (ok) {
      console.log('✓');
      await markPredictionResult(p.whatsapp_id, matchDate, result);
      if (result === 'correct') correctCount++;
    }
    await sleep(DELAY_MS);

    // Second message: standings
    await send(p.whatsapp_id, standingsMsg);
    await sleep(DELAY_MS);
  }

  console.log(`\n  Predictors reached: ${predictors.length}`);
  console.log(`  Correct predictions: ${correctCount}\n`);

  // ── PHASE 2: General broadcast to all engaged users ───────────────────────
  console.log('Phase 2: General broadcast to all WC-engaged users...');
  const allUsers     = await getAllEngagedUsers();
  const generalUsers = allUsers.filter(id => !predictorSet.has(id));
  console.log(`  ${allUsers.length} total engaged | ${predictors.length} already messaged | ${generalUsers.length} remaining\n`);

  const generalBody =
    resultHeader +
    nextMatchLine + '\n\n' +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *SCORE* pou wè klasman an\n` +
    `Ekri *PARI* pou pwochen match la\n` +
    `_Si ou se yon vre Ayisyen, voye sa bay 5 moun 🇭🇹_\n` +
    `wa.me/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;

  let generalSent = 0;
  for (const waId of generalUsers) {
    process.stdout.write(`  Sending to ${waId}... `);
    const ok = await send(waId, generalBody);
    if (ok) { console.log('✓'); generalSent++; }
    await sleep(DELAY_MS);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Broadcast complete`);
  console.log(`   Predictors messaged:  ${predictors.length}`);
  console.log(`   Correct predictions:  ${correctCount}`);
  console.log(`   General broadcast:    ${generalSent}`);
  console.log(`   Total reached:        ${predictors.length + generalSent}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(err => {
  console.error('Broadcast failed:', err);
  process.exit(1);
});
