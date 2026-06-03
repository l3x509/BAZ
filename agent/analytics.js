/**
 * Analytics Dashboard
 * ───────────────────
 * Place at: agent/routes/analytics.js
 * Mount in agent/server.js: app.use('/admin', require('./routes/analytics'))
 * Access at: https://baz-production.up.railway.app/admin/analytics?secret=YOUR_SECRET
 *
 * Required env vars — add in Railway dashboard:
 *   SUPABASE_URL          (already set)
 *   SUPABASE_SERVICE_KEY  (already set)
 *   ADMIN_SECRET          (add this — set any strong password)
 */

const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

function guard(req, res, next) {
  if (!ADMIN_SECRET) return next();
  const tok = req.query.secret || req.headers['x-admin-secret'];
  if (tok !== ADMIN_SECRET) return res.status(401).send('Unauthorized');
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATA ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics/data', guard, async (req, res) => {
  const now    = Date.now();
  const d1ago  = new Date(now - 1  * 86400000).toISOString();
  const d7ago  = new Date(now - 7  * 86400000).toISOString();
  const d30ago = new Date(now - 30 * 86400000).toISOString();
  const d90ago = new Date(now - 90 * 86400000).toISOString();

  try {
    // Run all queries in parallel
    const [
      allUsers,
      allMessages,
      allConversations,
      recentUsers,
    ] = await Promise.all([
      getSupabase().from('users').select('id, created_at, language, last_seen_at'),
      getSupabase().from('messages').select('id, created_at, direction, conversation_id, content').gte('created_at', d90ago),
      getSupabase().from('conversations').select('id, created_at, user_id').gte('created_at', d90ago),
      getSupabase().from('users').select('name, whatsapp_id, last_seen_at, language').order('last_seen_at', { ascending: false }).limit(12),
    ]);

    const users   = allUsers.data        || [];
    const msgs    = allMessages.data     || [];
    const convos  = allConversations.data|| [];

    // ── Total counts ──────────────────────────────────────────────────────────
    const totalUsers    = users.length;
    const totalMessages = msgs.length;
    const totalConvos   = convos.length;

    // ── Retention buckets ─────────────────────────────────────────────────────
    const active7d  = users.filter(u => u.last_seen_at && u.last_seen_at > d7ago).length;
    const active30d = users.filter(u => u.last_seen_at && u.last_seen_at > d30ago).length;
    const newToday  = users.filter(u => u.created_at   && u.created_at   > d1ago).length;
    const new7d     = users.filter(u => u.created_at   && u.created_at   > d7ago).length;

    // ── User growth — daily new signups, last 30 days ─────────────────────────
    const userGrowthMap = {};
    users.forEach(u => {
      const day = (u.created_at || '').slice(0, 10);
      if (day >= d30ago.slice(0, 10)) userGrowthMap[day] = (userGrowthMap[day] || 0) + 1;
    });
    const userGrowth = Array.from({ length: 30 }, (_, i) => {
      const d   = new Date(now - (29 - i) * 86400000);
      const key = d.toISOString().slice(0, 10);
      return { day: key, count: userGrowthMap[key] || 0 };
    });

    // Cumulative user count per day
    let running = users.filter(u => u.created_at < userGrowth[0].day).length;
    const userCumulative = userGrowth.map(r => {
      running += r.count;
      return { day: r.day, total: running };
    });

    // ── Messages per day — last 30 days ───────────────────────────────────────
    const msgDayMap = {};
    msgs.forEach(m => {
      const day = (m.created_at || '').slice(0, 10);
      if (day >= d30ago.slice(0, 10)) msgDayMap[day] = (msgDayMap[day] || 0) + 1;
    });
    const messagesPerDay = Array.from({ length: 30 }, (_, i) => {
      const d   = new Date(now - (29 - i) * 86400000);
      const key = d.toISOString().slice(0, 10);
      return { day: key, count: msgDayMap[key] || 0 };
    });

    // ── Msgs today / yesterday ────────────────────────────────────────────────
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    const msgsToday     = msgDayMap[today]     || 0;
    const msgsYesterday = msgDayMap[yesterday] || 0;

    // ── Avg messages per conversation ─────────────────────────────────────────
    const convoMsgCount = {};
    msgs.forEach(m => {
      if (m.conversation_id) convoMsgCount[m.conversation_id] = (convoMsgCount[m.conversation_id] || 0) + 1;
    });
    const counts     = Object.values(convoMsgCount);
    const avgMsgsPerConvo = counts.length
      ? (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)
      : 0;

    // ── Inbound vs outbound ratio ─────────────────────────────────────────────
    let inbound = 0, outbound = 0;
    msgs.forEach(m => { m.direction === 'inbound' ? inbound++ : outbound++; });

    // ── Top inbound messages ──────────────────────────────────────────────────
    // Filter out navigation/system words — they're not real searches
    const NAV_WORDS = new Set([
      '0', 'menu', 'tout', 'all', 'back', 'retounen', 'retour',
      'plis', 'more', 'next', 'plus', 'options', 'categories',
      'tout kategori', 'all categories', 'tout bagay',
      'lang_ht', 'lang_en', 'lang_fr', 'sèvis', 'services',
    ]);
    const contentMap = {};
    msgs.filter(m => m.direction === 'inbound').forEach(m => {
      const key = (m.content || '').trim().toLowerCase().slice(0, 80);
      if (key.length > 1 && !NAV_WORDS.has(key)) contentMap[key] = (contentMap[key] || 0) + 1;
    });
    const topSearches = Object.entries(contentMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([text, count]) => ({ text, count }));

    // ── Entry messages (first message per conversation) ───────────────────────
    // Group msgs by convo, take earliest per convo
    const convoFirstMsg = {};
    msgs.filter(m => m.direction === 'inbound' && m.conversation_id).forEach(m => {
      const c = m.conversation_id;
      if (!convoFirstMsg[c] || m.created_at < convoFirstMsg[c].created_at) {
        convoFirstMsg[c] = m;
      }
    });
    const entryMap = {};
    Object.values(convoFirstMsg).forEach(m => {
      const key = (m.content || '').trim().toLowerCase().slice(0, 80);
      if (key.length > 1) entryMap[key] = (entryMap[key] || 0) + 1;
    });
    const topEntries = Object.entries(entryMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([text, count]) => ({ text, count }));

    // ── Language breakdown ────────────────────────────────────────────────────
    const langMap = {};
    users.forEach(u => {
      const l = u.language || 'unknown';
      langMap[l] = (langMap[l] || 0) + 1;
    });
    const languages = Object.entries(langMap)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => ({ lang, count }));

    // ── Hourly heatmap (0-23, last 30 days) ───────────────────────────────────
    const hourCounts = Array(24).fill(0);
    msgs.forEach(m => {
      const h = new Date(m.created_at).getHours();
      hourCounts[h]++;
    });

    // ── Day-of-week activity ──────────────────────────────────────────────────
    const dowCounts = Array(7).fill(0); // 0=Sun
    msgs.forEach(m => { dowCounts[new Date(m.created_at).getDay()]++; });

    // ── Repeat vs one-time users ──────────────────────────────────────────────
    // Users with >1 conversation are repeats
    const userConvoCount = {};
    convos.forEach(c => { userConvoCount[c.user_id] = (userConvoCount[c.user_id] || 0) + 1; });
    const repeatUsers  = Object.values(userConvoCount).filter(n => n > 1).length;
    const oneTimeUsers = Object.values(userConvoCount).filter(n => n === 1).length;

    res.json({
      // Counts
      totalUsers, totalMessages, totalConvos, msgsToday, msgsYesterday,
      newToday, new7d, active7d, active30d, avgMsgsPerConvo,
      inbound, outbound, repeatUsers, oneTimeUsers,
      // Series
      userGrowth, userCumulative, messagesPerDay,
      topSearches, topEntries, languages,
      hourCounts, dowCounts,
      recentUsers: recentUsers.data || [],
    });
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  HTML DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics', guard, (req, res) => {
  const sp = ADMIN_SECRET ? `?secret=${req.query.secret || ''}` : '';
  res.send(html(sp));
});

function html(sp) { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baz Analytics</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --bg:      #06070a;
  --s1:      #0d0e12;
  --s2:      #12141a;
  --border:  #1e2028;
  --border2: #2a2d38;
  --text:    #c8ccd8;
  --dim:     #4a4f62;
  --hi:      #7ee8a2;   /* green accent */
  --hi2:     #5b9cf6;   /* blue accent  */
  --hi3:     #f5a623;   /* orange accent */
  --danger:  #f06060;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'DM Mono',monospace;font-size:13px;min-height:100vh;overflow-x:hidden}

/* ── noise overlay ── */
body::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");opacity:.4;pointer-events:none;z-index:0}

/* ── header ── */
header{position:sticky;top:0;z-index:10;background:rgba(6,7,10,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;padding:0 28px;height:52px}
.logo{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;letter-spacing:.06em;color:#fff}
.logo span{color:var(--hi)}
.clock{font-size:11px;color:var(--dim);margin-left:auto}
#ts{color:var(--text)}
.refresh{background:none;border:1px solid var(--border2);color:var(--dim);font-family:'DM Mono',monospace;font-size:11px;padding:5px 12px;cursor:pointer;transition:all .15s}
.refresh:hover{border-color:var(--hi);color:var(--hi)}

/* ── layout ── */
main{position:relative;z-index:1;padding:24px 28px;max-width:1440px;display:flex;flex-direction:column;gap:20px}

/* ── section labels ── */
.section-label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--dim);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.section-label::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── KPI grid ── */
.kpi-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}
.kpi{background:var(--s1);border:1px solid var(--border);padding:18px 16px 14px;position:relative;overflow:hidden;cursor:default;transition:border-color .2s}
.kpi:hover{border-color:var(--border2)}
.kpi-accent{position:absolute;bottom:0;left:0;right:0;height:2px}
.kpi-label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.kpi-val{font-family:'Syne',sans-serif;font-weight:700;font-size:28px;line-height:1;color:#fff}
.kpi-sub{font-size:10px;color:var(--dim);margin-top:6px}
.up{color:var(--hi)} .dn{color:var(--danger)} .nu{color:var(--dim)}

/* ── card ── */
.card{background:var(--s1);border:1px solid var(--border);padding:20px 20px 16px}
.card-title{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:16px}

/* ── grid layouts ── */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.g13{display:grid;grid-template-columns:1fr 3fr;gap:12px}
.g31{display:grid;grid-template-columns:3fr 1fr;gap:12px}

/* ── chart wrapper ── */
.cw{position:relative}
.cw-200{height:200px}
.cw-160{height:160px}
.cw-240{height:240px}

/* ── retention bar ── */
.ret-bars{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.ret-row{display:flex;align-items:center;gap:10px}
.ret-label{font-size:10px;color:var(--dim);width:72px;flex-shrink:0}
.ret-track{flex:1;height:18px;background:var(--s2);position:relative;overflow:hidden}
.ret-fill{position:absolute;top:0;left:0;bottom:0;transition:width .7s cubic-bezier(.22,1,.36,1)}
.ret-n{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;color:#fff}
.ret-pct{font-size:10px;color:var(--dim);width:36px;text-align:right;flex-shrink:0}

/* ── search bars ── */
.sb-list{display:flex;flex-direction:column;gap:5px}
.sb-row{display:flex;align-items:center;gap:8px}
.sb-rank{font-size:10px;color:var(--dim);width:16px;text-align:right;flex-shrink:0}
.sb-track{flex:1;height:22px;background:var(--s2);position:relative;overflow:hidden}
.sb-fill{position:absolute;top:0;left:0;bottom:0}
.sb-text{position:absolute;top:50%;left:8px;transform:translateY(-50%);font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 16px)}
.sb-count{font-size:11px;color:var(--hi);width:28px;text-align:right;flex-shrink:0}

/* ── heatmap ── */
.hm{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-top:4px}
.hm-col{display:flex;flex-direction:column;align-items:center;gap:3px}
.hm-cell{width:100%;aspect-ratio:1;border-radius:1px}
.hm-lbl{font-size:8px;color:var(--dim)}

/* ── dow ── */
.dow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.dow-col{display:flex;flex-direction:column;align-items:center;gap:4px}
.dow-bar{width:100%;border-radius:2px 2px 0 0;transition:height .5s}
.dow-lbl{font-size:9px;color:var(--dim)}

/* ── users table ── */
table{width:100%;border-collapse:collapse}
th{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);text-align:left;padding:0 0 10px;border-bottom:1px solid var(--border)}
td{padding:9px 0;border-bottom:1px solid var(--border);font-size:12px;vertical-align:middle}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;background:rgba(91,156,246,.1);border:1px solid rgba(91,156,246,.25);color:var(--hi2);font-size:9px;padding:2px 6px;letter-spacing:.06em}
.mono{font-family:'DM Mono',monospace;color:var(--dim);font-size:11px}

/* ── ratio ring ── */
.ratio-wrap{display:flex;align-items:center;gap:20px;padding:8px 0}
.ratio-labels{display:flex;flex-direction:column;gap:8px}
.ratio-item{display:flex;align-items:center;gap:8px;font-size:11px}
.ratio-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}

/* ── loading pulse ── */
.pulse{display:flex;align-items:center;justify-content:center;height:140px;gap:6px}
.p{width:6px;height:6px;border-radius:50%;background:var(--dim);animation:p 1.2s ease-in-out infinite}
.p:nth-child(2){animation-delay:.15s}.p:nth-child(3){animation-delay:.3s}
@keyframes p{0%,80%,100%{transform:scale(.6);opacity:.3}40%{transform:scale(1);opacity:1}}

/* ── fade in ── */
.fade{opacity:0;transform:translateY(8px);transition:opacity .4s,transform .4s}
.fade.in{opacity:1;transform:none}

@media(max-width:1100px){.kpi-grid{grid-template-columns:repeat(4,1fr)}}
@media(max-width:800px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.g2,.g3,.g13,.g31{grid-template-columns:1fr}main{padding:16px}}
</style>
</head>
<body>
<header>
  <div class="logo">B<span>az</span></div>
  <div class="clock">last updated <span id="ts">—</span></div>
  <button class="refresh" id="rbtn" onclick="load()">↻ refresh</button>
</header>

<main id="main">
  <div class="pulse"><div class="p"></div><div class="p"></div><div class="p"></div></div>
</main>

<script>
Chart.defaults.color = '#4a4f62';
Chart.defaults.font  = { family: "'DM Mono', monospace", size: 11 };
const C = {};

const HI   = '#7ee8a2';
const HI2  = '#5b9cf6';
const HI3  = '#f5a623';
const DIM  = '#1e2028';
const DIM2 = '#2a2d38';

function kill(id){ if(C[id]){C[id].destroy();delete C[id];} }

async function load(){
  document.getElementById('rbtn').textContent = '↻ loading…';
  try {
    const r = await fetch('/admin/analytics/data${sp}');
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    render(d);
    document.getElementById('ts').textContent = new Date().toLocaleTimeString();
  } catch(e){
    document.getElementById('ts').textContent = 'error: '+e.message;
  }
  document.getElementById('rbtn').textContent = '↻ refresh';
}

function render(d){
  const main = document.getElementById('main');
  main.innerHTML = tmpl(d);

  // fade in cards
  setTimeout(()=>{
    document.querySelectorAll('.fade').forEach((el,i)=>{
      setTimeout(()=>el.classList.add('in'), i*40);
    });
  }, 10);

  buildCharts(d);
}

function pct(a,b){ return b ? Math.round(a/b*100) : 0; }
function fmt(n){ return n>=1000?(n/1000).toFixed(1)+'k':String(n); }
function rel(iso){
  if(!iso) return '—';
  const m = Math.floor((Date.now()-new Date(iso))/60000);
  if(m<1) return 'just now';
  if(m<60) return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function delta(today, yesterday){
  if(!yesterday) return '';
  const d = today - yesterday;
  if(d===0) return '<span class="nu">same as yesterday</span>';
  const s = d>0?'+':'';
  return \`<span class="\${d>0?'up':'dn'}">\${s}\${d} vs yesterday</span>\`;
}

function tmpl(d){
  const retPairs = [
    { label:'active 7d',  n: d.active7d,  pct: pct(d.active7d,  d.totalUsers), color: HI  },
    { label:'active 30d', n: d.active30d, pct: pct(d.active30d, d.totalUsers), color: HI2 },
    { label:'repeat',     n: d.repeatUsers,  pct: pct(d.repeatUsers, d.totalUsers),  color: HI3 },
    { label:'one-time',   n: d.oneTimeUsers, pct: pct(d.oneTimeUsers,d.totalUsers),  color: '#4a4f62' },
  ];

  return \`
  <!-- KPIs -->
  <div>
    <div class="section-label">overview</div>
    <div class="kpi-grid">
      \${kpi('Total users',   fmt(d.totalUsers),   'all time',          HI)}
      \${kpi('New today',     fmt(d.newToday),      'signed up today',  HI)}
      \${kpi('New (7d)',      fmt(d.new7d),         'last 7 days',      HI2)}
      \${kpi('Active (7d)',   fmt(d.active7d),      pct(d.active7d,d.totalUsers)+'% of users',   HI2)}
      \${kpi('Msgs today',    fmt(d.msgsToday),     delta(d.msgsToday,d.msgsYesterday),           HI3)}
      \${kpi('Total msgs',    fmt(d.totalMessages), 'last 90 days',     HI3)}
      \${kpi('Conversations', fmt(d.totalConvos),   'last 90 days',     '#b060f0')}
      \${kpi('Msgs/convo',    d.avgMsgsPerConvo,    'avg depth',        '#60c0f0')}
    </div>
  </div>

  <!-- Growth -->
  <div>
    <div class="section-label">growth</div>
    <div class="g2">
      <div class="card fade">
        <div class="card-title">cumulative users — 30 days</div>
        <div class="cw cw-200"><canvas id="c-cumul"></canvas></div>
      </div>
      <div class="card fade">
        <div class="card-title">new signups per day — 30 days</div>
        <div class="cw cw-200"><canvas id="c-growth"></canvas></div>
      </div>
    </div>
  </div>

  <!-- Messages -->
  <div>
    <div class="section-label">messaging</div>
    <div class="g31">
      <div class="card fade">
        <div class="card-title">messages per day — 30 days</div>
        <div class="cw cw-200"><canvas id="c-msgs"></canvas></div>
      </div>
      <div class="card fade">
        <div class="card-title">inbound vs outbound</div>
        <div class="ratio-wrap">
          <div class="cw" style="height:140px;width:140px;flex-shrink:0"><canvas id="c-ratio"></canvas></div>
          <div class="ratio-labels">
            \${[['Inbound', d.inbound, HI],['Outbound', d.outbound, HI2]].map(([l,n,c])=>\`
            <div class="ratio-item">
              <div class="ratio-dot" style="background:\${c}"></div>
              <div>\${l}<br><strong style="color:#fff;font-size:14px">\${fmt(n)}</strong></div>
            </div>\`).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Retention -->
  <div>
    <div class="section-label">retention &amp; engagement</div>
    <div class="g2">
      <div class="card fade">
        <div class="card-title">user retention</div>
        <div class="ret-bars">
          \${retPairs.map(r=>\`
          <div class="ret-row">
            <div class="ret-label">\${r.label}</div>
            <div class="ret-track">
              <div class="ret-fill" style="width:\${r.pct}%;background:\${r.color}22;border-right:2px solid \${r.color}"></div>
              <span class="ret-n">\${fmt(r.n)}</span>
            </div>
            <div class="ret-pct">\${r.pct}%</div>
          </div>\`).join('')}
        </div>
      </div>
      <div class="card fade">
        <div class="card-title">languages</div>
        <div class="cw cw-160"><canvas id="c-lang"></canvas></div>
      </div>
    </div>
  </div>

  <!-- When -->
  <div>
    <div class="section-label">when people use it</div>
    <div class="g2">
      <div class="card fade">
        <div class="card-title">activity by hour — last 30 days</div>
        <div class="hm" id="hm"></div>
      </div>
      <div class="card fade">
        <div class="card-title">activity by day of week</div>
        <div id="dow-chart" style="padding-top:8px"></div>
      </div>
    </div>
  </div>

  <!-- What they search -->
  <div>
    <div class="section-label">what people send</div>
    <div class="g2">
      <div class="card fade">
        <div class="card-title">top inbound messages (all)</div>
        <div class="sb-list" id="sb-all"></div>
      </div>
      <div class="card fade">
        <div class="card-title">top entry messages (first msg per conversation)</div>
        <div class="sb-list" id="sb-entry"></div>
      </div>
    </div>
  </div>

  <!-- Recent users -->
  <div class="card fade">
    <div class="card-title">most recently active users</div>
    <table>
      <thead><tr><th>Name</th><th>Language</th><th>Last seen</th></tr></thead>
      <tbody>
        \${(d.recentUsers||[]).map(u=>\`
        <tr>
          <td>\${esc(u.name||u.whatsapp_id||'—')}</td>
          <td><span class="tag">\${esc(u.language||'?')}</span></td>
          <td class="mono">\${rel(u.last_seen_at)}</td>
        </tr>\`).join('')}
      </tbody>
    </table>
  </div>
  \`;
}

function kpi(label, val, sub, color){
  return \`<div class="kpi fade">
    <div class="kpi-accent" style="background:\${color}"></div>
    <div class="kpi-label">\${label}</div>
    <div class="kpi-val">\${val}</div>
    <div class="kpi-sub">\${sub}</div>
  </div>\`;
}

function buildCharts(d){
  const gridColor = '#1a1c22';

  // ── Cumulative users ──
  kill('cumul');
  C.cumul = new Chart(document.getElementById('c-cumul'),{
    type:'line',
    data:{
      labels: d.userCumulative.map(r=>r.day.slice(5)),
      datasets:[{
        data: d.userCumulative.map(r=>r.total),
        borderColor: HI, borderWidth:2,
        fill:true, backgroundColor:'rgba(126,232,162,.06)',
        tension:.3, pointRadius:0,
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{ x:{grid:{color:gridColor}}, y:{grid:{color:gridColor},beginAtZero:false} }
    }
  });

  // ── Daily signups ──
  kill('growth');
  C.growth = new Chart(document.getElementById('c-growth'),{
    type:'bar',
    data:{
      labels: d.userGrowth.map(r=>r.day.slice(5)),
      datasets:[{
        data: d.userGrowth.map(r=>r.count),
        backgroundColor:'rgba(126,232,162,.2)', borderColor:HI, borderWidth:1, borderRadius:2,
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{ x:{grid:{color:gridColor}}, y:{grid:{color:gridColor},beginAtZero:true} }
    }
  });

  // ── Messages per day ──
  kill('msgs');
  C.msgs = new Chart(document.getElementById('c-msgs'),{
    type:'bar',
    data:{
      labels: d.messagesPerDay.map(r=>r.day.slice(5)),
      datasets:[{
        data: d.messagesPerDay.map(r=>r.count),
        backgroundColor:'rgba(91,156,246,.18)', borderColor:HI2, borderWidth:1, borderRadius:2,
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{ x:{grid:{color:gridColor},ticks:{maxTicksLimit:10}}, y:{grid:{color:gridColor},beginAtZero:true} }
    }
  });

  // ── Inbound/outbound donut ──
  kill('ratio');
  C.ratio = new Chart(document.getElementById('c-ratio'),{
    type:'doughnut',
    data:{
      labels:['Inbound','Outbound'],
      datasets:[{ data:[d.inbound,d.outbound], backgroundColor:[HI+'44',HI2+'44'], borderColor:[HI,HI2], borderWidth:2 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'70%',
      plugins:{legend:{display:false}}
    }
  });

  // ── Language donut ──
  kill('lang');
  const COLS=['#7ee8a2','#5b9cf6','#f5a623','#b060f0','#f06060','#60c0f0'];
  C.lang = new Chart(document.getElementById('c-lang'),{
    type:'doughnut',
    data:{
      labels: d.languages.map(l=>l.lang),
      datasets:[{
        data: d.languages.map(l=>l.count),
        backgroundColor: COLS, borderColor:'#0d0e12', borderWidth:2,
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'55%',
      plugins:{legend:{position:'right', labels:{boxWidth:10,padding:10,font:{size:10}}}}
    }
  });

  // ── Heatmap ──
  const maxH = Math.max(...d.hourCounts,1);
  document.getElementById('hm').innerHTML = d.hourCounts.map((c,h)=>{
    const a = (.06 + (c/maxH)*.88).toFixed(2);
    return \`<div class="hm-col">
      <div class="hm-cell" style="background:rgba(91,156,246,\${a})" title="\${c} msgs at \${h}:00"></div>
      <div class="hm-lbl">\${h}</div>
    </div>\`;
  }).join('');

  // ── Day of week ──
  const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const maxD = Math.max(...d.dowCounts,1);
  document.getElementById('dow-chart').innerHTML = \`
    <div class="dow">
      \${d.dowCounts.map((c,i)=>{
        const h = Math.max(4, Math.round((c/maxD)*100));
        const a = (.1 + (c/maxD)*.8).toFixed(2);
        return \`<div class="dow-col" style="justify-content:flex-end">
          <div style="font-size:10px;color:#7ee8a2;margin-bottom:4px">\${c>0?fmt(c):''}</div>
          <div class="dow-bar" style="height:\${h}px;background:rgba(126,232,162,\${a})"></div>
          <div class="dow-lbl">\${DAYS[i]}</div>
        </div>\`;
      }).join('')}
    </div>\`;

  // ── Search bars ──
  function buildSB(listId, items, color){
    const el = document.getElementById(listId);
    if(!items.length){ el.innerHTML='<div style="color:var(--dim);padding:8px">No data yet</div>'; return; }
    const max = items[0].count;
    el.innerHTML = items.map((s,i)=>\`
      <div class="sb-row">
        <div class="sb-rank">\${i+1}</div>
        <div class="sb-track">
          <div class="sb-fill" style="width:\${(s.count/max*100).toFixed(1)}%;background:\${color}18"></div>
          <span class="sb-text">\${esc(s.text)}</span>
        </div>
        <span class="sb-count" style="color:\${color}">\${s.count}</span>
      </div>\`).join('');
  }
  buildSB('sb-all',   d.topSearches, HI);
  buildSB('sb-entry', d.topEntries,  HI3);
}

load();
setInterval(load, 5*60*1000);
</script>
</body>
</html>`; }

module.exports = router;
