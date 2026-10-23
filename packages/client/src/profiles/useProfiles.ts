/** React binding for the UI profiles (the Settings screen's Profiles section writes them; Home reads the look in use for its background scene). */
import { useSyncExternalStore } from 'react';
import { profilesStore, type ProfilesState, type ProfilesStore, type UiProfile } from './profiles';

/** The profiles; re-renders when they change. `store` is for tests. */
export function useProfiles(store: ProfilesStore = profilesStore()): ProfilesState {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** The profile in use. */
export function useActiveProfile(store: ProfilesStore = profilesStore()): UiProfile {
  useProfiles(store);
  return store.active();
}
