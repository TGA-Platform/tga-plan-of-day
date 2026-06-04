const fs = require('fs');
const file = 'src/components/LunchBreakPanel.tsx';
let c = fs.readFileSync(file, 'utf8');

// Find the broken fragment ") {" that starts the remnant function
const fragIdx = c.indexOf('\n) {\n  if (entry.coveredBy)');
if (fragIdx > -1) {
  // Find the end of this broken function by counting braces from "{"
  let depth = 0;
  let i = fragIdx + 1; // start at the ")"
  let end = -1;
  while (i < c.length) {
    if (c[i] === '{') depth++;
    if (c[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    i++;
  }
  if (end > -1) {
    c = c.slice(0, fragIdx) + '\n' + c.slice(end).trimStart();
    console.log('Removed broken CoverageBadge fragment, end at', end);
  }
} else {
  console.log('Fragment not found');
}

fs.writeFileSync(file, c, 'utf8');

// Quick verify
const lines = c.split('\n');
console.log('Lines around 62-68:');
lines.slice(61, 70).forEach((l, i) => console.log(i+62, ':', l));
