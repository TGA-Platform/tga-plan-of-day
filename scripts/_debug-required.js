// Debug required staff calculation vs dashboard for Bankstown + NW + Bexley
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?select=campus,room,age&date=eq.${today}&limit=5000`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();

function parseAgeMonths(ageStr) {
  if (!ageStr) return 36;
  const ym = ageStr.match(/(\d+)y\s*(\d+)m/); if (ym) return parseInt(ym[1])*12+parseInt(ym[2]);
  const y = ageStr.match(/(\d+)y/); if (y) return parseInt(y[1])*12;
  const m = ageStr.match(/(\d+)m/); if (m) return parseInt(m[1]);
  return 36;
}

function calcRequired(children) {
  const u2  = children.filter(c => c < 24).length;
  const u3  = children.filter(c => c >= 24 && c < 36).length;
  const u6  = children.filter(c => c >= 36).length;
  let req = 0, cap = 0;
  const s1 = Math.ceil(u2 / 4); cap = s1 * 4 - u2; req += s1;
  const net23 = Math.max(0, u3 - cap); cap = Math.max(0, cap - u3) + (Math.ceil(net23 / 5) * 5 - net23); req += Math.ceil(net23 / 5);
  const net3 = Math.max(0, u6 - cap); req += Math.ceil(net3 / 10);
  return req;
}

for (const campus of ['Bankstown', 'North Wollongong', 'Bexley', 'Shell Cove']) {
  const kids = rows.filter(r => r.campus === campus);
  const ages = kids.map(k => parseAgeMonths(k.age));
  const u2 = ages.filter(a => a < 24).length;
  const u3 = ages.filter(a => a >= 24 && a < 36).length;
  const u6 = ages.filter(a => a >= 36).length;
  const req = calcRequired(ages);
  console.log(`${campus}: ${kids.length} children (${u2} u2, ${u3} u3, ${u6} 3+) → required: ${req}`);
}
