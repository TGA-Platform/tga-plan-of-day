/**
 * Summary of all migrated staff
 */

const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = '***';

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
  const staff = await sbGet('/staff_members?limit=10000');
  
  if (!Array.isArray(staff)) {
    console.error('Unexpected response:', staff);
    process.exit(1);
  }

  // Group by centre
  const byCentre = {};
  for (const s of staff) {
    if (!byCentre[s.centre_id]) byCentre[s.centre_id] = [];
    byCentre[s.centre_id].push(s);
  }

  console.log('=== MIGRATION SUMMARY ===\n');
  console.log('Total staff across all centres:', staff.length);
  console.log('\nBy centre:');

  const sorted = Object.entries(byCentre).sort((a, b) => b[1].length - a[1].length);
  for (const [centre, members] of sorted) {
    const active = members.filter(s => s.is_active_group).length;
    console.log('  ' + centre + ': ' + members.length + ' staff (' + active + ' active)');
  }

  // Check data completeness
  console.log('\n=== DATA COMPLETENESS ===');
  let withEmail = 0, withWWCC = 0, withPosition = 0, withQualification = 0;
  for (const s of staff) {
    if (s.email) withEmail++;
    if (s.wwcc_number) withWWCC++;
    if (s.position) withPosition++;
    if (s.qualification) withQualification++;
  }
  console.log('With qualification:', withQualification + '/' + staff.length);
  console.log('With position:', withPosition + '/' + staff.length);
  console.log('With email:', withEmail + '/' + staff.length);
  console.log('With WWCC:', withWWCC + '/' + staff.length);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
