/** React binding for the settings (other packages read `useSettings().showScryfallImages` and friends; only the Settings screen writes them). */
import { useSyncExternalStore } from 'react';
import { settingsStore, type Settings, type SettingsStore } from './settings';

/** The current settings; re-renders when they change. `store` is for tests. */
export function useSettings(store: SettingsStore = settingsStore()): Settings {
  return useSyncExternalStore(store.subscribe, store.get);
}
