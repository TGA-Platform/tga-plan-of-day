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

  const dailyWs = wb.getWorksheet('Daily Occupancy');
  const occWs   = wb.getWorksheet('Occupancy');

  // Prefer the "Daily Occupancy" tab (real historical data from Owna daily runs)
  // Fall back to "Occupancy" tab (future booking data) if Daily Occupancy not yet populated.
  // We still read the "Occupancy" tab for per-room booked counts even when Daily Occupancy
  // supplies the campus total, so forward-looking room forecasts keep their booked badges.
  const ws = dailyWs || occWs;
  if (!ws) throw new Error('No "Daily Occupancy" or "Occupancy" tab found in the spreadsheet');
  console.log(`  Campus totals from: "${ws.name}"`);
  const isDailyTab = ws.name === 'Daily Occupancy';

  // Always read capacity from the "Occupancy" tab (room capacities defined there)
  const capacity = new Map(); // centre => total licensed places
  if (occWs) {
    const seen = new Set(); // avoid double-counting rooms across term entries
    occWs.eachRow((row, i) => {
      if (i === 1) return;
      const rawC = String(row.getCell(1).value || '').trim();
      const room  = String(row.getCell(3).value || '').trim();
      const cap   = Number(row.getCell(4).value || 0);
      if (!rawC || cap === 0) return;
      const centre = normaliseCentre(rawC);
      const key = `${centre}|${room}`;
      if (!seen.has(key)) { // count each room once regardless of how many term entries
        seen.add(key);
        capacity.set(centre, (capacity.get(centre) || 0) + cap);
      }
    });
    console.log(`  Capacity: ${capacity.size} centres loaded from Occupancy tab`);
  } else {
    console.warn('  No Occupancy tab found — capacity will be 0');
  }

  // Accumulate booked totals per campus+date
  const totals = new Map(); // "Campus|YYYY-MM-DD" => booked

  // Accumulate per-room booked counts per campus+date from the Occupancy tab.
  // This is independent of the campus total source so future dates still get room-level detail.
  const roomBooked = new Map(); // "Campus|YYYY-MM-DD" => { [roomName]: count }

  if (occWs) {
    occWs.eachRow((row, i) => {
      if (i === 1) return;
      const rawCentre = String(row.getCell(COL.centre).value || '').trim();
      const weekVal   = row.getCell(COL.week).value;
      if (!rawCentre || !weekVal) return;
      const centre = normaliseCentre(rawCentre);
      const weekDate = weekVal instanceof Date ? weekVal : new Date(String(weekVal));
      if (isNaN(weekDate.getTime())) return;
      const room = String(row.getCell(COL.room).value || '').trim();
      if (!room) return;
      for (const { offset, col } of DAY_COLS) {
        const date   = fmt(addDays(weekDate, offset));
        const booked = Number(row.getCell(col).value || 0);
        const key = `${centre}|${date}`;
        const byRoom = roomBooked.get(key) || {};
        byRoom[room] = (byRoom[room] || 0) + booked;
        roomBooked.set(key, byRoom);
      }
    });
    console.log(`  Per-room booked: ${roomBooked.size} campus-day records from Occupancy tab`);
  }

  ws.eachRow((row, i) => {
    if (i === 1) return; // skip header

    if (isDailyTab) {
      // Daily Occupancy tab: Campus | Date | Booked | Attended | Absent
      const campus = String(row.getCell(1).value || '').trim();
      const dateVal = row.getCell(2).value;
      const booked  = Number(row.getCell(3).value || 0);
      if (!campus || !dateVal || booked === 0) return;
      const date = dateVal instanceof Date ? fmt(dateVal) : String(dateVal).slice(0, 10);
      if (!date || date.length < 10) return;
      const key = `${campus}|${date}`;
      totals.set(key, (totals.get(key) || 0) + booked);
    } else {
      // Occupancy tab: Centre | Week | Room | Capacity | Mon Enrolled | ...
      const rawCentre = String(row.getCell(COL.centre).value || '').trim();
      const weekVal   = row.getCell(COL.week).value;
      if (!rawCentre || !weekVal) return;
      const centre = normaliseCentre(rawCentre);
      const weekDate = weekVal instanceof Date ? weekVal : new Date(String(weekVal));
      if (isNaN(weekDate.getTime())) return;
      for (const { offset, col } of DAY_COLS) {
        const date   = fmt(addDays(weekDate, offset));
        const booked = Number(row.getCell(col).value || 0);
        if (booked === 0) continue;
        const key = `${centre}|${date}`;
        totals.set(key, (totals.get(key) || 0) + booked);
      }
    }
  });

  const rows = [...totals.entries()].map(([key, booked]) => {
    const [campus, date] = key.split('|');
    const cap = capacity.get(campus) || 0;
    const byRoom = roomBooked.get(key);
    const row = {
      campus,
      date,
      booked,
      capacity: cap,
      updated_at: new Date().toISOString(),
    };
    // Only write room_booked when we have real per-room data. If the Occupancy tab
    // doesn't cover this date, leave any existing room_booked alone (e.g. from
    // update-sharepoint-attendance.js) instead of overwriting it with {}.
    if (byRoom && Object.keys(byRoom).length > 0) {
      row.room_booked = byRoom;
    }
    return row;
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
