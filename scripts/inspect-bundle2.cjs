const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find the source:'deputy' context - this is in the timesheet merge
const idx = bundle.indexOf("source:`deputy`");
if (idx >= 0) {
  console.log('=== source:deputy context ===');
  console.log(JSON.stringify(bundle.substring(idx-300, idx+200)));
}

// Find where staffTimeOverrides is written with lunchStart
// Look for pattern: lunchStart AND staffTimeOverrides close together
let pos = bundle.indexOf('staffTimeOverrides');
let searchPos = pos;
while ((searchPos = bundle.indexOf('lunchStart', searchPos+1)) >= 0) {
  // Check if staffTimeOverrides is nearby
  const region = bundle.substring(Math.max(0, searchPos-400), searchPos+200);
  if (region.includes('staffTimeOverrides') || region.includes('TimeOverride')) {
    console.log('=== lunchStart near TimeOverrides ===');
    console.log(JSON.stringify(region));
    break;
  }
}

// Find the time editor submit - where lunchStart is saved manually
const idx2 = bundle.indexOf('lunchStart,lunchEnd,source');
if (idx2 >= 0) {
  console.log('=== manual override save ===');
  console.log(JSON.stringify(bundle.substring(idx2-100, idx2+200)));
}

// Find n.lunchStart (the deputy merge)
const idx3 = bundle.indexOf('n.lunchStart');
if (idx3 >= 0) {
  console.log('=== deputy lunchStart merge ===');
  console.log(JSON.stringify(bundle.substring(idx3-200, idx3+200)));
}
