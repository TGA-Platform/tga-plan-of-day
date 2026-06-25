const https = require('https');

const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

function deputyPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'thegroveacademy.au.deputy.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEPUTY_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const EMP_ID = 1633; // Eman Sharan
  console.log(`Checking Deputy for Eman Sharan (ID ${EMP_ID}) on ${today}...\n`);

  // Today's rosters
  const rosters = await deputyPost('/api/v1/resource/Roster/QUERY', {
    max: 500,
    search: { s1: { field: 'Date', type: 'eq', data: today } },
  });

  if (!Array.isArray(rosters)) {
    console.log('Unexpected response:', JSON.stringify(rosters).slice(0, 300));
    return;
  }

  const eman = rosters.filter(r => r.Employee === EMP_ID);
  if (eman.length === 0) {
    console.log('No roster entry for Eman Sharan today.');

    // Check next 7 days
    console.log('\nChecking upcoming 7 days...');
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
      const r2 = await deputyPost('/api/v1/resource/Roster/QUERY', {
        max: 500,
        search: { s1: { field: 'Date', type: 'eq', data: dateStr } },
      });
      const e2 = Array.isArray(r2) ? r2.filter(r => r.Employee === EMP_ID) : [];
      if (e2.length > 0) {
        e2.forEach(r => {
          const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? `Unit ${r.OperationalUnit}`;
          const loc = r._DPMetaData?.OperationalUnitInfo?.CompanyName ?? 'unknown';
          console.log(`  ${dateStr}: ${r.StartTime} - ${r.EndTime} | ${unit} | ${loc} | Confirmed: ${r.Confirmed}`);
        });
      }
    }
  } else {
    eman.forEach(r => {
      const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? `Unit ${r.OperationalUnit}`;
      const loc = r._DPMetaData?.OperationalUnitInfo?.CompanyName ?? 'unknown location';
      console.log(`TODAY: ${r.StartTime} - ${r.EndTime}`);
      console.log(`  Unit: ${unit}`);
      console.log(`  Location: ${loc}`);
      console.log(`  Confirmed: ${r.Confirmed} | Published: ${r.Published}`);
      console.log(`  Open: ${r.Open}`);
    });
  }
}

main().catch(console.error);
