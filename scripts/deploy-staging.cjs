const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const memoryPath = path.resolve(__dirname, '../../../workspace-dev/MEMORY.md');
const content = fs.readFileSync(memoryPath, 'utf8');
const tokenMatch = content.match(/vcp_[A-Za-z0-9]+/);
const token = tokenMatch ? tokenMatch[0] : '';
if (!token) throw new Error('Vercel token not found in MEMORY.md');

const proc = spawn('npx', ['vercel', '--token', token], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', code => process.exit(code ?? 0));
