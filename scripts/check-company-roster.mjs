const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// Try querying by date only (no unit filter) to get everything for May 22
// Then check which units 116/117 appear
const res = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max: 500, start: 1,
    search: {
      s1: { field: 'Date', type: 'eq', data: '2026-05-22' },
    },
  }),
});
const rosters = await res.json();
console.log('All rosters on 2026-05-22 (no unit filter):', Array.isArray(rosters) ? rosters.length : JSON.stringify(rosters).slice(0,200));

if (Array.isArray(rosters)) {
  // Filter to company 13 units
  const wollUnitIds = new Set([116,117,118,119,124,126,127,128,166,201,202,231,312,326,339,460]);
  const woll = rosters.filter(r => wollUnitIds.has(r.OperationalUnit));
  console.log('Wollongong rosters (filtered client-side):', woll.length);
  
  console.log('\nAll Wollongong staff:');
  woll.forEach(r => {
    const name = r._DPMetaData?.EmployeeInfo?.DisplayName || 'Staff #' + r.Employee;
    const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || 'Unit ' + r.OperationalUnit;
    const start = typeof r.StartTime === 'number' ? new Date(r.StartTime * 1000).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',timeZone:'Australia/Sydney'}) : r.StartTime;
    const end = typeof r.EndTime === 'number' ? new Date(r.EndTime * 1000).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',timeZone:'Australia/Sydney'}) : r.EndTime;
    console.log(`  ${name.padEnd(30)} | ${unit.padEnd(25)} | ${start}-${end}`);
  });
  
  // Also check for Sibel specifically
  const sibel = rosters.find(r => r._DPMetaData?.EmployeeInfo?.DisplayName?.includes('Sibel'));
  if (sibel) {
    console.log('\nSibel found in date-only query! Unit:', sibel.OperationalUnit);
  } else {
    console.log('\nSibel NOT found even in date-only query.');
    // Check raw total and pages
    console.log('Total across all centres:', rosters.length, '(may need to paginate)');
  }
}
