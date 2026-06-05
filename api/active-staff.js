/**
 * /api/active-staff
 * GET /api/active-staff?from=YYYY-MM-DD&to=YYYY-MM-DD&unitIds=1,2,3
 *
 * Returns unique Deputy employee display names who appear in the roster cache
 * for the given date range and unit IDs. Uses SERVICE_KEY to bypass RLS.
 *
 * Used by the WWCC Expiry report to filter to staff active in Deputy that week.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { from, to, unitIds } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });

  const unitSet = unitIds
    ? new Set(String(unitIds).split(',').map(n => parseInt(n, 10)).filter(Boolean))
    : null;

  // Generate all weekday dates in range
  const dates = [];
  let cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to   + 'T00:00:00Z');
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  if (dates.length === 0) return res.status(200).json([]);

  // Fetch all roster cache entries for those dates
  const inList = dates.map(d => `"${d}"`).join(',');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/deputy_roster_cache?date=in.(${encodeURIComponent(inList)})&select=rosters`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );

  if (!r.ok) return res.status(500).json({ error: `Supabase error ${r.status}` });

  const rows = await r.json();
  const names = new Set();

  for (const row of rows) {
    for (const entry of (row.rosters || [])) {
      // Filter to requested unit IDs if provided
      if (unitSet && !unitSet.has(entry.OperationalUnit)) continue;
      const name = entry._DPMetaData?.EmployeeInfo?.DisplayName;
      if (name) names.add(name);
    }
  }

  res.status(200).json([...names]);
}
