const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');

// 1. Wrap WWCC expiry block
const wwccMarker = '    // \u2500\u2500 WWCC Expiry \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    {\n      let wwccExpRows';
if (src.includes(wwccMarker)) {
  src = src.replace(wwccMarker, '    // \u2500\u2500 WWCC Expiry \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    if (needsWwccExpiry) {\n      let wwccExpRows');
  console.log('\u2713 Wrap WWCC expiry');
} else console.error('NOT FOUND: WWCC expiry');

// 2. Fix generate button label - find old text
const btnOld = "? Generating...";
if (src.includes(btnOld)) {
  // Replace the whole ternary on that line
  src = src.replace(
    /{loading \? '.*? Generating\.\.\.' : '.*? Generate Report'}/,
    `{loading ? '\u23f3 Generating...' : ('\ud83d\udcca Generate ' + ({educator:'Educator Record',ratio:'Ratio Report',trends:'Trends',occupancy:'Attendance Trends','roster-opt':'Roster Optimisation','wwcc-expiry':'WWCC Expiries'}[activeReport] || 'Report'))}`
  );
  console.log('\u2713 Button label');
} else console.error('NOT FOUND: button label');

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('Done');
