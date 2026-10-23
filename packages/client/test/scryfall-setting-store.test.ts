/**
 * M8-W1 integration: C2's Scryfall images setting connected to C7's page-wide settings store (main.tsx). Opt-in, off by default;
 * a choice made on the Images screen must survive the next save from the Settings screen.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { connectScryfallSetting, getShowScryfallImages, setShowScryfallImages } from '../src/images/settings';
import { scryfallSettingSource, SettingsStore, SETTINGS_KEY } from '../src/settings/settings';
import { memoryStorage } from './game-fixtures';

afterEach(() => connectScryfallSetting(null));

describe('Scryfall images setting backed by the settings store', () => {
  it('is off by default and a choice on the Images screen is kept when the Settings screen saves something else', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    connectScryfallSetting(scryfallSettingSource(store));
    expect(getShowScryfallImages()).toBe(false);

    setShowScryfallImages(true);
    expect(store.get().showScryfallImages).toBe(true);

    store.update({ fullControl: true });
    expect(getShowScryfallImages()).toBe(true);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toMatchObject({ showScryfallImages: true, fullControl: true });
  });

  it('a change on the Settings screen reaches the cards and tells their subscribers', () => {
    const store = new SettingsStore(memoryStorage());
    const source = scryfallSettingSource(store);
    connectScryfallSetting(source);
    let calls = 0;
    const off = source.subscribe(() => calls++);
    store.update({ showScryfallImages: true });
    expect(getShowScryfallImages()).toBe(true);
    expect(calls).toBe(1);
    off();
  });
});
