import { createClient } from '../node_modules/@supabase/supabase-js/dist/module/index.js';

const supabase = createClient(
  'https://tgxpvzlibquqnldgmwho.supabase.co',
  'eyJhbG…6f1c'
);

const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const [{ data: wwcc, error: e1 }, { data: rosters, error: e2 }] = await Promise.all([
  supabase.from('staff_wwcc').select('full_name, centre').eq('is_internal_casual', true).limit(500),
  supabase.from('deputy_roster_cache').select('employee_name, campus, unit_name, start_time, end_time').eq('date', today).limit(3000),
]);

if (e1) { console.error('wwcc error:', e1.message); process.exit(1); }
if (e2) { console.error('roster error:', e2.message); process.exit(1); }

const casualNorms = new Set((wwcc || []).map(r => norm(r.full_name)));
console.log(`Internal casuals in DB: ${casualNorms.size}`);
console.log(`Rostered staff today (${today}): ${(rosters || []).length}`);

const seen = new Set();
const matched = [];
for (const r of (rosters || [])) {
  const key = norm(r.employee_name) + '|' + r.campus;
  if (casualNorms.has(norm(r.employee_name)) && !seen.has(key)) {
    seen.add(key);
    matched.push(r);
  }
}

matched.sort((a, b) => a.campus.localeCompare(b.campus) || a.employee_name.localeCompare(b.employee_name));
console.log(`\nInternal casuals rostered today: ${matched.length}\n`);

const byCentre = {};
for (const r of matched) {
  if (!byCentre[r.campus]) byCentre[r.campus] = [];
  byCentre[r.campus].push(r);
}
for (const [centre, staff] of Object.entries(byCentre).sort()) {
  console.log(`${centre} (${staff.length}):`);
  staff.forEach(s => console.log(`  ${s.employee_name}  [${s.unit_name}]  ${s.start_time||''}–${s.end_time||''}`));
}
