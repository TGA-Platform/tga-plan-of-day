const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');

// Find the WWCC expiry block and replace it
const start = src.indexOf('    // ── WWCC Expiry ─────────────────────────────────────────────────────────────\n    if (needsWwccExpiry) {\n      let wwccExpRows');
const end = src.indexOf('      setWwccExpiryRows(wwccExpRows);\n    }', start) + '      setWwccExpiryRows(wwccExpRows);\n    }'.length;

if (start === -1 || end === -1) { console.error('NOT FOUND: WWCC expiry block'); process.exit(1); }

const newBlock = `    // ── WWCC Expiry — only staff active in Deputy for the selected period ─────────
    if (needsWwccExpiry) {
      let wwccExpRows: WwccExpiryRow[] = [];
      try {
        const todayNow = Date.now();

        // Get all unit IDs for selected centres (to filter Deputy roster entries)
        const allUnitIds = selectedCentres.flatMap((c: any) => [
          ...c.rooms.map((r: any) => r.deputyUnitId),
          ...(c.floatUnitIds ?? []),
          ...(c.issUnitIds ?? []),
          ...(c.nonRatioUnitIds ?? []),
          ...(c.leaveUnitIds ?? []),
        ]);

        // Use dates in selected range that are past; fall back to last 14 weekdays
        const lookback = dates.filter((d: string) => d <= todayStr()).slice(-14);
        const recentDates: string[] = lookback.length > 0 ? lookback : (() => {
          const out: string[] = [];
          for (let i = 14; i >= 1; i--) {
            const d = new Date(Date.now() - i * 86400000);
            if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d.toISOString().slice(0,10));
          }
          return out;
        })();

        // Fetch active Deputy staff via server-side endpoint (uses service key, bypasses RLS)
        const activeFrom = recentDates[0];
        const activeTo   = recentDates[recentDates.length - 1];
        const activeResp = await fetch(
          \`/api/active-staff?from=\${activeFrom}&to=\${activeTo}&unitIds=\${allUnitIds.join(',')}\`
        );
        const activeNames: string[] = activeResp.ok ? await activeResp.json() : [];

        if (activeNames.length === 0) {
          console.warn('WWCC expiry: no active staff found from Deputy roster — showing all for selected centres');
        }

        // Normalise function (same as wwccLookup)
        const normN = (n: string) => n
          .replace(/\\s*[\\(\\[{][^\\)\\]{}]*[\\)\\]{}]\\s*/g, ' ')
          .replace(/[-']/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();

        // Build a set of normalised active staff names
        const activeNormSet = new Set(activeNames.map(normN));

        // Fetch all WWCC records
        const wwccAllResp = await fetch('/api/staff-wwcc');
        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];
        const wwccByNorm: Record<string, any> = {};
        for (const rec of wwccAll) { wwccByNorm[rec.full_name_norm] = rec; }

        // For each active Deputy name, find their WWCC record
        for (const name of activeNames) {
          const nn = normN(name);
          let rec = wwccByNorm[nn];
          if (!rec) {
            // Try bare match (strip spaces)
            const bare = nn.replace(/\\s/g, '');
            rec = Object.values(wwccByNorm).find((r: any) =>
              (r as any).full_name_norm.replace(/\\s/g, '') === bare
            );
          }
          if (!rec || rec.under_18 || !rec.wwcc_number) continue;

          // Determine which centre this person belongs to from WWCC record
          const centre = rec.centre ?? '';

          // Deduplicate
          if (wwccExpRows.some(r => r.wwcc_number === rec.wwcc_number && r.centre === centre)) continue;

          const expDate = rec.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
          wwccExpRows.push({
            full_name:     rec.full_name ?? name,
            centre,
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
      } catch (e) { console.error('WWCC expiry', e); }
      setWwccExpiryRows(wwccExpRows);
    }`;

src = src.slice(0, start) + newBlock + src.slice(end);
console.log('✓ WWCC expiry block replaced with Deputy active-staff filter');

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('Done');
