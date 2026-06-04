const fs = require('fs');
const file = 'src/pages/RatioDashboardPage.tsx';
let c = fs.readFileSync(file, 'utf8');
const issSection = fs.readFileSync('scripts/iss-section.tsx', 'utf8');

// 1. Change 2-col grid to 3-col
c = c.replace(
  'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6',
  'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6'
);

// 2. Inject ISS section between FloatPoolSection closing and Support staff comment
// Find the exact spot: after the FloatPoolSection closing, before {/* Support staff */}
const marker = '{/* Support staff */}';
const insertBefore = c.indexOf(marker);
if (insertBefore === -1) {
  console.log('ERROR: Could not find Support staff comment');
  process.exit(1);
}

c = c.slice(0, insertBefore) + issSection + '\n        ' + c.slice(insertBefore);

fs.writeFileSync(file, c, 'utf8');
console.log('ISS section injected at position', insertBefore);
console.log('Has ISS section:', c.includes('Support Staff (ISS)'));
console.log('Has effectiveIssStaff render:', c.includes('effectiveIssStaff.map'));
