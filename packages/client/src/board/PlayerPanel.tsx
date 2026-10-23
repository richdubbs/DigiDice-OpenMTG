/**
 * A player's identity disc (ui/arena, Arena-style avatar): life (CR 119) large in a glowing disc, the name with the turn and priority badges, poison
 * counters (CR 122.1f) and other player counters (CR 122.1), designations (monarch CR 725, initiative CR 726, city's blessing CR 702.131c, FAST5X E18: an enduring story, Storied reminder text), speed (CR 702.179,
 * FAST5X-4: shown once the player has speed; "max" at 4, CR 702.179e), and the mana
 * pool (CR 106.4). Clickable when the current decision lets the player pick this player (a target, CR 115.1): the whole disc is the click target and the
 * name chip is the keyboard's button. The fx layer aims hits at the disc (`data-fx="avatar"`).
 *
 * The piles beside it (`Piles`): library (CR 401.3: any player may count it; the cards are never shown, CR 400.2), graveyard, exile and command zone
 * viewers (CR 404, 406, 408), each drawn as a small pile of cards the animations fly into, and the hand count (CR 402). In a replay's open view
 * (`view.open`, replays design 6), where nothing is hidden, the library is a zone viewer too, its cards in order, top first.
 *
 * M11-2 (m11 design 5.2, 5.4): in a Commander game the player's commanders have their own place beside the piles (CommandZone.tsx; the command pile keeps
 * emblems and the like), and the disc lists the combat damage each commander has dealt this player, "N / 21" (CR 903.10a, 704.6c), highlighted from 15 and
 * popped by the animator on each `commanderDamage` event; no line when the variant has no commander damage rule (its `damageLimit` is null).
 * CMP1 (CR 702.139a): a player's revealed companion beside the piles too, for every viewer (CompanionSlot.tsx).
 */
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { dungeonOfObject, type PlayerState } from '@openmtg/engine';
import { useBoard } from './context';
import { CardBack } from './cardRenderer';
import { OwnerSleeve } from './sleeves';
import { ManaPool } from './ManaPool';
import { MarkerStrip, usePromptMark, useTargetMarkers } from './Markers';
import { commanderDamageLines, commanderDamageTable, discDamageLines } from './commander';
import { CommandZone } from './CommandZone';
import { CompanionSlot } from './CompanionSlot';
import { cardCount, isHidden } from './model';
import { PileTop, ZoneViewer } from './ZoneViewer';

export function PlayerPanel({ player, position }: { player: PlayerState; position: 'top' | 'bottom' }) {
  const board = useBoard();
  const { view, interaction } = board;
  const targetMarkers = useTargetMarkers(player.id);
  const promptMark = usePromptMark(player.id);
  const id = player.id;
  // CR 103.1: before the play order is chosen (turn 0: coin flip, mulligans) nobody is the active player yet, whatever the engine's placeholder says.
  const active = view.turn.number > 0 && view.turn.activePlayer === id;
  const deciding = view.pending?.player === id;
  // CR 117: only the viewer's own decision is known. The view turns every other player's decision into a 'priority' stand-in (core/view.ts), so for them
  // the badge says only that they are deciding; the stand-in's prompt goes in the tooltip.
  const ownPriority = deciding && view.viewer === id && view.pending?.kind === 'priority';
  const decidingTitle = view.viewer === id ? 'You must act or decide now (CR 117)' : (view.pending?.prompt ?? 'This player is deciding');
  const d = view.designations;
  const you = view.viewer === id;
  // MX4: the player's dungeon in the command zone and the room their venture marker is on (CR 309.4), and the dungeons they completed (CR 309.7)
  const dungeonObj = view.zones.command.map((o) => view.objects[o]).find((o) => o !== undefined && o.owner === id && dungeonOfObject(o) !== undefined);
  const dungeon = dungeonOfObject(dungeonObj);
  const room = dungeon && dungeonObj ? dungeon.rooms[dungeonObj.ventureRoom ?? 0] : undefined;
  const completed = d.completedDungeons?.[id] ?? [];

  const selectable = board.selectable.has(id);
  const selected = board.selected.has(id);
  const focused = board.focusStack !== null && (board.targeted.get(id) ?? []).includes(board.focusStack);
  const clickable = interaction.onPlayerClick !== undefined && (selectable || selected);
  const highlight = selected ? 'selected' : focused ? 'focus' : selectable ? 'selectable' : targetMarkers.length ? 'targeted' : undefined;
  const click = () => interaction.onPlayerClick?.(id);
  // A pointer click anywhere on a choosable player's disc picks the player, except on the panel's own controls; the name chip stays the keyboard's button.
  const panelClick = (e: MouseEvent) => {
    if (!clickable || (e.target as Element).closest('button, [role="button"], [role="dialog"]')) return;
    click();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      click();
    }
  };
  const status = player.conceded ? 'Conceded' : player.hasLost ? 'Lost' : view.result?.winner === id ? 'Won' : null;
  const extraCounters = Object.entries(player.counters).filter(([, n]) => n > 0);
  const lifeTone = player.life <= 5 ? ' is-critical' : player.life <= 10 ? ' is-low' : '';
  const allDamage = commanderDamageLines(view, player);
  // M12-4a (C18): with many commanders at the table the disc shows the highest three and "+N"; the popover has the whole table.
  const { shown: damage, more: moreDamage } = discDamageLines(allDamage);
  const [tableOpen, setTableOpen] = useState(false);
  const speed = d.speed?.[id];
  const hasStats = player.poison > 0 || extraCounters.length > 0 || d.monarch === id || d.initiative === id || d.citysBlessing?.includes(id) || d.enduringStory?.includes(id) || speed !== undefined || room !== undefined || completed.length > 0 || damage.length > 0;

  return (
    <section
      className={`player-panel panel-${position}${you ? ' is-you' : ''}${active ? ' is-active' : ''}${deciding ? ' is-deciding' : ''}${highlight ? ` hl-${highlight}` : ''}`}
      aria-label={`${player.name}${you ? ' (you)' : ''}`}
      data-player-id={id}
      data-highlight={highlight}
      data-fx="avatar"
      onClick={panelClick}
    >
      <div className={`avatar-disc${lifeTone}`}>
        <span className="avatar-ring" aria-hidden="true" />
        <span className="stat stat-life" aria-label={`Life ${player.life}`} title="Life total (CR 119)">
          {player.life}
        </span>
        <div
          className={`player-id${clickable ? ' is-clickable' : ''}`}
          {...(clickable ? { role: 'button', tabIndex: 0, onClick: click, onKeyDown: onKey, 'aria-pressed': selected, 'aria-label': `Choose ${player.name}` } : {})}
        >
          <span className="player-name">{player.name}</span>
        </div>
        {(active || deciding || status) && (
          <div className="disc-badges">
            {active && (
              <span className="badge badge-turn" title="Active player (CR 102.1)">
                Turn
              </span>
            )}
            {deciding && (
              <span className="badge badge-deciding" title={decidingTitle}>
                {ownPriority ? 'Priority' : 'Deciding'}
              </span>
            )}
            {status && <span className="badge badge-status">{status}</span>}
          </div>
        )}
      </div>
      <div className="player-meta">
        {hasStats && (
          <div className="player-stats">
            {player.poison > 0 && (
              <span className="stat stat-poison" aria-label={`Poison ${player.poison}`} title="Poison counters; ten or more loses the game (CR 122.1f, 704.5c)">
                ☠ {player.poison}
              </span>
            )}
            {extraCounters.map(([name, n]) => (
              <span key={name} className="stat" title={`${name} counters (CR 122.1)`}>
                {name} {n}
              </span>
            ))}
            {d.monarch === id && (
              <span className="stat" title="The monarch (CR 725)">
                Monarch
              </span>
            )}
            {d.initiative === id && (
              <span className="stat" title="The initiative (CR 726)">
                Initiative
              </span>
            )}
            {dungeon && room && (
              <span className="stat stat-dungeon" title={`Venture marker (CR 309.4): ${dungeon.name}, ${room.name}: ${room.text}`}>
                {room.name}
              </span>
            )}
            {completed.length > 0 && (
              <span className="stat" title={`Completed dungeons (CR 309.7): ${completed.join(', ')}`}>
                Dungeons {completed.length}
              </span>
            )}
            {d.citysBlessing?.includes(id) && (
              <span className="stat" title="City's blessing (CR 702.131c)">
                City's blessing
              </span>
            )}
            {damage.map((l) => (
              <span
                key={l.commander}
                className={`stat stat-commander-damage${l.high ? ' is-high' : ''}`}
                data-commander-damage={l.commander}
                aria-label={`Commander damage from ${l.name}: ${l.amount} of ${l.limit}`}
                title={`Combat damage from ${l.name} this game; ${l.limit} or more from one commander loses the game (CR 903.10a, 704.6c)`}
              >
                <span className="commander-damage-name">{l.name}</span> {l.amount} / {l.limit}
              </span>
            ))}
            {moreDamage > 0 && (
              <button
                type="button"
                className="stat stat-commander-more"
                aria-expanded={tableOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setTableOpen((o) => !o);
                }}
                title="Commander damage of the whole table (CR 903.10a)"
              >
                +{moreDamage}
              </button>
            )}
            {d.enduringStory?.includes(id) && (
              <span className="stat" title="Enduring story: kept for the rest of the game (Storied: three or more artifacts, legendaries and/or Sagas)">
                Enduring story
              </span>
            )}
            {speed !== undefined && (
              <span className="stat stat-speed" aria-label={`Speed ${speed}`} title="Speed: increases once on each of your turns when an opponent loses life; max speed is 4 (CR 702.179)">
                Speed {speed >= 4 ? `${speed} (max)` : speed}
              </span>
            )}
          </div>
        )}
        <ManaPool pool={player.manaPool} ownerName={player.name} />
      </div>
      <MarkerStrip markers={[...targetMarkers, ...promptMark]} />
      {tableOpen && moreDamage > 0 && <CommanderDamageTable onClose={() => setTableOpen(false)} />}
    </section>
  );
}

/** M12-4a (m12 design 5.3 item 3): every player's combat damage from every commander (CR 903.10a), highlighted from the limit minus 6 as on the discs. */
function CommanderDamageTable({ onClose }: { onClose: () => void }) {
  const { view } = useBoard();
  const t = commanderDamageTable(view);
  return (
    <div className="commander-table" role="dialog" aria-label="Commander damage" onClick={(e) => e.stopPropagation()}>
      <table>
        <thead>
          <tr>
            <th scope="col">Player</th>
            {t.commanders.map((c) => (
              <th key={c.card} scope="col">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.player}>
              <th scope="row">{r.name}</th>
              {r.cells.map((n, i) => (
                <td key={t.commanders[i]!.card} className={n >= t.limit - 6 ? 'is-high' : undefined}>
                  {n > 0 ? `${n} / ${t.limit}` : '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * A player's library as a pile of card backs with its count (CR 401.3). FAST5X E14 (CR 401.5): the top card face up when this viewer may look at it ("You
 * may look at the top card of your library any time"); the engine's view holds it only for that player (core/view.ts#canSee), so everybody else still
 * sees a back. RPL-2 (replays design 6): in a replay's open view, which holds every library in order (core/view.ts#openView), it is a zone viewer that
 * lists the cards top first (`zones.library` is top first).
 */
function LibraryPile({ player }: { player: PlayerState }) {
  const { view } = useBoard();
  const id = player.id;
  const library = view.zones.library[id] ?? [];
  if (view.open === true) return <ZoneViewer zoneKey={`${id}:library`} title="Library" ownerName={player.name} ids={library} rule="CR 401" pile="library" playerId={id} />;
  const libraryTop = library[0];
  const topSeen = libraryTop !== undefined && view.objects[libraryTop] !== undefined && !isHidden(view.objects[libraryTop]!);
  return (
    <span
      className="pile pile-library"
      data-fx="pile"
      data-pile="library"
      data-player-id={id}
      aria-label={`Library: ${cardCount(library.length)}${topSeen ? `; you may look at the top card: ${view.defs[view.objects[libraryTop!]!.defId]?.name ?? 'a card'}` : ''}`}
      title={topSeen ? 'Cards in library (CR 401.3); you may look at the top card (CR 401.5)' : 'Cards in library (CR 401.3)'}
    >
      {topSeen ? (
        <PileTop id={libraryTop} />
      ) : (
        <span className={`pile-art${library.length > 0 ? '' : ' is-empty'}`} aria-hidden="true">
          {library.length > 0 ? (
            <OwnerSleeve owner={id}>
              <CardBack size="small" />
            </OwnerSleeve>
          ) : (
            <span className="pile-empty" />
          )}
        </span>
      )}
      <span className="zone-title">Lib</span> <span className="count">{library.length}</span>
    </span>
  );
}

/** Library, graveyard, exile and command zone of one player as small card piles (the top card face up where the zone is public), and the hand count. */
export function Piles({ player }: { player: PlayerState }) {
  const { view } = useBoard();
  const id = player.id;
  const handCount = view.zones.hand[id]?.length ?? 0;
  const graveyard = [...(view.zones.graveyard[id] ?? [])].reverse();
  const exile = [...view.zones.exile].filter((o) => view.objects[o]?.owner === id).reverse();
  // M11-2: commanders are shown by the command zone panel, not in this pile (only for a Commander game: nothing changes elsewhere).
  const commanderCards = new Set(view.players.flatMap((p) => (p.commanders ?? []).map((c) => c.card)));
  const command = view.zones.command.filter((o) => view.objects[o]?.owner === id && !(commanderCards.size > 0 && commanderCards.has(view.objects[o]?.cardId ?? '')));
  return (
    <div className="piles player-zones" data-player-id={id}>
      <LibraryPile player={player} />
      <ZoneViewer zoneKey={`${id}:graveyard`} title="Graveyard" ownerName={player.name} ids={graveyard} rule="CR 404" pile="graveyard" playerId={id} />
      <ZoneViewer zoneKey={`${id}:exile`} title="Exile" ownerName={player.name} ids={exile} rule="CR 406" pile="exile" playerId={id} />
      {command.length > 0 && <ZoneViewer zoneKey={`${id}:command`} title="Command" ownerName={player.name} ids={command} rule="CR 408" pile="command" playerId={id} />}
      <CommandZone player={player} />
      <CompanionSlot player={player} />
      <span className="zone-count pile-hand-count" aria-label={`Hand: ${cardCount(handCount)}`} title="Cards in hand (CR 402)">
        Hand <span className="count">{handCount}</span>
      </span>
    </div>
  );
}
