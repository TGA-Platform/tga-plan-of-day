const fs = require('fs');
const filePath = require('path').join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// 1. Add LunchAlert interface export before the Props interface
const propsMarker = 'interface Props {';
if (!c.includes('LunchAlert')) {
  const lunchAlertDef = `export interface LunchAlert {\r\n  employeeId: number;\r\n  employeeName: string;\r\n  scheduledLunch: string;\r\n  minutesOverdue: number;\r\n}\r\n\r\n`;
  c = c.replace(propsMarker, lunchAlertDef + propsMarker);
  console.log('✓ Added LunchAlert interface');
}

// 2. Add onLunchAlerts to Props interface
const propsBodyMarker = '  rosters: RosteredStaff[];\r\n}';
if (!c.includes('onLunchAlerts')) {
  c = c.replace(propsBodyMarker, '  rosters: RosteredStaff[];\r\n  onLunchAlerts?: (alerts: LunchAlert[]) => void;\r\n}');
  console.log('✓ Added onLunchAlerts to Props');
}

// 3. Fix sharedTimeOverrides indentation (extra spaces added by earlier edit)
c = c.replace(
  '    // Time overrides are shared across all sessions',
  '  // Time overrides are shared across all sessions'
);

// 4. Fix hasUserEdited.current reference in syncFGToAllSessions
// hasUserEdited is defined as a useRef inside the component - should be accessible
// Let's verify it's there and the reference is correct
if (c.includes('hasUserEdited.current = true') && !c.includes('const hasUserEdited')) {
  // hasUserEdited might be named differently - check
  console.log('hasUserEdited not found as const - removing from syncFGToAllSessions');
  c = c.replace('    hasUserEdited.current = true;\r\n', '');
}

fs.writeFileSync(filePath, c, 'utf8');
const verify = fs.readFileSync(filePath, 'utf8');
console.log('LunchAlert export:', verify.includes('export interface LunchAlert'));
console.log('onLunchAlerts prop:', verify.includes('onLunchAlerts'));
console.log('hasUserEdited defined:', verify.includes('const hasUserEdited') || verify.includes('hasUserEdited = useRef'));
console.log('hasUserEdited.current used:', verify.includes('hasUserEdited.current = true'));
