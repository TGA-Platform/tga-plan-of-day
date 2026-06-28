const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const apiPath = path.join(__dirname, '..', 'api', 'staffing-structure.js');
const src = fs.readFileSync(apiPath, 'utf8');
const idx = src.indexOf('SERVICE_KEY');
const line = src.slice(idx, idx + 600);
const key = line.match(/'([^']+)'/)[1];

const SB = `${SUPABASE_URL}/rest/v1`;
const HEADERS = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };

async function get(p) {
  const r = await fetch(SB + p, { headers: HEADERS });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

(async () => {
  const staff = await get('/staff_members?select=id,monday_id,name,centre_id');
  console.log('Total staff:', staff.length);

  const byMonday = {};
  for (const s of staff) {
    byMonday[s.monday_id] = byMonday[s.monday_id] || [];
    byMonday[s.monday_id].push(s);
  }
  const dupes = Object.entries(byMonday).filter(([k, v]) => v.length > 1);
  console.log('Duplicate monday_ids:', dupes.length);

  const staffIds = new Set(staff.map(s => s.id));
  const docs = await get('/staff_documents?select=staff_id');
  const orphaned = docs.filter(d => !staffIds.has(d.staff_id));
  console.log(`Orphaned docs: ${orphaned.length} of ${docs.length}`);
})();
