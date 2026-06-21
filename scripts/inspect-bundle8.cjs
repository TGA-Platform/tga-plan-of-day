const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find the staffAtSlotMap useMemo - look for staffAtSlotMap definition
// Also look for how lunchStart affects which column staff appear in
let pos = 0;
while ((pos = bundle.indexOf('lunchStart', pos+1)) >= 0) {
  const ctx = bundle.substring(pos-200, pos+300);
  // Looking for where lunchStart is used to place staff in the lunch column
  if (ctx.includes('offFloor') || ctx.includes('getStaff') || ctx.includes('atSlot') || (ctx.includes('lunch') && ctx.includes('staff'))) {
    console.log('=== lunchStart + staff logic ===');
    console.log(JSON.stringify(ctx));
    break;
  }
}

// Look for what feeds the Lunch column - maybe there's a staffOnLunchAtSlot useMemo
const idx = bundle.indexOf('staffOnLunch');
console.log('staffOnLunch:', idx >= 0 ? bundle.substring(idx-20, idx+200) : 'NOT FOUND');

// Check if offFloorBySlot considers lunchStart from staffTimeOverrides
const ofIdx = bundle.indexOf('offFloorStaff');
if (ofIdx >= 0) console.log('offFloorStaff:', JSON.stringify(bundle.substring(ofIdx-50, ofIdx+400)));

// Find where lunchStart is compared with slotMins to determine display
pos = 0;
let count = 0;
while ((pos = bundle.indexOf('lunchStart', pos+1)) >= 0 && count < 20) {
  const ctx = bundle.substring(pos-50, pos+100);
  count++;
  if (ctx.includes('Mins') || ctx.includes('mins') || ctx.includes('slotTo')) {
    console.log('lunchStart time check:', JSON.stringify(ctx));
  }
}
