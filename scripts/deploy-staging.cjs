const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const memoryPath = path.resolve('C:/Users/ClaudeAI/.openclaw/workspace-dev/MEMORY.md');
console.log('Reading', memoryPath);
const memory = fs.readFileSync(memoryPath, 'utf8');
const lines = memory.split('\n').filter(l => l.includes('Vercel token:'));
let rawToken = lines.length ? lines[0].split('Vercel token:')[1].trim() : null;
const token = rawToken ? rawToken.replace(/^\*+\s*/, '').trim() : null;
console.log('Extracted token prefix:', token ? token.slice(0, 10) + '...' : null);

if (!token) {
  console.error('Vercel token not found in MEMORY.md');
  process.exit(1);
}

const cwd = path.resolve(__dirname, '..');
const output = execSync(`npx vercel --token ${token}`, { cwd, encoding: 'utf8', stdio: 'pipe' });
console.log(output);
