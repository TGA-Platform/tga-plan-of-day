/**
 * POST { mobile, pin, centreId, eventType, confirmed?, adjustedStartTime?, adjustedEndTime? }
 * → records a kiosk timeclock event and optionally pre-approves the timesheet.
 *
 * When ending a shift the employee is always asked:
 *   "Did you finish your shift on time?"
 * - Yes  → actual clock times are recorded, but the timesheet is rounded to the
 *          rostered start/end and pre-approved.
 * - No   → employee can edit their start/finish times; approved = actual and the
 *          timesheet is left pending for director review.
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

const VALID_EVENTS = ['start_shift', 'start_lunch', 'end_lunch', 'end_shift'];

function nowSydneyISO() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' })).toISOString();
}

function todaySydney() {
  return nowSydneyISO().slice(0, 10);
}

function toHhmm(iso) {
  return iso ? iso.slice(11, 16) : null;
}

function hhmmToMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function minutesToHhmm(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.max(0, mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { mobile, pin, centreId, eventType, confirmed, adjustedStartTime, adjustedEndTime, comment } = req.body || {};
  if (!mobile || !pin || !eventType) {
    return res.status(400).json({ error: 'mobile, pin, and eventType required' });
  }
  if (!VALID_EVENTS.includes(eventType)) return res.status(400).json({ error: 'invalid eventType' });

  try {
    // 1. Verify PIN
    const pinQuery = centreId
      ? `centre_id=eq.${encodeURIComponent(centreId)}&mobile=eq.${encodeURIComponent(mobile)}&select=*&limit=1`
      : `mobile=eq.${encodeURIComponent(mobile)}&select=*&limit=1`;
    const pinRes = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_staff_pins?${pinQuery}`, { headers: HEADERS });
    if (!pinRes.ok) throw new Error('pin lookup failed');
    const pinRows = await pinRes.json();
    if (!pinRows.length) return res.status(401).json({ error: 'invalid mobile or pin' });
    const pinRecord = pinRows[0];
    if (pinRecord.pin !== pin) return res.status(401).json({ error: 'invalid mobile or pin' });

    const staffCentreId = pinRecord.centre_id;
    const staffId = pinRecord.staff_id;
    const today = todaySydney();

    // 2. Load today's events for state validation
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kiosk_timeclock_events?centre_id=eq.${encodeURIComponent(staffCentreId)}` +
      `&staff_id=eq.${encodeURIComponent(staffId)}` +
      `&event_date=eq.${today}` +
      `&order=event_time.asc&select=*`,
      { headers: HEADERS }
    );
    if (!eventsRes.ok) throw new Error('events lookup failed');
    const events = await eventsRes.json();

    // 3. State transition check
    const lastType = events.length ? events[events.length - 1].event_type : null;
    const stateError = checkTransition(lastType, eventType);
    if (stateError) return res.status(409).json({ error: stateError });

    // 4. Find roster shift to link
    const shiftRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${encodeURIComponent(staffCentreId)}` +
      `&staff_id=eq.${encodeURIComponent(staffId)}` +
      `&date=eq.${today}` +
      `&select=*,roster_weeks(status)` +
      `&order=start_time.asc&limit=1`,
      { headers: HEADERS }
    );
    if (!shiftRes.ok) throw new Error('shift lookup failed');
    const shiftRows = await shiftRes.json();
    const shift = shiftRows.find(s => s.roster_weeks?.status === 'published') || shiftRows[0] || null;

    // Determine event time: use adjusted time if provided for end_shift
    let eventTime = nowSydneyISO();
    if (eventType === 'end_shift' && adjustedEndTime) {
      eventTime = `${today}T${adjustedEndTime}:00+10:00`;
    }

    // 5. Insert event
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_timeclock_events`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        centre_id: staffCentreId,
        staff_id: staffId,
        staff_name: pinRecord.staff_name,
        event_type: eventType,
        event_time: eventTime,
        event_date: today,
        roster_shift_id: shift?.id || null,
        source: 'kiosk',
        comment: comment || null,
      }),
    });
    if (!insertRes.ok) throw new Error('failed to record event');
    const inserted = await insertRes.json();

    // 6. On end_shift, create/update timesheet approval
    let timesheet = null;
    if (eventType === 'end_shift' && (!shift || !shift.leave_type)) {
      timesheet = await upsertTimesheet(staffCentreId, staffId, pinRecord.staff_name, today, shift, events, confirmed, adjustedStartTime, adjustedEndTime, comment);
    }

    return res.status(200).json({ ok: true, event: Array.isArray(inserted) ? inserted[0] : inserted, timesheet });
  } catch (e) {
    console.error('kiosk-clock error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}

async function upsertTimesheet(centreId, staffId, staffName, date, shift, priorEvents, confirmed, adjustedStartTime, adjustedEndTime, comment) {
  const startEvent = priorEvents.find(e => e.event_type === 'start_shift');
  const lunchStartEvent = priorEvents.find(e => e.event_type === 'start_lunch');
  const lunchEndEvent = priorEvents.find(e => e.event_type === 'end_lunch');

  // Actual clock times are always recorded for compliance
  const actualStart = adjustedStartTime || toHhmm(startEvent?.event_time) || null;
  const actualEnd = adjustedEndTime || toHhmm(priorEvents.filter(e => e.event_type === 'end_shift').pop()?.event_time) || null;
  const actualLunchStart = toHhmm(lunchStartEvent?.event_time) || null;
  const actualLunchEnd = toHhmm(lunchEndEvent?.event_time) || null;

  // Employee confirmed they finished on time → round approved times to rostered
  const shouldPreApprove = shift && confirmed === true && !adjustedStartTime && !adjustedEndTime;

  const approvedStart = shouldPreApprove ? shift.start_time : actualStart;
  const approvedEnd = shouldPreApprove ? shift.end_time : actualEnd;
  const approvedLunchM = shift?.lunch_duration || 30;
  const approvedHours = Math.max(0, (hhmmToMinutes(approvedEnd) - hhmmToMinutes(approvedStart) - approvedLunchM) / 60);

  const flags = [];
  if (!shift) {
    flags.push('No rostered shift — review comment');
  }
  if (!shouldPreApprove) {
    if (adjustedStartTime) flags.push('Employee adjusted start time');
    if (adjustedEndTime) flags.push('Employee adjusted finish time');
  }

  const status = shouldPreApprove ? 'approved' : 'pending';

  const body = {
    centre_id: centreId,
    staff_id: staffId,
    staff_name: staffName,
    date,
    roster_shift_id: shift?.id || null,
    roster_start_time: shift?.start_time || null,
    roster_end_time: shift?.end_time || null,
    roster_lunch_start: shift?.lunch_start || null,
    roster_lunch_duration: shift?.lunch_duration || null,
    actual_start_time: actualStart,
    actual_end_time: actualEnd,
    actual_lunch_start: actualLunchStart,
    actual_lunch_end: actualLunchEnd,
    approved_start_time: approvedStart,
    approved_end_time: approvedEnd,
    approved_lunch_duration: approvedLunchM,
    approved_hours: approvedHours,
    status,
    flags,
    employee_comment: comment || null,
    approver_name: shouldPreApprove ? 'Kiosk auto-approval' : null,
    approved_at: shouldPreApprove ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/timesheet_approvals`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error('timesheet upsert failed:', txt);
    return null;
  }
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] : rows;
}

function checkTransition(lastType, nextType) {
  if (!lastType) {
    if (nextType !== 'start_shift') return 'Please start your shift first';
    return null;
  }
  const allowed = {
    start_shift: ['start_lunch', 'end_shift'],
    start_lunch: ['end_lunch'],
    end_lunch: ['end_shift'],
    end_shift: ['start_shift'],
  };
  if (!allowed[lastType].includes(nextType)) {
    if (lastType === 'end_shift') return 'Shift already ended';
    if (lastType === 'start_lunch') return 'Please end lunch first';
    if (lastType === 'start_shift') return nextType === 'end_lunch' ? 'Please start lunch first' : 'Action not available';
    return 'Action not available';
  }
  return null;
}
