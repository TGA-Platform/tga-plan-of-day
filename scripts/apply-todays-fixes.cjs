/**
 * Re-applies all today's fixes to the recovered RatioCheckPanel.tsx
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// ── Fix 1: syncFGToAllSessions (cross-session family groupings) ──────────────
if (!c.includes('syncFGToAllSessions')) {
  const addStart = '  function addFamilyGrouping() {';
  const idx1 = c.indexOf(addStart);
  const delEndCRLF = '    if (editingFgId === id) setEditingFgId(null);\r\n  }';
  let idx2 = c.indexOf(delEndCRLF, idx1);
  if (idx2 >= 0) {
    idx2 += delEndCRLF.length;
    const newBlock = `  /** Write FG changes to ALL three sessions so groupings persist across morning/midday/afternoon */\r\n  function syncFGToAllSessions(updater: (fgs: FamilyGroupingConfig[]) => FamilyGroupingConfig[]) {\r\n    hasUserEdited.current = true;\r\n    setMorningData(prev =>   { const next = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; save('morning',   next); return next; });\r\n    setMiddayData(prev =>    { const next = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; save('midday',    next); return next; });\r\n    setAfternoonData(prev => { const next = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; save('afternoon', next); return next; });\r\n  }\r\n\r\n  function addFamilyGrouping() {\r\n    const idx = sharedFamilyGroupings.length % FG_COLOURS.length;\r\n    const newFG: FamilyGroupingConfig = {\r\n      id: Math.random().toString(36).slice(2, 9),\r\n      label: \`FG \${sharedFamilyGroupings.length + 1}\`,\r\n      roomIds: [],\r\n      slots: [],\r\n      color: FG_COLOURS[idx],\r\n    };\r\n    syncFGToAllSessions(fgs => [...fgs.filter(f => f.id !== newFG.id), newFG]);\r\n    setEditingFgId(newFG.id);\r\n  }\r\n\r\n  function updateFG(id: string, patch: Partial<FamilyGroupingConfig>) {\r\n    syncFGToAllSessions(fgs => fgs.map(fg => fg.id === id ? { ...fg, ...patch } : fg));\r\n  }\r\n\r\n  function deleteFG(id: string) {\r\n    syncFGToAllSessions(fgs => fgs.filter(fg => fg.id !== id));\r\n    if (editingFgId === id) setEditingFgId(null);\r\n  }`;
    c = c.substring(0, idx1) + newBlock + c.substring(idx2);
    console.log('✓ Fix 1: syncFGToAllSessions added');
  } else console.warn('✗ Fix 1: deleteFG end not found');
} else console.log('  Fix 1: already present');

// ── Fix 2: sharedFamilyGroupings useMemo ─────────────────────────────────────
if (!c.includes('sharedFamilyGroupings = useMemo')) {
  const insertBefore = '  // Time overrides are shared across all sessions';
  if (c.includes(insertBefore)) {
    const fgMemo = `  // Family groupings shared across all sessions — merge by id\r\n  const sharedFamilyGroupings = useMemo(() => {\r\n    const allById = new Map<string, FamilyGroupingConfig>();\r\n    for (const d of [morningData, middayData, afternoonData]) {\r\n      for (const fg of (d.familyGroupings ?? [])) {\r\n        allById.set(fg.id, { ...(allById.get(fg.id) ?? {}), ...fg } as FamilyGroupingConfig);\r\n      }\r\n    }\r\n    return [...allById.values()];\r\n  }, [morningData.familyGroupings, middayData.familyGroupings, afternoonData.familyGroupings]);\r\n\r\n  `;
    c = c.replace(insertBefore, fgMemo + insertBefore);
    console.log('✓ Fix 2: sharedFamilyGroupings useMemo added');
  } else console.warn('✗ Fix 2: insertBefore not found');
} else console.log('  Fix 2: already present');

// ── Fix 3: Replace sessionData.familyGroupings → sharedFamilyGroupings ───────
const remaining = (c.match(/sessionData\.familyGroupings/g) || []).length;
if (remaining > 0) {
  c = c.replaceAll('sessionData.familyGroupings', 'sharedFamilyGroupings');
  console.log(`✓ Fix 3: replaced ${remaining} sessionData.familyGroupings refs`);
} else console.log('  Fix 3: no sessionData.familyGroupings remaining');

// ── Fix 4: Replace ZWJ family emoji with house emoji ─────────────────────────
const familyZWJ = '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67';
const zjwCount = (c.match(new RegExp(familyZWJ, 'g')) || []).length;
c = c.replaceAll(familyZWJ, '\uD83C\uDFE0');
console.log(`✓ Fix 4: replaced ${zjwCount} ZWJ family emojis`);

// ── Write ─────────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, c, 'utf8');

// ── Verify ────────────────────────────────────────────────────────────────────
const v = fs.readFileSync(filePath, 'utf8');
console.log('\n=== Verification ===');
console.log('syncFGToAllSessions:', v.includes('syncFGToAllSessions'));
console.log('sharedFamilyGroupings:', v.includes('sharedFamilyGroupings = useMemo'));
console.log('sessionData.familyGroupings remaining:', (v.match(/sessionData\.familyGroupings/g)||[]).length);
console.log('ZWJ emoji gone:', !v.includes('\uD83D\uDC68\u200D'));
console.log('isRealTime guard gone:', !v.includes('if (!ts.isRealTime) continue'));
console.log('isToday fix:', v.includes('const isToday'));
console.log('showFinishPanel:', v.includes('showFinishPanel'));
console.log('lunchStart:', v.includes('lunchStart'));
console.log('roomVisitors:', v.includes('roomVisitors'));
console.log('isOvertime:', v.includes('isOvertime'));
console.log('File lines:', v.split('\n').length);
