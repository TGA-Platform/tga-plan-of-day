/**
 * prefetch-weekly-rosters.js
 *
 * Pre-fetches the following week's roster data from Deputy and stores it in
 * the Supabase deputy_roster_cache table so directors can browse next week
 * without waiting on live Deputy API calls.
 *
 * Scheduled: every Tuesday at 6:00 AM AEST via OpenClaw cron.
 * Manual run: node scripts/prefetch-weekly-rosters.js [--week +1|+2|YYYY-MM-DD]
 *
 * Examples:
 *   node scripts/prefetch-weekly-rosters.js            # next week (default)
 *   node scripts/prefetch-weekly-rosters.js --week +2  # week after next
 *   node scripts/prefetch-weekly-rosters.js --week 2026-06-09  # specific Monday
 */

const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DEPUTY_TOKEN  = 'cf73b1628a5e3498d713879bcf07a974';
const DEPUTY_HOST   = 'https://thegroveacademy.au.deputy.com';
const PROJECT_REF   = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD   = '!b2TOWN7ksPto1pZ';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return YYYY-MM-DD for a Date */
function fmt(d) {
  return d.toISOString().slice(0, 10);
}

/** Return the Monday of the week that contains `d` */
function monday(d) {
  const day = d.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const m = new Date(d);
  m.setDate(m.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

/** Parse --week argument: "+1" (next week), "+2" (week after), or "YYYY-MM-DD" */
function resolveWeekStart() {
  const idx = process.argv.indexOf('--week');
  const arg = idx !== -1 ? process.argv[idx + 1] : '+1';
  if (!arg || arg.startsWith('--')) return monday(new Date(Date.now() + 7 * 86400000));

  if (/^\+\d+$/.test(arg)) {
    const weeks = parseInt(arg.slice(1));
    return monday(new Date(Date.now() + weeks * 7 * 86400000));
  }
  // Specific date supplied — find its Monday
  return monday(new Date(arg));
}

// ── Deputy fetch ─────────────────────────────────────────────────────────────

async function fetchDeputyRostersForDate(date) {
  const PAGE = 500;
  const all  = [];
  let start  = 1;

  while (true) {
    const res = await fetch(`${DEPUTY_HOST}/api/v1/resource/Roster/QUERY`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEPUTY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max:    PAGE,
        start,
        search: { s1: { field: 'Date', type: 'eq', data: date } },
      }),
    });

    if (!res.ok) {
      console.error(`  Deputy error ${res.status} for ${date}`);
      break;
    }

    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE) break;
    start += PAGE;
  }

  return all;
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertCache(date, rosters) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/deputy_roster_cache`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      date,
      rosters,
      fetched_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed (${res.status}): ${body}`);
  }
}

// ── Ensure table exists ─────────────────────────────────────────────────────

async function ensureTable() {
  // Check if table exists via REST
  const check = await fetch(`${SUPABASE_URL}/rest/v1/deputy_roster_cache?limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (check.ok) return; // already exists

  console.log('  Table deputy_roster_cache not found — creating via pg ...');

  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');

  const SQL = `
    CREATE TABLE IF NOT EXISTS deputy_roster_cache (
      date        DATE        NOT NULL PRIMARY KEY,
      rosters     JSONB       NOT NULL DEFAULT '[]',
      fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS deputy_roster_cache_fetched_idx
      ON deputy_roster_cache (date, fetched_at DESC);
    ALTER TABLE deputy_roster_cache ENABLE ROW LEVEL SECURITY;
    DO $body$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='deputy_roster_cache' AND policyname='service role all') THEN
        CREATE POLICY "service role all" ON deputy_roster_cache USING (true) WITH CHECK (true);
      END IF;
    END $body$;
  `;

  const configs = [
    {
      connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
    },
    {
      host: `db.${PROJECT_REF}.supabase.co`, port: 5432, database: 'postgres',
      user: 'postgres', password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    },
  ];

  for (const cfg of configs) {
    const client = new Client(cfg);
    try {
      await client.connect();
      await client.query(SQL);
      await client.end();
      console.log('  ✓ Table created.');
      return;
    } catch (err) {
      try { await client.end(); } catch {}
      // Network may not be reachable from this host — print SQL for manual run
    }
  }
  console.warn(`
  ⚠️  Could not create table automatically.
  Please run this SQL in the Supabase dashboard:
  https://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/editor

${SQL}
  Then re-run this script.
`);
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const weekStart = resolveWeekStart();
  const dates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return fmt(d);
  });

  console.log(`\n📅 Prefetching Deputy rosters for week: ${dates[0]} – ${dates[4]}\n`);
  await ensureTable();

  let totalRecords = 0;

  for (const date of dates) {
    process.stdout.write(`  ${date} … `);
    try {
      const rosters = await fetchDeputyRostersForDate(date);
      await upsertCache(date, rosters);
      console.log(`✓ ${rosters.length} records cached`);
      totalRecords += rosters.length;
    } catch (err) {
      console.error(`✗ ${err.message}`);
    }
  }

  console.log(`\n✅ Done — ${totalRecords} records across ${dates.length} days cached in Supabase.\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
