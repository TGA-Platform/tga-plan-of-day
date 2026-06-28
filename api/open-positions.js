/**
 * /api/open-positions
 *
 * GET  ?centreId=xxx        → all positions for a centre
 * GET  ?centreId=xxx&roomId=yyy  → positions for a specific room
 * POST  body                → create position
 * PATCH ?id=xxx body        → update position
 * DELETE ?id=xxx            → delete position
 *
 * Table: open_positions
 * CREATE TABLE IF NOT EXISTS open_positions (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   centre_id TEXT NOT NULL,
 *   room_id TEXT,
 *   title TEXT NOT NULL,
 *   qualification_required TEXT,
 *   status TEXT NOT NULL DEFAULT 'Open',
 *   notes TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const SB = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: HEADERS });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 404 || t.includes('does not exist') || t.includes('relation')) return [];
    throw new Error(`Supabase GET ${r.status}: ${t}`);
  }
  return r.json();
}

async function sbPost(path, body) {
  const r = await fetch(`${SB}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase POST ${r.status}: ${t}`); }
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SB}${path}`, { method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase PATCH ${r.status}: ${t}`); }
  return r.json();
}

async function sbDelete(path) {
  const r = await fetch(`${SB}${path}`, { method: 'DELETE', headers: HEADERS });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase DELETE ${r.status}: ${t}`); }
  return r.status === 204 ? null : r.json().catch(() => null);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch open positions
  if (req.method === 'GET') {
    const { centreId, roomId } = req.query;
    if (!centreId) return res.status(400).json({ error: 'centreId required' });
    try {
      let path = `/open_positions?centre_id=eq.${centreId}&order=created_at.desc`;
      if (roomId) path += `&room_id=eq.${roomId}`;
      const data = await sbGet(path);
      return res.json(data);
    } catch (err) {
      console.error('open-positions GET error:', err);
      if (err.message && (err.message.includes('does not exist') || err.message.includes('relation'))) {
        return res.json([]);
      }
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — create position
  if (req.method === 'POST') {
    const body = req.body || {};
    try {
      const row = {
        id: body.id || crypto.randomUUID(),
        centre_id: body.centre_id,
        room_id: body.room_id || null,
        title: body.title,
        qualification_required: body.qualification_required || null,
        status: body.status || 'Open',
        notes: body.notes || null,
      };
      if (!row.centre_id || !row.title) {
        return res.status(400).json({ error: 'centre_id and title required' });
      }
      const [created] = await sbPost('/open_positions', row);
      return res.json(created);
    } catch (err) {
      console.error('open-positions POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH — update position
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    try {
      const patch = {};
      const fields = ['title', 'qualification_required', 'room_id', 'status', 'notes'];
      for (const f of fields) {
        if (f in body) patch[f] = body[f] === '' ? null : body[f];
      }
      const [updated] = await sbPatch(`/open_positions?id=eq.${id}`, patch);
      return res.json(updated || { ok: true });
    } catch (err) {
      console.error('open-positions PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — delete position
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await sbDelete(`/open_positions?id=eq.${id}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('open-positions DELETE error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
