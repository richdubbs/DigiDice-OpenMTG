/** Settings (docs/design/m8-client.md screen 9): defaults, localStorage persistence with try/catch, the Settings screen (its Sound section too). */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_STOPS } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../src/app/nav';
import { SOUND_IDS, soundMeta } from '../src/audio/catalog';
import { SoundEngine } from '../src/audio/engine';
import { recordSounds, resetSoundEngineForTests, soundEngine } from '../src/audio/sfx';
import {
  DEFAULT_SETTINGS, DEFAULT_SOUND, ENGINE_DEFAULT_STOPS, PRE_MRE_DEFAULT_STOPS, SETTINGS_KEY, SettingsStore, STOP_STEPS, STOPS_DEFAULTS_VERSION,
  STOPS_DEFAULTS_VERSION_KEY, animationMs, loadSettings, resetSettingsStoreForTests, sanitizeSettings, saveSettings, settingsStore, stopSettings,
  upgradeStoredStops,
} from '../src/settings/settings';
import { SettingsScreen } from '../src/settings/SettingsScreen';
import { AMBIENCE_TEST_MS, soundsByGroup } from '../src/settings/SoundSection';
import { memoryStorage } from './game-fixtures';

afterEach(() => {
  resetSoundEngineForTests();
  resetSettingsStoreForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function screenWith(store: SettingsStore) {
  return render(
    <NavProvider initial={{ screen: 'settings' }}>
      <SettingsScreen store={store} />
    </NavProvider>,
  );
}

const box = (name: string | RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('settings storage', () => {
  it('defaults: Scryfall images off, the engine default stops, no full control, normal speed', () => {
    const s = loadSettings(memoryStorage());
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.showScryfallImages).toBe(false);
    expect(stopSettings(s)).toEqual(DEFAULT_STOPS);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const s = { ...DEFAULT_SETTINGS, showScryfallImages: true, fullControl: true, animationSpeed: 'fast' as const, playerNames: ['Ann', 'Ben', 'Cat', 'Dan'] as [string, string, string, string] };
    expect(saveSettings(s, storage)).toBe(true);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('falls back to the defaults on broken JSON, blocked storage or no storage, without throwing', () => {
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStorage({}, true))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, memoryStorage({}, true))).toBe(false);
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false);
  });

  it('keeps what it understands field by field and drops the rest', () => {
    const s = sanitizeSettings({
      showScryfallImages: 'yes',
      fullControl: true,
      animationSpeed: 'warp',
      stops: { ownTurn: ['end', 'untap', 'nonsense', 'main1', 'end'], opponentTurn: 'all' },
      playerNames: ['  Ann  ', '', 'Extra', 7, 'Too many'],
    });
    expect(s.showScryfallImages).toBe(false);
    expect(s.fullControl).toBe(true);
    expect(s.animationSpeed).toBe('normal');
    // In turn order, without duplicates, unknown names, or the untap step (CR 502.4: no player receives priority there).
    expect(s.stops.ownTurn).toEqual(['main1', 'end']);
    expect(s.stops.opponentTurn).toEqual(DEFAULT_SETTINGS.stops.opponentTurn);
    expect(s.playerNames).toEqual(['Ann', 'Player 2', 'Extra', 'Player 4']); // M12-4b: four names
    expect(STOP_STEPS).not.toContain('cleanup'); // CR 514.3
  });

  it('sound: defaults on, volumes kept from 0 to 1 field by field, anything else falls back', () => {
    expect(DEFAULT_SETTINGS.sound).toEqual(DEFAULT_SOUND);
    expect(DEFAULT_SOUND.enabled).toBe(true);
    expect(sanitizeSettings({ sound: { enabled: false, master: 0.3, interface: 2, game: -1, ambience: 'loud' } }).sound).toEqual({
      enabled: false, master: 0.3, interface: 1, game: 0, ambience: DEFAULT_SOUND.ambience,
    });
    expect(sanitizeSettings({ sound: { enabled: 'no', master: Number.NaN } }).sound).toEqual(DEFAULT_SOUND);
    expect(sanitizeSettings({ sound: 'off' }).sound).toEqual(DEFAULT_SOUND);
    expect(sanitizeSettings({}).sound).toEqual(DEFAULT_SOUND);
    // Settings stored before sound existed get the default sound.
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ animationSpeed: 'fast' }) })).sound).toEqual(DEFAULT_SOUND);
  });

  it('sound round-trips through storage', () => {
    const storage = memoryStorage();
    const sound = { enabled: false, master: 0.25, interface: 0.5, game: 0.75, ambience: 0 };
    expect(saveSettings({ ...DEFAULT_SETTINGS, sound }, storage)).toBe(true);
    expect(loadSettings(storage).sound).toEqual(sound);
  });

  it('the page engine re-reads the volumes whenever the page-wide settings change', () => {
    resetSettingsStoreForTests(new SettingsStore(memoryStorage()));
    resetSoundEngineForTests();
    const apply = vi.spyOn(SoundEngine.prototype, 'applySettings');
    soundEngine();
    settingsStore().update((s) => ({ sound: { ...s.sound, master: 0.2 } }));
    expect(apply).toHaveBeenCalledTimes(1);
    resetSoundEngineForTests();
    // A forgotten engine no longer listens.
    settingsStore().update((s) => ({ sound: { ...s.sound, master: 0.3 } }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('the store notifies subscribers and remembers when storage failed', () => {
    const store = new SettingsStore(memoryStorage({}, true));
    let calls = 0;
    store.subscribe(() => calls++);
    const before = store.get();
    store.update({ animationSpeed: 'off' });
    expect(calls).toBe(1);
    expect(store.get()).not.toBe(before);
    expect(store.get().animationSpeed).toBe('off');
    expect(store.persisted).toBe(false);
    expect(animationMs('off')).toBe(0);
  });
});

describe('CL4: saved stops from before the declare-blockers default stops (FAST2 MRE)', () => {
  const oldSaved = (extra: Record<string, unknown> = {}) => memoryStorage({
    [SETTINGS_KEY]: JSON.stringify({
      showScryfallImages: true, fullControl: false, animationSpeed: 'fast', playerNames: ['Ann', 'Ben'],
      stops: { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] }, ...extra,
    }),
  });

  it('stops equal to exactly the old defaults are upgraded to the current defaults; the other fields are kept', () => {
    expect(PRE_MRE_DEFAULT_STOPS).toEqual({ ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] });
    const s = loadSettings(oldSaved());
    expect(s.stops).toEqual({ ownTurn: [...ENGINE_DEFAULT_STOPS.ownTurn], opponentTurn: [...ENGINE_DEFAULT_STOPS.opponentTurn] });
    expect(stopSettings(s)).toEqual(DEFAULT_STOPS);
    expect(s.stops.ownTurn).toContain('declareBlockers');
    expect(s.stops.opponentTurn).toContain('declareBlockers');
    expect(s).toMatchObject({ showScryfallImages: true, animationSpeed: 'fast', playerNames: ['Ann', 'Ben', 'Player 3', 'Player 4'] }); // M12-4b: two stored names, four kept
    // Through the store too.
    expect(new SettingsStore(oldSaved()).get().stops).toEqual(DEFAULT_SETTINGS.stops);
  });

  it('customized stops are left alone, even when only one side differs from the old defaults', () => {
    const custom = (stops: unknown) => loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ stops }) })).stops;
    expect(custom({ ownTurn: ['main1'], opponentTurn: ['declareAttackers', 'end'] })).toEqual({ ownTurn: ['main1'], opponentTurn: ['declareAttackers', 'end'] });
    expect(custom({ ownTurn: ['main1', 'main2'], opponentTurn: ['end'] })).toEqual({ ownTurn: ['main1', 'main2'], opponentTurn: ['end'] });
    expect(custom({ ownTurn: ['upkeep', 'main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] }).ownTurn).toEqual(['upkeep', 'main1', 'main2']);
    expect(custom({ ownTurn: [], opponentTurn: [] })).toEqual({ ownTurn: [], opponentTurn: [] });
  });

  it('settings saved after the upgrade keep the old default stops when the player chose them again', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    store.update({ stops: { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] } });
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)[STOPS_DEFAULTS_VERSION_KEY]).toBe(STOPS_DEFAULTS_VERSION);
    expect(loadSettings(storage).stops).toEqual({ ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] });
    // The marker is storage-only: it is not one of the settings.
    expect(loadSettings(storage)).not.toHaveProperty(STOPS_DEFAULTS_VERSION_KEY);
  });

  it('upgradeStoredStops leaves non-objects and marked settings unchanged', () => {
    expect(upgradeStoredStops(null)).toBe(null);
    expect(upgradeStoredStops('x')).toBe('x');
    const marked = { stops: { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] }, [STOPS_DEFAULTS_VERSION_KEY]: STOPS_DEFAULTS_VERSION };
    expect(upgradeStoredStops(marked)).toBe(marked);
  });
});

describe('Settings screen', () => {
  it('stores each change at once: Scryfall images, full control, stops, animation speed', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    screenWith(store);
    expect(box('Show card images from Scryfall').checked).toBe(false);
    fireEvent.click(box('Show card images from Scryfall'));
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).showScryfallImages).toBe(true);

    expect(box('Stop in Precombat main on my turn').checked).toBe(true);
    fireEvent.click(box('Stop in Precombat main on my turn'));
    fireEvent.click(box('Stop in Upkeep on the opponent\'s turn'));
    // FAST2 MRE: the engine's default stops include declareBlockers on both turns.
    expect(loadSettings(storage).stops).toEqual({ ownTurn: ['declareBlockers', 'main2'], opponentTurn: ['upkeep', 'declareAttackers', 'declareBlockers', 'end'] });

    fireEvent.click(box('Full control: never pass priority automatically'));
    expect(loadSettings(storage).fullControl).toBe(true);
    expect(box('Stop in Upkeep on my turn').disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Slow' }));
    expect(loadSettings(storage).animationSpeed).toBe('slow');

    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(box('Show card images from Scryfall').checked).toBe(false);
  });

  it('stores player names when the field is left; an empty name falls back to the default', () => {
    const store = new SettingsStore(memoryStorage());
    screenWith(store);
    const first = screen.getByRole('textbox', { name: 'Player 1' }) as HTMLInputElement;
    fireEvent.change(first, { target: { value: 'Ann' } });
    expect(store.get().playerNames[0]).toBe('Player 1');
    fireEvent.blur(first);
    expect(store.get().playerNames[0]).toBe('Ann');
    const second = screen.getByRole('textbox', { name: 'Player 2' }) as HTMLInputElement;
    fireEvent.change(second, { target: { value: '   ' } });
    fireEvent.blur(second);
    expect(store.get().playerNames[1]).toBe('Player 2');
    expect(second.value).toBe('Player 2');
  });

  it('CR 117.3d: the stops hint matches the engine, which passes for you whenever you can do nothing, stop or not', () => {
    screenWith(new SettingsStore(memoryStorage()));
    const hint = screen.getByRole('region', { name: 'Stops for new games' }).querySelector('.settings-hint')!.textContent!;
    expect(hint).not.toMatch(/nothing obvious to do/);
    expect(hint).toMatch(/could play a land, cast a spell or activate an ability/);
    expect(hint).toMatch(/If you can do nothing, it always passes for you/);
    expect(hint).toMatch(/Full control stops at every step/);
  });

  it('says so when this browser blocks storage', () => {
    const store = new SettingsStore(memoryStorage({}, true));
    screenWith(store);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(box('Show card images from Scryfall'));
    expect(screen.getByRole('alert').textContent).toMatch(/until the page is closed/);
    expect(box('Show card images from Scryfall').checked).toBe(true);
  });
});

describe('Settings screen: Sound', () => {
  const region = () => screen.getByRole('region', { name: 'Sound' });
  const slider = (name: string) => within(region()).getByRole('slider', { name }) as HTMLInputElement;
  const shown = (name: string) => slider(name).closest('.settings-volume')!.querySelector('output')!.textContent;

  it('turns sound effects off and on and stores the four volumes (0 to 100 on screen, 0 to 1 stored), shown live; Restore defaults resets them', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    screenWith(store);
    expect(box('Sound effects').checked).toBe(true);
    fireEvent.click(box('Sound effects'));
    expect(loadSettings(storage).sound.enabled).toBe(false);
    expect(within(region()).getByText(/Sound is off/)).toBeTruthy();
    fireEvent.click(box('Sound effects'));
    expect(store.get().sound.enabled).toBe(true);

    expect(slider('Master').value).toBe('80');
    expect(shown('Master')).toBe('80%');
    fireEvent.change(slider('Master'), { target: { value: '35' } });
    fireEvent.change(slider('Interface'), { target: { value: '0' } });
    fireEvent.change(slider('Game'), { target: { value: '100' } });
    fireEvent.change(slider('Ambience'), { target: { value: '12' } });
    expect(loadSettings(storage).sound).toEqual({ enabled: true, master: 0.35, interface: 0, game: 1, ambience: 0.12 });
    expect(shown('Master')).toBe('35%');
    expect(shown('Ambience')).toBe('12%');

    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(loadSettings(storage).sound).toEqual(DEFAULT_SOUND);
    expect(slider('Master').value).toBe('80');
  });

  it('the Test buttons play a sound of their category; the ambience test holds the table ambience a few seconds', () => {
    vi.useFakeTimers();
    const rec = recordSounds();
    const release = vi.fn();
    const hold = vi.spyOn(soundEngine(), 'holdAmbience').mockReturnValue(release);
    screenWith(new SettingsStore(memoryStorage()));
    fireEvent.click(within(region()).getByRole('button', { name: 'Test the interface sounds' }));
    fireEvent.click(within(region()).getByRole('button', { name: 'Test the game sounds' }));
    expect(rec.ids).toEqual(['ui.confirm', 'turn.mine']);

    const amb = within(region()).getByRole('button', { name: 'Test the ambience' });
    fireEvent.click(amb);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(amb.getAttribute('aria-pressed')).toBe('true');
    expect(amb.textContent).toBe('Stop');
    act(() => {
      vi.advanceTimersByTime(AMBIENCE_TEST_MS - 1);
    });
    expect(release).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(amb.textContent).toBe('Test');

    // Pressed again while it plays: it stops at once.
    fireEvent.click(amb);
    fireEvent.click(amb);
    expect(release).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(AMBIENCE_TEST_MS);
    });
    expect(release).toHaveBeenCalledTimes(2);
    rec.stop();
  });

  it('leaving the screen during the ambience test ends it', () => {
    const release = vi.fn();
    vi.spyOn(soundEngine(), 'holdAmbience').mockReturnValue(release);
    const view = screenWith(new SettingsStore(memoryStorage()));
    fireEvent.click(within(region()).getByRole('button', { name: 'Test the ambience' }));
    view.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('All sounds lists every catalog sound once, by group, with its purpose, and Play plays it', () => {
    const rec = recordSounds();
    screenWith(new SettingsStore(memoryStorage()));
    const list = region().querySelector<HTMLElement>('details.settings-sounds')!;
    expect(list.querySelector('summary')!.textContent).toBe('All sounds');
    const rows = [...list.querySelectorAll('.settings-sound-row')];
    expect(rows.map((r) => r.querySelector('code')!.textContent).sort()).toEqual([...SOUND_IDS].sort());
    expect(soundsByGroup().flatMap((g) => g.ids)).toHaveLength(SOUND_IDS.length);
    expect(within(list).getByRole('region', { name: 'Interface and decks' })).toBeTruthy();
    const confirm = rows.find((r) => r.querySelector('code')!.textContent === 'ui.confirm')!;
    expect(confirm.querySelector('.settings-sound-purpose')!.textContent).toBe(soundMeta('ui.confirm').purpose);
    fireEvent.click(within(list).getByRole('button', { name: 'Play card.draw' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Play net.chat' }));
    expect(rec.ids).toEqual(['card.draw', 'net.chat']);
    rec.stop();
  });
});
