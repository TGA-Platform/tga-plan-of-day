const fs = require('fs');
const p = 'src/pages/ReportingPage.tsx';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

// 1. Remove zCasualAsRosters mapping and set rostersWithExternal to rosters only
const startIdx = lines.findIndex(l => l.includes('// Merge external casuals into rosters'));
const endIdx = lines.findIndex(l => l.includes('const rostersWithExternal = [...(rosters as any[]), ...zCasualAsRosters];'));
if (startIdx < 0 || endIdx < 0) { console.log('merge block not found'); process.exit(1); }
lines.splice(startIdx, endIdx - startIdx + 1,
  "        // External casuals are appended to the educator record separately below",
  "        const rostersWithExternal = [...(rosters as any[])];"
);

// 2. Revert naturalRoomName patch to original
const natIdx = lines.findIndex(l => l.includes("staffType === 'external' ? 'External Casual'"));
if (natIdx >= 0) {
  lines.splice(natIdx, 3,
    "            staffType === 'float' || staffType === 'external' ? ''",
    "            : staffType === 'iss'   ? ''",
    "            : deputyUnitName || 'Support'"
  );
}

// 3. Add direct append of Z casuals before sorting
const sortIdx = lines.findIndex(l => l.includes('if (entries.length > 0) {'));
if (sortIdx < 0) { console.log('sort block not found'); process.exit(1); }
const insertLines = [
  "",
  "        // Append external casuals directly to the educator record",
  "        for (const z of (zCasuals as any[])) {",
  "          entries.push({",
  "            employeeId: z.Employee,",
  "            name: z._DPMetaData?.EmployeeInfo?.DisplayName ?? z.name ?? `Staff #${z.Employee}`,",
  "            room: 'External Casual',",
  "            inTime: z.StartTime,",
  "            outTime: z.EndTime,",
  "            blockType: 'shift',",
  "            staffType: 'external',",
  "            note: '',",
  "          });",
  "        }",
  ""
];
lines.splice(sortIdx, 0, ...insertLines);

// 4. Exclude External Casual from room filter dropdown
const allRoomsIdx = lines.findIndex(l => l.includes("const allRooms = [...new Set(entries.map(e => e.room).filter(r => r !== 'Lunch Break'))].sort();"));
if (allRoomsIdx < 0) { console.log('allRooms line not found'); process.exit(1); }
lines[allRoomsIdx] = "          const allRooms = [...new Set(entries.map(e => e.room).filter(r => r !== 'Lunch Break' && r !== 'External Casual'))].sort();";

fs.writeFileSync(p, lines.join('\r\n'), 'utf8');
console.log('patched educator report v4');
