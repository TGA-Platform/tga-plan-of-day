/**
 * /api/staff-accidents
 *
 * GET  ?staffId=xxx         → all accidents for a staff member
 * GET  ?centreId=xxx        → all accidents for a centre
 * POST  body                → create new accident
 * PATCH ?id=xxx body        → update accident
 * DELETE ?id=xxx            → delete accident
 *
 * Table: staff_accidents
 * CREATE TABLE IF NOT EXISTS staff_accidents (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   staff_id TEXT NOT NULL,
 *   centre_id TEXT NOT NULL,
 *   staff_name TEXT,
 *   incident_date DATE NOT NULL,
 *   time_of_injury TEXT,
 *   specific_location TEXT,
 *   circumstances TEXT,
 *   injury_type TEXT NOT NULL DEFAULT 'Sprain/Strain',
 *   location_on_body TEXT,
 *   first_aid_provided TEXT,
 *   medical_attention BOOLEAN DEFAULT FALSE,
 *   worker_comp_claim BOOLEAN DEFAULT FALSE,
 *   return_to_work_date DATE,
 *   status TEXT NOT NULL DEFAULT 'New',
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
    // Table doesn't exist yet — return empty array gracefully
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

  // GET — fetch accidents
  if (req.method === 'GET') {
    const { staffId, centreId } = req.query;
    try {
      let path = '/staff_accidents?order=incident_date.desc';
      if (staffId) path += `&staff_id=eq.${staffId}`;
      else if (centreId) path += `&centre_id=eq.${centreId}`;
      else return res.status(400).json({ error: 'staffId or centreId required' });
      const data = await sbGet(path);
      return res.json(data);
    } catch (err) {
      console.error('staff-accidents GET error:', err);
      // If table doesn't exist, return empty rather than 500
      if (err.message && (err.message.includes('does not exist') || err.message.includes('relation'))) {
        return res.json([]);
      }
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — create accident
  if (req.method === 'POST') {
    const body = req.body || {};
    try {
      const row = {
        staff_id: body.staff_id,
        centre_id: body.centre_id,
        staff_name: body.staff_name || null,
        incident_date: body.incident_date,
        time_of_injury: body.time_of_injury || null,
        specific_location: body.specific_location || null,
        circumstances: body.circumstances || null,
        injury_type: body.injury_type || 'Sprain/Strain',
        location_on_body: body.location_on_body || null,
        first_aid_provided: body.first_aid_provided || null,
        medical_attention: body.medical_attention || false,
        worker_comp_claim: body.worker_comp_claim || false,
        return_to_work_date: body.return_to_work_date || null,
        status: body.status || 'New',
      };
      if (!row.staff_id || !row.incident_date) {
        return res.status(400).json({ error: 'staff_id and incident_date required' });
      }
      const [created] = await sbPost('/staff_accidents', row);
      return res.json(created);
    } catch (err) {
      console.error('staff-accidents POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH — update accident
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    try {
      const patch = {};
      const fields = ['staff_name','incident_date','time_of_injury','specific_location','circumstances','injury_type','location_on_body','first_aid_provided','medical_attention','worker_comp_claim','return_to_work_date','status'];
      for (const f of fields) {
        if (f in body) patch[f] = body[f] === '' ? null : body[f];
      }
      const [updated] = await sbPatch(`/staff_accidents?id=eq.${id}`, patch);
      return res.json(updated || { ok: true });
    } catch (err) {
      console.error('staff-accidents PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — delete accident
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await sbDelete(`/staff_accidents?id=eq.${id}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('staff-accidents DELETE error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
