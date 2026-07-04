/**
 * POST { mobile, pin, centreId, eventType } → records a kiosk timeclock event
 * Validates the PIN and state transitions.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneXB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { mobile, pin, centreId, eventType } = req.body || {};
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

    // 5. Insert event
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_timeclock_events`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        centre_id: staffCentreId,
        staff_id: staffId,
        staff_name: pinRecord.staff_name,
        event_type: eventType,
        event_time: nowSydneyISO(),
        event_date: today,
        roster_shift_id: shift?.id || null,
        source: 'kiosk',
      }),
    });
    if (!insertRes.ok) throw new Error('failed to record event');
    const inserted = await insertRes.json();

    return res.status(200).json({ ok: true, event: Array.isArray(inserted) ? inserted[0] : inserted });
  } catch (e) {
    console.error('kiosk-clock error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
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
