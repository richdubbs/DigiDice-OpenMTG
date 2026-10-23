/**
 * The "Show card images from Scryfall" setting (ARCHITECTURE.md "Card images" B): off by default; when on, the player's own browser hot-links the
 * image URLs of the local index.
 *
 * One source of truth: the page's settings record in localStorage, key `openmtg.settings.v1`, field `showScryfallImages` (the record the Settings
 * screen keeps; work package C7, settings/settings.ts), or, once the app connects it, the page-wide settings store itself (`connectScryfallSetting`).
 * Cards and the Images screen read and write the setting only through this module, so they and the Settings screen can never disagree.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** The page's settings record (shared with the Settings screen's store, C7 settings/settings.ts SETTINGS_KEY). */
export const SETTINGS_KEY = 'openmtg.settings.v1';
/** The field of that record. */
export const SHOW_SCRYFALL_FIELD = 'showScryfallImages';

/** Where the setting lives: the settings record by default, or the page-wide settings store (C7 SettingsStore) once connected. */
export interface ScryfallSettingSource {
  get(): boolean;
  set(on: boolean): void;
  subscribe(listener: () => void): () => void;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRecord(s: Storage): Record<string, unknown> | null {
  try {
    const text = s.getItem(SETTINGS_KEY);
    const v: unknown = text ? JSON.parse(text) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The settings record in localStorage: only `showScryfallImages` is written, every other field is kept as it is. */
function recordSource(): ScryfallSettingSource {
  const listeners = new Set<() => void>();
  // Storage blocked (private window, sandbox): the choice lasts until the page is closed.
  let memory = false;
  return {
    get: () => {
      const s = storage();
      if (!s) return memory;
      return readRecord(s)?.[SHOW_SCRYFALL_FIELD] === true;
    },
    set: (on) => {
      memory = on;
      try {
        const s = storage();
        if (s) s.setItem(SETTINGS_KEY, JSON.stringify({ ...(readRecord(s) ?? {}), [SHOW_SCRYFALL_FIELD]: on }));
      } catch {
        // Quota or blocked storage: `memory` still holds the choice for this page.
      }
      for (const l of [...listeners]) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => {
        if (e.key === SETTINGS_KEY || e.key === null) listener();
      };
      globalThis.addEventListener?.('storage', onStorage);
      return () => {
        listeners.delete(listener);
        globalThis.removeEventListener?.('storage', onStorage);
      };
    },
  };
}

const record = recordSource();
let source: ScryfallSettingSource = record;
const swaps = new Set<() => void>();

/**
 * Make the page-wide settings store the source of the setting (null: back to the settings record). The app calls this once at start-up when it has
 * that store; every card and switch follows it from then on.
 */
export function connectScryfallSetting(next: ScryfallSettingSource | null): void {
  source = next ?? record;
  for (const s of [...swaps]) s();
}

/** Off unless the player turned it on. */
export function getShowScryfallImages(): boolean {
  try {
    return source.get();
  } catch {
    return false;
  }
}

export function setShowScryfallImages(on: boolean): void {
  source.set(on);
}

function subscribe(listener: () => void): () => void {
  let off = source.subscribe(listener);
  const onSwap = () => {
    off();
    off = source.subscribe(listener);
    listener();
  };
  swaps.add(onSwap);
  return () => {
    off();
    swaps.delete(onSwap);
  };
}

/** The setting and its setter; every component using it re-renders when it changes (also from the Settings screen or another tab). */
export function useShowScryfallImages(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getShowScryfallImages, () => false);
  return [on, useCallback((v: boolean) => setShowScryfallImages(v), [])];
}
