#!/usr/bin/env node
/**
 * `npm run dev`: the local API server (restarts on change) plus the Vite dev server with hot reload. Vite serves the client on
 * http://127.0.0.1:5173 and proxies /api to the server on 127.0.0.1:47600, the online socket included; the server accepts that page's origin for the
 * online socket (--allow-origin, docs/design/online.md "Browser and local server").
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const server = spawn(process.execPath, [require.resolve('tsx/cli'), 'watch', path.join(root, 'packages', 'server', 'src', 'main.ts'), '--api-only', '--allow-origin', 'http://127.0.0.1:5173'], {
  cwd: root,
  stdio: 'inherit',
});

const { createServer } = await import('vite');
const vite = await createServer({ configFile: path.join(root, 'packages', 'client', 'vite.config.ts') });
await vite.listen();
vite.printUrls();
console.log('API server: http://127.0.0.1:47600 (proxied under /api). Press Ctrl+C to stop.');

/** The API server with its process tree (on Windows tsx watch runs it in a child process; killing only tsx leaves it listening). */
function stopServer() {
  if (server.exitCode !== null || server.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}

async function stop() {
  stopServer();
  await vite.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stopServer);
server.on('exit', (code) => {
  if (code) console.error(`The API server exited with code ${code}.`);
});
