const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// ── Fix 1: Add sharedFamilyGroupings useMemo ──────────────────────────────────
// Find the sharedTimeOverrides definition (which we know exists) and insert before it
const sharedTOMarker = '  // Time overrides are shared across all sessions';
if (!c.includes('sharedFamilyGroupings = useMemo') && c.includes(sharedTOMarker)) {
  const fgMemo = `  // Family groupings are shared across all sessions — merge by id so FGs created in any session are visible everywhere
  const sharedFamilyGroupings = useMemo(() => {
    const allById = new Map<string, FamilyGroupingConfig>();
    for (const d of [morningData, middayData, afternoonData]) {
      for (const fg of (d.familyGroupings ?? [])) {
        allById.set(fg.id, { ...(allById.get(fg.id) ?? {}), ...fg } as FamilyGroupingConfig);
      }
    }
    return [...allById.values()];
  }, [morningData.familyGroupings, middayData.familyGroupings, afternoonData.familyGroupings]);\n\n  `;
  c = c.replace(sharedTOMarker, fgMemo + sharedTOMarker);
  console.log('✓ Fix 1: sharedFamilyGroupings useMemo inserted');
} else if (c.includes('sharedFamilyGroupings = useMemo')) {
  console.log('  Fix 1: already present');
} else {
  console.warn('✗ Fix 1: sharedTimeOverrides marker not found');
}

// ── Fix 2: Rewrite addFamilyGrouping / updateFG / deleteFG ───────────────────
if (!c.includes('syncFGToAllSessions')) {
  // Find addFamilyGrouping block and replace through end of deleteFG
  const addStart = '  function addFamilyGrouping() {';
  const delEnd = "    if (editingFgId === id) setEditingFgId(null);\n  }";
  const idx1 = c.indexOf(addStart);
  // Find the LAST occurrence of delEnd after addStart (covers deleteFG closing brace)
  let idx2 = c.indexOf(delEnd, idx1);
  if (idx1 >= 0 && idx2 >= 0) {
    idx2 += delEnd.length;
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
    c = c.substring(0, idx1) + newBlock + c.substring(idx2);
    console.log('✓ Fix 2: FG helpers rewritten to cross-session');
  } else {
    console.warn('✗ Fix 2: addFamilyGrouping block not found (idx1=' + idx1 + ', idx2=' + idx2 + ')');
  }
} else {
  console.log('  Fix 2: syncFGToAllSessions already present');
}

// ── Fix 3: Replace sessionData.familyGroupings → sharedFamilyGroupings (catch any remaining) ───
const remaining = (c.match(/sessionData\.familyGroupings/g) || []).length;
if (remaining > 0) {
  c = c.replaceAll('sessionData.familyGroupings', 'sharedFamilyGroupings');
  console.log(`✓ Fix 3: replaced ${remaining} remaining sessionData.familyGroupings refs`);
} else {
  console.log('  Fix 3: no sessionData.familyGroupings remaining');
}

// ── Write ─────────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, c, 'utf8');

// ── Verify ────────────────────────────────────────────────────────────────────
const verify = fs.readFileSync(filePath, 'utf8');
console.log('\n--- Verification ---');
console.log('File length:', verify.length);
console.log('sharedFamilyGroupings useMemo:', verify.includes('sharedFamilyGroupings = useMemo'));
console.log('syncFGToAllSessions:', verify.includes('syncFGToAllSessions'));
console.log('sessionData.familyGroupings remaining:', (verify.match(/sessionData\.familyGroupings/g) || []).length);
console.log('ZWJ emoji gone:', !(verify.match(/\uD83D\uDC68\u200D/)));
