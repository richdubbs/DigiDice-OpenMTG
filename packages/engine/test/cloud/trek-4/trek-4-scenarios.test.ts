/**
 * Lane trek, round trek-4 (Star Trek: clone with counters, phasing), played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 702.26c, 502.1, 101.2  "Permanents can't phase in.": a phased-out permanent stays phased out in its controller's untap step while the effect applies;
 *                             once the source is gone it phases in; a phased-out source has no effect (CR 702.26b)
 *   CR 702.26c, 101.2         "Creatures your opponents control can't phase in.": the subject is matched against the permanent as it would be phased in
 *   CR 702.26g                an Aura phased out with its creature stays out with it
 *   CR 714, 702.26b           a Saga: "All artifacts and creatures phase out. Create a 0/1 white Human creature token with "Permanents can't phase in.""; the
 *                             permanents phase in again only after the token is sacrificed
 *   CR 614.1c, 707.9b, 122.6  "If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on
 *                             it": the copied permanent's counters, kind by kind; none when declining or copying a permanent without counters
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const out = (s: GameState, id: ObjectId): boolean => s.objects[id]!.phasedOut;

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);
/** Pass to the given turn's precombat main phase, resolving what triggers on the way (a Saga's chapter abilities, CR 714.3b-c). */
const toMain = (s: GameState, turn: number, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(advanceTo(s, turn, 'main1'), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ROCK = card('Test Rock', 'Artifact', '');
const VEIL = card('Test Fold Veil', 'Instant', 'Target creature phases out.');
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const HUSH = card('Test Hush', 'Sorcery', 'All creatures phase out.');
const WARDEN = card('Test Stasis Warden', 'Creature — Human', "Permanents can't phase in.", { pt: ['0', '1'] });
const SENTRY = card('Test Stasis Sentry', 'Creature — Human', "Creatures your opponents control can't phase in.", { pt: ['0', '1'] });
const HALO = card('Test Halo', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');

// ---- CR 702.26c: "can't phase in" -------------------------------------------------------------------------------------------------------------------------

describe('CR 702.26c, 502.1, 101.2: "Permanents can\'t phase in."', () => {
  const defs = [BEAR, VEIL, DOOM, WARDEN];
  it('is fully automated', () => expect(full(WARDEN)).toBe(true));
  it('a creature phased out stays phased out in its controller\'s untap steps while the Warden is on the battlefield; once the Warden is gone it phases in', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fold Veil', 'Test Doom'], battlefield: ['Test Stasis Warden'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const warden = find(s, 'Test Stasis Warden', 'battlefield', 'p1');
    s = cast(s, 'Test Fold Veil', { targets: [[bear]] });
    expect(out(s, bear)).toBe(true);
    s = advanceTo(s, 2, 'upkeep'); // p2's untap step (CR 502.1)
    expect(out(s, bear)).toBe(true);
    s = advanceTo(s, 4, 'upkeep');
    expect(out(s, bear)).toBe(true);
    s = toMain(s, 5);
    s = cast(s, 'Test Doom', { targets: [[warden]] });
    expect(s.objects[warden]?.zone ?? 'gone').not.toBe('battlefield');
    s = advanceTo(s, 6, 'upkeep'); // the negative case: nothing keeps it out now
    expect(out(s, bear)).toBe(false);
  });
  it('CR 702.26b: a phased-out Warden has no effect: the Warden and the Bear phased out together both phase in', () => {
    let s = scenario([], { defs: [...defs, HUSH], p1: { hand: ['Test Hush'], battlefield: ['Test Stasis Warden', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const warden = find(s, 'Test Stasis Warden', 'battlefield', 'p1');
    s = cast(s, 'Test Hush');
    expect([out(s, bear), out(s, warden)]).toEqual([true, true]);
    s = advanceTo(s, 3, 'upkeep');
    expect([out(s, bear), out(s, warden)]).toEqual([false, false]);
  });
  it('CR 702.26g: an Aura phased out with its creature stays out with it', () => {
    let s = scenario([], { defs: [...defs, HALO], p1: { hand: ['Test Fold Veil', 'Test Halo'], battlefield: ['Test Stasis Warden'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Halo', { targets: [[bear]] });
    const halo = find(s, 'Test Halo', 'battlefield', 'p1');
    expect(s.objects[halo]!.attachedTo).toBe(bear);
    s = cast(s, 'Test Fold Veil', { targets: [[bear]] });
    expect([out(s, bear), out(s, halo)]).toEqual([true, true]);
    s = advanceTo(s, 2, 'upkeep');
    expect([out(s, bear), out(s, halo)]).toEqual([true, true]);
  });
});

describe('CR 702.26c, 101.2: "Creatures your opponents control can\'t phase in." is matched against the permanent as it would be phased in', () => {
  const defs = [BEAR, VEIL, SENTRY];
  it('is fully automated', () => expect(full(SENTRY)).toBe(true));
  it('the opponent\'s phased-out Bear stays out; the Sentry controller\'s own Bear phases in (the negative case)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fold Veil', 'Test Fold Veil'], battlefield: ['Test Stasis Sentry', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Fold Veil', { targets: [[mine]] });
    s = cast(s, 'Test Fold Veil', { targets: [[theirs]] });
    expect([out(s, mine), out(s, theirs)]).toEqual([true, true]);
    s = advanceTo(s, 2, 'upkeep');
    expect(out(s, theirs)).toBe(true);
    s = advanceTo(s, 3, 'upkeep');
    expect(out(s, mine)).toBe(false);
    s = advanceTo(s, 4, 'upkeep');
    expect(out(s, theirs)).toBe(true);
  });
});

// ---- CR 714: the Saga ----------------------------------------------------------------------------------------------------------------------------------------

describe('CR 714, 702.26b-c: a Saga whose chapter I phases out all artifacts and creatures and creates a token with "Permanents can\'t phase in."', () => {
  const SAGA = card('Test Frozen Hour', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\n'
    + 'I — All artifacts and creatures phase out. Create a 0/1 white Human creature token with "Permanents can\'t phase in."\n'
    + 'II — You draw two cards and each player loses 2 life.\n'
    + 'III — Sacrifice a creature token. If you do, you gain 5 life.');
  const defs = [BEAR, ROCK, SAGA];
  it('is fully automated', () => expect(full(SAGA)).toBe(true));
  it('every artifact and creature (both players\') stays phased out until the token is sacrificed by chapter III; then each phases in in its controller\'s untap step', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Frozen Hour'], battlefield: ['Test Bear', 'Test Rock'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const rock = find(s, 'Test Rock', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Frozen Hour');
    expect([out(s, mine), out(s, rock), out(s, theirs)]).toEqual([true, true, true]);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    expect(out(s, tokens[0]!)).toBe(false); // created after the others phased out
    expect(chars(s, tokens[0]!).subtypes).toEqual(['Human']);
    s = toMain(s, 2);
    expect(out(s, theirs)).toBe(true);
    s = toMain(s, 3); // chapter II
    expect([out(s, mine), out(s, rock)]).toEqual([true, true]);
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(18);
    s = toMain(s, 4);
    expect(out(s, theirs)).toBe(true);
    s = toMain(s, 5); // chapter III: the token is sacrificed, you gain 5 life; the Saga is sacrificed (CR 714.4)
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toEqual([]);
    expect(life(s, 'p1')).toBe(23);
    expect(findAll(s, 'Test Frozen Hour', 'battlefield').length).toBe(0);
    s = advanceTo(s, 6, 'upkeep');
    expect(out(s, theirs)).toBe(false);
    expect([out(s, mine), out(s, rock)]).toEqual([true, true]); // p1's phase in during p1's untap step only (CR 502.1)
    s = advanceTo(s, 7, 'upkeep');
    expect([out(s, mine), out(s, rock)]).toEqual([false, false]);
  });
});

// ---- CR 614.1c, 707.9: the copied permanent's counters ------------------------------------------------------------------------------------------------------

describe('CR 614.1c, 707.9b, 122.6: "If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it."', () => {
  const KING = card('Test King', 'Legendary Creature — Human Noble', 'Vigilance', { pt: ['3', '3'] });
  const SHIFTER = card('Test Infiltrator', 'Creature — Shapeshifter', "You may have this creature enter as a copy of any artifact or creature on the battlefield, except it isn't legendary. "
    + 'If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it.', { pt: ['3', '3'] });
  const PLAIN = card('Test Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield. '
    + 'If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it.', { pt: ['1', '1'] });
  const defs = [KING, BEAR, ROCK, SHIFTER, PLAIN];
  it('both wordings are fully automated', () => {
    expect(full(SHIFTER)).toBe(true);
    expect(full(PLAIN)).toBe(true);
  });
  it('a copy of the legendary King with two +1/+1 counters and a stun counter: not legendary, with the same counters (a 5/5); the King keeps its own', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Infiltrator'] }, p2: { battlefield: [{ name: 'Test King', counters: { '+1/+1': 2, stun: 1 } }] } });
    const king = find(s, 'Test King', 'battlefield', 'p2');
    s = cast(s, 'Test Infiltrator');
    const copies = findAll(s, 'Test Infiltrator', 'battlefield', 'p1');
    expect(copies.length).toBe(1);
    const c = copies[0]!;
    expect(chars(s, c).name).toBe('Test King');
    expect(chars(s, c).supertypes).not.toContain('Legendary');
    expect(s.objects[c]!.counters).toEqual({ '+1/+1': 2, stun: 1 });
    expect([chars(s, c).power, chars(s, c).toughness]).toEqual(['5', '5']);
    expect(s.objects[king]!.counters).toEqual({ '+1/+1': 2, stun: 1 });
    expect(s.objects[king]!.zone).toBe('battlefield'); // no legend rule: the copy isn't legendary (CR 704.5j)
  });
  it('an artifact with charge counters: the copy enters with as many charge counters', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Infiltrator'], battlefield: [{ name: 'Test Rock', counters: { charge: 3 } }] } });
    s = cast(s, 'Test Infiltrator');
    const c = findAll(s, 'Test Infiltrator', 'battlefield', 'p1')[0]!;
    expect(chars(s, c).types).toEqual(['Artifact']);
    expect(s.objects[c]!.counters).toEqual({ charge: 3 });
  });
  it('the negative cases: declining the copy, it enters as itself with no counters; a copy of a creature without counters gets none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mimic', 'Test Mimic'] }, p2: { battlefield: [{ name: 'Test King', counters: { '+1/+1': 2 } }, 'Test Bear'] } });
    s = cast(s, 'Test Mimic', { yes: false, pick: () => [] });
    const own = findAll(s, 'Test Mimic', 'battlefield', 'p1');
    expect(own.length).toBe(1);
    expect(s.objects[own[0]!]!.counters).toEqual({});
    expect([chars(s, own[0]!).power, chars(s, own[0]!).toughness]).toEqual(['1', '1']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Mimic', { pick: (options) => (options.includes(bear) ? [bear] : []) });
    const copy = findAll(s, 'Test Mimic', 'battlefield', 'p1').find((id) => chars(s, id).name === 'Test Bear')!;
    expect(copy).toBeDefined();
    expect(s.objects[copy]!.counters).toEqual({});
  });
});

describe('fail closed (guide section 9): the wordings the reading does not give', () => {
  it('"If you don\'t, it enters with additional counters ..." is not automated', () => {
    expect(full(card('Test Odd Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield. '
      + "If you don't, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it.", { pt: ['1', '1'] }))).toBe(false);
  });
  it('"Permanents can\'t phase in this turn." (a duration) is not automated by the static reading', () => {
    expect(full(card('Test Brief Warden', 'Creature — Human', "Permanents can't phase in this turn.", { pt: ['0', '1'] }))).toBe(false);
  });
});
