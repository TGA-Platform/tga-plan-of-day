const fs = require('fs');
const rd = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), 'utf8');

const lunchIdx = rd.indexOf('Lunch Break Plan (room staff breaks)');

const ratioCheck = "activeView === 'ratio-check'";
const planOfDay  = "activeView === 'plan-of-day'";

const ratioCheckPos = rd.lastIndexOf(ratioCheck, lunchIdx);
const planOfDayPos  = rd.lastIndexOf(planOfDay, lunchIdx);

console.log('ratio-check block before lunch dist:', lunchIdx - ratioCheckPos);
console.log('plan-of-day block before lunch dist:', lunchIdx - planOfDayPos);

// Find enclosing block closes
// Find the ratio-check block: it starts with {activeView === 'ratio-check' && (
// and ends with )}
// More reliably: find the </> that closes the plan-of-day fragment
const ratioClose = rd.indexOf('\n      )}\n', ratioCheckPos);
const planClose  = rd.indexOf('\n      )}\n', planOfDayPos);

console.log('ratio-check block closes at offset:', ratioClose, '(dist from lunch:', lunchIdx - ratioClose, ')');
console.log('plan-of-day block closes at offset:', planClose,  '(dist from lunch:', lunchIdx - planClose,  ')');

console.log('LunchBreakPanel inside ratio-check:', lunchIdx > ratioCheckPos && lunchIdx < ratioClose);
console.log('LunchBreakPanel inside plan-of-day:', lunchIdx > planOfDayPos  && lunchIdx < planClose);

// Print the 100 chars right before the lunch panel comment
console.log('\nLine before LunchBreakPanel:');
console.log(rd.substring(lunchIdx - 300, lunchIdx));
