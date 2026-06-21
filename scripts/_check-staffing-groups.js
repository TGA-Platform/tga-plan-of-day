// Check group structure on a few staffing boards to find internal casuals group
import https from 'https';

const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com', path: '/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: KEY, 'API-Version': '2024-01' },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const BOARDS = {
  'Mount Annan': '980348329',
  'Wollongong':  '983834623',
  'Bexley':      '983830380',
};

async function main() {
  for (const [name, id] of Object.entries(BOARDS)) {
    const r = await gql(`{ boards(ids: [${id}]) { groups { id title } } }`);
    const groups = r.data?.boards?.[0]?.groups ?? [];
    console.log(`\n${name} (${id}):`);
    groups.forEach(g => console.log(`  [${g.id}] ${g.title}`));
  }
}

main().catch(console.error);
