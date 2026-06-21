const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find the staffOnLunchAtSlot or similar derived data
// Look for lunchStart being compared to slot mins
let pos = 0;
while ((pos = bundle.indexOf('lunchStart', pos+1)) >= 0) {
  const ctx = bundle.substring(pos-100, pos+200);
  if (ctx.includes('slotMins') || ctx.includes('slotToMins') || ctx.includes('slotMin') || ctx.includes('slot')) {
    console.log('=== lunchStart slot comparison ===');
    console.log(JSON.stringify(ctx));
  }
}

// Find the function that generates lunch chips from staffTimeOverrides
// Look for 'lunchStart' near 'staffTimeOverrides' in a filter/map context
pos = 0;
while ((pos = bundle.indexOf('lunchStart', pos+1)) >= 0) {
  const ctx = bundle.substring(pos-150, pos+150);
  if (ctx.includes('filter') || ctx.includes('map') || ctx.includes('reduce')) {
    console.log('=== lunchStart in filter/map ===');
    console.log(JSON.stringify(ctx));
    break;
  }
}

// Find the staffOnLunch derived structure
const idx = bundle.indexOf('staffOnLunch');
if (idx >= 0) console.log('staffOnLunch:', JSON.stringify(bundle.substring(idx-20, idx+200)));

// Find sharedTimeOverrides and what it does in the ratio check
const idx2 = bundle.indexOf('sharedTimeOverrides');
if (idx2 >= 0) console.log('sharedTimeOverrides context:', JSON.stringify(bundle.substring(idx2-50, idx2+300)));

// Check if there's a separate 'staffAtLunchBySlot' or similar
const idx3 = bundle.indexOf('atLunch');
if (idx3 >= 0) console.log('atLunch:', JSON.stringify(bundle.substring(idx3-30, idx3+150)));
