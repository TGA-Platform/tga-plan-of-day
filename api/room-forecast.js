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

  // Use last week's same weekday as expected attendance (room by room)
  // Use T12:00:00Z (noon UTC) to avoid timezone day-shift for any locale
  const target = new Date(date + 'T12:00:00Z');
  const lastWeek = new Date(target);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const lastWeekStr = lastWeek.toISOString().slice(0, 10);

  // Fetch attendance rows for last week's same weekday
  const attRows = await supaFetch(
    `/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${lastWeekStr}&select=date,room,child_name&limit=5000`
  );

  // Count actuals per room for last week
  // { room -> count }
  const lastWeekByRoom = {};
  for (const row of (Array.isArray(attRows) ? attRows : [])) {
    lastWeekByRoom[row.room] = (lastWeekByRoom[row.room] || 0) + 1;
  }

  // Collect all rooms seen last week
  const allRooms = new Set(Object.keys(lastWeekByRoom));

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

  // Build rooms output using last week's actual attendance as expected
  const allRoomNames = new Set([...Object.keys(lastWeekByRoom), ...Object.keys(roomBooked), ...Object.keys(roomActual)]);
  const roomsOut = {};
  for (const room of allRoomNames) {
    const bookedCount = roomBooked[room] ?? null;
    const expectedCount = lastWeekByRoom[room] ?? null;
    roomsOut[room] = {
      expected: expectedCount,
      weeksUsed: expectedCount !== null ? 1 : 0,
      booked: bookedCount,
      actual: roomActual[room] ?? null,
    };
  }

  return res.status(200).json({
    booked:   occ?.booked   ?? null,
    actual:   actualAttendance,
    capacity: occ?.capacity ?? null,
    rooms: roomsOut,
    lastWeek: lastWeekStr, // for debugging
  });
}
