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

// 1. Add roomSurplus to StaffingAnalysisRow interface
replace(
  `  bufferRequired:      number;       // floor / 6`,
  `  roomSurplus:         number;       // net room surplus after internal reallocation (negative = rooms short)\n  bufferRequired:      number;       // floor / 6`,
  'Interface'
);

// 2. Restore room shortage calc in the data building, update formula
replace(
  `          const saTotalFloorStaff = saRoomData.reduce((s, r) => s + r.staffCount, 0);\n          // Float buffer = floor staff / 6 (how many floats you need)\n          const saBufferRequired  = saTotalFloorStaff > 0 ? saTotalFloorStaff / 6 : 0;`,
  `          const saTotalFloorStaff    = saRoomData.reduce((s, r) => s + r.staffCount, 0);
          // Room shortages/surpluses — after internal reallocation between rooms
          const saTotalRatioShortage = saRoomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
          const saTotalRoomSurplus   = saRoomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
          const saNetShortage        = Math.max(0, saTotalRatioShortage - saTotalRoomSurplus);
          // Room net: positive = rooms have surplus staff, negative = rooms are short
          const saRoomSurplus        = saTotalRoomSurplus - saTotalRatioShortage;
          // Float buffer = floor staff / 6 (how many floats you need as buffer)
          const saBufferRequired     = saTotalFloorStaff > 0 ? saTotalFloorStaff / 6 : 0;`,
  'Restore room shortage calc'
);

// 3. Update float surplus to include net room shortage
replace(
  `          // Available = floats + AD (if <100 children); surplus = available - buffer\n          const saAvailable    = saFloatCount + saAdAvailable;\n          const saFloatSurplus = saAvailable - saBufferRequired;\n          const saTotalFloatersNeeded = saBufferRequired; // kept for display`,
  `          // Floats needed = room shortage (after realloc) + buffer
          // Floats cover room shortages first, then surplus = what's left vs buffer
          const saTotalFloatersNeeded = saNetShortage + saBufferRequired;
          const saFloatSurplus        = (saFloatCount + saAdAvailable) - saTotalFloatersNeeded;`,
  'Update float surplus formula'
);

// 4. Add roomSurplus to the push
replace(
  `            date, campus,\n            children:            saChildren,\n            required:            saRequired,\n            totalFloorStaff:     saTotalFloorStaff,\n            bufferRequired:      saBufferRequired,`,
  `            date, campus,\n            children:            saChildren,\n            required:            saRequired,\n            totalFloorStaff:     saTotalFloorStaff,\n            roomSurplus:         saRoomSurplus,\n            bufferRequired:      saBufferRequired,`,
  'Add roomSurplus to push'
);

// 5. Add Room column to table headers
replace(
  `{['Date','Children','Floor Staff','Required','Float Buffer','Floats','AD','Available','Surplus','Status'].map(h => (`,
  `{['Date','Children','Floor Staff','Required','Room \u00b1','Float Buffer','Floats','AD','Available','Surplus','Status'].map(h => (`,
  'Table headers'
);

// 6. Add Room Surplus cell in the row (after Required, before Buffer)
replace(
  `<td className="py-2 px-3 text-xs" style={{ color: '#7c3aed' }}>{r.bufferRequired.toFixed(1)}</td>`,
  `<td className="py-2 px-3 text-xs font-medium"
                                      style={{ color: r.roomSurplus < 0 ? '#dc2626' : r.roomSurplus > 0 ? '#166534' : '#596570' }}>
                                      {r.roomSurplus > 0 ? '+' + r.roomSurplus : r.roomSurplus}
                                    </td>
                                    <td className="py-2 px-3 text-xs" style={{ color: '#7c3aed' }}>{r.bufferRequired.toFixed(1)}</td>`,
  'Room surplus cell'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('\nDone \u2014 ' + changed + ' replacements.');
