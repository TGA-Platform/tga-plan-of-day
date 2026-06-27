/**
 * Check how many Belfield documents are in Supabase Storage
 */

const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

async function sbGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: SUPABASE_URL,
      path: '/rest/v1' + path,
      method: 'GET',
      headers: {
        'Authorization': '***' + SERVICE_KEY,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject); req.end();
  });
}

async function main() {
  const docs = await sbGet('/staff_documents?limit=1000');
  const belfieldDocs = docs.filter(d => d.storage_path && d.storage_path.startsWith('belfield/'));
  console.log('Belfield documents in Supabase Storage:', belfieldDocs.length);

  // Count by label type
  const byLabel = {};
  for (const d of belfieldDocs) {
    byLabel[d.label] = (byLabel[d.label] || 0) + 1;
  }

  console.log('\nBy document type:');
  for (const [label, count] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + label + ': ' + count);
  }

  // Group by staff
  const byStaff = {};
  for (const d of belfieldDocs) {
    const parts = d.storage_path.split('/');
    const staffId = parts[1];
    if (!byStaff[staffId]) byStaff[staffId] = 0;
    byStaff[staffId]++;
  }
  console.log('\nStaff with documents:', Object.keys(byStaff).length);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
