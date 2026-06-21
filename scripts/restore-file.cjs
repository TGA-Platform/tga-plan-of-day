const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx.recovered'));
const obj = JSON.parse(raw.toString('utf8'));
const content = Buffer.from(obj.data, 'base64').toString('utf8');

console.log('Decoded length:', content.length);
console.log('Lines:', content.split('\n').length);

const features = ['showFinishPanel','markedFinished','roomVisitors','visitorModal','isOvertime','lunchStart','touchSelected','hasUserEdited','attendanceRefreshing','deputy-timesheets-actual','familyGroupings'];
features.forEach(f => console.log(f.padEnd(30), content.includes(f) ? '✓' : '✗'));

// Write as the actual source file
const outPath = path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
fs.writeFileSync(outPath, content, 'utf8');
console.log('\nRestored to RatioCheckPanel.tsx');

// Clean up temp file
fs.unlinkSync(path.join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx.recovered'));
