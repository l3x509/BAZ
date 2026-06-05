// ─── ROUTER.JS WIRING ────────────────────────────────────────────────────────
// 1. Add at top of router.js:
const { handleWorldCupKeywords } = require('./worldcup');

// 2. Add this helper near your sendWhatsAppMessage function:
async function sendBurst(to, response) {
  if (Array.isArray(response)) {
    // Multi-message burst — send first immediately, rest with 1.5s gap
    await sendWhatsAppMessage(to, response[0]);
    for (let i = 1; i < response.length; i++) {
      await new Promise(r => setTimeout(r, 1500));
      await sendWhatsAppMessage(to, response[i]);
    }
  } else {
    await sendWhatsAppMessage(to, response);
  }
}

// 3. In your main message handler, add as FIRST check (before JOIN, MENU, etc.):
async function routeMessage(from, body) {
  // ── WORLD CUP FAST PATH ─────────────────────────────────────────────────
  const wcResponse = handleWorldCupKeywords(body);
  if (wcResponse !== null) {
    await sendBurst(from, wcResponse);
    return;
  }
  // ── END WORLD CUP ────────────────────────────────────────────────────────

  // ... rest of your existing routing ...
}

// ─── ADMIN ENDPOINT (add to directory.js) ────────────────────────────────────
// Lets you post match results from your phone after each game.
// curl -X POST https://your-railway-url/admin/wc-score \
//   -H "x-admin-secret: YOUR_SECRET" \
//   -H "Content-Type: application/json" \
//   -d '{"date":"2026-06-13","result":"Ayiti 1 — Ekos 0","W":1,"D":0,"L":0,"GF":1,"GA":0}'

const { updateScore, updateStandings } = require('./worldcup');

router.post('/wc-score', adminAuth, (req, res) => {
  const { date, result, ...standingsPatch } = req.body;
  const scoreOk = updateScore(date, result);
  // Update standings for Haiti and the opponent separately if needed
  // e.g. body: { date, result, team:"Ayiti", W:1, D:0, L:0, GF:1, GA:0 }
  const standingsOk = standingsPatch.team ? updateStandings(standingsPatch) : true;
  res.json({ scoreOk, standingsOk });
});

// NOTE: These updates live in memory — they reset on Railway redeploy.
// For persistent scores across deploys, edit the SCORES object in worldcup.js
// directly and push to GitHub. Railway auto-deploys in ~90 seconds.
