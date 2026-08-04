/**
 * /api/family-grouping-templates
 *
 * GET  ?centre_id=xxx              -> list templates for centre
 * GET  ?id=xxx                     -> single template
 * POST { centre_id, name, days_of_week, template_data, created_by } -> create
 * PATCH { id, name, days_of_week, template_data } -> update
 * DELETE ?id=xxx                   -> delete
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const base = `${SUPABASE_URL}/rest/v1/family_grouping_templates`;

  try {
    if (req.method === 'GET') {
      const { centre_id, id } = req.query;
      if (id) {
        const r = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=*`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        if (!r.ok) return res.status(r.status).json({ error: await r.text() });
        const rows = await r.json();
        return res.status(200).json(rows[0] ?? null);
      }
      if (!centre_id) return res.status(400).json({ error: 'centre_id required' });
      const r = await fetch(
        `${base}?centre_id=eq.${encodeURIComponent(centre_id)}&select=*&order=created_at.asc`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json(await r.json());
    }

    if (req.method === 'POST') {
      const { centre_id, name, days_of_week, template_data, created_by } = req.body;
      if (!centre_id || !name || !Array.isArray(days_of_week)) {
        return res.status(400).json({ error: 'centre_id, name, days_of_week required' });
      }
      const row = {
        centre_id,
        name,
        days_of_week,
        template_data: template_data ?? [],
        created_by,
        updated_at: new Date().toISOString(),
      };
      const r = await fetch(base, { method: 'POST', headers: HEADERS, body: JSON.stringify(row) });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json(await r.json());
    }

    if (req.method === 'PATCH') {
      const { id, name, days_of_week, template_data } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const patch = { updated_at: new Date().toISOString() };
      if (name !== undefined) patch.name = name;
      if (days_of_week !== undefined) patch.days_of_week = days_of_week;
      if (template_data !== undefined) patch.template_data = template_data;
      const r = await fetch(
        `${base}?id=eq.${encodeURIComponent(id)}`,
        { method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch) }
      );
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json(await r.json());
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const r = await fetch(
        `${base}?id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=minimal' } }
      );
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
