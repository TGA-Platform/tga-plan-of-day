const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// Test 1: Just unit 117, date 2026-05-22
const res1 = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 50, start: 1,
    search: {
      s1: { field: 'Date', type: 'eq', data: '2026-05-22' },
      s2: { field: 'OperationalUnit', type: 'eq', data: 117 },
    },
  }),
});
const r1 = await res1.json();
console.log('Unit 117 only (eq):', Array.isArray(r1) ? r1.length + ' results' : JSON.stringify(r1).slice(0,100));
if (Array.isArray(r1)) r1.forEach(r => console.log(' ', r._DPMetaData?.EmployeeInfo?.DisplayName));

// Test 2: Units [116, 117] with 'in' filter
const res2 = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 50, start: 1,
    search: {
      s1: { field: 'Date', type: 'eq', data: '2026-05-22' },
      s2: { field: 'OperationalUnit', type: 'in', data: [116, 117] },
    },
  }),
});
const r2 = await res2.json();
console.log('\nUnits [116,117] only (in):', Array.isArray(r2) ? r2.length + ' results' : JSON.stringify(r2).slice(0,100));
if (Array.isArray(r2)) r2.forEach(r => console.log(' ', r._DPMetaData?.EmployeeInfo?.DisplayName, 'unit:', r.OperationalUnit));

// Test 3: Full list but check if 'in' with 16 IDs drops some
const unitIds = [118, 119, 201, 126, 231, 128, 460, 127, 116, 117, 124, 166, 202, 312, 326, 339];
const res3 = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 50, start: 1,
    search: {
      s1: { field: 'Date', type: 'eq', data: '2026-05-22' },
      s2: { field: 'OperationalUnit', type: 'in', data: unitIds },
    },
  }),
});
const r3 = await res3.json();
console.log('\nFull unit list (16 IDs):', Array.isArray(r3) ? r3.length + ' results' : JSON.stringify(r3).slice(0,100));
if (Array.isArray(r3)) {
  const units = [...new Set(r3.map(r => r.OperationalUnit))];
  console.log('Units returned:', units.sort((a,b) => a-b));
  console.log('Sibel in results:', r3.some(r => r._DPMetaData?.EmployeeInfo?.DisplayName?.includes('Sibel')));
}
