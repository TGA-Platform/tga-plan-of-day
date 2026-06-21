import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

// Paginate and count per campus — checking total vs what we expect
let all = [], offset = 0;
while (true) {
  const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?select=campus,child_name,date&date=eq.${today}&limit=1000&offset=${offset}`, {
    headers: { apikey: SK, Authorization: `Bearer ${SK}` }
  });
  const rows = await r.json();
  if (!rows.length) break;
  all.push(...rows);
  if (rows.length < 1000) break;
  offset += 1000;
}
console.log('Total rows:', all.length);
const counts = {};
for (const row of all) counts[row.campus] = (counts[row.campus] || 0) + 1;
Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>console.log(`  "${k}": ${v}`));
