/**
 * M6-11 (m6 design 3.4 "Reveals", CR 708.9): face-down cards are revealed to every player when they leave the battlefield or the stack (for anywhere but the
 * battlefield), when their owner leaves the game, and at the end of the game; a manifested or cloaked instant or sorcery is revealed when its controller
 * tries to turn it face up (CR 701.40g, 701.58g). The engine writes a public log line for each reveal; this notice above the prompt repeats this turn's
 * reveals so they are not lost in the log, and at the end of the game it names every face-down permanent and spell, which the view now shows to everybody.
 * Read only from the view: nothing here can name a card the view does not show.
 */
import type { GameObject, GameView } from '@openmtg/engine';
import { faceDownRealName, isFaceDownObject } from '../cards/objectStatus';
import { playerName } from './labels';

/** The rules the engine cites on a reveal of a face-down card. */
const REVEAL_RULES: ReadonlySet<string> = new Set(['CR 708.9', 'CR 701.40g', 'CR 701.58g']);

/** This turn's reveal lines (newest first, at most `max`). */
export function revealLines(view: GameView, max = 3): string[] {
  return view.log
    .filter((e) => e.turn === view.turn.number && (e.rules ?? []).some((r) => REVEAL_RULES.has(r)))
    .slice(-max)
    .reverse()
    .map((e) => e.text);
}

/** CR 708.9: at the end of the game, the face-down permanents and spells with their real names (the view shows them to every player then). */
export function revealedAtEnd(view: GameView): { id: string; text: string }[] {
  if (!view.result) return [];
  const out: { id: string; text: string }[] = [];
  for (const id of [...view.zones.battlefield, ...view.zones.stack]) {
    const o: GameObject | undefined = view.objects[id];
    if (!o || !isFaceDownObject(o) || o.kind === 'ability') continue;
    const name = faceDownRealName(view, o);
    if (name) out.push({ id, text: `${playerName(view, o.controller)}'s face-down ${o.zone === 'stack' ? 'spell' : 'creature'} was ${name}` });
  }
  return out;
}

export function RevealNotice({ view }: { view: GameView }) {
  const lines = revealLines(view);
  const atEnd = revealedAtEnd(view);
  if (lines.length === 0 && atEnd.length === 0) return null;
  return (
    <div className="game-reveal" role="status" aria-label="Revealed face-down cards">
      {lines.map((t, i) => (
        <p key={`l${i}`} className="game-reveal-line" title="CR 708.9">
          Revealed: {t}
        </p>
      ))}
      {atEnd.length > 0 && (
        <p className="game-reveal-line" title="CR 708.9: every face-down permanent and spell is revealed at the end of the game">
          Revealed at the end of the game: {atEnd.map((x) => x.text).join('; ')}.
        </p>
      )}
    </div>
  );
}
