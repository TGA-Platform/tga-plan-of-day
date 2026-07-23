const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';

async function main() {
  const query = `query { assets(ids: [2436282638]) { id name url } }`;
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
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
