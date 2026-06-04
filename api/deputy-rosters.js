const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DEPUTY_TOKEN  = 'cf73b1628a5e3498d713879bcf07a974';

// Cache is considered fresh for 4 hours.
// The Tuesday prefetch job writes the full next week upfront so directors
// always get fast responses when browsing ahead.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date, unitIds } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const unitSet = new Set(Array.isArray(unitIds) ? unitIds : []);

  // ── 1. Try Supabase cache ────────────────────────────────────────────────
  let allRosters = null;
  try {
    const cacheRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deputy_roster_cache?date=eq.${date}&select=rosters,fetched_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (cacheRes.ok) {
      const rows = await cacheRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const age = Date.now() - new Date(rows[0].fetched_at).getTime();
        if (age < CACHE_TTL_MS) {
          allRosters = rows[0].rosters; // cache hit ✓
        }
      }
    }
  } catch {
    // Non-fatal — fall through to Deputy
  }

  // ── 2. Cache miss: fetch live from Deputy ────────────────────────────────
  if (!allRosters) {
    const PAGE  = 500;
    allRosters  = [];
    let start   = 1;

    // NOTE: Deputy's OperationalUnit 'in' filter silently drops records for
    // some units (known API quirk). We query by date only and filter on our
    // side — this is reliable. Never revert to server-side unit filtering.
    while (true) {
      const response = await fetch(
        'https://thegroveacademy.au.deputy.com/api/v1/resource/Roster/QUERY',
        {
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
        }
      );

      const page = await response.json();
      if (!Array.isArray(page) || page.length === 0) break;
      allRosters.push(...page);
      if (page.length < PAGE) break;
      start += PAGE;
    }

    // Write result to Supabase cache (non-blocking, best-effort)
    fetch(`${SUPABASE_URL}/rest/v1/deputy_roster_cache`, {
      method: 'POST',
      headers: {
        apikey:         SERVICE_KEY,
        Authorization:  `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        date,
        rosters:    allRosters,
        fetched_at: new Date().toISOString(),
      }),
    }).catch(() => {}); // ignore write errors
  }

  // ── 3. Filter to requested unit IDs (client-side, same as before) ────────
  const filtered = unitSet.size > 0
    ? allRosters.filter(r => unitSet.has(r.OperationalUnit))
    : allRosters;

  res.status(200).json(filtered);
}
