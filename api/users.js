/**
 * /api/users
 * GET              → list all users
 * POST             → create user  { email, name, role, centreId, password }
 * PUT              → update user  { email, ...fields }
 * DELETE ?email=x  → remove user
 *
 * Supabase table required:
 *   CREATE TABLE IF NOT EXISTS app_users (
 *     email       TEXT PRIMARY KEY,
 *     name        TEXT NOT NULL,
 *     role        TEXT NOT NULL DEFAULT 'director',
 *     centre_id   TEXT,
 *     password    TEXT NOT NULL,
 *     created_at  TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at  TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "service_role all" ON app_users FOR ALL USING (true);
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' };
const BASE = `${SUPABASE_URL}/rest/v1/app_users`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list all users
  if (req.method === 'GET') {
    const r = await fetch(`${BASE}?select=email,name,role,centre_id,created_at&order=name`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist') || r.status === 404) return res.status(200).json([]);
      return res.status(r.status).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  // POST — create / upsert user
  if (req.method === 'POST') {
    const { email, name, role, centreId, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name, password required' });
    const row = { email: email.toLowerCase().trim(), name, role: role || 'director', centre_id: centreId || null, password, updated_at: new Date().toISOString() };
    const r = await fetch(`${BASE}?on_conflict=email`, { method: 'POST', headers: HDR, body: JSON.stringify(row) });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const rows = await r.json();
    return res.status(200).json(Array.isArray(rows) ? rows[0] : rows);
  }

  // PUT — update existing user
  if (req.method === 'PUT') {
    const { email, ...fields } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const update = { ...fields, updated_at: new Date().toISOString() };
    if (fields.centreId !== undefined) { update.centre_id = fields.centreId; delete update.centreId; }
    const r = await fetch(`${BASE}?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', headers: HDR, body: JSON.stringify(update),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  // DELETE — remove user
  if (req.method === 'DELETE') {
    const email = req.query?.email;
    if (!email) return res.status(400).json({ error: 'email required' });
    const r = await fetch(`${BASE}?email=eq.${encodeURIComponent(email)}`, {
      method: 'DELETE', headers: HDR,
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
