/**
 * delete-orphaned-docs.cjs
 *
 * Deletes staff_documents records whose staff_id no longer exists in staff_members.
 * Actual files in Supabase storage are NOT deleted.
 */

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

async function sbGet(p) {
  const r = await fetch(SB + p, { headers: HEADERS });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbDelete(p) {
  const r = await fetch(SB + p, { method: 'DELETE', headers: HEADERS });
  if (!r.ok) throw new Error(await r.text());
  return r;
}

(async () => {
  const APPLY = process.argv.includes('--apply');
  const staff = await sbGet('/staff_members?select=id');
  const staffIds = new Set(staff.map(s => s.id));
  const docs = await sbGet('/staff_documents?select=id,staff_id,storage_path');
  const orphaned = docs.filter(d => !staffIds.has(d.staff_id));

  console.log(`Found ${orphaned.length} orphaned docs out of ${docs.length} total`);
  console.log(orphaned.slice(0, 5).map(d => `  ${d.id} | ${d.staff_id} | ${d.storage_path}`).join('\n'));

  if (APPLY) {
    // Delete in batches to avoid huge query strings
    const BATCH = 100;
    let deleted = 0;
    for (let i = 0; i < orphaned.length; i += BATCH) {
      const batch = orphaned.slice(i, i + BATCH);
      const ids = batch.map(d => d.id).join(',');
      await sbDelete(`/staff_documents?id=in.(${ids})`);
      deleted += batch.length;
      console.log(`Deleted ${deleted}/${orphaned.length}`);
    }
    console.log('Done.');
  } else {
    console.log('\nDry run. Pass --apply to delete.');
  }
})();
