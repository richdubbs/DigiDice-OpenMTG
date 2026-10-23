/**
 * The 903.9 choice (docs/design/m11-commander.md 4.3, 5.3): the commander's owner chooses whether it goes to the command zone.
 *  - CR 903.9b: a commander that would be put into its owner's hand or library may be put into the command zone instead (a replacement).
 *  - CR 903.9a, 704.6d: a commander put into a graveyard or exile since the last state-based action check may be put into the command zone.
 * The prompt names the commander and the rule, shows its card on the board's stage (Arena style, prompts/stage.tsx), and has both choices; Space puts it into
 * the command zone. The decision is asked of the owner only (other players get the engine's redacted stand-in, CR 400.2), and the owner always knows which
 * card their commander is (CR 903.6), so its name comes from the commander's definition when the object itself is out of sight.
 */
import type { CardId, GameView, ObjectId } from '@openmtg/engine';
import { useBoard } from '../board/context';
import { isHidden } from '../board/model';
import { objectName } from './names';
import { usePrimary } from './keys';
import { PromptActions } from './PromptActions';
import { PromptStage, StageCard } from './stage';
import type { PromptProps } from './types';

/** The commander's name: from the visible object, else from the commander's definition (public, CR 903.6). */
export function commanderName(view: GameView, object: ObjectId, card: CardId): string {
  const o = view.objects[object];
  if (o && !isHidden(o)) return objectName(view, object);
  for (const p of view.players) {
    const rec = p.commanders?.find((c) => c.card === card);
    const name = rec ? view.defs[rec.defId]?.name : undefined;
    if (name) return name;
  }
  return 'Your commander';
}

/** What happened, in words, with the rule. */
export function commanderZoneQuestion(d: { rule: '903.9a' | '903.9b'; zone: 'hand' | 'library' | 'graveyard' | 'exile' }, name: string): string {
  if (d.rule === '903.9b')
    return `${name} would be put into your ${d.zone}. You may put it into the command zone instead (CR 903.9b).`;
  return `${name} was put into ${d.zone === 'exile' ? 'exile' : 'your graveyard'}. You may put it into the command zone (CR 903.9a, 704.6d).`;
}

/** The commander's card on the stage: the object while it is visible, otherwise its definition (the board's card renderer either way). */
function CommanderStageCard({ object, card }: { object: ObjectId; card: CardId }) {
  const board = useBoard();
  const o = board.view.objects[object];
  if (o && !isHidden(o) && o.faceDown !== true) return <StageCard id={object} />;
  // A face-down commander (exiled face down, CR 406.3a) stays a card back on the screen, like the player's own face-down cards on the table (M6-11).
  const rec = board.view.players.flatMap((p) => p.commanders ?? []).find((c) => c.card === card);
  const def = o?.faceDown === true || !rec ? null : (board.view.defs[rec.defId] ?? null);
  return (
    <div className="prompt-stage-card">
      <div className="prompt-stage-picture">{board.renderCard({ def, face: 0, chars: null, size: 'large', faceDown: o?.faceDown === true })}</div>
    </div>
  );
}

export function CommanderZonePrompt({ d, view, answer, busy }: PromptProps<'commanderZone'>) {
  const command = () => answer({ kind: 'commanderZone', command: true });
  usePrimary(command);
  const name = commanderName(view, d.object, d.card);
  const stay = d.rule === '903.9b' ? `Put ${name} into your ${d.zone}` : `Leave ${name} in ${d.zone === 'exile' ? 'exile' : 'your graveyard'}`;
  const question = commanderZoneQuestion(d, name);
  return (
    <>
      <p className="prompt-detail">{question}</p>
      <PromptStage title={`${name}: to the command zone?`} subtitle={question}>
        <div className="prompt-commander-card">
          <CommanderStageCard object={d.object} card={d.card} />
        </div>
      </PromptStage>
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy} onClick={command} title="Space">
          Put {name} into the command zone
        </button>
        <button type="button" disabled={busy} onClick={() => answer({ kind: 'commanderZone', command: false })}>
          {stay}
        </button>
      </PromptActions>
    </>
  );
}
