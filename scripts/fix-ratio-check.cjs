const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');
const originalLength = c.length;

let changes = 0;

// 1. Fix isRealTime guard → actualStart check
const old1 = `for (const ts of actuals) {\n          if (!ts.isRealTime) continue; // skip auto-generated entries\n          const key = String(ts.employeeId);`;
const new1 = `for (const ts of actuals) {\n          // Accept both real-time clock-ins AND manager-approved timesheets\n          if (!ts.actualStart) continue; // no actual times — skip\n          const key = String(ts.employeeId);`;
if (c.includes(old1)) { c = c.replace(old1, new1); changes++; console.log('✓ Fix 1: isRealTime guard removed'); }
else console.warn('✗ Fix 1 not found');

// 2. Replace past-dates guard
const old2 = `    // Only poll on today's date — no point fetching actuals for past/future\n    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());\n    if (date !== today) return;`;
const new2 = `    // Poll today every 5 min for live clock-ins; fetch once for past dates (approved timesheets)\n    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());\n    const isToday = date === today;\n    if (date > today) return; // future dates have no timesheets yet`;
if (c.includes(old2)) { c = c.replace(old2, new2); changes++; console.log('✓ Fix 2: past-dates guard updated'); }
else console.warn('✗ Fix 2 not found');

// 3. Update setInterval to be today-only
const old3 = `    fetchActuals(); // immediate first fetch\n    const interval = setInterval(fetchActuals, 5 * 60 * 1000); // then every 5 min\n    return () => clearInterval(interval);`;
const new3 = `    fetchActuals(); // immediate first fetch\n    if (!isToday) return; // past dates: single fetch only (approved timesheets don't change)\n    const interval = setInterval(fetchActuals, 5 * 60 * 1000); // today: poll every 5 min for live clock-ins\n    return () => clearInterval(interval);`;
if (c.includes(old3)) { c = c.replace(old3, new3); changes++; console.log('✓ Fix 3: setInterval today-only'); }
else console.warn('✗ Fix 3 not found');

// 4. Add sharedFamilyGroupings memo before sharedTimeOverrides
const insertBefore = `  // Time overrides are shared across all sessions — merge all three (any session's value wins)\n  const sharedTimeOverrides = useMemo(() => ({`;
const fgMemo = `  // Family groupings are shared across all sessions — merge by id so FGs created in any session are visible everywhere\n  const sharedFamilyGroupings = useMemo(() => {\n    const allById = new Map();\n    for (const d of [morningData, middayData, afternoonData]) {\n      for (const fg of (d.familyGroupings ?? [])) {\n        allById.set(fg.id, { ...(allById.get(fg.id) ?? {}), ...fg });\n      }\n    }\n    return [...allById.values()];\n  }, [morningData.familyGroupings, middayData.familyGroupings, afternoonData.familyGroupings]);\n\n  `;
if (c.includes(insertBefore)) { c = c.replace(insertBefore, fgMemo + insertBefore); changes++; console.log('✓ Fix 4: sharedFamilyGroupings memo added'); }
else console.warn('✗ Fix 4: insertBefore not found');

// 5. Replace addFamilyGrouping with cross-session version
const old5start = `  function addFamilyGrouping() {`;
const old5end = `    if (editingFgId === id) setEditingFgId(null);\n  }`;
// Find the block from addFamilyGrouping to end of deleteFG
const idx5start = c.indexOf(old5start);
const idx5end = c.indexOf(old5end, idx5start) + old5end.length;
if (idx5start >= 0 && idx5end > idx5start) {
  const block = c.substring(idx5start, idx5end);
  // Verify it contains the right functions
  if (block.includes('addFamilyGrouping') && block.includes('deleteFG')) {
    const newBlock = `  /** Write FG changes to ALL three sessions so groupings persist across morning/midday/afternoon */
  function syncFGToAllSessions(updater: (fgs: FamilyGroupingConfig[]) => FamilyGroupingConfig[]) {
    hasUserEdited.current = true;
    setMorningData(prev =>   { const next = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; save('morning',   next); return next; });
    setMiddayData(prev =>    { const next = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; save('midday',    next); return next; });
    setAfternoonData(prev => { const next = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; save('afternoon', next); return next; });
  }

  function addFamilyGrouping() {
    const idx = sharedFamilyGroupings.length % FG_COLOURS.length;
    const newFG: FamilyGroupingConfig = {
      id: Math.random().toString(36).slice(2, 9),
      label: \`FG \${sharedFamilyGroupings.length + 1}\`,
      roomIds: [],
      slots: [],
      color: FG_COLOURS[idx],
    };
    syncFGToAllSessions(fgs => [...fgs.filter(f => f.id !== newFG.id), newFG]);
    setEditingFgId(newFG.id);
  }

  function updateFG(id: string, patch: Partial<FamilyGroupingConfig>) {
    syncFGToAllSessions(fgs => fgs.map(fg => fg.id === id ? { ...fg, ...patch } : fg));
  }

  function deleteFG(id: string) {
    syncFGToAllSessions(fgs => fgs.filter(fg => fg.id !== id));
    if (editingFgId === id) setEditingFgId(null);
  }`;
    c = c.substring(0, idx5start) + newBlock + c.substring(idx5end);
    changes++; console.log('✓ Fix 5: FG helpers rewritten to cross-session');
  } else {
    console.warn('✗ Fix 5: block did not contain expected functions');
  }
} else {
  console.warn('✗ Fix 5: addFamilyGrouping block not found');
}

// 6. Replace sessionData.familyGroupings → sharedFamilyGroupings in JSX
const before6 = (c.match(/sessionData\.familyGroupings/g) || []).length;
c = c.replaceAll('sessionData.familyGroupings', 'sharedFamilyGroupings');
const after6 = (c.match(/sharedFamilyGroupings/g) || []).length;
console.log(`✓ Fix 6: replaced ${before6} sessionData.familyGroupings references`);
changes++;

// 7. Fix ZWJ family emoji → house emoji
const familyZWJ = '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67';
const houseEmoji = '\uD83C\uDFE0';
const zjwCount = (c.match(new RegExp(familyZWJ, 'g')) || []).length;
c = c.replaceAll(familyZWJ, houseEmoji);
console.log(`✓ Fix 7: replaced ${zjwCount} ZWJ family emojis with 🏠`);
if (zjwCount > 0) changes++;

fs.writeFileSync(filePath, c, 'utf8');

// Verify
const verify = fs.readFileSync(filePath, 'utf8');
console.log('\n--- Verification ---');
console.log('File length:', verify.length, '(was', originalLength, ')');
console.log('sharedFamilyGroupings count:', (verify.match(/sharedFamilyGroupings/g) || []).length);
console.log('syncFGToAllSessions present:', verify.includes('syncFGToAllSessions'));
console.log('isRealTime guard gone:', !verify.includes('if (!ts.isRealTime) continue'));
console.log('actualStart guard present:', verify.includes('if (!ts.actualStart) continue'));
console.log('isToday present:', verify.includes('const isToday'));
console.log('ZWJ emoji remaining:', (verify.match(/\uD83D\uDC68\u200D/g) || []).length);
console.log('House emoji count:', (verify.match(/\uD83C\uDFE0/g) || []).length);
console.log('\nTotal changes applied:', changes);
