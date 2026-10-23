/**
 * M11-2 (docs/design/m11-commander.md 5.2, 5.4): the board's read model of a Commander game, from the `GameView` only. Who each player's commander is
 * and its tax and damage are public (CR 903.6: it begins the game face up in the command zone; `PlayerState.commanders`, `commanderDamage` and the
 * commanders' definitions travel in every view). WHERE a commander is now is read only from the objects the view shows: a commander in a hidden zone
 * (a library, another player's hand, face down in exile for another player) is an object without its card id there (core/view.ts#hiddenObject), so the
 * board says only that it is not in the command zone and where it cannot be seen (CR 400.2, 406.3a). Outside a Commander game every answer is empty.
 */
import { commanderTax, type CardId, type CommanderRec, type GameObject, type GameView, type LegalAction, type PlayerId, type PlayerState, type ZoneKind } from '@openmtg/engine';
import { isHidden, stateOfView } from './model';

/** The visible object that is this commander card now (CR 903.3: the designation follows the card), or undefined when the viewer cannot see it. */
export function commanderObject(view: GameView, card: CardId): GameObject | undefined {
  // The command zone first: that is where it usually is.
  for (const id of view.zones.command) {
    const o = view.objects[id];
    if (o && !isHidden(o) && o.cardId === card) return o;
  }
  for (const o of Object.values(view.objects)) if (!isHidden(o) && o.cardId === card) return o;
  return undefined;
}

export interface CommanderInfo {
  rec: CommanderRec;
  owner: PlayerId;
  /** Its name from the commanders' definitions in the view (public, CR 903.6). */
  name: string;
  /** The object while the viewer can see it, wherever it is. */
  object: GameObject | undefined;
  /** Its zone as the viewer can see it; null when it is out of the viewer's sight. */
  zone: ZoneKind | null;
  /** CR 903.8, 702.124d: what casting it from the command zone costs on top of its mana cost now, in generic mana. */
  tax: number;
  /** Its priority actions now (cast from the command zone with the tax, commander ninjutsu, CR 702.49d): the engine's legal actions for its object. */
  actions: LegalAction[];
}

/** One player's commanders as the board shows them (none outside a Commander game). */
export function commanderInfos(view: GameView, player: PlayerState, legal: readonly LegalAction[] = []): CommanderInfo[] {
  const recs = player.commanders ?? [];
  if (recs.length === 0) return [];
  const state = stateOfView(view);
  return recs.map((rec) => {
    const object = commanderObject(view, rec.card);
    return {
      rec,
      owner: player.id,
      name: view.defs[rec.defId]?.name ?? 'Commander',
      object,
      zone: object?.zone ?? null,
      tax: commanderTax(state, rec.card),
      actions: object ? legal.filter((a) => a.object === object.id && a.kind !== 'pass' && !a.isMana) : [],
    };
  });
}

/** Where a commander is, in words for its owner's panel (only what the viewer can see). */
export function commanderWhere(info: CommanderInfo, viewer: PlayerId | null): string {
  switch (info.zone) {
    case 'command':
      return 'In the command zone';
    case 'battlefield':
      return 'On the battlefield';
    case 'stack':
      return 'On the stack';
    case 'graveyard':
      return 'In the graveyard';
    case 'exile':
      return 'In exile';
    case 'hand':
      return viewer === info.owner ? 'In your hand' : 'In a hand';
    case 'library':
      return 'In a library';
    default:
      return 'Out of sight';
  }
}

export interface CommanderDamageLine {
  commander: CardId;
  name: string;
  /** The commander's owner. */
  owner: PlayerId;
  amount: number;
  limit: number;
  /** Close to the limit: from limit - 6 on (15 of 21). */
  high: boolean;
}

/**
 * CR 903.10a, 704.6c, 702.124d: the combat damage each commander has dealt to `player` this game, against the variant's limit, for the commanders that
 * dealt any. None when the variant has no commander damage rule (`damageLimit: null`: Brawl, CR 903.12h; Duel Commander by its own
 * rules): driven by the game's options, never by the variant's name.
 */
/** M12-4a (inventory C18): the disc shows at most this many commander damage lines (the highest); the rest are in the popover with the whole table. */
export const DISC_DAMAGE_LINES = 3;

/** The lines the disc shows: all of them up to DISC_DAMAGE_LINES, else the highest ones (ties in the table's order) and how many more there are. */
export function discDamageLines(lines: readonly CommanderDamageLine[]): { shown: CommanderDamageLine[]; more: number } {
  if (lines.length <= DISC_DAMAGE_LINES) return { shown: [...lines], more: 0 };
  const top = new Set(
    lines
      .map((l, i) => [l, i] as const)
      .sort((a, b) => b[0].amount - a[0].amount || a[1] - b[1])
      .slice(0, DISC_DAMAGE_LINES)
      .map(([l]) => l),
  );
  return { shown: lines.filter((l) => top.has(l)), more: lines.length - DISC_DAMAGE_LINES };
}

/**
 * M12-4a (m12 design 5.3 item 3, inventory C18): the commander damage of the whole table (CR 903.10a): one row per player, one column per commander that has
 * dealt any combat damage to anybody; 0 where none. Empty when the variant has no commander damage rule.
 */
export function commanderDamageTable(view: GameView): { limit: number; commanders: { card: CardId; name: string; owner: PlayerId }[]; rows: { player: PlayerId; name: string; cells: number[] }[] } {
  const limit = view.options.commander?.damageLimit ?? null;
  if (limit === null) return { limit: 0, commanders: [], rows: [] };
  const commanders = view.players.flatMap((p) =>
    (p.commanders ?? []).filter((rec) => view.players.some((q) => (q.commanderDamage?.[rec.card] ?? 0) > 0)).map((rec) => ({ card: rec.card, name: view.defs[rec.defId]?.name ?? 'Commander', owner: p.id })),
  );
  return { limit, commanders, rows: view.players.map((p) => ({ player: p.id, name: p.name, cells: commanders.map((c) => p.commanderDamage?.[c.card] ?? 0) })) };
}

export function commanderDamageLines(view: GameView, player: PlayerState): CommanderDamageLine[] {
  const limit = view.options.commander?.damageLimit ?? null;
  if (limit === null || !player.commanderDamage) return [];
  const out: CommanderDamageLine[] = [];
  for (const p of view.players) {
    for (const rec of p.commanders ?? []) {
      const amount = player.commanderDamage[rec.card] ?? 0;
      if (amount <= 0) continue;
      out.push({ commander: rec.card, name: view.defs[rec.defId]?.name ?? 'Commander', owner: p.id, amount, limit, high: amount >= limit - 6 });
    }
  }
  return out;
}
