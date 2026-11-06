/**
 * edh-next-89 (Commander top-rank part 5, EDHREC ranks 10,501-12,000; code edhn89): played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Three players (Commander is multiplayer). CR cites checked against the Comprehensive Rules of
 * 2026-09-25 where a line says so; the others are written from memory and listed as unverified in the record.
 *
 *   CR 701.6a, 118.12, 701.9a, 608.2c   "Counter target spell unless its controller discards a card.": the spell's controller may discard one card to keep it
 *   CR 603.7, 603.4, 608.2c             "At the beginning of the next end step, exile those tokens unless you control an artifact.": the condition is judged when the step begins
 *   CR 111.4, 608.2c, 603.2             "create that many tokens. They have "...": the tokens made by the combat damage trigger have the ability
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, full, tokens, cast as cmdCast } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const exileCount = (s: GameState): number => s.zones.exile.length;

interface Script { targets?: ObjectId[]; yes?: boolean | ((prompt: string, who: PlayerId) => boolean); until?: (state: GameState) => boolean }
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 400; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: typeof sc.yes === 'function' ? sc.yes(d.prompt, d.player) : sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const cast = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => cmdCast(s, name, {}, player);
const castIt = (s: GameState, player: PlayerId, name: string): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);

describe('CR 701.6a, 118.12, 701.9a: "Counter that spell unless its controller discards a card."', () => {
  const RITE = card('Test Perplex Rite', 'Instant', 'Counter target spell unless its controller discards a card.');
  const SPELL = card('Test Gain Spell', 'Sorcery', 'You gain 5 life.');
  const LOT = card('Test Perplex Lot', 'Sorcery', '');
  const defs = [RITE, SPELL, LOT];
  const setup = (hand: string[]): GameState => mpScenario({ defs, zones: { p1: { hand }, p2: { hand: ['Test Perplex Rite'] } } });
  const play = (hand: string[], keep: boolean): GameState => {
    let s = castIt(setup(hand), 'p1', 'Test Gain Spell');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's priority");
    s = castIt(s, 'p2', 'Test Perplex Rite');
    s = run(s, { targets: [s.zones.stack[0]!], yes: keep, until: (x) => x.zones.stack.length === 0 });
    return s;
  };
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('the spell\'s controller may discard ONE card to keep the spell: it resolves, exactly one card leaves the hand', () => {
    const s = play(['Test Gain Spell', 'Test Perplex Lot', 'Test Perplex Lot'], true);
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(handNames(s, 'p1')).toHaveLength(1);
    expect(yard(s, 'p1')).toContain('Test Perplex Lot');
  });
  it('if they decline the spell is countered and the hand is kept whole', () => {
    const s = play(['Test Gain Spell', 'Test Perplex Lot', 'Test Perplex Lot'], false);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handNames(s, 'p1')).toEqual(['Test Perplex Lot', 'Test Perplex Lot']);
    expect(yard(s, 'p1')).toEqual(['Test Gain Spell']);
  });
});

describe('CR 603.7, 603.4, 608.2c: "At the beginning of the next end step, exile those tokens unless you control an artifact."', () => {
  const FLASH = card('Test Flash Spirits', 'Instant', 'Create two 1/1 red Elemental creature tokens. At the beginning of the next end step, exile those tokens unless you control an artifact.');
  const GEM = card('Test Gem Maker', 'Instant', 'Create a Treasure token.');
  const defs = [FLASH, GEM];
  const toEnd = (s: GameState): GameState => passUntil(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority', 'the end step');
  const afterEnd = (s: GameState): GameState => passUntil(s, (x) => x.turn.step === 'cleanup' || x.turn.step === 'untap' || x.turn.activePlayer !== 'p1', 'after the end step');
  it('is automated', () => expect(full(FLASH)).toBe(true));
  it('without an artifact at the end step the two tokens are exiled', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Flash Spirits'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Flash Spirits'));
    expect(tokens(s)).toHaveLength(2);
    s = run(toEnd(s), { until: (x) => x.turn.step !== 'end' });
    expect(tokens(s)).toHaveLength(0);
  });
  it('the condition is judged when the end step begins: an artifact made after the spell resolved keeps the tokens', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Flash Spirits', 'Test Gem Maker'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Flash Spirits'));
    s = run(castIt(s, 'p1', 'Test Gem Maker'));
    expect(tokens(s).length).toBe(3);
    s = run(toEnd(s), { until: (x) => x.turn.step !== 'end' });
    expect(tokens(s).length).toBe(3);
  });
  it('an artifact present when the spell resolves but gone by the end step does not keep them (judged at the end step, not on resolution)', () => {
    const KILL = card('Test Smash Rite', 'Instant', 'Destroy target artifact.');
    let s = toMain(mpScenario({ defs: [...defs, KILL], zones: { p1: { hand: ['Test Flash Spirits', 'Test Gem Maker', 'Test Smash Rite'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Gem Maker'));
    s = run(castIt(s, 'p1', 'Test Flash Spirits'));
    const gem = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && getChars(s, id)!.types.includes('Artifact'))!;
    s = run(castIt(s, 'p1', 'Test Smash Rite'), { targets: [gem] });
    s = run(toEnd(s), { until: (x) => x.turn.step !== 'end' });
    expect(tokens(s)).toHaveLength(0);
    expect(exileCount(s)).toBeGreaterThanOrEqual(0);
  });
});

describe('CR 111.4, 608.2c, 603.2: "create that many ... tokens. They have "Sacrifice this token: Add {C}.""', () => {
  const EATER = card('Test Spawn Eater', 'Creature — Eldrazi Drone', 'Whenever this creature deals combat damage to a player, create that many 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this token: Add {C}."', ['2', '2']);
  const defs = [EATER];
  it('is automated', () => expect(full(EATER)).toBe(true));
  it('unblocked it makes one token per point of damage (2), and each one has the sacrifice mana ability', () => {
    let s = toMain(mpScenario({ defs, zones: { p2: { battlefield: ['Test Spawn Eater'] } } }), 'p2');
    const eater = mfind(s, 'Test Spawn Eater', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[eater, 'p3']]);
    s = run(s, { until: (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2' });
    const t = tokens(s, 'p2');
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(t).toHaveLength(2);
    for (const id of t) expect(getChars(s, id)!.abilities.length).toBeGreaterThanOrEqual(1);
  });
  it('negative: a blocked attacker deals its damage to the blocker, not to a player: no tokens', () => {
    const WALL = card('Test Plain Wall', 'Creature — Wall', '', ['0', '4']);
    let s = toMain(mpScenario({ defs: [EATER, WALL], zones: { p2: { battlefield: ['Test Spawn Eater'] }, p3: { battlefield: ['Test Plain Wall'] } } }), 'p2');
    const eater = mfind(s, 'Test Spawn Eater', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[eater, 'p3']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    s = manswer(s, { kind: 'declareBlockers', blocks: [{ blocker: bf(s, 'Test Plain Wall', 'p3')[0]!, attacker: eater }] } as DecisionAnswer);
    s = run(s, { until: (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2' });
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(tokens(s, 'p2')).toHaveLength(0);
  });
});

describe('CR 122.1, 701.28a, 712.14, 608.2c: "Then if ~ has N or more ember counters on it, remove them and transform ~."', () => {
  const face = (name: string, text: string, pt: [string, string], type = 'Creature — Dragon') => ({ name, mana_cost: '{0}', type_line: type, oracle_text: text, power: pt[0], toughness: pt[1], colors: [] as string[], keywords: [] as string[] });
  const EGG = compileCard({
    name: 'Test Ember Egg // Test Ember Dragon', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Dragon Egg // Creature — Dragon', oracle_text: '', colors: [], keywords: [],
    card_faces: [
      face('Test Ember Egg', 'Whenever you cast a spell, put a number of ember counters on this creature equal to the amount of mana spent to cast that spell. Then if this creature has three or more ember counters on it, remove them and transform this creature.', ['0', '4'], 'Creature — Dragon Egg'),
      face('Test Ember Dragon', 'Flying', ['4', '4']),
    ],
  } as unknown as OracleCard);
  const ONE = card('Test Spark One', 'Instant', 'You gain 1 life.', undefined, '{1}');
  const TWO = card('Test Spark Two', 'Instant', 'You gain 1 life.', undefined, '{2}');
  const LAND = card('Test Ember Land', 'Land', '{T}: Add {R}.');
  const defs = [EGG, ONE, TWO, LAND];
  const setup = (hand: string[]): GameState => toMain(mpScenario({ defs, zones: { p1: { hand, battlefield: ['Test Ember Egg // Test Ember Dragon', 'Test Ember Land', 'Test Ember Land', 'Test Ember Land'] } } }), 'p1');
  const egg = (s: GameState): ObjectId => mfind(s, 'Test Ember Egg // Test Ember Dragon', 'battlefield', 'p1');
  it('is automated', () => expect(full(card('x', 'Creature — Dragon', '')) && EGG.automation.level === 'full').toBe(true));
  it('two mana spent = two ember counters, still the Egg; one more mana (three in all) removes them and transforms it', () => {
    let s = setup(['Test Spark Two', 'Test Spark One']);
    s = run(cast(s, 'Test Spark Two'));
    expect(s.objects[egg(s)]!.counters['ember']).toBe(2);
    expect(s.objects[egg(s)]!.face).toBe(0);
    s = run(cast(s, 'Test Spark One'));
    expect(s.objects[egg(s)]!.counters['ember'] ?? 0).toBe(0);
    expect(s.objects[egg(s)]!.face).toBe(1);
  });
  it('negative: below three counters nothing is removed and it does not transform', () => {
    let s = setup(['Test Spark One']);
    s = run(cast(s, 'Test Spark One'));
    expect(s.objects[egg(s)]!.counters['ember']).toBe(1);
    expect(s.objects[egg(s)]!.face).toBe(0);
  });
});

describe('CR 508.1a, 400.7, 603.2: "Put a +1/+1 counter on each creature you control that didn\'t attack or enter this turn. Untap those creatures."', () => {
  const DOC = card('Test Doctor Banner', 'Enchantment', 'At the beginning of your end step, put a +1/+1 counter on each creature you control that didn\'t attack or enter this turn. Untap those creatures.');
  const IDLE = card('Test Idle Hound', 'Creature — Dog', '', ['1', '1']);
  const RAIDER = card('Test Raid Hound', 'Creature — Dog', '', ['1', '1']);
  const LATE = card('Test Late Hound', 'Creature — Dog', '', ['1', '1']);
  const defs = [DOC, IDLE, RAIDER, LATE];
  it('is automated', () => expect(full(DOC)).toBe(true));
  it('only the creature that neither attacked nor entered gets the counter at the end step; the attacker and the new arrival do not', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Doctor Banner', 'Test Idle Hound', 'Test Raid Hound'], hand: ['Test Late Hound'] } } }), 'p1');
    s = run(cast(s, 'Test Late Hound'));
    const raider = mfind(s, 'Test Raid Hound', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[raider, 'p2']]);
    s = run(s, { until: (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2' });
    s = run(passUntil(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority', 'the end step'), { until: (x) => x.turn.step !== 'end' });
    const c = (n: string): number => s.objects[mfind(s, n, 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
    expect(c('Test Idle Hound')).toBe(1);
    expect(c('Test Raid Hound')).toBe(0);
    expect(c('Test Late Hound')).toBe(0);
  });
});

describe('CR 608.2d, 101.4, 120.3: "When ~ enters, any opponent may have it deal 4 damage to them. If a player does, sacrifice ~."', () => {
  const DEVIL = card('Test Pesky Devil', 'Creature — Devil', 'When this creature enters, any opponent may have it deal 4 damage to them. If a player does, sacrifice this creature.', ['3', '3']);
  const defs = [DEVIL];
  const play = (yes: (who: PlayerId) => boolean): GameState => run(cast(mpScenario({ defs, zones: { p1: { hand: ['Test Pesky Devil'] } } }), 'Test Pesky Devil'), { yes: (_p, who) => yes(who) });
  it('is automated', () => expect(full(DEVIL)).toBe(true));
  it('an opponent who accepts takes 4 damage from it and the Devil is sacrificed', () => {
    const s = play((who) => who === 'p2');
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(bf(s, 'Test Pesky Devil')).toHaveLength(0);
    expect(yard(s, 'p1')).toContain('Test Pesky Devil');
  });
  it('the first opponent in turn order who accepts is the one: p2 declines, p3 accepts, p4 is not asked to take it', () => {
    const s = play((who) => who === 'p3' || who === 'p4');
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p3')).toBe(16);
    expect(lifeOf(s, 'p4')).toBe(20);
    expect(bf(s, 'Test Pesky Devil')).toHaveLength(0);
  });
  it('negative: if every opponent declines nobody is damaged and the Devil stays', () => {
    const s = play(() => false);
    for (const p of ['p2', 'p3', 'p4'] as const) expect(lifeOf(s, p)).toBe(20);
    expect(bf(s, 'Test Pesky Devil', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.12a, 613.4b, 119.7: "Exchange your life total with ~\'s power."', () => {
  const OAK = card('Test Power Oak', 'Creature — Plant', '{0}: Exchange your life total with this creature\'s power.', ['4', '4']);
  const BAN = card('Test Life Ban', 'Enchantment', "Players can't gain life.");
  const defs = [OAK, BAN];
  const powerOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
  const activate = (s: GameState, id: ObjectId): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === id);
    if (a === undefined) throw new Error('no activation');
    return run(mact(s, a.action));
  };
  it('is automated', () => expect(full(OAK)).toBe(true));
  it('life 20 and power 4: afterwards life is 4 and the creature is 20/4, for good', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Power Oak'] } } });
    const oak = mfind(s, 'Test Power Oak', 'battlefield', 'p1');
    s = activate(s, oak);
    expect(lifeOf(s, 'p1')).toBe(4);
    expect(powerOf(s, oak)).toBe('20/4');
  });
  it('negative: a player who can\'t gain life makes no part of the exchange happen (life 2, power 4)', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Power Oak', 'Test Life Ban'] } } });
    s = structuredClone(s);
    s.players.find((x) => x.id === 'p1')!.life = 2;
    const oak = mfind(s, 'Test Power Oak', 'battlefield', 'p1');
    s = activate(s, oak);
    expect(lifeOf(s, 'p1')).toBe(2);
    expect(powerOf(s, oak)).toBe('4/4');
  });
});
