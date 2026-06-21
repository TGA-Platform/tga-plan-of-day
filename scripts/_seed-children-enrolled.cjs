// Seed children_enrolled from the local SharePoint xlsx (most recent download)
const ExcelJS = require('exceljs');
const https = require('https');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../api/deputy-rosters.js'), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const FILE = path.join(__dirname, '../../scripts/audit-tmp/attendance-records-updated.xlsx');

function dobToIso(dob) {
  if (!dob) return null;
  const [d, m, y] = String(dob).split('/');
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function upsert(rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const req = https.request({
      hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
      path: '/rest/v1/children_enrolled',
      method: 'POST',
      headers: {
        apikey: SK, Authorization: `Bearer ${SK}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Prefer: 'resolution=merge-duplicates',
      },
    }, res => {
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`${res.statusCode}: ${Buffer.concat(c).toString().slice(0,200)}`));
        else resolve(res.statusCode);
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function main() {
  console.log('Reading', FILE);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet('Children');
  if (!ws) { console.error('No Children tab'); process.exit(1); }

  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const campus = row.getCell(1)?.value;
    const name   = row.getCell(2)?.value;
    const dob    = row.getCell(3)?.value;
    const status = row.getCell(5)?.value;
    if (!campus || !name) return;
    rows.push({
      campus:     String(campus),
      full_name:  String(name),
      dob:        dobToIso(String(dob || '')),
      status:     String(status || 'Confirmed'),
      updated_at: new Date().toISOString(),
    });
  });

  console.log(`${rows.length} children to upsert`);

  // Batch 500 at a time
  const PAGE = 500;
  for (let i = 0; i < rows.length; i += PAGE) {
    const batch = rows.slice(i, i + PAGE);
    await upsert(batch);
    console.log(`  Upserted ${Math.min(i + PAGE, rows.length)} / ${rows.length}`);
  }
  console.log('✅ Done');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
