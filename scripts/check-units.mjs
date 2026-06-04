const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// Check which company each Wollongong unit belongs to
const unitIds = [116, 117, 118, 119, 124, 126, 127, 128, 166, 201, 202, 231, 312, 326, 339, 460];

const res = await fetch(HOST + '/api/v1/resource/OperationalUnit/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 100,
    search: { s1: { field: 'Id', type: 'in', data: unitIds } },
  }),
});
const units = await res.json();
if (!Array.isArray(units)) { console.log('Error:', JSON.stringify(units).slice(0,200)); process.exit(); }

console.log('Unit | Company | Name');
console.log('-----|---------|-----');
units.sort((a,b) => a.Id - b.Id).forEach(u => {
  console.log(`${String(u.Id).padEnd(5)}| ${String(u.Company).padEnd(8)}| ${u.OperationalUnitName}`);
});

// Also check what company IDs are involved
const companies = [...new Set(units.map(u => u.Company))];
console.log('\nDistinct companies:', companies);

// Fetch company names
const cRes = await fetch(HOST + '/api/v1/resource/Company/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ max: 50, search: { s1: { field: 'Id', type: 'in', data: companies } } }),
});
const cos = await cRes.json();
if (Array.isArray(cos)) cos.forEach(c => console.log(`  Company ${c.Id}: ${c.CompanyName}`));
