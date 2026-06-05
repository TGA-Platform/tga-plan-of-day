const ExcelJS = require('exceljs');
const S = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const K = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function normaliseCentre(name) {
  return name.replace(/\s*[—–-]+\s*(Sep|Term.*|T\d+|Jul|Jan|Apr|Oct)\s*.*$/i, '').trim();
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('audit-tmp/attendance-records-download.xlsx');
  const ws = wb.getWorksheet('Occupancy');
  const cap = new Map(), seen = new Set();
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const rawC = String(row.getCell(1).value || '').trim();
    const room  = String(row.getCell(3).value || '').trim();
    const c     = Number(row.getCell(4).value || 0);
    if (!rawC || c === 0) return;
    const centre = normaliseCentre(rawC);
    const key = centre + '|' + room;
    if (!seen.has(key)) { seen.add(key); cap.set(centre, (cap.get(centre) || 0) + c); }
  });
  console.log('Capacities loaded for', cap.size, 'centres');

  // Fetch all rows with capacity=0
  const r = await fetch(S + '/rest/v1/daily_occupancy?capacity=eq.0&select=campus,date&limit=2000', {
    headers: { apikey: K, Authorization: 'Bearer ' + K }
  });
  const rows = await r.json();
  console.log('Rows needing capacity:', rows.length);

  // Group by campus
  const byCampus = {};
  rows.forEach(r => { (byCampus[r.campus] = byCampus[r.campus] || []).push(r.date); });

  let updated = 0;
  for (const [campus, dates] of Object.entries(byCampus)) {
    const capacity = cap.get(campus) || 0;
    if (!capacity) { console.log('  No capacity found for:', campus); continue; }
    // Update all dates for this campus in one PATCH
    const inList = dates.map(d => '"' + d + '"').join(',');
    const res = await fetch(
      S + '/rest/v1/daily_occupancy?campus=eq.' + encodeURIComponent(campus) + '&date=in.(' + encodeURIComponent(inList) + ')',
      { method: 'PATCH', headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }, body: JSON.stringify({ capacity }) }
    );
    if (res.ok) { updated += dates.length; console.log(' ', campus.padEnd(22), 'capacity=' + capacity, '(' + dates.length + ' dates)'); }
    else { console.error('  Failed:', campus, res.status, await res.text()); }
  }
  console.log('\nDone —', updated, 'rows updated with capacity.');
}
main().catch(console.error);
