/**
 * GET ?centreId=...&date=YYYY-MM-DD → timesheet rows for that date
 * Computes actuals from kiosk_timeclock_events, rostered times from roster_shifts,
 * and merges any existing timesheet_approvals row.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneXB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { centreId, date } = req.query;
  if (!centreId || !date) return res.status(400).json({ error: 'centreId and date required' });

  try {
    // 1. Rostered shifts for the date
    const shiftsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&date=eq.${date}` +
      `&select=*&order=start_time.asc&limit=1000`,
      { headers: HEADERS }
    );
    if (!shiftsRes.ok) throw new Error('shifts lookup failed');
    const shifts = await shiftsRes.json();

    // 2. Kiosk events for the date
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kiosk_timeclock_events?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&event_date=eq.${date}` +
      `&order=event_time.asc&select=*&limit=1000`,
      { headers: HEADERS }
    );
    if (!eventsRes.ok) throw new Error('events lookup failed');
    const events = await eventsRes.json();

    // 3. Existing approvals for the date
    const approvalsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/timesheet_approvals?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&date=eq.${date}` +
      `&select=*&limit=1000`,
      { headers: HEADERS }
    );
    if (!approvalsRes.ok) throw new Error('approvals lookup failed');
    const approvals = await approvalsRes.json();
    const approvalsByStaff = new Map((approvals || []).map(a => [a.staff_id, a]));

    // 4. Build rows per staff
    const rows = [];
    const shiftsByStaff = groupBy(shifts, 'staff_id');
    const eventsByStaff = groupBy(events, 'staff_id');
    const allStaffIds = new Set([...Object.keys(shiftsByStaff), ...Object.keys(eventsByStaff)]);

    for (const staffId of allStaffIds) {
      const shift = shiftsByStaff[staffId]?.[0] || null;
      const staffEvents = eventsByStaff[staffId] || [];
      const existing = approvalsByStaff.get(staffId);

      const actual = deriveActuals(staffEvents);
      const row = buildRow(centreId, date, shift, staffEvents, actual, existing);
      rows.push(row);
    }

    // Sort by start time, then name
    rows.sort((a, b) => {
      const at = a.roster_start_time || '99:99';
      const bt = b.roster_start_time || '99:99';
      if (at !== bt) return at.localeCompare(bt);
      return a.staff_name.localeCompare(b.staff_name);
    });

    return res.status(200).json({ ok: true, date, centre_id: centreId, rows });
  } catch (e) {
    console.error('timesheets error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}

function groupBy(arr, key) {
  return (arr || []).reduce((out, item) => {
    const k = item[key];
    if (!k) return out;
    if (!out[k]) out[k] = [];
    out[k].push(item);
    return out;
  }, {});
}

function deriveActuals(events) {
  const first = (type) => events.find(e => e.event_type === type);
  const startEvent = first('start_shift');
  const endEvent = [...events].reverse().find(e => e.event_type === 'end_shift');
  const lunchStart = first('start_lunch');
  const lunchEnd = first('end_lunch');
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

function buildRow(centreId, date, shift, events, actual, existing) {
  const staffId = shift?.staff_id || events[0]?.staff_id;
  const staffName = shift?.staff_name || events[0]?.staff_name;

  if (existing) {
    return {
      ...existing,
      actual_start_time: actual.start || existing.actual_start_time,
      actual_end_time: actual.end || existing.actual_end_time,
      actual_lunch_start: actual.lunchStart || existing.actual_lunch_start,
      actual_lunch_end: actual.lunchEnd || existing.actual_lunch_end,
    };
  }

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
    actual_start_time: actual.start || null,
    actual_end_time: actual.end || null,
    actual_lunch_start: actual.lunchStart || null,
    actual_lunch_end: actual.lunchEnd || null,
    approved_start_time: null,
    approved_end_time: null,
    approved_lunch_duration: null,
    approved_hours: 0,
    status: 'pending',
    flags: [],
    approver_name: null,
    approved_at: null,
  };
}
