/**
 * Check document status - which have files downloaded vs just Monday URLs
 */

const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbG…6f1c';

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
  const belfieldDocs = docs.filter(d => {
    // Check if this doc belongs to a Belfield staff member
    return true; // Get all and filter later
  });

  console.log('Total documents in staff_documents:', docs.length);

  const withStorage = docs.filter(d => d.storage_path);
  const withMondayOnly = docs.filter(d => !d.storage_path && d.monday_url);

  console.log('Documents with files in Storage:', withStorage.length);
  console.log('Documents with Monday URL only:', withMondayOnly.length);

  if (withMondayOnly.length > 0) {
    console.log('\nSample docs without files:');
    for (const d of withMondayOnly.slice(0, 5)) {
      console.log('  - ' + d.label + ': ' + d.monday_url.substring(0, 60) + '...');
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
