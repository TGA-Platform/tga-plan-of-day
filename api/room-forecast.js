/**
 * /api/room-forecast
 * Returns expected attendance per room for a campus + date,
 * based on a 4-week rolling average of the same weekday.
 *
 * Also returns today's booked count (campus-level) from daily_occupancy.
 *
 * Query params:
 *   campus  - centre name
 *   date    - YYYY-MM-DD (the date being viewed)
 *
 * Response:
 * {
 *   booked: number | null,          // total booked for campus that day
 *   capacity: number | null,        // centre capacity
 *   rooms: {
 *     [roomName]: {
 *       expected: number | null,    // 4-week rolling avg (null if no history)
 *       weeksUsed: number,          // how many weeks contributed to average
 *     }
 *   }
 * }
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

async function supaFetch(path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey:        SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { campus, date } = req.query;
  if (!campus || !date) return res.status(400).json({ error: 'campus and date required' });

  // Build the 4 prior same-weekday dates
  // Use T12:00:00Z (noon UTC) to avoid timezone day-shift for any locale
  const target = new Date(date + 'T12:00:00Z');
  const priorDates = [];
  for (let w = 1; w <= 4; w++) {
    const d = new Date(target);
    d.setUTCDate(d.getUTCDate() - 7 * w);
    priorDates.push(d.toISOString().slice(0, 10));
  }

  // Fetch attendance rows for those 4 dates for this campus (all rooms)
  const dateFilter = priorDates.map(d => `date.eq.${d}`).join(',');
  const attRows = await supaFetch(
    `/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&or=(${encodeURIComponent(dateFilter)})&select=date,room,child_name&limit=5000`
  );

  // Count actuals per room per date
  // { date -> { room -> count } }
  const byDateRoom = {};
  for (const row of (Array.isArray(attRows) ? attRows : [])) {
    if (!byDateRoom[row.date]) byDateRoom[row.date] = {};
    byDateRoom[row.date][row.room] = (byDateRoom[row.date][row.room] || 0) + 1;
  }

  // Collect all rooms seen across all weeks
  const allRooms = new Set();
  for (const dateMap of Object.values(byDateRoom)) {
    for (const room of Object.keys(dateMap)) allRooms.add(room);
  }

  // Calculate rolling average per room
  const rooms = {};
  for (const room of allRooms) {
    const counts = priorDates
      .map(d => byDateRoom[d]?.[room])
      .filter(c => c !== undefined);
    if (counts.length === 0) {
      rooms[room] = { expected: null, weeksUsed: 0 };
    } else {
      const avg = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
      rooms[room] = { expected: avg, weeksUsed: counts.length };
    }
  }

  // Fetch booked + capacity + room_booked for this campus + date from daily_occupancy
  const occRows = await supaFetch(
    `/rest/v1/daily_occupancy?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=booked,capacity,room_booked&limit=1`
  );
  const occ = Array.isArray(occRows) && occRows.length > 0 ? occRows[0] : null;
  const roomBooked = (occ?.room_booked && typeof occ.room_booked === 'object') ? occ.room_booked : {};

  // For today's date, fetch actual attendance from attendance_daily
  const todayStr = new Date().toISOString().slice(0, 10);
  let actualAttendance = null;
  let roomActual = {};
  if (date === todayStr) {
    try {
      const attRows = await supaFetch(
        `/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=room,child_name&limit=5000`
      );
      if (Array.isArray(attRows)) {
        actualAttendance = attRows.length;
        for (const row of attRows) {
          roomActual[row.room] = (roomActual[row.room] || 0) + 1;
        }
      }
    } catch (e) {
      console.error('Failed to fetch actual attendance:', e.message);
    }
  }

  // Merge room_booked into rooms response
  // Also include rooms that have a booked count but no historical attendance
  const allRoomNames = new Set([...Object.keys(rooms), ...Object.keys(roomBooked), ...Object.keys(roomActual)]);
  const roomsOut = {};
  for (const room of allRoomNames) {
    roomsOut[room] = {
      ...(rooms[room] ?? { expected: null, weeksUsed: 0 }),
      booked: roomBooked[room] ?? null,
      actual: roomActual[room] ?? null,
    };
  }

  return res.status(200).json({
    booked:   occ?.booked   ?? null,
    actual:   actualAttendance,
    capacity: occ?.capacity ?? null,
    rooms: roomsOut,
    priorDates, // for debugging
  });
}
