/**
 * /api/children-expected
 * GET /api/children-expected?campus=Oatley&date=2026-06-22
 *
 * Returns the expected children for a future date based on historical
 * attendance patterns for that day of the week.
 *
 * Strategy: look back up to 4 same-weekday occurrences in attendance_daily.
 * A child is "expected" if they attended on that weekday in any of those weeks.
 * Their room is taken from the most recent occurrence.
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { campus, date } = req.query;
  if (!campus || !date) return res.status(400).json({ error: 'campus and date are required' });

  // Build the last 4 same-weekday dates before the target date
  const target = new Date(date + 'T12:00:00+10:00');
  const lookbackDates = [];
  for (let i = 1; i <= 4; i++) {
    const d = new Date(target);
    d.setDate(d.getDate() - i * 7);
    lookbackDates.push(d.toISOString().slice(0, 10));
  }

  // Fetch attendance for those 4 dates
  const dateFilter = lookbackDates.map(d => `date.eq.${d}`).join(',');
  const [attendanceRows, enrolledRows] = await Promise.all([
    supabase(
      `attendance_daily?select=child_name,date,room,age&campus=eq.${encodeURIComponent(campus)}&or=(${dateFilter})&limit=2000&order=date.desc`
    ),
    supabase(
      `children_enrolled?select=full_name,dob,room&campus=eq.${encodeURIComponent(campus)}&status=eq.Confirmed&limit=2000`
    ),
  ]);

  // Build DOB lookup from enrolled table
  const dobLookup = {};
  for (const c of enrolledRows) {
    dobLookup[c.full_name?.toLowerCase().trim()] = c.dob;
  }

  // Deduplicate: keep most recent room per child
  const seen = new Map(); // child_name -> { room, age, dob }
  for (const row of attendanceRows) {
    const key = row.child_name?.toLowerCase().trim();
    if (!key) continue;
    if (!seen.has(key)) {
      // Most recent occurrence (rows ordered by date desc)
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
  res.status(200).json(result);
}
