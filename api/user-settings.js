/**
 * /api/user-settings
 * GET  → returns all user settings
 * POST → upserts settings for one or more users
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HEADERS = {
  apikey:          SERVICE_KEY,
  Authorization:   `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
  Prefer:          'return=minimal',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?select=email,allowed_centre_ids`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json(await r.json());
  }

  if (req.method === 'POST') {
    // Expect array of { email, allowed_centre_ids }
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    const withTs = rows.map(r => ({ ...r, updated_at: new Date().toISOString() }));
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?on_conflict=email`,
      { method: 'POST', headers: HEADERS, body: JSON.stringify(withTs) }
    );
    if (r.status >= 300) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
