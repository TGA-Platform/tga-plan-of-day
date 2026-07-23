const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'iss-summary.json'), 'utf8'));

function parsePdfPeriod(s) {
  if (!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s*[-–]\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return {
    start: new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+10:00`),
    exp:   new Date(`${m[6]}-${m[5]}-${m[4]}T00:00:00+10:00`),
  };
}

const today = new Date('2026-07-22T00:00:00+10:00');

const active = [];
const expired = [];
const noPdfPeriod = [];

for (const row of data) {
  const period = parsePdfPeriod(row.approvalPeriod);
  if (!period) {
    noPdfPeriod.push(row);
    continue;
  }
  const isActive = period.start <= today && period.exp >= today;
  if (isActive) active.push({ ...row, period });
  else expired.push({ ...row, period });
}

console.log(`Today: 2026-07-22`);
console.log(`Total approved items: ${data.length}`);
console.log(`Active by PDF period: ${active.length}`);
console.log(`Expired by PDF period: ${expired.length}`);
console.log(`No PDF period (use board dates): ${noPdfPeriod.length}`);

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

console.log('\n=== ACTIVE BY PDF PERIOD ===');
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
    const room = first.careEnvironment || first.room || '-';
    const days = [...new Set(cRows.map(r => r.days).filter(Boolean))].join('; ');
    const educator = first.educator || '-';
    console.log(`  ${caseId} | ${room} | ${first.approvalPeriod} | ${hours} hrs/wk | ${educator}`);
    console.log(`    Children (${children.length}): ${children.join(', ')}`);
    console.log(`    Days: ${days || '-'}`);
  }
}

console.log('\n=== DISCREPANCIES: board says active but PDF period has ended ===');
let discrepancyCount = 0;
for (const row of data) {
  const boardStart = row.startDate ? new Date(`${row.startDate}T00:00:00+10:00`) : null;
  const boardExp = row.expDate ? new Date(`${row.expDate}T00:00:00+10:00`) : null;
  const boardActive = boardStart && boardExp && boardStart <= today && boardExp >= today;
  const pdfPeriod = parsePdfPeriod(row.approvalPeriod);
  const pdfActive = pdfPeriod && pdfPeriod.start <= today && pdfPeriod.exp >= today;
  if (boardActive && !pdfActive && pdfPeriod) {
    discrepancyCount++;
    let centre = (row.service || '(unknown)').replace(/^The Grove Academy\s*-\s*/, '').replace(/\s+CCS$/i, '').replace(/\bMt\b/i, 'Mount').trim();
    console.log(`  ${centre} | ${row.caseId} | ${row.childName} | board: ${row.startDate} → ${row.expDate} | PDF: ${row.approvalPeriod}`);
  }
}
console.log(`Total discrepancies: ${discrepancyCount}`);
