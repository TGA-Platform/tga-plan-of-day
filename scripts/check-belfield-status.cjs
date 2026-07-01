/**
 * Check Belfield staff mapping status
 */

const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbG…6f1c';

async function sbGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: SUPABASE_URL,
      path: '/rest/v1' + path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const allStaff = await sbGet('/staff_members?centre_id=eq.belfield');
  console.log('Total Belfield staff in Supabase:', allStaff.length);

  let withPosition = 0, withEmail = 0, withWWCC = 0, withStartDate = 0, withQualification = 0;
  let withAction = 0, withSeekUrl = 0, withPositionCategory = 0;

  for (const s of allStaff) {
    if (s.position) withPosition++;
    if (s.email) withEmail++;
    if (s.wwcc_number) withWWCC++;
    if (s.start_date) withStartDate++;
    if (s.qualification) withQualification++;
    if (s.action) withAction++;
    if (s.seek_url) withSeekUrl++;
    if (s.position_category) withPositionCategory++;
  }

  console.log('\nData completeness:');
  console.log('  With qualification:', withQualification + '/' + allStaff.length);
  console.log('  With position:', withPosition + '/' + allStaff.length);
  console.log('  With position_category:', withPositionCategory + '/' + allStaff.length);
  console.log('  With email:', withEmail + '/' + allStaff.length);
  console.log('  With WWCC:', withWWCC + '/' + allStaff.length);
  console.log('  With start_date:', withStartDate + '/' + allStaff.length);
  console.log('  With action:', withAction + '/' + allStaff.length);
  console.log('  With seek_url:', withSeekUrl + '/' + allStaff.length);

  // Show sample of staff with most complete data
  console.log('\nTop 3 most complete profiles:');
  const sorted = allStaff.sort((a, b) => {
    const scoreA = [a.position, a.email, a.wwcc_number, a.start_date, a.action].filter(Boolean).length;
    const scoreB = [b.position, b.email, b.wwcc_number, b.start_date, b.action].filter(Boolean).length;
    return scoreB - scoreA;
  });

  for (const s of sorted.slice(0, 3)) {
    console.log('\n' + s.name);
    console.log('  qualification:', s.qualification);
    console.log('  position:', s.position);
    console.log('  position_category:', s.position_category);
    console.log('  email:', s.email);
    console.log('  mobile:', s.mobile);
    console.log('  wwcc_number:', s.wwcc_number);
    console.log('  wwcc_expiry:', s.wwcc_expiry);
    console.log('  start_date:', s.start_date);
    console.log('  action:', s.action);
    console.log('  seek_url:', s.seek_url ? 'Yes' : 'No');
  }

  // Show what's missing
  console.log('\n--- MISSING DATA SUMMARY ---');
  const missing = allStaff.filter(s => !s.email && !s.wwcc_number && !s.start_date);
  console.log('Staff with almost no data:', missing.length + '/' + allStaff.length);
  for (const s of missing.slice(0, 5)) {
    console.log('  - ' + s.name + ' (group: ' + s.group_title + ')');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
