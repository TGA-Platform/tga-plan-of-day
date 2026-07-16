const fs = require('fs');
const p = 'src/pages/ReportingPage.tsx';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

// 1. Revert rostersWithExternal merge to original (no zCasualAsRosters mapping)
const mergeIdx = lines.findIndex(l => l.includes('const rostersWithExternal = [...(rosters as any[]), ...zCasualAsRosters];'));
if (mergeIdx < 0) { console.log('merge line not found'); process.exit(1); }
const commentIdx = mergeIdx - 15; // zCasualAsRosters block starts ~15 lines above
// Find the comment line
let startIdx = mergeIdx;
while (startIdx >= 0 && !lines[startIdx].includes('// Merge external casuals into rosters')) startIdx--;
if (startIdx < 0) { console.log('comment not found'); process.exit(1); }
lines.splice(startIdx, mergeIdx - startIdx + 1,
  "        // Merge external casuals into rosters so they're included in the educator report",
  "        const rostersWithExternal = [...(rosters as any[]), ...(zCasuals as any[])];"
);

// 2. Revert naturalRoomName patch
const natIdx = lines.findIndex(l => l.includes("staffType === 'external' ? 'External Casual'"));
if (natIdx >= 0) {
  lines.splice(natIdx, 3,
    "            staffType === 'float' || staffType === 'external' ? ''",
    "            : staffType === 'iss'   ? ''",
    "            : deputyUnitName || 'Support'"
  );
}

// 3. Add direct append of Z casuals after lunch entries, before sorting
const sortIdx = lines.findIndex(l => l.includes('if (entries.length > 0) {'));
if (sortIdx < 0) { console.log('sort block not found'); process.exit(1); }
const insertLines = [
  "",
  "        // Append external casuals directly to the educator record",
  "        for (const z of (zCasuals as any[])) {",
  "          const empId = -(String(z.zJobId).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 1000000000);",
  "          entries.push({",
  "            employeeId: empId,",
  "            name: z.name,",
  "            room: 'External Casual',",
  "            inTime: z.start,",
  "            outTime: z.end,",
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
console.log('patched educator report v3');
