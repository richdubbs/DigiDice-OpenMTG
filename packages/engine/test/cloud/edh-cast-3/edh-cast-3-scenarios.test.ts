/**
 * edh-cast-3 scenarios (Commander lane edh-cast): the casting rules of the round, played through the engine with synthetic cards (invented names) compiled by the game's
 * default compiler. Rules (Comprehensive Rules 2026-09-25, cited from the real text):
 *   CR 601.2f, 118.7, 120.1, 120.2  a cost reduced by the damage dealt to the opponents this turn: noncombat damage only, to opponents only (Chandra's Incinerator)
 *   CR 601.2f, 119.3, 120.3a        a cost reduced by the life ALL the opponents lost this turn, added up (Rakdos, Lord of Riots)
 *   CR 601.2f, 109.4, 102.3         a cost reduced by the greatest number of artifacts ONE opponent controls, not the total (Cavern-Hoard Dragon)
 *   CR 117.1a, 307.1, 101.2         "Each opponent can cast spells only any time they could cast a sorcery": no instant or flash timing (Teferi, Time Raveler)
 *   CR 601.3b, 702.8a, 611.2a       "Until your next turn, you may cast sorcery spells as though they had flash", and the end of it
 *   CR 601.2i, 101.2                "Each player who has cast a nonartifact spell this turn can't cast additional nonartifact spells" (Ethersworn Canonist)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const give = (s: GameState, player: string, mana: string): void => { for (const t of mana) s.players.find((p) => p.id === player)!.manaPool.push({ type: t } as never); };
const canCast = (s: GameState, id: ObjectId, player = 'p1'): boolean => {
  try { return settle(act(s, { type: 'cast', player, card: id })).zones.stack.length > 0; } catch { return false; }
};
const hand = (s: GameState, name: string, player = 'p1'): ObjectId => find(s, name, 'hand', player);
/** Cast the named card from hand at a player or object and let the whole stack resolve. */
function castAt(s0: GameState, name: string, target: TargetChoice | null, player = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: hand(s0, name, player) });
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: target === null ? [] : [target] });
    else s = settle(s);
  }
  return resolveAll(s);
}
const toPlayer = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

const ZAP = card('Test Zap', 'Sorcery', 'Test Zap deals 3 damage to target player.');
const BOLT = card('Test Bolt', 'Sorcery', 'Test Bolt deals 2 damage to target player.');

describe('CR 601.2f, 120.1: a cost reduced by the noncombat damage dealt to your opponents this turn', () => {
  const FURNACE = card('Test Furnace', 'Creature — Elemental', 'This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn.', { pt: ['3', '3'], cost: '{4}{R}', colors: ['R'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [ZAP, FURNACE, BEAR];
  const mk = (): GameState => scenario([], { p1: { hand: ['Test Zap', 'Test Furnace'] }, defs });
  it('before any damage the spell costs its full {4}{R}', () => {
    const s = mk();
    give(s, 'p1', 'RR');
    expect(canCast(s, hand(s, 'Test Furnace'))).toBe(false);
  });
  it('3 damage to the opponent makes it {1}{R}', () => {
    let s = mk();
    s = castAt(s, 'Test Zap', toPlayer('p2'));
    give(s, 'p1', 'RR');
    expect(canCast(s, hand(s, 'Test Furnace'))).toBe(true);
    const s2 = mk();
    give(s2, 'p1', 'RR');
    expect(canCast(s2, hand(s2, 'Test Furnace'))).toBe(false);
  });
  it('damage dealt to you (not an opponent) does not count', () => {
    let s = mk();
    s = castAt(s, 'Test Zap', toPlayer('p1'));
    give(s, 'p1', 'RR');
    expect(canCast(s, hand(s, 'Test Furnace'))).toBe(false);
  });
  it('combat damage to an opponent does not count (CR 120.1: noncombat damage only)', () => {
    let s = scenario([], { p1: { hand: ['Test Furnace'], battlefield: ['Test Bear'] }, defs });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18); // the bear connected
    give(s, 'p1', 'RR');
    expect(canCast(s, hand(s, 'Test Furnace'))).toBe(false);
  });
});

describe('CR 120.1, 601.2f: the damage amounts are added up, not counted', () => {
  const FURNACE = card('Test Furnace', 'Creature — Elemental', 'This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn.', { pt: ['3', '3'], cost: '{4}{R}', colors: ['R'] });
  it('two damage entries of 3 and 2 make {5} less: {R} is enough', () => {
    let s = scenario([], { p1: { hand: ['Test Zap', 'Test Bolt', 'Test Furnace'] }, defs: [ZAP, BOLT, FURNACE] });
    s = castAt(s, 'Test Zap', toPlayer('p2'));
    s = castAt(s, 'Test Bolt', toPlayer('p2'));
    give(s, 'p1', 'R');
    expect(canCast(s, hand(s, 'Test Furnace'))).toBe(true);
  });
});

describe('CR 601.2f, 119.3: a cost reduced by the life all your opponents lost this turn', () => {
  const RAKDOS = card('Test Lord', 'Creature — Demon', 'Creature spells you cast cost {1} less to cast for each 1 life your opponents have lost this turn.', { pt: ['6', '5'] });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['4', '4'], cost: '{5}{G}', colors: ['G'] });
  const DRAKE = card('Test Drake', 'Artifact', '', { cost: '{5}{G}' });
  const defs = [RAKDOS, GIANT, DRAKE, ZAP, BOLT];
  it('with two opponents that lost 3 and 2 life, a creature spell costs {5} less (the sum)', () => {
    let s = mpScenario({ defs, cards: [], zones: { p1: { hand: ['Test Zap', 'Test Bolt', 'Test Giant'], battlefield: ['Test Lord'] } } });
    s = castAt(s, 'Test Zap', toPlayer('p2'));
    s = castAt(s, 'Test Bolt', toPlayer('p3'));
    give(s, 'p1', 'G');
    expect(canCast(s, hand(s, 'Test Giant'))).toBe(true);
  });
  it('life lost by an opponent who then lost the game still counts (CR 800.4i; the ruling of 2020-11-10)', () => {
    let s = mpScenario({ defs, cards: [], zones: { p1: { hand: ['Test Zap', 'Test Giant'], battlefield: ['Test Lord'] } } });
    s.players.find((p) => p.id === 'p2')!.life = 3;
    s = castAt(s, 'Test Zap', toPlayer('p2'));
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    give(s, 'p1', 'GGG');
    expect(canCast(s, hand(s, 'Test Giant'))).toBe(true); // {3} less of {5}{G} is {2}{G}: GGG pays it (the 3 life the dead opponent lost counts)
  });
  it('only 3 life lost in all is {3} less: {2}{G} is still needed', () => {
    let s = mpScenario({ defs, cards: [], zones: { p1: { hand: ['Test Zap', 'Test Giant'], battlefield: ['Test Lord'] } } });
    s = castAt(s, 'Test Zap', toPlayer('p2'));
    give(s, 'p1', 'G');
    expect(canCast(s, hand(s, 'Test Giant'))).toBe(false);
    give(s, 'p1', 'GGG');
    expect(canCast(s, hand(s, 'Test Giant'))).toBe(true);
  });
  it('your own life lost does not count, and a spell that is not a creature spell is not reduced', () => {
    let s = scenario([], { p1: { hand: ['Test Zap', 'Test Giant', 'Test Drake'], battlefield: ['Test Lord'] }, defs });
    s = castAt(s, 'Test Zap', toPlayer('p1'));
    give(s, 'p1', 'G');
    expect(canCast(s, hand(s, 'Test Giant'))).toBe(false);
    let t = scenario([], { p1: { hand: ['Test Zap', 'Test Drake'], battlefield: ['Test Lord'] }, defs });
    t = castAt(t, 'Test Zap', toPlayer('p2'));
    give(t, 'p1', 'G');
    expect(canCast(t, hand(t, 'Test Drake'))).toBe(false);
  });
});

describe('CR 601.2f, 109.4: a cost reduced by the greatest number of artifacts ONE opponent controls', () => {
  const HOARD = card('Test Hoard', 'Creature — Dragon', 'This spell costs {X} less to cast, where X is the greatest number of artifacts an opponent controls.', { pt: ['4', '4'], cost: '{4}{R}', colors: ['R'] });
  const GEM = card('Test Gem', 'Artifact', '');
  const defs = [HOARD, GEM];
  it('opponents with 2 and 3 artifacts: {3} less (the greatest), not {5} (the total)', () => {
    const s = mpScenario({ defs, cards: [], zones: { p1: { hand: ['Test Hoard'] }, p2: { battlefield: ['Test Gem', 'Test Gem'] }, p3: { battlefield: ['Test Gem', 'Test Gem', 'Test Gem'] } } });
    give(s, 'p1', 'R');
    expect(canCast(s, hand(s, 'Test Hoard'))).toBe(false);
    give(s, 'p1', 'R');
    expect(canCast(s, hand(s, 'Test Hoard'))).toBe(true);
  });
  it('your own artifacts do not count', () => {
    const s = scenario([], { p1: { hand: ['Test Hoard'], battlefield: ['Test Gem', 'Test Gem', 'Test Gem', 'Test Gem'] }, defs });
    give(s, 'p1', 'RRRR');
    expect(canCast(s, hand(s, 'Test Hoard'))).toBe(false);
    give(s, 'p1', 'R');
    expect(canCast(s, hand(s, 'Test Hoard'))).toBe(true);
  });
  it('with no artifact on the opponents\' side the spell costs its full price', () => {
    const s = scenario([], { p1: { hand: ['Test Hoard'] }, p2: { battlefield: ['Plains'] }, defs });
    give(s, 'p1', 'RRRR');
    expect(canCast(s, hand(s, 'Test Hoard'))).toBe(false);
  });
});

describe('CR 117.1a, 307.1, 101.2: "Each opponent can cast spells only any time they could cast a sorcery"', () => {
  const RAVELER = card('Test Raveler', 'Creature — Wizard', 'Each opponent can cast spells only any time they could cast a sorcery.', { pt: ['2', '3'] });
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
  const SIP2 = card('Test Gulp', 'Instant', 'You gain 2 life.');
  const FLASHER = card('Test Flasher', 'Creature — Bear', 'Flash', { pt: ['1', '1'] });
  const SORC = card('Test Sorc', 'Sorcery', 'You gain 3 life.');
  const defs = [RAVELER, SIP, SIP2, FLASHER, SORC];
  const setup = (raveler: boolean): GameState => scenario([], { p1: { battlefield: raveler ? ['Test Raveler'] : [], hand: ['Test Sip'] }, p2: { hand: ['Test Sip', 'Test Gulp', 'Test Flasher', 'Test Sorc'] }, defs });
  it('on the Raveler player\'s turn the opponent can\'t cast an instant or a flash creature (without Raveler they can)', () => {
    for (const [raveler, expected] of [[true, false], [false, true]] as const) {
      const s = pass(setup(raveler)); // p1 passes priority in the first main phase: p2 has it with an empty stack, on p1's turn
      expect(s.pending!.player).toBe('p2');
      expect(canCast(s, hand(s, 'Test Sip', 'p2'), 'p2'), `instant, raveler ${raveler}`).toBe(expected);
      expect(canCast(s, hand(s, 'Test Flasher', 'p2'), 'p2'), `flash, raveler ${raveler}`).toBe(expected);
    }
  });
  it('the Raveler player is not restricted: they cast an instant on the opponent\'s turn', () => {
    let s = advanceTo(setup(true), 2, 'main1');
    s = pass(s); // p2 (active) passes, p1 has priority with an empty stack
    expect(s.pending!.player).toBe('p1');
    expect(canCast(s, hand(s, 'Test Sip', 'p1'), 'p1')).toBe(true);
  });
  it('on their own turn, with an empty stack in a main phase, the opponent casts instants, sorceries and flash creatures; with a spell on the stack they can\'t', () => {
    let s = advanceTo(setup(true), 2, 'main1');
    expect(canCast(s, hand(s, 'Test Sorc', 'p2'), 'p2')).toBe(true);
    expect(canCast(s, hand(s, 'Test Flasher', 'p2'), 'p2')).toBe(true);
    s = settle(act(s, { type: 'cast', player: 'p2', card: hand(s, 'Test Sip', 'p2') }));
    expect(s.zones.stack.length).toBe(1);
    expect(s.pending!.player).toBe('p2'); // they hold priority with their own spell on the stack: not sorcery timing any more
    expect(canCast(s, hand(s, 'Test Gulp', 'p2'), 'p2')).toBe(false);
  });
  it('a permission to cast as though it had flash if you pay more does not get around it (CR 101.2; the ruling of 2024-01-12)', () => {
    const RAIN = card('Test Rout', 'Sorcery', 'You may cast this spell as though it had flash if you pay {2} more to cast it.\nYou gain 1 life.');
    for (const [raveler, expected] of [[true, false], [false, true]] as const) {
      const s = pass(scenario([], { p1: { battlefield: raveler ? ['Test Raveler'] : [] }, p2: { hand: ['Test Rout'] }, defs: [...defs, RAIN] }));
      give(s, 'p2', 'GG');
      expect(canCast(s, hand(s, 'Test Rout', 'p2'), 'p2'), `raveler ${raveler}`).toBe(expected);
    }
  });
  it('without Raveler the second instant with a spell on the stack is fine', () => {
    let s = advanceTo(setup(false), 2, 'main1');
    s = settle(act(s, { type: 'cast', player: 'p2', card: hand(s, 'Test Sip', 'p2') }));
    expect(canCast(s, hand(s, 'Test Gulp', 'p2'), 'p2')).toBe(true);
  });
});

describe('CR 307.5, 101.2: Teferi\'s restriction also stops an opponent\'s cast during a resolution (cascade)', () => {
  const RAVELER = card('Test Raveler', 'Creature — Wizard', 'Each opponent can cast spells only any time they could cast a sorcery.', { pt: ['2', '3'] });
  const CASC = card('Test Cascader', 'Creature — Bear', 'Cascade', { pt: ['2', '2'], cost: '{2}' });
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [RAVELER, CASC, CUB];
  const run = (raveler: 'p1' | 'p2' | null, caster: 'p1' | 'p2'): GameState => {
    let s = scenario([], { p1: { battlefield: raveler === 'p1' ? ['Test Raveler'] : [], hand: caster === 'p1' ? ['Test Cascader'] : [], library: caster === 'p1' ? ['Test Cub'] : [] }, p2: { battlefield: raveler === 'p2' ? ['Test Raveler'] : [], hand: caster === 'p2' ? ['Test Cascader'] : [], library: caster === 'p2' ? ['Test Cub', 'Test Cub'] : [] /* the first is drawn in the draw step of turn 2 */ }, defs });
    if (caster === 'p2') s = advanceTo(s, 2, 'main1');
    give(s, caster, 'GG');
    return resolveAll(settle(act(s, { type: 'cast', player: caster, card: hand(s, 'Test Cascader', caster) })));
  };
  const cubOnBattlefield = (s: GameState): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Cub');
  it('an opponent of the Raveler player cascades: the exiled card can\'t be cast', () => { const s = run('p1', 'p2'); expect(cubOnBattlefield(s)).toBe(false); expect(s.zones.library['p2']!.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(true); /* it went to the bottom of the library */ });
  it('without the Raveler the cascaded card is cast', () => { expect(cubOnBattlefield(run(null, 'p2'))).toBe(true); });
  it('the Raveler player\'s own cascade still works', () => { expect(cubOnBattlefield(run('p1', 'p1'))).toBe(true); });
});

describe('CR 601.3b, 702.8a, 611.2a: "Until your next turn, you may cast sorcery spells as though they had flash"', () => {
  const BOON = card('Test Boon', 'Instant', 'Until your next turn, you may cast sorcery spells as though they had flash.');
  const SORC = card('Test Sorc', 'Sorcery', 'You gain 3 life.');
  const CRE = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [BOON, SORC, CRE];
  it('on the opponent\'s turn the sorcery is castable; a creature spell is not; and it ends as your next turn begins', () => {
    let s = scenario([], { p1: { hand: ['Test Boon', 'Test Sorc', 'Test Cub'] }, defs });
    expect(canCast(pass(s), hand(s, 'Test Sorc'))).toBe(false); // (control: not yet, and not on p1's... p2's priority) -- see below
    s = castAt(s, 'Test Boon', null);
    s = advanceTo(s, 2, 'main1');
    s = pass(s); // p2 passes in their main phase; p1 has priority with an empty stack
    expect(s.pending!.player).toBe('p1');
    expect(canCast(s, hand(s, 'Test Sorc'))).toBe(true);
    expect(canCast(s, hand(s, 'Test Cub'))).toBe(false);
    const t = advanceTo(s, 3, 'upkeep'); // p1's next turn has begun: the permission is gone, and a sorcery needs a main phase
    expect(canCast(t, hand(t, 'Test Sorc'))).toBe(false);
  });
  it('a permission from a Boon cast by the opponent does not let you cast sorceries at instant speed', () => {
    let s = scenario([], { p1: { hand: ['Test Sorc'] }, p2: { hand: ['Test Boon'] }, defs });
    s = pass(s); // p2 has priority on p1's turn (empty stack) and casts the Boon
    s = castAt(s, 'Test Boon', null, 'p2');
    // back to p1 on their own turn the sorcery is castable only at sorcery timing, which it is (empty stack, main phase), so check on p2's turn instead
    s = advanceTo(s, 2, 'main1');
    s = pass(s);
    expect(s.pending!.player).toBe('p1');
    expect(canCast(s, hand(s, 'Test Sorc'))).toBe(false);
  });
});

describe('CR 601.2i, 101.2: "Each player who has cast a nonartifact spell this turn can\'t cast additional nonartifact spells"', () => {
  const CANON = card('Test Canon', 'Creature — Human Wizard', 'Each player who has cast a nonartifact spell this turn can\'t cast additional nonartifact spells.', { pt: ['2', '2'] });
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  const CUB2 = card('Test Whelp', 'Creature — Bear', '', { pt: ['1', '1'] });
  const GADGET = card('Test Gadget', 'Artifact', '');
  const GADGET2 = card('Test Widget', 'Artifact', '');
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
  const defs = [CANON, CUB, CUB2, GADGET, GADGET2, SIP];
  it('the first nonartifact spell is cast, the second is not; any number of artifact spells are', () => {
    let s = scenario([], { p1: { battlefield: ['Test Canon'], hand: ['Test Cub', 'Test Whelp', 'Test Gadget', 'Test Widget'] }, defs });
    expect(canCast(s, hand(s, 'Test Cub'))).toBe(true);
    s = castAt(s, 'Test Cub', null);
    expect(canCast(s, hand(s, 'Test Whelp'))).toBe(false);
    s = castAt(s, 'Test Gadget', null);
    expect(canCast(s, hand(s, 'Test Widget'))).toBe(true);
    s = castAt(s, 'Test Widget', null);
    expect(canCast(s, hand(s, 'Test Whelp'))).toBe(false);
  });
  it('an artifact spell first does not use up the one nonartifact spell', () => {
    let s = scenario([], { p1: { battlefield: ['Test Canon'], hand: ['Test Cub', 'Test Whelp', 'Test Gadget'] }, defs });
    s = castAt(s, 'Test Gadget', null);
    expect(canCast(s, hand(s, 'Test Cub'))).toBe(true);
  });
  it('spells cast before Canon entered count (CR 601.2i; the ruling of 2020-08-07)', () => {
    let s = scenario([], { p1: { hand: ['Test Cub', 'Test Whelp'] }, defs });
    s = castAt(s, 'Test Cub', null);
    put(s, 'p1', 'battlefield', 'Test Canon');
    expect(canCast(s, hand(s, 'Test Whelp'))).toBe(false);
  });
  it('each player has their own count: the opponent still casts one nonartifact spell, then no more', () => {
    let s = scenario([], { p1: { battlefield: ['Test Canon'], hand: ['Test Cub'] }, p2: { hand: ['Test Sip', 'Test Whelp'] }, defs });
    s = castAt(s, 'Test Cub', null);
    s = pass(s); // p2 has priority on p1's turn
    expect(canCast(s, hand(s, 'Test Sip', 'p2'), 'p2')).toBe(true);
    s = castAt(s, 'Test Sip', null, 'p2');
    expect(canCast(s, hand(s, 'Test Whelp', 'p2'), 'p2')).toBe(false);
  });
  it('without Canon nothing is limited', () => {
    let s = scenario([], { p1: { hand: ['Test Cub', 'Test Whelp'] }, defs });
    s = castAt(s, 'Test Cub', null);
    expect(canCast(s, hand(s, 'Test Whelp'))).toBe(true);
  });
});
