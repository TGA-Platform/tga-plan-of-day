import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
console.log('Querying for date:', today);

// Check distinct dates returned
const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?select=date,campus&date=eq.${today}&limit=10`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();
const dates = new Set(rows.map(r => r.date));
console.log('Distinct dates returned:', [...dates]);
console.log('Sample rows:', rows.slice(0,3));
