const https = require('https');
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

const tables = ['roster_weeks', 'roster_shifts', 'roster_templates', 'roster_template_shifts', 'roster_published_shifts'];
let done = 0;
tables.forEach(t => {
  https.get({
    hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
    path: '/rest/v1/' + t + '?limit=1',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
  }, res => {
    let d = ''; res.on('data', c => { d += c; });
    res.on('end', () => {
      const j = JSON.parse(d);
      const exists = Array.isArray(j);
      console.log(t + ': ' + (exists ? 'EXISTS (cols: ' + (j.length ? Object.keys(j[0]).join(', ') : 'empty') + ')' : 'MISSING — ' + (j.message || '')));
      if (++done === tables.length) process.exit(0);
    });
  }).on('error', () => { console.log(t + ': ERROR'); if (++done === tables.length) process.exit(0); });
});
