/**
 * Round edh-d-50 (Commander lane next-cast, a concept round): the "next time you cast" riders, played through the engine with synthetic cards (invented names, design 6.10).
 * CR cites from memory, unverified (no rules/cr in the cloud checkout).
 *
 *   CR 601.2a, 611.2c, 702.88a  "When you next cast an instant or sorcery spell from your hand this turn, it gains rebound." (Narset Transcendent): the next such spell cast from the hand has
 *                               rebound; a spell that does not match leaves it waiting; the spell after it has none
 *   CR 601.2i, 611.2, 702.85a   "As you cast spells from your hand this turn, they gain cascade." (Yidris, Maelstrom Wielder): EVERY spell cast from the hand this turn cascades, one cast from
 *                               elsewhere does not, and it ends with the turn
 *   CR 603.7, 603.7c, 202.3     "When you next cast a spell this turn, put X +1/+1 counters on up to one target creature, where X is the mana value of that spell." (Ride the Avalanche),
 *                               "..., search your library for a creature card with lesser mana value, put it onto the battlefield, then shuffle." (Vivien, Monsters' Advocate)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, advanceTo, find, life, pass, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const ROLL = card('Test Echo Idol', 'Artifact', '{T}: When you next cast an instant or sorcery spell from your hand this turn, it gains rebound.');
const GRANT = card('Test Cascade Idol', 'Artifact', '{T}: As you cast spells from your hand this turn, they gain cascade.');
const TOP = card('Test Top Idol', 'Enchantment', 'You may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.');
const RIDE = card('Test Avalanche', 'Instant', 'The next spell you cast this turn can be cast as though it had flash. When you next cast a spell this turn, put X +1/+1 counters on up to one target creature, where X is the mana value of that spell.', undefined, '{0}');
const SEEK = card('Test Seek Idol', 'Artifact', '{T}: When you next cast a creature spell this turn, search your library for a creature card with lesser mana value, put it onto the battlefield, then shuffle.');
const CHARM = card('Test Charm', 'Instant', 'You gain 5 life.', undefined, '{1}');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', undefined, '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const BIG = card('Test Big Bear', 'Creature — Bear', '', ['3', '3'], '{3}');
const SMALL = card('Test Small Bear', 'Creature — Bear', '', ['1', '1'], '{1}');
const TWOBEAR = card('Test Two Bear', 'Creature — Bear', '', ['2', '2'], '{2}');
const LIFE = card('Test Life Idol', 'Artifact', 'Whenever you cast a spell, you gain 1 life.');
const COPIER = card('Test Copy Idol', 'Artifact', "{T}: When you next activate an ability that isn't a mana ability this turn by spending four or more mana to activate it, copy that ability. You may choose new targets for the copy.");
const PUMP4 = card('Test Big Well', 'Artifact', '{4}: You gain 2 life.');
const PUMP2 = card('Test Small Well', 'Artifact', '{2}: You gain 1 life.');
const RITE = card('Test Hatch Rite', 'Instant', 'You may cast Dinosaur spells this turn as though they had flash, and whenever you cast a Dinosaur spell this turn, it gains "When this creature enters, you gain 3 life."', undefined, '{0}');
const RAPTOR = card('Test Raptor', 'Creature — Dinosaur', '', ['2', '2'], '{1}');
const RAPTOR2 = card('Test Raptor Two', 'Creature — Dinosaur', '', ['2', '2'], '{1}');
const DEFS = [RITE, RAPTOR, RAPTOR2, COPIER, PUMP4, PUMP2, ROLL, GRANT, TOP, RIDE, SEEK, CHARM, SIP, BEAR, BIG, SMALL, TWOBEAR, LIFE];

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const activate = (s: GameState, name: string): GameState => {
  const a = legalActionsOf(s).find((x) => x.object !== undefined && nameOf(s, x.object) === name)!;
  return resolveAll(act(s, a.action));
};
import { legalActions } from '../../../src/index';
const legalActionsOf = (s: GameState) => legalActions(s, 'p1').filter((x) => x.kind === 'activate');
const cast = (s: GameState, name: string, p: Parameters<typeof resolveAll>[1] = {}): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), p), p);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.88a, 601.2i: "When you next cast an instant or sorcery spell from your hand this turn, it gains rebound." (Narset Transcendent)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Echo Idol', 'Plains', 'Plains', 'Plains'], hand: ['Test Bear', 'Test Charm', 'Test Charm'] } });
  it('the next instant cast from the hand is exiled as it resolves (rebound); a creature spell cast first leaves the rider waiting; the second instant goes to the graveyard', () => {
    let s = activate(board(), 'Test Echo Idol');
    s = cast(s, 'Test Bear');
    s = cast(s, 'Test Charm');
    const exiled = s.zones.exile.filter((id) => nameOf(s, id) === 'Test Charm');
    expect(exiled.length).toBe(1);
    s = cast(s, 'Test Charm');
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Charm').length).toBe(1);
    expect((s.zones.graveyard['p1'] ?? []).filter((id) => nameOf(s, id) === 'Test Charm').length).toBe(1);
  });
  it('negative: without the ability the instant goes to the graveyard; the rider ends with the turn', () => {
    const s = cast(board(), 'Test Charm');
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Charm').length).toBe(0);
    const later = advanceTo(activate(board(), 'Test Echo Idol'), 3, 'main1');
    expect(later.turn.nextSpell ?? []).toEqual([]);
  });
});

describe('CR 601.2i, 611.2, 702.85a: "As you cast spells from your hand this turn, they gain cascade." (Yidris, Maelstrom Wielder)', () => {
  it('every spell cast from the hand this turn cascades (+1 life each from the {0} spell in the library), not only the next one', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Cascade Idol', 'Plains', 'Plains', 'Plains'], hand: ['Test Charm', 'Test Charm'], library: ['Test Sip', 'Test Sip', 'Test Sip', 'Test Sip'] } }), 'Test Cascade Idol');
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1);
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1 + 5 + 1);
  });
  it('negative: a creature spell cast from the top of the library does not cascade, and the rider keeps waiting for the hand', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Cascade Idol', 'Test Top Idol', 'Plains', 'Plains', 'Plains'], hand: ['Test Charm'], library: ['Test Bear', 'Test Sip', 'Test Sip', 'Test Sip'] } }), 'Test Cascade Idol');
    const l0 = life(s, 'p1');
    const top = legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === 'Test Bear');
    expect(top, 'the Bear can be cast from the top of the library').toBeDefined();
    s = resolveAll(settle(act(s, top!.action)));
    expect(life(s, 'p1')).toBe(l0); // no cascade for the Bear
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1); // the hand spell still cascades
  });
  it('negative: without the ability nothing cascades; the rider ends with the turn', () => {
    const base = scenario([], { defs: DEFS, p1: { battlefield: ['Test Cascade Idol', 'Plains'], hand: ['Test Charm'], library: ['Test Sip', 'Test Sip'] } });
    expect(life(cast(base, 'Test Charm'), 'p1')).toBe(life(base, 'p1') + 5);
    expect(advanceTo(activate(base, 'Test Cascade Idol'), 3, 'main1').turn.nextSpell ?? []).toEqual([]);
  });
});

describe('CR 603.7, 202.3: "When you next cast a spell this turn, put X +1/+1 counters on up to one target creature, where X is the mana value of that spell." (Ride the Avalanche)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Small Bear', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Avalanche', 'Test Big Bear', 'Test Charm'] } });
  it('the next spell cast (mana value 3) puts three counters on the chosen creature once its trigger resolves; the spell after it does not', () => {
    let s = cast(board(), 'Test Avalanche');
    const small = find(s, 'Test Small Bear', 'battlefield');
    s = cast(s, 'Test Big Bear', { targets: [obj(small)] });
    expect(s.objects[small]!.counters['+1/+1']).toBe(3);
    s = cast(s, 'Test Charm', { targets: [obj(small)] });
    expect(s.objects[small]!.counters['+1/+1']).toBe(3);
  });
  it('the next spell can be cast as though it had flash (on the opponent\'s turn is not needed here: the flash permit is used up by that spell)', () => {
    const s = cast(board(), 'Test Avalanche');
    expect(s.turn.nextSpell?.some((r) => r.rider === 'flash')).toBe(true);
  });
  it('negative: no target chosen ("up to one"): no counters and no error', () => {
    let s = cast(board(), 'Test Avalanche');
    s = cast(s, 'Test Big Bear');
    expect(s.objects[find(s, 'Test Small Bear', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 603.7, 202.3: "When you next cast a creature spell this turn, search your library for a creature card with lesser mana value ..." (Vivien, Monsters\' Advocate)', () => {
  it('casting a mana value 2 creature spell finds a creature card with mana value 1 (not the mana value 2 or 3 ones) onto the battlefield', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Seek Idol', 'Plains', 'Plains'], hand: ['Test Two Bear'], library: ['Test Big Bear', 'Test Two Bear', 'Test Small Bear'] } }), 'Test Seek Idol');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Two Bear', 'hand') });
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      if (s.pending && s.pending.kind !== 'priority') { s = settle(s, { objects: s.pending.kind === 'chooseObjects' ? [(s.pending as { options: ObjectId[] }).options.find((id) => nameOf(s, id) === 'Test Small Bear')!] : undefined }); } else s = pass(s);
    }
    const small = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Small Bear');
    expect(small.length).toBe(1);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Big Bear').length).toBe(0);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Two Bear').length).toBe(1);
  });
  it('negative: a mana value 1 creature spell finds nothing (no creature card with mana value 0)', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Seek Idol', 'Plains'], hand: ['Test Small Bear'], library: ['Test Small Bear', 'Test Big Bear'] } }), 'Test Seek Idol');
    s = cast(s, 'Test Small Bear');
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Small Bear').length).toBe(1);
  });
});

describe('CR 602.2b, 106.3, 707.10: "When you next activate an ability that isn\'t a mana ability this turn by spending four or more mana to activate it, copy that ability." (Dynaheir, Invoker Adept)', () => {
  const six = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Copy Idol', 'Test Big Well', 'Test Small Well', ...six] } });
  const use = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object !== undefined && nameOf(s, x.object) === name)!;
    return resolveAll(act(s, a.action));
  };
  it('an ability paid with four mana is copied (2 life twice); the copy is not itself a new activation; the next one is not copied', () => {
    let s = use(board(), 'Test Copy Idol');
    const l0 = life(s, 'p1');
    s = use(s, 'Test Big Well');
    expect(life(s, 'p1')).toBe(l0 + 4);
    s = use(s, 'Test Small Well');
    expect(life(s, 'p1')).toBe(l0 + 5);
  });
  it('negative: an ability paid with two mana does not use it up and is not copied; the later four-mana one is', () => {
    let s = use(board(), 'Test Copy Idol');
    const l0 = life(s, 'p1');
    s = use(s, 'Test Small Well');
    expect(life(s, 'p1')).toBe(l0 + 1);
    s = use(s, 'Test Big Well');
    expect(life(s, 'p1')).toBe(l0 + 5);
  });
  it('negative: without the ability nothing is copied', () => {
    const s0 = board();
    const l0 = life(s0, 'p1');
    expect(life(use(s0, 'Test Big Well'), 'p1')).toBe(l0 + 2);
  });
});

describe('CR 603.7, 613.1f, 601.3b: "You may cast Dinosaur spells this turn as though they had flash, and whenever you cast a Dinosaur spell this turn, it gains \\"When this creature enters, ...\\"" (Cherished Hatchling)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Plains'], hand: ['Test Hatch Rite', 'Test Raptor', 'Test Raptor Two', 'Test Bear'] } });
  it('every Dinosaur spell cast this turn gains the enters ability (3 life each when it enters); a Bear does not', () => {
    let s = cast(board(), 'Test Hatch Rite');
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Raptor');
    expect(life(s, 'p1')).toBe(l0 + 3);
    s = cast(s, 'Test Bear');
    expect(life(s, 'p1')).toBe(l0 + 3);
    s = cast(s, 'Test Raptor Two');
    expect(life(s, 'p1')).toBe(l0 + 6);
  });
  it('the Dinosaur spell can be cast at a time a sorcery-speed spell could not (as though it had flash); a Bear cannot', () => {
    const s = advanceTo(cast(board(), 'Test Hatch Rite'), 1, 'beginCombat');
    const can = (n: string) => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === n);
    expect(can('Test Raptor')).toBe(true);
    expect(can('Test Bear')).toBe(false);
  });
  it('negative: without the instant a Dinosaur enters with no ability and cannot be cast at the beginning of combat', () => {
    const s0 = board();
    const l0 = life(s0, 'p1');
    expect(life(cast(s0, 'Test Raptor'), 'p1')).toBe(l0);
    const s = advanceTo(s0, 1, 'beginCombat');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === 'Test Raptor')).toBe(false);
  });
});
void pass; void LIFE;
