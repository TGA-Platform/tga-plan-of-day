const fs = require('fs');
const filePath = require('path').join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// Fix corrupted template literal: "label: FG \," => proper template literal
// The backtick + template got mangled. Replace with the correct line.
c = c.replace('      label: FG \\,\r\n', '      label: `FG ${sharedFamilyGroupings.length + 1}`,\r\n');

fs.writeFileSync(filePath, c, 'utf8');

const verify = fs.readFileSync(filePath, 'utf8');
const lines = verify.split('\n');
console.log('Fixed L691:', JSON.stringify(lines[690]));
