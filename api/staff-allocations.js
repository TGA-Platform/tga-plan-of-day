/**
 * /api/staff-allocations
 * GET  ?centre=xxx&date=yyyy-mm-dd  → load saved allocation
 * POST { centre_id, date, moves, saved_by }  → upsert
 * GET  ?centre=xxx&from=yyyy-mm-dd&to=yyyy-mm-dd  → history range
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HEADERS = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer:        'resolution=merge-duplicates,return=representation',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const base = `${SUPABASE_URL}/rest/v1/staff_allocations`;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { centre, date, from, to } = req.query;
    let url = base;

    if (centre === 'all' && date) {
      url += `?date=eq.${date}&select=*`;
    } else if (centre && date) {
      url += `?centre_id=eq.${encodeURIComponent(centre)}&date=eq.${date}&select=*`;
    } else if (centre && from && to) {
      url += `?centre_id=eq.${encodeURIComponent(centre)}&date=gte.${from}&date=lte.${to}&order=date.desc&select=*`;
    } else {
      return res.status(400).json({ error: 'Provide centre+date or centre+from+to' });
    }

    const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist') || r.status === 404) return res.status(200).json([]);
      return res.status(r.status).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { centre_id, date, moves, saved_by } = req.body;
    if (!centre_id || !date || !moves) return res.status(400).json({ error: 'Missing fields' });

    const row = { centre_id, date, moves, saved_by: saved_by ?? null, saved_at: new Date().toISOString() };
    const r = await fetch(`${base}?on_conflict=centre_id,date`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(row),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
