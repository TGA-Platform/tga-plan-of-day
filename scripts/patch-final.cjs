const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');

// 1. Wrap WWCC expiry — find the line by regex
const wwccRE = /([ \t]+\/\/ [─\-]+ WWCC Expiry [─\-]+\n)([ \t]+)\{(\n[ \t]+let wwccExpRows)/;
if (wwccRE.test(src)) {
  src = src.replace(wwccRE, '$1$2if (needsWwccExpiry) {$3');
  console.log('✓ Wrap WWCC expiry');
} else {
  // Try simpler approach: find "    {\n      let wwccExpRows" after WWCC Expiry comment
  const idx = src.indexOf('WWCC Expiry');
  if (idx >= 0) {
    const blockStart = src.indexOf('\n    {\n      let wwccExpRows', idx);
    if (blockStart >= 0) {
      src = src.slice(0, blockStart) + '\n    if (needsWwccExpiry) {\n      let wwccExpRows' + src.slice(blockStart + '\n    {\n      let wwccExpRows'.length);
      console.log('✓ Wrap WWCC expiry (fallback)');
    } else console.error('NOT FOUND: WWCC expiry block start');
  } else console.error('NOT FOUND: WWCC Expiry comment');
}

// 2. Fix generate button label
const btnRE = /\{loading \? '[^']*Generating\.\.\.' : '[^']*Generate Report'\}/;
if (btnRE.test(src)) {
  src = src.replace(btnRE,
    `{loading ? '\u27f3 Generating...' : ('\ud83d\udcca Generate ' + ({educator:'Educator Record',ratio:'Ratio Report',trends:'Trends',occupancy:'Attendance Trends','roster-opt':'Roster Optimisation','wwcc-expiry':'WWCC Expiries'}[activeReport] || 'Report'))}`
  );
  console.log('✓ Button label');
} else console.error('NOT FOUND: button label');

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('Done');
