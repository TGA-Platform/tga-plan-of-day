// Check the Children tab in SharePoint for DOB data
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getGraphToken } = require('../../scripts/sharepoint-upload.js');
const ExcelJS = require('exceljs');
const path = require('path');
const os = require('os');

const SHARE_URL = 'https://thegroveacademy.sharepoint.com/:x:/s/Finance/IQAazquikS6qTodH2V3L5Dg5Aa9vFdN9s9ELH9_Pw5wR_A?e=fBtVYd';
const LOCAL = path.join(os.tmpdir(), 'children-check.xlsx');

const token = await getGraphToken();
console.log('Token OK');

// Resolve SharePoint item
const encUrl = Buffer.from(SHARE_URL).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const metaRes = await fetch(`https://graph.microsoft.com/v1.0/shares/u!${encUrl}/driveItem`, {
  headers: { Authorization: `Bearer ${token}` }
});
const meta = await metaRes.json();
console.log('File:', meta.name, 'size:', meta.size);

// Download
const dlRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${meta.parentReference.driveId}/items/${meta.id}/content`, {
  headers: { Authorization: `Bearer ${token}` }
});
const buf = Buffer.from(await dlRes.arrayBuffer());
const { writeFileSync } = await import('fs');
writeFileSync(LOCAL, buf);

// Read Children tab
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(LOCAL);
const ws = wb.getWorksheet('Children');
if (!ws) { console.log('No Children tab. Sheets:', wb.worksheets.map(s=>s.name)); process.exit(0); }

// Headers
const headers = [];
ws.getRow(1).eachCell(c => headers.push(c.value));
console.log('Headers:', headers);

// Count rows with DOB
let total = 0, withDob = 0;
ws.eachRow((row, i) => {
  if (i === 1) return;
  total++;
  const dob = row.getCell(headers.indexOf('DOB') + 1)?.value || row.getCell(headers.indexOf('dob') + 1)?.value;
  if (dob) withDob++;
});
console.log(`Total children: ${total}, with DOB: ${withDob}`);

// Sample 3 rows
let shown = 0;
ws.eachRow((row, i) => {
  if (i === 1 || shown >= 3) return;
  const vals = headers.map((h,j) => `${h}: ${row.getCell(j+1)?.value}`);
  console.log(' ', vals.join(' | '));
  shown++;
});
