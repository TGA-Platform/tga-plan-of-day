/**
 * GET ?centreId=... → staff members for a centre
 * Used by Roster Builder and Kiosk PIN management as the central staff source.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = proces…_KEY || 'eyJhbG…6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { centreId, includeInactive } = req.query;
  if (!centreId) return res.status(400).json({ error: 'centreId required' });

  try {
    let url = `${SUPABASE_URL}/rest/v1/staff_members?centre_id=eq.${encodeURIComponent(centreId)}&order=name.asc&select=*`;
    if (includeInactive !== 'true') {
      url += `&employment_status=not.in.(Inactive,Resigned,Exited)`;
    }
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error('staff lookup failed');
    const rows = await r.json();
    return res.status(200).json({ ok: true, staff: rows });
  } catch (e) {
    console.error('staff-members error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
