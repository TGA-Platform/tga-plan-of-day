/**
 * Fix roster optimisation: replace direct Supabase roster cache fetch (fails due to RLS/anon key)
 * with the already-fetched `rosters` data from fetchRostersForDate which uses the service key.
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

// 1. Remove the rosterCacheDay fetch — we'll use the rosters variable instead
replace(
  `          fetch(\`\${SUPABASE_URL}/rest/v1/deputy_roster_cache?date=eq.\${date}&select=rosters\`,
            { headers: { apikey: ANON_KEY, Authorization: \`Bearer \${ANON_KEY}\` } }
          ).then(r => r.ok ? r.json() : []).catch(() => []),`,
  `          Promise.resolve([]), // rosterCacheDay removed — use rosters variable instead`,
  'Remove rosterCacheDay fetch'
);

// 2. Replace the dayRostersCache/campusRostersFiltered logic with rosters-based approach
replace(
  `          const dayRostersCache: any[] = (rosterCacheDay as any[])[0]?.rosters ?? [];
          const nonRatioIdsSet = new Set([...(centre.nonRatioUnitIds ?? []), ...(centre.leaveUnitIds ?? [])]);
          const centreUnitIdsSet = new Set([
            ...centre.rooms.map(rm => rm.deputyUnitId),
            ...(centre.floatUnitIds ?? []),
            ...(centre.issUnitIds ?? []),
          ]);
          const campusRostersFiltered = dayRostersCache.filter(r =>
            centreUnitIdsSet.has(r.OperationalUnit) && !nonRatioIdsSet.has(r.OperationalUnit)
          );`,
  `          // Use rosters already fetched via /api/deputy-rosters (service key, bypasses RLS).
          // Exclude non-ratio (directors, chefs, admin) and leave units.
          const nonRatioIdsSet = new Set([...(centre.nonRatioUnitIds ?? []), ...(centre.leaveUnitIds ?? [])]);
          // rosters is RosteredStaff[] with unitId, startTime, endTime (unix timestamps as strings)
          const campusRostersFiltered = (rosters as any[]).filter((r: any) =>
            !nonRatioIdsSet.has(r.unitId)
          );`,
  'Replace dayRostersCache with rosters'
);

// 3. Fix the staffOnShift time comparison to use the mapped RosteredStaff format
replace(
  `            // Deputy StartTime/EndTime are Unix timestamps (seconds) — convert to Sydney time
            const staffOnShift = campusRostersFiltered.filter(r => {
              const toM = (ts: number) => {
                const d = new Date(new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
                return d.getHours() * 60 + d.getMinutes();
              };
              const startM = toM(r.StartTime), endM = toM(r.EndTime);
              return startM <= slotMinutes && endM > slotMinutes;
            }).length;`,
  `            // RosteredStaff.startTime/endTime are unix timestamps stored as strings
            const staffOnShift = campusRostersFiltered.filter((r: any) => {
              const toM = (ts: string | number | null) => {
                if (!ts) return null;
                const n = typeof ts === 'string' ? parseInt(ts, 10) : ts;
                if (isNaN(n) || n <= 0) return null;
                const d = new Date(new Date(n * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
                return d.getHours() * 60 + d.getMinutes();
              };
              const startM = toM(r.startTime), endM = toM(r.endTime);
              if (startM === null || endM === null) return true; // include if no time data
              return startM <= slotMinutes && endM > slotMinutes;
            }).length;`,
  'Fix staffOnShift time comparison'
);

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log(`\nDone — ${changed} replacements.`);
