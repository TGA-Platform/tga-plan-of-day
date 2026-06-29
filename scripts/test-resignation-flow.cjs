const https = require('https');
const host = 'tga-plan-of-36tbrj81v-matthew-maleks-projects.vercel.app';

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({ hostname: host, path, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // 1. Create test staff
  const create = await request('/api/staffing-structure?centreId=bexley', 'POST', {
    action: 'create_staff', centreId: 'bexley', groupId: 'new_group15497',
    name: 'TEST_DEV_RESIGNATION', position: 'Educator', qualification: 'Certificate 3', startDate: '2026-01-01'
  });
  console.log('create staff:', create.status, create.body?.ok ? 'ok' : create.body);
  const staffId = create.body?.staff?.id;
  if (!staffId) return;

  // 2. Resign
  const lastDay = '2026-07-15';
  const update = await request('/api/staffing-structure?centreId=bexley', 'POST', {
    action: 'update_staff', staffId, fields: { employment_status: 'Resigned', end_date: lastDay }
  });
  console.log('update staff:', update.status, update.body?.ok ? 'ok' : update.body);

  // 3. Create open position
  const pos = await request('/api/open-positions', 'POST', {
    centre_id: 'bexley', title: 'Educator', qualification_required: 'Certificate 3',
    room_id: 'new_group15497', status: 'Open',
    notes: 'Educator (Certificate 3) — Replacement for TEST_DEV_RESIGNATION. Last day ' + lastDay + '.'
  });
  console.log('create open position:', pos.status, pos.body?.id ? 'created ' + pos.body.id : pos.body);

  // 4. Clean up: delete open position and test staff
  if (pos.body?.id) {
    const delPos = await request('/api/open-positions?id=' + pos.body.id, 'DELETE');
    console.log('delete open position:', delPos.status);
  }
  const delStaff = await request('/api/staffing-structure?centreId=bexley', 'POST', { action: 'delete_staff', staffId });
  console.log('delete staff:', delStaff.status, delStaff.body);
}

main().catch(console.error);
