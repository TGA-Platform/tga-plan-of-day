const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Pattern 1: small inline IC badge in grid cells (inside the cell div)
// After every: {s.isInternalCasual && <span style={{ ... }}>IC</span>}
// Add:         {s.isExternalCasual && <span style={{ ... }}>EC</span>}

// There are slight style variations. Handle the common case: fontSize '8px', fef3c7/92400e
const IC_BADGE_PATTERN = /(\{s\.isInternalCasual && <span style=\{\{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' \}\}>IC<\/span>\})/g;

const EC_BADGE = `{s.isExternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fed7aa', color: '#c2410c', flexShrink: 0, lineHeight: '13px' }}>EC</span>}`;

let count = 0;
content = content.replace(IC_BADGE_PATTERN, (match) => {
  count++;
  return match + '\n                                        ' + EC_BADGE;
});

console.log(`Replaced ${count} IC badge occurrences with IC + EC pair`);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done');
