const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');

// Normalise to LF for easier matching, we'll restore CRLF at the end
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');

let changed = 0;

function replace(oldStr, newStr, label) {
  if (!src.includes(oldStr)) { console.error(`NOT FOUND: ${label}`); return; }
  src = src.replace(oldStr, newStr);
  changed++;
  console.log(`✓ ${label}`);
}

// 1. Fix occupancy calculation
replace(
  `          const expected = (att as any[]).filter(r => r.predicted_sign_in).length;\n          const actual   = (att as any[]).filter(r => r.sign_in).length;\n          occRows.push({\n            date, campus,\n            expected, actual,\n            absent: Math.max(0, expected - actual),\n            attendanceRate: expected > 0 ? Math.round(actual / expected * 100) : 0,\n          });`,
  `          // All rows have sign_in (Owna only stores signed-in children).
          // Compare against same weekday last week as expected baseline.
          const actual = (att as any[]).length;
          const [yy, mo, dday] = date.split('-').map(Number);
          const priorDate = new Date(Date.UTC(yy, mo - 1, dday - 7)).toISOString().slice(0, 10);
          const priorAtt  = await fetchAttendance(campus, priorDate);
          const expected  = (priorAtt as any[]).length;
          occRows.push({
            date, campus,
            expected, actual,
            absent: Math.max(0, expected - actual),
            attendanceRate: expected > 0 ? Math.round(actual / expected * 100) : 100,
          });`,
  'Occupancy calculation'
);

// 2. Fix roster time comparison
replace(
  `            const childrenPresent = (att as any[]).filter(r => {\n              if (!r.sign_in) return false;\n              const siD = new Date(r.sign_in);\n              const siM = siD.getHours() * 60 + siD.getMinutes();\n              if (siM > slotMinutes) return false;\n              if (r.sign_out) {\n                const soD = new Date(r.sign_out);\n                if (soD.getHours() * 60 + soD.getMinutes() <= slotMinutes) return false;\n              }\n              if (r.predicted_sign_out) {\n                const psoD = new Date(r.predicted_sign_out);\n                if (psoD.getHours() * 60 + psoD.getMinutes() <= slotMinutes) return false;\n              }\n              return true;\n            }).length;\n            const staffOnShift = campusRostersFiltered.filter(r => {\n              const startLocal = new Date(new Date(r.StartTime * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));\n              const endLocal   = new Date(new Date(r.EndTime   * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));\n              const startM = startLocal.getHours() * 60 + startLocal.getMinutes();\n              const endM   = endLocal.getHours()   * 60 + endLocal.getMinutes();\n              return startM <= slotMinutes && endM > slotMinutes;\n            }).length;`,
  `            // sign_in/sign_out are HH:MM strings — use hhmm() helper
            const childrenPresent = (att as any[]).filter(r => {
              const siM = hhmm(r.sign_in);
              if (siM === null || siM > slotMinutes) return false;
              const soM  = hhmm(r.sign_out);
              if (soM !== null && soM <= slotMinutes) return false;
              const psoM = hhmm(r.predicted_sign_out);
              if (soM === null && psoM !== null && psoM <= slotMinutes) return false;
              return true;
            }).length;
            // Deputy StartTime/EndTime are Unix timestamps (seconds) — convert to Sydney time
            const staffOnShift = campusRostersFiltered.filter(r => {
              const toM = (ts: number) => {
                const d = new Date(new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
                return d.getHours() * 60 + d.getMinutes();
              };
              const startM = toM(r.StartTime), endM = toM(r.EndTime);
              return startM <= slotMinutes && endM > slotMinutes;
            }).length;`,
  'Roster time comparison'
);

// 3. Replace WWCC expiry section with Deputy-active-only version
const wwccOld = `        const wwccAllResp = await fetch('/api/staff-wwcc');
        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];
        const todayNow = Date.now();
        const allExpRows: WwccExpiryRow[] = wwccAll
          .filter((r: any) => !r.under_18) // under-18s don't need WWCC
          .map((r: any) => {
            const expDate = r.wwcc_expiry ? new Date(r.wwcc_expiry) : null;
            return {
              full_name:     r.full_name ?? '',
              centre:        r.centre ?? '',
              wwcc_number:   r.wwcc_number,
              wwcc_expiry:   r.wwcc_expiry,
              under_18:      r.under_18 ?? false,
              daysRemaining: expDate ? Math.ceil((expDate.getTime() - todayNow) / 86400000) : null,
            };
          });
        if (selectedCentres.length < allowed.length) {
          const centreNameSet = selectedCentres.map(c => c.name.toLowerCase());
          wwccExpRows = allExpRows.filter(r =>
            centreNameSet.some(n =>
              (r.centre ?? '').toLowerCase().includes(n) ||
              n.includes((r.centre ?? '').toLowerCase())
            )
          );
        } else {
          wwccExpRows = allExpRows;
        }
        wwccExpRows.sort((a, b) => {
          if (a.daysRemaining === null && b.daysRemaining === null) return 0;
          if (a.daysRemaining === null) return 1;
          if (b.daysRemaining === null) return -1;
          return a.daysRemaining - b.daysRemaining;
        });
      } catch { /* ignore */ }`;

const wwccNew = `        const todayNow = Date.now();
        // Only show staff active in Deputy — get unique names from roster cache
        const lookback = dates.filter((d: string) => d <= todayStr()).slice(-14);
        const recentDates: string[] = lookback.length > 0 ? lookback : (() => {
          const out: string[] = [];
          for (let i = 14; i >= 1; i--) {
            const d = new Date(Date.now() - i * 86400000);
            if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d.toISOString().slice(0,10));
          }
          return out;
        })();
        const unitIdSets = selectedCentres.map((c: any) => new Set([
          ...c.rooms.map((r: any) => r.deputyUnitId),
          ...(c.floatUnitIds ?? []), ...(c.issUnitIds ?? []),
          ...(c.nonRatioUnitIds ?? []), ...(c.leaveUnitIds ?? []),
        ]));
        const normN = (n: string) => n
          .replace(/\\s*[\\(\\[{][^\\)\\]{}]*[\\)\\]{}]\\s*/g, ' ')
          .replace(/[-']/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const activeCentreMap: Record<string, string> = {};
        await Promise.all(recentDates.map(async (d: string) => {
          const cr = await fetch(
            \`\${SUPABASE_URL}/rest/v1/deputy_roster_cache?date=eq.\${d}&select=rosters\`,
            { headers: { apikey: ANON_KEY, Authorization: \`Bearer \${ANON_KEY}\` } }
          ).then((res: Response) => res.ok ? res.json() : []).catch(() => []);
          const dayR: any[] = (cr as any[])[0]?.rosters ?? [];
          dayR.forEach((r: any) => {
            const emp = r._DPMetaData?.EmployeeInfo?.DisplayName;
            if (!emp) return;
            for (let ci = 0; ci < selectedCentres.length; ci++) {
              if ((unitIdSets[ci] as Set<number>).has(r.OperationalUnit)) {
                activeCentreMap[normN(emp)] = selectedCentres[ci].name;
                break;
              }
            }
          });
        }));
        const wwccAllResp = await fetch('/api/staff-wwcc');
        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];
        const wwccByNorm: Record<string, any> = {};
        for (const rec of wwccAll) { wwccByNorm[rec.full_name_norm] = rec; }
        for (const [nn, centre] of Object.entries(activeCentreMap)) {
          let rec = wwccByNorm[nn];
          if (!rec) {
            const bare = nn.replace(/\\s/g, '');
            rec = Object.values(wwccByNorm).find((r: any) => (r as any).full_name_norm.replace(/\\s/g,'') === bare);
          }
          if (!rec || rec.under_18 || !rec.wwcc_number) continue;
          if (wwccExpRows.some(r => r.wwcc_number === rec.wwcc_number && r.centre === centre)) continue;
          const expDate = rec.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
          wwccExpRows.push({
            full_name: rec.full_name ?? nn, centre,
            wwcc_number: rec.wwcc_number, wwcc_expiry: rec.wwcc_expiry,
            under_18: false,
            daysRemaining: expDate ? Math.ceil((expDate.getTime() - todayNow) / 86400000) : null,
          });
        }
        wwccExpRows.sort((a, b) => {
          if (a.daysRemaining === null && b.daysRemaining === null) return 0;
          if (a.daysRemaining === null) return 1;
          if (b.daysRemaining === null) return -1;
          return a.daysRemaining - b.daysRemaining;
        });
      } catch (e) { console.error('WWCC expiry', e); }`;

replace(wwccOld, wwccNew, 'WWCC expiry — Deputy-active filter');

// Restore CRLF if needed
if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log(`\nDone — ${changed} replacements made.`);
