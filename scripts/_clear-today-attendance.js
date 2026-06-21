import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

console.log(`Deleting all attendance_daily rows for ${today}...`);
const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?date=eq.${today}`, {
  method: 'DELETE',
  headers: { apikey: SK, Authorization: `Bearer ${SK}`, Prefer: 'return=minimal' }
});
console.log('Delete status:', r.status);
