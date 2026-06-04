const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// Search for Sibel in employee list
const res = await fetch(HOST + '/api/v1/resource/Employee/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 50,
    search: { s1: { field: 'FirstName', type: 'like', data: 'Sibel' } },
  }),
});
const emps = await res.json();
console.log('Employees named Sibel:', JSON.stringify(emps, null, 2));

// Also check her recent rosters if found
if (Array.isArray(emps) && emps.length > 0) {
  const sibel = emps[0];
  console.log('\nSibel ID:', sibel.Id, '| Primary location:', sibel.PrimaryLocation);

  // Check her rosters around that date
  const rRes = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      max: 20,
      search: {
        s1: { field: 'Employee', type: 'eq', data: sibel.Id },
        s2: { field: 'Date', type: 'ge', data: '2026-05-19' },
        s3: { field: 'Date', type: 'le', data: '2026-05-23' },
      },
    }),
  });
  const rosters = await rRes.json();
  console.log('\nSibel rosters 19-23 May:');
  if (Array.isArray(rosters) && rosters.length > 0) {
    rosters.forEach(r => {
      const unitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || 'Unit ' + r.OperationalUnit;
      const start = typeof r.StartTime === 'number' ? new Date(r.StartTime * 1000).toTimeString().slice(0,5) : r.StartTime;
      const end = typeof r.EndTime === 'number' ? new Date(r.EndTime * 1000).toTimeString().slice(0,5) : r.EndTime;
      console.log(`  ${r.Date} — ${unitName} (Unit ${r.OperationalUnit}) ${start}-${end} | Open: ${r.Open}`);
    });
  } else {
    console.log('  No rosters found in this date range');
    console.log('  Raw:', JSON.stringify(rosters).slice(0, 200));
  }
}
