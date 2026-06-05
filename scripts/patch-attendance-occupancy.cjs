'use strict';
/**
 * Patch update-sharepoint-attendance.js to:
 * 1. Also count absent (background-red) rows to get the BOOKED total per centre+date
 * 2. Write a "Daily Occupancy" tab: Campus | Date | Booked | Attended | Absent
 * 3. Upsert to Supabase daily_occupancy table
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'update-sharepoint-attendance.js');
let src = fs.readFileSync(file, 'utf8');
let changed = 0;

function replace(oldStr, newStr, label) {
  if (!src.includes(oldStr)) { console.error('NOT FOUND: ' + label); return; }
  src = src.replace(oldStr, newStr);
  changed++;
  console.log('\u2713 ' + label);
}

// ── 1. In fetchOwnaData: also capture bookedCount per centre+date ──────────────
// Change the evaluate() call to also count absent rows
replace(
  `        // Columns: [toggle, centre, child, room, signIn, signOut, notes, roomChanges, session, fee]
        // Rows with class "background-red" = absent children — must be excluded
        const dayRows = await tmp.evaluate(() =>
          [...document.querySelectorAll('table tbody tr')]
            .filter(tr => !tr.className.includes('background-red'))
            .map(tr => {
              const c = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
              return {
                child:  c[2]||'',
                room:   c[3]||'',
                signIn: c[4]||'',
                signOut:c[5]||'',
                age:    '',
              };
            })
            .filter(r => r.room && (r.signIn || r.signOut))
        );
        await tmp.close();

        console.log(\`\${dayRows.length} records\`);
        dayRows.forEach(r => rows.push({`,
  `        // Columns: [toggle, centre, child, room, signIn, signOut, notes, roomChanges, session, fee]
        // Rows with class "background-red" = absent children — excluded from attendance but counted for bookings
        const { dayRows, bookedCount } = await tmp.evaluate(() => {
          const allTrs = [...document.querySelectorAll('table tbody tr')];
          // Booked = ALL rows that have a room (includes absent children with background-red)
          const bookedCount = allTrs.filter(tr => {
            const cells = [...tr.querySelectorAll('td')];
            return cells.length > 3 && (cells[3]||{}).innerText && cells[3].innerText.trim();
          }).length;
          const dayRows = allTrs
            .filter(tr => !tr.className.includes('background-red'))
            .map(tr => {
              const c = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
              return { child: c[2]||'', room: c[3]||'', signIn: c[4]||'', signOut: c[5]||'', age: '' };
            })
            .filter(r => r.room && (r.signIn || r.signOut));
          return { dayRows, bookedCount };
        });
        await tmp.close();

        // Track booked counts for Daily Occupancy tab
        if (bookedCount > 0) {
          const occKey = centreName + '|' + dateStr;
          if (!rows._occupancy) rows._occupancy = {};
          rows._occupancy[occKey] = (rows._occupancy[occKey] || 0) + bookedCount;
        }

        console.log(\`\${dayRows.length} attended / \${bookedCount} booked\`);
        dayRows.forEach(r => rows.push({`,
  'Capture bookedCount in evaluate'
);

// ── 2. Add updateDailyOccupancyTab function before the Step 4 comment ─────────
replace(
  `// ─── Step 3: Update Excel file ────────────────────────────────────────────────`,
  `// ─── Step 2b: Update Daily Occupancy tab ────────────────────────────────────
async function updateDailyOccupancyTab(wb, occupancyMap) {
  // occupancyMap: { "Campus|YYYY-MM-DD": bookedCount }
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
  // occupancyMap values are booked counts; attended is passed separately
  for (const [key, booked] of Object.entries(occupancyMap)) {
    const [campus, date] = key.split('|');
    const attended = occupancyMap[key + '__attended'] || 0;
    const absent   = Math.max(0, booked - attended);
    const row = ws.addRow([campus, date, booked, attended, absent]);
    row.getCell(2).alignment = { horizontal: 'center' };
    [3,4,5].forEach(c => row.getCell(c).alignment = { horizontal: 'center' });
  }

  console.log(\`  Daily Occupancy tab: upserted \${Object.keys(occupancyMap).filter(k => !k.includes('__')).length} rows\`);
}

// ─── Step 3: Update Excel file ────────────────────────────────────────────────`,
  'Add updateDailyOccupancyTab function'
);

// ── 3. After fetching Owna data, extract occupancy map and attended counts ─────
replace(
  `  console.log('\\n3. Fetching attendance data from Owna...');
  const rows = await fetchOwnaData(datesToFetch, targets);
  console.log(\`\\n   Total: \${rows.length} records\`);

  if (rows.length === 0) {
    console.log('   No records found — skipping upload.');
    process.exit(0);
  }`,
  `  console.log('\\n3. Fetching attendance data from Owna...');
  const rows = await fetchOwnaData(datesToFetch, targets);
  console.log(\`\\n   Total: \${rows.length} records\`);

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
  }`,
  'Extract occupancy map after fetch'
);

// ── 4. Call updateDailyOccupancyTab in step 4 and also upsert to Supabase ─────
replace(
  `  // 4. Update Excel
  console.log('\\n4. Updating spreadsheet...');
  const outPath = await updateExcel(rows, datesToFetch, dobLookup);`,
  `  // 4. Update Excel (Attendance tab + Daily Occupancy tab)
  console.log('\\n4. Updating spreadsheet...');
  const outPath = await updateExcel(rows, datesToFetch, dobLookup);

  // 4b. Write Daily Occupancy tab
  if (Object.keys(occupancyMap).filter(k => !k.includes('__')).length > 0) {
    const wbOcc = new ExcelJS.Workbook();
    if (fs.existsSync(outPath)) await wbOcc.xlsx.readFile(outPath);
    await updateDailyOccupancyTab(wbOcc, occupancyMap);
    await wbOcc.xlsx.writeFile(outPath);
    console.log('  Daily Occupancy tab updated');
  }`,
  'Call updateDailyOccupancyTab in step 4'
);

// ── 5. Upsert to Supabase daily_occupancy after step 6 ────────────────────────
replace(
  `  console.log(\`\\n✅ Done — \${rows.length} records written to SharePoint.\`);`,
  `  console.log(\`\\n✅ Done — \${rows.length} records written to SharePoint.\`);

  // 6b. Upsert to Supabase daily_occupancy
  const occEntries = Object.entries(occupancyMap).filter(([k]) => !k.includes('__'));
  if (occEntries.length > 0) {
    try {
      const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
      const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
      const occRows = occEntries.map(([key, booked]) => {
        const [campus, date] = key.split('|');
        return { campus, date, booked, updated_at: new Date().toISOString() };
      });
      const res = await fetch(SUPABASE_URL + '/rest/v1/daily_occupancy', {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(occRows),
      });
      if (res.ok) console.log(\`  Supabase daily_occupancy: upserted \${occRows.length} rows\`);
      else console.error('  Supabase upsert failed:', res.status, await res.text());
    } catch (e) { console.error('  Supabase occupancy upsert error:', e.message); }
  }`,
  'Upsert to Supabase daily_occupancy'
);

fs.writeFileSync(file, src, 'utf8');
console.log('\nDone \u2014 ' + changed + ' replacements applied to update-sharepoint-attendance.js');
