/**
 * /api/children-expected
 * GET /api/children-expected?campus=Oatley&date=2026-06-22
 *
 * Returns the expected children for a future date based on historical
 * attendance patterns for that day of the week.
 *
 * Strategy: use the same weekday last week in attendance_daily.
 * A child is "expected" if they actually attended on that day.
 * Their room is taken from that attendance record.
 * Age is sourced from children_enrolled (DOB) and projected to the target date.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

async function supabase(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Find the most recent previous same-weekday with attendance data, up to maxWeeks back. */
async function findHistoricalDate(campus, targetDateStr, maxWeeks = 8) {
  const target = new Date(targetDateStr + 'T12:00:00+10:00');
  for (let weeksBack = 1; weeksBack <= maxWeeks; weeksBack++) {
    const d = new Date(target);
    d.setDate(d.getDate() - 7 * weeksBack);
    const dStr = d.toISOString().slice(0, 10);
    const rows = await supabase(
      `attendance_daily?select=child_name&campus=eq.${encodeURIComponent(campus)}&date=eq.${dStr}&limit=1`
    );
    if (Array.isArray(rows) && rows.length > 0) return dStr;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { campus, date } = req.query;
  if (!campus || !date) return res.status(400).json({ error: 'campus and date are required' });

  // Same weekday last week, falling back to the most recent previous same-weekday with data
  const target = new Date(date + 'T12:00:00+10:00');
  const historicalDate = await findHistoricalDate(campus, date, 8);

  // Fetch actual attendance for the historical day
  const [attendanceRows, enrolledRows] = await Promise.all([
    historicalDate
      ? supabase(
          `attendance_daily?select=child_name,date,room,age&campus=eq.${encodeURIComponent(campus)}&date=eq.${historicalDate}&limit=2000`
        )
      : Promise.resolve([]),
    supabase(
      `children_enrolled?select=full_name,dob,room&campus=eq.${encodeURIComponent(campus)}&status=eq.Confirmed&limit=2000`
    ),
  ]);

  // Build DOB lookup from enrolled table
  const dobLookup = {};
  for (const c of enrolledRows) {
    dobLookup[c.full_name?.toLowerCase().trim()] = c.dob;
  }

  // One record per child from the historical attendance
  const seen = new Map(); // child_name -> { room, dob }
  for (const row of attendanceRows) {
    const key = row.child_name?.toLowerCase().trim();
    if (!key) continue;
    if (!seen.has(key)) {
      const dob = dobLookup[key] ?? null;
      seen.set(key, { full_name: row.child_name, room: row.room, dob });
    }
  }

  // Project age at the target date
  const result = [...seen.values()].map(c => {
    let ageMonths = null;
    if (c.dob) {
      const dob = new Date(c.dob + 'T00:00:00+10:00');
      const months = (target.getFullYear() - dob.getFullYear()) * 12
        + (target.getMonth() - dob.getMonth())
        + (target.getDate() < dob.getDate() ? -1 : 0);
      ageMonths = Math.max(0, months);
    }
    return { full_name: c.full_name, room: c.room, dob: c.dob, ageMonths };
  });

  // Short cache — re-check each time (rosters change)
  res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=300'); // 15 min
  res.status(200).json({ children: result, historicalDate });
}
