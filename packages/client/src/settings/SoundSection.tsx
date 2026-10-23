/**
 * Settings, Sound (docs/design/sound.md): sound effects on or off, the master volume and one per sound category (catalog.ts SoundCategory), each with
 * a Test button, and "All sounds": every sound of the catalog by recipe group with what it must tell the player and a Play button, the owner's
 * listening board. Volumes are stored from 0 to 1; the page's engine re-reads them on every change (audio/sfx.ts subscribes to the settings store),
 * so a test or Play plays at the volumes on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { SOUND_GROUPS, SOUND_IDS, soundGroup, soundMeta, type SoundId } from '../audio/catalog';
import { sfx, soundEngine } from '../audio/sfx';
import type { SoundSettings, SettingsStore } from './settings';

type Volume = Exclude<keyof SoundSettings, 'enabled'>;

/** How long the ambience test plays (the loop fades in over 1.5 s and out over 0.8 s). */
export const AMBIENCE_TEST_MS = 4000;

const VOLUMES: { key: Volume; label: string; test?: SoundId | 'ambience' }[] = [
  { key: 'master', label: 'Master' },
  { key: 'interface', label: 'Interface', test: 'ui.confirm' },
  { key: 'game', label: 'Game', test: 'turn.mine' },
  { key: 'ambience', label: 'Ambience', test: 'ambience' },
];

/** The recipe groups (catalog.ts SOUND_GROUPS) as the list names them. */
const GROUP_LABELS: Record<string, string> = {
  ui: 'Interface and decks',
  flow: 'Game flow',
  moments: 'Big moments, online, ambience',
  spells: 'Spells',
  magic: 'Mana, spells resolving, abilities',
  combat: 'Combat, life, counters',
  cards: 'Cards moving',
  zones: 'Cards changing, zones, targets',
  other: 'Other',
};

/** Every sound by group, in the catalog's order. */
export function soundsByGroup(): { group: string; ids: SoundId[] }[] {
  const order = [...Object.keys(SOUND_GROUPS), 'other'];
  return order.map((group) => ({ group, ids: SOUND_IDS.filter((id) => soundGroup(id) === group) })).filter((g) => g.ids.length > 0);
}

/** The ambience test: holds the table ambience a few seconds (pressed again: stops it). */
function useAmbienceTest(): { playing: boolean; toggle: () => void } {
  const [playing, setPlaying] = useState(false);
  const hold = useRef<{ release: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const stop = () => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    clearTimeout(h.timer);
    h.release();
  };
  // Leaving the screen ends the test.
  useEffect(() => stop, []);
  const toggle = () => {
    if (hold.current) {
      stop();
      setPlaying(false);
      return;
    }
    const release = soundEngine().holdAmbience();
    hold.current = {
      release,
      timer: setTimeout(() => {
        stop();
        setPlaying(false);
      }, AMBIENCE_TEST_MS),
    };
    setPlaying(true);
  };
  return { playing, toggle };
}

export function SoundSection({ sound, store }: { sound: SoundSettings; store: SettingsStore }) {
  const ambience = useAmbienceTest();
  const setVolume = (key: Volume, percent: number) => store.update((cur) => ({ sound: { ...cur.sound, [key]: percent / 100 } }));
  return (
    <section className="hud-panel settings-sound" aria-labelledby="settings-sound">
      <h2 id="settings-sound">Sound</h2>
      <label className="settings-check">
        <input type="checkbox" checked={sound.enabled} onChange={(e) => store.update((cur) => ({ sound: { ...cur.sound, enabled: e.target.checked } }))} />
        <span>Sound effects</span>
      </label>
      {!sound.enabled && <p className="settings-hint">Sound is off: nothing plays, the tests and the list below included.</p>}
      <div className="settings-volumes">
        {VOLUMES.map(({ key, label, test }) => {
          const percent = Math.round(sound[key] * 100);
          const id = `settings-volume-${key}`;
          return (
            <div key={key} className="settings-volume">
              <label htmlFor={id}>{label}</label>
              <input id={id} type="range" min={0} max={100} step={1} value={percent} onChange={(e) => setVolume(key, Number(e.target.value))} />
              <output htmlFor={id}>{percent}%</output>
              {test === 'ambience' ? (
                <button type="button" className="settings-test" aria-label="Test the ambience" aria-pressed={ambience.playing} onClick={ambience.toggle}>
                  {ambience.playing ? 'Stop' : 'Test'}
                </button>
              ) : test ? (
                <button type="button" className="settings-test" aria-label={`Test the ${label.toLowerCase()} sounds`} onClick={() => sfx(test)}>
                  Test
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
      <details className="settings-sounds">
        <summary>All sounds</summary>
        <p className="settings-hint">Every sound in OpenMTG, played at the volumes above, with what it must tell you.</p>
        {soundsByGroup().map(({ group, ids }) => (
          <section key={group} className="settings-sound-group" aria-label={GROUP_LABELS[group] ?? group}>
            <h3>
              {GROUP_LABELS[group] ?? group} <span className="count">({ids.length})</span>
            </h3>
            <ul>
              {ids.map((id) => {
                const meta = soundMeta(id);
                return (
                  <li key={id} className="settings-sound-row" title={meta.when}>
                    <code>{id}</code>
                    <span className="settings-sound-purpose">{meta.purpose}</span>
                    <button type="button" className="settings-test" aria-label={`Play ${id}`} onClick={() => sfx(id)}>
                      Play
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </details>
    </section>
  );
}
