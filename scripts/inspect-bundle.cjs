const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find deputy-timesheets-actual fetch
const idx4 = bundle.indexOf('deputy-timesheets-actual');
if (idx4 >= 0) console.log('timesheets fetch ctx:', JSON.stringify(bundle.substring(idx4-50, idx4+400)));

// Find where lunchStart goes into staffTimeOverrides
const idx5 = bundle.indexOf('lunchStart,lunchEnd');
if (idx5 >= 0) console.log('lunchStart,lunchEnd ctx:', JSON.stringify(bundle.substring(idx5-100, idx5+200)));

// Find source:manual or source:"manual"  
let pos = -1;
while ((pos = bundle.indexOf('source:', pos+1)) >= 0) {
  const ctx = bundle.substring(pos, pos+20);
  if (ctx.includes('manual') || ctx.includes('deputy')) {
    console.log('source ctx:', JSON.stringify(bundle.substring(pos-30, pos+60)));
    break;
  }
}

// Find the staffTimeOverrides setter with lunchStart
const idx6 = bundle.indexOf('lunchStart:');
if (idx6 >= 0) {
  let pos2 = idx6;
  let count = 0;
  while ((pos2 = bundle.indexOf('lunchStart:', pos2)) >= 0 && count < 6) {
    console.log('lunchStart occurrence', ++count, ':', JSON.stringify(bundle.substring(pos2-80, pos2+80)));
    pos2++;
  }
}
