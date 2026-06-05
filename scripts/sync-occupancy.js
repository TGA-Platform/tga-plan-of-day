/**
 * sync-occupancy.js
 *
 * Reads the "Occupancy" tab from the SharePoint attendance spreadsheet,
 * sums enrolled (booked) children per centre per day, and upserts into
 * the Supabase `daily_occupancy` table.
 *
 * The Occupancy tab structure:
 *   Centre | Week (Mon date) | Room | Capacity |
 *   Mon Enrolled | Mon Vacant | Tue Enrolled | Tue Vacant |
 *   Wed Enrolled | Wed Vacant | Thu Enrolled | Thu Vacant |
 *   Fri Enrolled | Fri Vacant | Weekly Avg %
 *
 * Scheduled: whenever the SharePoint file is updated (run after
 *   update-sharepoint-attendance.js or on a weekly Monday cron).
 *
 * Manual run: node scripts/sync-occupancy.js [--dry-run]
 */

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DRY_RUN      = process.argv.includes('--dry-run');

// Column indices in the Occupancy tab (1-based ExcelJS)
const COL = {
  centre:       1,
  week:         2,
  room:         3,
  capacity:     4,
  monEnrolled:  5,  monVacant:  6,
  tueEnrolled:  7,  tueVacant:  8,
  wedEnrolled:  9,  wedVacant:  10,
  thuEnrolled:  11, thuVacant:  12,
  friEnrolled:  13, friVacant:  14,
};

const DAY_COLS = [
  { offset: 0, col: COL.monEnrolled }, // Monday
  { offset: 1, col: COL.tueEnrolled }, // Tuesday
  { offset: 2, col: COL.wedEnrolled }, // Wednesday
  { offset: 3, col: COL.thuEnrolled }, // Thursday
  { offset: 4, col: COL.friEnrolled }, // Friday
];

/** Strip term suffixes like " — Sep", " - Term 3" etc. to get the base centre name */
function normaliseCentre(name) {
  return name
    .replace(/\s*[—–-]+\s*(Sep|Term\s*\d+|T\d+|Jul|Jan|Apr|Oct)\s*.*$/i, '')
    .trim();
}

/** Format Date as YYYY-MM-DD */
function fmt(d) {
  return d.toISOString().slice(0, 10);
}

/** Add days to a date */
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

async function supabaseUpsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_occupancy`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed (${res.status}): ${await res.text()}`);
}

function downloadFile() {
  const localPath = path.join(__dirname, 'audit-tmp', 'attendance-records-download.xlsx');
  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
    console.log(`  Using local cache: ${localPath}`);
    return localPath;
  }
  throw new Error('Local attendance-records-download.xlsx not found. Run update-sharepoint-attendance.js first.');
}

async function main() {
  console.log(`\n📊 Syncing Occupancy tab to Supabase daily_occupancy${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const filePath = downloadFile();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet('Occupancy');
  if (!ws) throw new Error('No "Occupancy" tab found in the spreadsheet');

  // Accumulate: { "Campus|YYYY-MM-DD" => booked total }
  const totals = new Map();

  ws.eachRow((row, i) => {
    if (i === 1) return; // skip header
    const rawCentre = String(row.getCell(COL.centre).value || '').trim();
    const weekVal   = row.getCell(COL.week).value;
    if (!rawCentre || !weekVal) return;

    const centre = normaliseCentre(rawCentre);
    // Week can be a Date object or a string
    const weekDate = weekVal instanceof Date ? weekVal : new Date(String(weekVal));
    if (isNaN(weekDate.getTime())) return;

    for (const { offset, col } of DAY_COLS) {
      const date   = fmt(addDays(weekDate, offset));
      const booked = Number(row.getCell(col).value || 0);
      if (booked === 0) continue;

      const key = `${centre}|${date}`;
      totals.set(key, (totals.get(key) || 0) + booked);
    }
  });

  const rows = [...totals.entries()].map(([key, booked]) => {
    const [campus, date] = key.split('|');
    return { campus, date, booked, updated_at: new Date().toISOString() };
  });

  console.log(`  Parsed ${rows.length} campus-day records from ${ws.rowCount - 1} rows`);

  if (DRY_RUN) {
    console.log('\nSample (first 10):');
    rows.slice(0, 10).forEach(r => console.log(`  ${r.campus.padEnd(20)} ${r.date}  booked: ${r.booked}`));
    return;
  }

  // Upsert in batches of 200
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    process.stdout.write(`  Upserting ${i + 1}–${Math.min(i + BATCH, rows.length)} / ${rows.length} …`);
    await supabaseUpsert(rows.slice(i, i + BATCH));
    console.log(' ✓');
  }

  console.log(`\n✅  Done — ${rows.length} records upserted to daily_occupancy.\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
