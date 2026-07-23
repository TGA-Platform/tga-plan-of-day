#!/usr/bin/env node
const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwNzA0NzYwMCwiZXhwIjoxODY0ODEzNjAwfQ.M_nEo_u3bOb1c0HkYcB0qZR2XhHeI4gaSyJLw7WG6f1c';

async function querySupabase(date) {
  return new Promise((resolve, reject) => {
    const query = `SELECT data FROM ratio_check WHERE centre_id='Oatley' AND date='${date}' AND session='midday'`;
    
    const options = {
      hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
      port: 443,
      path: `/rest/v1/ratio_check?centre_id=eq.Oatley&date=eq.${date}&session=eq.midday`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Accept': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

(async () => {
  try {
    console.log('Checking Hayley in Supabase...\n');
    
    const data23 = await querySupabase('2026-07-23');
    const data1 = await querySupabase('2026-07-01');
    
    console.log('=== 2026-07-23 (midday) ===');
    if (Array.isArray(data23) && data23[0]) {
      const overrides = data23[0].data?.staffTimeOverrides || {};
      console.log('staffTimeOverrides:');
      console.log(JSON.stringify(overrides, null, 2));
      // Find Hayley (employee ID ~2000s range usually)
      for (const [empId, override] of Object.entries(overrides)) {
        if (override.lunchStart) {
          console.log(`\nEmployee ${empId}: lunch ${override.lunchStart}-${override.lunchEnd} (source: ${override.source})`);
        }
      }
    } else {
      console.log('No data found');
    }
    
    console.log('\n=== 2026-07-01 (midday) ===');
    if (Array.isArray(data1) && data1[0]) {
      const overrides = data1[0].data?.staffTimeOverrides || {};
      console.log('staffTimeOverrides:');
      console.log(JSON.stringify(overrides, null, 2));
      // Find Hayley
      for (const [empId, override] of Object.entries(overrides)) {
        if (override.lunchStart) {
          console.log(`\nEmployee ${empId}: lunch ${override.lunchStart}-${override.lunchEnd} (source: ${override.source})`);
        }
      }
    } else {
      console.log('No data found');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
