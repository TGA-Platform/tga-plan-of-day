const fs = require('fs');
const apiFile = fs.readFileSync('api/ratio-check.js', 'utf8');
const keyMatch = apiFile.match(/SERVICE_KEY\s*=\s*['"]([^'"]+)/);
const key = keyMatch ? keyMatch[1] : '';
fetch('https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?limit=1', {
  headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
}).then(r => r.json()).then(d => {
  if (Array.isArray(d) && d.length > 0) {
    console.log('COLUMNS:', Object.keys(d[0]).join(', '));
    console.log('SAMPLE:', JSON.stringify(d[0], null, 2));
  } else {
    console.log('NO DATA', d);
  }
}).catch(e => console.log('ERR', e.message));
