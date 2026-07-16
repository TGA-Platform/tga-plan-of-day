/**
 * update-sharepoint-attendance.js
 * Fetches sign-in/out data from Owna, updates the SharePoint attendance
 * spreadsheet directly via Microsoft Graph API (claude@tga.edu.au).
 *
 * Columns: Campus | Child Name | Date | Room | Sign In | Sign Out | Age
 *
 * Usage:
 *   node update-sharepoint-attendance.js --today           (today's data, all open centres)
 *   node update-sharepoint-attendance.js --date 2026-05-21 (specific date)
 *   node update-sharepoint-attendance.js --week 2026-05-12 (full week, Mon–Fri)
 *   node update-sharepoint-attendance.js --weeks-ahead 4   (this week + next 3 weeks, Mon–Fri)
 *   node update-sharepoint-attendance.js --centre Wollongong --today
 *   node update-sharepoint-attendance.js --all --today
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const ExcelJS = require('exceljs');
const { getOwnaPage, closeBrowser } = require('./owna-login');
const { uploadToSharePoint, getGraphToken } = require('./sharepoint-upload');

const SHARE_URL = 'https://thegroveacademy.sharepoint.com/:x:/s/Finance/IQAazquikS6qTodH2V3L5Dg5Aa9vesN6WcOVxpfGu_yqhNc?e=Gga7AA';

const CENTRE_IDS = {
  'Wollongong':       '65810f6541645f2494b4f11e',
  'Dapto 1':          '6581113841645f2494b4f15e',
  'Dapto 2':          '658110ff41645f2494b4f153',
  'North Wollongong': '65d42604150a270130666f71',
  'Shell Cove':       '66e8d6ec751a81632b86b08c',
  'South Nowra':      '6823c8959a192da367f862ba',
  'Bexley':           '658111d441645f2494b4f168',
  'Oatley':           '65810fee41645f2494b4f12a',
  'Belfield':         '6823c8629a192da367f862a1',
  'Bankstown':        '6823c8879a192da367f862b2',
  'Mount Annan':      '6581103b41645f2494b4f134',
  'Spring Farm':      '65efd1f90316a49a083263c0',
  'Denham Court':     '65efd1c90316a49a083263b9',
  'Ed Park 1':        '658110d941645f2494b4f149',
  'Ed Park 2':        '6581108841645f2494b4f13e',
  'Wilton':           '67e23a1f7021cf1515c54a14',
  'Glendale':         '6823c88b9a192da367f862ba',
  'Edgeworth':        '6823c8779a192da367f862a9',
  'Aberglasslyn':     '6581108841645f2494b4f13f',
  'Charlestown':      '6823c8779a192da367f862aa',
  'Moorebank':        '6823c8879a192da367f862b3',
  'Tuggerah':         '6823c8959a192da367f862bb',
  'Bomaderry':        '6823c8629a192da367f862a2',
};
const TMP_DIR       = path.join(__dirname, 'audit-tmp');
const LOCAL_DL      = path.join(TMP_DIR, 'attendance-records-download.xlsx');
const LOCAL_OUT     = path.join(TMP_DIR, 'attendance-records-updated.xlsx');

// ─── Args ─────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const weekArg    = args.includes('--week')       ? args[args.indexOf('--week') + 1]       : null;
const dateArg    = args.includes('--date')       ? args[args.indexOf('--date') + 1]       : null;
const weeksAheadArg = args.includes('--weeks-ahead') ? parseInt(args[args.indexOf('--weeks-ahead') + 1], 10) : null;
const isToday    = args.includes('--today');
const centreArg  = args.includes('--centre')     ? args[args.indexOf('--centre') + 1]     : null;
// --today fetches all open centres unless --centre is explicitly specified
const isAll      = args.includes('--all') || (isToday && !centreArg);

// ─── Date helpers ─────────────────────────────────────────────────────────────
function getLastMondayStr() {
  // Use en-US locale string (parseable by V8) to get Sydney wall-clock time
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return fmtDate(monday);
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d);
}
function weekDays(m) { return [0,1,2,3,4].map(i => addDays(m, i)); }
function dayLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}
function extractTime(t) { const m = (t||'').match(/\b(\d{1,2}:\d{2})\b/); return m ? m[1] : ''; }
function normaliseName(n) { return (n||'').toLowerCase().trim().replace(/\s+/g,' '); }

// ─── Build DOB lookup from Children tab ──────────────────────────────────────
function buildDobLookup(wb) {
  const ws = wb.getWorksheet('Children');
  if (!ws) { console.log('  No Children tab found — age will be blank (run owna-children-dob.js first)'); return {}; }
  const lookup = {};
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const name = normaliseName(String(row.getCell(2).value || ''));
    const dob  = String(row.getCell(3).value || '');
    if (name && dob) lookup[name] = dob;
  });
  console.log(`  Children tab loaded: ${Object.keys(lookup).length} DOB records`);
  return lookup;
}

// ─── Calculate age string from DOB (dd/mm/yyyy) ───────────────────────────────
function calcAge(dobStr) {
  if (!dobStr) return '';
  const [d, m, y] = dobStr.split('/').map(Number);
  if (!y) return '';
  const dob  = new Date(y, m - 1, d);
  const now  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  let years  = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  if (now.getDate() < dob.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  if (years < 0) return '';
  return years > 0 ? `${years}y ${months}m` : `${months}m`;
}

function getTodayStr() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return fmtDate(now);
}

// ─── Step 1: Download existing file from SharePoint via Graph API ─────────────
async function downloadFromSharePoint(token) {
  const encoded = Buffer.from(SHARE_URL).toString('base64')
    .replace(/=/g,'').replace(/\//g,'_').replace(/\+/g,'-');
  const shareId = `u!${encoded}`;

  return new Promise((resolve) => {
    const doDownload = (url) => {
      https.get(url, { headers: { Authorization: `Bearer ${token}` } }, res => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          doDownload(res.headers.location);
        } else {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (buf.length > 1000) {
              fs.writeFileSync(LOCAL_DL, buf);
              console.log(`  Downloaded: ${buf.length} bytes`);
            } else {
              console.log('  Download returned small/empty response — will create fresh');
            }
            resolve();
          });
        }
      }).on('error', e => { console.log('  Download error:', e.message); resolve(); });
    };
    doDownload(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`);
  });
}

// ─── Step 2: Fetch attendance data from Owna ─────────────────────────────────
// datesToFetch: array of YYYY-MM-DD strings
async function fetchOwnaData(datesToFetch, targets) {
  const { browser, page } = await getOwnaPage();
  const rows = [];
  try {
    await page.goto('https://hq.owna.com.au/children/daily-attendances', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const csrf = await page.evaluate(() =>
      document.querySelector('input[name=__RequestVerificationToken]')?.value
    );
    if (!csrf) throw new Error('No CSRF token on Owna page');

    for (const centreName of targets) {
      const centreId = CENTRE_IDS[centreName];
      console.log(`\n  [${centreName}]`);
      for (const dateStr of datesToFetch) {
        process.stdout.write(`    ${dayLabel(dateStr)}... `);

        const html = await page.evaluate(async ({ cid, date, csrf }) => {
          const b = new URLSearchParams();
          b.append('SelectedCentresIds', cid);
          b.append('StartOfWeek', date);
          const r = await fetch('/children/daily-attendances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': csrf },
            body: b.toString(),
          });
          return r.text();
        }, { cid: centreId, date: dateStr, csrf });

        const tmp = await browser.newPage();
        await tmp.setContent(html, { waitUntil: 'domcontentloaded' });

        // Columns: [toggle, centre, child, room, signIn, signOut, notes, roomChanges, session, fee]
        // Rows with class "background-red" = absent children — excluded from attendance but counted for bookings
        const { dayRows, bookedCount, roomBooked } = await tmp.evaluate(() => {
          const allTrs = [...document.querySelectorAll('table tbody tr')];
          // Booked = ALL rows that have a room (includes absent children with background-red)
          const roomBooked = {};
          const bookedCount = allTrs.filter(tr => {
            const cells = [...tr.querySelectorAll('td')];
            if (cells.length > 3 && (cells[3]||{}).innerText && cells[3].innerText.trim()) {
              const room = cells[3].innerText.trim();
              roomBooked[room] = (roomBooked[room] || 0) + 1;
              return true;
            }
            return false;
          }).length;
          const dayRows = allTrs
            .filter(tr => !tr.className.includes('background-red'))
            .map(tr => {
              const c = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
              return { child: c[2]||'', room: c[3]||'', signIn: c[4]||'', signOut: c[5]||'', age: '' };
            })
            .filter(r => r.room && (r.signIn || r.signOut));
          return { dayRows, bookedCount, roomBooked };
        });
        await tmp.close();

        // Track booked counts for Daily Occupancy tab (campus total + per-room)
        if (bookedCount > 0) {
          const occKey = centreName + '|' + dateStr;
          if (!rows._occupancy) rows._occupancy = {};
          if (!rows._occupancy[occKey]) rows._occupancy[occKey] = { booked: 0, roomBooked: {} };
          rows._occupancy[occKey].booked += bookedCount;
          for (const [room, count] of Object.entries(roomBooked)) {
            rows._occupancy[occKey].roomBooked[room] = (rows._occupancy[occKey].roomBooked[room] || 0) + count;
          }
        }

        console.log(`${dayRows.length} attended / ${bookedCount} booked`);
        dayRows.forEach(r => rows.push({
          campus:  centreName,
          child:   r.child,
          date:    dayLabel(dateStr),
          dateStr: dateStr,
          room:    r.room,
          signIn:  extractTime(r.signIn),
          signOut: extractTime(r.signOut),
          age:     r.age,
        }));
        await page.waitForTimeout(500);
      }
    }
  } finally {
    await closeBrowser(browser);
  }
  return rows;
}

// ─── Column definitions (new structure) ──────────────────────────────────────
// Campus | Child Name | Date | Room | Sign In | Sign Out | Age
const NEW_HEADERS = ['Campus', 'Child Name', 'Date', 'Room', 'Sign In', 'Sign Out', 'Age'];
const COL_WIDTHS  = [20, 28, 26, 22, 12, 12, 10];

// ─── Step 2b: Update Daily Occupancy tab ────────────────────────────────────
async function updateDailyOccupancyTab(wb, occupancyMap) {
  // occupancyMap: { "Campus|YYYY-MM-DD": { booked: number, roomBooked: { [room]: count } } | number }
  const OCC_HEADERS = ['Campus', 'Date', 'Booked', 'Attended', 'Absent'];
  const headerFill  = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1a2e1a' } };
  const headerFont  = { bold:true, color:{ argb:'FFFFFFFF' }, size:11 };

  let ws = wb.getWorksheet('Daily Occupancy');
  if (!ws) {
    ws = wb.addWorksheet('Daily Occupancy');
    ws.getRow(1).values = OCC_HEADERS;
    ws.getRow(1).eachCell(cell => {
      cell.fill = headerFill; cell.font = headerFont;
      cell.alignment = { horizontal:'center', vertical:'middle' };
    });
    ws.getRow(1).height = 22;
    ws.columns = [{ width: 22 }, { width: 16 }, { width: 10 }, { width: 12 }, { width: 10 }];
  }

  // Remove existing rows for the dates being updated (to avoid duplicates)
  const datesToUpdate = new Set([...Object.keys(occupancyMap)].map(k => k.split('|')[1]));
  const toDelete = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const dateVal = String(row.getCell(2).value || '');
    if (datesToUpdate.has(dateVal)) toDelete.push(rn);
  });
  for (const rn of toDelete.reverse()) ws.spliceRows(rn, 1);

  // Build attended counts from occupancyMap keys (will be filled after fetchOwnaData)
  // occupancyMap values are either legacy numbers or { booked, roomBooked }
  for (const [key, data] of Object.entries(occupancyMap)) {
    if (key.includes('__')) continue;
    const [campus, date] = key.split('|');
    const booked = typeof data === 'number' ? data : (data?.booked || 0);
    const attended = occupancyMap[key + '__attended'] || 0;
    const absent   = Math.max(0, booked - attended);
    const row = ws.addRow([campus, date, booked, attended, absent]);
    row.getCell(2).alignment = { horizontal: 'center' };
    [3,4,5].forEach(c => row.getCell(c).alignment = { horizontal: 'center' });
  }

  console.log(`  Daily Occupancy tab: upserted ${Object.keys(occupancyMap).filter(k => !k.includes('__')).length} rows`);
}

// ─── Step 3: Update Excel file ────────────────────────────────────────────────
// datesToReplace: array of YYYY-MM-DD strings whose rows should be removed before appending
async function updateExcel(attendanceRows, datesToReplace, dobLookup) {
  const wb = new ExcelJS.Workbook();
  const headerFill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1a2e1a' } };
  const headerFont = { bold:true, color:{ argb:'FFFFFFFF' }, size:11 };
  const altFill    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF5F5F5' } };

  if (fs.existsSync(LOCAL_DL) && fs.statSync(LOCAL_DL).size > 1000) {
    await wb.xlsx.readFile(LOCAL_DL);
    console.log('  Loaded existing file. Sheets:', wb.worksheets.map(w => w.name).join(', '));
  }

  // Use passed-in DOB lookup (built from downloaded workbook in main)
  dobLookup = dobLookup || {};

  let ws = wb.getWorksheet('Attendance') || wb.worksheets[0];
  if (!ws) ws = wb.addWorksheet('Attendance');
  console.log(`  Using sheet: "${ws.name}"`);

  // Check if existing headers match new structure — rebuild if not
  let existingHeaders = ws.getRow(1).values.slice(1).map(v => String(v||'').toLowerCase().trim());
  const hasNewStructure = existingHeaders[0] === 'campus' && existingHeaders[1] === 'child name';

  if (!existingHeaders.some(Boolean) || !hasNewStructure) {
    // Column structure has changed — wipe and rebuild the worksheet entirely
    console.log('  Rebuilding to new column structure (Campus, Child Name, Date, Room, Sign In, Sign Out, Age)');
    const wsName = ws.name;
    wb.removeWorksheet(ws.id);
    ws = wb.addWorksheet(wsName);
    ws.getRow(1).values = NEW_HEADERS;
    ws.getRow(1).eachCell(cell => {
      cell.fill = headerFill; cell.font = headerFont;
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = { bottom: { style:'medium', color:{ argb:'FF4a7a3a' } } };
    });
    ws.getRow(1).height = 22;
    ws.columns = COL_WIDTHS.map(w => ({ width: w }));
    existingHeaders = NEW_HEADERS.map(h => h.toLowerCase());
    console.log('  Sheet reset. Headers:', NEW_HEADERS.join(', '));
  } else {
    console.log('  Headers OK:', existingHeaders.join(', '));
  }

  // Column index map (1-based)
  const ci = {
    campus:  existingHeaders.findIndex(h => /campus/i.test(h)) + 1 || 1,
    child:   existingHeaders.findIndex(h => /child/i.test(h))  + 1 || 2,
    date:    existingHeaders.findIndex(h => /date/i.test(h))   + 1 || 3,
    room:    existingHeaders.findIndex(h => /room/i.test(h))   + 1 || 4,
    signIn:  existingHeaders.findIndex(h => /sign.?in/i.test(h))  + 1 || 5,
    signOut: existingHeaders.findIndex(h => /sign.?out/i.test(h)) + 1 || 6,
    age:     existingHeaders.findIndex(h => /age/i.test(h))    + 1 || 7,
  };

  // Remove existing rows for the dates being replaced
  const dateLabels = datesToReplace.map(d => dayLabel(d));
  const toDelete = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const v = String(row.getCell(ci.date).value || '');
    if (dateLabels.some(dl => v === dl || v.includes(dl.substring(0, 6)))) toDelete.push(rn);
  });
  for (const rn of toDelete.reverse()) ws.spliceRows(rn, 1);
  if (toDelete.length) console.log(`  Removed ${toDelete.length} existing rows for replaced dates`);

  // Append new rows
  let alt = (ws.actualRowCount % 2) === 0;
  for (const r of attendanceRows) {
    const row = ws.addRow([]);
    const age = calcAge(dobLookup[normaliseName(r.child)]);
    row.getCell(ci.campus).value  = r.campus;
    row.getCell(ci.child).value   = r.child;
    row.getCell(ci.date).value    = r.date;
    row.getCell(ci.room).value    = r.room;
    row.getCell(ci.signIn).value  = r.signIn;
    row.getCell(ci.signOut).value = r.signOut;
    row.getCell(ci.age).value     = age;
    [ci.date, ci.signIn, ci.signOut, ci.age].forEach(c => row.getCell(c).alignment = { horizontal:'center' });
    if (alt) row.eachCell(cell => { cell.fill = altFill; });
    alt = !alt;
  }

  ws.views = [{ state:'frozen', ySplit:1 }];
  ws.autoFilter = { from:'A1', to: `${String.fromCharCode(64 + NEW_HEADERS.length)}1` };

  await wb.xlsx.writeFile(LOCAL_OUT);
  console.log(`  Saved locally: ${LOCAL_OUT} (${attendanceRows.length} rows appended)`);
  return LOCAL_OUT;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Determine which dates to fetch
  let datesToFetch;
  if (isToday || dateArg) {
    const d = dateArg || getTodayStr();
    datesToFetch = [d];
    console.log(`\n=== SharePoint Attendance Update: ${dayLabel(d)} ===`);
  } else if (weeksAheadArg && weeksAheadArg > 0) {
    const mondayStr = weekArg || getLastMondayStr();
    const start = new Date(mondayStr + 'T00:00:00');
    datesToFetch = [];
    for (let i = 0; i < weeksAheadArg; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + 7 * i);
      datesToFetch.push(...weekDays(fmtDate(d)));
    }
    console.log(`\n=== SharePoint Attendance Update: ${weeksAheadArg} weeks ahead from ${mondayStr} (${datesToFetch.length} weekdays) ===`);
  } else {
    const mondayStr = weekArg || getLastMondayStr();
    datesToFetch = weekDays(mondayStr);
    console.log(`\n=== SharePoint Attendance Update: week of ${mondayStr} ===`);
  }

  // Determine target centres
  let targets;
  if (isAll) {
    const { getOpenCentres } = require('./cluster-config');
    const open = await getOpenCentres();
    targets = open.map(c => c.name).filter(name => CENTRE_IDS[name]);
    console.log(`Open centres (${targets.length}): ${targets.join(', ')}`);
  } else if (centreArg) {
    targets = [centreArg];
    console.log(`Centre: ${centreArg}`);
  } else {
    targets = ['Wollongong'];
    console.log('Centre: Wollongong (default)');
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });

  // 1. Get Graph API token
  console.log('\n1. Authenticating with Microsoft Graph...');
  const token = await getGraphToken();
  console.log('   Token OK');

  // 2. Download existing file
  console.log('\n2. Downloading current SharePoint file...');
  await downloadFromSharePoint(token);

  // 3. Fetch Owna data
  console.log('\n3. Fetching attendance data from Owna...');
  const rows = await fetchOwnaData(datesToFetch, targets);
  console.log(`\n   Total: ${rows.length} records`);

  // Extract booked counts and compute attended per campus+date
  const occupancyMap = rows._occupancy || {};
  // Count attended per campus+date from the actual rows
  for (const r of rows) {
    const key = r.campus + '|' + r.dateStr + '__attended';
    occupancyMap[key] = (occupancyMap[key] || 0) + 1;
  }

  if (rows.length === 0 && Object.keys(occupancyMap).length === 0) {
    console.log('   No records found — skipping upload.');
    process.exit(0);
  }

  // 3b. Build DOB lookup from already-downloaded workbook
  let dobLookup = {};
  try {
    const wbTmp = new ExcelJS.Workbook();
    if (fs.existsSync(LOCAL_DL) && fs.statSync(LOCAL_DL).size > 1000) {
      await wbTmp.xlsx.readFile(LOCAL_DL);
      dobLookup = buildDobLookup(wbTmp);
    }
  } catch (e) { console.log('  DOB lookup skipped:', e.message); }

  // 4. Update Excel (Attendance tab + Daily Occupancy tab)
  console.log('\n4. Updating spreadsheet...');
  const outPath = await updateExcel(rows, datesToFetch, dobLookup);

  // 4b. Write Daily Occupancy tab
  if (Object.keys(occupancyMap).filter(k => !k.includes('__')).length > 0) {
    const wbOcc = new ExcelJS.Workbook();
    if (fs.existsSync(outPath)) await wbOcc.xlsx.readFile(outPath);
    await updateDailyOccupancyTab(wbOcc, occupancyMap);
    await wbOcc.xlsx.writeFile(outPath);
    console.log('  Daily Occupancy tab updated');
  }

  // 5. Upload back to SharePoint
  console.log('\n5. Uploading to SharePoint...');
  await uploadToSharePoint(outPath, SHARE_URL);

  console.log(`\n✅ Done — ${rows.length} records written to SharePoint.`);

  // 6b. Upsert to Supabase daily_occupancy
  const occEntries = Object.entries(occupancyMap).filter(([k]) => !k.includes('__'));
  if (occEntries.length > 0) {
    try {
      const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
      const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
      const occRows = occEntries.map(([key, data]) => {
        const [campus, date] = key.split('|');
        const booked = typeof data === 'number' ? data : (data?.booked || 0);
        const roomBooked = typeof data === 'object' ? (data?.roomBooked || {}) : {};
        // Note: do NOT include capacity here — it is set separately by sync-occupancy.js
        // and we don't want to overwrite it with 0 on every daily run
        return { campus, date, booked, room_booked: roomBooked, updated_at: new Date().toISOString() };
      });
      const res = await fetch(SUPABASE_URL + '/rest/v1/daily_occupancy', {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(occRows),
      });
      if (res.ok) console.log(`  Supabase daily_occupancy: upserted ${occRows.length} rows`);
      else console.error('  Supabase upsert failed:', res.status, await res.text());
    } catch (e) { console.error('  Supabase occupancy upsert error:', e.message); }
  }

  // 6. Push to Supabase for live dashboard
  console.log('\n6. Pushing to Supabase...');
  const { replaceAttendanceForDate } = require('./supabase-attendance');
  const byCampusDate = {};
  for (const r of rows) {
    const key = `${r.campus}||${r.dateStr}`;
    if (!byCampusDate[key]) byCampusDate[key] = [];
    byCampusDate[key].push({
      campus:     r.campus,
      child_name: r.child,
      date:       r.dateStr,
      room:       r.room,
      sign_in:    r.signIn  || null,
      sign_out:   r.signOut || null,
      age:        calcAge(dobLookup[normaliseName(r.child)]) || null,
    });
  }
  for (const [key, campusRows] of Object.entries(byCampusDate)) {
    const [campus, date] = key.split('||');
    await replaceAttendanceForDate(campus, date, campusRows);
  }
  console.log(`  Supabase push complete.`);
})();
