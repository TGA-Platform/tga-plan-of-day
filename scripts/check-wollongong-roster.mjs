const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// All Wollongong unit IDs (rooms + float + leave + nonRatio)
const unitIds = [118, 119, 201, 126, 231, 128, 460, 127, 116, 117, 124, 166, 202, 312, 326, 339];

const res = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 200,
    start: 1,
    search: {
      s1: { field: 'Date', type: 'eq', data: '2026-05-22' },
      s2: { field: 'OperationalUnit', type: 'in', data: unitIds },
    },
  }),
});

const rosters = await res.json();
if (!Array.isArray(rosters)) {
  console.log('Unexpected response:', JSON.stringify(rosters).slice(0, 300));
  process.exit(1);
}

console.log('Total rosters on 2026-05-22 for Wollongong:', rosters.length);
console.log('');

// Build employee name map from metadata
const empMap = {};
for (const r of rosters) {
  const name = r._DPMetaData?.EmployeeInfo?.DisplayName;
  if (name) empMap[r.Employee] = name;
}

// If some names are missing, look them up
const missingIds = rosters.map(r => r.Employee).filter(id => !empMap[id]);
if (missingIds.length > 0) {
  const empRes = await fetch(HOST + '/api/v1/resource/Employee/QUERY', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max: 200, start: 1, search: { s1: { field: 'Id', type: 'in', data: [...new Set(missingIds)] } } }),
  });
  const emps = await empRes.json();
  if (Array.isArray(emps)) emps.forEach(e => { empMap[e.Id] = e.DisplayName || (e.FirstName + ' ' + e.LastName).trim(); });
}

// Group by unit
const byUnit = {};
for (const r of rosters) {
  const unitId = r.OperationalUnit;
  const unitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || ('Unit ' + unitId);
  const empName = empMap[r.Employee] || ('Staff #' + r.Employee);
  const start = typeof r.StartTime === 'number'
    ? new Date(r.StartTime * 1000).toTimeString().slice(0, 5)
    : String(r.StartTime || '').slice(11, 16);
  const end = typeof r.EndTime === 'number'
    ? new Date(r.EndTime * 1000).toTimeString().slice(0, 5)
    : String(r.EndTime || '').slice(11, 16);
  if (!byUnit[unitId]) byUnit[unitId] = { name: unitName, staff: [] };
  byUnit[unitId].staff.push(`${empName} (${start}-${end})`);
}

for (const [uid, data] of Object.entries(byUnit)) {
  console.log(`[Unit ${uid}] ${data.name}:`);
  data.staff.forEach(s => console.log('  ' + s));
}

// Also search for Sibel specifically
console.log('\n--- Searching for "Sibel" across ALL units ---');
const sibel = rosters.filter(r => (empMap[r.Employee] || '').toLowerCase().includes('sibel'));
if (sibel.length === 0) {
  console.log('Sibel Altay NOT found in the 22 May roster for these unit IDs.');
  console.log('She may be rostered in a unit not included in our list, or not rostered that day.');
} else {
  sibel.forEach(r => console.log('Found:', empMap[r.Employee], '- unit', r.OperationalUnit));
}
