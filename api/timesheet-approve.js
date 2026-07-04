/**
 * POST { centreId, staffId, date, approvedStart, approvedEnd, approvedLunchDuration, approverName }
 * → upserts a timesheet_approvals row.
 * If approved values are omitted, computes them from roster/actual using the rounding engine.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Prefer: 'return=representation',
};

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function roundTimesheet(rostered, actual) {
  const TOLERANCE = 15;
  const flags = [];
  const rStart = hhmmToMinutes(rostered.start);
  const rEnd = hhmmToMinutes(rostered.end);
  const rLunch = rostered.lunchDuration || 0;

  let aStart = rStart;
  if (actual.start) {
    const d = hhmmToMinutes(actual.start) - rStart;
    if (Math.abs(d) > TOLERANCE) {
      aStart = hhmmToMinutes(actual.start);
      flags.push(`Start ${Math.abs(d)} min ${d > 0 ? 'late' : 'early'}`);
    }
  } else {
    flags.push('Missing start time');
  }

  let aEnd = rEnd;
  if (actual.end) {
    const d = hhmmToMinutes(actual.end) - rEnd;
    if (Math.abs(d) > TOLERANCE) {
      aEnd = hhmmToMinutes(actual.end);
      flags.push(`End ${Math.abs(d)} min ${d > 0 ? 'late' : 'early'}`);
    }
  } else {
    flags.push('Missing end time');
  }

  let aLunch = rLunch;
  if (actual.lunchStart && actual.lunchEnd) {
    const actualLunch = hhmmToMinutes(actual.lunchEnd) - hhmmToMinutes(actual.lunchStart);
    const d = actualLunch - rLunch;
    if (Math.abs(d) > TOLERANCE) {
      aLunch = actualLunch;
      flags.push(`Lunch ${actualLunch} min vs rostered ${rLunch} min`);
    }
  } else if (rLunch > 0) {
    flags.push('Missing lunch times');
  }

  const hours = Math.max(0, (aEnd - aStart - aLunch) / 60);
  return { aStart, aEnd, aLunch, hours, flags };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const { centreId, staffId, date, approverName } = body;
  if (!centreId || !staffId || !date) {
    return res.status(400).json({ error: 'centreId, staffId, date required' });
  }

  try {
    // 1. Load roster shift and actual events
    const shiftsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&staff_id=eq.${encodeURIComponent(staffId)}` +
      `&date=eq.${date}` +
      `&select=*&limit=1`,
      { headers: HEADERS }
    );
    if (!shiftsRes.ok) throw new Error('shift lookup failed');
    const shifts = await shiftsRes.json();
    const shift = shifts[0] || null;

    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kiosk_timeclock_events?centre_id=eq.${encodeURIComponent(centreId)}` +
      `&staff_id=eq.${encodeURIComponent(staffId)}` +
      `&event_date=eq.${date}` +
      `&order=event_time.asc&select=*`,
      { headers: HEADERS }
    );
    if (!eventsRes.ok) throw new Error('events lookup failed');
    const events = await eventsRes.json();

    // 2. Compute actuals
    const first = (type) => events.find(e => e.event_type === type);
    const lastEnd = [...events].reverse().find(e => e.event_type === 'end_shift');
    const actual = {
      start: first('start_shift')?.event_time?.slice(11, 16),
      end: lastEnd?.event_time?.slice(11, 16),
      lunchStart: first('start_lunch')?.event_time?.slice(11, 16),
      lunchEnd: first('end_lunch')?.event_time?.slice(11, 16),
    };

    // 3. Compute approved values
    const rostered = {
      start: shift?.start_time || actual.start || '08:00',
      end: shift?.end_time || actual.end || '16:00',
      lunchDuration: shift?.lunch_duration ?? 30,
    };
    const computed = roundTimesheet(rostered, actual);

    const approvedStart = body.approvedStart || minutesToHhmm(computed.aStart);
    const approvedEnd = body.approvedEnd || minutesToHhmm(computed.aEnd);
    const approvedLunchDuration = body.approvedLunchDuration ?? computed.aLunch;
    const approvedHours = body.approvedHours ?? computed.hours;
    const flags = body.flags || computed.flags;
    const status = body.status || (flags.length ? 'flagged' : 'approved');

    const upsertBody = {
      centre_id: centreId,
      staff_id: staffId,
      staff_name: shift?.staff_name || events[0]?.staff_name || body.staffName || 'Unknown',
      date,
      roster_shift_id: shift?.id || null,
      roster_start_time: shift?.start_time || null,
      roster_end_time: shift?.end_time || null,
      roster_lunch_start: shift?.lunch_start || null,
      roster_lunch_duration: shift?.lunch_duration ?? null,
      actual_start_time: actual.start || null,
      actual_end_time: actual.end || null,
      actual_lunch_start: actual.lunchStart || null,
      actual_lunch_end: actual.lunchEnd || null,
      approved_start_time: approvedStart,
      approved_end_time: approvedEnd,
      approved_lunch_duration: approvedLunchDuration,
      approved_hours: approvedHours,
      status,
      flags,
      approver_name: approverName || null,
      approved_at: approverName ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/timesheet_approvals`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(upsertBody),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`approval upsert failed: ${txt}`);
    }
    const rows = await r.json().catch(() => null);
    return res.status(200).json({ ok: true, row: Array.isArray(rows) ? rows[0] : rows });
  } catch (e) {
    console.error('timesheet-approve error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}

function minutesToHhmm(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.max(0, mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
