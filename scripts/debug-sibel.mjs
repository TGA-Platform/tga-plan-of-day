const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// Check Sibel's exact roster record for May 22
const res = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 10,
    search: {
      s1: { field: 'Employee', type: 'eq', data: 2032 },
      s2: { field: 'Date', type: 'eq', data: '2026-05-22' },
    },
  }),
});
const data = await res.json();
console.log('Sibel on 2026-05-22 (date eq filter):', JSON.stringify(data, null, 2));

// Also try with timestamp
const ts = new Date('2026-05-22T00:00:00+10:00').getTime() / 1000;
console.log('\nUnix timestamp for 2026-05-22 00:00 AEST:', ts);

const res2 = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 10,
    search: {
      s1: { field: 'Employee', type: 'eq', data: 2032 },
      s2: { field: 'Date', type: 'eq', data: ts },
    },
  }),
});
const data2 = await res2.json();
console.log('\nSibel on 2026-05-22 (unix timestamp filter):', Array.isArray(data2) ? data2.length + ' results' : JSON.stringify(data2).slice(0,200));
if (Array.isArray(data2) && data2.length > 0) console.log('Date field value:', data2[0].Date, '| OperationalUnit:', data2[0].OperationalUnit);

// What date value does Deputy actually store for the known good roster?
// Check India Theobald (who DID show on May 22)
const res3 = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 5,
    search: {
      s1: { field: 'Date', type: 'eq', data: '2026-05-22' },
      s2: { field: 'OperationalUnit', type: 'in', data: [166] },
    },
  }),
});
const data3 = await res3.json();
console.log('\nIndia Theobald (unit 166) on 2026-05-22:');
if (Array.isArray(data3)) data3.forEach(r => console.log('  Date field raw:', r.Date, '| Emp:', r.Employee));
