/**
 * POST { centreId, employees: [{ employeeId, employeeName }] }
 * → links Deputy employees to internal staff_members records.
 * Matches by deputy_employee_id first, then by name. Creates a minimal
 * staff_members row if no match is found so Deputy imports always link.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Prefer: 'return=representation',
};

export default async function handler(req, res) {
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { centreId, employees } = req.body || {};
  if (!centreId || !Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'centreId and employees array required' });
  }

  try {
    const employeeIds = [...new Set(employees.map(e => String(e.employeeId)))];
    const byId = new Map(employees.map(e => [String(e.employeeId), e.employeeName || '']));

    // 1. Load existing staff by deputy_employee_id
    const idFilter = employeeIds.map(id => `deputy_employee_id=eq.${encodeURIComponent(id)}`).join(',');
    const byDeputyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff_members?centre_id=eq.${encodeURIComponent(centreId)}&or=(${idFilter})&select=*`,
      { headers: HEADERS }
    );
    if (!byDeputyRes.ok) throw new Error('staff lookup by deputy id failed');
    const byDeputy = await byDeputyRes.json();

    const links = {}; // deputyEmployeeId -> staff_members.id
    const staff = [...byDeputy];
    const matchedByDeputy = new Set();
    for (const s of byDeputy) {
      if (s.deputy_employee_id) {
        links[s.deputy_employee_id] = s.id;
        matchedByDeputy.add(s.deputy_employee_id);
      }
    }

    // 2. For unmatched, try name match
    const unmatchedIds = employeeIds.filter(id => !matchedByDeputy.has(id));
    if (unmatchedIds.length > 0) {
      const names = unmatchedIds.map(id => byId.get(id)).filter(Boolean);
      if (names.length > 0) {
        const nameFilter = names.map(n => `name=ilike.${encodeURIComponent(n)}`).join(',');
        const byNameRes = await fetch(
          `${SUPABASE_URL}/rest/v1/staff_members?centre_id=eq.${encodeURIComponent(centreId)}&or=(${nameFilter})&select=*`,
          { headers: HEADERS }
        );
        if (byNameRes.ok) {
          const byName = await byNameRes.json();
          for (const id of unmatchedIds) {
            const expectedName = byId.get(id);
            const match = byName.find(s => s.name?.toLowerCase() === expectedName.toLowerCase());
            if (match) {
              // Update the existing staff record with deputy_employee_id
              const patchRes = await fetch(
                `${SUPABASE_URL}/rest/v1/staff_members?id=eq.${match.id}`,
                {
                  method: 'PATCH',
                  headers: HEADERS,
                  body: JSON.stringify({ deputy_employee_id: id, updated_at: new Date().toISOString() }),
                }
              );
              if (patchRes.ok) {
                links[id] = match.id;
                staff.push({ ...match, deputy_employee_id: id });
              }
            }
          }
        }
      }
    }

    // 3. Create minimal records for still-unmatched employees
    const stillUnmatched = employeeIds.filter(id => !links[id]);
    for (const id of stillUnmatched) {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/staff_members`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          centre_id: centreId,
          name: byId.get(id) || `Deputy Staff ${id}`,
          deputy_employee_id: id,
          employment_status: 'Active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      if (insertRes.ok) {
        const rows = await insertRes.json().catch(() => null);
        const created = Array.isArray(rows) ? rows[0] : rows;
        if (created) {
          links[id] = created.id;
          staff.push(created);
        }
      }
    }

    return res.status(200).json({ ok: true, links, staff });
  } catch (e) {
    console.error('deputy-staff-link error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
