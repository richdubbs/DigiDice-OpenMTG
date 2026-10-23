/**
 * Settings (docs/design/m8-client.md screen 9): the look and feel (UI profiles: ProfilesSection.tsx; Restore defaults leaves them alone), Scryfall
 * images opt-in (off by default), default stops, full control, animation speed, the table of a game
 * with three or four players (M12-4b, m12 design 5.1-5.2: its layout and whether its camera follows the mouse), sound (on or off, the volumes with a test
 * each, and the list of every sound to play: SoundSection.tsx, docs/design/sound.md), four player names. Every change is applied and
 * stored at once (localStorage, settings.ts); stops and full control apply to games started afterwards (a game in progress keeps the stops it started
 * with; the board's phase bar changes them for that game), the volumes at once. Restore defaults resets the sound too.
 */
import type { Step } from '@openmtg/engine';
import { useState } from 'react';
import { ScreenHeader } from '../app/ScreenHeader';
import { STEP_LABELS } from '../game/labels';
import {
  ANIMATION_SPEEDS, MAX_NAME_LENGTH, STOP_STEPS, TABLE_LAYOUTS, settingsStore, type AnimationSpeed, type PlayerNames, type SettingsStore, type TableLayout,
} from './settings';
import { ProfilesSection } from './ProfilesSection';
import { SoundSection } from './SoundSection';
import { useSettings } from './useSettings';
import './settings.css';

const SPEED_LABELS: Record<AnimationSpeed, string> = { off: 'Off', fast: 'Fast', normal: 'Normal', slow: 'Slow' };

/** M12-4b (m12 design 5.2): the three table layouts of a game with three or four players, as Settings names them. */
export const TABLE_LAYOUT_LABELS: Record<TableLayout, string> = {
  shared: 'Shared table',
  acrossTop: 'Opponents across the top',
  focused: 'One focused opponent',
};

const TABLE_LAYOUT_HINTS: Record<TableLayout, string> = {
  shared: 'Every board on one table, seen from your seat; the camera can look across it.',
  acrossTop: 'Your board at the bottom, every opponent side by side at the top in turn order.',
  focused: 'One opponent large at the top, the others as strips; it follows whose turn it is and who attacks or targets you.',
};

function toggle(list: Step[], step: Step, on: boolean): Step[] {
  return on ? [...list, step] : list.filter((s) => s !== step);
}

/** A name field that stores on blur, so clearing it to retype does not snap back to the default at once. */
function NameField({ index, value, store }: { index: 0 | 1 | 2 | 3; value: string; store: SettingsStore }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    store.update((s) => {
      const names: PlayerNames = [...s.playerNames];
      names[index] = draft;
      return { playerNames: names };
    });
    setDraft(store.get().playerNames[index]);
  };
  return (
    <label className="settings-field">
      <span>Player {index + 1}</span>
      <input type="text" value={draft} maxLength={MAX_NAME_LENGTH} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    </label>
  );
}

export function SettingsScreen({ store = settingsStore() }: { store?: SettingsStore }) {
  const s = useSettings(store);
  return (
    <div className="screen settings">
      <ScreenHeader title="Settings">
        <button type="button" className="button-link settings-reset" onClick={store.reset}>
          Restore defaults
        </button>
      </ScreenHeader>
      {!store.persisted && (
        <p className="settings-warning" role="alert">
          This browser does not let OpenMTG store settings; they apply until the page is closed.
        </p>
      )}

      <ProfilesSection />

      <section className="hud-panel" aria-labelledby="settings-images">
        <h2 id="settings-images">Card images</h2>
        <label className="settings-check">
          <input type="checkbox" checked={s.showScryfallImages} onChange={(e) => store.update({ showScryfallImages: e.target.checked })} />
          <span>Show card images from Scryfall</span>
        </label>
        <p className="settings-hint">
          Off by default. When on, your browser loads card pictures directly from Scryfall; nothing is downloaded into OpenMTG. Your own uploaded images
          always come first, and cards without an image show a text frame.
        </p>
      </section>

      <section className="hud-panel" aria-labelledby="settings-stops">
        <h2 id="settings-stops">Stops for new games</h2>
        <p className="settings-hint">
          Steps where the game stops for you when you could play a land, cast a spell or activate an ability; in other steps it passes priority for you,
          the way Arena does. If you can do nothing, it always passes for you, stop or not, and also while your own spell or ability is on top of the
          stack, so the opponent can respond. Full control stops at every step. In a game, Hold priority (next to Pass, key H) stops at every priority
          until the end of that turn, also right after your own spells.
        </p>
        <label className="settings-check">
          <input type="checkbox" checked={s.fullControl} onChange={(e) => store.update({ fullControl: e.target.checked })} />
          <span>Full control: never pass priority automatically</span>
        </label>
        <table className="settings-stops" aria-label="Stops">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">My turn</th>
              <th scope="col">Opponent's turn</th>
            </tr>
          </thead>
          <tbody>
            {STOP_STEPS.map((step) => (
              <tr key={step}>
                <th scope="row">{STEP_LABELS[step]}</th>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Stop in ${STEP_LABELS[step]} on my turn`}
                    checked={s.stops.ownTurn.includes(step)}
                    disabled={s.fullControl}
                    onChange={(e) => store.update((cur) => ({ stops: { ...cur.stops, ownTurn: toggle(cur.stops.ownTurn, step, e.target.checked) } }))}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Stop in ${STEP_LABELS[step]} on the opponent's turn`}
                    checked={s.stops.opponentTurn.includes(step)}
                    disabled={s.fullControl}
                    onChange={(e) =>
                      store.update((cur) => ({ stops: { ...cur.stops, opponentTurn: toggle(cur.stops.opponentTurn, step, e.target.checked) } }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="hud-panel" aria-labelledby="settings-animation">
        <h2 id="settings-animation">Animation speed</h2>
        <div role="radiogroup" aria-labelledby="settings-animation" className="settings-radios">
          {ANIMATION_SPEEDS.map((speed) => (
            <label key={speed} className="settings-check">
              <input type="radio" name="animationSpeed" checked={s.animationSpeed === speed} onChange={() => store.update({ animationSpeed: speed })} />
              <span>{SPEED_LABELS[speed]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="hud-panel" aria-labelledby="settings-table">
        <h2 id="settings-table">Table (three or four players)</h2>
        <p className="settings-hint">
          How a game with three or four players is drawn; a two-player game looks the same in every layout. The table has the same switch during a game.
        </p>
        <div role="radiogroup" aria-labelledby="settings-table" className="settings-radios">
          {TABLE_LAYOUTS.map((layout) => (
            <label key={layout} className="settings-check" title={TABLE_LAYOUT_HINTS[layout]}>
              <input type="radio" name="tableLayout" checked={s.tableLayout === layout} onChange={() => store.update({ tableLayout: layout })} />
              <span>{TABLE_LAYOUT_LABELS[layout]}</span>
            </label>
          ))}
        </div>
        <p className="settings-hint">{TABLE_LAYOUT_HINTS[s.tableLayout]}</p>
        <label className="settings-check">
          <input type="checkbox" checked={s.cameraFollow} onChange={(e) => store.update({ cameraFollow: e.target.checked })} />
          <span>Camera follows the mouse</span>
        </label>
        <p className="settings-hint">
          On the shared table the camera looks where the mouse points. Off: the camera stays still and shows the whole table (zoom with + and -, pan with the
          arrow keys, Home to recentre). It is also still when your system asks for reduced motion.
        </p>
      </section>

      <SoundSection sound={s.sound} store={store} />

      <section className="hud-panel" aria-labelledby="settings-names">
        <h2 id="settings-names">Player names</h2>
        <p className="settings-hint">
          The names the New game screen starts with (players 3 and 4 in games with more players). Starting a game keeps the names of the people who played
          it here; a computer&apos;s name is never kept.
        </p>
        {/* Keyed by the stored name, so "Restore defaults" refreshes the drafts. */}
        {([0, 1, 2, 3] as const).map((i) => (
          <NameField key={`${i}:${s.playerNames[i]}`} index={i} value={s.playerNames[i]} store={store} />
        ))}
      </section>
    </div>
  );
}
