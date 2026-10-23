#!/usr/bin/env node
/**
 * `npm run play`: build the client, start the local server on 127.0.0.1:47600 and print the URL.
 *
 *   npm run play                  # build, start, print the URL
 *   npm run play -- --open        # ...and open it in the default browser
 *   npm run play -- --port 47601  # another port
 *   npm run play -- --no-build    # start with the existing build
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const open = args.includes('--open');
const skipBuild = args.includes('--no-build');
const serverArgs = args.filter((a) => a !== '--open' && a !== '--no-build');

if (!skipBuild) {
  console.log('Building the client...');
  const { build } = await import('vite');
  await build({ configFile: path.join(root, 'packages', 'client', 'vite.config.ts'), logLevel: 'warn' });
}

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
}

const tsxCli = require.resolve('tsx/cli');
const server = spawn(process.execPath, [tsxCli, path.join(root, 'packages', 'server', 'src', 'main.ts'), ...serverArgs], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'inherit'],
});
server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  const url = /running at (http:\/\/\S+)/.exec(chunk)?.[1];
  if (url) {
    console.log(`Open ${url} in your browser. Press Ctrl+C to stop.`);
    if (open) openBrowser(url);
  }
});
/**
 * Stop the server with its whole process tree: on Windows tsx runs the server in a child process of its own, and killing only tsx left the server
 * listening on its port (STATUS.md wave M8-W0 gap 5).
 */
function stopServer(sig) {
  if (server.exitCode !== null || server.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill(sig);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stopServer(sig));
process.on('exit', () => stopServer('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
