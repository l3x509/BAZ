/**
 * analytics.js — Baz Analytics Dashboard
 * Mount in server.js: app.use('/admin', require('./analytics'))
 *
 * Architecture notes:
 * - Data endpoint fetches minimal rows from DB, processes in one pass each
 * - 60s server-side cache prevents redundant queries on rapid reloads
 * - Client uses makeChart() factory — add new charts in 2 lines
 * - Auto-refresh pauses when browser tab is hidden (saves Railway compute)
 * - To add a new metric: add to Promise.all, compute below, return in res.json,
 *   add kpi() call or section in tmpl(), add chart in buildCharts() if needed
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

function guard(req, res, next) {
  if (!ADMIN_SECRET) return next();
  const tok = req.query.secret || req.headers['x-admin-secret'];
  if (tok !== ADMIN_SECRET) return res.status(401).send('Unauthorized');
  next();
}

// ── Server-side cache ─────────────────────────────────────────
// Prevents redundant DB queries when dashboard auto-refreshes.
// TTL: 60 seconds. Cleared on server restart (Railway deploy).
const CACHE_TTL = 60 * 1000;
let _cache = null;
let _cacheTs = 0;

// ── Safe Supabase query ───────────────────────────────────────
// Returns data or [] on error — prevents one failed query from
// breaking the entire dashboard via Promise.all rejection.
async function sq(query, label) {
  try {
    const { data, error } = await query;
    if (error) { console.warn(`[analytics] ${label}:`, error.message); return []; }
    return data || [];
  } catch (err) {
    console.warn(`[analytics] ${label} threw:`, err.message);
    return [];
  }
}

// ── Date helpers ──────────────────────────────────────────────
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
function dayStr(iso) { return (iso || '').slice(0, 10); }
function last30Days(now) {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

// ── Group by day ──────────────────────────────────────────────
function byDay(rows, getDate, days) {
  const map = {};
  rows.forEach(r => { const d = dayStr(getDate(r)); if (map[d] !== undefined || days.includes(d)) map[d] = (map[d] || 0) + 1; });
  return days.map(d => ({ day: d, count: map[d] || 0 }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATA ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics/data', guard, async (req, res) => {
  // Serve cache if fresh
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
    return res.json(_cache);
  }

  const now    = Date.now();
  const d1ago  = daysAgo(1);
  const d7ago  = daysAgo(7);
  const d30ago = daysAgo(30);
  const days30 = last30Days(now);
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

  // ── Phase 1: all independent queries in parallel ─────────────────────────
  const supabase = sb();
  const [
    users,
    msgs,
    convos,
    recentUsers,
    events,
    bizAllTime,
  ] = await Promise.all([
    sq(supabase.from('users').select('id, created_at, language, last_seen_at'), 'users'),
    sq(supabase.from('messages')
      .select('id, created_at, direction, conversation_id, content')
      .gte('created_at', d30ago), 'messages'),
    sq(supabase.from('conversations')
      .select('id, created_at, user_id')
      .gte('created_at', d30ago), 'conversations'),
    sq(supabase.from('users')
      .select('name, whatsapp_id, last_seen_at, language')
      .order('last_seen_at', { ascending: false })
      .limit(12), 'recentUsers'),
    sq(supabase.from('business_events')
      .select('business_id, category_slug, created_at')
      .eq('event_type', 'impression')
      .gte('created_at', d30ago), 'events'),
    // All-time top 15 by impression_count column
    sq(supabase.from('businesses')
      .select('id, name, impression_count, listing_tier, city, service_categories(name_en, icon)')
      .eq('status', 'active')
      .order('impression_count', { ascending: false })
      .limit(15), 'bizAllTime'),
  ]);

  // ── Phase 2: fetch businesses seen in events (can't know IDs until phase 1) ──
  // This is the fix for "Unknown" names — bizAllTime only covers top 15 by
  // all-time count, but events may reference ANY business. Fetch them by ID.
  const eventBizIds = [...new Set(events.map(e => e.business_id).filter(Boolean))];
  const bizList = eventBizIds.length
    ? await sq(supabase.from('businesses')
        .select('id, name, impression_count, listing_tier, city, service_categories(name_en, icon)')
        .in('id', eventBizIds)
        .eq('status', 'active'), 'bizFromEvents')
    : [];

  // ── Users — single pass ───────────────────────────────────────────────────
  const totalUsers = users.length;
  let active7d = 0, active30d = 0, newToday = 0, new7d = 0;
  const userGrowthMap = {};
  const langMap = {};

  users.forEach(u => {
    const seen    = u.last_seen_at || '';
    const created = u.created_at   || '';
    const day     = dayStr(created);

    if (seen > d7ago)  active7d++;
    if (seen > d30ago) active30d++;
    if (created > d1ago) newToday++;
    if (created > d7ago) new7d++;
    if (days30.includes(day)) userGrowthMap[day] = (userGrowthMap[day] || 0) + 1;

    const lang = u.language || 'unknown';
    langMap[lang] = (langMap[lang] || 0) + 1;
  });

  const userGrowth = days30.map(d => ({ day: d, count: userGrowthMap[d] || 0 }));
  let running = users.filter(u => dayStr(u.created_at) < days30[0]).length;
  const userCumulative = userGrowth.map(r => { running += r.count; return { day: r.day, total: running }; });
  const languages = Object.entries(langMap).sort((a, b) => b[1] - a[1]).map(([lang, count]) => ({ lang, count }));

  // ── Messages — single pass ────────────────────────────────────────────────
  const NAV_WORDS = new Set([
    '0','menu','tout','all','back','retounen','retour',
    'plis','more','next','plus','options','categories',
    'tout kategori','all categories','tout bagay',
    'lang_ht','lang_en','lang_fr','sèvis','services',
  ]);

  const msgDayMap     = {};
  const contentMap    = {};
  const convoMsgCount = {};
  const convoFirstMsg = {};
  const hourCounts    = Array(24).fill(0);
  const dowCounts     = Array(7).fill(0);
  let inbound = 0, outbound = 0;

  msgs.forEach(m => {
    const day = dayStr(m.created_at);
    msgDayMap[day] = (msgDayMap[day] || 0) + 1;
    hourCounts[new Date(m.created_at).getHours()]++;
    dowCounts[new Date(m.created_at).getDay()]++;

    if (m.direction === 'inbound') {
      inbound++;
      const key = (m.content || '').trim().toLowerCase().slice(0, 80);
      if (key.length > 1 && !NAV_WORDS.has(key)) contentMap[key] = (contentMap[key] || 0) + 1;
      if (m.conversation_id) {
        const c = m.conversation_id;
        if (!convoFirstMsg[c] || m.created_at < convoFirstMsg[c].created_at) convoFirstMsg[c] = m;
      }
    } else {
      outbound++;
    }

    if (m.conversation_id) convoMsgCount[m.conversation_id] = (convoMsgCount[m.conversation_id] || 0) + 1;
  });

  const messagesPerDay = days30.map(d => ({ day: d, count: msgDayMap[d] || 0 }));
  const msgsToday      = msgDayMap[today]     || 0;
  const msgsYesterday  = msgDayMap[yesterday] || 0;
  const totalMessages  = msgs.length;

  const msgCounts = Object.values(convoMsgCount);
  const avgMsgsPerConvo = msgCounts.length
    ? (msgCounts.reduce((a, b) => a + b, 0) / msgCounts.length).toFixed(1) : 0;

  const topSearches = Object.entries(contentMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([text, count]) => ({ text, count }));

  const entryMap = {};
  Object.values(convoFirstMsg).forEach(m => {
    const key = (m.content || '').trim().toLowerCase().slice(0, 80);
    if (key.length > 1) entryMap[key] = (entryMap[key] || 0) + 1;
  });
  const topEntries = Object.entries(entryMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([text, count]) => ({ text, count }));

  // ── Conversations — single pass ───────────────────────────────────────────
  const totalConvos   = convos.length;
  const userConvoCount = {};
  convos.forEach(c => { userConvoCount[c.user_id] = (userConvoCount[c.user_id] || 0) + 1; });
  const repeatUsers  = Object.values(userConvoCount).filter(n => n > 1).length;
  const oneTimeUsers = Object.values(userConvoCount).filter(n => n === 1).length;

  // ── Business impressions — single pass ────────────────────────────────────
  // bizMap covers ALL businesses that appeared in events (from phase 2)
  // merged with bizAllTime so all-time table is also covered.
  const bizMap = {};
  const allBizRows = [...bizList, ...bizAllTime];
  // dedupe — bizList (event businesses) wins on duplicates since it's more targeted
  allBizRows.forEach(b => {
    if (!bizMap[b.id]) { // first-write wins — bizList loaded first
      bizMap[b.id] = {
        name:     b.name,
        tier:     b.listing_tier || 'free',
        city:     b.city || '',
        cat:      b.service_categories
          ? `${b.service_categories.icon || ''} ${b.service_categories.name_en || ''}`.trim()
          : '',
        countAll: b.impression_count || 0,
      };
    }
  });

  const bizImprMap  = {};
  const catImprMap  = {};
  const bizDayMap   = {};

  events.forEach(e => {
    bizImprMap[e.business_id] = (bizImprMap[e.business_id] || 0) + 1;
    const cat = e.category_slug || 'other';
    catImprMap[cat] = (catImprMap[cat] || 0) + 1;
    const day = dayStr(e.created_at);
    bizDayMap[day] = (bizDayMap[day] || 0) + 1;
  });

  const totalImpressions30d = events.length;

  const impressionsPerDay = days30.map(d => ({ day: d, count: bizDayMap[d] || 0 }));

  const categoryImpressions = Object.entries(catImprMap)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({ cat, count }));

  const topBizImpressions = Object.entries(bizImprMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, count30d]) => ({
      ...bizMap[id],
      id,
      name:     bizMap[id]?.name    || 'Unknown',
      count30d,
    }));

  const topBizAllTime = bizAllTime.slice(0, 15).map(b => ({
    ...bizMap[b.id],
    id: b.id,
  }));

  // ── Build response and cache ──────────────────────────────────────────────
  const payload = {
    // User metrics
    totalUsers, newToday, new7d, active7d, active30d,
    repeatUsers, oneTimeUsers, languages,
    userGrowth, userCumulative,
    // Message metrics
    totalMessages, msgsToday, msgsYesterday,
    totalConvos, avgMsgsPerConvo,
    inbound, outbound,
    messagesPerDay, topSearches, topEntries,
    hourCounts, dowCounts,
    recentUsers,
    // Business metrics
    totalImpressions30d,
    topBizImpressions, topBizAllTime,
    impressionsPerDay, categoryImpressions,
  };

  _cache   = payload;
  _cacheTs = Date.now();

  res.json(payload);
});

// ─────────────────────────────────────────────────────────────────────────────
//  HTML DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics', guard, (req, res) => {
  const sp = ADMIN_SECRET ? `?secret=${encodeURIComponent(req.query.secret || '')}` : '';
  res.setHeader('Content-Type', 'text/html');
  res.send(buildDashboardHTML(sp));
});

function buildDashboardHTML(sp) {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baz Analytics</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#06070a;--s1:#0d0e12;--s2:#12141a;
  --border:#1e2028;--border2:#2a2d38;
  --text:#c8ccd8;--dim:#4a4f62;
  --hi:#7ee8a2;--hi2:#5b9cf6;--hi3:#f5a623;--hi4:#b060f0;
  --danger:#f06060;
  --premium:#F0A500;--pro:#15B89A;--standard:#6C9EE8;--free:#4a4f62;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'DM Mono',monospace;font-size:13px;min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");opacity:.4;pointer-events:none;z-index:0}

main{position:relative;z-index:1;padding:24px 28px;max-width:1440px;display:flex;flex-direction:column;gap:20px}

/* Section labels */
.sl{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--dim);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.sl::after{content:'';flex:1;height:1px;background:var(--border)}

/* KPI grid */
.kg{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}
.kpi{background:var(--s1);border:1px solid var(--border);padding:18px 16px 14px;position:relative;overflow:hidden;transition:border-color .2s}
.kpi:hover{border-color:var(--border2)}
.ka{position:absolute;bottom:0;left:0;right:0;height:2px}
.kl{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.kv{font-weight:700;font-size:28px;line-height:1;color:#fff}
.ks{font-size:10px;color:var(--dim);margin-top:6px}
.up{color:var(--hi)}.dn{color:var(--danger)}.nu{color:var(--dim)}

/* Cards and grids */
.card{background:var(--s1);border:1px solid var(--border);padding:20px 20px 16px}
.ct{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:16px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.g31{display:grid;grid-template-columns:3fr 1fr;gap:12px}

/* Chart wrappers */
.cw{position:relative}.cw-200{height:200px}.cw-160{height:160px}

/* Retention bars */
.rb{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.rr{display:flex;align-items:center;gap:10px}
.rl{font-size:10px;color:var(--dim);width:72px;flex-shrink:0}
.rt{flex:1;height:18px;background:var(--s2);position:relative;overflow:hidden}
.rf{position:absolute;top:0;left:0;bottom:0;transition:width .7s cubic-bezier(.22,1,.36,1)}
.rn{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;color:#fff}
.rp{font-size:10px;color:var(--dim);width:36px;text-align:right;flex-shrink:0}

/* Search bars */
.sbl{display:flex;flex-direction:column;gap:5px}
.sbr{display:flex;align-items:center;gap:8px}
.sbk{font-size:10px;color:var(--dim);width:16px;text-align:right;flex-shrink:0}
.sbt{flex:1;height:22px;background:var(--s2);position:relative;overflow:hidden}
.sbf{position:absolute;top:0;left:0;bottom:0}
.sbtx{position:absolute;top:50%;left:8px;transform:translateY(-50%);font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 16px)}
.sbc{font-size:11px;color:var(--hi);width:28px;text-align:right;flex-shrink:0}

/* Heatmap */
.hm{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-top:4px}
.hmc{display:flex;flex-direction:column;align-items:center;gap:3px}
.hmb{width:100%;aspect-ratio:1;border-radius:1px}
.hml{font-size:8px;color:var(--dim)}

/* Day of week */
.dow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.dc{display:flex;flex-direction:column;align-items:center;gap:4px}
.db{width:100%;border-radius:2px 2px 0 0}
.dl{font-size:9px;color:var(--dim)}

/* Tables */
table{width:100%;border-collapse:collapse}
th{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);text-align:left;padding:0 0 10px;border-bottom:1px solid var(--border)}
td{padding:9px 0;border-bottom:1px solid var(--border);font-size:12px;vertical-align:middle}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;background:rgba(91,156,246,.1);border:1px solid rgba(91,156,246,.25);color:var(--hi2);font-size:9px;padding:2px 6px;letter-spacing:.06em}
.mono{font-family:'DM Mono',monospace;color:var(--dim);font-size:11px}

/* Tier badges */
.tier{display:inline-block;font-size:9px;padding:2px 6px;letter-spacing:.06em;border-radius:2px}
.tier-premium{background:rgba(240,165,0,.15);color:var(--premium);border:1px solid rgba(240,165,0,.3)}
.tier-pro{background:rgba(21,184,154,.12);color:var(--pro);border:1px solid rgba(21,184,154,.25)}
.tier-standard{background:rgba(108,158,232,.12);color:var(--standard);border:1px solid rgba(108,158,232,.2)}
.tier-free{background:rgba(74,79,98,.15);color:var(--dim);border:1px solid var(--border)}

/* Ratio ring */
.rw{display:flex;align-items:center;gap:20px;padding:8px 0}
.rla{display:flex;flex-direction:column;gap:8px}
.ri{display:flex;align-items:center;gap:8px;font-size:11px}
.rd{width:8px;height:8px;border-radius:50%;flex-shrink:0}

/* Loading */
.pulse{display:flex;align-items:center;justify-content:center;height:140px;gap:6px}
.p{width:6px;height:6px;border-radius:50%;background:var(--dim);animation:pp 1.2s ease-in-out infinite}
.p:nth-child(2){animation-delay:.15s}.p:nth-child(3){animation-delay:.3s}
@keyframes pp{0%,80%,100%{transform:scale(.6);opacity:.3}40%{transform:scale(1);opacity:1}}
.fade{opacity:0;transform:translateY(8px);transition:opacity .4s,transform .4s}
.fade.in{opacity:1;transform:none}

@media(max-width:1100px){.kg{grid-template-columns:repeat(4,1fr)}}
@media(max-width:800px){.kg{grid-template-columns:repeat(2,1fr)}.g2,.g31{grid-template-columns:1fr}main{padding:16px}}
</style>
</head>
<body>
<main id="main">
  <div class="pulse"><div class="p"></div><div class="p"></div><div class="p"></div></div>
</main>
<script>
// ── Constants ────────────────────────────────────────────────
const HI='#7ee8a2',HI2='#5b9cf6',HI3='#f5a623',HI4='#b060f0';
const PREMIUM='#F0A500',PRO='#15B89A',STANDARD='#6C9EE8',FREE='#4a4f62';
const GRID='#1a1c22';
const C={};  // chart registry

Chart.defaults.color='#4a4f62';
Chart.defaults.font={family:"'DM Mono',monospace",size:11};

// ── Helpers ──────────────────────────────────────────────────
const fmt  = n => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n||0);
const pct  = (a,b) => b ? Math.round(a/b*100) : 0;
const esc  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const rel  = iso => {
  if (!iso) return '—';
  const m = Math.floor((Date.now()-new Date(iso))/60000);
  if (m<1) return 'just now'; if (m<60) return m+'m ago';
  const h = Math.floor(m/60); if (h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
};
const delta = (a,b) => {
  if (!b) return '';
  const d=a-b, s=d>0?'+':'';
  return d===0 ? '<span class="nu">same as yesterday</span>'
               : \`<span class="\${d>0?'up':'dn'}">\${s}\${d} vs yesterday</span>\`;
};
const tierBadge = t => \`<span class="tier tier-\${t||'free'}">\${t||'free'}</span>\`;

// ── Chart factory ────────────────────────────────────────────
// Reduces 8-12 lines per chart to 2-3 lines.
// To add a new chart: kill(id), makeChart(id, type, labels, datasets, extraOpts)
function kill(id) { if (C[id]) { C[id].destroy(); delete C[id]; } }

function baseOpts(extra={}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, ...extra.plugins },
    scales: {
      x: { grid: { color: GRID }, ticks: { maxTicksLimit: 10 }, ...extra.xAxis },
      y: { grid: { color: GRID }, beginAtZero: true, ...extra.yAxis },
      ...extra.scales,
    },
    ...extra,
  };
}

function makeBar(id, labels, data, color, extra={}) {
  kill(id);
  C[id] = new Chart(document.getElementById(id), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: color+'33', borderColor: color, borderWidth:1, borderRadius:2 }],
    },
    options: baseOpts(extra),
  });
}

function makeLine(id, labels, data, color) {
  kill(id);
  C[id] = new Chart(document.getElementById(id), {
    type: 'line',
    data: {
      labels,
      datasets: [{ data, borderColor: color, borderWidth:2, fill:true, backgroundColor: color+'10', tension:.3, pointRadius:0 }],
    },
    options: baseOpts({ yAxis: { beginAtZero: false } }),
  });
}

function makeDonut(id, labels, data, colors, legendPos='right') {
  kill(id);
  C[id] = new Chart(document.getElementById(id), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#0d0e12', borderWidth:2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: legendPos, labels: { boxWidth:10, padding:8, font:{size:10} } } },
    },
  });
}

// ── Section renderers ─────────────────────────────────────────
// Each section is a pure function — easy to add, remove, reorder.

function kpiCard(label, val, sub, color) {
  return \`<div class="kpi fade">
    <div class="ka" style="background:\${color}"></div>
    <div class="kl">\${label}</div>
    <div class="kv">\${val}</div>
    <div class="ks">\${sub}</div>
  </div>\`;
}

function sectionKPIs(d) {
  return \`<div>
    <div class="sl">overview</div>
    <div class="kg">
      \${kpiCard('Total users',     fmt(d.totalUsers),          'all time',                                    HI)}
      \${kpiCard('New today',       fmt(d.newToday),            'signed up today',                             HI)}
      \${kpiCard('New (7d)',        fmt(d.new7d),               'last 7 days',                                 HI2)}
      \${kpiCard('Active (7d)',     fmt(d.active7d),            pct(d.active7d,d.totalUsers)+'% of users',     HI2)}
      \${kpiCard('Msgs today',      fmt(d.msgsToday),           delta(d.msgsToday,d.msgsYesterday),            HI3)}
      \${kpiCard('Total msgs',      fmt(d.totalMessages),       'last 30 days',                                HI3)}
      \${kpiCard('Impressions 30d', fmt(d.totalImpressions30d), 'business views',                              HI4)}
      \${kpiCard('Msgs / convo',    d.avgMsgsPerConvo,          'avg depth',                                   '#60c0f0')}
    </div>
  </div>\`;
}

function sectionImpressions(d) {
  const bizRows = (items, key) => {
    if (!items?.length) return '<tr><td colspan="5" style="color:var(--dim);padding:12px 0">No impression data yet</td></tr>';
    return items.map((b,i) => \`<tr>
      <td style="color:var(--dim);font-size:10px">\${i+1}</td>
      <td style="font-weight:500;color:#fff">\${esc(b.name)}</td>
      <td>\${tierBadge(b.tier)}</td>
      <td class="mono">\${esc(b.city)}</td>
      <td style="color:\${HI3};text-align:right">\${fmt(b[key])}</td>
    </tr>\`).join('');
  };

  return \`<div>
    <div class="sl">business impressions</div>
    <div class="g2">
      <div class="card fade">
        <div class="ct">impressions per day — last 30 days</div>
        <div class="cw cw-200"><canvas id="c-impr"></canvas></div>
      </div>
      <div class="card fade">
        <div class="ct">impressions by category — last 30 days</div>
        <div class="cw cw-200"><canvas id="c-catimpr"></canvas></div>
      </div>
    </div>
    <div class="g2" style="margin-top:12px">
      <div class="card fade">
        <div class="ct">top businesses — last 30 days</div>
        <table><thead><tr><th>#</th><th>Business</th><th>Tier</th><th>City</th><th style="text-align:right">Views</th></tr></thead>
        <tbody>\${bizRows(d.topBizImpressions,'count30d')}</tbody></table>
      </div>
      <div class="card fade">
        <div class="ct">top businesses — all time</div>
        <table><thead><tr><th>#</th><th>Business</th><th>Tier</th><th>City</th><th style="text-align:right">Views</th></tr></thead>
        <tbody>\${bizRows(d.topBizAllTime,'countAll')}</tbody></table>
      </div>
    </div>
  </div>\`;
}

function sectionGrowth(d) {
  return \`<div>
    <div class="sl">user growth</div>
    <div class="g2">
      <div class="card fade"><div class="ct">cumulative users — 30 days</div><div class="cw cw-200"><canvas id="c-cumul"></canvas></div></div>
      <div class="card fade"><div class="ct">new signups per day</div><div class="cw cw-200"><canvas id="c-growth"></canvas></div></div>
    </div>
  </div>\`;
}

function sectionMessaging(d) {
  const ratioItems = [['Inbound',d.inbound,HI],['Outbound',d.outbound,HI2]];
  return \`<div>
    <div class="sl">messaging</div>
    <div class="g31">
      <div class="card fade"><div class="ct">messages per day — 30 days</div><div class="cw cw-200"><canvas id="c-msgs"></canvas></div></div>
      <div class="card fade">
        <div class="ct">inbound vs outbound</div>
        <div class="rw">
          <div class="cw" style="height:140px;width:140px;flex-shrink:0"><canvas id="c-ratio"></canvas></div>
          <div class="rla">
            \${ratioItems.map(([l,n,c])=>\`<div class="ri"><div class="rd" style="background:\${c}"></div><div>\${l}<br><strong style="color:#fff;font-size:14px">\${fmt(n)}</strong></div></div>\`).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>\`;
}

function sectionRetention(d) {
  const retPairs=[
    {label:'active 7d', n:d.active7d,  p:pct(d.active7d,d.totalUsers),  c:HI},
    {label:'active 30d',n:d.active30d, p:pct(d.active30d,d.totalUsers), c:HI2},
    {label:'repeat',    n:d.repeatUsers,  p:pct(d.repeatUsers,d.totalUsers),  c:HI3},
    {label:'one-time',  n:d.oneTimeUsers, p:pct(d.oneTimeUsers,d.totalUsers), c:FREE},
  ];
  return \`<div>
    <div class="sl">retention &amp; engagement</div>
    <div class="g2">
      <div class="card fade">
        <div class="ct">user retention</div>
        <div class="rb">
          \${retPairs.map(r=>\`<div class="rr">
            <div class="rl">\${r.label}</div>
            <div class="rt"><div class="rf" style="width:\${r.p}%;background:\${r.c}22;border-right:2px solid \${r.c}"></div><span class="rn">\${fmt(r.n)}</span></div>
            <div class="rp">\${r.p}%</div>
          </div>\`).join('')}
        </div>
      </div>
      <div class="card fade"><div class="ct">languages</div><div class="cw cw-160"><canvas id="c-lang"></canvas></div></div>
    </div>
  </div>\`;
}

function sectionWhen() {
  return \`<div>
    <div class="sl">when people use it</div>
    <div class="g2">
      <div class="card fade"><div class="ct">activity by hour — last 30 days</div><div class="hm" id="hm"></div></div>
      <div class="card fade"><div class="ct">activity by day of week</div><div id="dow" style="padding-top:8px"></div></div>
    </div>
  </div>\`;
}

function sectionSearches() {
  return \`<div>
    <div class="sl">what people send</div>
    <div class="g2">
      <div class="card fade"><div class="ct">top inbound messages</div><div class="sbl" id="sb-all"></div></div>
      <div class="card fade"><div class="ct">top entry messages</div><div class="sbl" id="sb-entry"></div></div>
    </div>
  </div>\`;
}

function sectionUsers(d) {
  return \`<div class="card fade">
    <div class="ct">most recently active users</div>
    <table>
      <thead><tr><th>Name</th><th>Language</th><th>Last seen</th></tr></thead>
      <tbody>
        \${(d.recentUsers||[]).map(u=>\`<tr>
          <td>\${esc(u.name||u.whatsapp_id||'—')}</td>
          <td><span class="tag">\${esc(u.language||'?')}</span></td>
          <td class="mono">\${rel(u.last_seen_at)}</td>
        </tr>\`).join('')}
      </tbody>
    </table>
  </div>\`;
}

// ── Render ────────────────────────────────────────────────────
function render(d) {
  document.getElementById('main').innerHTML = [
    sectionKPIs(d),
    sectionImpressions(d),
    sectionGrowth(d),
    sectionMessaging(d),
    sectionRetention(d),
    sectionWhen(),
    sectionSearches(),
    sectionUsers(d),
  ].join('');

  setTimeout(() => {
    document.querySelectorAll('.fade').forEach((el,i) => {
      setTimeout(() => el.classList.add('in'), i*40);
    });
  }, 10);

  buildCharts(d);
}

// ── Build charts ──────────────────────────────────────────────
function buildCharts(d) {
  const days = d.impressionsPerDay.map(r => r.day.slice(5));

  // Business impressions
  makeBar('c-impr', days, d.impressionsPerDay.map(r=>r.count), HI4);
  makeDonut('c-catimpr',
    d.categoryImpressions.map(c=>c.cat),
    d.categoryImpressions.map(c=>c.count),
    ['#F0A500','#15B89A','#6C9EE8','#b060f0','#7ee8a2','#f06060','#60c0f0','#f5a623']
  );

  // Growth
  const uDays = d.userCumulative.map(r=>r.day.slice(5));
  makeLine('c-cumul', uDays, d.userCumulative.map(r=>r.total), HI);
  makeBar('c-growth', d.userGrowth.map(r=>r.day.slice(5)), d.userGrowth.map(r=>r.count), HI);

  // Messages
  makeBar('c-msgs', d.messagesPerDay.map(r=>r.day.slice(5)), d.messagesPerDay.map(r=>r.count), HI2);

  // Inbound/outbound — custom donut (no legend, larger cutout)
  kill('c-ratio');
  C['c-ratio'] = new Chart(document.getElementById('c-ratio'), {
    type: 'doughnut',
    data: { labels:['Inbound','Outbound'], datasets:[{ data:[d.inbound,d.outbound], backgroundColor:[HI+'44',HI2+'44'], borderColor:[HI,HI2], borderWidth:2 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{legend:{display:false}} },
  });

  // Language
  makeDonut('c-lang', d.languages.map(l=>l.lang), d.languages.map(l=>l.count),
    ['#7ee8a2','#5b9cf6','#f5a623','#b060f0','#f06060','#60c0f0']);

  // Heatmap
  const maxH = Math.max(...d.hourCounts, 1);
  document.getElementById('hm').innerHTML = d.hourCounts.map((c,h) => {
    const a = (.06 + (c/maxH)*.88).toFixed(2);
    return \`<div class="hmc"><div class="hmb" style="background:rgba(91,156,246,\${a})" title="\${c} msgs at \${h}:00"></div><div class="hml">\${h}</div></div>\`;
  }).join('');

  // Day of week
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const maxD = Math.max(...d.dowCounts, 1);
  document.getElementById('dow').innerHTML = \`<div class="dow">\${
    d.dowCounts.map((c,i) => {
      const h = Math.max(4, Math.round((c/maxD)*100));
      const a = (.1 + (c/maxD)*.8).toFixed(2);
      return \`<div class="dc" style="justify-content:flex-end">
        <div style="font-size:10px;color:\${HI};margin-bottom:4px">\${c>0?fmt(c):''}</div>
        <div class="db" style="height:\${h}px;background:rgba(126,232,162,\${a})"></div>
        <div class="dl">\${DAYS[i]}</div>
      </div>\`;
    }).join('')
  }</div>\`;

  // Search bars
  buildSB('sb-all',   d.topSearches, HI);
  buildSB('sb-entry', d.topEntries,  HI3);
}

function buildSB(id, items, color) {
  const el = document.getElementById(id);
  if (!items?.length) { el.innerHTML='<div style="color:var(--dim);padding:8px">No data yet</div>'; return; }
  const max = items[0].count;
  el.innerHTML = items.map((s,i) => \`<div class="sbr">
    <div class="sbk">\${i+1}</div>
    <div class="sbt">
      <div class="sbf" style="width:\${(s.count/max*100).toFixed(1)}%;background:\${color}18"></div>
      <span class="sbtx">\${esc(s.text)}</span>
    </div>
    <span class="sbc" style="color:\${color}">\${s.count}</span>
  </div>\`).join('');
}

// ── Load and auto-refresh ─────────────────────────────────────
// Pauses when tab is hidden — saves Railway compute and Supabase quota.
async function load() {
  try {
    const r = await fetch('/admin/analytics/data${sp}');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    render(d);
  } catch(e) {
    console.error('[analytics]', e.message);
  }
}

load();

let refreshInterval = setInterval(load, 5*60*1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(refreshInterval);
  } else {
    load(); // reload immediately on tab focus
    refreshInterval = setInterval(load, 5*60*1000);
  }
});
</script>
</body>
</html>`;
}

module.exports = router;
