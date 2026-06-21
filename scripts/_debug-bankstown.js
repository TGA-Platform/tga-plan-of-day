// Debug Bankstown roster for today — find how absent staff are tracked
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/deputy_roster_cache?select=rosters&date=eq.${today}&limit=1`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();
const data = rows[0]?.rosters || [];

const bk = data.filter(r => (r._DPMetaData?.OperationalUnitInfo?.CompanyName || '').includes('Bankstown'));
console.log(`Bankstown entries: ${bk.length}`);
bk.forEach(r => {
  const name = r._DPMetaData?.EmployeeInfo?.DisplayName || '';
  const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '';
  const uid  = r.OperationalUnit;
  console.log(`  [${uid}] ${name} → ${unit}  open:${r.Open}  slots:${JSON.stringify(r.Slots?.slice(0,1))}`);
});
