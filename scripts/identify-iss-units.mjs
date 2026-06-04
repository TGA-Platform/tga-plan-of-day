const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// All float unit IDs across every centre (both IDs per centre)
const allFloatIds = [
  224, 230,  // Oatley
  126, 231,  // Wollongong
  222, 225,  // Mount Annan
  270, 278,  // Spring Farm
  252, 260,  // Denham Court
  207, 228,  // Ed Park 1
  220, 229,  // Ed Park 2
  372, 365,  // Wilton
  205, 233,  // Dapto 1
  206, 227,  // Dapto 2
  288, 296,  // North Wollongong
  355, 348,  // Shell Cove
  181, 226,  // Bexley
  389, 382,  // Belfield
  423, 416,  // Bankstown
  473, 465,  // Glendale
  406, 399,  // Edgeworth
];

const res = await fetch(HOST + '/api/v1/resource/OperationalUnit/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ max: 200, search: { s1: { field: 'Id', type: 'in', data: allFloatIds } } }),
});
const units = await res.json();

console.log('Unit ID | Company | Name');
console.log('--------|---------|----');
units.sort((a,b) => a.Company - b.Company || a.Id - b.Id).forEach(u => {
  const isISS = u.OperationalUnitName.toLowerCase().includes('iss');
  console.log(`${String(u.Id).padEnd(8)}| ${String(u.Company).padEnd(8)}| ${u.OperationalUnitName}${isISS ? ' ← ISS' : ''}`);
});

// Print summary: centreFloatIds -> issUnitId
console.log('\n--- ISS unit IDs by centre ---');
const issUnits = units.filter(u => u.OperationalUnitName.toLowerCase().includes('iss'));
issUnits.forEach(u => console.log(`  ${u.OperationalUnitName.padEnd(30)} Company ${u.Company} → issUnitId: ${u.Id}`));
