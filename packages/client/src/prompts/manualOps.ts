/**
 * Manual adjustments for text the engine does not understand (ARCHITECTURE "Manual resolution"; `ManualOp` in the engine). The panel edits a `ManualDraft`;
 * `buildOp` turns it into the exact `ManualOp` the engine validates (core/validate.ts) or explains what is missing; `describeOp` names it for the list.
 */
import { HIDDEN_DEF, MANUAL_MOVE_ZONES, type GameView, type ManaType, type ManualOp, type ObjectId } from '@openmtg/engine';
import { entityName, numberDuplicates, objectLabel, playerName } from './names';

/** An operation of the panel: an engine op, or "Exile a card", which is a `move` to exile named for what the text says. */
export type ManualKind = ManualOp['op'] | 'exile';

export const MANUAL_KINDS: { kind: ManualKind; label: string }[] = [
  { kind: 'move', label: 'Move a card' },
  { kind: 'discard', label: 'Discard a card' },
  { kind: 'exile', label: 'Exile a card' },
  { kind: 'life', label: 'Change life' },
  { kind: 'counters', label: 'Counters' },
  { kind: 'tap', label: 'Tap or untap' },
  { kind: 'draw', label: 'Draw cards' },
  { kind: 'shuffle', label: 'Shuffle a library' },
  { kind: 'control', label: 'Change control' },
  { kind: 'damage', label: 'Deal damage' },
  { kind: 'mana', label: 'Add mana' },
  { kind: 'attach', label: 'Attach or unattach' },
  { kind: 'token', label: 'Create a token' },
  { kind: 'tokenCopy', label: 'Token copy of a creature' },
  { kind: 'note', label: 'Note' },
];

/** Which fields each kind uses (the panel shows only these). */
export const FIELDS: Record<ManualKind, readonly (keyof ManualDraft)[]> = {
  move: ['object', 'zone', 'attachTo'],
  discard: ['object'],
  exile: ['object'],
  tokenCopy: ['object', 'player', 'haste', 'atNextEndStep'],
  life: ['player', 'amount'],
  counters: ['target', 'counter', 'amount'],
  tap: ['object', 'tapped'],
  draw: ['player', 'amount'],
  shuffle: ['player'],
  control: ['object', 'player'],
  damage: ['target', 'amount'],
  mana: ['player', 'mana'],
  attach: ['object', 'attachTo'],
  token: ['player', 'name', 'typeLine', 'power', 'toughness', 'colors', 'tapped'],
  note: ['text'],
};

export interface ManualDraft {
  kind: ManualKind;
  /** An object id. */
  object: string;
  /** An object or player id (counters, damage). */
  target: string;
  player: string;
  zone: string;
  /** Attach target: an object or player id, '' for none. */
  attachTo: string;
  amount: string;
  counter: string;
  tapped: boolean;
  /** Mana letters, e.g. "RRG". */
  mana: string;
  name: string;
  typeLine: string;
  power: string;
  toughness: string;
  /** Token color letters, e.g. "WU". */
  colors: string;
  text: string;
  /** A token copy: "except it has haste" (CR 707.9a). */
  haste: boolean;
  /** A token copy: what happens to it at the beginning of the next end step (CR 603.7), '' for nothing. */
  atNextEndStep: '' | 'sacrifice' | 'exile';
}

export function emptyDraft(view: GameView, kind: ManualKind = 'move'): ManualDraft {
  // M12-4b (m12 design 5.3 item 7, inventory C14): a spectator's draft starts with the first player still in the game, never one who left (CR 800.4a).
  const me = view.viewer ?? view.players.find((p) => !p.hasLost)?.id ?? '';
  return {
    kind, object: '', target: '', player: me, zone: 'graveyard', attachTo: '', amount: kind === 'draw' ? '1' : kind === 'life' ? '-1' : '1', counter: '+1/+1',
    tapped: kind === 'tap', mana: '', name: '', typeLine: 'Token Creature — ', power: '1', toughness: '1', colors: '', text: '',
    // the usual temporary copy (Kiki-Jiki, Splinter Twin): with haste, sacrificed at the next end step
    haste: true, atNextEndStep: 'sacrifice',
  };
}

/** The zone a kind's card must be in (the panel offers only those), or null for any card it can see. */
export function kindZone(kind: ManualKind): 'hand' | 'battlefield' | null {
  return kind === 'discard' ? 'hand' : kind === 'tokenCopy' ? 'battlefield' : null;
}

const int = (s: string): number | null => (/^[-+]?\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** `resolver`: the player making the adjustments (the engine refuses a token copy they give away and would sacrifice, CR 603.7d, 701.21a). */
export function buildOp(d: ManualDraft, resolver?: string): { op: ManualOp } | { error: string } {
  const need = (what: string) => ({ error: `Choose ${what}.` });
  switch (d.kind) {
    case 'move':
      if (!d.object) return need('the card to move');
      if (!MANUAL_MOVE_ZONES.includes(d.zone)) return need('where it goes');
      return { op: { op: 'move', object: d.object, to: d.zone as Extract<ManualOp, { op: 'move' }>['to'], ...(d.zone === 'battlefield' && d.attachTo ? { attachTo: d.attachTo } : {}) } };
    case 'discard':
      return d.object ? { op: { op: 'discard', object: d.object } } : need('the card to discard');
    case 'exile':
      return d.object ? { op: { op: 'move', object: d.object, to: 'exile' } } : need('the card to exile');
    case 'tokenCopy':
      if (!d.object) return need('the creature to copy');
      if (!d.player) return need('who creates the token');
      if (d.atNextEndStep === 'sacrifice' && resolver !== undefined && d.player !== resolver) {
        return { error: "You can't sacrifice a token another player controls at the next end step (CR 701.21a): choose Exile it instead." };
      }
      return { op: { op: 'tokenCopy', object: d.object, player: d.player, ...(d.haste ? { haste: true } : {}), ...(d.atNextEndStep ? { atNextEndStep: d.atNextEndStep } : {}) } };
    case 'life': {
      const n = int(d.amount);
      if (!d.player) return need('a player');
      if (n === null || n === 0) return { error: 'Enter the life change as a whole number, such as 3 or -2 (CR 119).' };
      return { op: { op: 'life', player: d.player, delta: n } };
    }
    case 'counters': {
      const n = int(d.amount);
      if (!d.target) return need('the object or player');
      if (!d.counter.trim()) return need('the kind of counter');
      if (n === null || n === 0) return { error: 'Enter how many counters to add (or remove, with a minus sign).' };
      return { op: { op: 'counters', object: d.target, counter: d.counter.trim(), delta: n } };
    }
    case 'tap':
      if (!d.object) return need('the permanent');
      return { op: { op: 'tap', object: d.object, tapped: d.tapped } };
    case 'draw': {
      const n = int(d.amount);
      if (!d.player) return need('a player');
      if (n === null || n < 0 || n > 100) return { error: 'Draw from 0 to 100 cards.' };
      return { op: { op: 'draw', player: d.player, count: n } };
    }
    case 'shuffle':
      return d.player ? { op: { op: 'shuffle', player: d.player } } : need('a player');
    case 'control':
      if (!d.object) return need('the permanent');
      return d.player ? { op: { op: 'control', object: d.object, player: d.player } } : need('the new controller');
    case 'damage': {
      const n = int(d.amount);
      if (!d.target) return need('what is dealt damage');
      if (n === null || n < 0) return { error: 'Damage is a whole number of 0 or more (CR 120).' };
      return { op: { op: 'damage', target: d.target, amount: n } };
    }
    case 'mana': {
      const types = d.mana.toUpperCase().replace(/[^WUBRGC]/g, '').split('') as ManaType[];
      if (!d.player) return need('a player');
      if (types.length === 0) return { error: 'Type the mana to add as letters W, U, B, R, G, C (for example "RRR").' };
      return { op: { op: 'mana', player: d.player, types } };
    }
    case 'attach':
      if (!d.object) return need('the Aura, Equipment or Fortification');
      return { op: { op: 'attach', object: d.object, to: d.attachTo === '' ? null : d.attachTo } };
    case 'token': {
      if (!d.player) return need('who creates the token');
      if (!d.name.trim()) return { error: 'A token needs a name (CR 111.4).' };
      if (!/\b(Creature|Artifact|Enchantment|Land|Planeswalker|Battle)\b/.test(d.typeLine)) return { error: 'A token needs a type line with a card type, such as "Token Creature — Soldier" (CR 111.4).' };
      const creature = /\bCreature\b/.test(d.typeLine);
      const colors = [...new Set(d.colors.toUpperCase().replace(/[^WUBRG]/g, '').split(''))] as ('W' | 'U' | 'B' | 'R' | 'G')[];
      return {
        op: {
          op: 'token', player: d.player, name: d.name.trim(), typeLine: d.typeLine.trim(),
          ...(creature ? { power: d.power.trim(), toughness: d.toughness.trim() } : {}),
          ...(colors.length ? { colors } : {}),
          ...(d.tapped ? { tapped: true } : {}),
        },
      };
    }
    case 'note':
      return d.text.trim() ? { op: { op: 'note', text: d.text.trim() } } : { error: 'Write the note.' };
  }
}

const ZONE_NAMES: Record<string, string> = {
  hand: "its owner's hand", battlefield: 'the battlefield', graveyard: "its owner's graveyard", exile: 'exile', libraryTop: 'the top of its library', libraryBottom: 'the bottom of its library',
};

export function describeOp(view: GameView, op: ManualOp): string {
  const n = (id: string) => entityName(view, id);
  switch (op.op) {
    case 'move':
      return `Move ${n(op.object)} to ${ZONE_NAMES[op.to] ?? op.to}${op.attachTo ? `, attached to ${n(op.attachTo)}` : ''}`;
    case 'life':
      return `${playerName(view, op.player)} ${op.delta >= 0 ? 'gains' : 'loses'} ${Math.abs(op.delta)} life`;
    case 'counters':
      return `${op.delta >= 0 ? 'Put' : 'Remove'} ${Math.abs(op.delta)} ${op.counter} counter${Math.abs(op.delta) === 1 ? '' : 's'} ${op.delta >= 0 ? 'on' : 'from'} ${n(op.object)}`;
    case 'tap':
      return `${op.tapped ? 'Tap' : 'Untap'} ${n(op.object)}`;
    case 'draw':
      return `${playerName(view, op.player)} draws ${op.count} card${op.count === 1 ? '' : 's'}`;
    case 'shuffle':
      return `${playerName(view, op.player)} shuffles their library`;
    case 'control':
      return `${playerName(view, op.player)} gains control of ${n(op.object)}`;
    case 'damage':
      return `Deal ${op.amount} damage to ${n(op.target)}`;
    case 'attach':
      return op.to === null ? `Unattach ${n(op.object)}` : `Attach ${n(op.object)} to ${n(op.to)}`;
    case 'mana':
      return `${playerName(view, op.player)} adds ${op.types.map((t) => `{${t}}`).join('')}`;
    case 'token':
      return `${playerName(view, op.player)} creates ${op.name} (${op.typeLine}${op.power !== undefined ? `, ${op.power}/${op.toughness}` : ''})`;
    case 'discard':
      return `Discard ${n(op.object)}`;
    case 'tokenCopy':
      return (
        `${playerName(view, op.player)} creates a token copy of ${n(op.object)}${op.haste ? ' with haste' : ''}` +
        (op.atNextEndStep ? `; ${op.atNextEndStep === 'sacrifice' ? 'sacrifice' : 'exile'} it at the beginning of the next end step` : '')
      );
    case 'note':
      return `Note: ${op.text}`;
  }
}

/**
 * Objects a manual adjustment may name, with labels: everything the viewer can see (battlefield, stack, graveyards, exile, their own hand, revealed cards),
 * plus the top and bottom card of each library (hidden, named by position, for "mill" and "exile the top card" text). `exclude` is the resolving spell.
 */
export function pickableObjects(view: GameView, exclude?: ObjectId): { id: ObjectId; label: string }[] {
  const out: { id: ObjectId; label: string }[] = [];
  const add = (id: ObjectId, label?: string) => {
    if (id !== exclude && !out.some((x) => x.id === id)) out.push({ id, label: label ?? objectLabel(view, id) });
  };
  for (const id of view.zones.battlefield) add(id);
  for (const id of view.zones.stack) add(id);
  for (const p of view.players) for (const id of view.zones.graveyard[p.id] ?? []) add(id);
  for (const id of view.zones.exile) add(id);
  for (const p of view.players) for (const id of view.zones.hand[p.id] ?? []) if (view.objects[id]?.defId !== HIDDEN_DEF) add(id);
  for (const p of view.players) {
    const lib = view.zones.library[p.id] ?? [];
    if (lib[0] !== undefined) add(lib[0], `Top card of ${playerName(view, p.id)}'s library`);
    if (lib.length > 1) add(lib[lib.length - 1]!, `Bottom card of ${playerName(view, p.id)}'s library`);
  }
  const labels = numberDuplicates(out.map((o) => o.label)); // two Forests read "Forest #1", "Forest #2"
  return out.map((o, i) => ({ id: o.id, label: labels[i]! }));
}

/** The object and player ids an adjustment names. */
function referencedIds(op: ManualOp): string[] {
  switch (op.op) {
    case 'move':
      return [op.object, ...(op.attachTo ? [op.attachTo] : [])];
    case 'counters':
    case 'tap':
    case 'control':
    case 'discard':
    case 'tokenCopy':
      return [op.object];
    case 'damage':
      return [op.target];
    case 'attach':
      return [op.object, ...(op.to ? [op.to] : [])];
    default:
      return [];
  }
}

/**
 * Why `op` can't follow `earlier` in the same answer, or null. The engine applies the adjustments in order and checks every object id against the state
 * before the first one; a card that an earlier adjustment moves (or draws from the top of a library) becomes a new object (CR 400.7), so a later adjustment
 * naming it would fail. Texts such as "put it onto the battlefield tapped" or "return it with a +1/+1 counter" can therefore not be resolved in one answer
 * yet: `move` has no tapped or counters option (a known gap: the engine would have to follow the new object, or take those options on `move`).
 */
export function staleReference(view: GameView, earlier: readonly ManualOp[], op: ManualOp): string | null {
  const ids = referencedIds(op);
  for (const [i, e] of earlier.entries()) {
    const gone =
      e.op === 'move' || e.op === 'discard' ? [e.object] : e.op === 'draw' ? (view.zones.library[e.player] ?? []).slice(0, e.count) : [];
    const hit = ids.find((id) => gone.includes(id));
    if (hit !== undefined) {
      return (
        `${entityName(view, hit)} is ${e.op === 'move' ? 'moved' : e.op === 'discard' ? 'discarded' : 'drawn'} by adjustment ${i + 1}, ` +
        `so it is a new object (CR 400.7) and a later adjustment ` +
        `can't name it. Adjustments to it after the move are not supported yet: add a Note saying what still has to happen.`
      );
    }
  }
  return null;
}
