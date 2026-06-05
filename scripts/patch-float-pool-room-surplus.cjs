const fs = require('fs'), path = require('path');
let changed = 0;

function patchFile(filePath, replacements) {
  let src = fs.readFileSync(filePath, 'utf8');
  const hasCRLF = src.includes('\r\n');
  if (hasCRLF) src = src.replace(/\r\n/g, '\n');
  for (const [old, neu, label] of replacements) {
    if (!src.includes(old)) { console.error('NOT FOUND: ' + label + ' in ' + path.basename(filePath)); continue; }
    src = src.replace(old, neu);
    changed++;
    console.log('\u2713 ' + label);
  }
  if (hasCRLF) src = src.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, src, 'utf8');
}

// RatioDashboardPage: update Available display and FTE over line
patchFile(path.join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), [
  [
    `<span className="font-medium" style={{ color: '#2d5c18' }}>{floats.length + adAvailable}</span>`,
    `<span className="font-medium" style={{ color: '#2d5c18' }}>{effectiveFloatCount + adAvailable}{roomNetSurplus > 0 && <span style={{ color: '#7c3aed', fontSize: '11px' }}> (+{roomNetSurplus} rm)</span>}</span>`,
    'RatioDashboard: available count'
  ],
  [
    `{floats.length + adAvailable > totalFloatersNeeded && (`,
    `{effectiveFloatCount + adAvailable > totalFloatersNeeded && (`,
    'RatioDashboard: FTE over condition'
  ],
  [
    `+{formatFTE(floats.length + adAvailable - totalFloatersNeeded)} FTE over`,
    `+{formatFTE(effectiveFloatCount + adAvailable - totalFloatersNeeded)} FTE over`,
    'RatioDashboard: FTE over value'
  ],
]);

// MorningBriefingPage: update "Available (floats)" count display
patchFile(path.join(__dirname, '..', 'src', 'pages', 'MorningBriefingPage.tsx'), [
  [
    `Available (floats)</span>\n              <span className="font-semibold">{card.floatCount}</span>`,
    `Available (floats{card.roomNetSurplus > 0 ? ' +' + card.roomNetSurplus + ' rm' : ''})</span>\n              <span className="font-semibold">{card.effectiveFloatCount}</span>`,
    'MorningBriefing: available count'
  ],
]);

console.log('\nDone \u2014 ' + changed + ' replacements.');
