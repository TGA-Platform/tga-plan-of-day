const fs = require('fs');
const apiFile = fs.readFileSync('api/ratio-check.js', 'utf8');
const keyMatch = apiFile.match(/SERVICE_KEY\s*=\s*['"]([^'"]+)/);
const key = keyMatch ? keyMatch[1] : '';
const date = '2026-07-06';
fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/ratio_check_data?date=eq.${date}&select=centre_id,session,data&limit=50`, {
  headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
}).then(r => r.json()).then(d => {
  if (!Array.isArray(d) || d.length === 0) { console.log('NO DATA'); return; }
  console.log('ROWS:', d.length);
  for (const row of d) {
    const data = row.data || {};
    const children = Array.isArray(data.children) ? data.children : [];
    const byRoom = {};
    for (const c of children) {
      if (!c.room) continue;
      byRoom[c.room] = byRoom[c.room] || [];
      byRoom[c.room].push(c.ageMonths);
    }
    console.log('CENTRE:', row.centre_id, 'SESSION:', row.session, 'CHILDREN:', children.length);
    for (const [room, ages] of Object.entries(byRoom)) {
      console.log(`  ${room}: ${ages.length} children, ages: ${ages.slice(0, 10).join(',')}${ages.length > 10 ? '...' : ''}`);
    }
  }
}).catch(e => console.log('ERR', e.message));
