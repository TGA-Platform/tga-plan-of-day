const https = require('https');
const fs = require('fs');

// Read token directly from api file to avoid encoding issues
const deputyFile = fs.readFileSync(__dirname + '/../api/deputy-rosters.js', 'utf8');
const DEPUTY_TOKEN = deputyFile.match(/DEPUTY_TOKEN\s*=\s*'([^']+)'/)[1];

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const EMP_ID = 1633;

// Mount Annan config from src/config.ts
const MA_ROOMS     = [74, 76, 221, 78, 193];
const MA_FLOAT     = [222];
const MA_ISS       = [225];
const MA_LEAVE     = [108, 456, 109];
const MA_NONRATIO  = [72, 73, 101, 162, 234, 323, 335, 79];

function deputyPost(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'thegroveacademy.au.deputy.com',
      path: '/api/v1/resource/Roster/QUERY',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEPUTY_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve(b); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Checking Eman Sharan (ID ${EMP_ID}) on ${today}\n`);
  console.log('Mount Annan config unit IDs:');
  console.log(`  Rooms:     ${MA_ROOMS.join(', ')}`);
  console.log(`  Float:     ${MA_FLOAT.join(', ')}`);
  console.log(`  ISS:       ${MA_ISS.join(', ')}`);
  console.log(`  Leave:     ${MA_LEAVE.join(', ')}`);
  console.log(`  Non-ratio: ${MA_NONRATIO.join(', ')}\n`);

  const rosters = await deputyPost({ max: 500, search: { s1: { field: 'Date', type: 'eq', data: today } } });
  const eman = Array.isArray(rosters) ? rosters.filter(r => r.Employee === EMP_ID) : [];

  console.log(`Eman's rosters today (${eman.length}):`);
  eman.forEach(r => {
    const unitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? 'unknown';
    const uid = r.OperationalUnit;
    const toTime = ep => new Date(ep * 1000).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: true });
    const cat = MA_ROOMS.includes(uid) ? 'ROOM ✅'
      : MA_FLOAT.includes(uid)    ? 'FLOAT ✅'
      : MA_ISS.includes(uid)      ? 'ISS ✅'
      : MA_LEAVE.includes(uid)    ? 'LEAVE ✅'
      : MA_NONRATIO.includes(uid) ? 'SUPPORT/NON-RATIO ✅'
      : '❌ NOT IN CONFIG';
    console.log(`  ${toTime(r.StartTime)} - ${toTime(r.EndTime)} | "${unitName}" (unitId: ${uid}) | ${cat}`);
  });
}

main().catch(console.error);
