const fs = require('fs');
const p = 'src/pages/ReportingPage.tsx';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const idx = lines.findIndex(l => l.includes("staffType === 'float' || staffType === 'external' ? ''"));
if (idx < 0) { console.log('not found'); process.exit(1); }
lines[idx] = "            staffType === 'external' ? 'External Casual'"
lines.splice(idx + 1, 0, "            : staffType === 'float' ? ''");
fs.writeFileSync(p, lines.join('\r\n'), 'utf8');
console.log('patched naturalRoomName for external');
