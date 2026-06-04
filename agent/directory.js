'use strict';

// ============================================================
// agent/directory.js
// Admin directory management — mounted at /admin/directory
// All Supabase calls proxied server-side. Key never touches browser.
// Mount in server.js: app.use('/admin', require('./directory'))
// ============================================================

const express   = require('express');
const router    = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function auth(req, res, next) {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── GET /admin/directory ─────────────────────────────────────
// Serves the full directory management UI
router.get('/directory', auth, (req, res) => {
  const secret = req.query.secret;
  res.setHeader('Content-Type', 'text/html');
  res.send(buildDirectoryHTML(secret));
});

// ── GET /admin/directory/data ────────────────────────────────
// Returns businesses with pagination + search + filter
router.get('/directory/data', auth, async (req, res) => {
  try {
    const sb     = getSupabase();
    const search = req.query.search || '';
    const cat    = req.query.category || '';
    const tier   = req.query.tier || '';
    const page   = parseInt(req.query.page || '0', 10);
    const limit  = 20;

    let q = sb.from('businesses')
      .select('id,name,phone,whatsapp,website,address,city,description,category_id,status,is_featured,is_verified,listing_tier,avg_rating,impression_count,meta,service_categories(slug,name_en,icon)', { count: 'exact' })
      .order('name')
      .range(page * limit, page * limit + limit - 1);

    if (search) q = q.or(`name.ilike.%${search}%,city.ilike.%${search}%,phone.ilike.%${search}%`);
    if (cat)    q = q.eq('category_id', cat);
    if (tier)   q = q.eq('listing_tier', tier);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ businesses: data || [], total: count || 0, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/directory/categories ─────────────────────────
router.get('/directory/categories', auth, async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('service_categories')
      .select('id,slug,name_en,icon')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/directory/business/:id ───────────────────────
router.get('/directory/business/:id', auth, async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('businesses')
      .select('*,service_categories(slug,name_en,icon)')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/directory/business/:id ─────────────────────
// Update any fields on a business
router.patch('/directory/business/:id', auth, async (req, res) => {
  try {
    const allowed = [
      'name','phone','whatsapp','website','address','city','description',
      'category_id','status','is_featured','is_verified','listing_tier','meta'
    ];
    const updates = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('businesses')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/directory/business ──────────────────────────
// Add a new business
router.post('/directory/business', auth, async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('businesses')
      .insert({
        name:         req.body.name,
        phone:        req.body.phone        || null,
        whatsapp:     req.body.whatsapp     || null,
        website:      req.body.website      || null,
        address:      req.body.address      || null,
        city:         req.body.city         || null,
        country:      req.body.country      || 'US',
        description:  req.body.description  || null,
        category_id:  req.body.category_id  || null,
        status:       req.body.status       || 'active',
        is_verified:  req.body.is_verified  || false,
        listing_tier: req.body.listing_tier || 'free',
        meta:         req.body.meta         || {},
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/directory/business/:id ────────────────────
// Soft delete — sets status to inactive
router.delete('/directory/business/:id', auth, async (req, res) => {
  try {
    const { error } = await getSupabase()
      .from('businesses')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/directory/stats ───────────────────────────────
router.get('/directory/stats', auth, async (req, res) => {
  try {
    const sb = getSupabase();
    const [total, byTier, nullCat] = await Promise.all([
      sb.from('businesses').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('businesses').select('listing_tier').eq('status', 'active'),
      sb.from('businesses').select('id', { count: 'exact', head: true }).eq('status', 'active').is('category_id', null),
    ]);

    const tiers = { free: 0, standard: 0, pro: 0, premium: 0 };
    for (const b of (byTier.data || [])) {
      const t = b.listing_tier || 'free';
      tiers[t] = (tiers[t] || 0) + 1;
    }

    res.json({
      total:    total.count   || 0,
      nullCat:  nullCat.count || 0,
      tiers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DIRECTORY UI HTML
// ============================================================
function buildDirectoryHTML(secret) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baz · Directory</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#0B1623;--navy-mid:#132033;--navy-light:#1C2F47;
  --gold:#F0A500;--gold-light:#F7C04A;--gold-dim:rgba(240,165,0,0.10);
  --teal:#15B89A;--teal-dim:rgba(21,184,154,0.10);
  --cream:#F5EFE0;--cream-muted:rgba(245,239,224,0.55);
  --border:rgba(245,239,224,0.08);
  --premium:#F0A500;--pro:#15B89A;--standard:#6C9EE8;--free:rgba(245,239,224,0.25);
  --red:#e07575;
}
body{background:var(--navy);color:var(--cream);font-family:'DM Sans',sans-serif;font-weight:300;min-height:100vh;font-size:14px}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 60% at 50% -10%,rgba(21,184,154,0.06) 0%,transparent 65%),radial-gradient(ellipse 50% 40% at 85% 90%,rgba(240,165,0,0.04) 0%,transparent 60%);pointer-events:none;z-index:0}

/* ── LAYOUT ── */
.wrap{position:relative;z-index:1;max-width:1200px;margin:0 auto;padding:1.5rem 1.5rem 4rem}

/* ── STATS BAR ── */
.stats{display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
.stat{background:var(--navy-mid);border:1px solid var(--border);border-radius:.75rem;padding:.75rem 1.25rem;display:flex;flex-direction:column;gap:.15rem;flex:1;min-width:120px}
.stat-val{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:600;line-height:1;color:var(--gold)}
.stat-label{font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cream-muted)}
.stat.warn .stat-val{color:var(--red)}
.stat.teal .stat-val{color:var(--teal)}

/* ── TOOLBAR ── */
.toolbar{display:flex;gap:.75rem;margin-bottom:1.25rem;flex-wrap:wrap;align-items:center}
.search-box{flex:1;min-width:200px;position:relative}
.search-box input{width:100%;background:var(--navy-mid);border:1px solid var(--border);color:var(--cream);font-family:'DM Sans',sans-serif;font-size:.88rem;padding:.65rem 1rem .65rem 2.5rem;border-radius:.5rem;outline:none;transition:border-color .2s}
.search-box input:focus{border-color:rgba(240,165,0,.4)}
.search-box svg{position:absolute;left:.75rem;top:50%;transform:translateY(-50%);opacity:.35;pointer-events:none}
select{background:var(--navy-mid);border:1px solid var(--border);color:var(--cream);font-family:'DM Sans',sans-serif;font-size:.83rem;padding:.65rem .9rem;border-radius:.5rem;outline:none;cursor:pointer;transition:border-color .2s}
select:focus{border-color:rgba(240,165,0,.4)}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.6rem 1.1rem;border-radius:.5rem;font-family:'DM Sans',sans-serif;font-size:.83rem;font-weight:500;cursor:pointer;border:none;transition:all .2s;letter-spacing:.01em}
.btn-gold{background:var(--gold);color:var(--navy)}
.btn-gold:hover{background:var(--gold-light);transform:translateY(-1px)}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--cream-muted)}
.btn-ghost:hover{border-color:rgba(240,165,0,.3);color:var(--gold)}
.btn-red{background:transparent;border:1px solid rgba(224,117,117,.3);color:var(--red)}
.btn-red:hover{background:rgba(224,117,117,.08)}
.btn-sm{padding:.4rem .75rem;font-size:.78rem}

/* ── TABLE ── */
.table-wrap{background:var(--navy-mid);border:1px solid var(--border);border-radius:.75rem;overflow:hidden;margin-bottom:1rem}
table{width:100%;border-collapse:collapse}
thead th{background:var(--navy-light);padding:.75rem 1rem;text-align:left;font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cream-muted);font-weight:500;white-space:nowrap}
tbody tr{border-top:1px solid var(--border);cursor:pointer;transition:background .15s}
tbody tr:hover{background:rgba(245,239,224,.03)}
tbody td{padding:.75rem 1rem;font-size:.85rem;vertical-align:middle}
.td-name{font-weight:500;color:var(--cream)}
.td-city{color:var(--cream-muted);font-size:.8rem}
.td-phone{font-family:'DM Mono',monospace;font-size:.78rem;color:var(--cream-muted)}
.td-actions{display:flex;gap:.4rem;justify-content:flex-end}

/* ── TIER BADGE ── */
.tier{display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .6rem;border-radius:2rem;font-size:.68rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.tier-premium{background:rgba(240,165,0,.15);color:var(--gold);border:1px solid rgba(240,165,0,.25)}
.tier-pro{background:rgba(21,184,154,.12);color:var(--teal);border:1px solid rgba(21,184,154,.25)}
.tier-standard{background:rgba(108,158,232,.12);color:#6C9EE8;border:1px solid rgba(108,158,232,.2)}
.tier-free{background:rgba(245,239,224,.05);color:var(--cream-muted);border:1px solid var(--border)}

/* ── STATUS DOT ── */
.dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.dot-active{background:var(--teal)}
.dot-inactive{background:var(--red)}

/* ── CAT PILL ── */
.cat{font-size:.72rem;color:var(--cream-muted);background:rgba(245,239,224,.05);border:1px solid var(--border);padding:.15rem .5rem;border-radius:2rem}

/* ── PAGINATION ── */
.pagination{display:flex;align-items:center;gap:.75rem;justify-content:center;padding:.5rem 0}
.page-info{font-size:.78rem;color:var(--cream-muted);font-family:'DM Mono',monospace}

/* ── DRAWER ── */
.drawer-overlay{position:fixed;inset:0;background:rgba(11,22,35,.75);backdrop-filter:blur(4px);z-index:100;display:none;align-items:flex-start;justify-content:flex-end}
.drawer-overlay.open{display:flex}
.drawer{width:min(520px,100vw);height:100vh;background:var(--navy-mid);border-left:1px solid var(--border);overflow-y:auto;animation:slideIn .25s cubic-bezier(.22,1,.36,1)}
@keyframes slideIn{from{transform:translateX(100%)}to{transform:none}}
.drawer-header{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--navy-mid);z-index:1}
.drawer-title{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:600}
.drawer-body{padding:1.5rem}
.close-btn{background:none;border:1px solid var(--border);color:var(--cream-muted);width:32px;height:32px;border-radius:.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.close-btn:hover{border-color:rgba(224,117,117,.4);color:var(--red)}

/* ── FORM ── */
.form-row{margin-bottom:1.1rem}
.form-row label{display:block;font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cream-muted);margin-bottom:.4rem;font-weight:500}
.form-row input,.form-row textarea,.form-row select{width:100%;background:var(--navy-light);border:1px solid var(--border);color:var(--cream);font-family:'DM Sans',sans-serif;font-size:.88rem;padding:.65rem .9rem;border-radius:.5rem;outline:none;transition:border-color .2s}
.form-row input:focus,.form-row textarea:focus,.form-row select:focus{border-color:rgba(240,165,0,.4)}
.form-row textarea{resize:vertical;min-height:80px;line-height:1.6}
.form-row select option{background:var(--navy-mid)}
.form-2col{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}

/* ── TIER SELECTOR ── */
.tier-selector{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin-bottom:1.25rem}
.tier-opt{padding:.6rem .4rem;border-radius:.5rem;border:2px solid var(--border);cursor:pointer;text-align:center;transition:all .2s;background:transparent}
.tier-opt .tier-name{font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;display:block}
.tier-opt .tier-price{font-size:.65rem;color:var(--cream-muted);display:block;margin-top:.1rem}
.tier-opt.sel-premium{border-color:var(--gold);background:rgba(240,165,0,.08)}
.tier-opt.sel-pro{border-color:var(--teal);background:rgba(21,184,154,.08)}
.tier-opt.sel-standard{border-color:#6C9EE8;background:rgba(108,158,232,.08)}
.tier-opt.sel-free{border-color:rgba(245,239,224,.2);background:rgba(245,239,224,.03)}
.tier-opt:not([class*="sel-"]):hover{border-color:rgba(240,165,0,.3)}

/* ── TOGGLES ── */
.toggles{display:flex;gap:1rem;margin-bottom:1.25rem}
.toggle-item{display:flex;align-items:center;gap:.6rem;cursor:pointer}
.toggle-item input{display:none}
.toggle-track{width:36px;height:20px;border-radius:10px;background:rgba(245,239,224,.1);border:1px solid var(--border);position:relative;transition:background .2s}
.toggle-item input:checked + .toggle-track{background:var(--teal);border-color:var(--teal)}
.toggle-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:white;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.toggle-item input:checked ~ .toggle-track .toggle-knob{transform:translateX(16px)}
.toggle-label{font-size:.82rem;color:var(--cream-muted)}

/* ── SAVE BAR ── */
.save-bar{position:sticky;bottom:0;background:var(--navy-mid);border-top:1px solid var(--border);padding:1rem 1.5rem;display:flex;gap:.75rem;align-items:center}
.save-status{font-size:.78rem;color:var(--teal);font-family:'DM Mono',monospace;opacity:0;transition:opacity .3s}
.save-status.show{opacity:1}

/* ── EMPTY ── */
.empty{padding:3rem;text-align:center;color:var(--cream-muted);font-size:.88rem}

/* ── TOAST ── */
.toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%) translateY(20px);background:var(--navy-light);border:1px solid var(--border);color:var(--cream);font-size:.83rem;padding:.6rem 1.25rem;border-radius:2rem;z-index:999;opacity:0;transition:all .3s;pointer-events:none;font-family:'DM Mono',monospace}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.success{border-color:rgba(21,184,154,.4);color:var(--teal)}
.toast.error{border-color:rgba(224,117,117,.4);color:var(--red)}

@media(max-width:640px){
  .form-2col{grid-template-columns:1fr}
  .tier-selector{grid-template-columns:repeat(2,1fr)}
  thead th:nth-child(3),thead th:nth-child(4),tbody td:nth-child(3),tbody td:nth-child(4){display:none}
}
</style>
</head>
<body>
<div class="wrap">

  <!-- Stats -->
  <div class="stats" id="stats-bar">
    <div class="stat"><span class="stat-val" id="s-total">—</span><span class="stat-label">Total Active</span></div>
    <div class="stat"><span class="stat-val" id="s-premium" style="color:var(--gold)">—</span><span class="stat-label">Premium</span></div>
    <div class="stat teal"><span class="stat-val" id="s-pro">—</span><span class="stat-label">Pro</span></div>
    <div class="stat"><span class="stat-val" id="s-standard" style="color:#6C9EE8">—</span><span class="stat-label">Standard</span></div>
    <div class="stat"><span class="stat-val" id="s-free">—</span><span class="stat-label">Free</span></div>
    <div class="stat warn" id="s-null-wrap"><span class="stat-val" id="s-null">—</span><span class="stat-label">No Category ⚠️</span></div>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="search-box">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input type="text" id="search" placeholder="Search name, city, phone…" oninput="debounceSearch()">
    </div>
    <select id="filter-cat" onchange="load()"><option value="">All categories</option></select>
    <select id="filter-tier" onchange="load()">
      <option value="">All tiers</option>
      <option value="premium">👑 Premium</option>
      <option value="pro">🔥 Pro</option>
      <option value="standard">Standard</option>
      <option value="free">Free</option>
    </select>
    <select id="filter-status" onchange="load()">
      <option value="">Active only</option>
      <option value="all">All statuses</option>
      <option value="inactive">Inactive</option>
    </select>
    <button class="btn btn-gold" onclick="openAdd()">+ Add Business</button>
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Business</th>
          <th>Category</th>
          <th>Tier</th>
          <th>City</th>
          <th>Phone</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="biz-table"></tbody>
    </table>
    <div class="empty" id="empty" style="display:none">No businesses found</div>
  </div>

  <!-- Pagination -->
  <div class="pagination">
    <button class="btn btn-ghost btn-sm" onclick="prevPage()" id="btn-prev">← Prev</button>
    <span class="page-info" id="page-info"></span>
    <button class="btn btn-ghost btn-sm" onclick="nextPage()" id="btn-next">Next →</button>
  </div>
</div>

<!-- Edit / Add Drawer -->
<div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer(e)">
  <div class="drawer" onclick="event.stopPropagation()">
    <div class="drawer-header">
      <span class="drawer-title" id="drawer-title">Edit Business</span>
      <button class="close-btn" onclick="closeDrawer()">✕</button>
    </div>
    <div class="drawer-body">

      <!-- Tier selector -->
      <div class="form-row">
        <label>Listing Tier</label>
        <div class="tier-selector">
          <div class="tier-opt" data-tier="free" onclick="selectTier('free')">
            <span class="tier-name" style="color:var(--cream-muted)">Free</span>
            <span class="tier-price">$0</span>
          </div>
          <div class="tier-opt" data-tier="standard" onclick="selectTier('standard')">
            <span class="tier-name" style="color:#6C9EE8">Standard</span>
            <span class="tier-price">$9/mo</span>
          </div>
          <div class="tier-opt" data-tier="pro" onclick="selectTier('pro')">
            <span class="tier-name" style="color:var(--teal)">Pro</span>
            <span class="tier-price">$19/mo</span>
          </div>
          <div class="tier-opt" data-tier="premium" onclick="selectTier('premium')">
            <span class="tier-name" style="color:var(--gold)">👑 Premium</span>
            <span class="tier-price">Custom</span>
          </div>
        </div>
      </div>

      <!-- Toggles -->
      <div class="toggles">
        <label class="toggle-item">
          <input type="checkbox" id="f-verified">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span class="toggle-label">✅ Verified</span>
        </label>
        <label class="toggle-item">
          <input type="checkbox" id="f-featured">
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span class="toggle-label">⭐ Featured</span>
        </label>
        <label class="toggle-item">
          <input type="checkbox" id="f-active" checked>
          <div class="toggle-track"><div class="toggle-knob"></div></div>
          <span class="toggle-label">Active</span>
        </label>
      </div>

      <!-- Core fields -->
      <div class="form-row">
        <label>Business Name *</label>
        <input type="text" id="f-name" placeholder="e.g. PiBonAn Restaurant">
      </div>
      <div class="form-row">
        <label>Description</label>
        <textarea id="f-description" placeholder="Short description shown in search results (required for Standard+)"></textarea>
      </div>
      <div class="form-2col">
        <div class="form-row">
          <label>Phone</label>
          <input type="text" id="f-phone" placeholder="(508) 559-2610">
        </div>
        <div class="form-row">
          <label>WhatsApp</label>
          <input type="text" id="f-whatsapp" placeholder="+15085592610">
        </div>
      </div>
      <div class="form-row">
        <label>Website</label>
        <input type="text" id="f-website" placeholder="pibonanrestaurant.com">
      </div>
      <div class="form-2col">
        <div class="form-row">
          <label>Address</label>
          <input type="text" id="f-address" placeholder="462 N Franklin St">
        </div>
        <div class="form-row">
          <label>City</label>
          <input type="text" id="f-city" placeholder="Holbrook">
        </div>
      </div>
      <div class="form-row">
        <label>Category</label>
        <select id="f-category"><option value="">— Select category —</option></select>
      </div>
      <div class="form-row">
        <label>Hours (stored in meta)</label>
        <input type="text" id="f-hours" placeholder="Mon closed · Tue–Sat 12–10PM · Sun 12–8PM">
      </div>
    </div>

    <div class="save-bar">
      <button class="btn btn-gold" onclick="save()" id="save-btn">Save changes</button>
      <button class="btn btn-red btn-sm" onclick="deactivate()" id="deactivate-btn">Deactivate</button>
      <span class="save-status" id="save-status">Saved ✓</span>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const SECRET = '${secret}';
const BASE   = '';  // same origin — served from Railway
let categories = [];
let currentPage = 0;
let totalCount  = 0;
let editingId   = null;
let searchTimer = null;

async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(BASE + path + sep + 'secret=' + encodeURIComponent(SECRET), {
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET },
    ...opts,
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || r.status); }
  return r.json();
}

let categoriesLoaded = false;

async function init() {
  await Promise.all([loadStats(), loadCategories()]);
  load();
}

async function loadStats() {
  try {
    const s = await api('/admin/directory/stats');
    document.getElementById('s-total').textContent    = s.total;
    document.getElementById('s-premium').textContent  = s.tiers.premium || 0;
    document.getElementById('s-pro').textContent      = s.tiers.pro     || 0;
    document.getElementById('s-standard').textContent = s.tiers.standard|| 0;
    document.getElementById('s-free').textContent     = s.tiers.free    || 0;
    document.getElementById('s-null').textContent     = s.nullCat;
    document.getElementById('s-null-wrap').style.display = s.nullCat > 0 ? '' : 'none';
  } catch {}
}

async function loadCategories() {
  try {
    categories = await api('/admin/directory/categories');
    const sel  = document.getElementById('filter-cat');
    const fSel = document.getElementById('f-category');
    categories.forEach(c => {
      sel.innerHTML  += \`<option value="\${c.id}">\${c.icon} \${c.name_en}</option>\`;
      fSel.innerHTML += \`<option value="\${c.id}">\${c.icon} \${c.name_en}</option>\`;
    });
  } catch {}
}

async function load() {
  const search = document.getElementById('search').value.trim();
  const cat    = document.getElementById('filter-cat').value;
  const tier   = document.getElementById('filter-tier').value;
  const status = document.getElementById('filter-status').value;

  let url = \`/admin/directory/data?page=\${currentPage}\`;
  if (search) url += '&search=' + encodeURIComponent(search);
  if (cat)    url += '&category=' + encodeURIComponent(cat);
  if (tier)   url += '&tier=' + encodeURIComponent(tier);
  // status filter
  if (status === 'inactive') url += '&status=inactive';

  try {
    const { businesses, total } = await api(url);
    totalCount = total;
    renderTable(businesses);
    renderPagination();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function renderTable(businesses) {
  const tbody = document.getElementById('biz-table');
  const empty = document.getElementById('empty');

  if (!businesses.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = businesses.map(b => {
    const tier = b.listing_tier || 'free';
    const cat  = b.service_categories;
    const catLabel = cat ? \`<span class="cat">\${cat.icon} \${cat.name_en}</span>\` : '<span class="cat" style="color:var(--red)">⚠️ None</span>';
    const tierBadge = \`<span class="tier tier-\${tier}">\${tierIcon(tier)}\${tier}</span>\`;
    const statusDot = \`<span class="dot dot-\${b.status === 'active' ? 'active' : 'inactive'}"></span>\`;

    return \`<tr onclick="openEdit('\${b.id}')">
      <td><span class="td-name">\${statusDot} \${b.name}</span></td>
      <td>\${catLabel}</td>
      <td>\${tierBadge}</td>
      <td class="td-city">\${b.city || '—'}</td>
      <td class="td-phone">\${b.phone || '—'}</td>
      <td><div class="td-actions"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEdit('\${b.id}')">Edit</button></div></td>
    </tr>\`;
  }).join('');
}

function tierIcon(t) {
  return t === 'premium' ? '👑 ' : t === 'pro' ? '🔥 ' : '';
}

function renderPagination() {
  const limit = 20;
  const pages = Math.ceil(totalCount / limit);
  document.getElementById('page-info').textContent =
    \`Page \${currentPage + 1} of \${Math.max(1, pages)} · \${totalCount} businesses\`;
  document.getElementById('btn-prev').disabled = currentPage === 0;
  document.getElementById('btn-next').disabled = currentPage >= pages - 1;
}

function prevPage() { if (currentPage > 0) { currentPage--; load(); } }
function nextPage() { currentPage++; load(); }

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentPage = 0; load(); }, 350);
}

// ── DRAWER ──
let _editData = null;

async function openEdit(id) {
  editingId = id;
  _editData = null;
  document.getElementById('drawer-title').textContent = 'Edit Business';
  document.getElementById('deactivate-btn').style.display = '';
  document.getElementById('save-btn').textContent = 'Save changes';
  fillForm(null); // clear form immediately
  openDrawer();

  // Fetch single business by ID — endpoint added in directory.js
  try {
    const b = await api('/admin/directory/business/' + id);
    _editData = b;
    fillForm(b);
  } catch (err) {
    toast('Could not load business: ' + err.message, 'error');
  }
}

function openAdd() {
  editingId = null;
  _editData = null;
  document.getElementById('drawer-title').textContent = 'Add Business';
  document.getElementById('deactivate-btn').style.display = 'none';
  document.getElementById('save-btn').textContent = 'Add business';
  fillForm(null);
  openDrawer();
}

function fillForm(b) {
  // Helper: set input/textarea/select value safely
  const v = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (val !== null && val !== undefined) ? val : '';
  };
  const c = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };

  if (!b) {
    // Clear all fields
    ['f-name','f-description','f-phone','f-whatsapp','f-website',
     'f-address','f-city','f-hours','f-category'].forEach(id => v(id, ''));
    c('f-verified', false); c('f-featured', false); c('f-active', true);
    selectTier('free');
    return;
  }

  v('f-name',        b.name);
  v('f-description', b.description);
  v('f-phone',       b.phone);
  v('f-whatsapp',    b.whatsapp);
  v('f-website',     b.website);
  v('f-address',     b.address);
  v('f-city',        b.city);
  v('f-hours',       b.meta?.hours);
  c('f-verified',    b.is_verified);
  c('f-featured',    b.is_featured);
  c('f-active',      b.status === 'active');
  selectTier(b.listing_tier || 'free');

  // Category select — set after a tick to ensure options are rendered
  const catEl = document.getElementById('f-category');
  if (catEl && b.category_id) {
    // Try immediately first
    catEl.value = b.category_id;
    // If it didn't take (options not ready), retry after tick
    if (catEl.value !== b.category_id) {
      setTimeout(() => { catEl.value = b.category_id; }, 50);
    }
  }
}

function selectTier(tier) {
  document.querySelectorAll('.tier-opt').forEach(el => {
    el.className = 'tier-opt';
    if (el.dataset.tier === tier) el.classList.add('sel-' + tier);
  });
}

function getSelectedTier() {
  const sel = document.querySelector('.tier-opt[class*="sel-"]');
  return sel ? sel.dataset.tier : 'free';
}

async function save() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('Business name is required', 'error'); return; }

  const btn = document.getElementById('save-btn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  const hours = document.getElementById('f-hours').value.trim();
  const existingMeta = _editData?.meta || {};
  const meta = hours ? { ...existingMeta, hours } : existingMeta;

  const payload = {
    name,
    description:  document.getElementById('f-description').value.trim() || null,
    phone:        document.getElementById('f-phone').value.trim()        || null,
    whatsapp:     document.getElementById('f-whatsapp').value.trim()     || null,
    website:      document.getElementById('f-website').value.trim()      || null,
    address:      document.getElementById('f-address').value.trim()      || null,
    city:         document.getElementById('f-city').value.trim()         || null,
    category_id:  document.getElementById('f-category').value            || null,
    listing_tier: getSelectedTier(),
    is_verified:  document.getElementById('f-verified').checked,
    is_featured:  document.getElementById('f-featured').checked,
    status:       document.getElementById('f-active').checked ? 'active' : 'inactive',
    meta,
  };

  try {
    if (editingId) {
      await api('/admin/directory/business/' + editingId, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast('Saved ✓', 'success');
    } else {
      await api('/admin/directory/business', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast('Business added ✓', 'success');
      closeDrawer();
    }
    load();
    loadStats();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    btn.textContent = editingId ? 'Save changes' : 'Add business';
    btn.disabled = false;
  }
}

async function deactivate() {
  if (!editingId) return;
  if (!confirm('Deactivate this business? It will no longer appear in searches.')) return;
  try {
    await api('/admin/directory/business/' + editingId, { method: 'DELETE' });
    toast('Deactivated', 'success');
    closeDrawer();
    load();
    loadStats();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function openDrawer() {
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  editingId = null;
  _editData = null;
}

document.getElementById('drawer-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeDrawer();
});

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

init();
</script>
</body>
</html>`;
}

module.exports = router;
