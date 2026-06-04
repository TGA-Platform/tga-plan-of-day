const fs = require('fs');
const file = 'src/pages/SettingsPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// 1. Remove the SQL hint block entirely
const sqlStart = "      {/* SQL hint if no DB users */}";
const sqlEnd = "      {/* Add user form */}";
const sqlIdx = c.indexOf(sqlStart);
const afterIdx = c.indexOf(sqlEnd);
if (sqlIdx > -1 && afterIdx > sqlIdx) {
  c = c.slice(0, sqlIdx) + '      ' + c.slice(afterIdx);
  console.log('Removed SQL hint block');
} else {
  console.log('SQL hint block not found at expected location');
}

// 2. Fix remaining emoji corruption using Windows-1252 mojibake patterns
// Build w1252 decode table
const w1252 = {
  0x80:0x20AC, 0x82:0x201A, 0x83:0x0192, 0x84:0x201E, 0x85:0x2026,
  0x86:0x2020, 0x87:0x2021, 0x88:0x02C6, 0x89:0x2030, 0x8A:0x0160,
  0x8B:0x2039, 0x8C:0x0152, 0x8E:0x017D, 0x91:0x2018, 0x92:0x2019,
  0x93:0x201C, 0x94:0x201D, 0x95:0x2022, 0x96:0x2013, 0x97:0x2014,
  0x98:0x02DC, 0x99:0x2122, 0x9A:0x0161, 0x9B:0x203A, 0x9C:0x0152,
  0x9E:0x017E, 0x9F:0x0178,
};
function w1252char(b) { return w1252[b] || b; }
function mojibake(bytes) { return bytes.map(b => String.fromCodePoint(w1252char(b))).join(''); }

const fixes = [
  // ✏️  U+270F U+FE0F (pencil emoji) — 3 bytes: E2 9C 8F, then EF B8 8F
  // E2 9C 8F → â (E2), œ (9C), (8F=control, Latin-1 = undefined → keep as 0x8F)
  // Actually let's just look for the observed pattern
  // From the screenshot: âœï¸  → let's decode: â=E2, œ=9C->0x9C w1252=0x0152, ï=EF->0xEF=ï, ¸=B8->0xB8=¸
  // So ✏️ (E2 9C 8F EF B8 8F) mojibaked → â + œ + \x8F + ï + ¸ + \x8F
  // The \x8F chars are undefined in w1252 so they stay as \x8F
  // Let me just replace the exact observed string
  ['\u00E2\u0152\u008F\u00EF\u00B8\u008F', '\u270F\uFE0F'],  // ✏️ pencil
  ['\u00E2\u009C\u008F', '\u270F'],  // ✏ pencil (no variation selector)
  // ✅ check mark (already fixed but double-check)
  ['\u00E2\u0153\u2026', '\u2705'],
  // ⚠️  (E2 9A A0 EF B8 8F)
  ['\u00E2\u009A\u00A0\u00EF\u00B8\u008F', '\u26A0\uFE0F'],
  ['\u00E2\u009A\u00A0', '\u26A0'],
  // ✓ check (E2 9C 93)
  ['\u00E2\u009C\u0093', '\u2713'],
  // ← arrow
  ['\u00E2\u0086\u0090', '\u2190'],
  // ↺ reset arrow
  ['\u00E2\u0086\u00BA', '\u21BA'],
  // — em dash
  ['\u00E2\u20AC\u201D', '\u2014'],
  // • bullet
  ['\u00E2\u20AC\u00A2', '\u2022'],
  // … ellipsis  
  ['\u00E2\u20AC\u00A6', '\u2026'],
  // · middle dot
  ['\u00C2\u00B7', '\u00B7'],
];

let count = 0;
for (const [bad, good] of fixes) {
  if (c.includes(bad)) {
    c = c.split(bad).join(good);
    count++;
    console.log('Fixed U+' + good.codePointAt(0).toString(16).toUpperCase() + ' (' + good + ')');
  }
}

// 3. Also fix the specific observed Edit button pattern by direct search
// The corrupted ✏️ Edit appears as specific byte sequences — let's also try replacing any
// variant of the corrupted pencil that appears before " Edit"
const editVariants = [
  '\u00E2\u009C\u008F\uFE0F Edit',
  '\u00E2\u0152\u008F\uFE0F Edit', 
  '\u00E2\u0152\uFE0F Edit',
];
for (const v of editVariants) {
  if (c.includes(v)) {
    c = c.split(v).join('\u270F\uFE0F Edit');
    count++;
    console.log('Fixed Edit button variant:', JSON.stringify(v));
  }
}

// 4. Fix "Saving…" and similar truncated corruption
c = c.replace(/Saving\.[^'"]*/g, 'Saving\u2026');

fs.writeFileSync(file, c, 'utf8');
console.log(`\nTotal fixes: ${count}`);

// Verify Edit button
const editLine = c.split('\n').find(l => l.includes('Edit') && (l.includes('pencil') || l.includes('\u270F') || l.includes('âœ') || l.includes('\u00E2')));
console.log('Edit button line:', editLine?.trim().slice(0,80) || 'Not found (may be clean already)');
const remaining = c.split('\n').filter(l => l.includes('\u00E2\u009C') || l.includes('\u00E2\u0152'));
if (remaining.length) console.log('Still corrupted lines:', remaining.length);
else console.log('No remaining E2-9C/E2-9D corruption found');
