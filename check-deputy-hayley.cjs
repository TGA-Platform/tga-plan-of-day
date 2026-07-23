const https = require('https');

async function checkDeputyRosters() {
  console.log('\n=== DEPUTY ROSTERS (1 July) ===');
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'plan.tga.edu.au',
      path: '/api/deputy-rosters?unitIds=2265,2266,2267,2268,2269&date=2026-07-01',
      method: 'GET',
      headers: { 'User-Agent': 'Node.js' }
    };
    
    https.get(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const rosters = JSON.parse(data);
          const hayley = rosters.find(r => r.employeeName?.toLowerCase().includes('hayley'));
          if (hayley) {
            console.log('Hayley from Deputy rosters:');
            console.log(JSON.stringify(hayley, null, 2));
          } else {
            console.log('Hayley not found in rosters');
            console.log('First 2 rosters for reference:');
            console.log(JSON.stringify(rosters.slice(0, 2), null, 2));
          }
          resolve();
        } catch (e) {
          console.error('JSON parse error:', e.message);
          console.log('Response preview:', data.substring(0, 300));
          resolve();
        }
      });
    }).on('error', e => {
      console.error('HTTPS error:', e.message);
      resolve();
    });
  });
}

(async () => {
  await checkDeputyRosters();
})();
