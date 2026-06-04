/**
 * /api/centre-rules
 * GET                       → all rules
 * POST  { body }            → create / upsert
 * DELETE ?id=xxx            → remove
 *
 * Supabase table:
 *   CREATE TABLE IF NOT EXISTS centre_rules (
 *     id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     type         TEXT NOT NULL,           -- 'break_window'
 *     subtype      TEXT,                    -- 'morning_tea' | 'lunch' | 'afternoon_tea' | 'custom'
 *     label        TEXT NOT NULL,
 *     start_time   TEXT NOT NULL,           -- HH:MM
 *     end_time     TEXT NOT NULL,           -- HH:MM
 *     duration_mins INTEGER DEFAULT 30,
 *     centre_ids   JSONB NOT NULL DEFAULT '["*"]',
 *     created_at   TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at   TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   ALTER TABLE centre_rules ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "service_role all" ON centre_rules FOR ALL USING (true);
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const BASE = `${SUPABASE_URL}/rest/v1/centre_rules`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const r = await fetch(`${BASE}?order=type,subtype,start_time`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist') || r.status === 404) return res.status(200).json([]);
      return res.status(r.status).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  if (req.method === 'POST') {
    const { id, type, subtype, label, start_time, end_time, duration_mins, centre_ids } = req.body;
    if (!type || !label || !start_time || !end_time) return res.status(400).json({ error: 'Missing required fields' });
    const row = {
      ...(id ? { id } : {}),
      type, subtype: subtype || null, label, start_time, end_time,
      duration_mins: duration_mins ?? 30,
      centre_ids: centre_ids ?? ['*'],
      updated_at: new Date().toISOString(),
    };
    const prefer = id ? 'resolution=merge-duplicates,return=representation' : 'return=representation';
    const r = await fetch(`${BASE}${id ? '?on_conflict=id' : ''}`, {
      method: 'POST',
      headers: { ...HDR, Prefer: prefer },
      body: JSON.stringify(row),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const rows = await r.json();
    return res.status(200).json(Array.isArray(rows) ? rows[0] : rows);
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await fetch(`${BASE}?id=eq.${id}`, { method: 'DELETE', headers: HDR });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
