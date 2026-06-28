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

async function getAll(path) {
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const r = await fetch(`${SB}${path}&offset=${offset}&limit=${limit}`, { headers: HEADERS });
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    all = all.concat(rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

(async () => {
  const staff = await getAll('/staff_members?select=id,centre_id,employment_status');
  const docs = await getAll('/staff_documents?select=staff_id,doc_type');

  const staffIds = new Set(staff.map(s => s.id));
  const orphaned = docs.filter(d => !staffIds.has(d.staff_id));
  const linked = docs.filter(d => staffIds.has(d.staff_id));

  console.log(`Total staff: ${staff.length}`);
  console.log(`Total docs: ${docs.length}`);
  console.log(`Linked docs: ${linked.length}`);
  console.log(`Orphaned docs: ${orphaned.length}`);

  const staffWithDocs = new Set(linked.map(d => d.staff_id));
  console.log(`Staff with docs: ${staffWithDocs.size}`);

  const activeStaff = staff.filter(s => s.employment_status === 'Active');
  const activeWithDocs = activeStaff.filter(s => staffWithDocs.has(s.id));
  console.log(`Active staff: ${activeStaff.length}`);
  console.log(`Active staff with docs: ${activeWithDocs.length}`);
  console.log(`Active staff without docs: ${activeStaff.length - activeWithDocs.length}`);

  // By centre
  const byCentre = {};
  for (const d of linked) {
    const s = staff.find(x => x.id === d.staff_id);
    if (!s) continue;
    byCentre[s.centre_id] = (byCentre[s.centre_id] || 0) + 1;
  }
  console.log('\nLinked docs by centre:');
  for (const [c, n] of Object.entries(byCentre).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }
})();
