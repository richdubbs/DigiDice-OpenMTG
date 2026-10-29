import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppUpdater, CancellationToken } from 'electron-updater';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptPublishers,
  BACKGROUND_NOTE,
  launchLog,
  progressLine,
  requiredPublishers,
  UPDATE_PUBLISHERS,
  updateAtLaunch,
  type LaunchUpdateOptions,
} from '../src/update';

/** The parts of electron-updater's AppUpdater that updateAtLaunch uses. */
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  logger: { info(m: string): void; warn(m: string): void } | null = { info: (m: string) => this.logged.push(m), warn: (m: string) => this.logged.push(`warn ${m}`) };
  logged: string[] = [];
  installs: Array<[boolean, boolean]> = [];
  checks = 0;
  check: () => Promise<unknown> = async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.2.0' } });
  download: (token: FakeToken) => Promise<string[]> = async () => ['installer.exe'];
  installFails = false;
  /** electron-updater's Windows signature check and its lazy read of app-update.yml (a signed build names its publisher there). */
  verifyUpdateCodeSignature: unknown = async () => null;
  configOnDisk: { value: Promise<unknown> } | undefined = { value: Promise.resolve({ provider: 'github', publisherName: ['Example Signer'] }) };

  checkForUpdates() {
    this.checks++;
    return this.check();
  }
  downloadUpdate(token: FakeToken) {
    return this.download(token);
  }
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean) {
    this.installs.push([isSilent, isForceRunAfter]);
    if (this.installFails) this.emit('error', new Error('cannot start the installer'));
  }
}

class FakeToken {
  cancelled = false;
  cancel() {
    this.cancelled = true;
  }
}

const newer = { isUpdateAvailable: true, updateInfo: { version: '0.3.0' } };

function run(updater: FakeUpdater, extra: Partial<LaunchUpdateOptions> = {}) {
  const shown: string[] = [];
  const tokens: FakeToken[] = [];
  const outcome = updateAtLaunch({
    updater: updater as unknown as AppUpdater,
    newCancellationToken: () => {
      const t = new FakeToken();
      tokens.push(t);
      return t as unknown as CancellationToken;
    },
    show: (message, detail) => shown.push(detail ? `${message} | ${detail}` : message),
    checkTimeoutMs: 50,
    stallTimeoutMs: 50,
    downloadCapMs: 1_000,
    installPauseMs: 0,
    ...extra,
  });
  return { outcome, shown, tokens };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('updateAtLaunch', () => {
  it('starts as it is when the release on GitHub is not newer', async () => {
    const u = new FakeUpdater();
    const { outcome, shown } = run(u);
    expect(await outcome).toBe('up-to-date');
    expect(u.autoDownload).toBe(false);
    expect(u.installs).toEqual([]);
    expect(shown).toEqual(['Checking for updates...']);
  });

  it('downloads a newer version, then installs it silently and has the installer open the new version', async () => {
    const u = new FakeUpdater();
    u.check = async () => newer;
    u.download = async () => {
      u.emit('download-progress', { percent: 45.6, transferred: 58 * 1024 * 1024, total: 128 * 1024 * 1024, bytesPerSecond: 1, delta: 1 });
      return ['installer.exe'];
    };
    const { outcome, shown } = run(u);
    expect(await outcome).toBe('installing');
    expect(u.installs).toEqual([[true, true]]);
    expect(shown).toContain('Updating OpenMTG to 0.3.0... | Downloading: 45% (58 of 128 MB)');
    expect(shown.at(-1)).toMatch(/^Installing OpenMTG 0\.3\.0\.\.\./);
    expect(u.listenerCount('download-progress')).toBe(0);
  });

  it('starts as it is when the check fails (no network) or GitHub does not answer in time', async () => {
    const offline = new FakeUpdater();
    offline.check = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(await run(offline).outcome).toBe('skipped');

    const silent = new FakeUpdater();
    silent.check = () => new Promise(() => undefined);
    expect(await run(silent).outcome).toBe('skipped');
    expect(silent.logged.join('\n')).toMatch(/no answer/);

    // electron-updater answers null when the app is not packaged
    const dev = new FakeUpdater();
    dev.check = async () => null;
    expect(await run(dev).outcome).toBe('skipped');
  });

  it('starts as it is when the download fails, for example a signature that does not match', async () => {
    const u = new FakeUpdater();
    u.check = async () => newer;
    u.download = () => Promise.reject(new Error('New version 0.3.0 is not signed by the application owner'));
    expect(await run(u).outcome).toBe('skipped');
    expect(u.installs).toEqual([]);
    expect(u.logged.join('\n')).toMatch(/not signed/);
  });

  it('cancels a download that stops making progress and starts as it is', async () => {
    const u = new FakeUpdater();
    u.check = async () => newer;
    u.download = () => new Promise(() => undefined);
    const { outcome, tokens } = run(u);
    expect(await outcome).toBe('skipped');
    expect(tokens[0]?.cancelled).toBe(true);
    expect(u.installs).toEqual([]);
  });

  it('keeps a slow download going while it makes progress', async () => {
    const u = new FakeUpdater();
    u.check = async () => newer;
    u.download = async () => {
      // three times the stall timeout in all, with progress more often than the timeout
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 25));
        u.emit('download-progress', { percent: i * 16, transferred: i, total: 6, bytesPerSecond: 1, delta: 1 });
      }
      return ['installer.exe'];
    };
    const { outcome, tokens } = run(u);
    expect(await outcome).toBe('installing');
    expect(tokens[0]?.cancelled).toBe(false);
  });

  it('starts as it is when the installer cannot start', async () => {
    const u = new FakeUpdater();
    u.check = async () => newer;
    u.installFails = true;
    expect(await run(u).outcome).toBe('skipped');
  });

  it('gives up on the check after 10 s by default', async () => {
    vi.useFakeTimers();
    const u = new FakeUpdater();
    u.check = () => new Promise(() => undefined);
    let outcome: string | undefined;
    void run(u, { checkTimeoutMs: undefined }).outcome.then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('skipped');
    expect(u.logged.join('\n')).toMatch(/no answer in 10 s/);
  });

  it('after 3 minutes, starts OpenMTG and leaves the download to finish in the background and install when OpenMTG closes', async () => {
    vi.useFakeTimers();
    const u = new FakeUpdater();
    u.check = async () => newer;
    let finish: (files: string[]) => void = () => undefined;
    u.download = () => {
      // progress every 10 s (never stalls), never done by itself
      const ticker = setInterval(() => u.emit('download-progress', { percent: 1, transferred: 1, total: 100, bytesPerSecond: 1, delta: 1 }), 10_000);
      return new Promise((resolve) => {
        finish = (files) => {
          clearInterval(ticker);
          resolve(files);
        };
      });
    };
    const { outcome, shown, tokens } = run(u, { downloadCapMs: undefined, stallTimeoutMs: 60_000 });
    let result: string | undefined;
    void outcome.then((o) => (result = o));
    await vi.advanceTimersByTimeAsync(3 * 60_000 - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe('background');
    expect(tokens[0]?.cancelled).toBe(false); // the download goes on
    expect(u.autoInstallOnAppQuit).toBe(true); // electron-updater installs it when OpenMTG closes
    expect(u.installs).toEqual([]);
    expect(shown.at(-1)).toBe(BACKGROUND_NOTE);
    expect(BACKGROUND_NOTE).toBe('Update downloading, installs when you close OpenMTG');
    expect(u.listenerCount('download-progress')).toBe(0);
    // nothing cancels it later either (the stall watch has stopped)
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(tokens[0]?.cancelled).toBe(false);
    finish(['installer.exe']);
    await vi.advanceTimersByTimeAsync(0);
    expect(u.logged.join('\n')).toMatch(/finished in the background/);
  });

  it('installs nothing when app-update.yml names no publisher: such a copy would install an update without checking its signature', async () => {
    for (const setup of [
      (u: FakeUpdater) => (u.configOnDisk = { value: Promise.resolve({ provider: 'github' }) }), // an unsigned build
      (u: FakeUpdater) => (u.configOnDisk = { value: Promise.resolve({ provider: 'github', publisherName: [] }) }),
      (u: FakeUpdater) => (u.configOnDisk = { value: Promise.reject(Object.assign(new Error('no app-update.yml'), { code: 'ENOENT' })) }),
      (u: FakeUpdater) => (u.configOnDisk = undefined), // an electron-updater that reads it some other way
      (u: FakeUpdater) => (u.verifyUpdateCodeSignature = undefined), // an updater without the check
    ]) {
      const u = new FakeUpdater();
      u.check = async () => newer;
      setup(u);
      u.configOnDisk?.value.catch(() => undefined);
      expect(await run(u).outcome).toBe('skipped');
      expect(u.checks).toBe(0);
      expect(u.installs).toEqual([]);
      expect(u.logged.join('\n')).toMatch(/^warn .*no publisher name/m);
    }
  });
});

describe('requiredPublishers', () => {
  it('reads the publisher names of app-update.yml (one name or a list)', async () => {
    const u = new FakeUpdater();
    expect(await requiredPublishers(u)).toEqual(['Example Signer']);
    u.configOnDisk = { value: Promise.resolve({ publisherName: 'DigiDice LLC' }) };
    expect(await requiredPublishers(u)).toEqual(['DigiDice LLC']);
    u.configOnDisk = { value: Promise.resolve({ publisherName: '  ' }) };
    expect(await requiredPublishers(u)).toBeNull();
  });
});

describe('progressLine and launchLog', () => {
  it('rounds the percent down and the sizes to whole MB', () => {
    expect(progressLine({ percent: 99.9, transferred: 127.6 * 1024 * 1024, total: 128 * 1024 * 1024 })).toBe('Downloading: 99% (128 of 128 MB)');
  });

  it('keeps the latest launch only', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'openmtg-update-')), 'update.log');
    launchLog(file).info('first launch');
    const log = launchLog(file);
    log.info('Checking for update');
    log.error(new Error('boom'));
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/first launch/);
    expect(text).toMatch(/info Checking for update\n/);
    expect(text).toMatch(/error Error: boom/);
  });
});

describe('the names an update may be signed under', () => {
  it('accept DigiDice LLC besides the signer app-update.yml names (the build’s own); the check itself stays the updater one', async () => {
    expect(UPDATE_PUBLISHERS).toEqual(['DigiDice LLC']);
    const seen: string[][] = [];
    const updater = { verifyUpdateCodeSignature: async (names: string[], file: string) => (seen.push(names), file === 'good.exe' ? null : 'not signed') };
    acceptPublishers(updater);
    expect(await updater.verifyUpdateCodeSignature(['Current Signer'], 'good.exe')).toBeNull();
    expect(await updater.verifyUpdateCodeSignature(['Someone Else'], 'bad.exe')).toBe('not signed');
    expect(seen).toEqual([['Current Signer', 'DigiDice LLC'], ['Someone Else', 'DigiDice LLC']]);
  });

  it('an updater without a signature check is left alone', () => {
    const updater = {};
    acceptPublishers(updater);
    expect(updater).toEqual({});
  });
});
