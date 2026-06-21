// Show all distinct campus names in attendance_daily for today
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?select=campus&date=eq.${today}&limit=5000`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();
const counts = {};
for (const row of rows) counts[row.campus] = (counts[row.campus] || 0) + 1;
Object.entries(counts).sort((a,b) => a[0].localeCompare(b[0])).forEach(([k,v]) => console.log(`  "${k}": ${v}`));
