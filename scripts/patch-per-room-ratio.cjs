const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');

// Find the line with calcRequiredStaff and replace
const OLD = `            // Real NSW ratios via cascade algorithm (0-2y \u2192 1:4, 2-3y \u2192 1:5, 3-6y \u2192 1:10)
            const { required: reqStaff } = calcRequiredStaff(childrenAtSlot as any);`;

const NEW = `            // Required staff calculated PER ROOM independently — each room must meet its
            // own ratio. Cannot use carryover between rooms (that would undercount).
            const childrenByRoom: Record<string, typeof childrenAtSlot> = {};
            for (const child of childrenAtSlot) {
              const rk = (child as any).room || 'unassigned';
              (childrenByRoom[rk] = childrenByRoom[rk] || []).push(child);
            }
            let reqStaff = 0;
            for (const roomKids of Object.values(childrenByRoom)) {
              // Cascade within the room handles mixed-age rooms correctly
              const { required } = calcRequiredStaff(roomKids as any);
              reqStaff += required;
            }`;

if (!src.includes(OLD)) { console.error('NOT FOUND'); process.exit(1); }
src = src.replace(OLD, NEW);
console.log('✓ Per-room ratio calculation');

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('Done');
