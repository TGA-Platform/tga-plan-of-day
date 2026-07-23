const { execSync } = require('child_process');
const fs = require('fs');

const line = fs.readFileSync('C:\\Users\\ClaudeAI\\.openclaw\\workspace-dev\\MEMORY.md', 'utf8')
  .split('\n')
  .find(l => l.includes('Vercel token:'));
const m = line.match(/(vcp_[A-Za-z0-9]+)/);
const token = m ? m[1] : '';

execSync(`npx vercel --token ${token}`, { stdio: 'inherit' });
