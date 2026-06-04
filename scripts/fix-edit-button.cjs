const fs = require('fs');
const file = 'src/pages/SettingsPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// Exact mojibake pattern for ✏️ (U+270F U+FE0F) — UTF-8: E2 9C 8F EF B8 8F
// Windows-1252 decode: E2→â(E2), 9C→œ(0153), 8F→\x8F(008F), EF→ï(EF), B8→¸(B8), 8F→\x8F(008F)
const pencilEmoji = '\u00E2\u0153\u008F\u00EF\u00B8\u008F';
const pencilPlain = '\u00E2\u0153\u008F';  // ✏ without variation selector

// Also handle warning icon with variation selector
// ⚠️ UTF-8: E2 9A A0 EF B8 8F
// W1252: E2→â(E2), 9A→š(0161), A0→\xA0(00A0), EF→ï(EF), B8→¸(B8), 8F→\x8F(008F)
const warnEmoji = '\u00E2\u0161\u00A0\u00EF\u00B8\u008F';
const warnPlain = '\u00E2\u0161\u00A0';

const fixes = [
  [pencilEmoji, '\u270F\uFE0F'],  // ✏️
  [pencilPlain, '\u270F'],         // ✏
  [warnEmoji,   '\u26A0\uFE0F'],  // ⚠️
  [warnPlain,   '\u26A0'],         // ⚠
];

let count = 0;
for (const [bad, good] of fixes) {
  if (c.includes(bad)) {
    c = c.split(bad).join(good);
    count++;
    console.log('Fixed:', JSON.stringify(bad), '->', good);
  }
}

// Also look for the Saved! checkmark pattern - ✓ saved
// ✓ UTF-8: E2 9C 93 → W1252: â(E2) œ(0153) "(0094=94→U+201D)  
const checkMark = '\u00E2\u0153\u201D';
if (c.includes(checkMark)) {
  c = c.split(checkMark).join('\u2713');
  count++;
  console.log('Fixed checkmark');
}

// And the observed Saved! corruption pattern from earlier: '?? Saved!' 
// Let's check what's in the Saved line
const savedLine = c.split('\n').find(l => l.includes('Saved'));
if (savedLine) console.log('Saved line:', savedLine.trim().slice(0,80));

fs.writeFileSync(file, c, 'utf8');
console.log(`\nTotal fixes: ${count}`);

// Verify
const remaining = c.split('\n').filter(l => /[\u00E2][\u0153\u0161][\u008F\u00A0]/.test(l));
console.log('Remaining corruption lines:', remaining.length);
if (remaining.length) remaining.slice(0,3).forEach(l => console.log(' ', l.trim().slice(0,80)));
