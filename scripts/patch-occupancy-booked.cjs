const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');
let changed = 0;

function replace(oldStr, newStr, label) {
  if (!src.includes(oldStr)) { console.error('NOT FOUND: ' + label); return; }
  src = src.replace(oldStr, newStr);
  changed++;
  console.log('\u2713 ' + label);
}

// 1. Add booked field to OccupancyRow interface
replace(
  '  lastWeek:       number;\n  change:         number;   // actual - lastWeek (positive = more children than last week)',
  '  booked:         number;   // from daily_occupancy (Owna bookings)\n  lastWeek:       number;\n  change:         number;   // actual - lastWeek (positive = more children than last week)',
  'OccupancyRow interface'
);

// 2. Replace the priorAtt / occRows.push block to also fetch booked
const oldOcc = `          const actual = (att as any[]).length;
          const [yy, mo, dday] = date.split('-').map(Number);
          const priorDate = new Date(Date.UTC(yy, mo - 1, dday - 7)).toISOString().slice(0, 10);
          const priorAtt  = await fetchAttendance(campus, priorDate);
          const expected  = (priorAtt as any[]).length;
          occRows.push({
            date, campus,
            expected: actual,      // "this week" actual
            actual,                 // same field kept for compat
            lastWeek: expected,     // prior week actual (real data)
            change: actual - expected,
          });`;
const newOcc = `          const actual = (att as any[]).length;
          const [yy, mo, dday] = date.split('-').map(Number);
          const priorDate = new Date(Date.UTC(yy, mo - 1, dday - 7)).toISOString().slice(0, 10);
          const priorAtt  = await fetchAttendance(campus, priorDate);
          const lastWeek  = (priorAtt as any[]).length;
          // Booked count from daily_occupancy (synced from Owna Occupancy tab in SharePoint)
          const bookRes = await fetch(
            \`\${SUPABASE_URL}/rest/v1/daily_occupancy?campus=eq.\${encodeURIComponent(campus)}&date=eq.\${date}&select=booked\`,
            { headers: { apikey: ANON_KEY, Authorization: \`Bearer \${ANON_KEY}\` } }
          ).catch(() => null);
          const bookRows: any[] = bookRes?.ok ? await bookRes.json() : [];
          const booked = bookRows[0]?.booked ?? 0;
          occRows.push({
            date, campus,
            expected: actual,
            actual,
            booked,
            lastWeek,
            change: actual - lastWeek,
          });`;
replace(oldOcc, newOcc, 'Fetch booked and add to row');

// 3. Add totalBooked to summary stats
replace(
  '                  const totalThis = occupancyRows.reduce((s, r) => s + r.actual, 0);',
  '                  const totalBooked = occupancyRows.reduce((s, r) => s + (r.booked || 0), 0);\n                  const totalThis = occupancyRows.reduce((s, r) => s + r.actual, 0);',
  'Add totalBooked'
);

// 4. Add booked summary card
replace(
  `                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                        <div className="text-2xl font-bold">{totalThis}</div>
                        <div className="text-xs">Total Children This Period</div>
                      </div>`,
  `                      {totalBooked > 0 && (
                        <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                          <div className="text-2xl font-bold">{totalBooked}</div>
                          <div className="text-xs">Total Booked (Owna)</div>
                        </div>
                      )}
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                        <div className="text-2xl font-bold">{totalThis}</div>
                        <div className="text-xs">Total Attended</div>
                      </div>`,
  'Booked summary card'
);

// 5. Update table headers
replace(
  "['Date','Campus','Attended','Last Week (Same Day)','Change','Trend'].map(h => (",
  "['Date','Campus','Booked','Attended','Absent','Last Week','Change','Trend'].map(h => (",
  'Table headers'
);

// 6. Add booked + absent cells before the Attended cell
replace(
  `                            <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>{r.actual}</td>
                            <td className="py-2 px-4" style={{ color: '#596570' }}>{r.lastWeek > 0 ? r.lastWeek : '\u2014'}</td>`,
  `                            <td className="py-2 px-4 font-medium" style={{ color: '#1d4ed8' }}>{r.booked > 0 ? r.booked : '\u2014'}</td>
                            <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>{r.actual}</td>
                            <td className="py-2 px-4" style={{ color: r.booked > 0 && r.actual < r.booked ? '#d97706' : '#596570' }}>
                              {r.booked > 0 ? r.booked - r.actual : '\u2014'}
                            </td>
                            <td className="py-2 px-4" style={{ color: '#596570' }}>{r.lastWeek > 0 ? r.lastWeek : '\u2014'}</td>`,
  'Add booked + absent cells'
);

// 7. Fix colSpan
replace(
  '<tr><td colSpan={6} className="py-6 text-center text-sm italic" style={{ color: \'#596570\' }}>No attendance data for selected period.</td></tr>',
  '<tr><td colSpan={8} className="py-6 text-center text-sm italic" style={{ color: \'#596570\' }}>No attendance data for selected period.</td></tr>',
  'colSpan'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('\nDone \u2014 ' + changed + ' replacements.');
