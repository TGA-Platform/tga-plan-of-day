/**
 * POST { mobile, pin, centreId? } → staff + today's rostered shift + today's events
 * If centreId is omitted, tries to resolve from the PIN record.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function todaySydney() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))
    .toISOString()
    .slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { mobile, pin, centreId } = req.body || {};
  if (!mobile || !pin) return res.status(400).json({ error: 'mobile and pin required' });

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
    const today = todaySydney();

    // 2. Find today's rostered shift (published weeks only)
    const shiftRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roster_shifts?centre_id=eq.${encodeURIComponent(staffCentreId)}` +
      `&staff_id=eq.${encodeURIComponent(pinRecord.staff_id)}` +
      `&date=eq.${today}` +
      `&select=*,roster_weeks(status)` +
      `&order=start_time.asc&limit=1`,
      { headers: HEADERS }
    );
    if (!shiftRes.ok) throw new Error('shift lookup failed');
    const shiftRows = await shiftRes.json();
    const shift = shiftRows.find(s => s.roster_weeks?.status === 'published') || shiftRows[0] || null;

    // 3. Today's events
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kiosk_timeclock_events?centre_id=eq.${encodeURIComponent(staffCentreId)}` +
      `&staff_id=eq.${encodeURIComponent(pinRecord.staff_id)}` +
      `&event_date=eq.${today}` +
      `&order=event_time.asc&select=*`,
      { headers: HEADERS }
    );
    if (!eventsRes.ok) throw new Error('events lookup failed');
    const events = await eventsRes.json();

    return res.status(200).json({
      ok: true,
      centre_id: staffCentreId,
      staff_id: pinRecord.staff_id,
      staff_name: pinRecord.staff_name,
      role: pinRecord.role,
      shift,
      events,
    });
  } catch (e) {
    console.error('kiosk-auth error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
