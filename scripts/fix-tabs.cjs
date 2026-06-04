const fs = require('fs');
const file = 'src/pages/SettingsPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// Fix the corrupted tab label - replace any version of the broken ternary
c = c.replace(
  /\{tab === 'users' \? '[^']*' : '[^']*'\}/g,
  "{tab === 'users' ? 'Users' : tab === 'roles' ? 'Role Permissions' : 'Centre Rules'}"
);

fs.writeFileSync(file, c, 'utf8');

// Verify
const lines = c.split('\n');
const tabLine = lines.find(l => l.includes("tab === 'users'") && l.includes('Centre Rules'));
console.log('Fixed tab line:', tabLine ? tabLine.trim() : 'not found');
console.log('Has Role Permissions label:', c.includes('Role Permissions'));
