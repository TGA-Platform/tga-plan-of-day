const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const EMP_ID = 1633; // Eman Sharan

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_URL, path, method: 'GET',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function deputyPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'thegroveacademy.au.deputy.com',
      path, method: 'POST',
      headers: { 'Authorization': `Bearer ${DEPUTY_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Date: ${today}\n`);

  // 1. Check Supabase ratio_check_data for Mount Annan
  const rows = await supabaseGet(
    `/rest/v1/ratio_check_data?centre_id=eq.mount-annan&date=eq.${today}&select=session,data`
  );

  if (!Array.isArray(rows)) { console.log('Supabase error:', rows); }
  else {
    console.log(`Supabase: ${rows.length} session row(s) for Mount Annan`);
    rows.forEach(row => {
      const overrides = row.data?.staffTimeOverrides ?? {};
      const moves = row.data?.staffMoves ?? {};
      const hasEman = Object.keys(overrides).includes(String(EMP_ID));
      const moveEntries = Object.entries(moves).filter(([k]) => k.startsWith(String(EMP_ID) + ':'));
      console.log(`  [${row.session}] timeOverride=${hasEman}, moveEntries=${moveEntries.length}`);
      if (hasEman) console.log(`    Override:`, JSON.stringify(overrides[String(EMP_ID)]));
      if (moveEntries.length > 0) console.log(`    Sample moves:`, moveEntries.slice(0,3).map(([k,v]) => `${k}=${v}`).join(', '));
    });
  }

  // 2. Deputy roster for Eman today
  const rosters = await deputyPost('/api/v1/resource/Roster/QUERY', {
    max: 500,
    search: { s1: { field: 'Date', type: 'eq', data: today } },
  });

  const eman = Array.isArray(rosters) ? rosters.filter(r => r.Employee === EMP_ID) : [];
  console.log(`\nDeputy rosters for Eman Sharan today: ${eman.length}`);
  eman.forEach(r => {
    const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? `Unit ${r.OperationalUnit}`;
    const loc  = r._DPMetaData?.OperationalUnitInfo?.CompanyName ?? 'unknown';
    const toTime = ep => new Date(ep * 1000).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: true });
    console.log(`  ${unit} @ ${loc}: ${toTime(r.StartTime)} - ${toTime(r.EndTime)} | Published: ${r.Published}`);
  });
}

main().catch(console.error);
