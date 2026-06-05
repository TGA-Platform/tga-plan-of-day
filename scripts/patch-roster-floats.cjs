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

// 1. Add sumFloat to RosterSlotData interface
replace(
  '  sumStaff:    number;    // ratio staff (room + floats) on shift',
  '  sumRoomStaff: number;   // room-allocated staff only (direct ratio coverage)\n  sumFloat:     number;   // float pool staff (reserve/buffer)\n  sumStaff:     number;   // kept for compat (= sumRoomStaff)',
  'RosterSlotData interface'
);

// 2. Add sumFloat to rosterAccum type
replace(
  'const rosterAccum: Record<string, Record<string, { sumChildren: number; sumStaff: number; sumOffFloor: number; sumISS: number; sumRequired: number; days: number }>> = {};',
  'const rosterAccum: Record<string, Record<string, { sumChildren: number; sumRoomStaff: number; sumFloat: number; sumStaff: number; sumOffFloor: number; sumISS: number; sumRequired: number; days: number }>> = {};',
  'rosterAccum type'
);

// 3. Add sumFloat to initialisation
replace(
  'rosterAccum[campus][rslot] = { sumChildren: 0, sumStaff: 0, sumOffFloor: 0, sumISS: 0, sumRequired: 0, days: 0 };',
  'rosterAccum[campus][rslot] = { sumChildren: 0, sumRoomStaff: 0, sumFloat: 0, sumStaff: 0, sumOffFloor: 0, sumISS: 0, sumRequired: 0, days: 0 };',
  'rosterAccum init'
);

// 4. Split campusRostersFiltered into room + float, update staffOnShift
replace(
  '          // Floor staff = room + floats only (exclude ISS, non-ratio, leave)\n          const campusRostersFiltered = (rosters as any[]).filter((r: any) =>\n            r.Employee && r.Employee !== 0 &&\n            !nonRatioIdsSet.has(r.OperationalUnit) &&\n            !issIdsSet.has(r.OperationalUnit)\n          );',
  `          // Room staff: directly assigned to rooms (these are the ratio-counting staff)
          const roomUnitIds = new Set(centre.rooms.map(rm => rm.deputyUnitId));
          const floatUnitIds2 = new Set(centre.floatUnitIds ?? []);
          const campusRostersFiltered = (rosters as any[]).filter((r: any) =>
            r.Employee && r.Employee !== 0 &&
            roomUnitIds.has(r.OperationalUnit) // room staff only
          );
          // Float staff: buffer/reserve pool
          const floatRostersFiltered = (rosters as any[]).filter((r: any) =>
            r.Employee && r.Employee !== 0 &&
            floatUnitIds2.has(r.OperationalUnit)
          );`,
  'Split room vs float staff'
);

// 5. Add float count alongside staffOnShift, surplus based on room staff only
replace(
  '            // Floor staff = unique ratio employees (room + floats, no ISS)\n            const staffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;',
  `            // Room staff = unique employees directly in rooms (ratio coverage)
            const roomStaffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            // Float staff = reserve/buffer pool (separate from room surplus)
            const floatOnShift = new Set(floatRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            const staffOnShift = roomStaffOnShift; // surplus = room staff vs required`,
  'Room + float counts'
);

// 6. Accumulate both
replace(
  `            rosterAccum[campus][rslot].sumChildren  += childrenPresent;\n            rosterAccum[campus][rslot].sumStaff     += staffOnShift;\n            rosterAccum[campus][rslot].sumOffFloor  += offFloorOnShift;\n            rosterAccum[campus][rslot].sumISS       += issOnShift;\n            rosterAccum[campus][rslot].sumRequired  += reqStaff;`,
  `            rosterAccum[campus][rslot].sumChildren  += childrenPresent;
            rosterAccum[campus][rslot].sumRoomStaff += roomStaffOnShift;
            rosterAccum[campus][rslot].sumFloat     += floatOnShift;
            rosterAccum[campus][rslot].sumStaff     += roomStaffOnShift;
            rosterAccum[campus][rslot].sumOffFloor  += offFloorOnShift;
            rosterAccum[campus][rslot].sumISS       += issOnShift;
            rosterAccum[campus][rslot].sumRequired  += reqStaff;`,
  'Accumulate room+float'
);

// 7. Add to slots mapping
replace(
  `          totalDays:   slotMap[time].days,\n          sumChildren: slotMap[time].sumChildren,\n          sumStaff:    slotMap[time].sumStaff,\n          sumOffFloor: slotMap[time].sumOffFloor,\n          sumISS:      slotMap[time].sumISS,\n          sumRequired: slotMap[time].sumRequired,`,
  `          totalDays:    slotMap[time].days,
          sumChildren:  slotMap[time].sumChildren,
          sumRoomStaff: slotMap[time].sumRoomStaff,
          sumFloat:     slotMap[time].sumFloat,
          sumStaff:     slotMap[time].sumRoomStaff,
          sumOffFloor:  slotMap[time].sumOffFloor,
          sumISS:       slotMap[time].sumISS,
          sumRequired:  slotMap[time].sumRequired,`,
  'slots mapping'
);

// 8. Update headers — add Float column
replace(
  "['Time','Avg Children','Avg Staff (Floor)','Required','Surplus','Status','Off Floor','ISS']",
  "['Time','Avg Children','Avg Room Staff','Float','Required','Surplus','Status','Off Floor','ISS']",
  'Headers multi-day'
);
replace(
  "['Time','Children','Staff (Floor)','Required','Surplus','Status','Off Floor','ISS']",
  "['Time','Children','Room Staff','Float','Required','Surplus','Status','Off Floor','ISS']",
  'Headers single-day'
);

// 9. Add avgFloat variable and Float cell in row
replace(
  `const avgSt   = s.totalDays > 0 ? fmt1(s.sumStaff     / s.totalDays) : '\u2014';`,
  `const avgSt   = s.totalDays > 0 ? fmt1(s.sumRoomStaff / s.totalDays) : '\u2014';\n                            const avgFloat = s.totalDays > 0 ? fmt1(s.sumFloat    / s.totalDays) : '\u2014';`,
  'avgFloat variable'
);

// 10. Add Float cell after Room Staff cell in the row
replace(
  `<td className="py-1.5 px-3 text-xs font-medium" style={{ color: '#2d5c18' }}>{avgSt}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#596570' }}>{avgReq}</td>`,
  `<td className="py-1.5 px-3 text-xs font-medium" style={{ color: '#2d5c18' }}>{avgSt}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#0d9488' }}>{avgFloat}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#596570' }}>{avgReq}</td>`,
  'Float cell in row'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('\nDone \u2014 ' + changed + ' replacements.');
