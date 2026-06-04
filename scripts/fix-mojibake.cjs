const fs = require('fs');
const file = 'src/pages/SettingsPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// Windows-1252 maps bytes 0x80-0x9F to special Unicode chars (not ISO-8859-1)
// When UTF-8 multi-byte sequences are misread as Windows-1252 and re-encoded as UTF-8,
// we get these specific mojibake patterns.

// Build decoder: given 2-3 byte UTF-8 sequence (as hex), what Windows-1252 chars result?
// Windows-1252 0x80-0x9F mapping
const w1252 = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0152,
  0x9D: 0x0000, 0x9E: 0x017E, 0x9F: 0x0178,
};
// For 0xA0-0xFF, Windows-1252 = ISO-8859-1 = same codepoint value
function w1252char(byte) {
  if (byte >= 0x80 && byte <= 0x9F) return w1252[byte] || byte;
  return byte;
}

// Convert a UTF-8 sequence (as array of byte values) to the mojibake string
// that results from misreading those bytes as Windows-1252 then re-encoding as UTF-8
function mojibake(bytes) {
  return bytes.map(b => String.fromCodePoint(w1252char(b))).join('');
}

// All the Unicode chars that appear as multi-byte UTF-8 in the file
const fixes = [
  // 3-byte UTF-8 sequences for common chars
  ['\u2014', [0xE2, 0x80, 0x94]], // em dash —
  ['\u2013', [0xE2, 0x80, 0x93]], // en dash –
  ['\u2022', [0xE2, 0x80, 0xA2]], // bullet •
  ['\u2019', [0xE2, 0x80, 0x99]], // right single quote '
  ['\u2018', [0xE2, 0x80, 0x98]], // left single quote '
  ['\u201C', [0xE2, 0x80, 0x9C]], // left double quote "
  ['\u201D', [0xE2, 0x80, 0x9D]], // right double quote "
  ['\u2026', [0xE2, 0x80, 0xA6]], // ellipsis …
  ['\u2122', [0xE2, 0x84, 0xA2]], // trademark ™
  ['\u2705', [0xE2, 0x9C, 0x85]], // white check mark ✅
  ['\u2713', [0xE2, 0x9C, 0x93]], // check mark ✓
  ['\u26A0', [0xE2, 0x9A, 0xA0]], // warning ⚠
  ['\u2500', [0xE2, 0x94, 0x80]], // box horizontal ─
  ['\u21BA', [0xE2, 0x86, 0xBA]], // clockwise arrow ↺
  ['\u2190', [0xE2, 0x86, 0x90]], // left arrow ←
  ['\u2192', [0xE2, 0x86, 0x92]], // right arrow →
  // 2-byte UTF-8 sequences
  ['\u00B7', [0xC2, 0xB7]],       // middle dot ·
  ['\u00A9', [0xC2, 0xA9]],       // copyright ©
  ['\u00B0', [0xC2, 0xB0]],       // degree °
];

let count = 0;
for (const [good, bytes] of fixes) {
  const bad = mojibake(bytes);
  if (c.includes(bad)) {
    c = c.split(bad).join(good);
    count++;
    console.log(`Fixed: U+${good.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} (${good}) <- ${JSON.stringify(bad)}`);
  }
}

// Also handle the 9C byte which Windows-1252 maps differently (0x9C = U+0152 Œ not U+0153 œ)
// Let me double check by looking at the actual observed pattern for checkmark
// From debug: U+00E2, U+0153, U+2026 for ✅
// U+0153 = œ (Latin small oe) — but Windows-1252 0x9C = U+0152 (Œ, capital oe)
// Hmm, there might be a discrepancy. Let's also try the observed pattern directly.
const observed_checkmark = '\u00E2\u0153\u2026'; // from codepoint debug output
if (c.includes(observed_checkmark)) {
  c = c.split(observed_checkmark).join('\u2705');
  count++;
  console.log('Fixed observed checkmark pattern');
}

const observed_bullet = '\u00E2\u20AC\u00A2'; // â€¢
if (c.includes(observed_bullet)) {
  c = c.split(observed_bullet).join('\u2022');
  count++;
  console.log('Fixed observed bullet pattern');
}

const observed_emdash = '\u00E2\u20AC\u201D'; // â€"
if (c.includes(observed_emdash)) {
  c = c.split(observed_emdash).join('\u2014');
  count++;
  console.log('Fixed observed em dash pattern');
}

fs.writeFileSync(file, c, 'utf8');
console.log(`\nTotal fixes: ${count}. File size: ${c.length}`);

// Verify
const lines = c.split('\n');
const badLine = lines.find(l => l.includes('Saved') && l.includes('showFlash'));
if (badLine) console.log('Saved flash line:', badLine.trim());
const pwLine = lines.find(l => l.includes('password') && l.includes('show real'));
if (pwLine) console.log('PW line:', pwLine.trim().slice(0, 60));
