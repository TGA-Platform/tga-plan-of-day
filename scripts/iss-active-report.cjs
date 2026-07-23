const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'iss-summary.json'), 'utf8'));

function parseDate(s) {
  if (!s) return null;
  // Try DD/MM/YYYY
  let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+10:00`);
  // Try YYYY-MM-DD
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+10:00`);
  return null;
}

const today = new Date('2026-07-22T00:00:00+10:00');

const active = [];
const expired = [];

for (const row of data) {
  const start = parseDate(row.startDate);
  const exp = parseDate(row.expDate);
  const isActive = start && exp && start <= today && exp >= today;
  if (isActive) active.push(row);
  else expired.push({ ...row, start, exp });
}

console.log(`Today: 2026-07-22`);
console.log(`Total approved items: ${data.length}`);
console.log(`Active items: ${active.length}`);
console.log(`Expired/future items: ${expired.length}`);

// Group active by centre
const byCentre = {};
for (const row of active) {
  let centre = row.service || '(unknown)';
  centre = centre
    .replace(/^The Grove Academy\s*-\s*/, '')
    .replace(/\s+CCS$/i, '')
    .replace(/\bMt\b/i, 'Mount')
    .trim();
  if (!byCentre[centre]) byCentre[centre] = [];
  byCentre[centre].push(row);
}

console.log('\n=== ACTIVE APPROVALS BY CENTRE ===');
for (const [centre, rows] of Object.entries(byCentre).sort()) {
  console.log(`\n${centre} (${rows.length} children)`);
  const byCase = {};
  for (const r of rows) {
    const key = r.caseId || '(no case)';
    if (!byCase[key]) byCase[key] = [];
    byCase[key].push(r);
  }
  for (const [caseId, cRows] of Object.entries(byCase)) {
    const first = cRows[0];
    const children = [...new Set(cRows.map(r => r.childName).filter(Boolean))];
    const hours = first.weeklyHours || first.approvedHours || '-';
    const period = first.approvalPeriod || `${first.startDate || '?'} → ${first.expDate || '?'}`;
    const room = first.careEnvironment || first.room || '-';
    const days = [...new Set(cRows.map(r => r.days).filter(Boolean))].join('; ');
    const educator = first.educator || '-';
    console.log(`  ${caseId} | ${room} | ${period} | ${hours} hrs/wk | ${educator}`);
    console.log(`    Children (${children.length}): ${children.join(', ')}`);
    console.log(`    Days: ${days || '-'}`);
  }
}

console.log('\n=== EXPIRED (ended) sample ===');
for (const row of expired.filter(r => r.exp && r.exp < today).slice(0, 10)) {
  let centre = (row.service || '(unknown)').replace(/^The Grove Academy\s*-\s*/, '').replace(/\s+CCS$/i, '').replace(/\bMt\b/i, 'Mount').trim();
  console.log(`  ${centre} | ${row.caseId} | ${row.childName} | ended ${row.expDate}`);
}
