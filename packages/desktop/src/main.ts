/**
 * The OpenMTG desktop app (Electron main process; built by scripts/build-installer.mjs into an NSIS installer). OpenMTG runs as its own program: the
 * local server (packages/server) runs inside this process and one app window shows the client it serves, with no console and no address bar.
 *
 * - Card data, the compiled cache and rules packs live in the user's profile, %APPDATA%\OpenMTG\data (the install folder is not writable). The first
 *   start downloads the card data from Scryfall, with a waiting screen; later starts take seconds. A launch whose card data is more than a day old
 *   refreshes it in the background (cardData.ts), so new cards show up without pressing Check for updates.
 * - Port 47600 when free, else any free port (the old OpenMTG.exe or another program may hold it). A second start of the app focuses the open window.
 * - Links to other sites open in the default browser, never inside the app. F11 toggles full screen.
 * - Updates at every launch (update.ts): a newer version on the GitHub Releases of richdubbs/DigiDice-OpenMTG is downloaded and installed before the game
 *   starts, and the new version opens by itself. Offline or no newer release: the app starts as it is. %APPDATA%\OpenMTG\update.log has the latest
 *   launch's check.
 */
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CardDatabase, defaultCacheDir } from '@openmtg/cards';
import { contextFrom, startServer, warmCardCache, type RunningServer, type ServerOptions } from '@openmtg/server';
import { cardDataStale, refreshCardData } from './cardData';
import { acceptPublishers, launchLog, updateAtLaunch } from './update';

declare const __OPENMTG_VERSION__: string;

const { autoUpdater, CancellationToken } = electronUpdater;
const DEFAULT_PORT = 47600;
const BACKGROUND = '#02050c';

if (!process.env.OPENMTG_CACHE_DIR?.trim()) process.env.OPENMTG_CACHE_DIR = path.join(app.getPath('userData'), 'data', 'scryfall');

let win: BrowserWindow | null = null;
let running: RunningServer | null = null;

/** The waiting screen shown before the server is up (a data: page, so it needs nothing from the server). */
function waitingPage(message: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>OpenMTG</title><style>
html,body{height:100%;margin:0;background:${BACKGROUND};color:#cfe9ff;font:16px 'Segoe UI',system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;text-align:center}
h1{margin:0 0 14px;font-size:30px;letter-spacing:.14em;color:#f2fbff;text-shadow:0 0 10px rgba(31,184,255,.9),0 0 28px rgba(31,184,255,.5)}
p{margin:6px 0;opacity:.85}#log{font-size:13px;opacity:.6;min-height:1.4em}</style></head>
<body><div><h1>OPENMTG</h1><p id="msg">${message}</p><p id="log"></p></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showLog(line: string): void {
  void win?.webContents.executeJavaScript(`document.getElementById('log') && (document.getElementById('log').textContent = ${JSON.stringify(line)})`).catch(() => undefined);
}

/** Changes the waiting screen's message (plain text) and the small line under it. */
function showMessage(message: string, detail = ''): void {
  void win?.webContents.executeJavaScript(`document.getElementById('msg') && (document.getElementById('msg').textContent = ${JSON.stringify(message)})`).catch(() => undefined);
  showLog(detail);
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: BACKGROUND,
    title: 'OpenMTG',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.once('ready-to-show', () => w.show());
  const isOurs = (url: string) => url.startsWith('data:') || (running !== null && url.startsWith(running.url));
  const openOutside = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  w.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (isOurs(url)) return;
    e.preventDefault();
    openOutside(url);
  });
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      w.setFullScreen(!w.isFullScreen());
      e.preventDefault();
    }
  });
  w.on('closed', () => {
    win = null;
  });
  return w;
}

async function startOpenMTG(): Promise<void> {
  Menu.setApplicationMenu(null);
  win = createWindow();
  await win.loadURL(waitingPage('Starting...'));

  if (app.isPackaged) {
    autoUpdater.logger = launchLog(path.join(app.getPath('userData'), 'update.log'));
    // an update signed under DigiDice LLC's certificate is accepted as well as one signed as before (update.ts UPDATE_PUBLISHERS)
    acceptPublishers(autoUpdater);
    const update = await updateAtLaunch({ updater: autoUpdater, newCancellationToken: () => new CancellationToken(), show: showMessage });
    // The installer is starting and this copy is closing.
    if (update === 'installing') return;
  }

  const cacheDir = defaultCacheDir();
  if (!existsSync(path.join(cacheDir, 'cards.jsonl'))) {
    await win.loadURL(waitingPage('Downloading the card data from Scryfall.<br>First start only: this takes a few minutes.'));
    mkdirSync(cacheDir, { recursive: true });
    const db = await CardDatabase.open({ allowEmpty: true, log: showLog });
    await db.refresh({ force: false, index: {} });
  }

  // The built client is next to the app: resources/client when installed, client/ in the build's staging folder otherwise.
  const clientDist = app.isPackaged ? path.join(process.resourcesPath, 'client') : path.join(app.getAppPath(), 'client');
  const opts: ServerOptions = { clientDist, version: __OPENMTG_VERSION__ };
  running = await startServer({ ...opts, port: DEFAULT_PORT }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') return startServer({ ...opts, port: 0 });
    throw e;
  });
  if (cardDataStale(cacheDir)) void refreshCardData(running.url);
  void warmCardCache(contextFrom(opts));
  if (win) await win.loadURL(running.url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => {
    void (running ? running.close() : Promise.resolve()).finally(() => app.quit());
  });
  app
    .whenReady()
    .then(startOpenMTG)
    .catch((e: unknown) => {
      const err = e as NodeJS.ErrnoException;
      dialog.showErrorBox('OpenMTG could not start', err?.message ?? String(e));
      app.quit();
    });
}
