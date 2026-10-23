/**
 * M11-2 (docs/design/m11-commander.md 5.2): a player's commanders beside their piles, in place of the plain command pile (PlayerPanel.tsx `Piles`; emblems
 * and other command zone objects keep that pile). Each commander (CR 903.3; two with partners, CR 702.124) shows:
 *  - its card, drawn by the board's own card picture (`CardSlot` while it is in the command zone: zoom, the playable glow, a click opens its actions like
 *    any card; the board's card renderer otherwise, in a dashed frame, never dimmed), so the artist credit and the player's images come with it;
 *  - where it is, only as far as the viewer can see it (board/commander.ts: a commander in a hidden zone is "out of sight", CR 400.2);
 *  - its commander tax (CR 903.8, 702.124d: each commander counts only its own casts);
 *  - a Cast button while the engine lists the cast (its mana cost plus the tax, the total the engine asks for, CR 601.2f), or the engine's own label for
 *    another action of the commander there (commander ninjutsu, CR 702.49d). The button reports a click on the commander's object, exactly like clicking
 *    the card: the priority prompt does it (one action) or opens its list (several). The board itself never acts on the game.
 * Nothing at all is drawn outside a Commander game (no `PlayerState.commanders`).
 */
import { useMemo } from 'react';
import type { ManaCost, PlayerState } from '@openmtg/engine';
import { CardSlot } from './CardSlot';
import { commanderInfos, commanderWhere, type CommanderInfo } from './commander';
import { useBoard } from './context';
import { ManaCostView } from './ManaSymbols';

export function CommandZone({ player }: { player: PlayerState }) {
  const { view, legalActions } = useBoard();
  const infos = useMemo(() => commanderInfos(view, player, legalActions), [view, player, legalActions]);
  if (infos.length === 0) return null;
  return (
    <div className="command-zone" role="group" aria-label={`${player.name}'s command zone`} title="Command zone (CR 408)" data-player-id={player.id}>
      {infos.map((info) => (
        <CommanderSlot key={info.rec.card} info={info} />
      ))}
    </div>
  );
}

function CommanderSlot({ info }: { info: CommanderInfo }) {
  const board = useBoard();
  const { view, interaction } = board;
  const def = view.defs[info.rec.defId] ?? null;
  const home = info.zone === 'command' && info.object !== undefined;
  const where = commanderWhere(info, view.viewer);
  const taxCost: ManaCost = [{ kind: 'generic', amount: info.tax }];
  // The tax is paid only for a cast from the command zone (CR 903.8): a commander cast from anywhere else costs what its card says.
  const object = info.object;
  const canClick = object !== undefined && info.actions.length > 0 && interaction.onObjectClick !== undefined;
  const cast = info.actions.length === 1 && info.actions[0]!.kind === 'cast' ? info.actions[0]! : undefined;
  return (
    <div className={`commander-slot${home ? ' is-home' : ' is-away'}`} data-commander-card={info.rec.card} aria-label={`${info.name}: ${where}`} role="group">
      <span className="command-card">
        {home ? (
          <CardSlot id={object!.id} size="small" markers={false} />
        ) : (
          <span className="command-card-away" aria-hidden="true">
            {board.renderCard({ def, face: 0, chars: null, size: 'small', faceDown: false })}
          </span>
        )}
      </span>
      <span className="commander-info">
        <span className="commander-where">{where}</span>
        <span className="commander-tax" title="Commander tax: {2} more for each time it was cast from the command zone (CR 903.8)">
          Tax {info.tax > 0 ? <ManaCostView cost={taxCost} /> : '0'}
        </span>
        {canClick && (
          <button
            type="button"
            className="commander-cast"
            title={info.actions.map((a) => a.label).join('; ')}
            onClick={(e) => {
              e.stopPropagation();
              interaction.onObjectClick!(object.id);
            }}
          >
            {cast ? (
              <>
                Cast <ManaCostView cost={def?.faces[0]?.manaCost ?? null} />
                {home && info.tax > 0 && (
                  <>
                    {' + '}
                    <ManaCostView cost={taxCost} /> tax
                  </>
                )}
              </>
            ) : info.actions.length === 1 ? (
              info.actions[0]!.label
            ) : (
              `Cast or use (${info.actions.length})`
            )}
          </button>
        )}
      </span>
    </div>
  );
}
