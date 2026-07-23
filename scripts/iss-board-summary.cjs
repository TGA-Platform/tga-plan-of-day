const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const BOARD_ID = 4684987653;
const OUT_DIR = path.join(__dirname, 'iss-files');

async function gqlRequest(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Monday API ${res.status}: ${await res.text()}`);
  return res.json();
}

function getCol(item, id) {
  const cv = item.column_values.find(c => c.id === id);
  return cv ? cv.text : null;
}

function parseFiles(item) {
  const cv = item.column_values.find(c => c.id === 'files');
  if (!cv || !cv.value) return [];
  let val;
  try { val = JSON.parse(cv.value); } catch { return []; }
  return (val.files || []).map(f => ({
    name: f.name,
    assetId: f.assetId,
    url: f.url,
  }));
}

async function downloadAsset(assetId, fileName) {
  const data = await gqlRequest(`query { assets(ids: [${assetId}]) { id name public_url file_extension } }`);
  const asset = data.data.assets[0];
  if (!asset || !asset.public_url) return null;
  const res = await fetch(asset.public_url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${assetId}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = asset.file_extension || path.extname(fileName) || '';
  const safeName = `${assetId}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  const outPath = path.join(OUT_DIR, safeName);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { path: outPath, ext: ext.toLowerCase(), size: buf.length };
}

async function extractText(fileInfo) {
  if (fileInfo.ext === '.pdf') {
    const data = await pdfParse(fs.readFileSync(fileInfo.path));
    return data.text;
  }
  if (fileInfo.ext === '.docx') {
    const result = await mammoth.extractRawText({ path: fileInfo.path });
    return result.value;
  }
  return null;
}

function extractFields(text) {
  if (!text) return {};
  const t = text.replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  const fields = {};

  const serviceMatch = t.match(/Service Name\s*([^C]*?(?:The Grove Academy\s*-\s*[^\s]+(?:\s+[^\s]+)?))/i);
  if (serviceMatch) fields.service = serviceMatch[1].trim();

  const envMatch = t.match(/Care Environment\s*([^\s][^A]*?)(?=\s+IS Case ID|Strategic Inclusion)/i);
  if (envMatch) fields.careEnvironment = envMatch[1].trim();

  const caseMatch = t.match(/IS Case ID\s*([0-9]-[A-Z0-9]+)/i);
  if (caseMatch) fields.caseId = caseMatch[1];

  const periodMatch = t.match(/Approval Period\s*(\d{2}\/\d{2}\/\d{4}\s*[-–]\s*\d{2}\/\d{2}\/\d{4})/i);
  if (periodMatch) fields.approvalPeriod = periodMatch[1];

  const weeklyMatch = t.match(/Maximum number of subsidised hours per week\s*0*([0-9]+(?::[0-9]{2})?)/i);
  if (weeklyMatch) {
    let h = weeklyMatch[1].replace(/:00$/, '');
    fields.weeklyHours = h;
  }

  const childSection = text.match(/Approved child\/ren[\s\S]{0,2000}(?=Acceptance of this approval)/i);
  if (childSection) {
    const childText = childSection[0];
    const children = [];
    const lines = childText.split(/\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/Approved child|following child|Application|Acceptance|Manager|business days|start date|Approval Period/i.test(line)) continue;
      if (/Page \d+ of \d+/i.test(line)) continue;
      if (/^•\s*/.test(line) || /^-?\s*[A-Z][a-z]+/.test(line)) {
        const name = line.replace(/^•\s*/, '').replace(/^-\s*/, '').trim();
        if (name && name.split(/\s+/).length >= 2 && /^[A-Za-z\s'\-]+$/.test(name)) {
          children.push(name);
        }
      }
    }
    if (children.length) fields.children = children;
  }

  return fields;
}

async function main() {
  const query = `query {
    boards(ids: [${BOARD_ID}]) {
      items_page(limit: 500) {
        items {
          id
          name
          column_values { id text value }
          subitems { id name column_values { id text value } }
        }
      }
    }
  }`;

  const boardData = await gqlRequest(query);
  const items = boardData.data.boards[0].items_page.items;

  const approvedItems = items.filter(item => getCol(item, 'color') === 'Done');
  console.log(`Total items: ${items.length}, Approved (Done): ${approvedItems.length}`);

  const summary = [];

  for (const item of approvedItems) {
    const childName = item.name;
    const room = getCol(item, 'dup__of_funding__1');
    const days = getCol(item, 'text__1');
    const startDate = getCol(item, 'dup__of_exp_date');
    const expDate = getCol(item, 'date_1');
    const approvedHours = getCol(item, 'text2__1');
    const caseId = getCol(item, 'text8__1');
    const educator = getCol(item, 'text1__1');
    const files = parseFiles(item);

    let docFields = {};
    if (files.length) {
      const file = files[0];
      try {
        const downloaded = await downloadAsset(file.assetId, file.name);
        if (downloaded) {
          const text = await extractText(downloaded);
          docFields = extractFields(text);
        }
      } catch (err) {
        console.error(`Error processing ${childName} (${caseId}): ${err.message}`);
      }
    }

    summary.push({
      childName,
      caseId,
      room,
      days,
      startDate,
      expDate,
      approvedHours,
      educator,
      files: files.map(f => f.name),
      ...docFields,
    });
  }

  console.log('\n=== Summary ===\n');
  for (const s of summary) {
    console.log(`Child: ${s.childName}`);
    console.log(`  Case ID: ${s.caseId || '-'}`);
    console.log(`  Centre: ${s.service || '(from board inference)'}`);
    console.log(`  Room: ${s.room || s.careEnvironment || '-'}`);
    console.log(`  Days: ${s.days || '-'}`);
    console.log(`  Period: ${s.approvalPeriod || `${s.startDate || '?'} → ${s.expDate || '?'}`}`);
    const hrs = s.weeklyHours || s.approvedHours || '-';
    console.log(`  Max hrs/week: ${hrs}${s.weeklyHours ? ' (from PDF)' : s.approvedHours ? ' (from board)' : ''}`);
    console.log(`  Children: ${s.children ? s.children.join(', ') : '-'}`);
    console.log(`  Educator: ${s.educator || '-'}`);
    console.log(`  File: ${s.files.join(', ') || '-'}`);
    console.log('');
  }

  fs.writeFileSync(path.join(__dirname, 'iss-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Wrote ${summary.length} records to scripts/iss-summary.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
