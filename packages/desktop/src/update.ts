/**
 * The update at launch (packages/desktop): before OpenMTG starts its server, electron-updater looks at the GitHub Releases of
 * richdubbs/DigiDice-OpenMTG for a newer version. When there is one, it downloads it (the waiting screen shows the progress) and installs it silently,
 * and the installer opens the new version by itself: no question, no installer pages. No network, no newer release, a check that takes too long, a
 * download that stops moving or a download that fails its signature check: OpenMTG starts as it is and tries again at the next launch.
 *
 * No Electron import here, so the tests drive it with a fake updater.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import type { AppUpdater, CancellationToken, Logger, ProgressInfo } from 'electron-updater';

export interface LaunchUpdateOptions {
  updater: AppUpdater;
  /** A new electron-updater CancellationToken (passed in: the class comes from electron-updater at run time). */
  newCancellationToken: () => CancellationToken;
  /** Shows a message on the waiting screen; `detail` is the smaller line under it. */
  show: (message: string, detail?: string) => void;
  /** How long the check may take before OpenMTG starts without it. */
  checkTimeoutMs?: number;
  /** How long the download may go without progress before OpenMTG gives up on it for this launch. */
  stallTimeoutMs?: number;
  /** How long the "Installing" message stays up before OpenMTG closes for the installer. */
  installPauseMs?: number;
}

/** `installing`: the installer is starting and OpenMTG is closing (start nothing). Otherwise OpenMTG starts as it is. */
export type LaunchUpdateOutcome = 'up-to-date' | 'skipped' | 'installing';

const CHECK_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 60_000;
const INSTALL_PAUSE_MS = 1_500;

const MB = 1024 * 1024;

/** "Downloading: 45% (58 of 128 MB)". */
export function progressLine(p: Pick<ProgressInfo, 'percent' | 'transferred' | 'total'>): string {
  return `Downloading: ${Math.floor(p.percent)}% (${Math.round(p.transferred / MB)} of ${Math.round(p.total / MB)} MB)`;
}

/**
 * The names an update's signature may carry (its certificate's subject name, CN), besides the one the build was signed under, which electron-builder
 * writes into the installed copy's app-update.yml (scripts/build-installer.mjs, SIGNING). The builds so far are signed under the owner's individual
 * identity; the next certificate is to be DigiDice LLC's organization identity. A copy accepts both, so the signer can change without stopping the
 * updates of the copies that have this version.
 */
export const UPDATE_PUBLISHERS: readonly string[] = ['DigiDice LLC'];

type VerifySignature = (publisherNames: string[], file: string) => Promise<string | null>;

/**
 * Makes `updater`'s signature check (electron-updater's Windows updater, `verifyUpdateCodeSignature`) accept `names` as well as the ones its
 * app-update.yml names. The check itself is electron-updater's own; only the list of accepted names grows. An updater without the check is left alone.
 */
export function acceptPublishers(updater: object, names: readonly string[] = UPDATE_PUBLISHERS): void {
  const u = updater as { verifyUpdateCodeSignature?: VerifySignature };
  const verify = u.verifyUpdateCodeSignature;
  if (typeof verify !== 'function') return;
  u.verifyUpdateCodeSignature = (given, file) => verify([...new Set([...given, ...names])], file);
}

/** electron-updater's logger writing to `file`, which holds the latest launch only: what to read when an update did not arrive. */
export function launchLog(file: string): Logger {
  try {
    writeFileSync(file, '');
  } catch {
    // no log rather than no game
  }
  const line = (level: string) => (message?: unknown) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${message instanceof Error ? (message.stack ?? message.message) : String(message)}\n`);
    } catch {
      // as above
    }
  };
  return { info: line('info'), warn: line('warn'), error: line('error') };
}

export async function updateAtLaunch(o: LaunchUpdateOptions): Promise<LaunchUpdateOutcome> {
  const { updater } = o;
  const log = (message: string) => updater.logger?.info(`[launch] ${message}`);
  updater.autoDownload = false;
  // An 'error' event with no listener would throw. Every failure also rejects the call that met it, which is handled below.
  updater.on('error', () => undefined);

  o.show('Checking for updates...');
  const checkMs = o.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    checkTimer = setTimeout(() => resolve('timeout'), checkMs);
  });
  const check = await Promise.race([updater.checkForUpdates().catch(() => null), timedOut]);
  clearTimeout(checkTimer);
  if (check === 'timeout') log(`no answer in ${checkMs / 1000} s: starting as it is`);
  if (check === 'timeout' || check === null) return 'skipped';
  if (!check.isUpdateAvailable) return 'up-to-date';

  const { version } = check.updateInfo;
  o.show(`Updating OpenMTG to ${version}...`, 'Starting the download');
  const token = o.newCancellationToken();
  const stallMs = o.stallTimeoutMs ?? STALL_TIMEOUT_MS;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let stalled: () => void = () => undefined;
  const stall = new Promise<never>((_, reject) => {
    stalled = () => {
      token.cancel();
      reject(new Error(`The download made no progress for ${stallMs / 1000} s`));
    };
  });
  stall.catch(() => undefined);
  const watch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(stalled, stallMs);
  };
  const onProgress = (p: ProgressInfo) => {
    watch();
    o.show(`Updating OpenMTG to ${version}...`, progressLine(p));
  };
  updater.on('download-progress', onProgress);
  watch();
  try {
    await Promise.race([updater.downloadUpdate(token), stall]);
  } catch (e) {
    log(`download of ${version} failed: ${e instanceof Error ? e.message : String(e)}; starting as it is`);
    return 'skipped';
  } finally {
    clearTimeout(stallTimer);
    updater.off('download-progress', onProgress);
  }

  o.show(`Installing OpenMTG ${version}...`, 'OpenMTG closes and opens again by itself in a few seconds.');
  await new Promise((resolve) => setTimeout(resolve, o.installPauseMs ?? INSTALL_PAUSE_MS));
  // quitAndInstall reports an installer that cannot start through 'error', before it returns; then OpenMTG starts as it is.
  let failed = false;
  const onInstallError = () => {
    failed = true;
  };
  updater.on('error', onInstallError);
  updater.quitAndInstall(true, true);
  updater.off('error', onInstallError);
  if (failed) log(`the installer for ${version} did not start; starting as it is`);
  return failed ? 'skipped' : 'installing';
}
