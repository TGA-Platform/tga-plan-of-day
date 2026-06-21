const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find the staffOnLunch/staffAtLunch map that feeds the Ratio Check lunch column
// We know the lunch column renders: (offFloorStaffBySlot[slot]?.lunch ?? [])
// Plus manualLunch from staffMoves
// The question is: where does 'lunchStart' from staffTimeOverrides appear in the lunch column?

// Look for the section right before the lunch column td in the bundle
const lunchColIdx = bundle.indexOf('on lunch break, drag or tap');
if (lunchColIdx >= 0) {
  // Go back 2000 chars to find the preceding code
  console.log('=== Lunch column preceding code ===');
  console.log(JSON.stringify(bundle.substring(lunchColIdx - 2000, lunchColIdx + 200)));
}
