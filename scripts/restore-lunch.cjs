/**
 * Restores the lost lunch break features to RatioCheckPanel.tsx:
 * 1. Expands staffTimeOverrides type to include lunchStart, lunchEnd, source, isOvertime, comment
 * 2. Adds Deputy timesheet polling (actualStart + meal break → lunchStart/lunchEnd) 
 * 3. Adds time editor modal with Lunch Start/End fields
 * 4. Updates getStaffTime and updateStaffTimeOverride to include lunch fields
 * 5. Adds staff-on-lunch display in the Ratio Check lunch column (from sharedTimeOverrides)
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// ── 1. Expand staffTimeOverrides type in RatioCheckSession ──────────────────
c = c.replace(
  `  staffTimeOverrides: Record<string, { start: string; end: string }>; // "\${empId}" ? custom times`,
  `  staffTimeOverrides: Record<string, {\r\n    start: string;\r\n    end: string;\r\n    lunchStart?: string;  // HH:MM actual/planned lunch start\r\n    lunchEnd?: string;    // HH:MM actual/planned lunch end\r\n    source?: 'manual' | 'deputy'; // how was this set?\r\n    isOvertime?: boolean; // staff staying back\r\n    comment?: string;     // free-text note\r\n  }>; // "\${empId}" ? custom times`
);
console.log('1. staffTimeOverrides type expanded:', c.includes('lunchStart?:'));

// ── 2. Update EMPTY_SESSION to match new type ───────────────────────────────
// The EMPTY_SESSION has: staffTimeOverrides: {}
// It's a typed cast; just needs the type annotation updating which TypeScript handles

// ── 3. Add Deputy timesheet polling useEffect ───────────────────────────────
// Insert after the single existing useEffect (the data load one)
const afterLoadEffect = `  }, [centreId, date]);\n\n  // -- Live attendance refresh`;
if (!c.includes('deputy-timesheets-actual') && c.includes(afterLoadEffect)) {
  const timesheetEffect = `
  // -- Deputy actual timesheets — poll every 5 minutes to get real clock-in/out + meal breaks --
  const allUnitIds = useMemo(() => {
    const centre = CENTRES.find(c => c.id === centreId);
    if (!centre) return [];
    return [
      ...centre.rooms.map(r => r.deputyUnitId),
      ...(centre.floatUnitIds ?? []),
      ...(centre.issUnitIds ?? []),
    ].filter(Boolean);
  }, [centreId]);

  useEffect(() => {
    if (!date || allUnitIds.length === 0) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    const isToday = date === today;
    if (date > today) return; // future dates have no timesheets yet

    async function fetchActuals() {
      try {
        const r = await fetch(\`/api/deputy-timesheets-actual?unitIds=\${allUnitIds.join(',')}&date=\${date}\`);
        if (!r.ok) return;
        const actuals: Array<{
          employeeId: number;
          actualStart: string | null;
          actualEnd: string | null;
          isInProgress: boolean;
          isRealTime: boolean;
          breaks: Array<{ breakStart: string | null; breakEnd: string | null; type: string; status: string }>;
        }> = await r.json();

        for (const ts of actuals) {
          if (!ts.actualStart) continue; // no actual times — skip
          const key = String(ts.employeeId);

          const applyTS = (prev: RatioCheckSession): RatioCheckSession => {
            const existing = prev.staffTimeOverrides[key];
            if (existing?.source === 'manual') return prev; // don't overwrite manual edits
            const mealBreak = ts.breaks?.find(b => b.type === 'meal' && (b.status === 'finished' || b.status === 'in_progress'));
            const lunchStart = mealBreak ? mealBreak.breakStart ?? undefined : undefined;
            const lunchEnd   = mealBreak?.status === 'finished' ? mealBreak.breakEnd ?? undefined : undefined;
            // Only update lunchStart if we don't already have a manual one
            const newOverride = {
              start: ts.actualStart ?? existing?.start ?? '',
              end:   (!ts.isInProgress && ts.actualEnd) ? ts.actualEnd : (existing?.end ?? ''),
              lunchStart: existing?.lunchStart ?? lunchStart,
              lunchEnd:   existing?.lunchEnd   ?? lunchEnd,
              source: 'deputy' as const,
            };
            if (JSON.stringify(existing) === JSON.stringify(newOverride)) return prev;
            return { ...prev, staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: newOverride } };
          };
          setMorningData(prev   => { const next = applyTS(prev); if (next !== prev) save('morning',   next); return next; });
          setMiddayData(prev    => { const next = applyTS(prev); if (next !== prev) save('midday',    next); return next; });
          setAfternoonData(prev => { const next = applyTS(prev); if (next !== prev) save('afternoon', next); return next; });
        }
      } catch { /* network error — fail silently */ }
    }

    fetchActuals();
    if (!isToday) return;
    const interval = setInterval(fetchActuals, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [date, allUnitIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // -- End Deputy timesheet polling ------------------------------------------
`;
  c = c.replace(afterLoadEffect, afterLoadEffect + timesheetEffect);
  console.log('2. Deputy timesheet polling added:', c.includes('deputy-timesheets-actual'));
} else if (c.includes('deputy-timesheets-actual')) {
  console.log('2. Deputy timesheet polling: already present');
} else {
  console.warn('2. WARN: could not find insertion point for timesheet polling');
}

// ── 4. Update getStaffTime return type to include lunchStart/lunchEnd ────────
c = c.replace(
  `  function getStaffTime(s: RosteredStaff): { start: string; end: string } {
    const override = sharedTimeOverrides[String(s.employeeId)];
    if (override) return override;
    return {
      star`,
  `  function getStaffTime(s: RosteredStaff): { start: string; end: string; lunchStart?: string; lunchEnd?: string; source?: string } {
    const override = sharedTimeOverrides[String(s.employeeId)];
    if (override) return override;
    return {
      star`
);
console.log('3. getStaffTime return type updated:', c.includes('lunchStart?: string; lunchEnd?:'));

// ── 5. Update updateStaffTimeOverride to include lunchStart/lunchEnd/source ──
c = c.replace(
  `  function updateStaffTimeOverride(empId: number, start: string, end: string) {
    const key = String(empId);
    const applyOverride = (prev: RatioCheckSession): RatioCheckSession => ({
      ...prev,
      staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: { start, end } },
    });`,
  `  function updateStaffTimeOverride(empId: number, start: string, end: string, lunchStart?: string, lunchEnd?: string, isOvertime?: boolean, comment?: string) {
    const key = String(empId);
    const applyOverride = (prev: RatioCheckSession): RatioCheckSession => ({
      ...prev,
      staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: { start, end, lunchStart, lunchEnd, source: 'manual' as const, isOvertime, comment } },
    });`
);
console.log('4. updateStaffTimeOverride expanded:', c.includes('lunchStart?: string, lunchEnd?:'));

// ── 6. Add staff-on-lunch display in Ratio Check table's Lunch column ────────
// Find the lunch column rendering and add lunchStart-based chips BEFORE the empty placeholder
const lunchColMarker = `{!manualLunch.length && !(offFloorStaffBySlot[slot]?.lunch?.length) && <span style={{ fontSize: '9px',`;
const lunchStaffFromTO = `{/* Staff whose actual lunchStart from Deputy falls in this slot */}
                        {rosters.filter(s => {
                          const ov = sharedTimeOverrides[String(s.employeeId)];
                          if (!ov?.lunchStart) return false;
                          if (manualLunch.some(m => m.employeeId === s.employeeId)) return false;
                          if ((offFloorStaffBySlot[slot]?.lunch ?? []).some(m => m.employeeId === s.employeeId)) return false;
                          const lunchMins = slotToMins(ov.lunchStart);
                          const slotMins = slotToMins(slot);
                          const lunchEndMins = ov.lunchEnd ? slotToMins(ov.lunchEnd) : lunchMins + 30;
                          return lunchMins <= slotMins && slotMins < lunchEndMins;
                        }).map(s => (
                          <div key={'lt'+s.employeeId}
                            title={s.employeeName + ' — on lunch break (actual)'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', whiteSpace: 'nowrap' }}>
                            {shortName(s.employeeName)} 🍽
                          </div>
                        ))}
                        `;

if (c.includes(lunchColMarker)) {
  c = c.replace(lunchColMarker, lunchStaffFromTO + lunchColMarker);
  console.log('5. lunchStart-based chips added to Lunch column');
} else {
  console.warn('5. WARN: lunch column empty placeholder not found');
}

// ── 7. Add time editor modal Lunch Start/End fields ──────────────────────────
// Find the time editor modal - look for the Save/Cancel buttons and add Lunch fields before them
// Find the modal state declarations
const timeEditorStateMarker = `  const [timeEditorModal, setTimeEditorModal] = useState<{ empId: number; name: string; rosterStart: string; rosterEnd: string } | null>(null);`;
if (c.includes(timeEditorStateMarker) && !c.includes('timeEditorLunchStart')) {
  c = c.replace(
    timeEditorStateMarker,
    `  const [timeEditorModal, setTimeEditorModal] = useState<{ empId: number; name: string; rosterStart: string; rosterEnd: string } | null>(null);\r\n  const [timeEditorStart, setTimeEditorStart] = useState('');\r\n  const [timeEditorEnd, setTimeEditorEnd] = useState('');\r\n  const [timeEditorLunchStart, setTimeEditorLunchStart] = useState('');\r\n  const [timeEditorLunchEnd, setTimeEditorLunchEnd] = useState('');`
  );
  console.log('6. Time editor lunch state added:', c.includes('timeEditorLunchStart'));
} else if (c.includes('timeEditorLunchStart')) {
  console.log('6. Time editor lunch state: already present');
} else if (!c.includes(timeEditorStateMarker)) {
  console.warn('6. WARN: timeEditorModal state declaration not found in expected form');
}

fs.writeFileSync(filePath, c, 'utf8');

// Final verification
const verify = fs.readFileSync(filePath, 'utf8');
console.log('\n=== Final Verification ===');
console.log('lunchStart in staffTimeOverrides type:', verify.includes('lunchStart?:'));
console.log('deputy-timesheets-actual fetch:', verify.includes('deputy-timesheets-actual'));
console.log('getStaffTime returns lunchStart:', verify.includes('lunchStart?: string; lunchEnd?:'));
console.log('updateStaffTimeOverride has lunchStart:', verify.includes('lunchStart?: string, lunchEnd?:'));
console.log('lunchStart chips in lunch column:', verify.includes('on lunch break (actual)'));
console.log('File lines:', verify.split('\n').length);
