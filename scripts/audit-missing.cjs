const fs = require('fs');
const path = require('path');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'assets', 'index-CiDB65s3.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx'), 'utf8');

// Features to audit - check bundle (what was deployed at ~12:45pm today before git restore)
// vs current source
const features = [
  // Core features
  { name: 'Deputy timesheet polling',        bundle: 'deputy-timesheets-actual',     source: 'deputy-timesheets-actual' },
  { name: 'Lunch break in column',           bundle: 'on lunch break',               source: 'on lunch break' },
  { name: 'Staff Finish Times panel',        bundle: 'showFinishPanel',              source: 'showFinishPanel' },
  { name: 'Marked finished (checkboxes)',    bundle: 'markedFinished',               source: 'markedFinished' },
  { name: 'Visitor logging',                 bundle: 'roomVisitors',                 source: 'roomVisitors' },
  { name: 'Visitor modal',                   bundle: 'visitorModal',                 source: 'visitorModal' },
  { name: 'OT icon / isOvertime',            bundle: 'isOvertime',                   source: 'isOvertime' },
  { name: 'Staff notes / comment',           bundle: 'comment',                      source: 'comment' },
  { name: 'Lunch Start in time editor',      bundle: 'Lunch Start',                  source: 'Lunch Start' },
  { name: 'lunchStart in overrides',         bundle: 'lunchStart',                   source: 'lunchStart' },
  { name: 'sharedFamilyGroupings',           bundle: 'sharedFamilyGroupings',        source: 'sharedFamilyGroupings' },
  { name: 'syncFGToAllSessions',             bundle: null,                           source: 'syncFGToAllSessions' },
  { name: 'Time editor modal (start/end)',   bundle: 'timeEditorModal',              source: 'timeEditorModal' },
  { name: 'Touch-move support',              bundle: 'touchSelected',                source: 'touchSelected' },
  { name: 'Auto-save hasUserEdited guard',   bundle: 'hasUserEdited',                source: 'hasUserEdited' },
  { name: 'Family groupings',               bundle: 'familyGroupings',              source: 'familyGroupings' },
  { name: 'Float schedule off-floor',        bundle: 'offFloorStaffBySlot',          source: 'offFloorStaffBySlot' },
  { name: 'attendanceRefreshing',            bundle: 'attendanceRefreshing',         source: 'attendanceRefreshing' },
];

console.log('Feature audit (bundle = pre-restore deploy, source = current file):\n');
console.log('Feature'.padEnd(40) + 'Bundle  Source');
console.log('-'.repeat(60));
features.forEach(f => {
  const inBundle = f.bundle ? bundle.includes(f.bundle) : null;
  const inSource = source.includes(f.source);
  const bStr = inBundle === null ? 'N/A    ' : (inBundle ? '✓      ' : '✗      ');
  const sStr = inSource ? '✓' : '✗';
  const flag = (inBundle === true && !inSource) ? ' ← MISSING FROM SOURCE' : '';
  console.log(f.name.padEnd(40) + bStr + sStr + flag);
});
