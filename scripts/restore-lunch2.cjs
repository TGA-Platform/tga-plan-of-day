const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// ── Fix getStaffTime return type ─────────────────────────────────────────────
const old_gst = 'function getStaffTime(s: RosteredStaff): { start: string; end: string } {\r\n    const override = sharedTimeOverrides[String(s.employeeId)];\r\n    if (override) return override;\r\n    return {\r\n      star';
const new_gst = 'function getStaffTime(s: RosteredStaff): { start: string; end: string; lunchStart?: string; lunchEnd?: string; source?: string } {\r\n    const override = sharedTimeOverrides[String(s.employeeId)];\r\n    if (override) return override;\r\n    return {\r\n      star';
if (c.includes(old_gst)) { c = c.replace(old_gst, new_gst); console.log('✓ getStaffTime return type updated'); }
else console.warn('✗ getStaffTime not found');

// ── Fix updateStaffTimeOverride signature ─────────────────────────────────────
const old_ust = 'function updateStaffTimeOverride(empId: number, start: string, end: string) {\r\n    const key = String(empId);\r\n    const applyOverride = (prev: RatioCheckSession): RatioCheckSession => ({\r\n      ...pr';
const new_ust = 'function updateStaffTimeOverride(empId: number, start: string, end: string, lunchStart?: string, lunchEnd?: string, isOvertime?: boolean, comment?: string) {\r\n    const key = String(empId);\r\n    const applyOverride = (prev: RatioCheckSession): RatioCheckSession => ({\r\n      ...pr';
if (c.includes(old_ust)) { c = c.replace(old_ust, new_ust); console.log('✓ updateStaffTimeOverride signature updated'); }
else console.warn('✗ updateStaffTimeOverride not found');

// Also update the body of applyOverride to include new fields
const old_body = "      staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: { start, end } },\r\n    });";
const new_body = "      staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: { start, end, lunchStart, lunchEnd, source: 'manual' as const, isOvertime, comment } },\r\n    });";
if (c.includes(old_body)) { c = c.replace(old_body, new_body); console.log('✓ applyOverride body updated'); }
else console.warn('✗ applyOverride body not found');

// ── Add Deputy timesheet polling after the load useEffect ────────────────────
// The first }, [centreId, date]); is the load effect
// Find it and insert after
const loadEffectEnd = '  }, [centreId, date]);\r\n\r\n  // -- Auto-save';
const timesheetEffect = `\r\n  // -- Deputy actual timesheets — poll every 5 min for real clock-in/out + meal breaks --
  const allUnitIds = useMemo(() => {
    const centre = CENTRES.find(c => c.id === centreId);
    if (!centre) return [];
    return [
      ...centre.rooms.map(r => r.deputyUnitId),
      ...(centre.floatUnitIds ?? []),
      ...(centre.issUnitIds ?? []),
    ].filter(Boolean) as number[];
  }, [centreId]);

  useEffect(() => {
    if (!date || allUnitIds.length === 0) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    const isToday = date === today;
    if (date > today) return;

    async function fetchActuals() {
      try {
        const r = await fetch(\`/api/deputy-timesheets-actual?unitIds=\${allUnitIds.join(',')}&date=\${date}\`);
        if (!r.ok) return;
        const actuals: Array<{
          employeeId: number; actualStart: string | null; actualEnd: string | null;
          isInProgress: boolean; isRealTime: boolean;
          breaks: Array<{ breakStart: string | null; breakEnd: string | null; type: string; status: string }>;
        }> = await r.json();

        for (const ts of actuals) {
          if (!ts.actualStart) continue;
          const key = String(ts.employeeId);
          const applyTS = (prev: RatioCheckSession): RatioCheckSession => {
            const existing = prev.staffTimeOverrides[key];
            if (existing?.source === 'manual') return prev;
            const mealBreak = ts.breaks?.find(b => b.type === 'meal' && (b.status === 'finished' || b.status === 'in_progress'));
            const lunchStart = mealBreak ? (mealBreak.breakStart ?? undefined) : undefined;
            const lunchEnd   = mealBreak?.status === 'finished' ? (mealBreak.breakEnd ?? undefined) : undefined;
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
      } catch { /* fail silently */ }
    }

    fetchActuals();
    if (!isToday) return;
    const interval = setInterval(fetchActuals, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [date, allUnitIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // -- End Deputy timesheet polling ------------------------------------------
`;
if (c.includes(loadEffectEnd)) {
  c = c.replace(loadEffectEnd, `  }, [centreId, date]);${timesheetEffect}\r\n  // -- Auto-save`);
  console.log('✓ Deputy timesheet polling added');
} else console.warn('✗ loadEffectEnd not found');

fs.writeFileSync(filePath, c, 'utf8');

const verify = fs.readFileSync(filePath, 'utf8');
console.log('\n=== Verification ===');
console.log('lunchStart in staffTimeOverrides:', verify.includes('lunchStart?:'));
console.log('deputy-timesheets-actual:', verify.includes('deputy-timesheets-actual'));
console.log('getStaffTime lunchStart return:', verify.includes('lunchStart?: string; lunchEnd?:'));
console.log('updateStaffTimeOverride lunchStart param:', verify.includes('lunchStart?: string, lunchEnd?:'));
console.log('lunchStart chips in lunch column:', verify.includes('on lunch break (actual)'));
console.log('File lines:', verify.split('\n').length);
