/**
 * RPL-4 (replays design 11; roadmap "In-game bug reports": "the app version (commit), browser, window size and settings; recent client errors"): the
 * page a bug report is made on. The app and its commit (engine-build.ts `APP`), the browser as it describes itself, the window and screen sizes, the
 * settings that change what the screen shows, as plain values, and the errors this page caught (errors.ts). Nothing personal: the player names of
 * Settings are left out (the game's names are in its replay), and so are the sound volumes.
 */
import type { BugReportFile } from '@openmtg/engine';
import { APP } from '../engine-build';
import type { Settings } from '../settings/settings';
import { recentErrors } from './errors';
import type { ReportEnvironment } from './report';

/** The browser as it describes itself, and the window and screen sizes ("window 1280x720, screen 1920x1080, 2x"). */
export function browserOf(win: Window): BugReportFile['browser'] {
  const nav = win.navigator;
  const out: BugReportFile['browser'] = { userAgent: (nav?.userAgent ?? '').slice(0, 1000) };
  const language = (nav?.language ?? '').slice(0, 64);
  if (language !== '') out.language = language;
  const size = (w: unknown, h: unknown) => `${Math.round(Number(w) || 0)}x${Math.round(Number(h) || 0)}`;
  const ratio = Number(win.devicePixelRatio) || 1;
  out.screen = `window ${size(win.innerWidth, win.innerHeight)}, screen ${size(win.screen?.width, win.screen?.height)}, ${Math.round(ratio * 100) / 100}x`.slice(0, 64);
  return out;
}

function prefersReducedMotion(win: Window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The settings that change what the screen shows or when the game stops, as plain values (design 11). */
export function reportSettings(s: Settings, win: Window): BugReportFile['settings'] {
  const root = win.document?.documentElement?.dataset;
  return {
    animationSpeed: s.animationSpeed,
    reducedMotion: prefersReducedMotion(win),
    tableLayout: s.tableLayout,
    cameraFollow: s.cameraFollow,
    showScryfallImages: s.showScryfallImages,
    sound: s.sound.enabled,
    fullControl: s.fullControl,
    ownTurnStops: s.stops.ownTurn.join(' '),
    opponentTurnStops: s.stops.opponentTurn.join(' '),
    // The look in use (profiles/profiles.ts applyLook): its template, motion and scene.
    look: root?.['ui'] ?? null,
    lookMotion: root?.['motion'] ?? null,
    lookScene: root?.['scene'] ?? null,
  };
}

/** The environment of a report made on this page now. */
export function pageEnvironment(settings: Settings, win: Window = window): ReportEnvironment {
  return { app: { ...APP }, browser: browserOf(win), settings: reportSettings(settings, win), errors: recentErrors() };
}
