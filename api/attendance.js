const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

/** Calculate age in months from DOB for a target date (AEST) */
function calcAgeMonths(dobStr, targetStr) {
  if (!dobStr || !targetStr) return null;
  const dob    = new Date(dobStr + 'T00:00:00+10:00');
  const target = new Date(targetStr + 'T12:00:00+10:00');
  const months = (target.getFullYear() - dob.getFullYear()) * 12
    + (target.getMonth() - dob.getMonth())
    + (target.getDate() < dob.getDate() ? -1 : 0);
  return Math.max(0, months);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache attendance for 3 minutes — data only changes when snapshots run (8am/10:15am/6:30pm)
  res.setHeader('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { campus, date } = req.query;
  const campusFilter = campus ? `&campus=eq.${encodeURIComponent(campus)}` : '';
  const select       = campus
    ? 'child_name,room,sign_in,sign_out,predicted_sign_out,age,updated_at'
    : 'campus,child_name,room,sign_in,sign_out,predicted_sign_out,age,updated_at';
  const base = `${SUPABASE_URL}/rest/v1/attendance_daily?date=eq.${date}${campusFilter}&select=${select}&order=campus,room,child_name`;

  // Fetch all pages — service role key bypasses RLS; paginate to beat the 1000-row default cap
  const PAGE = 1000;
  const all  = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${base}&limit=${PAGE}&offset=${offset}`;
    const r   = await fetch(url, {
      headers: {
        apikey:          SERVICE_KEY,
        Authorization:   `Bearer ${SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  // Fetch DOBs from children_enrolled so we can recalculate age accurately for the target date
  const campusNames = campus ? [campus] : [...new Set(all.map(r => r.campus).filter(Boolean))];
  const dobLookup = {};
  if (campusNames.length > 0) {
    try {
      const dobUrl = `${SUPABASE_URL}/rest/v1/children_enrolled?select=full_name,campus,dob&campus=in.(${campusNames.map(c => encodeURIComponent(c)).join(',')})&limit=5000`;
      const dobRes = await fetch(dobUrl, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (dobRes.ok) {
        const enrolled = await dobRes.json();
        for (const c of enrolled) {
          const key = `${(c.campus ?? '').toLowerCase().trim()}|${(c.full_name ?? '').toLowerCase().trim()}`;
          dobLookup[key] = c.dob;
        }
      }
    } catch (e) {
      console.error('[attendance] DOB fetch failed:', e.message);
    }
  }

  // Recalculate ageMonths from DOB for every record
  const enriched = all.map(r => {
    const key = `${(r.campus ?? '').toLowerCase().trim()}|${(r.child_name ?? '').toLowerCase().trim()}`;
    const dob = dobLookup[key] ?? null;
    const ageMonths = dob ? calcAgeMonths(dob, date) : null;
    return { ...r, dob, ageMonths };
  });

  res.status(200).json(enriched);
}
