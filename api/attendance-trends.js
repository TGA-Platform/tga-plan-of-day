/**
 * /api/attendance-trends
 * GET ?campus=X&date=YYYY-MM-DD&slots=15:00,15:30,16:00,16:30,17:00,17:30
 *
 * Returns average children per room at each afternoon time slot,
 * based on the last 4 occurrences of the same day-of-week.
 *
 * Response: { [roomOwnaName]: number[] }  (parallel to slots array)
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMy XyS6f1c'.replace(' ', '');
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

function toMins(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { campus, date, slots: slotsParam } = req.query;
  if (!campus || !date) return res.status(400).json({ error: 'campus and date required' });

  const slots = (slotsParam ?? '15:00,15:30,16:00,16:30,17:00,17:30').split(',').map(s => s.trim());
  const slotMins = slots.map(toMins);

  // Day of week for the target date (0=Sun, 1=Mon, ...)
  const targetDow = new Date(date).getDay();

  // Fetch recent dates for this campus that have attendance data
  const lookbackUrl = `${SUPABASE_URL}/rest/v1/attendance_daily`
    + `?campus=ilike.${encodeURIComponent(campus)}`
    + `&date=lt.${date}`
    + `&select=date`
    + `&order=date.desc`
    + `&limit=500`;

  const datesRes = await fetch(lookbackUrl, { headers: HDR });
  if (!datesRes.ok) return res.status(500).json({ error: 'Failed to fetch dates' });
  const allDates: any[] = await datesRes.json();

  // Find last 4 occurrences of the same day of week
  const seen = new Set<string>();
  const matchingDates: string[] = [];
  for (const row of allDates) {
    if (seen.has(row.date)) continue;
    seen.add(row.date);
    if (new Date(row.date).getDay() === targetDow) {
      matchingDates.push(row.date);
      if (matchingDates.length >= 4) break;
    }
  }

  if (matchingDates.length === 0) {
    return res.status(200).json({ dates: [], trends: {} });
  }

  // Fetch attendance for each matching date
  const allRows: any[] = [];
  for (const d of matchingDates) {
    const url = `${SUPABASE_URL}/rest/v1/attendance_daily`
      + `?campus=ilike.${encodeURIComponent(campus)}`
      + `&date=eq.${d}`
      + `&select=room,sign_in,sign_out`
      + `&limit=500`;
    const r = await fetch(url, { headers: HDR });
    if (r.ok) {
      const rows = await r.json();
      allRows.push(...rows.map((row: any) => ({ ...row, _date: d })));
    }
  }

  // Build per-room, per-slot counts for each historical day
  const roomSet = new Set<string>(allRows.map((r: any) => r.room).filter(Boolean));
  const rooms   = [...roomSet];

  // trends[room][slotIdx] = [count_day0, count_day1, ...]
  const dayTrends: Record<string, Record<string, number[]>> = {};
  for (const d of matchingDates) dayTrends[d] = {};

  for (const d of matchingDates) {
    const dayRows = allRows.filter((r: any) => r._date === d);
    for (const room of rooms) {
      dayTrends[d][room] = slotMins.map(slotMin => {
        if (slotMin === null) return 0;
        return dayRows.filter((r: any) => {
          if (r.room !== room) return false;
          if (!r.sign_in) return false;
          const si = toMins(r.sign_in);
          if (si === null || si > slotMin) return false;
          // If sign_out is recorded, check if still present
          const so = r.sign_out ? toMins(r.sign_out) : 24 * 60;
          return so !== null && so > slotMin;
        }).length;
      });
    }
  }

  // Average across matching days
  const trends: Record<string, number[]> = {};
  for (const room of rooms) {
    trends[room] = slotMins.map((_, si) => {
      const counts = matchingDates.map(d => dayTrends[d][room]?.[si] ?? 0);
      return Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
    });
  }

  return res.status(200).json({ dates: matchingDates, slots, trends });
}
