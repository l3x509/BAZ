#!/usr/bin/env node
// agent/scripts/wc-broadcast.js
// Run manually after each Haiti match to send personalized results to all WC users.
//
// Usage:
//   node scripts/wc-broadcast.js <match_date> <ayiti_score> <opponent_score>
//
// Examples:
//   node scripts/wc-broadcast.js 2026-06-13 2 1   (Haiti beat Scotland 2-1)
//   node scripts/wc-broadcast.js 2026-06-19 1 1   (Drew with Brazil)
//   node scripts/wc-broadcast.js 2026-06-24 0 2   (Lost to Morocco)

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const twilio    = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const {
  getPredictorsForMatch,
  getAllEngagedUsers,
  markPredictionResult,
  HAITI_SCHEDULE,
  formatStandings,
} = require('../worldcup');

const client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FROM_NUMBER = `whatsapp:+${process.env.BAZ_NUMBER || '14155238886'}`;
const DELAY_MS    = 1200; // stay well under Twilio rate limits

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
  console.error('Valid dates: 2026-06-13, 2026-06-19, 2026-06-24');
  process.exit(1);
}

// ─── MESSAGE BUILDERS ─────────────────────────────────────────────────────────

function buildResultHeader() {
  const won  = ayitiScore > opponentScore;
  const drew = ayitiScore === opponentScore;

  if (won) {
    return (
      `🇭🇹🔥 *AYITI GENYEN!!!*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `*${matchInfo.match}*\n` +
      `⚽ *${ayitiScore} — ${opponentScore}*\n\n` +
      `Les Grenadiers yo fè nou fyè!\n` +
      `GRENADYE ALASO 💪\n`
    );
  }
  if (drew) {
    return (
      `🇭🇹 *Match Egal — Men Nou La!*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `*${matchInfo.match}*\n` +
      `⚽ *${ayitiScore} — ${opponentScore}*\n\n` +
      `Yon pwen enpòtan! Nou kontinye goumen! 💪\n`
    );
  }
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
  const exactMatch  = pa === ayitiScore && po === opponentScore;
  const resultMatch = (pa > po) === (ayitiScore > opponentScore) &&
                      (pa === po) === (ayitiScore === opponentScore);
  const closeCall   = Math.abs(pa - ayitiScore) <= 1 && Math.abs(po - opponentScore) <= 1;

  let result = 'wrong';
  let msg    = '';

  if (exactMatch) {
    result = 'correct';
    msg    = `🎯 *EGZAK! Ou te gen rezon!*\n` +
             `Ou te di ${pa}-${po} — epi se sa ki pase! Chapeau! 🎩`;
  } else if (resultMatch) {
    result = 'correct';
    msg    = `✅ *Bon rezulta!*\n` +
             `Ou te di ${pa}-${po}. Rezilta a pa egzak men ou te konn ki bò ki t ap genyen! 👍`;
  } else if (closeCall) {
    result = 'close';
    msg    = `🎯 *Prèske!*\n` +
             `Ou te di ${pa}-${po}. Ou te pwòch anpil! 😄`;
  } else {
    msg    = `😅 *Ou pa t gen rezon fwa sa...*\n` +
             `Ou te di ${pa}-${po}. Pa abandone — gen 2 match ankò!`;
  }

  return { msg, result };
}

function buildNextMatchLine() {
  const next = HAITI_SCHEDULE.find(
    g => g.dateISO > matchDate && !g.dateISO.startsWith(matchDate)
  );
  if (!next) return `\n🏆 *Gwoup stage Ayiti a fini! Swiv pwogrè ekip la!*`;
  return (
    `\n📅 *Pwochen match:*\n` +
    `${next.match}\n` +
    `${next.dateStr} · ${next.time}\n` +
    `${next.venue}, ${next.city}\n\n` +
    `Ekri *PARI 2-1* pou fè pwediksyon ou!`
  );
}

// ─── SEND HELPER ─────────────────────────────────────────────────────────────

async function send(waId, body) {
  try {
    await client.messages.create({
      from: FROM_NUMBER,
      to:   `whatsapp:+${waId.replace(/^\+/, '')}`,
      body,
    });
    return true;
  } catch (err) {
    console.error(`  ✗ Failed ${waId}: ${err.message}`);
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
  const predictors = await getPredictorsForMatch(matchDate);
  console.log(`  Found ${predictors.length} predictors\n`);

  let correctCount = 0;
  const predictorSet = new Set();

  for (const p of predictors) {
    predictorSet.add(p.whatsapp_id);
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

    // Send standings as second message
    await send(p.whatsapp_id, standingsMsg);
    await sleep(DELAY_MS);
  }

  console.log(`\n  Predictors reached: ${predictors.length}`);
  console.log(`  Correct predictions: ${correctCount}\n`);

  // ── PHASE 2: General broadcast to all engaged users ───────────────────────
  console.log('Phase 2: General broadcast to all WC-engaged users...');
  const allUsers = await getAllEngagedUsers();
  const generalUsers = allUsers.filter(id => !predictorSet.has(id));
  console.log(`  ${allUsers.length} total engaged | ${predictors.length} already messaged | ${generalUsers.length} remaining\n`);

  const generalBody =
    resultHeader +
    nextMatchLine + '\n\n' +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *SCORE* pou wè klasman an\n` +
    `Ekri *PARI 2-1* pou pwochen match la\n` +
    `_Si ou se yon vre Ayisyen, voye sa bay 5 moun 🇭🇹_\n` +
    `wa.me/${process.env.BAZ_NUMBER || '14155238886'}`;

  let generalSent = 0;
  for (const waId of generalUsers) {
    process.stdout.write(`  Sending to ${waId}... `);
    const ok = await send(waId, generalBody);
    if (ok) { console.log('✓'); generalSent++; }
    await sleep(DELAY_MS);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
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
