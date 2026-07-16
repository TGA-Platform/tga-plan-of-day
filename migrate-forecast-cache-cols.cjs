const fs = require('fs');
const https = require('https');

const envContent = fs.readFileSync('.env.local', 'utf8');
const match = envContent.match(/SUPABASE_SERVICE_KEY=\\?"?([A-Za-z0-9._\-]+)/);
const SERVICE_KEY = match ? match[1] : '';
if (!SERVICE_KEY) { console.error('No service key found'); process.exit(1); }

const sql = 'ALTER TABLE staffing_analysis_cache ADD COLUMN IF NOT EXISTS required_staff numeric, ADD COLUMN IF NOT EXISTS expected_children integer;';
const body = JSON.stringify({ query: sql });

const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/tgxpvzlibquqnldgmwho/database/query',
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  }
}, res => {
  let d = '';
  res.on('data', c => { d += c; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log(d.slice(0, 300));
  });
});
req.on('error', e => console.error(e.message));
req.write(body);
req.end();
