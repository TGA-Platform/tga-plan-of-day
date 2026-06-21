const fs = require('fs');
const rd = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), 'utf8');

// Find the plan-of-day block - look for its closing tag
const planStart = rd.indexOf("activeView === 'plan-of-day' && (<>");
const planClose = rd.indexOf('\n      </>\n      )}\n', planStart);
console.log('plan-of-day block:', planStart, '-', planClose);

const lunchIdx = rd.indexOf('Lunch Break Plan (room staff breaks)');
console.log('LunchBreakPanel at:', lunchIdx);
console.log('Is inside plan-of-day block:', lunchIdx > planStart && lunchIdx < planClose);

// Show 200 chars around the closing of the plan-of-day block
if (planClose >= 0) {
  console.log('\nplan-of-day closing:', rd.substring(planClose - 100, planClose + 200));
}

// Show what the LunchBreakPanel condition resolves to on a Sunday with no data
// Is roomStatuses populated?
console.log('\nroomStatuses.length condition on LunchBreakPanel:');
console.log(rd.substring(lunchIdx - 60, lunchIdx + 50));
