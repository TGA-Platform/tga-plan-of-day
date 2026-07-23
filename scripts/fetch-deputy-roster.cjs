const fs = require('fs');
const path = require('path');

const CENTRES = {
  'dapto-2': {
    rooms: [155,186,157,203,184,156],
    float: [206],
    iss: [227],
    nonRatio: [153,154,217,168,307,319,332,161],
  },
  'north-wollongong': {
    rooms: [283,284,285,286,327],
    float: [288],
    iss: [296],
    nonRatio: [],
  },
  'mount-annan': {
    rooms: [74,76,221,78,193],
    float: [222],
    iss: [225],
    nonRatio: [72,73,101,162,234,323,335,79],
  },
};

async function fetchRoster(centre, date) {
  const cfg = CENTRES[centre];
  const unitIds = [...cfg.rooms, ...cfg.float, ...cfg.iss, ...cfg.nonRatio];
  const res = await fetch('https://plan.tga.edu.au/api/deputy-rosters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, unitIds }),
  });
  if (!res.ok) throw new Error(`${centre}: ${res.status} ${await res.text()}`);
  return res.json();
}

function unitName(uId, cfg) {
  if (cfg.rooms.includes(uId)) return `room-${uId}`;
  if (cfg.float.includes(uId)) return 'float';
  if (cfg.iss.includes(uId)) return 'iss';
  if (cfg.nonRatio.includes(uId)) return 'nonRatio';
  return `other-${uId}`;
}

async function main() {
  const date = process.argv[2] || '2026-07-22';
  const centre = process.argv[3] || 'dapto-2';
  const roster = await fetchRoster(centre, date);
  const cfg = CENTRES[centre];

  // Group by employee
  const byEmp = {};
  for (const r of roster) {
    if (!byEmp[r.Employee]) byEmp[r.Employee] = [];
    byEmp[r.Employee].push(r);
  }

  // Find specific staff
  const search = process.argv[4];
  if (search) {
    const match = roster.filter(r => {
      const name = (r._DPMetaData?.EmployeeInfo?.DisplayName || '').toLowerCase();
      return name.includes(search.toLowerCase());
    });
    console.log(`Matches for "${search}" in ${centre}:`);
    for (const r of match) {
      console.log(`  Emp ${r.Employee} | ${r._DPMetaData?.EmployeeInfo?.DisplayName} | ${unitName(r.OperationalUnit, cfg)}(${r.OperationalUnit}) | ${r.StartTime}-${r.EndTime}`);
    }
    return;
  }

  console.log(`Total roster entries for ${centre}: ${roster.length}`);
  console.log(`Unique employees: ${Object.keys(byEmp).length}`);
  for (const [empId, entries] of Object.entries(byEmp)) {
    const name = entries[0]._DPMetaData?.EmployeeInfo?.DisplayName || `Emp ${empId}`;
    console.log(`\n${name} (Emp ${empId}):`);
    for (const e of entries.sort((a,b) => a.StartTime.localeCompare(b.StartTime))) {
      const uInfo = e._DPMetaData?.OperationalUnitInfo;
      console.log(`  ${unitName(e.OperationalUnit, cfg)}(${e.OperationalUnit}) ${e.StartTime}-${e.EndTime} ${uInfo?.OperationalUnitName || ''} ${e.isSplitShift ? '[SPLIT]' : ''}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
