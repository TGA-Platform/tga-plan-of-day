#!/usr/bin/env node
const https = require('https');

async function fetchData(date) {
  return new Promise((resolve, reject) => {
    const url = `https://plan.tga.edu.au/api/deputy-timesheets-actual?date=${date}&centre=Oatley`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const hayley = parsed.find(s => s.name && s.name.includes('Hayley'));
          resolve(hayley);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  try {
    console.log('Testing Deputy actuals for different dates...\n');
    
    const date1 = await fetchData('2026-07-23');
    const date2 = await fetchData('2026-07-01');
    
    console.log('2026-07-23 Hayley:');
    console.log(date1 ? {
      name: date1.name,
      lunchStart: date1.lunchStart,
      lunchEnd: date1.lunchEnd,
      source: date1.source
    } : 'NOT FOUND');
    
    console.log('\n2026-07-01 Hayley:');
    console.log(date2 ? {
      name: date2.name,
      lunchStart: date2.lunchStart,
      lunchEnd: date2.lunchEnd,
      source: date2.source
    } : 'NOT FOUND');
    
    if (date1 && date2) {
      const same = date1.lunchStart === date2.lunchStart && date1.lunchEnd === date2.lunchEnd;
      console.log(`\n⚠️ SAME LUNCH TIMES? ${same ? 'YES - BUG!' : 'NO - OK'}`);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
