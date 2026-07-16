const fs = require('fs');
const p = 'src/pages/ReportingPage.tsx';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/: deputyUnitName \|\| 'Support'\r?\n\s*: deputyUnitName \|\| 'Support'/g, ": deputyUnitName || 'Support");
fs.writeFileSync(p, s, 'utf8');
console.log('fixed duplicate');
