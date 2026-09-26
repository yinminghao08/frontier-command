import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const compile = spawn(npm, ['exec', 'tsc', '--', '-p', 'tsconfig.electron.json'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
compile.on('exit', async (code) => {
  if (code) process.exit(code);
  const server = await createServer();
  await server.listen();
  const child = spawn(electron, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] },
  });
  child.on('exit', async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });
});
