const fs = require('fs');
const rd = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), 'utf8');

const lunchIdx = rd.indexOf('Lunch Break Plan (room staff breaks)');
console.log('LunchBreakPanel comment at:', lunchIdx);

// Find what view block it's in
const viewBlocks = ["activeView === 'ratio-check'", "activeView === 'plan-of-day'", "activeView === 'summary'"];
viewBlocks.forEach(v => {
  let p = rd.lastIndexOf(v, lunchIdx);
  console.log(v + ':', p >= 0 ? 'found ' + (lunchIdx-p) + ' chars before' : 'NOT found before');
});

// Show the 400 chars before the LunchBreakPanel to understand its context
console.log('\n--- Context before LunchBreakPanel ---');
console.log(rd.substring(lunchIdx - 400, lunchIdx + 100));

// Check lunchReloadKey
const lrkIdx = rd.indexOf('lunchReloadKey');
console.log('\nlunchReloadKey defined:', lrkIdx >= 0);
if (lrkIdx >= 0) {
  const def = rd.substring(Math.max(0, lrkIdx - 10), lrkIdx + 100);
  console.log('context:', def);
}

// Check if roomStatuses has data / condition
const condIdx = rd.indexOf('!loading && roomStatuses.length > 0 && (');
console.log('\nroomStatuses condition idx:', condIdx, '(LunchBreakPanel at:', lunchIdx, ')');
