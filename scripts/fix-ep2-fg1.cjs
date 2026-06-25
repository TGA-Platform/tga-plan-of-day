const https = require('https');

const SUPABASE_URL = 'tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SUPABASE_URL,
      path,
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let respBody = '';
      res.on('data', d => respBody += d);
      res.on('end', () => resolve({ status: res.statusCode, body: respBody }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const sessions = ['morning', 'midday', 'afternoon'];
  
  for (const session of sessions) {
    // Fetch current data
    const r = await apiRequest('GET', `/rest/v1/ratio_check_data?centre_id=eq.ed-park-2&date=eq.${today}&session=eq.${session}&select=data`);
    const rows = JSON.parse(r.body);
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`${session}: no row found`);
      continue;
    }
    
    const data = rows[0].data;
    const fgs = data.familyGroupings || [];
    
    // Find FG 1 (mndwy8p) and clear its slots
    let changed = false;
    const updatedFGs = fgs.map(fg => {
      if (fg.id === 'mndwy8p' && (fg.slots || []).length > 0) {
        console.log(`${session}: clearing FG 1 slots [${fg.slots.join(',')}]`);
        changed = true;
        return { ...fg, slots: [] };
      }
      return fg;
    });
    
    if (!changed) {
      console.log(`${session}: FG 1 already has no slots, skipping`);
      continue;
    }
    
    // Update
    const updatedData = { ...data, familyGroupings: updatedFGs };
    const updatePath = `/rest/v1/ratio_check_data?centre_id=eq.ed-park-2&date=eq.${today}&session=eq.${session}`;
    const ur = await apiRequest('PATCH', updatePath, { data: updatedData });
    console.log(`${session}: update status ${ur.status}`);
  }
  
  console.log('Done.');
}

main().catch(console.error);
