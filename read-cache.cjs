const https = require('https');
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

https.get({
  hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
  path: '/rest/v1/staffing_analysis_cache?date=eq.2026-07-17&select=*',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
}, res => {
  let d = '';
  res.on('data', c => { d += c; });
  res.on('end', () => { console.log(d.slice(0, 3000)); });
}).on('error', e => console.error(e.message));
