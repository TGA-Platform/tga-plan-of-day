// Check/add is_internal_casual column to staff_wwcc
import https from 'https';

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: SUPABASE_URL, path, method,
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on?.('error', reject);
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  // Try selecting the column — if it errors, it doesn't exist
  const check = await req('GET', '/rest/v1/staff_wwcc?select=is_internal_casual&limit=1', null);
  if (check.status === 200) {
    console.log('✅ is_internal_casual column already exists');
    return;
  }
  console.log(`Column check response: ${check.status} ${check.body.slice(0, 200)}`);
  console.log('\n⚠️  Column is_internal_casual does not exist yet.');
  console.log('Please run this SQL in the Supabase SQL Editor:');
  console.log('  ALTER TABLE staff_wwcc ADD COLUMN IF NOT EXISTS is_internal_casual boolean DEFAULT false;');
}

main().catch(console.error);
