const https = require('https');

const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
const addDays = now.getDay() === 5 ? 3 : 1;
const d = new Date(now);
d.setDate(d.getDate() + addDays);
const date = d.toISOString().slice(0, 10);

console.log('Triggering forecast cache for:', date);

https.get(`https://plan.tga.edu.au/api/cron-forecast-cache?date=${date}`, (res) => {
  let data = '';
  res.on('data', c => { data += c; });
  res.on('end', () => {
    const j = JSON.parse(data);
    if (j.ok) {
      console.log('Cached', j.centres, 'centres for', j.date);
      j.summary.forEach(c => console.log(c.name + ': req=' + c.requiredStaff + ' surplus=' + (c.surplusVal > 0 ? '+' : '') + c.surplusVal.toFixed(1)));
    } else {
      console.log(JSON.stringify(j).slice(0, 500));
    }
  });
}).on('error', e => console.error(e.message));
