/**
 * One player's battlefield (CR 403), Arena-style: the main line holds only the creatures, each with the cards attached to it; the
 * row behind it holds the lands at the left and every other permanent (artifacts, enchantments, planeswalkers, battles) at the right. The top players'
 * battlefields are mirrored (that row at the far edge), so each player's creatures face the middle of the table.
 *
 * A row never scrolls or clips (ui/arena): its cards shrink to share its width (`--units`: a tapped card is as wide as a card is tall; an attachment is
 * tucked under its host), and below their smallest size they wrap. So a lifted, attacking or animated card is never cut off at a row's edge.
 */
import type { CSSProperties } from 'react';
import type { PlayerId } from '@openmtg/engine';
import { useBoard } from './context';
import { CardSlot } from './CardSlot';
import { battlefieldRows, playerName, type PermanentInfo } from './model';

/** How many untapped card widths a row needs: tapped cards are turned sideways (CR 701.26a); attachments are tucked under their host (no extra width). */
function rowUnits(cards: readonly PermanentInfo[]): number {
  let units = 0;
  for (const c of cards) units += c.obj.tapped ? 1.4 : 1;
  return Math.max(1, units);
}

function Row({ cards, kind, label }: { cards: PermanentInfo[]; kind: 'creatures' | 'lands' | 'others'; label: string }) {
  const style = { '--n': Math.max(1, cards.length), '--units': rowUnits(cards).toFixed(2) } as CSSProperties;
  return (
    <div className={`bf-row bf-${kind}${cards.length === 0 ? ' is-empty' : ''}`} role="list" aria-label={label} style={style}>
      {cards.map((p) => (
        <div role="listitem" className="bf-slot" key={p.id}>
          <CardSlot id={p.id} size="small" />
        </div>
      ))}
    </div>
  );
}

export function Battlefield({ player, mirrored }: { player: PlayerId; mirrored: boolean }) {
  const { view } = useBoard();
  const { creatures, lands, others } = battlefieldRows(view, player);
  const name = playerName(view, player);
  const mainLine = <Row key="creatures" cards={creatures} kind="creatures" label={`${name}'s creatures`} />;
  const support = (
    <div key="support" className="bf-support">
      <Row cards={lands} kind="lands" label={`${name}'s lands`} />
      <Row cards={others} kind="others" label={`${name}'s other permanents`} />
    </div>
  );
  return (
    <section className={`battlefield ${mirrored ? 'bf-far' : 'bf-near'}`} aria-label={`${name}'s battlefield`} data-player-id={player}>
      {mirrored ? [support, mainLine] : [mainLine, support]}
    </section>
  );
}
