/**
 * RPL-2 (replays design 9, "Transport"): the replay bar, drawn on the table at the bottom right in place of the prompt's action buttons (the owner's
 * board rules: the right rail never moves or resizes). The label ("Turn 7 · Bob · Declare blockers · action 83 of 214"), the timeline (a slider with a
 * tick at every turn's start, colored by the active player's seat, and markers for spells cast, combat damage, life changes and players leaving), and
 * the transport: previous turn, step back, play or pause, step forward, next turn, and the speed. Every control has a name and its key in its title.
 */
import { useSyncExternalStore, type CSSProperties } from 'react';
import type { ReplayController, ReplayControllerState } from '../../connection/ReplayConnection';
import type { MarkKind } from './timeline';
import { REPLAY_SPEEDS, speedLabel, type ReplaySpeed } from './pacing';

/** Media symbols in their text form (U+FE0E), so no platform draws them as emoji. */
const TEXT = '︎';
const GLYPH = {
  previousTurn: `⏮${TEXT}`,
  back: `⏴${TEXT}`,
  play: `▶${TEXT}`,
  pause: `⏸${TEXT}`,
  forward: `⏵${TEXT}`,
  nextTurn: `⏭${TEXT}`,
};

const MARK_NAMES: Record<MarkKind, string> = { spell: 'Spell cast', combat: 'Combat damage', life: 'Life change', left: 'A player left' };

/** The order a position's marker is drawn by (the first wins): a player leaving, combat damage, a spell, a life change. */
const MARK_ORDER: readonly MarkKind[] = ['left', 'combat', 'spell', 'life'];

function at(position: number, last: number): CSSProperties {
  return { left: `${last <= 0 ? 0 : (position / last) * 100}%` };
}

function Timeline({ s, controller }: { s: ReplayControllerState; controller: ReplayController }) {
  return (
    <div className="replay-timeline">
      <div className="replay-track" aria-hidden="true">
        {s.ticks.map((t) => (
          <span key={`t${t.position}`} className="replay-tick" data-seat={t.seat} style={at(t.position, s.last)} title={`Turn ${t.turn}`} />
        ))}
        {s.markers.map((m) => {
          const kind = MARK_ORDER.find((k) => m.kinds.includes(k)) ?? m.kinds[0]!;
          return <span key={`m${m.position}`} className="replay-mark" data-mark={kind} style={at(m.position, s.last)} title={m.kinds.map((k) => MARK_NAMES[k]).join(', ')} />;
        })}
        <span className="replay-head" style={at(s.position, s.last)} />
      </div>
      <input
        type="range"
        className="replay-scrubber"
        aria-label="Timeline"
        min={0}
        max={Math.max(0, s.last)}
        step={1}
        value={s.position}
        aria-valuetext={s.valueText}
        disabled={!s.playable}
        onChange={(e) => controller.seek(Number(e.target.value))}
      />
    </div>
  );
}

export function ReplayBar({ controller }: { controller: ReplayController }) {
  const s = useSyncExternalStore(controller.subscribe, controller.state);
  const off = !s.playable;
  return (
    <div className="replay-bar" role="group" aria-label="Replay controls" data-playing={s.playing || undefined}>
      <p className="replay-label">{s.label}</p>
      <Timeline s={s} controller={controller} />
      <div className="replay-transport">
        <button type="button" aria-label="Previous turn" title="Previous turn (Shift+Left)" aria-keyshortcuts="Shift+ArrowLeft" disabled={off || s.position === 0} onClick={() => controller.previousTurn()}>
          {GLYPH.previousTurn}
        </button>
        <button type="button" aria-label="Step back" title="Step back (Left)" aria-keyshortcuts="ArrowLeft" disabled={off || s.position === 0} onClick={() => controller.step(-1)}>
          {GLYPH.back}
        </button>
        <button
          type="button"
          className="button-primary replay-play"
          aria-label={s.playing ? 'Pause' : 'Play'}
          title={s.playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-keyshortcuts="Space"
          disabled={off}
          onClick={() => controller.toggle()}
        >
          {s.playing ? GLYPH.pause : GLYPH.play}
        </button>
        <button type="button" aria-label="Step forward" title="Step forward (Right)" aria-keyshortcuts="ArrowRight" disabled={off || s.position >= s.last} onClick={() => controller.step(1)}>
          {GLYPH.forward}
        </button>
        <button type="button" aria-label="Next turn" title="Next turn (Shift+Right)" aria-keyshortcuts="Shift+ArrowRight" disabled={off || s.position >= s.last} onClick={() => controller.nextTurn()}>
          {GLYPH.nextTurn}
        </button>
        <select
          className="replay-speed"
          aria-label="Speed"
          title="Speed ([ slower, ] faster)"
          value={String(s.speed)}
          onChange={(e) => {
            const v = e.target.value;
            controller.setSpeed((v === 'real' ? 'real' : Number(v)) as ReplaySpeed);
          }}
        >
          {REPLAY_SPEEDS.map((x) => (
            <option key={String(x)} value={String(x)}>
              {speedLabel(x)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
