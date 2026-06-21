/**
 * /api/staff-wwcc
 * GET /api/staff-wwcc?names=John+Smith,Jane+Doe
 *
 * Returns WWCC number + expiry for the requested educator names.
 * Matches by normalised name (lowercase, trimmed).
 * Also accepts GET /api/staff-wwcc (no params) to return all records.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function normaliseName(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60'); // 5 min cache
  if (req.method === 'OPTIONS') return res.status(200).end();

  const namesParam = req.query.names;

  // Fetch ALL records in two pages to work around Supabase's 1000-row default limit.
  // Order: under_18 DESC first (so exempt-staff records are never cut off),
  // then by wwcc_expiry DESC (latest valid WWCC wins dedup within same name).
  const base = `${SUPABASE_URL}/rest/v1/staff_wwcc?select=monday_item_id,full_name,full_name_norm,wwcc_number,wwcc_expiry,under_18,is_internal_casual,centre&order=under_18.desc.nullslast,wwcc_expiry.desc.nullslast`;

  const [r1, r2] = await Promise.all([
    fetch(`${base}&limit=1000&offset=0`,    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
    fetch(`${base}&limit=1000&offset=1000`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
  ]);

  if (!r1.ok) return res.status(500).json({ error: `Supabase error ${r1.status}` });

  const all = [...(await r1.json()), ...(r2.ok ? await r2.json() : [])];

  // Deduplicate by full_name_norm.
  // Preference order: staffing board records (monday_item_id starts with 'sb_')
  // beat onboarding board records (plain numeric IDs), and real WWCC beats
  // placeholder/null. Within same source, expiry DESC (latest wins).
  // Strategy: collect all rows per norm, then pick the best one.
  const byNorm = new Map();
  for (const row of all) {
    const norm = row.full_name_norm;
    if (!norm) continue;
    const existing = byNorm.get(norm);
    if (!existing) { byNorm.set(norm, row); continue; }
    // Prefer staffing board over onboarding board
    const newIsSb  = (row.monday_item_id || '').startsWith('sb_') || (row.monday_item_id || '').startsWith('alias_sb_');
    const prevIsSb = (existing.monday_item_id || '').startsWith('sb_') || (existing.monday_item_id || '').startsWith('alias_sb_');
    if (newIsSb && !prevIsSb) { byNorm.set(norm, row); continue; }
    if (!newIsSb && prevIsSb) continue;
    // Same source tier — prefer real WWCC over placeholder
    const newHasWwcc  = row.wwcc_number && !/^(wwc0+|0+)$/i.test(row.wwcc_number);
    const prevHasWwcc = existing.wwcc_number && !/^(wwc0+|0+)$/i.test(existing.wwcc_number);
    if (newHasWwcc && !prevHasWwcc) { byNorm.set(norm, row); continue; }
    // Both real — keep later expiry (already ordered DESC so first seen wins)
  }
  // Second pass: if ANY row for this norm has is_internal_casual=true, propagate it to the winner
  for (const [norm, winner] of byNorm.entries()) {
    if (!winner.is_internal_casual) {
      const hasIcAnywhere = all.some(r => r.full_name_norm === norm && r.is_internal_casual);
      if (hasIcAnywhere) winner.is_internal_casual = true;
    }
  }
  const rows = [...byNorm.values()];

  // If caller requested specific names, filter down
  if (namesParam) {
    const normed = new Set(
      namesParam.split(',').map(n => normaliseName(decodeURIComponent(n))).filter(Boolean)
    );
    return res.status(200).json(rows.filter(r => normed.has(r.full_name_norm)));
  }

  res.status(200).json(rows);
}
