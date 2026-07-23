const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  try {
    // Check staging Ratio Check data for Edgeworth on 2026-07-23
    const url = 'https://tga-plan-of-boswazwh9-matthew-maleks-projects.vercel.app/api/ratio-check?centre_id=edgeworth&date=2026-07-23';
    console.log('Fetching from staging:', url);
    
    const result = await fetchUrl(url);
    if (!result || !result.length) {
      console.log('No data found');
      process.exit(0);
    }

    const ratioData = result[0].data;
    const overrides = ratioData.staffTimeOverrides || {};
    
    console.log('\n=== Ratio Check Staff Time Overrides ===');
    console.log(`Total staff with overrides: ${Object.keys(overrides).length}\n`);
    
    for (const [empId, ov] of Object.entries(overrides)) {
      if (ov.lunchStart && ov.lunchEnd) {
        console.log(`EmpId ${empId}:`);
        console.log(`  Lunch: ${ov.lunchStart}-${ov.lunchEnd}`);
        console.log(`  Source: ${ov.source || 'unknown'}`);
        console.log(`  Full override: ${JSON.stringify(ov, null, 2)}`);
        console.log('');
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
