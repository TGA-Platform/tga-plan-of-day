/**
 * /api/staff-issues
 *
 * GET  ?centreId=bexley               → all issues for a centre
 * GET  ?all=true                      → all issues across all centres
 * POST body { action, ...params }
 *
 * Actions:
 *   create  { centre_id, staff_name, ... }
 *   update  { id, ...fields }
 *   delete  { id }
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
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase GET ${r.status}: ${t}`); }
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
  return r.status === 204 ? null : r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { centreId, all } = req.query;
      let path = '/staff_issues?order=date_raised.desc';
      if (!all && centreId) {
        path += `&centre_id=eq.${centreId}`;
      }
      const data = await sbGet(path);
      return res.json(data);
    } catch (err) {
      // If table doesn't exist yet, return empty array
      if (err.message && err.message.includes('42P01')) {
        return res.json([]);
      }
      console.error('staff-issues GET error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { action } = body;

    try {
      switch (action) {
        case 'create': {
          const { action: _a, ...fields } = body;
          if (!fields.staff_name || !fields.centre_id) {
            return res.status(400).json({ error: 'centre_id and staff_name required' });
          }
          const [created] = await sbPost('/staff_issues', {
            ...fields,
            created_at: new Date().toISOString(),
          });
          return res.json({ ok: true, data: created });
        }

        case 'update': {
          const { action: _a, id, ...fields } = body;
          if (!id) return res.status(400).json({ error: 'id required' });
          const [updated] = await sbPatch(`/staff_issues?id=eq.${id}`, {
            ...fields,
            updated_at: new Date().toISOString(),
          });
          return res.json({ ok: true, data: updated });
        }

        case 'delete': {
          const { id } = body;
          if (!id) return res.status(400).json({ error: 'id required' });
          await sbDelete(`/staff_issues?id=eq.${id}`);
          return res.json({ ok: true });
        }

        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      console.error('staff-issues POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
