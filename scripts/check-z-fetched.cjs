const fs = require('fs');

const keyMatch = fs.readFileSync('api/z-casuals.js', 'utf8').match(/const SERVICE_KEY\s*=\s*'([^']+)'/);
const key = keyMatch ? keyMatch[1] : '';
if (!key) throw new Error('service key not found');

const url = 'https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/z_casuals?date=eq.2026-07-07&select=z_job_id,name,centre,fetched_at&order=fetched_at.asc';

(async () => {
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const rows = await res.json();
  console.log(JSON.stringify(rows, null, 2));
})();
