/**
 * Shared helper: fetch Deputy actual timesheets and persist them to Supabase.
 *
 * This is used by:
 *   - /api/deputy-timesheets-actual (live endpoint for RatioCheckPanel)
 *   - /api/cron-reporting-snapshot  (hourly snapshot cron)
 *
 * The table is deleted+inserted per (date, unit_id) so it always reflects the
 * latest clock-in/out state. We still return live data to callers so the
 * Ratio Check panel never serves stale cached actuals.
 */

const DEPUTY_TOKEN = process.env.DEPUTY_API_TOKEN || 'cf73b1628a5e3498d713879bcf07a974';
const DEPUTY_BASE  = 'https://thegroveacademy.au.deputy.com';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const SB_HEADERS = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

function unixToHHMM(unix) {
  if (!unix || unix <= 0) return null;
  const d = new Date(unix * 1000);
  const sydney = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return `${String(sydney.getHours()).padStart(2,'0')}:${String(sydney.getMinutes()).padStart(2,'0')}`;
}

function parseBreakState(strState) {
  if (!strState) return 'scheduled';
  const s = strState.toLowerCase();
  if (s.includes('finished')) return 'finished';
  if (s.includes('progress') || s.includes('started')) return 'in_progress';
  return 'scheduled';
}

/**
 * Fetch actual timesheets from Deputy for the given unit IDs and date.
 * Returns normalized records and optionally persists them to Supabase.
 *
 * @param {number[]} unitIds
 * @param {string}   date       YYYY-MM-DD
 * @param {object}   opts
 * @param {boolean}  opts.persist  write to deputy_actual_timesheets (default true)
 * @returns {Promise<Array>} normalized actual timesheet records
 */
export async function fetchActualTimesheets(unitIds, date, opts = {}) {
  const { persist = true } = opts;
  const unitIdSet = new Set((unitIds || []).map(Number).filter(Boolean));
  if (unitIdSet.size === 0 || !date) return [];

  const response = await fetch(`${DEPUTY_BASE}/api/v1/resource/Timesheet/QUERY`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEPUTY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      max: 500,
      search: {
        s1: { field: 'Date', type: 'eq', data: date },
        s2: { field: 'IsLeave', type: 'eq', data: false },
      },
      join: ['EmployeeObject', 'OperationalUnitObject'],
    }),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Deputy API error: ${response.status} ${txt}`);
  }

  const raw = await response.json();
  const timesheets = Array.isArray(raw) ? raw : (raw?.value ?? []);

  const results = [];
  for (const ts of timesheets) {
    const unitId = ts.OperationalUnit;
    if (!unitIdSet.has(unitId)) continue;

    const empId    = ts.Employee;
    const empName  = ts._DPMetaData?.EmployeeInfo?.DisplayName ?? `Staff #${empId}`;
    const unitName = ts._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '';

    const shiftStartUnix = ts.StartTime || 0;
    const shiftHasStarted = shiftStartUnix > 0 && (shiftStartUnix * 1000) <= Date.now();
    const hasActualTimes = ts.RealTime || (shiftHasStarted && ts.StartTimeLocalized && ts.EndTimeLocalized);
    const actualStart = hasActualTimes && ts.StartTimeLocalized
      ? ts.StartTimeLocalized.substring(11, 16)
      : null;
    const actualEnd = hasActualTimes && !ts.IsInProgress && ts.EndTimeLocalized
      ? ts.EndTimeLocalized.substring(11, 16)
      : null;

    const breaks = [];
    const slots = Array.isArray(ts.Slots) ? ts.Slots : [];
    for (const slot of slots) {
      if (slot.strType !== 'B') continue;
      const breakType = slot.mixedActivity?.strBreakType === 'M' ? 'meal' : 'other';
      const status = parseBreakState(slot.strState);
      const intState = slot.mixedActivity?.intState;
      if (intState !== 4 && intState !== 2) continue;

      const breakStartUnix = slot.intUnixStart || 0;
      if (breakStartUnix > 0 && (breakStartUnix * 1000) > Date.now()) continue;
      if (breakStartUnix > 0 && shiftStartUnix > 0) {
        const diffMins = (breakStartUnix - shiftStartUnix) / 60;
        if (diffMins < 30) continue;
      }

      const breakStart = breakStartUnix ? unixToHHMM(breakStartUnix) : null;
      const breakEnd   = (status === 'finished' && slot.intUnixEnd) ? unixToHHMM(slot.intUnixEnd) : null;
      breaks.push({ breakStart, breakEnd, type: breakType, status });
    }

    results.push({
      employeeId:    empId,
      employeeName:  empName,
      unitId,
      unitName,
      actualStart,
      actualEnd,
      isInProgress:  !!ts.IsInProgress,
      isRealTime:    !!ts.RealTime,
      rosteredStart: unixToHHMM(ts.StartTime),
      rosteredEnd:   unixToHHMM(ts.EndTime),
      breaks,
    });
  }

  if (persist && results.length > 0) {
    try {
      await persistActualTimesheets(date, [...unitIdSet], results);
    } catch (err) {
      // Persistence is best-effort; never break the live response.
      console.error('[actual-timesheets] persist failed:', err.message);
    }
  }

  return results;
}

async function persistActualTimesheets(date, unitIds, records) {
  // Delete existing records for this date + these unit IDs, then insert fresh.
  // PostgREST supports `in.` for bulk delete.
  const inClause = unitIds.map(id => encodeURIComponent(id)).join(',');
  const deleteUrl = `${SUPABASE_URL}/rest/v1/deputy_actual_timesheets?date=eq.${date}&unit_id=in.(${inClause})`;
  const del = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: SB_HEADERS,
  });
  if (!del.ok) {
    const txt = await del.text().catch(() => '');
    throw new Error(`delete failed: ${del.status} ${txt}`);
  }

  const rows = records.map(r => ({
    employee_id:    r.employeeId,
    employee_name:  r.employeeName,
    unit_id:        r.unitId,
    unit_name:      r.unitName,
    date,
    actual_start:   r.actualStart,
    actual_end:     r.actualEnd,
    is_in_progress: r.isInProgress,
    is_real_time:   r.isRealTime,
    rostered_start: r.rosteredStart,
    rostered_end:   r.rosteredEnd,
    breaks:         r.breaks,
    fetched_at:     new Date().toISOString(),
  }));

  const insertUrl = `${SUPABASE_URL}/rest/v1/deputy_actual_timesheets`;
  const ins = await fetch(insertUrl, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify(rows),
  });
  if (!ins.ok) {
    const txt = await ins.text().catch(() => '');
    throw new Error(`insert failed: ${ins.status} ${txt}`);
  }
}

/**
 * Read persisted actual timesheets from Supabase for a set of unit IDs on a date.
 * Returns them in the same shape as fetchActualTimesheets.
 */
export async function readActualTimesheets(unitIds, date) {
  const unitIdSet = new Set((unitIds || []).map(Number).filter(Boolean));
  if (unitIdSet.size === 0 || !date) return [];
  const inClause = [...unitIdSet].map(id => encodeURIComponent(id)).join(',');
  const url = `${SUPABASE_URL}/rest/v1/deputy_actual_timesheets?date=eq.${date}&unit_id=in.(${inClause})&select=*`;
  const r = await fetch(url, { headers: SB_HEADERS });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.error('[actual-timesheets] read failed:', r.status, txt);
    return [];
  }
  const rows = await r.json();
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    employeeId:    row.employee_id,
    employeeName:  row.employee_name,
    unitId:        row.unit_id,
    unitName:      row.unit_name,
    actualStart:   row.actual_start,
    actualEnd:     row.actual_end,
    isInProgress:  row.is_in_progress,
    isRealTime:    row.is_real_time,
    rosteredStart: row.rostered_start,
    rosteredEnd:   row.rostered_end,
    breaks:        row.breaks || [],
    fetchedAt:     row.fetched_at,
  }));
}
