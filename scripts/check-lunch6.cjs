const fs = require('fs');
const rd = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), 'utf8');

// Find ALL activeView === occurrences in order
let pos = 0;
const views = [];
while ((pos = rd.indexOf("activeView ===", pos + 1)) >= 0) {
  views.push({ pos, text: rd.substring(pos, pos + 50).replace(/\n/g, '|') });
}
console.log('All activeView checks:');
views.forEach(v => console.log(' ', v.pos, ':', v.text));

const lunchIdx = rd.indexOf('Lunch Break Plan (room staff breaks)');
console.log('\nLunchBreakPanel at:', lunchIdx);
console.log('Last activeView before lunch:', views.filter(v => v.pos < lunchIdx).pop());
