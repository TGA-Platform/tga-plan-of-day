const https = require('https');
const path = require('path');
const { sendEmail } = require(path.join(__dirname, '../scripts/send-email.js'));

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

const CENTRE_ORDER = [
  { id:'mount-annan',      name:'Mount Annan' },
  { id:'spring-farm',      name:'Spring Farm' },
  { id:'denham-court',     name:'Denham Court' },
  { id:'ed-park-1',        name:'Edmondson Park 1' },
  { id:'ed-park-2',        name:'Edmondson Park 2' },
  { id:'wilton',           name:'Wilton' },
  { id:'wollongong',       name:'Wollongong' },
  { id:'dapto-1',          name:'Dapto 1' },
  { id:'dapto-2',          name:'Dapto 2' },
  { id:'north-wollongong', name:'North Wollongong' },
  { id:'shell-cove',       name:'Shell Cove' },
  { id:'bexley',           name:'Bexley' },
  { id:'oatley',           name:'Oatley' },
  { id:'belfield',         name:'Belfield' },
  { id:'bankstown',        name:'Bankstown' },
  { id:'glendale',         name:'Glendale' },
  { id:'edgeworth',        name:'Edgeworth' },
  { id:'charlestown',      name:'Charlestown' },
];

function sbGet(p) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
      path: p,
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve([]); } });
    }).on('error', reject);
  });
}

function formatDateLabel(dateStr) {
  return new Date(dateStr + 'T12:00:00+10:00').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney'
  });
}

function fmt(n) {
  if (n == null) return '-';
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return s;
}

function buildHtml(rows, dateLabel) {
  const tableRows = rows.map(r => {
    const surplus = r.casualsNeeded > 0 ? -r.casualsNeeded : r.floatSurplus;
    const short = surplus < 0;
    const exact = surplus === 0;
    const color = short ? '#c62828' : exact ? '#f9a825' : '#2e7d32';
    const label = short ? 'Deficit' : exact ? 'Exact' : 'Surplus';
    const valStr = (surplus > 0 ? '+' : '') + fmt(surplus);
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:7px 10px;font-weight:600">${r.name}</td>
      <td style="padding:7px 10px;text-align:center">${fmt(r.floorStaff)}</td>
      <td style="padding:7px 10px;text-align:center">${fmt(r.floatersNeeded)}</td>
      <td style="padding:7px 10px;text-align:center;font-weight:700;color:${color}">${valStr} ${label}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#111">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#1a2e1a;color:#fff;padding:18px 24px">
    <h1 style="margin:0;font-size:20px">TGA Staffing Forecast</h1>
    <div style="font-size:13px;color:#a5c8a5;margin-top:4px">Forecast for ${dateLabel} &nbsp;·&nbsp; Hannah - TGA People &amp; Culture</div>
  </div>
  <div style="padding:16px 20px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f0f0f0;font-size:11px;font-weight:700;text-transform:uppercase">
        <th style="padding:7px 10px;text-align:left">Centre</th>
        <th style="padding:7px 10px;text-align:center">Floor Staff</th>
        <th style="padding:7px 10px;text-align:center">Floaters Needed</th>
        <th style="padding:7px 10px;text-align:center">Surplus / Deficit</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="margin:12px 0 0;font-size:11px;color:#999">Floaters Needed = net ratio shortfall + floor buffer (1 per 6 staff). Surplus/Deficit = floats + AD available vs floaters needed.</p>
  </div>
</div></body></html>`;
}

async function main() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const addDays = now.getDay() === 5 ? 3 : 1;
  const d = new Date(now); d.setDate(d.getDate() + addDays);
  const date = d.toISOString().slice(0, 10);

  const cacheRows = await sbGet(`/rest/v1/staffing_analysis_cache?date=eq.${date}&select=centre_id,casuals_needed,float_surplus,floaters_needed,floor_staff`);
  if (!Array.isArray(cacheRows) || cacheRows.length === 0) {
    throw new Error('No cache data for ' + date + ': ' + JSON.stringify(cacheRows).slice(0, 200));
  }

  const cacheMap = {};
  for (const row of cacheRows) cacheMap[row.centre_id] = row;

  const rows = CENTRE_ORDER.map(c => {
    const r = cacheMap[c.id];
    if (!r) return null;
    return {
      name: c.name,
      floorStaff: r.floor_staff,
      floatersNeeded: r.floaters_needed,
      casualsNeeded: r.casuals_needed,
      floatSurplus: r.float_surplus,
    };
  }).filter(Boolean);

  const dateLabel = formatDateLabel(date);
  const html = buildHtml(rows, dateLabel);

  await sendEmail({
    to: 'matthew@tga.edu.au',
    from: 'teams@tga.edu.au',
    fromName: 'Hannah — TGA People & Culture',
    subject: `TGA Staffing Forecast — ${dateLabel}`,
    html,
  });
  console.log('Sent to matthew@tga.edu.au');
}

main().catch(e => { console.error(e.message); process.exit(1); });
