/**
 * /api/deputy-timesheets-actual
 * 
 * Fetches actual Deputy timesheet data (clock-in/out + meal breaks) for a centre + date.
 * Used by RatioCheckPanel to overlay actual times over rostered times.
 * 
 * Query params:
 *   unitIds  - comma-separated Deputy operational unit IDs for the centre
 *   date     - YYYY-MM-DD
 * 
 * Response: array of ActualTimesheet:
 * {
 *   employeeId:    number,
 *   employeeName:  string,
 *   unitId:        number,
 *   unitName:      string,
 *   actualStart:   string | null,   // HH:MM actual clock-in (null if not clocked in yet)
 *   actualEnd:     string | null,   // HH:MM actual clock-out (null if still in progress)
 *   isInProgress:  boolean,
 *   isRealTime:    boolean,         // true = actual clock, false = auto-generated
 *   breaks: [{
 *     breakStart:  string | null,   // HH:MM
 *     breakEnd:    string | null,   // HH:MM
 *     type:        'meal' | 'other',
 *     status:      'finished' | 'in_progress' | 'scheduled',
 *   }]
 * }
 */

const DEPUTY_TOKEN = 'Bearer cf73b1628a5e3498d713879bcf07a974';
const DEPUTY_BASE  = 'https://thegroveacademy.au.deputy.com';

function unixToHHMM(unix) {
  if (!unix || unix <= 0) return null;
  const d = new Date(unix * 1000);
  // Convert to Sydney time
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { unitIds, date } = req.query;
  if (!unitIds || !date) return res.status(400).json({ error: 'unitIds and date required' });

  const unitIdSet = new Set(unitIds.split(',').map(Number).filter(Boolean));
  if (unitIdSet.size === 0) return res.status(400).json({ error: 'no valid unitIds' });

  try {
    // Fetch all non-leave timesheets for this date
    // Note: Deputy bug — OperationalUnit in [...] filter silently drops some records
    // So we fetch by date only and filter client-side (same pattern as deputy-rosters.js)
    const response = await fetch(`${DEPUTY_BASE}/api/v1/resource/Timesheet/QUERY`, {
      method: 'POST',
      headers: {
        'Authorization': DEPUTY_TOKEN,
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
      return res.status(502).json({ error: `Deputy API error: ${response.status}`, detail: txt });
    }

    const raw = await response.json();
    const timesheets = Array.isArray(raw) ? raw : (raw?.value ?? []);

    // Filter to this centre's units only
    const results = [];
    for (const ts of timesheets) {
      const unitId = ts.OperationalUnit;
      if (!unitIdSet.has(unitId)) continue;

      const empId   = ts.Employee;
      const empName = ts._DPMetaData?.EmployeeInfo?.DisplayName ?? `Staff #${empId}`;
      const unitName = ts._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '';

      // Parse actual start/end from StartTimeLocalized/EndTimeLocalized.
      // RealTime=true means staff physically clocked in via Deputy kiosk/app.
      // RealTime=false but with StartTimeLocalized set means manager-approved timesheet
      // (common for past dates where timesheets are approved from roster).
      // Both are valid sources of actual times.
      const hasActualTimes = ts.RealTime || (ts.StartTimeLocalized && ts.EndTimeLocalized);
      const actualStart = hasActualTimes && ts.StartTimeLocalized
        ? ts.StartTimeLocalized.substring(11, 16)
        : null;
      const actualEnd = hasActualTimes && !ts.IsInProgress && ts.EndTimeLocalized
        ? ts.EndTimeLocalized.substring(11, 16)
        : null;

      // Parse meal break slots
      const breaks = [];
      const slots = Array.isArray(ts.Slots) ? ts.Slots : [];
      const shiftStartUnix = ts.StartTime || 0; // unix seconds
      for (const slot of slots) {
        if (slot.strType !== 'B') continue; // B = Break
        const breakType = slot.mixedActivity?.strBreakType === 'M' ? 'meal' : 'other';
        const status = parseBreakState(slot.strState);

        // Only include breaks that have actually been taken (intState=4 Finished, or intState=2 In Progress)
        const intState = slot.mixedActivity?.intState;
        if (intState !== 4 && intState !== 2) continue;

        // Block phantom breaks: Deputy sets intUnixStart = StartTime exactly for scheduled placeholders
        // A real break must start at least 30 minutes AFTER shift start
        const breakStartUnix = slot.intUnixStart || 0;
        if (breakStartUnix > 0 && shiftStartUnix > 0) {
          const diffMins = (breakStartUnix - shiftStartUnix) / 60;
          if (diffMins < 30) continue; // phantom or implausibly early — skip
        }

        const breakStart = breakStartUnix ? unixToHHMM(breakStartUnix) : null;
        const breakEnd   = (status === 'finished' && slot.intUnixEnd) ? unixToHHMM(slot.intUnixEnd) : null;

        breaks.push({ breakStart, breakEnd, type: breakType, status });
      }

      results.push({
        employeeId:   empId,
        employeeName: empName,
        unitId,
        unitName,
        actualStart,
        actualEnd,
        isInProgress: !!ts.IsInProgress,
        isRealTime:   !!ts.RealTime,
        rosteredStart: unixToHHMM(ts.StartTime),  // also include rostered for comparison
        rosteredEnd:   unixToHHMM(ts.EndTime),
        breaks,
      });
    }

    // Merge multiple timesheets for the same employee (e.g. split shifts or
    // duplicate records) — use earliest start, latest end, combine breaks.
    const merged = new Map();
    for (const r of results) {
      const existing = merged.get(r.employeeId);
      if (!existing) {
        merged.set(r.employeeId, { ...r });
        continue;
      }
      // Merge: keep earliest actualStart, latest actualEnd
      if (r.actualStart && (!existing.actualStart || r.actualStart < existing.actualStart)) {
        existing.actualStart = r.actualStart;
        existing.rosteredStart = r.rosteredStart;
      }
      if (r.actualEnd && (!existing.actualEnd || r.actualEnd > existing.actualEnd)) {
        existing.actualEnd = r.actualEnd;
        existing.rosteredEnd = r.rosteredEnd;
      }
      // isInProgress: true if any segment is still in progress
      if (r.isInProgress) existing.isInProgress = true;
      // isRealTime: true if any segment was real-time clock
      if (r.isRealTime) existing.isRealTime = true;
      // Combine breaks (deduplicate by breakStart time)
      for (const brk of r.breaks) {
        if (!existing.breaks.some(b => b.breakStart === brk.breakStart)) {
          existing.breaks.push(brk);
        }
      }
    }

    // Cache-control: allow 4-min browser cache (we poll every 5 min)
    res.setHeader('Cache-Control', 'public, max-age=240, stale-while-revalidate=60');
    return res.status(200).json([...merged.values()]);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
