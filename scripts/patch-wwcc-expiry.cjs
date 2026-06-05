/**
 * Fix WWCC expiry: replace the broken Deputy-roster-cache cross-reference
 * (fails due to RLS/anon key) with a direct staff_wwcc table query filtered
 * by centre. The staffing board sync already excludes exited staff.
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

// Find the entire WWCC expiry block and replace it
const oldBlock = `        const todayNow = Date.now();
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

const newBlock = `        const todayNow = Date.now();
        // Fetch all WWCC records — staffing board sync already excludes exited staff.
        // Filter by selected centre(s) using the centre field stored during sync.
        const wwccAllResp = await fetch('/api/staff-wwcc');
        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];

        const centreNames = selectedCentres.map((c: any) =>
          (c.ownaName ?? c.name).toLowerCase()
        );
        const isAllCentres = selectedCentres.length >= allowed.length;

        for (const rec of wwccAll) {
          if (rec.under_18 || !rec.wwcc_number) continue;
          // Centre filter
          if (!isAllCentres) {
            const recCentre = (rec.centre ?? '').toLowerCase();
            const matches = centreNames.some(cn =>
              recCentre.includes(cn) || cn.includes(recCentre)
            );
            if (!matches) continue;
          }
          // Deduplicate by WWCC number per centre
          if (wwccExpRows.some(r => r.wwcc_number === rec.wwcc_number && r.centre === rec.centre)) continue;
          const expDate = rec.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
          wwccExpRows.push({
            full_name:     rec.full_name ?? '',
            centre:        rec.centre ?? '',
            wwcc_number:   rec.wwcc_number,
            wwcc_expiry:   rec.wwcc_expiry,
            under_18:      false,
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

replace(oldBlock, newBlock, 'WWCC expiry — use staff_wwcc directly');

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log(`\nDone — ${changed} replacements.`);
