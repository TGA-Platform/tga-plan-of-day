/**
 * cron-roster-refresh.js
 *
 * Vercel cron job — runs every 5 minutes (see vercel.json).
 *
 * Fetches ALL of today's Deputy rosters (no unit filter — catches every centre)
 * and writes them to the Supabase deputy_roster_cache table with fetched_at = now.
 *
 * The existing /api/deputy-rosters handler reads from this cache first (TTL 5 min
 * for today). With this cron running every 5 minutes, the cache is always fresh:
 * - New starters, sick day removals, shift swaps → reflected within 5 minutes
 * - Works even if nobody has the Plan of Day open at a centre
 *
 * Auth: Vercel sends Authorization: Bearer <CRON_SECRET> on cron invocations.
 * Set CRON_SECRET as a Vercel environment variable.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbG…6f1c';
const DEPUTY_TOKEN = 'cf73b1…a974';
const CRON_SECRET  = process.env.CRON_SECRET ?? '';

function getTodaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

async function fetchAllRostersFromDeputy(date) {
  const PAGE = 500;
  const all  = [];
  let start  = 1;
  while (true) {
    const res = await fetch(
      'https://thegroveacademy.au.deputy.com/api/v1/resource/Roster/QUERY',
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${DEPUTY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max: PAGE, start,
          search: { s1: { field: 'Date', type: 'eq', data: date } },
        }),
      }
    );
    if (!res.ok) throw new Error(`Deputy ${res.status}: ${await res.text()}`);
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE) break;
    start += PAGE;
  }
  return all;
}

async function writeToSupabaseCache(date, rosters) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/deputy_roster_cache`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=merge-duplicates',
    },
    body: JSON.stringify({ date, rosters, fetched_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
}

export default async function handler(req, res) {
  // Verify cron secret (Vercel injects this automatically for cron routes)
  const auth = (req.headers['authorization'] ?? '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date = getTodaySydney();
  const t0   = Date.now();

  try {
    const rosters = await fetchAllRostersFromDeputy(date);
    await writeToSupabaseCache(date, rosters);
    const ms = Date.now() - t0;
    console.log(`[cron-roster-refresh] ${date}: ${rosters.length} rosters, ${ms}ms`);
    return res.status(200).json({ ok: true, date, count: rosters.length, ms });
  } catch (err) {
    console.error('[cron-roster-refresh] FAILED:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
