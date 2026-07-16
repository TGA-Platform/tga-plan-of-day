/**
 * GET ?centreId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD → timesheet rows for the range
 * Computes actuals from kiosk_timeclock_events, rostered times from roster_shifts,
 * includes leave shifts, and flags rostered shifts with no clock events and no leave.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function parseDateRange(query) {
  const { centreId, startDate, endDate, date } = query;
  if (!centreId) return { error: 'centreId required' };
  let start = startDate;
  let end = endDate;
  if (!start && date) { start = date; end = date; }
  if (!start || !end) return { error: 'startDate and endDate (or date) required' };
  return { centreId, startDate: start, endDate: end };
}

function dateRangeList(start, end) {
  const list = [];
  let d = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (d <= last) {
    list.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return list;
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const range = parseDateRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const { centreId, startDate, endDate } = range;

  try {
    const dates = dateRangeList(startDate, endDate);

    // 1. Rostered shifts for the range
    const shiftsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&date=gte.${startDate}&date=lte.${endDate}` +
      `&select=*&order=date.asc,start_time.asc&limit=5000`,
      { headers: HEADERS }
    );
    if (!shiftsRes.ok) throw new Error('shifts lookup failed');
    const shifts = await shiftsRes.json();

    // 2. Kiosk events for the range
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kiosk_timeclock_events?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&event_date=gte.${startDate}&event_date=lte.${endDate}` +
      `&order=event_time.asc&select=*&limit=5000`,
      { headers: HEADERS }
    );
    if (!eventsRes.ok) throw new Error('events lookup failed');
    const events = await eventsRes.json();

    // 3. Existing approvals for the range
    const approvalsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/timesheet_approvals?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&date=gte.${startDate}&date=lte.${endDate}` +
      `&select=*&limit=5000`,
      { headers: HEADERS }
    );
    if (!approvalsRes.ok) throw new Error('approvals lookup failed');
    const approvals = await approvalsRes.json();
    const approvalsKey = (a) => `${a.staff_id}:${a.date}`;
    const approvalsByKey = new Map((approvals || []).map(a => [approvalsKey(a), a]));

    // 4. Build rows per staff per date
    const shiftsByStaffDate = groupByKey(shifts, s => `${s.staff_id}:${s.date}`);
    const eventsByStaffDate = groupByKey(events, e => `${e.staff_id}:${e.event_date}`);

    const rows = [];
    const allKeys = new Set([...shiftsByStaffDate.keys(), ...eventsByStaffDate.keys()]);

    for (const key of allKeys) {
      const [staffId, date] = key.split(':');
      const shift = shiftsByStaffDate.get(key)?.[0] || null;
      const staffEvents = eventsByStaffDate.get(key) || [];
      const existing = approvalsByKey.get(key);

      const actual = deriveActuals(staffEvents);
      const row = buildRow(centreId, date, staffId, shift, staffEvents, actual, existing);
      rows.push(row);
    }

    // Sort by date, then start time, then name
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const at = a.roster_start_time || '99:99';
      const bt = b.roster_start_time || '99:99';
      if (at !== bt) return at.localeCompare(bt);
      return a.staff_name.localeCompare(b.staff_name);
    });

    // AI-style summary helpers
    const summary = {
      total: rows.length,
      pending: rows.filter(r => r.status === 'pending').length,
      flagged: rows.filter(r => r.status === 'flagged').length,
      approved: rows.filter(r => r.status === 'approved').length,
      leave: rows.filter(r => r.leave_type).length,
      noShows: rows.filter(r => (r.flags || []).some(f => f.includes('No clock events'))).length,
    };

    return res.status(200).json({ ok: true, startDate, endDate, centre_id: centreId, rows, summary });
  } catch (e) {
    console.error('timesheets error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}

function groupByKey(arr, keyFn) {
  return (arr || []).reduce((out, item) => {
    const k = keyFn(item);
    if (!k) return out;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
    return out;
  }, new Map());
}

function deriveActuals(events) {
  const startEvent = events.find(e => e.event_type === 'start_shift');
  const endEvent = [...events].reverse().find(e => e.event_type === 'end_shift');
  const lunchStart = events.find(e => e.event_type === 'start_lunch');
  const lunchEnd = events.find(e => e.event_type === 'end_lunch');
  return {
    start: startEvent ? toHhmm(startEvent.event_time) : undefined,
    end: endEvent ? toHhmm(endEvent.event_time) : undefined,
    lunchStart: lunchStart ? toHhmm(lunchStart.event_time) : undefined,
    lunchEnd: lunchEnd ? toHhmm(lunchEnd.event_time) : undefined,
  };
}

function toHhmm(iso) {
  return iso ? iso.slice(11, 16) : undefined;
}

function buildRow(centreId, date, staffId, shift, events, actual, existing) {
  const staffName = shift?.staff_name || events[0]?.staff_name || existing?.staff_name || 'Unknown';
  const isLeave = !!shift?.leave_type;
  const hasClockEvents = events.length > 0;

  // Flag if rostered but no clock events and not leave
  const flags = [];
  if (shift && !hasClockEvents && !isLeave) {
    flags.push('No clock events or leave recorded for rostered shift');
  }

  if (existing) {
    const isLeaveExisting = !!existing.leave_type;
    return {
      ...existing,
      actual_start_time: actual.start || existing.actual_start_time || (isLeaveExisting ? existing.roster_start_time : null),
      actual_end_time: actual.end || existing.actual_end_time || (isLeaveExisting ? existing.roster_end_time : null),
      actual_lunch_start: actual.lunchStart || existing.actual_lunch_start || (isLeaveExisting ? existing.roster_lunch_start : null),
      actual_lunch_end: actual.lunchEnd || existing.actual_lunch_end || (isLeaveExisting && existing.roster_lunch_start && existing.roster_lunch_duration ? minutesToHhmm(hhmmToMinutes(existing.roster_lunch_start) + existing.roster_lunch_duration) : null),
      flags: existing.flags?.length ? existing.flags : flags,
    };
  }

  // For leave shifts, treat actual as rostered
  const leaveActualStart = isLeave ? shift.start_time : actual.start;
  const leaveActualEnd = isLeave ? shift.end_time : actual.end;
  const leaveActualLunchStart = isLeave ? shift.lunch_start : actual.lunchStart;
  const leaveActualLunchEnd = isLeave
    ? (shift.lunch_start && shift.lunch_duration ? minutesToHhmm(hhmmToMinutes(shift.lunch_start) + shift.lunch_duration) : actual.lunchEnd)
    : actual.lunchEnd;

  return {
    id: null,
    centre_id: centreId,
    staff_id: staffId,
    staff_name: staffName,
    date,
    roster_shift_id: shift?.id || null,
    roster_start_time: shift?.start_time || null,
    roster_end_time: shift?.end_time || null,
    roster_lunch_start: shift?.lunch_start || null,
    roster_lunch_duration: shift?.lunch_duration ?? 30,
    actual_start_time: leaveActualStart || null,
    actual_end_time: leaveActualEnd || null,
    actual_lunch_start: leaveActualLunchStart || null,
    actual_lunch_end: leaveActualLunchEnd || null,
    approved_start_time: null,
    approved_end_time: null,
    approved_lunch_duration: null,
    approved_hours: 0,
    status: flags.length ? 'flagged' : 'pending',
    flags,
    leave_type: shift?.leave_type || null,
    approver_name: null,
    approved_at: null,
  };
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function minutesToHhmm(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.max(0, mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
