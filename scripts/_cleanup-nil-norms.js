// Clean up any remaining full_name_norm values that still have NIL: prefix
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const BASE = 'https://tgxpvzlibquqnldgmwho.supabase.co';

// Find all records with nil: in norm
const r = await fetch(`${BASE}/rest/v1/staff_wwcc?select=monday_item_id,full_name,full_name_norm&full_name_norm=ilike.nil:*&limit=100`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();
console.log(`Found ${rows.length} records with NIL: in norm`);

for (const row of rows) {
  const cleanNorm = row.full_name_norm.replace(/^nil:\s*/i, '').trim();
  const cleanName = row.full_name.replace(/^NIL:\s*/i, '').trim();
  console.log(`  Fixing: "${row.full_name}" → "${cleanName}" (norm: "${cleanNorm}")`);
  const patch = await fetch(`${BASE}/rest/v1/staff_wwcc?monday_item_id=eq.${encodeURIComponent(row.monday_item_id)}`, {
    method: 'PATCH',
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ full_name: cleanName, full_name_norm: cleanNorm }),
  });
  console.log(`  → ${patch.status}`);
}
console.log('Done.');
