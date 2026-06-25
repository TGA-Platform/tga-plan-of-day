const https = require('https');
const fs = require('fs');

const deputyFile = fs.readFileSync(__dirname + '/../api/deputy-rosters.js', 'utf8');
const DEPUTY_TOKEN = deputyFile.match(/DEPUTY_TOKEN\s*=\s*'([^']+)'/)[1];
const supaFile = fs.readFileSync(__dirname + '/../api/ratio-check.js', 'utf8');
const SERVICE_KEY = supaFile.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());

// EP2 float unit IDs from config
const EP2_FLOAT_UNITS = [220]; // floatUnitIds for ed-park-2

function deputyPost(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'thegroveacademy.au.deputy.com',
      path: '/api/v1/resource/Roster/QUERY', method: 'POST',
      headers: { 'Authorization': `Bearer ${DEPUTY_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function supaGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
      path, method: 'GET',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    req.on('error', reject); req.end();
  });
}

async function main() {
  console.log(`Date: ${today}\n`);

  // 1. Get all EP2 rosters today
  const rosters = await deputyPost({ max: 500, search: { s1: { field: 'Date', type: 'eq', data: today } } });
  const ep2floats = rosters.filter(r => EP2_FLOAT_UNITS.includes(r.OperationalUnit));
  
  console.log(`EP2 float unit ${EP2_FLOAT_UNITS} rosters today: ${ep2floats.length}`);
  ep2floats.forEach(r => {
    const name = r._DPMetaData?.EmployeeInfo?.DisplayName ?? `ID ${r.Employee}`;
    const toTime = ep => new Date(ep * 1000).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: true });
    console.log(`  ${name} (${r.Employee}): ${toTime(r.StartTime)} - ${toTime(r.EndTime)}`);
  });

  // 2. Check saved float schedules
  const fsRows = await supaGet(`/rest/v1/float_schedules?centre_id=eq.ed-park-2&date=eq.${today}&select=employee_id,employee_name,schedule`);
  console.log(`\nSaved float schedules: ${fsRows.length}`);
  fsRows.forEach(row => {
    const blocks = row.schedule ?? [];
    const lastBlock = blocks[blocks.length - 1];
    const endTime = lastBlock?.endTime ?? '?';
    console.log(`  ${row.employee_name} (${row.employee_id}): ${blocks.length} blocks, last ends ${endTime}`);
  });
}

main().catch(console.error);
