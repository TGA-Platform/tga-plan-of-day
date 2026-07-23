const fs = require('fs');
const path = require('path');
const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';

async function main() {
  const query = `query { assets(ids: [2436282638]) { id name public_url } }`;
  const gqlRes = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  const gqlData = await gqlRes.json();
  const url = gqlData.data.assets[0].public_url;
  const res = await fetch(url, { redirect: 'follow' });
  console.log('status', res.status, 'ct', res.headers.get('content-type'));
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('size', buf.length);
  fs.writeFileSync(path.join(__dirname, 'sample-approval.pdf'), buf);
}

main().catch(e => { console.error(e); process.exit(1); });
