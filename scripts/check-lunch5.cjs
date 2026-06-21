const fs = require('fs');
const rd = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'pages', 'RatioDashboardPage.tsx'), 'utf8');

// Find LunchBreakPanel position relative to plan-of-day block
const planStart = rd.indexOf("activeView === 'plan-of-day' && (<>");
const lunchIdx  = rd.indexOf('Lunch Break Plan (room staff breaks)');
const summaryStart = rd.indexOf("activeView === 'summary' && (");

console.log('plan-of-day starts at:', planStart);
console.log('summary starts at:', summaryStart);
console.log('LunchBreakPanel at:', lunchIdx);
console.log('Is lunch AFTER plan-of-day AND BEFORE summary?', lunchIdx > planStart && lunchIdx < summaryStart);

// Print the region around the LunchBreakPanel
const region = rd.substring(planStart + 100, summaryStart);
// Find LunchBreakPanel in this region
const lunchInRegion = region.includes('LunchBreakPanel');
console.log('LunchBreakPanel inside plan-of-day region:', lunchInRegion);

// Check what comes right before the closing of the plan-of-day block (right before summaryStart)
console.log('\nEnd of plan-of-day block:');
console.log(rd.substring(summaryStart - 500, summaryStart));
