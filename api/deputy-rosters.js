const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DEPUTY_TOKEN  = 'cf73b1628a5e3498d713879bcf07a974';

// Cache TTL: 5 minutes for today (roster changes like sick leave must reflect quickly),
// 30 minutes for future dates — short enough that if a roster is published/updated
// it will be live within half an hour without waiting until the next 6am prefetch.
const CACHE_TTL_TODAY_MS  = 5 * 60 * 1000;        // 5 minutes
const CACHE_TTL_FUTURE_MS = 30 * 60 * 1000;        // 30 minutes

function getTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date, unitIds, force } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const unitSet = new Set(Array.isArray(unitIds) ? unitIds : []);

  // ── 1. Try Supabase cache (skipped when force=true) ─────────────────────
  let allRosters = null;
  if (!force) try {
    const cacheRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deputy_roster_cache?date=eq.${date}&select=rosters,fetched_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (cacheRes.ok) {
      const rows = await cacheRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const age = Date.now() - new Date(rows[0].fetched_at).getTime();
        const isToday = date === getTodayUtc();
        const ttl = isToday ? CACHE_TTL_TODAY_MS : CACHE_TTL_FUTURE_MS;
        if (age < ttl) {
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

  // ── 4. Convert unix timestamps to HH:MM (Sydney) and dedup split shifts ──
  const unixToHHMM = (t) => {
    if (!t) return '';
    const num = typeof t === 'string' ? parseInt(t, 10) : t;
    if (isNaN(num) || num <= 100000) return String(t ?? '');
    const d = new Date(num * 1000);
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }).slice(0, 5);
  };
  const toMins = (hhmm) => {
    if (!hhmm) return 0;
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const SPLIT_GAP_MINS = 120; // 2 hours

  // Map to clean objects with HH:MM times
  const mapped = filtered
    .filter(r => r.Employee && r.Employee !== 0)
    .map(r => ({
      Employee:         r.Employee,
      OperationalUnit:  r.OperationalUnit,
      StartTime:        unixToHHMM(r.StartTime),
      EndTime:          unixToHHMM(r.EndTime),
      _DPMetaData:      r._DPMetaData,
      Comment:          r.Comment,
      Open:             r.Open,
    }));

  // Group by employee and detect split shifts
  const groupedByEmp = new Map();
  for (const entry of mapped) {
    const group = groupedByEmp.get(entry.Employee) ?? [];
    group.push(entry);
    groupedByEmp.set(entry.Employee, group);
  }

  const deduped = [];
  for (const [, entries] of groupedByEmp) {
    if (entries.length === 1) { deduped.push(entries[0]); continue; }
    const sorted = [...entries].sort((a, b) => String(a.StartTime).localeCompare(String(b.StartTime)));
    let isSplit = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = toMins(sorted[i + 1].StartTime) - toMins(sorted[i].EndTime);
      if (gap >= SPLIT_GAP_MINS) { isSplit = true; break; }
    }
    if (isSplit) {
      // One merged entry: earliest start, latest end, isSplitShift=true, splitSegments for display
      // Study Time / non-ratio segments are included in raw sorted but we use the float segments for times
      const first = sorted[0];
      const last  = sorted[sorted.length - 1];
      deduped.push({
        ...first,
        StartTime:     first.StartTime,
        EndTime:       last.EndTime,
        isSplitShift:  true,
        splitSegments: sorted.map(s => ({ StartTime: s.StartTime, EndTime: s.EndTime })),
      });
    } else {
      // Not split — merge into one (earliest start, latest end)
      const first = sorted[0];
      const last  = sorted[sorted.length - 1];
      deduped.push({ ...first, StartTime: first.StartTime, EndTime: last.EndTime });
    }
  }

  res.status(200).json(deduped);
}
