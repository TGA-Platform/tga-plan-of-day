const fs = require('fs');
const p = 'src/pages/ReportingPage.tsx';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const idx = lines.findIndex(l => l.includes('const rostersWithExternal'));
if (idx < 1) { console.log('not found'); process.exit(1); }
const commentIdx = idx - 1;
const newLines = [
  "        // Merge external casuals into rosters so they're included in the educator report",
  "        const zCasualAsRosters = (zCasuals as any[]).map((z: any) => {",
  "          // Stable negative employeeId from zJobId so the same casual doesn't duplicate across re-renders",
  "          const empId = -(String(z.zJobId).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 1000000000);",
  "          return {",
  "            Employee: empId,",
  "            OperationalUnit: centre.floatUnitIds?.[0] ?? 0,",
  "            StartTime: z.start,",
  "            EndTime: z.end,",
  "            isExternalCasual: true,",
  "            _DPMetaData: {",
  "              EmployeeInfo: { DisplayName: z.name },",
  "              OperationalUnitInfo: { OperationalUnitName: 'External Casual' },",
  "            },",
  "          };",
  "        });",
  "        const rostersWithExternal = [...(rosters as any[]), ...zCasualAsRosters];"
];
lines.splice(commentIdx, 2, ...newLines);
fs.writeFileSync(p, lines.join('\r\n'), 'utf8');
console.log('patched');
