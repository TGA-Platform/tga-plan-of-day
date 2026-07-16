const https = require('https');
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

https.get({
  hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
  path: '/rest/v1/ratio_check_data?centre_id=eq.oatley&select=date,session,data&order=date.desc&limit=1',
  headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
}, res => {
  let d = '';
  res.on('data', c => { d += c; });
  res.on('end', () => {
    const rows = JSON.parse(d);
    const data = rows[0].data || {};

    // cells — what's in here?
    if (data.cells) {
      const cellKeys = Object.keys(data.cells);
      console.log('cells count:', cellKeys.length);
      console.log('sample cell key:', cellKeys[0]);
      console.log('sample cell value:', JSON.stringify(data.cells[cellKeys[0]]).slice(0, 200));
    }

    // staffTimeOverrides
    if (data.staffTimeOverrides) {
      console.log('\nstaffTimeOverrides:', JSON.stringify(data.staffTimeOverrides).slice(0, 300));
    }

    // requiredByRoom
    if (data.requiredByRoom) {
      console.log('\nrequiredByRoom:', JSON.stringify(data.requiredByRoom));
    }
  });
}).on('error', e => console.error(e.message));
