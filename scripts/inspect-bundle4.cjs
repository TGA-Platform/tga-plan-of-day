const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find the time editor modal - look for Lunch Start or lunchStart input
const idx = bundle.indexOf('Lunch Start');
if (idx >= 0) {
  console.log('=== Time editor Lunch Start field ===');
  console.log(JSON.stringify(bundle.substring(idx-500, idx+500)));
}

// Find the getStaffTime function equivalent in bundle
const idx2 = bundle.indexOf('getStaffTime');
if (idx2 >= 0) {
  console.log('=== getStaffTime ===');
  console.log(JSON.stringify(bundle.substring(idx2-20, idx2+300)));
}

// Find updateStaffTimeOverride equivalent
const idx3 = bundle.indexOf('lunchStart,lunchEnd,source');
if (idx3 >= 0) {
  console.log('=== updateStaffTimeOverride with lunchStart ===');
  console.log(JSON.stringify(bundle.substring(idx3-200, idx3+200)));
}

// Find where lunch is shown in ratio check - the 'on lunch' text
const idx4 = bundle.indexOf("on lunch");
if (idx4 >= 0) {
  console.log('=== on lunch chips ===');
  console.log(JSON.stringify(bundle.substring(idx4-300, idx4+400)));
}

// Find the staffAtSlotMap lunch exclusion (staff on lunch shouldn't count toward available)
let pos = 0;
while ((pos = bundle.indexOf('lunchStart', pos+1)) >= 0) {
  const ctx = bundle.substring(pos-50, pos+100);
  if (ctx.includes('slotMins') || ctx.includes('Minutes') || ctx.includes('mins') || ctx.includes('slot')) {
    console.log('=== lunchStart slot check ===');
    console.log(JSON.stringify(ctx));
    break;
  }
}
