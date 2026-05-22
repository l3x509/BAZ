// ============================================================
// BAZ — CATEGORY SYNC
// Runs automatically as a prestart script before server.js.
// Upserts service_categories + vitrin_categories from categories.js.
//
// Called by npm via package.json:
//   "prestart": "node scripts/sync-categories.js"
//
// SAFE TO FAIL: if Supabase is unreachable or the key is wrong,
// this logs a warning and exits 0 so the server still starts.
// Categories in the DB stay as-is until the next successful sync.
// ============================================================

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient }                                         = require('@supabase/supabase-js');
const { categories, serviceCategories, productCategories }     = require('../config/categories');

// ── GUARD: skip silently if credentials are missing ──────────
// Prevents crashes in environments where Supabase isn't configured
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[sync-categories] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — skipping sync');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── ROW BUILDERS ─────────────────────────────────────────────

const toRow = cat => ({
  slug:       cat.slug,
  name_en:    cat.name.en,
  name_ht:    cat.name.ht,
  name_fr:    cat.name.fr,
  icon:       cat.icon,
  sort_order: cat.sort_order,
  is_active:  cat.is_active,
});

// ── SYNC ONE TABLE ────────────────────────────────────────────

async function syncTable(tableName, rows) {
  const { error } = await supabase
    .from(tableName)
    .upsert(rows.map(toRow), { onConflict: 'slug' });

  if (error) throw new Error(`${tableName}: ${error.message}`);
  return rows.length;
}

// ── MAIN ─────────────────────────────────────────────────────

async function sync() {
  console.log(`[sync-categories] Syncing ${categories.length} categories...`);

  const serviceRows = serviceCategories();
  const vitrinRows  = productCategories();

  const sCount = await syncTable('service_categories', serviceRows);
  const vCount = await syncTable('vitrin_categories',  vitrinRows);

  console.log(`[sync-categories] ✓ service_categories: ${sCount} rows`);
  console.log(`[sync-categories] ✓ vitrin_categories: ${vCount} rows`);
  console.log(`[sync-categories] Done.`);
}

sync().catch(err => {
  // Log but never crash — server must start regardless
  console.warn('[sync-categories] ⚠️  Sync failed (server will still start):', err.message);
  process.exit(0);
});
