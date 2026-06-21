const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find the time editor modal content - look for Lunch Start label
const idx = bundle.indexOf('Lunch Start');
if (idx >= 0) console.log('=== Lunch Start label ===\n' + JSON.stringify(bundle.substring(idx-200, idx+300)));

// Find the time editor save function - look for lunchStart save
const idx2 = bundle.indexOf('lunchStart:t,lunchEnd');
if (idx2 >= 0) console.log('=== lunchStart save ===\n' + JSON.stringify(bundle.substring(idx2-200, idx2+200)));

// Find where lunch chip shows in ratio check table
// Look for lunchStart check against slot time
const idx3 = bundle.indexOf('slotToMins') > 0 ? bundle.indexOf('lunchStart') : -1;
if (idx3 >= 0) {
  // search for slot comparison with lunchStart
  let pos = 0;
  while ((pos = bundle.indexOf('lunchStart', pos+1)) >= 0) {
    const ctx = bundle.substring(pos-50, pos+100);
    if (ctx.includes('slot') || ctx.includes('Mins') || ctx.includes('mins')) {
      console.log('=== lunchStart slot comparison ===\n' + JSON.stringify(ctx));
      break;
    }
  }
}

// Find the staffAtSlotMap lunch filter
const idx4 = bundle.indexOf('lunchStart&&');
if (idx4 >= 0) console.log('=== lunchStart&& ===\n' + JSON.stringify(bundle.substring(idx4-100, idx4+200)));

// Find where lunch renders in the table td - look for __lunch__ near lunchStart
let pos = 0, count = 0;
while ((pos = bundle.indexOf('__lunch__', pos+1)) >= 0 && count < 5) {
  const ctx = bundle.substring(pos-100, pos+200);
  if (ctx.includes('lunchStart') || ctx.includes('slot') || ctx.includes('chip')) {
    console.log('=== __lunch__ with lunchStart/slot ===\n' + JSON.stringify(ctx));
    count++;
  } else count++;
}

// Find the Lunch column chip rendering
const idx5 = bundle.indexOf('on lunch break');
if (idx5 >= 0) console.log('=== lunch chip ===\n' + JSON.stringify(bundle.substring(idx5-300, idx5+300)));
