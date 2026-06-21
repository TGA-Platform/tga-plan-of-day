/**
 * /api/children-enrolled
 * GET /api/children-enrolled?campus=Oatley
 *
 * Returns enrolled children with DOBs for a campus.
 * Used by the ratio dashboard for future-date ratio planning.
 * Each child's age is calculated client-side at the target date.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = '***';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=300'); // 1hr cache
  if (req.method === 'OPTIONS') return res.status(200).end();

  const campus = req.query.campus;
  if (!campus) return res.status(400).json({ error: 'campus is required' });

  // Fetch all confirmed enrolled children for this campus
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/children_enrolled?campus=eq.${encodeURIComponent(campus)}&status=eq.Confirmed&select=full_name,dob,room&order=full_name.asc&limit=2000`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );

  if (!r.ok) return res.status(500).json({ error: `Supabase error ${r.status}` });

  const rows = await r.json();
  res.status(200).json(rows);
}
