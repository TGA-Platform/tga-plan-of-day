/** POST { email, password } → 200 { user } / 401 invalid */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email,name,role,centre_id,password&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!r.ok) {
      const txt = await r.text();
      // Table doesn't exist yet — return 404 so client falls back to config
      if (txt.includes('does not exist')) return res.status(404).json({ error: 'no db users' });
      return res.status(500).json({ error: 'db error' });
    }
    const rows = await r.json();
    if (!rows.length) return res.status(401).json({ error: 'not found' });
    if (rows[0].password !== password) return res.status(401).json({ error: 'invalid password' });
    // Return user object (without password)
    const { password: _pw, ...user } = rows[0];
    // Normalise role: ceo/admin both map to admin; area_manager passes through
    const VALID_ROLES = ['admin', 'area_manager', 'director', 'ceo'];
    const role = VALID_ROLES.includes(user.role) ? user.role : 'director';
    const userObj = {
      email:    user.email,
      name:     user.name,
      role,
      centreId: user.centre_id ?? null,
    };
    return res.status(200).json({ ok: true, user: userObj });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
