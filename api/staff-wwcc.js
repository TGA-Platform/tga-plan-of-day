/**
 * /api/staff-wwcc
 * GET /api/staff-wwcc?names=John+Smith,Jane+Doe
 *
 * Returns WWCC number + expiry for the requested educator names.
 * Matches by normalised name (lowercase, trimmed).
 * Also accepts GET /api/staff-wwcc (no params) to return all records.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function normaliseName(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60'); // 5 min cache
  if (req.method === 'OPTIONS') return res.status(200).end();

  const namesParam = req.query.names;

  let url;
  if (namesParam) {
    // Look up specific names
    const normed = namesParam.split(',')
      .map(n => normaliseName(decodeURIComponent(n)))
      .filter(Boolean);
    // PostgREST: full_name_norm=in.(name1,name2,...)
    const inList = normed.map(n => `"${n}"`).join(',');
    url = `${SUPABASE_URL}/rest/v1/staff_wwcc?full_name_norm=in.(${encodeURIComponent(inList)})&select=full_name,full_name_norm,wwcc_number,wwcc_expiry,centre`;
  } else {
    // Return all
    url = `${SUPABASE_URL}/rest/v1/staff_wwcc?select=full_name,full_name_norm,wwcc_number,wwcc_expiry,centre&limit=2000`;
  }

  const r = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });

  if (!r.ok) {
    return res.status(500).json({ error: `Supabase error ${r.status}` });
  }

  const rows = await r.json();
  res.status(200).json(rows);
}
