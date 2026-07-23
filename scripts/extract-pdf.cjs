const pdfParse = require('pdf-parse');
const fs = require('fs');

async function main() {
  const data = await pdfParse(fs.readFileSync(process.argv[2]));
  console.log(data.text);
}

main().catch(e => { console.error(e); process.exit(1); });
