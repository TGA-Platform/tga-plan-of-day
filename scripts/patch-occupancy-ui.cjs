/**
 * Patch the Occupancy Trends UI to use real-data framing only.
 * Replaces "Expected/Absent/Predicted" language with "Last Week/Change" language.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');
let changed = 0;

function replace(oldStr, newStr, label) {
  if (!src.includes(oldStr)) { console.error(`NOT FOUND: ${label}`); return; }
  src = src.replace(oldStr, newStr);
  changed++;
  console.log(`✓ ${label}`);
}

// 1. Fix the OccupancyRow interface — rename fields
replace(
  `  absent:         number;\n  attendanceRate: number;`,
  `  lastWeek:       number;\n  change:         number;   // actual - lastWeek (positive = more children than last week)`,
  'OccupancyRow interface'
);

// 2. Fix data calculation — rename fields
replace(
  `          occRows.push({\n            date, campus,\n            expected, actual,\n            absent: Math.max(0, expected - actual),\n            attendanceRate: expected > 0 ? Math.round(actual / expected * 100) : 100,\n          });`,
  `          occRows.push({\n            date, campus,\n            expected: actual,      // "this week" actual\n            actual,                 // same field kept for compat\n            lastWeek: expected,     // prior week actual (real data)\n            change: actual - expected,\n          });`,
  'OccupancyRow data push'
);

// 3. Fix the description banner
replace(
  `<strong>Occupancy Trends</strong> — Expected vs. actual attendance per day. Amber = below 80%, Red = below 60%.`,
  `<strong>Attendance Trends</strong> — Real daily attendance vs the same day last week. Green = up, Red = down significantly.`,
  'Description banner'
);

// 4. Fix summary stats
replace(
  `                  const validRows = occupancyRows.filter(r => r.expected > 0);\n                  const avgRate = validRows.length ? Math.round(validRows.reduce((s, r) => s + r.attendanceRate, 0) / validRows.length) : 0;\n                  const totalAbsent = occupancyRows.reduce((s, r) => s + r.absent, 0);\n                  return (\n                    <div className="flex gap-3 flex-wrap">\n                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>\n                        <div className="text-2xl font-bold">{avgRate}%</div>\n                        <div className="text-xs">Avg Attendance Rate</div>\n                      </div>\n                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>\n                        <div className="text-2xl font-bold">{totalAbsent}</div>\n                        <div className="text-xs">Total Absent Slots</div>\n                      </div>\n                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>\n                        <div className="text-2xl font-bold">{occupancyRows.filter(r => r.expected > 0 && r.attendanceRate < 80).length}</div>\n                        <div className="text-xs">Days below 80%</div>\n                      </div>\n                    </div>`,
  `                  const totalThis = occupancyRows.reduce((s, r) => s + r.actual, 0);\n                  const totalLast  = occupancyRows.reduce((s, r) => s + r.lastWeek, 0);\n                  const netChange  = totalThis - totalLast;\n                  const daysUp   = occupancyRows.filter(r => r.change > 0).length;\n                  const daysDown = occupancyRows.filter(r => r.change < 0).length;\n                  return (\n                    <div className="flex gap-3 flex-wrap">\n                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>\n                        <div className="text-2xl font-bold">{totalThis}</div>\n                        <div className="text-xs">Total Children This Period</div>\n                      </div>\n                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: netChange >= 0 ? '#E2F1DA' : '#fef2f2', color: netChange >= 0 ? '#2d5c18' : '#991b1b' }}>\n                        <div className="text-2xl font-bold">{netChange >= 0 ? '+' : ''}{netChange}</div>\n                        <div className="text-xs">vs Same Period Last Week</div>\n                      </div>\n                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#f0fdf4', color: '#166534' }}>\n                        <div className="text-2xl font-bold">{daysUp} ↑ / {daysDown} ↓</div>\n                        <div className="text-xs">Days up / down vs last week</div>\n                      </div>\n                    </div>`,
  'Summary stats'
);

// 5. Fix table headers
replace(
  `['Date','Campus','Expected','Actual','Absent','Attendance Rate'].map(h => (`,
  `['Date','Campus','Attended','Last Week (Same Day)','Change','Trend'].map(h => (`,
  'Table headers'
);

// 6. Fix table row data — remove expected/absent columns, use lastWeek/change
replace(
  `                            <td className="py-2 px-4" style={{ color: '#596570' }}>{r.expected}</td>\n                            <td className="py-2 px-4" style={{ color: '#596570' }}>{r.actual}</td>\n                            <td className="py-2 px-4" style={{ color: r.absent > 0 ? '#d97706' : '#596570' }}>{r.absent}</td>\n                            <td className="py-2 px-4">\n                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold"\n                                style={r.expected === 0\n                                  ? { backgroundColor: '#f3f4f6', color: '#6b7280' }\n                                  : r.attendanceRate < 60\n                                  ? { backgroundColor: '#fee2e2', color: '#991b1b' }\n                                  : r.attendanceRate < 80\n                                  ? { backgroundColor: '#fef9c3', color: '#854d0e' }\n                                  : { backgroundColor: '#dcfce7', color: '#166534' }}>\n                                {r.expected === 0 ? '—' : \`\${r.attendanceRate}%\`}\n                              </span>\n                            </td>`,
  `                            <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>{r.actual}</td>\n                            <td className="py-2 px-4" style={{ color: '#596570' }}>{r.lastWeek > 0 ? r.lastWeek : '—'}</td>\n                            <td className="py-2 px-4 font-medium" style={{ color: r.change > 0 ? '#166534' : r.change < 0 ? '#991b1b' : '#596570' }}>\n                              {r.change > 0 ? \`+\${r.change}\` : r.change < 0 ? String(r.change) : '—'}\n                            </td>\n                            <td className="py-2 px-4">\n                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold"\n                                style={r.lastWeek === 0\n                                  ? { backgroundColor: '#f3f4f6', color: '#6b7280' }\n                                  : r.change < -5\n                                  ? { backgroundColor: '#fee2e2', color: '#991b1b' }\n                                  : r.change > 5\n                                  ? { backgroundColor: '#dcfce7', color: '#166534' }\n                                  : { backgroundColor: '#f3f4f6', color: '#374151' }}>\n                                {r.lastWeek === 0 ? 'No prior data' : r.change > 5 ? '↑ Up' : r.change < -5 ? '↓ Down' : '→ Stable'}\n                              </span>\n                            </td>`,
  'Table row data'
);

// 7. Fix row background logic
replace(
  `                        const rowBg = r.expected > 0 && r.attendanceRate < 60\n                          ? '#fef2f2'\n                          : r.expected > 0 && r.attendanceRate < 80\n                          ? '#fffbeb'\n                          : i % 2 === 0 ? 'white' : '#fafffe';`,
  `                        const rowBg = r.lastWeek > 0 && r.change < -5\n                          ? '#fef2f2'\n                          : r.lastWeek > 0 && r.change > 5\n                          ? '#f0fdf4'\n                          : i % 2 === 0 ? 'white' : '#fafffe';`,
  'Row background'
);

// 8. Fix "No data" colSpan
replace(
  `<tr><td colSpan={6} className="py-6 text-center text-sm italic" style={{ color: '#596570' }}>No occupancy data for selected period.</td></tr>`,
  `<tr><td colSpan={6} className="py-6 text-center text-sm italic" style={{ color: '#596570' }}>No attendance data for selected period.</td></tr>`,
  'No data message'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log(`\nDone — ${changed} replacements.`);
