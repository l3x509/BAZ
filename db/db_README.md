# BAZ — Database

## Structure

```
db/
├── schema.sql              ← FULL schema — source of truth
├── seeds/
│   └── businesses.sql      ← 136 Boston Haitian businesses
└── migrations/
    ├── 001_initial.sql     ← original schema (run at launch)
    ├── 002_categories.sql  ← category system
    ├── 003_recategorize.sql ← business category assignments
    └── 004_events_and_analytics.sql ← TODAY (events + impressions)
```

## Rules

1. **Never edit a migration after it's been run.** Add a new one instead.
2. **schema.sql is always current.** After running a migration, update schema.sql to match.
3. **seeds/ is data, not schema.** Re-runnable anytime.
4. **Run migrations in order.** 001 → 002 → 003 → 004...

## Running a migration

1. Open Supabase → SQL Editor
2. Paste the migration file
3. Run it
4. Commit the file to GitHub (it's now the record that it was applied)

## Starting fresh

```sql
-- Drop everything and rebuild from scratch:
-- 1. Run schema.sql
-- 2. Run seeds/businesses.sql
-- Done.
```

## Pending (from this sprint — run 004 first)

```sql
-- If you had a TwinZile 'events' table, rename it first:
ALTER TABLE events RENAME TO twinzile_logs;
-- Then run 004_events_and_analytics.sql
```
