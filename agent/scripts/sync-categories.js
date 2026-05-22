// ============================================================
// BAZ — CATEGORY SYNC SCRIPT
// Single source of truth: agent/config/categories.js
//
// Syncs to TWO Supabase tables:
//   service_categories → service + hybrid categories (Baz directory)
//   vitrin_categories  → product + hybrid categories (Vitrin marketplace)
//
// Run this whenever you add, remove, or edit a category:
//   node agent/scripts/sync-categories.js
//
// Safe to run multiple times — uses upsert on slug.
// Deactivated categories (is_active: false) are preserved in DB
// but won't appear in agent results or the website.
// ============================================================

require('dotenv').config({ path: '../.env' });
const { createClient }                            = require('@supabase/supabase-js');
const { categories, serviceCategories, productCategories } = require('../config/categories');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key bypasses RLS
);

// ── HELPERS ──────────────────────────────────────────────────

function toServiceRow(cat) {
  return {
    slug:       cat.slug,
    name_en:    cat.name.en,
    name_ht:    cat.name.ht,
    name_fr:    cat.name.fr,
    icon:       cat.icon,
    sort_order: cat.sort_order,
    is_active:  cat.is_active,
  };
}

function toVitrinRow(cat) {
  return {
    slug:       cat.slug,
    name_en:    cat.name.en,
    name_ht:    cat.name.ht,
    name_fr:    cat.name.fr,
    icon:       cat.icon,
    sort_order: cat.sort_order,
    is_active:  cat.is_active,
  };
}

async function syncTable(tableName, rows) {
  console.log(`\n  Syncing ${rows.length} rows → ${tableName}`);

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const { error } = await supabase
      .from(tableName)
      .upsert(row, { onConflict: 'slug' });

    if (error) {
      console.error(`    ✗ ${row.slug}: ${error.message}`);
      failed++;
    } else {
      const status = row.is_active ? '✓' : '○';
      console.log(`    ${status} ${row.slug} — ${row.name_en} / ${row.name_ht}`);
      synced++;
    }
  }

  return { synced, failed };
}

// ── MAIN ─────────────────────────────────────────────────────

async function sync() {
  console.log('\n════════════════════════════════════════');
  console.log('  BAZ CATEGORY SYNC');
  console.log(`  Source: agent/config/categories.js`);
  console.log(`  Total categories: ${categories.length}`);
  console.log('════════════════════════════════════════');

  // ── service_categories (Baz directory)
  // Includes: type=service + type=hybrid
  console.log('\n📂 service_categories (Baz directory):');
  const serviceRows = serviceCategories().map(toServiceRow);
  const s = await syncTable('service_categories', serviceRows);

  // ── vitrin_categories (Vitrin marketplace)
  // Includes: type=product + type=hybrid
  console.log('\n🛍️  vitrin_categories (Vitrin marketplace):');
  const vitrinRows = productCategories().map(toVitrinRow);
  const v = await syncTable('vitrin_categories', vitrinRows);

  // ── Summary
  const totalSynced = s.synced + v.synced;
  const totalFailed = s.failed + v.failed;

  console.log('\n════════════════════════════════════════');
  console.log(`  service_categories: ${s.synced} synced, ${s.failed} failed`);
  console.log(`  vitrin_categories:  ${v.synced} synced, ${v.failed} failed`);
  console.log(`  Total: ${totalSynced} synced, ${totalFailed} failed`);
  console.log('════════════════════════════════════════\n');

  if (totalFailed > 0) {
    console.error('⚠️  Some rows failed. Check SUPABASE_URL and SUPABASE_SERVICE_KEY in .env\n');
    process.exit(1);
  } else {
    console.log('✅ All categories in sync.\n');
  }
}

sync();
