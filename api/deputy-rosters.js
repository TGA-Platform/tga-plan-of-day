const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DEPUTY_TOKEN  = 'cf73b1628a5e3498d713879bcf07a974';

// Cache TTL: 5 minutes for all dates so roster changes (sick leave, swaps,
// newly published shifts) reflect quickly whether planning today or future dates.
const CACHE_TTL_TODAY_MS  = 5 * 60 * 1000;  // 5 minutes
const CACHE_TTL_FUTURE_MS = 5 * 60 * 1000;  // 5 minutes

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
    // NOTE: resource/Roster/QUERY silently omits some shifts that are visible
    // in Deputy's "Week by Area" view. The supervise/roster/{date} endpoint
    // returns the complete roster, so we use that and filter client-side.
    const response = await fetch(
      `https://thegroveacademy.au.deputy.com/api/v1/supervise/roster/${date}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${DEPUTY_TOKEN}` },
      }
    );

    const page = await response.json();
    allRosters = Array.isArray(page) ? page : [];

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

  // ── 3. Filter to requested unit IDs (client-side, same as before)
  //    Always keep any employee referenced in float_schedules so cover staff
  //    rostered under non-ratio units (e.g. Assistant Director) still appear.
  const filtered = unitSet.size > 0
    ? allRosters.filter(r => unitSet.has(r.OperationalUnit) || floatEmployeeIds.has(r.Employee))
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

  const isNonRatio = (e) => {
    const uName = (e._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '').toLowerCase();
    return uName.includes('study time') || uName.includes('staff meeting');
  };

  const deduped = [];
  for (const [, entries] of groupedByEmp) {
    if (entries.length === 1) { deduped.push(entries[0]); continue; }

    const ratioEntries = entries.filter(e => !isNonRatio(e));
    const nonRatioEntries = entries.filter(e => isNonRatio(e));

    // No ratio entries (e.g., Director/Admin with only meetings) — never split.
    if (ratioEntries.length === 0) {
      const sorted = [...entries].sort((a, b) => String(a.StartTime).localeCompare(String(b.StartTime)));
      deduped.push({ ...sorted[0], StartTime: sorted[0].StartTime, EndTime: sorted[sorted.length - 1].EndTime });
      continue;
    }

    // Split-shift detection must only look at ratio entries.
    // A staff meeting after a room shift should NOT mark someone as split.
    const sortedRatio = [...ratioEntries].sort((a, b) => String(a.StartTime).localeCompare(String(b.StartTime)));
    let isSplit = false;
    for (let i = 0; i < sortedRatio.length - 1; i++) {
      const gap = toMins(sortedRatio[i + 1].StartTime) - toMins(sortedRatio[i].EndTime);
      if (gap >= SPLIT_GAP_MINS) { isSplit = true; break; }
    }

    if (isSplit) {
      // Split shift: keep each segment as a separate entry so the ratio check
      // slot filter shows staff only when they are actually on shift.
      // Mark all segments with isSplitShift=true so the dashboard routes them
      // to Support and shows the Plan Day button.
      const allSegments = sortedRatio.map(s => ({ StartTime: s.StartTime, EndTime: s.EndTime }));
      for (const seg of sortedRatio) {
        deduped.push({ ...seg, isSplitShift: true, splitSegments: allSegments });
      }
    } else {
      // Not split — merge ratio entries into one (earliest start, latest end).
      // Also merge in any overlapping/adjacent non-ratio entries (e.g., study
      // time just before a room shift) so the staff member appears in the
      // correct room for the full span.
      let mergedStart = sortedRatio[0].StartTime;
      let mergedEnd   = sortedRatio[sortedRatio.length - 1].EndTime;
      const mergedStartM = toMins(mergedStart);
      const mergedEndM   = toMins(mergedEnd);

      for (const nr of nonRatioEntries) {
        const nrStartM = toMins(nr.StartTime);
        const nrEndM   = toMins(nr.EndTime);
        if (nrStartM <= mergedEndM && nrEndM >= mergedStartM) {
          if (nrStartM < mergedStartM) mergedStart = nr.StartTime;
          if (nrEndM > mergedEndM) mergedEnd = nr.EndTime;
        }
      }

      deduped.push({ ...sortedRatio[0], StartTime: mergedStart, EndTime: mergedEnd });
    }
  }

  res.status(200).json(deduped);
}
