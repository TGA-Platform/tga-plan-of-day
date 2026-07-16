const https = require('https');
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

// Try inserting with new columns to probe whether they exist
const body = JSON.stringify({ centre_id: 'test-probe', date: '2099-01-01', required_staff: 1, expected_children: 1 });
const req = https.request({
  hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
  path: '/rest/v1/staffing_analysis_cache',
  method: 'POST',
  headers: {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    Prefer: 'return=representation',
  }
}, res => {
  let d = '';
  res.on('data', c => { d += c; });
  res.on('end', () => { console.log('Status:', res.statusCode, d.slice(0, 400)); });
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
