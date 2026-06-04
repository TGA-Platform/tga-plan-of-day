const fs = require('fs');
const file = 'src/pages/SettingsPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// Replace corrupted emoji sequences with plain text equivalents
// Corrupted arrows in "Back" button
c = c.replace(/[^\x20-\x7E\n\r\t]\u2190 Back/g, '\u2190 Back');
c = c.replace(/â†[^\s]* Back/g, '\u2190 Back');

// Fix middle dot in subtitle (Â· -> ·)
c = c.replace(/Â·/g, '\u00B7');

// Fix any other obvious mojibake in UI strings - replace corrupted emoji with text
// The tab icons specifically - remove them since we already fixed tab labels to plain text
// Check for "· Manage" subtitle
c = c.replace(/[^\x00-\x7F]{2,4}·/g, '\u00B7');

fs.writeFileSync(file, c, 'utf8');
console.log('Encoding cleanup done');

// Check for remaining non-ASCII that might be problematic
const suspicious = [];
c.split('\n').forEach((line, i) => {
  if (/[^\x00-\x7E\u2500-\u257F\u2190-\u21FF\u2600-\u26FF\u2700-\u27BF\uFE0F\u00B7\u2014\u2013\u2019\u201C\u201D\u2026\u21BA\u2713\u26A0\u2714\u00B0]/.test(line)) {
    suspicious.push({ line: i + 1, content: line.trim().slice(0, 80) });
  }
});
if (suspicious.length > 0) {
  console.log('Potentially suspicious lines:');
  suspicious.slice(0, 10).forEach(l => console.log(`  L${l.line}: ${l.content}`));
} else {
  console.log('No suspicious encoding found');
}
