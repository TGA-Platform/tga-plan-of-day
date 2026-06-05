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

// 1. Merge sumRoomStaff + sumFloat back into sumStaff in RosterSlotData
replace(
  `  sumRoomStaff: number;   // room-allocated staff only (direct ratio coverage)\n  sumFloat:     number;   // float pool staff (reserve/buffer)\n  sumStaff:     number;   // kept for compat (= sumRoomStaff)`,
  `  sumStaff:    number;    // floor staff = room + floats (used for surplus)`,
  'RosterSlotData interface'
);

// 2. Simplify rosterAccum type
replace(
  `const rosterAccum: Record<string, Record<string, { sumChildren: number; sumRoomStaff: number; sumFloat: number; sumStaff: number; sumOffFloor: number; sumISS: number; sumRequired: number; days: number }>> = {};`,
  `const rosterAccum: Record<string, Record<string, { sumChildren: number; sumStaff: number; sumOffFloor: number; sumISS: number; sumRequired: number; days: number }>> = {};`,
  'rosterAccum type'
);

// 3. Simplify init
replace(
  `rosterAccum[campus][rslot] = { sumChildren: 0, sumRoomStaff: 0, sumFloat: 0, sumStaff: 0, sumOffFloor: 0, sumISS: 0, sumRequired: 0, days: 0 };`,
  `rosterAccum[campus][rslot] = { sumChildren: 0, sumStaff: 0, sumOffFloor: 0, sumISS: 0, sumRequired: 0, days: 0 };`,
  'rosterAccum init'
);

// 4. Keep both room and float filtered, but combine for staffOnShift
replace(
  `            // Room staff = unique employees directly in rooms (ratio coverage)
            const roomStaffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            // Float staff = reserve/buffer pool (separate from room surplus)
            const floatOnShift = new Set(floatRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            // surplus = room staff vs required (floats are reserve, not counted in surplus)`,
  `            // Floor staff = room + float combined (both count toward ratio coverage)
            const roomStaffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            const floatOnShift     = new Set(floatRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            const staffOnShift     = roomStaffOnShift + floatOnShift;`,
  'Combined staffOnShift'
);

// 5. Fix accumulator — combine room+float into sumStaff, remove separate sumRoomStaff/sumFloat
replace(
  `            rosterAccum[campus][rslot].sumChildren  += childrenPresent;
            rosterAccum[campus][rslot].sumRoomStaff += roomStaffOnShift;
            rosterAccum[campus][rslot].sumFloat     += floatOnShift;
            rosterAccum[campus][rslot].sumStaff     += roomStaffOnShift;`,
  `            rosterAccum[campus][rslot].sumChildren  += childrenPresent;
            rosterAccum[campus][rslot].sumStaff     += staffOnShift;`,
  'Accumulate combined staff'
);

// 6. Simplify slots mapping — remove sumRoomStaff/sumFloat
replace(
  `          totalDays:    slotMap[time].days,
          sumChildren:  slotMap[time].sumChildren,
          sumRoomStaff: slotMap[time].sumRoomStaff,
          sumFloat:     slotMap[time].sumFloat,
          sumStaff:     slotMap[time].sumRoomStaff,
          sumOffFloor:  slotMap[time].sumOffFloor,
          sumISS:       slotMap[time].sumISS,
          sumRequired:  slotMap[time].sumRequired,`,
  `          totalDays:   slotMap[time].days,
          sumChildren: slotMap[time].sumChildren,
          sumStaff:    slotMap[time].sumStaff,
          sumOffFloor: slotMap[time].sumOffFloor,
          sumISS:      slotMap[time].sumISS,
          sumRequired: slotMap[time].sumRequired,`,
  'slots mapping'
);

// 7. Update table headers — remove Float column
replace(
  `['Time','Avg Children','Avg Room Staff','Float','Required','Surplus','Status','Off Floor','ISS']`,
  `['Time','Avg Children','Avg Staff (Floor)','Required','Surplus','Status','Off Floor','ISS']`,
  'Headers multi-day'
);
replace(
  `['Time','Children','Room Staff','Float','Required','Surplus','Status','Off Floor','ISS']`,
  `['Time','Children','Staff (Floor)','Required','Surplus','Status','Off Floor','ISS']`,
  'Headers single-day'
);

// 8. Remove avgFloat variable and Float cell
replace(
  `const avgSt   = s.totalDays > 0 ? fmt1(s.sumRoomStaff / s.totalDays) : '\u2014';\n                            const avgFloat = s.totalDays > 0 ? fmt1(s.sumFloat    / s.totalDays) : '\u2014';`,
  `const avgSt   = s.totalDays > 0 ? fmt1(s.sumStaff     / s.totalDays) : '\u2014';`,
  'Remove avgFloat'
);
replace(
  `<td className="py-1.5 px-3 text-xs font-medium" style={{ color: '#2d5c18' }}>{avgSt}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#0d9488' }}>{avgFloat}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#596570' }}>{avgReq}</td>`,
  `<td className="py-1.5 px-3 text-xs font-medium" style={{ color: '#2d5c18' }}>{avgSt}</td>\n                                <td className="py-1.5 px-3 text-xs" style={{ color: '#596570' }}>{avgReq}</td>`,
  'Remove Float cell'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('\nDone \u2014 ' + changed + ' replacements.');
