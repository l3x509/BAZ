// agent/worldcup.js — Baz World Cup handler
// Haiti Group C: Brazil · Morocco · Scotland
// First World Cup in 52 years 🇭🇹⚽

const BAZ_NUMBER = process.env.BAZ_NUMBER || "14155238886";

// ─── SCHEDULE ────────────────────────────────────────────────────────────────

const HAITI_SCHEDULE = [
  {
    match: "🇭🇹 Ayiti vs Ekòs 🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    opponent: "Scotland",
    dateStr: "Samdi 13 Jen 2026",
    dateISO: "2026-06-13",
    time: "9PM ET",
    venue: "Gillette Stadium",
    city: "Foxborough, MA",
    note: "🏠 Lakay nou!",
  },
  {
    match: "🇧🇷 Brezil vs Ayiti 🇭🇹",
    opponent: "Brazil",
    dateStr: "Vandredi 19 Jen 2026",
    dateISO: "2026-06-19",
    time: "9PM ET",
    venue: "Lincoln Financial Field",
    city: "Philadelphia, PA",
    note: "⚡ Gwo match!",
  },
  {
    match: "🇲🇦 Marok vs Ayiti 🇭🇹",
    opponent: "Morocco",
    dateStr: "Mèkredi 24 Jen 2026",
    dateISO: "2026-06-24",
    time: "6PM ET",
    venue: "Mercedes-Benz Stadium",
    city: "Atlanta, GA",
    note: "🎯 Dènyè chans la",
  },
];

// ─── GROUP C STANDINGS ────────────────────────────────────────────────────────
// Update manually after each match — push to GitHub, Railway deploys in 2 min.
// P=Points  W=Win  D=Draw  L=Loss  GF=Goals For  GA=Goals Against

let GROUP_C_STANDINGS = [
  { team: "🇧🇷 Brezil", flag: "🇧🇷", P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
  { team: "🇲🇦 Marok",  flag: "🇲🇦", P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
  { team: "🇭🇹 Ayiti",  flag: "🇭🇹", P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
  { team: "🏴 Ekos",    flag: "🏴", P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 },
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
  const sorted = getSortedStandings();
  const posEmoji = ["1.", "2.", "3.", "4."];
  const rows = sorted.map((t, i) => {
    const gd = t.GF - t.GA;
    const gdStr = gd > 0 ? `+${gd}` : `${gd}`;
    const marker = t.flag === "🇭🇹" ? " ◀" : "";
    return `${posEmoji[i]} ${t.team}  ${t.P}pt  ${t.W}V ${t.D}N ${t.L}D  GD${gdStr}${marker}`;
  });

  return (
    `📊 *Gwoup C — Klasman*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    rows.join("\n") +
    `\n━━━━━━━━━━━━━━━━━━\n` +
    `_2 premye yo avanse — 3yem yo ka avanse tou_`
  );
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function daysFromNow(dateISO) {
  const now = new Date();
  const target = new Date(dateISO + "T00:00:00");
  const diff = target - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return "Fini";
  if (days === 0) return "JODI A!";
  if (days === 1) return "Demen!";
  return `${days} jou anko`;
}

function isMatchDay(dateISO) {
  const now = new Date();
  const t = new Date(dateISO + "T00:00:00");
  return now.getFullYear() === t.getFullYear() &&
         now.getMonth() === t.getMonth() &&
         now.getDate() === t.getDate();
}

function getNextMatch() {
  const now = new Date();
  return HAITI_SCHEDULE.find((g) => new Date(g.dateISO + "T23:59:59") > now) || null;
}

function formatSchedule() {
  return HAITI_SCHEDULE.map((g, i) => {
    const status = daysFromNow(g.dateISO);
    const today = isMatchDay(g.dateISO) ? " JODI A!" : "";
    return (
      `${i + 1}. *${g.match}*${today}\n` +
      `   ${g.dateStr} - ${g.time}\n` +
      `   ${g.venue}, ${g.city}\n` +
      `   ${g.note} - ${status}`
    );
  }).join("\n\n");
}

// ─── SHARE LINE ───────────────────────────────────────────────────────────────
const SHARE_LINE =
  `_Si ou se yon vre Ayisyen, voye sa bay 5 moun ou konnen 🇭🇹_\n` +
  `wa.me/${BAZ_NUMBER}`;

// ─── RESPONSE BUILDERS ───────────────────────────────────────────────────────
// Returns string (single) OR string[] (burst — router sends with 1.5s delay)

function handleAyiti() {
  const next = getNextMatch();
  const urgency = next && isMatchDay(next.dateISO)
    ? `Match la JODI A - ${next.time}!\n${next.venue}, ${next.city}\n\n`
    : next
    ? `Pwochen match: *${next.opponent}* - ${daysFromNow(next.dateISO)}\n\n`
    : `Gwoup stage fini!\n\n`;

  return (
    `🇭🇹 *VIV AYITI!*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Premye fwa depi *52 an!*\n` +
    `Les Grenadiers yo la! 💪\n\n` +
    urgency +
    `Ekri *MATCH* pou we ore match yo\n` +
    `Ekri *GADE* pou jwenn kote suiv match la\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    SHARE_LINE
  );
}

function handleMatch() {
  const next = getNextMatch();
  const banner = next && isMatchDay(next.dateISO)
    ? `MATCH LA JODI A! ${next.time} - ${next.venue}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n`
    : "";

  const msg1 =
    `🇭🇹 *Ore Match Ayiti — World Cup 2026*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    banner +
    `${formatSchedule()}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *GRENADYE ALASO* pou sipote ekip la\n` +
    `Ekri *GADE* pou jwenn kote gade match la\n` +
    `Ekri *SCORE* pou we klasman Gwoup C la`;

  const msg2 = formatStandings();

  return [msg1, msg2];
}

// ─── VIRAL — GRENADYE ALASO ───────────────────────────────────────────────────

function handleGrenadye() {
  const next = getNextMatch();
  const countdownLine = next
    ? isMatchDay(next.dateISO)
      ? `Match la *JODI A* - ${next.time} - ${next.venue}!`
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
    `Gwoup C: Ekos - Brezil - Marok\n\n` +
    `Ekri *MATCH* pou ore yo\n` +
    `Ekri *GADE* pou jwenn kote gade match la\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    SHARE_LINE;

  const msg2 = formatSchedule();

  return [msg1, msg2];
}

// ─── GOAL ─────────────────────────────────────────────────────────────────────

const GOAL_RESPONSES = [
  `🇭🇹🔥 GOOOOOOL AYITI!!!\n\nGRENADYE ALASO!\nNan pye nou, nou pa pran!\n\n${SHARE_LINE}`,
  `🇭🇹 GOAL!!!\n\n52 AN APRE — NOU LA!\nLes Grenadiers yo pa janm mouri!\n\n${SHARE_LINE}`,
  `🎉🇭🇹 AYITI MAKE!\n\nZanse nou yo ap rele nan syel la!\nVIV AYITI — VIV LES GRENADIERS!\n\n${SHARE_LINE}`,
];

let goalIndex = 0;

function handleGoal() {
  const r = GOAL_RESPONSES[goalIndex % GOAL_RESPONSES.length];
  goalIndex++;
  return r;
}

// ─── SCORE ────────────────────────────────────────────────────────────────────

const SCORES = {
  "2026-06-13": null,
  "2026-06-19": null,
  "2026-06-24": null,
};

function handleScore() {
  const lines = [];
  const now = new Date();

  HAITI_SCHEDULE.forEach((g) => {
    const matchDate = new Date(g.dateISO + "T23:59:59");
    const score = SCORES[g.dateISO];
    if (matchDate < now) {
      lines.push(score
        ? `${g.match}\n   ${score}`
        : `${g.match}\n   Rezilta ap vini...`
      );
    } else {
      lines.push(`${g.match} - ${daysFromNow(g.dateISO)}`);
    }
  });

  const msg1 =
    `🇭🇹 *Rezilta — Ayiti World Cup 2026*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    lines.join("\n\n") +
    `\n\n━━━━━━━━━━━━━━━━━━\n` +
    `Ekri *GRENADYE ALASO* pou sipote ekip la`;

  const msg2 = formatStandings();

  return [msg1, msg2];
}

// ─── WATCH PARTY ─────────────────────────────────────────────────────────────

function handleGade() {
  const next = getNextMatch();
  const matchHint = next
    ? `match *${next.match}* — ${next.dateStr} ${next.time}`
    : `pwochen match Ayiti a`;

  return (
    `Kote pou gade ${matchHint}?\n\n` +
    `Ekri yon bagay tankou:\n\n` +
    `"Resto Ayisyen Boston"\n` +
    `"Bar Sports Miami"\n` +
    `"Kote gade match Boston"\n\n` +
    `Baz ap jwenn kote kominote ou a reyini! 🇭🇹`
  );
}

// ─── KEYWORD ROUTER ───────────────────────────────────────────────────────────
// Returns: string | string[] | null

function handleWorldCupKeywords(body) {
  const msg = body.trim().toLowerCase().replace(/[!¡]/g, "");

  if (["ayiti", "viv ayiti", "viva haiti", "viv haiti"].includes(msg))
    return handleAyiti();

  if (["match", "matches", "match ayiti", "ore", "schedule"].includes(msg))
    return handleMatch();

  if (["grenadye alaso", "grenadye", "alaso", "les grenadiers", "grenadiers"].includes(msg))
    return handleGrenadye();

  if (["goal", "gol", "gooool", "goool", "make"].includes(msg))
    return handleGoal();

  if (["score", "rezilta", "ki score", "ki rezilta", "klasman"].includes(msg))
    return handleScore();

  if (["gade", "gade match", "watch", "watch party", "kote gade"].includes(msg))
    return handleGade();

  return null;
}

// ─── UPDATE HELPERS (called from admin endpoint) ──────────────────────────────

function updateScore(dateISO, result) {
  if (Object.prototype.hasOwnProperty.call(SCORES, dateISO)) {
    SCORES[dateISO] = result;
    return true;
  }
  return false;
}

function updateStandings(patch) {
  const entry = GROUP_C_STANDINGS.find(
    (t) => t.team.toLowerCase().includes(patch.team.toLowerCase())
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

module.exports = {
  handleWorldCupKeywords,
  updateScore,
  updateStandings,
  getNextMatch,
  HAITI_SCHEDULE,
};
