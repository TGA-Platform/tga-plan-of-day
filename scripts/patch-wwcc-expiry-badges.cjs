const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'src', 'pages', 'ReportingPage.tsx');
let src = fs.readFileSync(file, 'utf8');
const hasCRLF = src.includes('\r\n');
if (hasCRLF) src = src.replace(/\r\n/g, '\n');

// 1. Add 'exemptReason' field to WwccExpiryRow interface
const ifaceOld = `interface WwccExpiryRow {\n  full_name:     string;\n  centre:        string;\n  wwcc_number:   string | null;\n  wwcc_expiry:   string | null;\n  under_18:      boolean;\n  daysRemaining: number | null;\n}`;
const ifaceNew = `interface WwccExpiryRow {\n  full_name:     string;\n  centre:        string;\n  wwcc_number:   string | null;\n  wwcc_expiry:   string | null;\n  under_18:      boolean;\n  daysRemaining: number | null;\n  exemptReason?: 'under_18' | 'kitchen'; // why they have no WWCC (exempt)\n}`;
if (src.includes(ifaceOld)) { src = src.replace(ifaceOld, ifaceNew); console.log('✓ WwccExpiryRow interface'); }
else console.error('NOT FOUND: WwccExpiryRow interface');

// 2. Update the activeNames processing to use {name, unitName} objects
const oldActiveNames = `        const activeNames: string[] = activeResp.ok ? await activeResp.json() : [];\n\n        if (activeNames.length === 0) {\n          console.warn('WWCC expiry: no active staff found from Deputy roster — showing all for selected centres');\n        }\n\n        // Normalise function (same as wwccLookup)\n        const normN = (n: string) => n\n          .replace(/\\s*[\\(\\[{][^\\)\\]{}]*[\\)\\]{}]\\s*/g, ' ')\n          .replace(/[-']/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();\n\n        // Fetch all WWCC records\n        const wwccAllResp = await fetch('/api/staff-wwcc');\n        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];\n        const wwccByNorm: Record<string, any> = {};\n        for (const rec of wwccAll) { wwccByNorm[rec.full_name_norm] = rec; }\n\n        // For each active Deputy name, find their WWCC record\n        for (const name of activeNames) {\n          const nn = normN(name);\n          let rec = wwccByNorm[nn];\n          if (!rec) {\n            // Try bare match (strip spaces)\n            const bare = nn.replace(/\\s/g, '');\n            rec = Object.values(wwccByNorm).find((r: any) =>\n              (r as any).full_name_norm.replace(/\\s/g, '') === bare\n            );\n          }\n          if (!rec || rec.under_18 || !rec.wwcc_number) continue;\n\n          // Determine which centre this person belongs to from WWCC record\n          const centre = rec.centre ?? '';\n\n          // Deduplicate\n          if (wwccExpRows.some(r => r.wwcc_number === rec.wwcc_number && r.centre === centre)) continue;\n\n          const expDate = rec.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;\n          wwccExpRows.push({\n            full_name:     rec.full_name ?? name,\n            centre,\n            wwcc_number:   rec.wwcc_number,\n            wwcc_expiry:   rec.wwcc_expiry,\n            under_18:      false,\n            daysRemaining: expDate ? Math.ceil((expDate.getTime() - todayNow) / 86400000) : null,\n          });\n        }`;

const newActiveNames = `        // activeStaff: [{ name, unitName }] — unitName lets us detect kitchen staff
        const activeStaff: { name: string; unitName: string }[] = activeResp.ok ? await activeResp.json() : [];

        if (activeStaff.length === 0) {
          console.warn('WWCC expiry: no active staff found from Deputy roster — showing all for selected centres');
        }

        const KITCHEN_KEYWORDS = ['chef','kitchen','cook'];
        const normN = (n: string) => n
          .replace(/\\s*[\\(\\[{][^\\)\\]{}]*[\\)\\]{}]\\s*/g, ' ')
          .replace(/[-']/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();

        const wwccAllResp = await fetch('/api/staff-wwcc');
        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];
        const wwccByNorm: Record<string, any> = {};
        for (const rec of wwccAll) { wwccByNorm[rec.full_name_norm] = rec; }

        for (const { name, unitName } of activeStaff) {
          const nn = normN(name);
          let rec = wwccByNorm[nn];
          if (!rec) {
            const bare = nn.replace(/\\s/g, '');
            rec = Object.values(wwccByNorm).find((r: any) =>
              (r as any).full_name_norm.replace(/\\s/g, '') === bare
            );
          }

          const centre = rec?.centre ?? '';
          const unitLower = unitName.toLowerCase();
          const isKitchen = KITCHEN_KEYWORDS.some(k => unitLower.includes(k));
          const isUnder18 = rec?.under_18 === true;

          // Determine exempt reason if no WWCC
          const hasWwcc = rec?.wwcc_number && !rec?.under_18;
          const exemptReason: 'under_18' | 'kitchen' | undefined =
            isUnder18 ? 'under_18' : isKitchen ? 'kitchen' : undefined;

          // Skip if no WWCC and not an exempt category
          if (!hasWwcc && !exemptReason) continue;

          // Deduplicate
          const dupKey = (rec?.wwcc_number ?? name) + '|' + centre;
          if (wwccExpRows.some(r => (r.wwcc_number ?? r.full_name) + '|' + r.centre === dupKey)) continue;

          const expDate = rec?.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
          wwccExpRows.push({
            full_name:     rec?.full_name ?? name,
            centre,
            wwcc_number:   hasWwcc ? rec.wwcc_number : null,
            wwcc_expiry:   hasWwcc ? rec.wwcc_expiry : null,
            under_18:      isUnder18,
            daysRemaining: expDate ? Math.ceil((expDate.getTime() - todayNow) / 86400000) : null,
            exemptReason,
          });
        }`;

if (src.includes(oldActiveNames)) { src = src.replace(oldActiveNames, newActiveNames); console.log('✓ activeNames processing'); }
else console.error('NOT FOUND: activeNames processing');

// 3. Update table headers to add Status column
const oldHeaders = `['Name','Centre','WWCC Number','Expiry Date','Days Remaining']`;
const newHeaders = `['Name','Centre','Status','WWCC Number','Expiry Date','Days Remaining']`;
if (src.includes(oldHeaders)) { src = src.replace(oldHeaders, newHeaders); console.log('✓ Table headers'); }
else console.error('NOT FOUND: Table headers');

// 4. Add Status cell before the WWCC number cell in the table row
// Find the WWCC expiry table row rendering and add a Status cell
const oldNameCell = `                            <td className="py-2 px-3 font-medium" style={{ color: '#050505' }}>{r.full_name}</td>\n                            <td className="py-2 px-3" style={{ color: '#596570' }}>{r.centre}</td>`;
const newNameCell = `                            <td className="py-2 px-3 font-medium" style={{ color: '#050505' }}>{r.full_name}</td>\n                            <td className="py-2 px-3" style={{ color: '#596570' }}>{r.centre}</td>\n                            <td className="py-2 px-3">\n                              {r.exemptReason === 'under_18' && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>Under 18</span>}\n                              {r.exemptReason === 'kitchen'  && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>Kitchen Staff</span>}\n                              {!r.exemptReason && <span className="text-xs" style={{ color: '#9ca3af' }}>—</span>}\n                            </td>`;
if (src.includes(oldNameCell)) { src = src.replace(oldNameCell, newNameCell); console.log('✓ Status cell added'); }
else console.error('NOT FOUND: name cell');

// 5. Update colSpan for the "no data" row
src = src.replace(
  /<td colSpan=\{5\}[^>]*>No WWCC expiry data/,
  match => match.replace('colSpan={5}', 'colSpan={6}')
);
console.log('✓ colSpan updated');

if (hasCRLF) src = src.replace(/\n/g, '\r\n');
fs.writeFileSync(file, src, 'utf8');
console.log('\nDone');
