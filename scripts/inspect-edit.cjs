const fs = require('fs');
const c = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8');
const lines = c.split('\n');
const editLine = lines.find(l => l.includes('Edit') && l.includes('\u00E2'));
if (editLine) {
  console.log('Line:', editLine.trim());
  const chars = [...editLine.trim()].map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} (${ch})`);
  console.log('Codepoints:', chars.slice(0, 20).join(', '));
}
// Also dump the raw bytes around "Edit"
const editIdx = c.indexOf('Edit');
if (editIdx > 5) {
  const before = c.slice(editIdx - 10, editIdx + 6);
  const bytes = Buffer.from(before, 'utf8');
  console.log('Raw bytes before "Edit":', [...bytes].map(b => b.toString(16).padStart(2,'0')).join(' '));
  console.log('String before Edit:', JSON.stringify(before));
}
