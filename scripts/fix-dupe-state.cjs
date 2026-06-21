const fs = require('fs');
const filePath = require('path').join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// Remove the duplicate timeEditorStart/timeEditorEnd declarations added by the script
// (lines 222-223 are duplicates of 218-219, after the new lunch state lines)
const dupPattern = "  const [timeEditorLunchEnd, setTimeEditorLunchEnd] = useState('');\r\n  const [timeEditorStart, setTimeEditorStart] = useState('');\r\n  const [timeEditorEnd, setTimeEditorEnd] = useState('');";
const replacement = "  const [timeEditorLunchEnd, setTimeEditorLunchEnd] = useState('');";
if (c.includes(dupPattern)) {
  c = c.replace(dupPattern, replacement);
  console.log('✓ Removed duplicate timeEditorStart/End declarations');
} else {
  console.warn('Pattern not found, trying alternative...');
  // Try LF only
  const dupPatternLF = "  const [timeEditorLunchEnd, setTimeEditorLunchEnd] = useState('');\n  const [timeEditorStart, setTimeEditorStart] = useState('');\n  const [timeEditorEnd, setTimeEditorEnd] = useState('');";
  const replacementLF = "  const [timeEditorLunchEnd, setTimeEditorLunchEnd] = useState('');";
  if (c.includes(dupPatternLF)) {
    c = c.replace(dupPatternLF, replacementLF);
    console.log('✓ Removed duplicate (LF version)');
  } else {
    console.warn('✗ Could not find duplicate pattern');
  }
}

// Also fix the unused variable warnings by using them in the time editor modal open call
// Find where setTimeEditorModal is called and add the lunch state setters
const openModalMarker = 'setTimeEditorModal({ empId: s.employeeId, name: s.employeeName, rosterStart: formatRosterTime(s.startTime) || \'\', rosterEnd: formatRosterTime(s.endTime) || \'\' })';
const openModalReplacement = `{ const t = getStaffTime(s); setTimeEditorStart(t.start || formatRosterTime(s.startTime) || ''); setTimeEditorEnd(t.end || formatRosterTime(s.endTime) || ''); setTimeEditorLunchStart(t.lunchStart ?? ''); setTimeEditorLunchEnd(t.lunchEnd ?? ''); setTimeEditorModal({ empId: s.employeeId, name: s.employeeName, rosterStart: formatRosterTime(s.startTime) || '', rosterEnd: formatRosterTime(s.endTime) || '' }) }`;
if (c.includes(openModalMarker)) {
  c = c.replace(openModalMarker, openModalReplacement);
  console.log('✓ Time editor open now initialises lunch state');
} else console.warn('✗ setTimeEditorModal call not found');

fs.writeFileSync(filePath, c, 'utf8');

const verify = fs.readFileSync(filePath, 'utf8');
const lines = verify.split('\n');
let dupCount = 0;
lines.forEach((l, i) => {
  if (l.includes('timeEditorStart') && l.includes('useState')) dupCount++;
});
console.log('timeEditorStart useState count:', dupCount, '(should be 1)');
console.log('timeEditorLunchStart declared:', verify.includes('timeEditorLunchStart'));
