const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'iss-summary.json'), 'utf8'));

// Group by centre (service) and case
const byCentre = {};
for (const row of data) {
  let centre = row.service || '(unknown)';
  // Normalize centre names
  centre = centre
    .replace(/^The Grove Academy\s*-\s*/, '')
    .replace(/\s+CCS$/i, '')
    .replace(/\bMt\b/i, 'Mount')
    .trim();
  if (!byCentre[centre]) byCentre[centre] = [];
  byCentre[centre].push(row);
}

for (const [centre, rows] of Object.entries(byCentre).sort()) {
  console.log(`\n=== ${centre} (${rows.length} children) ===`);

  // Group by case
  const byCase = {};
  for (const r of rows) {
    const key = r.caseId || '(no case)';
    if (!byCase[key]) byCase[key] = [];
    byCase[key].push(r);
  }

  for (const [caseId, cRows] of Object.entries(byCase)) {
    const first = cRows[0];
    const children = [...new Set(cRows.map(r => r.childName).filter(Boolean))];
    const allDocChildren = [...new Set(cRows.flatMap(r => r.children || []).filter(c =>
      c && !/Acceptance|Manager|Conditions|Funding|ISP|IDF|approval|business days|start date/i.test(c)
    ))];
    const hours = first.weeklyHours || first.approvedHours || '-';
    const period = first.approvalPeriod || `${first.startDate || '?'} → ${first.expDate || '?'}`;
    const room = first.careEnvironment || first.room || '-';
    const days = [...new Set(cRows.map(r => r.days).filter(Boolean))].join('; ');
    const educator = first.educator || '-';

    console.log(`  Case ${caseId} | ${room}`);
    console.log(`    Period: ${period}`);
    console.log(`    Max hrs/week: ${hours}`);
    console.log(`    Children (${children.length}): ${children.join(', ')}`);
    console.log(`    Days: ${days || '-'}`);
    console.log(`    Educator: ${educator}`);
  }
}

// Totals
console.log('\n=== Totals ===');
console.log(`Total approved items (children): ${data.length}`);
console.log(`Total approved cases: ${new Set(data.map(r => r.caseId).filter(Boolean)).size}`);
console.log(`Centres: ${Object.keys(byCentre).sort().join(', ')}`);
