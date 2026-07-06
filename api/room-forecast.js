/**
 * /api/room-forecast
 * Returns expected attendance per room for a campus + date,
 * based on a 4-week rolling average of the same weekday.
 *
 * Also returns today's booked count (campus-level) from daily_occupancy
 * and required staff per room computed from the age breakdown of children.
 *
 * Query params:
 *   campus   - centre name
 *   date     - YYYY-MM-DD (the date being viewed)
 *   centreId - optional short centre id for ratio_check_data lookup
 *
 * Response:
 * {
 *   booked: number | null,
 *   capacity: number | null,
 *   rooms: {
 *     [roomName]: {
 *       expected: number | null,
 *       weeksUsed: number,
 *       booked: number | null,
 *       actual: number | null,
 *       required: number | null,
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

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const yearMatch  = String(ageStr).match(/(\d+)y/);
  const monthMatch = String(ageStr).match(/(\d+)m/);
  const years  = yearMatch  ? parseInt(yearMatch[1])  : 0;
  const months = monthMatch ? parseInt(monthMatch[1]) : 0;
  return years * 12 + months;
}

// NSW cascade ratios by age in months
function calcRequiredStaff(children) {
  const brackets = [
    { minMonths: 0, maxMonths: 24, ratio: 4 },
    { minMonths: 24, maxMonths: 36, ratio: 5 },
    { minMonths: 36, maxMonths: 999, ratio: 10 },
  ];
  const groups = brackets.map(b => ({
    ...b,
    count: children.filter(c => c.ageMonths >= b.minMonths && c.ageMonths < b.maxMonths && c.ageMonths >= 0).length,
  }));

  let totalStaff = 0;
  let carryover = 0;
  for (const group of groups) {
    if (group.count === 0) continue;
    const coveredByCarryover = Math.min(group.count, carryover);
    const stillNeeded = group.count - coveredByCarryover;
    const newStaff = Math.ceil(stillNeeded / group.ratio);
    totalStaff += newStaff;
    const unusedFromNew = newStaff * group.ratio - stillNeeded;
    const unusedFromCarryover = carryover - coveredByCarryover;
    carryover = unusedFromNew + unusedFromCarryover;
  }
  return totalStaff;
}

function requiredFromRows(rows) {
  const byRoom = {};
  for (const row of rows) {
    if (!row.room) continue;
    byRoom[row.room] = byRoom[row.room] || [];
    byRoom[row.room].push({ ageMonths: parseAgeMonths(row.age) });
  }
  const requiredByRoom = {};
  for (const [room, children] of Object.entries(byRoom)) {
    requiredByRoom[room] = calcRequiredStaff(children);
  }
  return requiredByRoom;
}

async function loadPlanOfDayRequired(centreId, date) {
  if (!centreId) return {};
  try {
    const rows = await supaFetch(`/rest/v1/ratio_check_data?centre_id=eq.${encodeURIComponent(centreId)}&date=eq.${date}&select=session,data`);
    if (!Array.isArray(rows) || rows.length === 0) return {};

    const requiredByRoom = {};
    for (const row of rows) {
      const data = row.data || {};
      // Prefer stored requiredByRoom if present (computed by plan-of-day)
      if (data.requiredByRoom && typeof data.requiredByRoom === 'object') {
        for (const [roomName, req] of Object.entries(data.requiredByRoom)) {
          requiredByRoom[roomName] = Math.max(requiredByRoom[roomName] || 0, Number(req) || 0);
        }
        continue;
      }
      // Fallback: compute from stored children (older saves may have empty children arrays)
      const children = Array.isArray(data.children) ? data.children : [];
      const byRoom = {};
      for (const child of children) {
        if (!child.room) continue;
        byRoom[child.room] = byRoom[child.room] || [];
        byRoom[child.room].push(child);
      }
      for (const [roomName, roomChildren] of Object.entries(byRoom)) {
        const req = calcRequiredStaff(roomChildren);
        requiredByRoom[roomName] = Math.max(requiredByRoom[roomName] || 0, req);
      }
    }
    return requiredByRoom;
  } catch (e) {
    console.error('[room-forecast] plan-of-day load failed:', e.message);
    return {};
  }
}

async function forecastForCampus(centreId, campus, date, lastWeekStr, todayStr, allLastWeekRows, allOccRows, allTodayRows) {
  const attRows = allLastWeekRows.filter(r => r.campus === campus);
  const lastWeekByRoom = {};
  for (const row of attRows) {
    lastWeekByRoom[row.room] = (lastWeekByRoom[row.room] || 0) + 1;
  }
  const lastWeekRequiredByRoom = requiredFromRows(attRows);

  const occ = allOccRows.find(r => r.campus === campus) || null;
  const roomBooked = (occ?.room_booked && typeof occ.room_booked === 'object') ? occ.room_booked : {};

  let actualAttendance = null;
  let roomActual = {};
  let actualRequiredByRoom = {};
  if (date === todayStr) {
    const todayRows = allTodayRows.filter(r => r.campus === campus);
    actualAttendance = todayRows.length;
    for (const row of todayRows) {
      roomActual[row.room] = (roomActual[row.room] || 0) + 1;
    }
    actualRequiredByRoom = requiredFromRows(todayRows);
  }

  // Plan-of-day override takes precedence if available
  const planRequiredByRoom = await loadPlanOfDayRequired(centreId, date);

  const allRoomNames = new Set([
    ...Object.keys(lastWeekByRoom),
    ...Object.keys(roomBooked),
    ...Object.keys(roomActual),
    ...Object.keys(lastWeekRequiredByRoom),
    ...Object.keys(actualRequiredByRoom),
    ...Object.keys(planRequiredByRoom),
  ]);

  const roomsOut = {};
  for (const room of allRoomNames) {
    const bookedCount = roomBooked[room] ?? null;
    const expectedCount = lastWeekByRoom[room] ?? null;
    const required = planRequiredByRoom[room]
      ?? actualRequiredByRoom[room]
      ?? lastWeekRequiredByRoom[room]
      ?? null;

    roomsOut[room] = {
      expected: expectedCount,
      weeksUsed: expectedCount !== null ? 1 : 0,
      booked: bookedCount,
      actual: roomActual[room] ?? null,
      required,
    };
  }

  return {
    campus,
    booked:   occ?.booked   ?? null,
    actual:   actualAttendance,
    capacity: occ?.capacity ?? null,
    rooms: roomsOut,
    lastWeek: lastWeekStr,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { campus, date, centreId } = req.query;
  if (!campus || !date) return res.status(400).json({ error: 'campus and date required' });

  const target = new Date(date + 'T12:00:00Z');
  const lastWeek = new Date(target);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const lastWeekStr = lastWeek.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    // Bulk mode: return forecasts for all campuses in one call
    if (campus === 'all') {
      const [allLastWeekRows, allOccRows, allTodayRows] = await Promise.all([
        // limit=10000: Supabase default is 1000 which cuts off centres alphabetically (Wollongong/Spring Farm/Wilton missing)
        supaFetch(`/rest/v1/attendance_daily?date=eq.${lastWeekStr}&select=campus,room,child_name,age&limit=10000`),
        supaFetch(`/rest/v1/daily_occupancy?date=eq.${date}&select=campus,booked,capacity,room_booked&limit=5000`),
        date === todayStr
          ? supaFetch(`/rest/v1/attendance_daily?date=eq.${date}&select=campus,room,child_name,age&limit=10000`)
          : Promise.resolve([]),
      ]);

      const campuses = [...new Set([
        ...allLastWeekRows.map(r => r.campus),
        ...allOccRows.map(r => r.campus),
        ...allTodayRows.map(r => r.campus),
      ])];

      const out = {};
      for (const c of campuses) {
        out[c] = await forecastForCampus(null, c, date, lastWeekStr, todayStr, allLastWeekRows, allOccRows, allTodayRows);
      }
      return res.status(200).json(out);
    }

    // Single campus mode
    const [attRows, occRows, todayRows] = await Promise.all([
      supaFetch(`/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${lastWeekStr}&select=date,room,child_name,age&limit=5000`),
      supaFetch(`/rest/v1/daily_occupancy?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=booked,capacity,room_booked&limit=1`),
      date === todayStr
        ? supaFetch(`/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=room,child_name,age&limit=5000`)
        : Promise.resolve([]),
    ]);

    const lastWeekByRoom = {};
    for (const row of (Array.isArray(attRows) ? attRows : [])) {
      lastWeekByRoom[row.room] = (lastWeekByRoom[row.room] || 0) + 1;
    }
    const lastWeekRequiredByRoom = requiredFromRows(Array.isArray(attRows) ? attRows : []);

    const occ = Array.isArray(occRows) && occRows.length > 0 ? occRows[0] : null;
    const roomBooked = (occ?.room_booked && typeof occ.room_booked === 'object') ? occ.room_booked : {};

    let actualAttendance = null;
    let roomActual = {};
    let actualRequiredByRoom = {};
    if (date === todayStr) {
      if (Array.isArray(todayRows)) {
        actualAttendance = todayRows.length;
        for (const row of todayRows) {
          roomActual[row.room] = (roomActual[row.room] || 0) + 1;
        }
        actualRequiredByRoom = requiredFromRows(todayRows);
      }
    }

    const planRequiredByRoom = await loadPlanOfDayRequired(centreId, date);

    const allRoomNames = new Set([
      ...Object.keys(lastWeekByRoom),
      ...Object.keys(roomBooked),
      ...Object.keys(roomActual),
      ...Object.keys(lastWeekRequiredByRoom),
      ...Object.keys(actualRequiredByRoom),
      ...Object.keys(planRequiredByRoom),
    ]);

    const roomsOut = {};
    for (const room of allRoomNames) {
      const bookedCount = roomBooked[room] ?? null;
      const expectedCount = lastWeekByRoom[room] ?? null;
      const required = planRequiredByRoom[room]
        ?? actualRequiredByRoom[room]
        ?? lastWeekRequiredByRoom[room]
        ?? null;

      roomsOut[room] = {
        expected: expectedCount,
        weeksUsed: expectedCount !== null ? 1 : 0,
        booked: bookedCount,
        actual: roomActual[room] ?? null,
        required,
      };
    }

    return res.status(200).json({
      booked:   occ?.booked   ?? null,
      actual:   actualAttendance,
      capacity: occ?.capacity ?? null,
      rooms: roomsOut,
      lastWeek: lastWeekStr,
    });
  } catch (e) {
    console.error('[room-forecast] error:', e.message);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
