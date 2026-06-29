/**
 * audit-staff-documents.cjs
 *
 * Audits staff_documents in Supabase.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';

function getServiceKey() {
  const apiPath = path.join(__dirname, '..', 'api', 'staffing-structure.js');
  const src = fs.readFileSync(apiPath, 'utf8');
  const idx = src.indexOf('SERVICE_KEY');
  const line = src.slice(idx, idx + 600);
  const m = line.match(/'([^']+)'/);
  if (!m) throw new Error('Could not extract service key');
  return m[1];
}

const SERVICE_KEY = proces…_KEY || getServiceKey();
const SB = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  const staff = await sbGet('/staff_members?select=id,name,centre_id,position,qualification');
  const docs = await sbGet('/staff_documents?select=id,staff_id,doc_type,label,storage_path,monday_url');

  console.log(`Total staff: ${staff.length}`);
  console.log(`Total documents: ${docs.length}\n`);

  const byType = { main: 0, subitem: 0, other: 0 };
  for (const d of docs) {
    if (d.doc_type === 'main') byType.main++;
    else if (d.doc_type === 'subitem') byType.subitem++;
    else byType.other++;
  }
  console.log('Documents by type:');
  console.log(`  main:    ${byType.main}`);
  console.log(`  subitem: ${byType.subitem}`);
  console.log(`  other:   ${byType.other}\n`);

  const staffDocCounts = {};
  for (const s of staff) staffDocCounts[s.id] = { staff: s, main: 0, subitem: 0, total: 0 };
  for (const d of docs) {
    const entry = staffDocCounts[d.staff_id];
    if (!entry) continue;
    entry.total++;
    if (d.doc_type === 'main') entry.main++;
    else if (d.doc_type === 'subitem') entry.subitem++;
  }

  const withDocs = Object.values(staffDocCounts).filter(e => e.total > 0);
  const withoutDocs = Object.values(staffDocCounts).filter(e => e.total === 0);

  console.log(`Staff with documents: ${withDocs.length}`);
  console.log(`Staff with NO documents: ${withoutDocs.length}\n`);

  const noDocsByCentre = {};
  for (const e of withoutDocs) {
    const c = e.staff.centre_id || 'unknown';
    noDocsByCentre[c] = (noDocsByCentre[c] || 0) + 1;
  }
  console.log('Staff with no documents by centre:');
  for (const [centre, count] of Object.entries(noDocsByCentre).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${centre}: ${count}`);
  }

  console.log('\nSample staff with no documents:');
  for (const e of withoutDocs.slice(0, 20)) {
    console.log(`  ${e.staff.name} | ${e.staff.centre_id} | ${e.staff.position || '-'} | ${e.staff.qualification || '-'}`);
  }

  const top = Object.values(staffDocCounts).sort((a, b) => b.total - a.total).slice(0, 10);
  console.log('\nStaff with most documents:');
  for (const e of top) {
    console.log(`  ${e.total} docs (${e.main} main, ${e.subitem} subitem) | ${e.staff.name} | ${e.staff.centre_id}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
