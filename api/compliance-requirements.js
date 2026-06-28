/**
 * /api/compliance-requirements
 *
 * GET                → all requirements
 * POST body { requirements: [...] } → replace all requirements
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

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

async function sbPost(path, body, extraHeaders = {}) {
  const r = await fetch(`${SB}${path}`, { method: 'POST', headers: { ...HEADERS, ...extraHeaders }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase POST ${r.status}: ${t}`); }
  return r.json();
}

async function sbDelete(path) {
  const r = await fetch(`${SB}${path}`, { method: 'DELETE', headers: HEADERS });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase DELETE ${r.status}: ${t}`); }
  return r.status === 204 ? null : r.json().catch(() => null);
}

function toDbRow(req, sortOrder) {
  return {
    id: req.id,
    label: req.label,
    category: req.category,
    required_for: req.requiredFor || [],
    required_for_qualifications: req.requiredForQualifications || [],
    expiry_field: req.expiryField || null,
    doc_pattern: req.docPattern ? req.docPattern.source : null,
    is_mandatory: req.isMandatory ?? true,
    description: req.description || null,
    sort_order: sortOrder,
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    requiredFor: row.required_for || [],
    requiredForQualifications: row.required_for_qualifications || [],
    expiryField: row.expiry_field || undefined,
    docPattern: row.doc_pattern ? new RegExp(row.doc_pattern, 'i') : undefined,
    isMandatory: row.is_mandatory,
    description: row.description || undefined,
    sortOrder: row.sort_order,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const rows = await sbGet('/compliance_requirements?order=sort_order.asc');
      return res.json(rows.map(fromDbRow));
    } catch (err) {
      console.error('compliance-requirements GET error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { requirements } = body;
    if (!Array.isArray(requirements)) {
      return res.status(400).json({ error: 'requirements array required' });
    }

    try {
      // 1. Fetch existing IDs
      const existing = await sbGet('/compliance_requirements?select=id');
      const existingIds = new Set(existing.map(r => r.id));
      const newIds = new Set(requirements.map(r => r.id));
      const removedIds = Array.from(existingIds).filter(id => !newIds.has(id));

      // 2. Upsert all current requirements
      const rows = requirements.map((req, i) => toDbRow(req, i));
      if (rows.length > 0) {
        await sbPost('/compliance_requirements?on_conflict=id', rows, {
          Prefer: 'resolution=merge-duplicates,return=representation',
        });
      }

      // 3. Delete removed requirements
      if (removedIds.length > 0) {
        await sbDelete(`/compliance_requirements?id=in.(${removedIds.join(',')})`);
      }

      return res.json({ ok: true, count: requirements.length });
    } catch (err) {
      console.error('compliance-requirements POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
