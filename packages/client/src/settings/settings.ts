/**
 * Player settings (docs/design/m8-client.md screen 9): Scryfall images opt-in (off by default, ARCHITECTURE.md "Card images" B), default stops,
 * full control, animation speed, sound (docs/design/sound.md), the default player names and (M12-4b) the multiplayer table's layout and camera. Kept in this browser's localStorage only; every read and write is wrapped in try/catch
 * (private windows, blocked storage, quota), and anything stored that is not understood falls back to the default for that field.
 */
import type { Step, StopSettings } from '@openmtg/engine';

/**
 * The engine's turn order (STEP_ORDER, CR 500.1) and its Arena-like default stops (DEFAULT_STOPS), repeated here so the page's first chunk (main.tsx reads
 * the settings) does not load the rules engine; test/c6-integration.test.tsx ("settings without the engine in the first chunk") checks that both equal
 * the engine's.
 */
export const ENGINE_STEP_ORDER: readonly Step[] = [
  'untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2', 'end', 'cleanup',
];
export const ENGINE_DEFAULT_STOPS: StopSettings = {
  ownTurn: ['main1', 'declareBlockers', 'main2'], opponentTurn: ['declareAttackers', 'declareBlockers', 'end'], fullControl: false,
};

export type AnimationSpeed = 'off' | 'fast' | 'normal' | 'slow';
export const ANIMATION_SPEEDS: readonly AnimationSpeed[] = ['off', 'fast', 'normal', 'slow'];
/**
 * M12-1 (docs/design/m12-multiplayer.md 4.6, 5.1-5.2): how a game with more than two players is drawn: the shared table with a camera that follows the mouse
 * (the default), every opponent across the top (today's arena board), or one focused opponent with the others as strips. Read by nothing
 * until M12-4a; a two-player game looks the same in every layout.
 */
export type TableLayout = 'shared' | 'acrossTop' | 'focused';
export const TABLE_LAYOUTS: readonly TableLayout[] = ['shared', 'acrossTop', 'focused'];

/** Sound effects (docs/design/sound.md): on or off, and four volumes from 0 to 1 (the master and one per sound category of audio/catalog.ts). */
export interface SoundSettings {
  enabled: boolean;
  master: number;
  interface: number;
  game: number;
  ambience: number;
}

export const DEFAULT_SOUND: SoundSettings = { enabled: true, master: 0.8, interface: 0.8, game: 1, ambience: 0.6 };

export interface Settings {
  /** "Show card images from Scryfall": the browser hot-links image URLs from the local index. Off by default. */
  showScryfallImages: boolean;
  /** Steps where a player stops (receives priority) with nothing obvious to do; the engine's Arena-like defaults (DEFAULT_STOPS) unless changed. */
  stops: { ownTurn: Step[]; opponentTurn: Step[] };
  /** Never auto-pass priority (CR 117: every priority is the player's to pass). */
  fullControl: boolean;
  animationSpeed: AnimationSpeed;
  sound: SoundSettings;
  /**
   * Default names of players 1 to 4 on the New game screen (M12-4b, m12 design 5.3 item 1: four seats; a two-player game uses the first two). Stored
   * settings from before milestone 12 hold two: the other two take their defaults.
   */
  playerNames: PlayerNames;
  /** M12-1: the table layout of a multiplayer game (TableLayout; read from M12-4a). */
  tableLayout: TableLayout;
  /**
   * M12-4b (m12 design 5.1 "Reduced motion"): the shared table's camera follows the mouse (on by default). Off: a static camera that frames the whole table,
   * zoom and pan by keys and buttons (GameBoardProps.cameraFollow).
   */
  cameraFollow: boolean;
}

/** M12-4b: the four default player names (Settings.playerNames). */
export type PlayerNames = [string, string, string, string];

export const SETTINGS_KEY = 'openmtg.settings.v1';
export const MAX_NAME_LENGTH = 24;

/**
 * Steps a stop can be set on. A player never receives priority in the untap step (CR 502.4) and normally not in the cleanup step (CR 514.3), so those
 * two are not offered.
 */
export const STOP_STEPS: readonly Step[] = ENGINE_STEP_ORDER.filter((s) => s !== 'untap' && s !== 'cleanup');

export const DEFAULT_SETTINGS: Settings = {
  showScryfallImages: false,
  stops: { ownTurn: [...ENGINE_DEFAULT_STOPS.ownTurn], opponentTurn: [...ENGINE_DEFAULT_STOPS.opponentTurn] },
  fullControl: false,
  animationSpeed: 'normal',
  sound: { ...DEFAULT_SOUND },
  playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  tableLayout: 'shared',
  cameraFollow: true,
};

/** Milliseconds of one board animation at a speed (the game screen publishes it as the CSS variable --anim-ms). */
export function animationMs(speed: AnimationSpeed): number {
  return { off: 0, fast: 120, normal: 250, slow: 500 }[speed];
}

function cleanSteps(v: unknown, fallback: Step[]): Step[] {
  if (!Array.isArray(v)) return [...fallback];
  // Keep the turn order and drop duplicates and unknown names.
  return STOP_STEPS.filter((s) => v.includes(s));
}

function cleanVolume(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function cleanSound(v: unknown): SoundSettings {
  const d = DEFAULT_SOUND;
  if (!v || typeof v !== 'object') return { ...d };
  const r = v as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    master: cleanVolume(r.master, d.master),
    interface: cleanVolume(r.interface, d.interface),
    game: cleanVolume(r.game, d.game),
    ambience: cleanVolume(r.ambience, d.ambience),
  };
}

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const name = v.trim().slice(0, MAX_NAME_LENGTH);
  return name === '' ? fallback : name;
}

/** Any stored value -> valid settings: each field that is missing or not understood takes its default. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return structuredClone(d);
  const r = raw as Record<string, unknown>;
  const stops = r.stops && typeof r.stops === 'object' ? (r.stops as Record<string, unknown>) : {};
  const names = Array.isArray(r.playerNames) ? r.playerNames : [];
  return {
    showScryfallImages: r.showScryfallImages === true,
    stops: { ownTurn: cleanSteps(stops.ownTurn, d.stops.ownTurn), opponentTurn: cleanSteps(stops.opponentTurn, d.stops.opponentTurn) },
    fullControl: r.fullControl === true,
    animationSpeed: ANIMATION_SPEEDS.includes(r.animationSpeed as AnimationSpeed) ? (r.animationSpeed as AnimationSpeed) : d.animationSpeed,
    sound: cleanSound(r.sound),
    playerNames: [cleanName(names[0], d.playerNames[0]), cleanName(names[1], d.playerNames[1]), cleanName(names[2], d.playerNames[2]), cleanName(names[3], d.playerNames[3])],
    tableLayout: TABLE_LAYOUTS.includes(r.tableLayout as TableLayout) ? (r.tableLayout as TableLayout) : d.tableLayout,
    cameraFollow: r.cameraFollow !== false,
  };
}

/** The engine's stop settings for a new game (PlayerConfig.stops). */
export function stopSettings(s: Settings): StopSettings {
  return { ownTurn: [...s.stops.ownTurn], opponentTurn: [...s.stops.opponentTurn], fullControl: s.fullControl };
}

/** The browser's localStorage, or null when it cannot be reached (private mode, sandboxing, no DOM). */
export function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The default stops before FAST2's MRE package added the declare-blockers step on both sides. Saved settings from that time hold exactly these, which
 * the player never chose; loading them upgrades to ENGINE_DEFAULT_STOPS (see upgradeStoredStops).
 */
export const PRE_MRE_DEFAULT_STOPS: { readonly ownTurn: readonly Step[]; readonly opponentTurn: readonly Step[] } = {
  ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'],
};

/**
 * Marker written next to the settings once they are stored with the current default stops in mind. Stored settings without it predate the upgrade, so
 * old default stops in them are upgraded; with it, the same stops are the player's own choice and are kept.
 */
export const STOPS_DEFAULTS_VERSION_KEY = 'stopsDefaultsVersion';
export const STOPS_DEFAULTS_VERSION = 2;

function sameSteps(v: unknown, expected: readonly Step[]): boolean {
  return Array.isArray(v) && v.length === expected.length && expected.every((s, i) => v[i] === s);
}

/**
 * Stored settings (parsed JSON) -> the same, with the stops upgraded to ENGINE_DEFAULT_STOPS when they are exactly the old defaults (PRE_MRE_DEFAULT_STOPS)
 * and were saved before this upgrade existed (no STOPS_DEFAULTS_VERSION_KEY). Customized stops, and stops saved after the upgrade, are left alone.
 */
export function upgradeStoredStops(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  if (r[STOPS_DEFAULTS_VERSION_KEY] === STOPS_DEFAULTS_VERSION) return raw;
  const stops = r.stops && typeof r.stops === 'object' ? (r.stops as Record<string, unknown>) : null;
  if (!stops || !sameSteps(stops.ownTurn, PRE_MRE_DEFAULT_STOPS.ownTurn) || !sameSteps(stops.opponentTurn, PRE_MRE_DEFAULT_STOPS.opponentTurn)) return raw;
  return { ...r, stops: { ...stops, ownTurn: [...ENGINE_DEFAULT_STOPS.ownTurn], opponentTurn: [...ENGINE_DEFAULT_STOPS.opponentTurn] } };
}

export function loadSettings(storage: Storage | null = browserStorage()): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return sanitizeSettings(upgradeStoredStops(text ? JSON.parse(text) : null));
  } catch {
    return sanitizeSettings(null);
  }
}

/** Returns false when the settings could not be stored (they still apply until the page is closed). */
export function saveSettings(s: Settings, storage: Storage | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, [STOPS_DEFAULTS_VERSION_KEY]: STOPS_DEFAULTS_VERSION }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The settings of this page, shared by every screen (useSyncExternalStore-shaped like GameConnection). `get()` returns the same object until an
 * update; `update` stores the new settings and tells the subscribers.
 */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<() => void>();
  /** False after a write failed: the screen says the settings last only until the page is closed. */
  persisted = true;

  constructor(private readonly storage: Storage | null = browserStorage()) {
    this.current = loadSettings(storage);
  }

  readonly get = (): Settings => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly update = (change: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void => {
    const patch = typeof change === 'function' ? change(this.current) : change;
    this.current = sanitizeSettings({ ...this.current, ...patch });
    this.persisted = saveSettings(this.current, this.storage);
    for (const l of [...this.listeners]) l();
  };

  readonly reset = (): void => this.update(structuredClone(DEFAULT_SETTINGS));
}

/** The page-wide store (created on first use, so tests can replace localStorage before it is read). */
let shared: SettingsStore | null = null;
export function settingsStore(): SettingsStore {
  shared ??= new SettingsStore();
  return shared;
}

/** Tests only: forget the page-wide store so the next `settingsStore()` reads storage again. */
export function resetSettingsStoreForTests(store: SettingsStore | null = null): void {
  shared = store;
}

/**
 * M8-W1 integration: the page-wide store as the source of C2's "Show card images from Scryfall" setting (images/settings.ts ScryfallSettingSource).
 * main.tsx connects it once, so the Images screen's switch, the cards and the Settings screen share one copy; without it the store's in-memory record
 * would overwrite a choice made on the Images screen at its next save.
 */
export function scryfallSettingSource(store: SettingsStore): { get(): boolean; set(on: boolean): void; subscribe(listener: () => void): () => void } {
  return {
    get: () => store.get().showScryfallImages,
    set: (on) => store.update({ showScryfallImages: on }),
    subscribe: store.subscribe,
  };
}
