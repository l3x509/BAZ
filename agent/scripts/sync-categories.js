// ============================================================
// BAZ — CATEGORY SYNC SCRIPT
// Upserts categories.js into Supabase service_categories table.
//
// Run this whenever you add or change a category:
//   node agent/scripts/sync-categories.js
//
// Safe to run multiple times — uses upsert on slug.
// ============================================================

require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');
const { categories } = require('../config/categories');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // use service key, not anon — bypasses RLS
);

async function syncCategories() {
  console.log(`\n🔄 Syncing ${categories.length} categories to Supabase...\n`);

  let synced = 0;
  let failed = 0;

  for (const cat of categories) {
    const row = {
      slug:       cat.slug,
      name_en:    cat.name.en,
      name_ht:    cat.name.ht,
      name_fr:    cat.name.fr,
      icon:       cat.icon,
      sort_order: cat.sort_order,
      is_active:  cat.is_active,
    };

    const { error } = await supabase
      .from('service_categories')
      .upsert(row, { onConflict: 'slug' });

    if (error) {
      console.error(`  ✗ ${cat.slug}: ${error.message}`);
      failed++;
    } else {
      console.log(`  ✓ ${cat.slug} — ${cat.name.en} / ${cat.name.ht} / ${cat.name.fr}`);
      synced++;
    }
  }

  console.log(`\n${synced} synced, ${failed} failed.\n`);

  if (failed > 0) {
    console.error('⚠️  Some categories failed. Check SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env\n');
    process.exit(1);
  } else {
    console.log('✅ All categories in sync.\n');
  }
}

syncCategories();
