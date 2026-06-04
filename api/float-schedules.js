/**
 * /api/float-schedules
 * GET  ?centre=xxx&date=yyy[&employee=zzz]  → fetch schedules
 * POST { centre_id, date, employee_id, employee_name, schedule, saved_by }  → upsert
 *
 * Required Supabase table:
 *   CREATE TABLE IF NOT EXISTS float_schedules (
 *     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     centre_id TEXT NOT NULL,
 *     date DATE NOT NULL,
 *     employee_id INTEGER NOT NULL,
 *     employee_name TEXT,
 *     schedule JSONB NOT NULL DEFAULT '[]',
 *     saved_by TEXT,
 *     saved_at TIMESTAMPTZ DEFAULT NOW(),
 *     UNIQUE(centre_id, date, employee_id)
 *   );
 *   ALTER TABLE float_schedules ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "service_role all" ON float_schedules FOR ALL USING (true);
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HDRS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const base = `${SUPABASE_URL}/rest/v1/float_schedules`;

  if (req.method === 'GET') {
    const { centre, date, employee } = req.query;
    if (!centre || !date) return res.status(400).json({ error: 'centre and date required' });
    let url = `${base}?centre_id=eq.${encodeURIComponent(centre)}&date=eq.${date}&select=*`;
    if (employee) url += `&employee_id=eq.${employee}`;

    const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist') || r.status === 404) return res.status(200).json([]);
      return res.status(r.status).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  if (req.method === 'POST') {
    const { centre_id, date, employee_id, employee_name, schedule, saved_by } = req.body;
    if (!centre_id || !date || !employee_id) return res.status(400).json({ error: 'Missing fields' });
    const row = { centre_id, date, employee_id, employee_name, schedule, saved_by, saved_at: new Date().toISOString() };
    const r = await fetch(`${base}?on_conflict=centre_id,date,employee_id`, {
      method: 'POST', headers: HDRS, body: JSON.stringify(row),
    });
    if (r.status >= 300) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
