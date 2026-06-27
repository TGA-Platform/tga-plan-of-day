/**
 * /api/staff-issues
 *
 * GET  ?staffId=xxx         → all issues for a staff member
 * GET  ?centreId=xxx        → all issues for a centre
 * POST  body                → create new issue
 * PATCH ?id=xxx body        → update issue
 * DELETE ?id=xxx            → delete issue
 *
 * Table: staff_issues
 * CREATE TABLE IF NOT EXISTS staff_issues (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   staff_id TEXT NOT NULL,
 *   centre_id TEXT NOT NULL,
 *   staff_name TEXT,
 *   issue_type TEXT NOT NULL DEFAULT 'Performance',
 *   severity TEXT NOT NULL DEFAULT 'Minor',
 *   date_raised DATE NOT NULL,
 *   raised_by TEXT,
 *   description TEXT NOT NULL,
 *   action_taken TEXT,
 *   outcome TEXT,
 *   status TEXT NOT NULL DEFAULT 'Open',
 *   follow_up_date DATE,
 *   hr_involved BOOLEAN DEFAULT FALSE,
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

  // GET — fetch issues
  if (req.method === 'GET') {
    const { staffId, centreId } = req.query;
    try {
      let path = '/staff_issues?order=date_raised.desc';
      if (staffId) path += `&staff_id=eq.${staffId}`;
      else if (centreId) path += `&centre_id=eq.${centreId}`;
      else return res.status(400).json({ error: 'staffId or centreId required' });
      const data = await sbGet(path);
      return res.json(data);
    } catch (err) {
      console.error('staff-issues GET error:', err);
      if (err.message && (err.message.includes('does not exist') || err.message.includes('relation'))) {
        return res.json([]);
      }
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — create issue
  if (req.method === 'POST') {
    const body = req.body || {};
    try {
      const row = {
        staff_id: body.staff_id,
        centre_id: body.centre_id,
        staff_name: body.staff_name || null,
        issue_type: body.issue_type || 'Performance',
        severity: body.severity || 'Minor',
        date_raised: body.date_raised,
        raised_by: body.raised_by || null,
        description: body.description,
        action_taken: body.action_taken || null,
        outcome: body.outcome || null,
        status: body.status || 'Open',
        follow_up_date: body.follow_up_date || null,
        hr_involved: body.hr_involved || false,
      };
      if (!row.staff_id || !row.date_raised || !row.description) {
        return res.status(400).json({ error: 'staff_id, date_raised, and description required' });
      }
      const [created] = await sbPost('/staff_issues', row);
      return res.json(created);
    } catch (err) {
      console.error('staff-issues POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH — update issue
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    try {
      const patch = {};
      const fields = ['staff_name','issue_type','severity','date_raised','raised_by','description','action_taken','outcome','status','follow_up_date','hr_involved'];
      for (const f of fields) {
        if (f in body) patch[f] = body[f] === '' ? null : body[f];
      }
      const [updated] = await sbPatch(`/staff_issues?id=eq.${id}`, patch);
      return res.json(updated || { ok: true });
    } catch (err) {
      console.error('staff-issues PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — delete issue
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await sbDelete(`/staff_issues?id=eq.${id}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('staff-issues DELETE error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
