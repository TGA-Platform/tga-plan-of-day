const fs = require('fs');
const bundle = fs.readFileSync(require('path').join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');

// Find time editor modal section - look for timeEditorModal 
const idx = bundle.indexOf('timeEditorModal');
if (idx >= 0) {
  // Find the JSX for the time editor modal
  let pos = bundle.lastIndexOf('G.jsx', idx + 200);
  const modalEnd = bundle.indexOf('timeEditorModal', idx+1);
  console.log('=== timeEditorModal ctx ===');
  console.log(JSON.stringify(bundle.substring(idx-50, idx+500)));
}

// Find where actual staff on lunch (lunchStart) appear in the Ratio check table
// The actual chip in the Lunch column from lunchStart
// Look for staffTimeOverrides near 'lunch' slot check
const idx2 = bundle.indexOf('sharedTimeOverrides');
if (idx2 >= 0) {
  console.log('=== sharedTimeOverrides ===');
  console.log(JSON.stringify(bundle.substring(idx2-20, idx2+300)));
}

// Find where Lunch Start label renders
let pos = 0;
while ((pos = bundle.indexOf('Lunch', pos+1)) >= 0) {
  const ctx = bundle.substring(pos, pos+30);
  if (ctx.includes('Start') || ctx.includes('Break')) {
    console.log('Lunch label:', JSON.stringify(bundle.substring(pos-50, pos+100)));
  }
  if (pos > bundle.length - 100) break;
}

// Find the setTimeEditorLunchStart
const idx3 = bundle.indexOf('setTimeEditorLunchStart');
if (idx3 >= 0) {
  console.log('=== setTimeEditorLunchStart ===');
  console.log(JSON.stringify(bundle.substring(idx3-100, idx3+300)));
}

// Find deputy-timesheets-actual fetch + lunch parsing
const idx4 = bundle.indexOf('actualStart');
if (idx4 >= 0) {
  console.log('=== actualStart context ===');
  console.log(JSON.stringify(bundle.substring(idx4-100, idx4+400)));
}
