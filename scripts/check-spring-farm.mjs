const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const HOST = 'https://thegroveacademy.au.deputy.com';

// All Spring Farm unit IDs from config
const sfUnits = new Set([265, 266, 267, 269, 270, 278, 272, 273, 275, 263, 264, 277, 271, 311, 325, 338, 279]);

// Check what those units actually are
const unitRes = await fetch(HOST + '/api/v1/resource/OperationalUnit/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ max: 100, search: { s1: { field: 'Id', type: 'in', data: [...sfUnits] } } }),
});
const units = await unitRes.json();
console.log('Spring Farm units:');
if (Array.isArray(units)) {
  units.sort((a,b)=>a.Id-b.Id).forEach(u => console.log(`  ${String(u.Id).padEnd(5)} ${u.OperationalUnitName}`));
}

// Query all rosters for May 22 (Friday) and filter to Spring Farm units
const res = await fetch(HOST + '/api/v1/resource/Roster/QUERY', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + DEPUTY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ max: 500, start: 1, search: { s1: { field: 'Date', type: 'eq', data: '2026-05-22' } } }),
});
const all = await res.json();
const sfRosters = Array.isArray(all) ? all.filter(r => sfUnits.has(r.OperationalUnit)) : [];
console.log('\nSpring Farm rosters on 2026-05-22:', sfRosters.length);
sfRosters.forEach(r => {
  const name = r._DPMetaData?.EmployeeInfo?.DisplayName || 'Staff #' + r.Employee;
  const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || 'Unit ' + r.OperationalUnit;
  const start = new Date(r.StartTime * 1000).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',timeZone:'Australia/Sydney'});
  const end = new Date(r.EndTime * 1000).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',timeZone:'Australia/Sydney'});
  console.log(`  ${name.padEnd(30)} | ${unit.padEnd(25)} | ${start}-${end}`);
});

// Now check if there are any Spring Farm staff rostered in units NOT in our list
// Get all Spring Farm company first
const knownSfUnitInfo = Array.isArray(units) ? units : [];
const sfCompanyId = knownSfUnitInfo[0]?.Company;
console.log('\nSpring Farm company ID:', sfCompanyId);

// Find any rosters on May 22 from same company that we're NOT capturing
if (sfCompanyId) {
  const sfCompanyRosters = Array.isArray(all) ? all.filter(r => {
    const unitInfo = r._DPMetaData?.OperationalUnitInfo;
    return unitInfo?.Company === sfCompanyId && !sfUnits.has(r.OperationalUnit);
  }) : [];
  if (sfCompanyRosters.length > 0) {
    console.log('\n⚠️  Staff in Spring Farm company but NOT in our unit list:');
    sfCompanyRosters.forEach(r => {
      const name = r._DPMetaData?.EmployeeInfo?.DisplayName || 'Staff #' + r.Employee;
      const unit = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || 'Unit ' + r.OperationalUnit;
      console.log(`  [Unit ${r.OperationalUnit}] ${name} — ${unit}`);
    });
  } else {
    console.log('\nNo missing units found for Spring Farm company.');
  }
}
