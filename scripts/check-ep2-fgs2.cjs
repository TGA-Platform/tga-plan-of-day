const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

const path = `/rest/v1/ratio_check_data?centre_id=eq.ed-park-2&date=eq.${today}&select=session,data&session=eq.morning`;

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
    const rows = JSON.parse(body);
    if (!Array.isArray(rows) || rows.length === 0) { console.log('No rows:', body); return; }
    const fgs = rows[0].data?.familyGroupings || [];
    console.log('Morning FGs:');
    fgs.forEach(fg => {
      console.log(JSON.stringify(fg, null, 2));
    });
  });
});
req.on('error', e => console.error(e));
req.end();
