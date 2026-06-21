const fs = require('fs');
const raw = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx.recovered'));
const text = raw.toString('utf8');
console.log('First 500 chars:', text.substring(0, 500));
// It's a JSON wrapper - try to parse and extract the data field
try {
  const obj = JSON.parse(text);
  console.log('JSON keys:', Object.keys(obj));
  if (obj.data) {
    // The data field might be base64 encoded content
    console.log('data type:', typeof obj.data);
    console.log('data first 200:', String(obj.data).substring(0, 200));
  }
} catch(e) {
  console.log('Not JSON:', e.message);
  console.log('Content type guess: raw text');
}
