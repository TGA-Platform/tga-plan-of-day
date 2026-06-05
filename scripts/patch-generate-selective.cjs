/**
 * Make the Generate button only fetch data for the currently active report tab.
 * Adds activeReport to the useCallback deps, wraps each data-collection block
 * with the appropriate condition, and shows a "Generate" prompt on unloaded tabs.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');
let changed = 0;

function replace(oldStr, newStr, label) {
  if (!src.includes(oldStr)) { console.error(`NOT FOUND: ${label}`); return; }
  src = src.replace(oldStr, newStr);
  changed++;
  console.log(`✓ ${label}`);
}

// 1. Add report-type flags at the top of generate()
replace(
  `  const generate = useCallback(async () => {
    setLoading(true);
    setGenerated(false);
    const rows: typeof educatorRows = [];
    const snaps: RatioSnap[] = [];
    const groupingTrendRows: { date: string; campus: string; sessions: any[] }[] = [];
    const occRows: OccupancyRow[] = [];`,
  `  const generate = useCallback(async () => {
    setLoading(true);
    setGenerated(false);

    // Only fetch data relevant to the currently selected report tab
    const needsEducator  = ['educator','ratio','trends'].includes(activeReport);
    const needsOccupancy = activeReport === 'occupancy';
    const needsRosterOpt = activeReport === 'roster-opt';
    const needsWwccExpiry = activeReport === 'wwcc-expiry';
    const needsDateLoop  = needsEducator || needsOccupancy || needsRosterOpt;

    const rows: typeof educatorRows = [];
    const snaps: RatioSnap[] = [];
    const groupingTrendRows: { date: string; campus: string; sessions: any[] }[] = [];
    const occRows: OccupancyRow[] = [];`,
  'Add report-type flags'
);

// 2. Wrap occupancy block
replace(
  `        // ── Occupancy ────────────────────────────────────────────────────
        {`,
  `        // ── Occupancy ────────────────────────────────────────────────────
        if (needsOccupancy) {`,
  'Wrap occupancy block'
);

// 3. Wrap roster opt block
replace(
  `        // ── Roster Optimisation ──────────────────────────────────────────
        {`,
  `        // ── Roster Optimisation ──────────────────────────────────────────
        if (needsRosterOpt) {`,
  'Wrap roster opt block'
);

// 4. Wrap WWCC expiry block
replace(
  `    // ── WWCC Expiry — only active Deputy staff ──────────────────────────────
    {`,
  `    // ── WWCC Expiry — only active Deputy staff ──────────────────────────────
    if (needsWwccExpiry) {`,
  'Wrap WWCC expiry block'
);

// 5. Skip the date loop entirely when not needed
replace(
  `    for (const centre of selectedCentres) {
      const campus = centre.ownaName ?? centre.name;
      const allUnitIds = [`,
  `    if (needsDateLoop) for (const centre of selectedCentres) {
      const campus = centre.ownaName ?? centre.name;
      const allUnitIds = [`,
  'Wrap date loop'
);

// 6. Skip the per-date fetch for educator-only data when not needed
//    (wrap the expensive educator-report building in needsEducator check)
replace(
  `        groupingTrendRows.push({ date, campus, sessions: groupingSessionRows as any[] });`,
  `        if (needsEducator) groupingTrendRows.push({ date, campus, sessions: groupingSessionRows as any[] });`,
  'Wrap groupingTrendRows push'
);

// 7. Update useCallback dependency array to include activeReport
replace(
  `  }, [selectedCentres, fromDate, toDate]); // eslint-disable-line`,
  `  }, [selectedCentres, fromDate, toDate, activeReport]); // eslint-disable-line`,
  'Add activeReport to deps'
);

// 8. Update Generate button label to show which report will be generated
replace(
  `{loading ? '? Generating...' : '?? Generate Report'}`,
  `{loading ? '⏳ Generating...' : (() => {
                  const labels: Record<string,string> = {
                    educator: 'Educator Record',
                    ratio: 'Ratio Report',
                    trends: 'Trends',
                    occupancy: 'Attendance Trends',
                    'roster-opt': 'Roster Optimisation',
                    'wwcc-expiry': 'WWCC Expiries',
                  };
                  return \`📊 Generate \${labels[activeReport] ?? 'Report'}\`;
                })()}`,
  'Update generate button label'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log(`\nDone — ${changed} replacements.`);
