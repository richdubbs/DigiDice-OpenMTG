/**
 * `GameState.history`: what "happened this turn" conditions, history filters (`enteredThisTurn`, `dealtDamageThisTurn`, ...) and quantities read (design 3.4,
 * 4.1, CR 603.4). Owner: WP8 WRITES it from the normalized events; WP4 owns the facts convention and the readers (`rules/history.ts`: `objectFacts`,
 * `makeHistoryEntry`, `countHistory`, `enteredThisTurn`, ...), which `effects/eval.ts` and `rules/filter.ts` call. This file produces exactly that convention, so
 * writer and reader cannot drift (the INTERFACE NOTE of the WP4 report); there is no second reader here.
 *
 * The characteristics in an entry are those the object had when the event happened (CR 603.10a: last known information for what left the battlefield or a
 * graveyard), which is what "a creature died this turn" means. Every entry is stamped with the turn it HAPPENED in (the opening hands and the shuffles of game
 * setup are turn 0), whenever it was collected, and with the combat phase it happened in. Entries are never pruned: "this game" (`scope: 'game'`) can ask about
 * any kind of event.
 *
 * Mana abilities are not recorded (one entry per land tapped would drown the rest and nothing asks how often you tapped for mana). A `becomesBlocked` entry is
 * written per attacker/blocker pair, with the blocker's facts (`by.`) and `first` set on the first pair of each attacker: "became blocked by a creature" counts
 * every pair (CR 509.3d), "became blocked" counts each attacker once per combat however many creatures block it (CR 509.3c; rules/history.ts#historyMatches).
 */
import type { EventPattern } from '../types/ability';
import type { GameObject, GameState, HistoryEntry, SemEvent } from '../types/state';
import { charsOfObject, type Chars } from '../rules/characteristics';
import { currentCombatNumber, makeHistoryEntry, objectFacts, type Facts } from '../rules/history';
import { deepFreeze } from '../util/clone';
import { isCommander } from '../statics/commander';

type Role = 'subject' | 'source' | 'object' | 'attacker' | 'blocker' | 'spell' | 'newObject';

/** The object of an event role as it was at the event, with its characteristics, or undefined when the event has none. */
function roleObject(s: GameState, e: SemEvent, role: Role): { o: GameObject; chars: Chars } | undefined {
  const h = e.roles[role];
  if (!h || !('objects' in h) || h.objects.length === 0) return undefined;
  const id = h.objects[0]!.id;
  const oldId = typeof e.data['oldId'] === 'string' ? e.data['oldId'] : undefined;
  // A zone change keys its snapshot by the id the object had before (a card that moved has a new id, CR 400.7).
  const snap = e.before[id] ?? (oldId ? e.before[oldId] : undefined);
  const live = s.objects[id];
  // CR 603.10a: what left the battlefield (or a graveyard) is judged by what it last was; so is anything that is no longer anywhere.
  const leftBattlefield = e.ev === 'zoneChange' && (e.data['from'] === 'battlefield' || e.data['from'] === 'graveyard');
  const o = snap && (leftBattlefield || !live || e.ev === 'action') ? snap.object : live ?? snap?.object;
  if (!o) return undefined;
  return { o, chars: snap && o === snap.object ? snap.chars ?? charsOfObject(s, o) : charsOfObject(s, o) };
}

const bool = (v: unknown): boolean => v === true;

/** The entry for one semantic event, or null when nothing in the model reads this kind of event back. */
export function historyEntry(s: GameState, e: SemEvent, combat: number, turn: number = s.turn.number): HistoryEntry | null {
  const facts: Facts = {};
  const put = (k: string, v: string | number | boolean | undefined): void => {
    if (v !== undefined) facts[k] = v;
  };
  const player = e.roles.player && 'players' in e.roles.player ? e.roles.player.players[0] : undefined;
  let actor = player;
  /** The facts of `role`'s object under `prefix` ('' = the subject of the entry). */
  const addFacts = (role: Role, prefix: string): string | undefined => {
    const r = roleObject(s, e, role);
    if (!r) return undefined;
    Object.assign(facts, objectFacts(r.chars, r.o, prefix));
    // CMD2 (CR 903.3, 702.173a): the commander designation of the object as it was at the event ("dealt combat damage this turn with an Assassin or
    // commander", freerunning). Written only when it is one (no other game or object gets a new fact); rules/history.ts reads a missing fact as "not one"
    if (isCommander(s, r.o)) facts[`${prefix}commander`] = true;
    return r.o.id;
  };
  let subject: string | undefined;
  const primary = (role: Role): void => {
    subject = addFacts(role, '');
    // The subject id is the one the object has NOW in the zone it went to (CR 400.7): the handle of the event, not the snapshot's old id.
    const h = e.roles[role];
    if (h && 'objects' in h && h.objects[0]) subject = h.objects[0].id;
  };
  switch (e.ev) {
    case 'zoneChange': {
      primary('subject');
      put('from', e.data['from'] as string | undefined);
      put('to', e.data['to'] as string | undefined);
      // FAST5X E25 (CR 708.3, 603.4): face down as it entered, whatever happened to it later in the batch ("entered the battlefield face down this turn")
      if (e.data['to'] === 'battlefield') put('faceDown', e.data['faceDown'] === true);
      // FAST4 T23 (CR 108.4a, 110.2): a card in a graveyard has no controller, so for an object that went from a graveyard ONTO the battlefield (whose other
      // facts are the card's, CR 603.10a) the controller fact is the one it entered under: "entered the battlefield under your control this turn" (CR 603.4)
      const live = subject !== undefined ? s.objects[subject] : undefined;
      if (e.data['to'] === 'battlefield' && e.data['from'] === 'graveyard' && live !== undefined && live.zone === 'battlefield') put('controller', live.controller);
      break;
    }
    case 'cast':
      primary('spell');
      put('from', e.data['from'] as string | undefined);
      put('copy', bool(e.data['copy']));
      put('nth', typeof e.data['nth'] === 'number' ? e.data['nth'] : undefined); // FAST1 T4
      put('via', typeof e.data['via'] === 'string' ? e.data['via'] : undefined); // FAST5X E2: the alternative cost paid (CR 702.185c)
      put('modal', bool(e.data['modal'])); // Standard round 3, r3-trig (CR 700.2)
      break;
    case 'activate':
      if (bool(e.data['mana'])) return null;
      primary('source');
      put('mana', false);
      // Standard round 3, r3-trig (CR 606.3, 702.177a): the kind of ability activated, for "if you've activated a loyalty ability this turn" (rules/history.ts)
      put('loyalty', bool(e.data['loyalty']));
      put('exhaust', bool(e.data['exhaust']));
      break;
    case 'attacks': {
      primary('attacker');
      put('alone', bool(e.data['alone']));
      put('count', typeof e.data['count'] === 'number' ? e.data['count'] : undefined);
      put('totalPower', typeof e.data['totalPower'] === 'number' ? e.data['totalPower'] : undefined); // Standard round 3, r3-trig (CR 508.1)
      const d = e.roles.defender;
      if (d && 'players' in d) {
        put('defenderKind', 'player');
        put('defendingPlayer', d.players[0]);
      } else if (d && 'objects' in d && d.objects[0]) {
        const target = s.objects[d.objects[0].id] ?? s.lki[d.objects[0].id]?.object;
        const battle = target !== undefined && charsOfObject(s, target).types.includes('Battle');
        put('defenderKind', battle ? 'battle' : 'planeswalker');
        // M12-3 (m12 design E42), CR 508.5: the defending player of an attack on a planeswalker is its controller, on a battle its protector (as the attack was
        // declared). Every reader of a player attack checks `defenderKind` first (rules/history.ts, statics/hooks.ts), so this only adds the "or a planeswalker
        // you control" reading.
        put('defendingPlayer', target === undefined ? undefined : battle ? target.protector : target.controller);
      }
      break;
    }
    case 'blocks':
      primary('blocker');
      addFacts('attacker', 'attacker.');
      put('first', bool(e.data['first'])); // CR 509.3a-b: the first pair of this blocker in this declaration (rules/history.ts)
      break;
    case 'becomesBlocked':
      primary('attacker');
      addFacts('blocker', 'by.');
      // CR 509.3c: "becomes blocked" happens once per attacker in a combat, however many creatures block it; "becomes blocked by a creature" once per blocker
      // (CR 509.3d). One entry per pair keeps the blocker's facts; `first` marks the pair that counts for a pattern without `by` (rules/history.ts).
      put('first', bool(e.data['first']));
      break;
    case 'damage': {
      const toPlayer = bool(e.data['toPlayer']);
      if (!toPlayer) primary('object');
      addFacts('source', 'source.');
      put('amount', typeof e.data['amount'] === 'number' ? e.data['amount'] : undefined);
      put('combat', bool(e.data['combat']));
      put('toPlayer', toPlayer);
      if (toPlayer) {
        const r = e.roles.recipient;
        const p = r && 'players' in r ? r.players[0] : undefined;
        put('recipientPlayer', p);
        actor = p; // the player damaged
      }
      break;
    }
    case 'step':
      put('step', e.data['step'] as string | undefined);
      put('mainPhase', typeof e.data['mainPhase'] === 'number' ? e.data['mainPhase'] : undefined); // FAST5X E17 (CR 505.1b)
      break;
    case 'beginTurn':
      put('extra', bool(e.data['extra']));
      break;
    case 'life':
      put('change', e.data['change'] as string | undefined);
      put('amount', typeof e.data['amount'] === 'number' ? e.data['amount'] : undefined);
      break;
    case 'draw':
      put('nth', typeof e.data['nth'] === 'number' ? e.data['nth'] : undefined);
      break;
    case 'becomes':
      primary('subject');
      put('what', e.data['what'] as string | undefined);
      addFacts('source', 'by.');
      // FAST4 T27 (CR 115.1, 602.2a, 603.3a): "the target of a spell or ability you control" is judged on the spell or ability that targets (its controller),
      // not on the permanent an ability comes from, as the trigger matcher judges it (triggers/match.ts, `becomes` `by`): the controller fact is that one
      if (e.data['what'] === 'targeted' && typeof e.data['byController'] === 'string') put('by.controller', e.data['byController']);
      if (e.data['untapStep'] === true) put('untapStep', true); // Standard round 5, r5-trig (CR 502.3)
      break;
    case 'counters': {
      const onPlayer = bool(e.data['onPlayer']);
      if (!onPlayer) primary('subject');
      put('change', e.data['change'] as string | undefined);
      put('kind', e.data['kind'] as string | undefined);
      put('amount', typeof e.data['amount'] === 'number' ? e.data['amount'] : undefined);
      put('total', typeof e.data['total'] === 'number' ? e.data['total'] : undefined);
      put('onPlayer', onPlayer);
      if (onPlayer) put('recipientPlayer', player);
      // CLOUD std-msh (CR 122.6, 122.6a): who put them (FAST5X E21's `by`), for "you've put one or more +1/+1 counters on ~ this turn" (rules/history.ts)
      if (e.data['change'] === 'put' && typeof e.data['by'] === 'string') put('by', e.data['by'] as string);
      break;
    }
    case 'action':
      primary('subject');
      put('verb', e.data['verb'] as string | undefined);
      put('revealed', e.data['revealed'] as string | undefined); // std-lci: an explore's revealed card (CR 701.44a)
      put('from', e.data['from'] as string | undefined); // Standard round 4, r4-trig (CR 305.1): the zone a land was played from
      break;
    case 'createToken':
      primary('newObject');
      break;
    case 'dieRoll':
      put('result', typeof e.data['result'] === 'number' ? e.data['result'] : undefined);
      break;
    case 'coinFlip': // cloud r3-mech (CR 705.2)
      put('won', typeof e.data['won'] === 'boolean' ? e.data['won'] : undefined);
      break;
    case 'resolves':
      primary('subject');
      break;
    default:
      return null; // `state` is a condition, not an event
  }
  const entry = makeHistoryEntry(s, { ev: e.ev as EventPattern['ev'], ...(actor !== undefined ? { actor } : {}), ...(subject !== undefined ? { subject } : {}), combat, facts });
  entry.turn = turn;
  return entry;
}

/** Append the history of a batch that happened in `turn` (default: this turn). */
export function recordHistory(s: GameState, batch: SemEvent[], turn: number = s.turn.number, batchStart?: number): void {
  for (const e of batch) {
    // The combat phase an event belongs to: the one in progress this turn (CR 500.8), none for what happened in an earlier turn.
    const entry = historyEntry(s, e, turn === s.turn.number ? currentCombatNumber(s) : 0, turn);
    // Standard round 5, r5-trig (CR 603.2c): where the entries of this simultaneous batch begin (`HistoryEntry.batch`, rules/history.ts#firstTimeThisTurn)
    if (entry && batchStart !== undefined) entry.batch = batchStart;
    // Design 4.3 (WP30 amendment): entries are shared between states (util/clone.ts copies only the array), so one is frozen as it is written: editing it
    // would change every earlier state and the replay.
    if (entry) s.history.push(deepFreeze(entry));
  }
}
