const fs = require('fs');
const file = 'src/pages/RatioDashboardPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// 1. Add issUnitIds computation alongside floatUnitIds
c = c.replace(
  `  const floatUnitIds  = centre.floatUnitIds  ?? WOLLONGONG_FLOAT_UNIT_IDS;`,
  `  const floatUnitIds  = centre.floatUnitIds  ?? WOLLONGONG_FLOAT_UNIT_IDS;\n  const issUnitIds    = centre.issUnitIds    ?? [];`
);

// 2. Include issUnitIds in allUnitIds
c = c.replace(
  `  const allUnitIds    = [...roomUnitIds, ...floatUnitIds, ...leaveUnitIds, ...nonRatioUnitIds];`,
  `  const allUnitIds    = [...roomUnitIds, ...floatUnitIds, ...issUnitIds, ...leaveUnitIds, ...nonRatioUnitIds];`
);

// 3. Add issStaff state alongside supportStaff
c = c.replace(
  `  const [supportStaff, setSupportStaff] = useState<RosteredStaff[]>([]);`,
  `  const [supportStaff, setSupportStaff] = useState<RosteredStaff[]>([]);\n  const [issStaff, setIssStaff]           = useState<FloatStaff[]>([]);`
);

// 4. Parse ISS from rosters (after floatRosters)
c = c.replace(
  `      const leaveRosters:   RosteredStaff[] = rosters.filter(r => leaveSet.has(r.unitId));\n      const floatRosters:   FloatStaff[]    = rosters.filter(r => floatSet.has(r.unitId));\n      const supportRosters: RosteredStaff[] = rosters.filter(r => nonRatioSet.has(r.unitId));`,
  `      const issSet        = new Set(issUnitIds);\n      const leaveRosters:   RosteredStaff[] = rosters.filter(r => leaveSet.has(r.unitId));\n      const floatRosters:   FloatStaff[]    = rosters.filter(r => floatSet.has(r.unitId));\n      const issRosters:     FloatStaff[]    = rosters.filter(r => issSet.has(r.unitId));\n      const supportRosters: RosteredStaff[] = rosters.filter(r => nonRatioSet.has(r.unitId));`
);

// 5. Set issStaff state (after setFloats)
c = c.replace(
  `      setOnLeave(leaveRosters);\n      setFloats(floatRosters);\n      setSupportStaff(supportRosters);`,
  `      setOnLeave(leaveRosters);\n      setFloats(floatRosters);\n      setIssStaff(issRosters);\n      setSupportStaff(supportRosters);`
);

// 6. Add issStaff to staffOrigin tracking (after supportStaff.forEach)
c = c.replace(
  `    supportStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'support' }));`,
  `    supportStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'support' }));\n    issStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'iss' }));`
);

// 7. Add issStaff to useMemo dependency
c = c.replace(
  `  }, [roomStatuses, floats, supportStaff, staffMoves, children, showCurrentOnly, hasOverrides]);`,
  `  }, [roomStatuses, floats, issStaff, supportStaff, staffMoves, children, showCurrentOnly, hasOverrides]);`
);

// 8. Add effectiveIssStaff computed value (after effectiveSupportStaff)
const effectiveSupportBlock = `  const effectiveSupportStaff = useMemo((): RosteredStaff[] => {
    if (!hasOverrides) return supportStaff;
    return supportStaff.filter(s => !staffMoves[s.employeeId] || staffMoves[s.employeeId] === 'support');
  }, [supportStaff, staffMoves, hasOverrides]);`;

const issComputedBlock = `\n\n  // ISS staff not yet assigned to a room or float pool
  const effectiveIssStaff = useMemo((): FloatStaff[] => {
    return issStaff.filter(s => !staffMoves[s.employeeId] || staffMoves[s.employeeId] === 'iss');
  }, [issStaff, staffMoves]);

  // ISS staff moved to float pool (counted as floats)
  const issAsFloats = useMemo((): FloatStaff[] => {
    return issStaff.filter(s => staffMoves[s.employeeId] === 'float');
  }, [issStaff, staffMoves]);`;

c = c.replace(effectiveSupportBlock, effectiveSupportBlock + issComputedBlock);

// 9. Merge issAsFloats into effectiveFloats (floats passed to FloatPoolSection)
// Find the effectiveFloats computation and extend it
c = c.replace(
  `  const effectiveFloats = useMemo((): FloatStaff[] => {`,
  `  // effectiveFloats includes ISS staff manually moved to float pool\n  const effectiveFloats = useMemo((): FloatStaff[] => {`
);
// Find where effectiveFloats returns and add issAsFloats
c = c.replace(
  /const effectiveFloats = useMemo\(\(\): FloatStaff\[\] => \{([^}]+)\}, \[([^\]]+)\]\);/,
  (match, body, deps) => {
    // Append issAsFloats merge before return
    const newBody = body.replace(/return ([^;]+);(\s*)$/, 'return [...($1), ...issAsFloats];$2');
    const newDeps = deps.includes('issAsFloats') ? deps : deps.trimEnd() + ', issAsFloats';
    return `const effectiveFloats = useMemo((): FloatStaff[] => {${newBody}}, [${newDeps}]);`;
  }
);

fs.writeFileSync(file, c, 'utf8');
console.log('Done. Checks:');
console.log('  issUnitIds:', c.includes('issUnitIds    = centre.issUnitIds'));
console.log('  issStaff state:', c.includes('setIssStaff'));
console.log('  effectiveIssStaff:', c.includes('effectiveIssStaff'));
console.log('  issAsFloats:', c.includes('issAsFloats'));
