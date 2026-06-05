const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');
let changed = 0;

function replace(old, neu, label) {
  if (!src.includes(old)) { console.error('NOT FOUND: ' + label); return; }
  src = src.replace(old, neu);
  changed++;
  console.log('\u2713 ' + label);
}

// 1. Add sumISS to RosterSlotData interface
replace(
  '  sumOffFloor: number;    // non-ratio staff (directors, chefs, admin) on shift\n  sumRequired: number;',
  '  sumOffFloor: number;    // non-ratio staff (directors, chefs, admin) on shift\n  sumISS:      number;    // ISS staff on shift (shown separately, not in ratio count)\n  sumRequired: number;',
  'RosterSlotData interface'
);

// 2. Add sumISS to rosterAccum type
replace(
  'const rosterAccum: Record<string, Record<string, { sumChildren: number; sumStaff: number; sumOffFloor: number; sumRequired: number; days: number }>> = {};',
  'const rosterAccum: Record<string, Record<string, { sumChildren: number; sumStaff: number; sumOffFloor: number; sumISS: number; sumRequired: number; days: number }>> = {};',
  'rosterAccum type'
);

// 3. Add sumISS to initialisation
replace(
  'rosterAccum[campus][rslot] = { sumChildren: 0, sumStaff: 0, sumOffFloor: 0, sumRequired: 0, days: 0 };',
  'rosterAccum[campus][rslot] = { sumChildren: 0, sumStaff: 0, sumOffFloor: 0, sumISS: 0, sumRequired: 0, days: 0 };',
  'rosterAccum init'
);

// 4. Fix floor staff: exclude ISS, count unique employees
replace(
  `          // Use rosters already fetched via /api/deputy-rosters \u2014 raw Deputy API format:
          // r.OperationalUnit (number), r.StartTime / r.EndTime (unix timestamps in seconds)
          const nonRatioIdsSet = new Set([...(centre.nonRatioUnitIds ?? []), ...(centre.leaveUnitIds ?? [])]);
          const campusRostersFiltered = (rosters as any[]).filter((r: any) =>
            r.Employee && r.Employee !== 0 &&          // skip open/unassigned shifts
            !nonRatioIdsSet.has(r.OperationalUnit)     // skip directors, chefs, admin, leave
          );`,
  `          // Use rosters already fetched via /api/deputy-rosters \u2014 raw Deputy API format:
          // r.OperationalUnit (number), r.StartTime / r.EndTime (unix timestamps in seconds)
          const nonRatioIdsSet = new Set([...(centre.nonRatioUnitIds ?? []), ...(centre.leaveUnitIds ?? [])]);
          const issIdsSet       = new Set(centre.issUnitIds ?? []);
          // Floor staff = ratio staff only (room + floats). Exclude ISS, non-ratio, leave.
          const campusRostersFiltered = (rosters as any[]).filter((r: any) =>
            r.Employee && r.Employee !== 0 &&
            !nonRatioIdsSet.has(r.OperationalUnit) &&
            !issIdsSet.has(r.OperationalUnit)
          );`,
  'Floor staff excludes ISS'
);

// 5. Fix staffOnShift to count unique employee IDs (no double-counting from split shifts)
replace(
  `            // Raw Deputy fields: r.StartTime and r.EndTime are unix timestamps in seconds
            const staffOnShift = campusRostersFiltered.filter((r: any) => {
              const toM = (ts: number | null | undefined) => {
                if (!ts || ts <= 0) return null;
                const d = new Date(new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
                return d.getHours() * 60 + d.getMinutes();
              };
              const startM = toM(r.StartTime), endM = toM(r.EndTime);
              if (startM === null || endM === null) return false;
              return startM <= slotMinutes && endM > slotMinutes;
            }).length;`,
  `            // Raw Deputy fields: r.StartTime and r.EndTime are unix timestamps in seconds
            // Count unique Employee IDs (not entries) to avoid double-counting split shifts
            const shiftCheck = (r: any) => {
              if (!r.StartTime || r.StartTime <= 0) return false;
              const d1 = new Date(new Date(r.StartTime * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
              const d2 = new Date(new Date(r.EndTime   * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
              const startM = d1.getHours() * 60 + d1.getMinutes();
              const endM   = d2.getHours() * 60 + d2.getMinutes();
              return startM <= slotMinutes && endM > slotMinutes;
            };
            const staffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;`,
  'staffOnShift unique employees'
);

// 6. Fix offFloorOnShift to also count unique employees, and add ISS count
replace(
  `            // Non-ratio staff (directors, chefs, admin) on shift \u2014 shown separately for visibility
            const leaveIdsSet = new Set(centre.leaveUnitIds ?? []);
            const offFloorOnShift = (rosters as any[])
              .filter((r: any) =>
                r.Employee && r.Employee !== 0 &&
                nonRatioIdsSet.has(r.OperationalUnit) &&
                !leaveIdsSet.has(r.OperationalUnit) &&
                isOnShift(r)
              ).length;`,
  `            // Non-ratio staff (directors, chefs, admin) \u2014 unique employees, exclude leave
            const leaveIdsSet = new Set(centre.leaveUnitIds ?? []);
            const offFloorOnShift = new Set(
              (rosters as any[]).filter((r: any) =>
                r.Employee && r.Employee !== 0 &&
                nonRatioIdsSet.has(r.OperationalUnit) &&
                !leaveIdsSet.has(r.OperationalUnit) &&
                shiftCheck(r)
              ).map((r: any) => r.Employee)
            ).size;
            // ISS staff \u2014 unique employees
            const issOnShift = new Set(
              (rosters as any[]).filter((r: any) =>
                r.Employee && r.Employee !== 0 &&
                issIdsSet.has(r.OperationalUnit) &&
                shiftCheck(r)
              ).map((r: any) => r.Employee)
            ).size;`,
  'offFloor and ISS unique employees'
);

// 7. Remove the now-unused isOnShift helper (was defined before, replaced by shiftCheck)
replace(
  `            const isOnShift = (r: any) => {\n              const startM = shiftToM(r.StartTime), endM = shiftToM(r.EndTime);\n              if (startM === null || endM === null) return false;\n              return startM <= slotMinutes && endM > slotMinutes;\n            };\n            // Ratio staff (room + floats) on shift at this slot\n            const staffOnShift = campusRostersFiltered.filter(isOnShift).length;`,
  `            const staffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;`,
  'Remove duplicate staffOnShift (now handled above)'
);

// 8. Add sumISS to accumulator
replace(
  `            rosterAccum[campus][rslot].sumChildren  += childrenPresent;\n            rosterAccum[campus][rslot].sumStaff     += staffOnShift;\n            rosterAccum[campus][rslot].sumOffFloor  += offFloorOnShift;\n            rosterAccum[campus][rslot].sumRequired  += reqStaff;`,
  `            rosterAccum[campus][rslot].sumChildren  += childrenPresent;\n            rosterAccum[campus][rslot].sumStaff     += staffOnShift;\n            rosterAccum[campus][rslot].sumOffFloor  += offFloorOnShift;\n            rosterAccum[campus][rslot].sumISS       += issOnShift;\n            rosterAccum[campus][rslot].sumRequired  += reqStaff;`,
  'Accumulate sumISS'
);

// 9. Add sumISS to slots mapping
replace(
  `          totalDays:   slotMap[time].days,\n          sumChildren: slotMap[time].sumChildren,\n          sumStaff:    slotMap[time].sumStaff,\n          sumOffFloor: slotMap[time].sumOffFloor,\n          sumRequired: slotMap[time].sumRequired,`,
  `          totalDays:   slotMap[time].days,\n          sumChildren: slotMap[time].sumChildren,\n          sumStaff:    slotMap[time].sumStaff,\n          sumOffFloor: slotMap[time].sumOffFloor,\n          sumISS:      slotMap[time].sumISS,\n          sumRequired: slotMap[time].sumRequired,`,
  'sumISS in slots mapping'
);

// 10. Update table headers to add ISS column
replace(
  "['Time','Avg Children','Avg Staff (Floor)','Required','Surplus','Status','Avg Off Floor']",
  "['Time','Avg Children','Avg Staff (Floor)','Required','Surplus','Status','Off Floor','ISS']",
  'Table headers multi-day'
);
replace(
  "['Time','Children','Staff (Floor)','Required','Surplus','Status','Off Floor']",
  "['Time','Children','Staff (Floor)','Required','Surplus','Status','Off Floor','ISS']",
  'Table headers single-day'
);

// 11. Add avgISS variable and ISS cell in row rendering
replace(
  `const avgOff  = s.totalDays > 0 ? fmt1(s.sumOffFloor  / s.totalDays) : '\u2014';`,
  `const avgOff  = s.totalDays > 0 ? fmt1(s.sumOffFloor / s.totalDays) : '\u2014';\n                            const avgISS  = s.totalDays > 0 ? fmt1(s.sumISS      / s.totalDays) : '\u2014';`,
  'avgISS variable'
);
replace(
  `<td className="py-1.5 px-3 text-xs" style={{ color: '#7c3aed' }}>{avgOff}</td>\n                              </tr>`,
  `<td className="py-1.5 px-3 text-xs" style={{ color: '#7c3aed' }}>{avgOff}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#0891b2' }}>{avgISS}</td>\n                              </tr>`,
  'ISS cell in row'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('\nDone \u2014 ' + changed + ' replacements.');
