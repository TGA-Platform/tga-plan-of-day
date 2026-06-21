const fs = require('fs');
const rd = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), 'utf8');

// Find the ratio-check view block
const ratioStart = rd.indexOf("activeView === 'ratio-check' && (");
// Find what's inside the ratio-check block
const ratioBlockContent = rd.substring(ratioStart, ratioStart + 5000);
console.log('Ratio-check block first 2000 chars:');
console.log(ratioBlockContent.substring(0, 2000));
