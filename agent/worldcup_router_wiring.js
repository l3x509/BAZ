// ─── ROUTER.JS WIRING ─────────────────────────────────────────────────────────
// 1. Add at top of router.js:
const { handleWorldCupKeywords } = require('./worldcup');

// 2. In route(), replace the WC fast path block with this:
//    (waId added, Promise handled — required for PARI async handlers)

    // ── WORLD CUP FAST PATH ──────────────────────────────────────────────
    const wcRaw      = handleWorldCupKeywords(message, user.whatsapp_id);
    const wcResponse = (wcRaw instanceof Promise) ? await wcRaw : wcRaw;
    if (wcResponse !== null) {
      if (Array.isArray(wcResponse)) {
        await sendText(user.whatsapp_id, wcResponse[0]);
        for (let i = 1; i < wcResponse.length; i++) {
          await new Promise(r => setTimeout(r, 1500));
          await sendText(user.whatsapp_id, wcResponse[i]);
        }
      } else {
        await sendText(user.whatsapp_id, wcResponse);
      }
      return;
    }
    // ── END WORLD CUP ────────────────────────────────────────────────────


// ─── ADMIN ENDPOINT — add to directory.js ─────────────────────────────────────
// Post match result after each game. Updates in-memory SCORES + standings.
// For persistence across redeploys, also edit SCORES in worldcup.js and push.
//
// Usage after Haiti wins 2-1 vs Scotland:
//
// curl -X POST https://your-railway-url/admin/wc-score \
//   -H "x-admin-secret: YOUR_SECRET" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "date":     "2026-06-13",
//     "ayiti":    2,
//     "opponent": 1,
//     "label":    "Ayiti 2 — Ekos 1 🎉",
//     "team":     "Ayiti",
//     "W": 1, "D": 0, "L": 0, "GF": 2, "GA": 1
//   }'
//
// Run for BOTH teams to keep standings accurate:
//
// curl ... -d '{"date":"2026-06-13","team":"Ekos","W":0,"D":0,"L":1,"GF":1,"GA":2}'

const { updateScore, updateStandings } = require('./worldcup');

router.post('/wc-score', adminAuth, (req, res) => {
  const { date, ayiti, opponent, label, team, W, D, L, GF, GA } = req.body;

  const scoreOk     = updateScore(date, ayiti, opponent, label);
  const standingsOk = team ? updateStandings({ team, W, D, L, GF, GA }) : true;

  res.json({ scoreOk, standingsOk });
});

// After updating via the endpoint, run the broadcast script:
// node scripts/wc-broadcast.js 2026-06-13 2 1
