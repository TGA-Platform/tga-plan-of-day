const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
console.log('Checking date:', today);

const path = `/rest/v1/ratio_check_data?centre_id=eq.ed-park-2&date=eq.${today}&select=session,data`;

const options = {
  hostname: SUPABASE_URL,
  path,
  method: 'GET',
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('RAW:', body.slice(0,200));
    const rows = JSON.parse(body);
    if (!Array.isArray(rows)) { console.log('Not array:', rows); return; }
    rows.forEach(row => {
      const fgs = row.data?.familyGroupings || [];
      console.log(`\n${row.session}: ${fgs.length} FGs`);
      fgs.forEach(fg => {
        console.log(`  id=${fg.id} label=${fg.label} rooms=[${(fg.rooms||[]).join(',')}] slots=[${(fg.slots||[]).slice(0,6).join(',')}]`);
      });
    });
  });
});
req.on('error', e => console.error(e));
req.end();
