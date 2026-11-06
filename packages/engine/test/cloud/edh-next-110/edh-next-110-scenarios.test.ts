/**
 * edh-next-110 (concept lane tokens-counters): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names;
 * the wordings are the real cards', because the templates read exactly them). Scryfall rulings were fetched in the cloud session; the CR cites are from memory (unverified:
 * no rules/cr in a cloud checkout; 2026-09-25 numbering assumed).
 *
 *   CR 122.6, 122.6a, 400.7      "... for each +1/+1 counter you've put on creatures under your control this turn." (Iridescent Hornbeetle)
 *   CR 120.10, 120.4a, 603.4     "... if a creature or planeswalker an opponent controlled was dealt excess damage this turn" (Rith, Liberated Primeval)
 *   CR 608.2d, 102.1, 122.6      "Choose a player. They put ... Choose a second player to draw a card. Then choose a third player to create ..." (Gluntch, the Bestower)
 *   CR 111.4, 508.4, 603.7       "create Ragavan, a legendary 2/1 ... token. Ragavan enters tapped and attacking. Exile that token at end of combat." (Kari Zev, Skyship Raider)
 *   CR 608.2c, 611.2a, 613.1f    "Until end of turn, that creature gets +2/+0, gains trample if it's red, and gains vigilance if it's white." (Aurelia, Exemplar of Justice)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword as hasKw } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, put, scenario } from '../../m3/scenario';
import { passUntil, toDeclareAttackers, declareAttackers, toStep, tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { card, cast, counters, full, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => hasKw(getChars(s, id)!, k);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]?.name ?? s.objects[id]!.defId;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const colored = (d: CardDef, colors: string[]): CardDef => ({ ...d, faces: d.faces.map((f) => ({ ...f, colors: colors as never })) }) as CardDef;
void colored; void settle; void put; void findAll; void nameOf; void act; void answer;

/** Pass priority to the given step, declaring no attackers or blockers and giving these targets to an ability that asks; stops with the triggers of the step on the stack. */
function goTo(s0: GameState, step: string, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 200; guard++) {
    const d = s.pending;
    if (d === undefined || d === null) throw new Error('no decision pending');
    if (d.kind === 'priority' && s.turn.step === step) return s;
    if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else throw new Error(`unexpected decision ${d.kind} on the way to ${step}`);
  }
  throw new Error(`never reached ${step}`);
}
/** Pass to the beginning of the end step of the current turn and resolve what triggers there. */
const endStep = (s: GameState): GameState => resolveAll(goTo(s, 'end'));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BOON = card('Test Boon', 'Sorcery', 'Put two +1/+1 counters on target creature.');
const BOLT5 = card('Test Fireball', 'Instant', '~ deals 5 damage to target creature.');
const BOLT2 = card('Test Spark', 'Instant', '~ deals 2 damage to target creature.');

// ---- Iridescent Hornbeetle ---------------------------------------------------------------------------------------------------------------------------------------------
const SWARM = card('Test Swarmcaller', 'Creature — Insect', "At the beginning of your end step, create a 1/1 green Insect creature token for each +1/+1 counter you've put on creatures under your control this turn.", ['2', '2']);

describe('CR 122.6, 122.6a, 400.7: "... for each +1/+1 counter you\'ve put on creatures under your control this turn."', () => {
  const setup = (): GameState => scenario([], { defs: [SWARM, BOON, BEAR], p1: { hand: ['Test Boon'], battlefield: ['Test Swarmcaller', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('is automated', () => expect(full(SWARM)).toBe(true));
  it('two counters you put on your creature this turn make two Insect tokens at your end step (each counter, not each creature)', () => {
    let s = setup();
    const mine = findAll(s, 'Test Bear', 'battlefield', 'p1')[0]!;
    s = resolveAll(cast(s, 'Test Boon', { targets: [obj(mine)] }));
    expect(counters(s, mine, '+1/+1')).toBe(2);
    s = endStep(s);
    expect(tokens(s).length).toBe(2);
  });
  it('the negative cases: counters on an opponent\'s creature, and no counters at all, make no tokens', () => {
    let s = setup();
    const theirs = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    s = resolveAll(cast(s, 'Test Boon', { targets: [obj(theirs)] }));
    expect(counters(s, theirs, '+1/+1')).toBe(2);
    s = endStep(s);
    expect(tokens(s).length).toBe(0);
    expect(tokens(endStep(setup())).length).toBe(0);
  });
  it('ruling 2020-09-25: a creature that enters under your control with +1/+1 counters on it counts them too (you put them, CR 122.6a)', () => {
    const HATCHLING = card('Test Hatchling', 'Creature — Insect', 'This creature enters with two +1/+1 counters on it.', ['0', '0']);
    let s = scenario([], { defs: [SWARM, HATCHLING], p1: { hand: ['Test Hatchling'], battlefield: ['Test Swarmcaller'] } });
    s = resolveAll(cast(s, 'Test Hatchling'));
    expect(counters(s, find(s, 'Test Hatchling', 'battlefield'), '+1/+1')).toBe(2);
    s = endStep(s);
    expect(tokens(s).length).toBe(2);
  });
  it('ruling 2020-09-25: counters put on a creature that left the battlefield still count (a creature that died after getting them)', () => {
    const KILL = card('Test Kill', 'Instant', '~ deals 5 damage to target creature.');
    let s = scenario([], { defs: [SWARM, BOON, BEAR, KILL], p1: { hand: ['Test Boon', 'Test Kill'], battlefield: ['Test Swarmcaller', 'Test Bear'] } });
    const mine = findAll(s, 'Test Bear', 'battlefield', 'p1')[0]!;
    s = resolveAll(cast(s, 'Test Boon', { targets: [obj(mine)] }));
    s = resolveAll(cast(s, 'Test Kill', { targets: [obj(mine)] }));
    expect(s.zones.battlefield.includes(mine)).toBe(false);
    s = endStep(s);
    expect(tokens(s).length).toBe(2);
  });
});

// ---- Rith, Liberated Primeval ------------------------------------------------------------------------------------------------------------------------------------------
const DRAGONLORD = card('Test Dragonlord', 'Creature — Dragon', 'At the beginning of your end step, if a creature or planeswalker an opponent controlled was dealt excess damage this turn, create a 4/4 red Dragon creature token with flying.', ['3', '3']);

describe('CR 120.10, 603.4: "if a creature or planeswalker an opponent controlled was dealt excess damage this turn"', () => {
  const setup = (spells: string[] = ['Test Fireball']): GameState => scenario([], { defs: [DRAGONLORD, BEAR, BOLT5, BOLT2], p1: { hand: spells, battlefield: ['Test Dragonlord', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('is automated', () => expect(full(DRAGONLORD)).toBe(true));
  it('excess damage to an opponent\'s creature that died makes a Dragon at your end step (ruling 2022-09-09: it counts even though the creature is gone)', () => {
    let s = setup();
    const theirs = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    s = resolveAll(cast(s, 'Test Fireball', { targets: [obj(theirs)] }));
    expect(s.zones.battlefield.includes(theirs)).toBe(false);
    s = endStep(s);
    expect(tokens(s).filter((id) => pt(s, id) === '4/4').length).toBe(1);
  });
  it('the negative cases: exactly lethal damage is no excess, and excess damage to your own creature does not count', () => {
    let s = setup(['Test Spark']);
    s = resolveAll(cast(s, 'Test Spark', { targets: [obj(findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!)] }));
    expect(endStep(s).zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    let t = setup();
    t = resolveAll(cast(t, 'Test Fireball', { targets: [obj(findAll(t, 'Test Bear', 'battlefield', 'p1')[0]!)] }));
    expect(tokens(endStep(t)).length).toBe(0);
  });
  it('the negative case: with no damage at all there is no Dragon', () => {
    expect(tokens(endStep(setup())).length).toBe(0);
  });
  it('two sources, 1 then 2 damage to a 2/2: the second hit is excess because of the damage already dealt, so a Dragon is made', () => {
    const PING = card('Test Ping', 'Instant', '~ deals 1 damage to target creature.');
    let s = scenario([], { defs: [DRAGONLORD, BEAR, BOLT2, PING], p1: { hand: ['Test Ping', 'Test Spark'], battlefield: ['Test Dragonlord'] }, p2: { battlefield: ['Test Bear'] } });
    const theirs = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    s = resolveAll(cast(s, 'Test Ping', { targets: [obj(theirs)] }));
    s = resolveAll(cast(s, 'Test Spark', { targets: [obj(theirs)] }));
    expect(tokens(endStep(s)).length).toBe(1);
  });
});

// ---- Gluntch, the Bestower -----------------------------------------------------------------------------------------------------------------------------------------------
const GLUNTCH = card('Test Bestower', 'Creature — Jellyfish', 'At the beginning of your end step, choose a player. They put two +1/+1 counters on a creature they control. Choose a second player to draw a card. Then choose a third player to create two Treasure tokens.', ['2', '2']);

describe('CR 608.2d, 102.1, 122.6: three different players are chosen in turn', () => {
  const pick = (s: GameState, who: string): GameState => {
    const d = s.pending!;
    expect(d.kind).toBe('chooseOption');
    return answer(s, { kind: 'chooseOption', ids: [who] });
  };
  const toChoice = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 10 && s.pending?.kind === 'priority'; g++) s = act(s, { type: 'pass', player: s.pending.player }); return s; };
  const creature = (s: GameState): GameState => {
    const d = s.pending as unknown as { kind: string; options: ObjectId[]; min: number };
    if (d.kind !== 'chooseObjects') return s; // one creature only: nothing to choose
    return answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
  };
  const options = (s: GameState): string[] => (s.pending as unknown as { options: { id: string }[] }).options.map((o) => o.id);
  it('is automated', () => expect(full(GLUNTCH)).toBe(true));
  it('four players: the first gets two counters on a creature of their choice, the second draws, the third makes two Treasures; the choices never offer a player chosen before', () => {
    let s = mpScenario({ defs: [GLUNTCH, BEAR], zones: { p1: { battlefield: ['Test Bestower'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
    const hand = (p: string): number => handSize(s, p);
    const before = { p2: hand('p2'), p3: hand('p3') };
    s = toChoice(goTo(s, 'end'));
    expect(options(s)).toEqual(['p1', 'p2', 'p3', 'p4']);
    s = pick(s, 'p2');
    s = creature(s); // p2 chooses the creature they put the counters on (a single creature is not asked)
    expect(options(s)).toEqual(['p1', 'p3', 'p4']);
    s = pick(s, 'p3');
    expect(options(s)).toEqual(['p1', 'p4']);
    s = pick(s, 'p4');
    s = resolveAll(s);
    const bear = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    expect(counters(s, bear, '+1/+1')).toBe(2);
    expect(counters(s, findAll(s, 'Test Bear', 'battlefield', 'p3')[0]!, '+1/+1')).toBe(0);
    expect(hand('p3')).toBe(before.p3 + 1);
    expect(hand('p2')).toBe(before.p2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p4' && s.objects[id]!.kind === 'token' && getChars(s, id)!.name === 'Treasure Token').length).toBe(2);
  });
  it('the negative case, ruling 2022-06-10: in a two-player game the second player is the only one left (chosen without a question), and there is no third player: nobody creates Treasure tokens', () => {
    let s = scenario([], { defs: [GLUNTCH, BEAR], p1: { battlefield: ['Test Bestower'] }, p2: { battlefield: ['Test Bear'] } });
    const before = handSize(s, 'p2');
    s = toChoice(goTo(s, 'end'));
    s = pick(s, 'p1');
    s = creature(s);
    s = resolveAll(s);
    expect(s.pending?.kind).toBe('priority');
    expect(counters(s, find(s, 'Test Bestower', 'battlefield'), '+1/+1')).toBe(2);
    expect(handSize(s, 'p2')).toBe(before + 1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
  });
});

// ---- Kari Zev, Skyship Raider ------------------------------------------------------------------------------------------------------------------------------------------------
const RAIDER = card('Test Skyraider', 'Legendary Creature — Human Pirate', 'Whenever this creature attacks, create Ragavan, a legendary 2/1 red Monkey creature token. Ragavan enters tapped and attacking. Exile that token at end of combat.', ['1', '1']);

describe('CR 111.4, 508.4, 603.7: a named legendary token that enters tapped and attacking and is exiled at end of combat', () => {
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('attacking creates Ragavan, a legendary 2/1 red Monkey that is tapped and attacking, exiled at end of combat; the damage it deals counts', () => {
    let s = scenario([], { defs: [RAIDER], p1: { battlefield: ['Test Skyraider'] } });
    const raider = find(s, 'Test Skyraider', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[raider]]);
    s = resolveAll(s);
    const rag = tokens(s).filter((id) => getChars(s, id)!.name === 'Ragavan');
    expect(rag.length).toBe(1);
    const c = getChars(s, rag[0]!)!;
    expect(c.supertypes).toContain('Legendary');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Monkey']));
    expect(pt(s, rag[0]!)).toBe('2/1');
    expect(s.objects[rag[0]!]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === rag[0])).toBe(true);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers');
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = toStep(s, 'endCombat');
    s = resolveAll(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20 - 1 - 2);
    expect(tokens(s).filter((id) => getChars(s, id)!.name === 'Ragavan').length).toBe(0);
  });
  it('the negative case: without attacking there is no token', () => {
    const s = scenario([], { defs: [RAIDER], p1: { battlefield: ['Test Skyraider'] } });
    expect(tokens(s).length).toBe(0);
  });
});

// ---- Aurelia, Exemplar of Justice ----------------------------------------------------------------------------------------------------------------------------------------
const EXEMPLAR = card('Test Exemplar', 'Creature — Angel', "At the beginning of combat on your turn, choose up to one target creature you control. Until end of turn, that creature gets +2/+0, gains trample if it's red, and gains vigilance if it's white.", ['4', '4']);
const colorBear = (name: string, colors: string[]): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Bear', oracle_text: '', colors, power: '2', toughness: '2' } as OracleCard);

describe('CR 608.2c, 611.2a, 613.1f: a pump and two keywords granted by colour', () => {
  const play = (bear: CardDef): { s: GameState; id: ObjectId } => {
    let s = scenario([], { defs: [EXEMPLAR, bear], p1: { battlefield: ['Test Exemplar', bear.name] } });
    const id = find(s, bear.name, 'battlefield');
    s = resolveAll(goTo(s, 'beginCombat', [obj(id)]));
    return { s, id };
  };
  it('is automated', () => expect(full(EXEMPLAR)).toBe(true));
  it('a red and white creature gets +2/+0 and both keywords; a red one only trample; a white one only vigilance; a green one only the +2/+0 (ruling 2018-10-05)', () => {
    const rw = play(colorBear('Test RW Bear', ['R', 'W']));
    expect(pt(rw.s, rw.id)).toBe('4/2');
    expect(hasKeyword(rw.s, rw.id, 'trample') && hasKeyword(rw.s, rw.id, 'vigilance')).toBe(true);
    const r = play(colorBear('Test R Bear', ['R']));
    expect(pt(r.s, r.id)).toBe('4/2');
    expect(hasKeyword(r.s, r.id, 'trample')).toBe(true);
    expect(hasKeyword(r.s, r.id, 'vigilance')).toBe(false);
    const w = play(colorBear('Test W Bear', ['W']));
    expect(hasKeyword(w.s, w.id, 'trample')).toBe(false);
    expect(hasKeyword(w.s, w.id, 'vigilance')).toBe(true);
    const g = play(colorBear('Test G Bear', ['G']));
    expect(pt(g.s, g.id)).toBe('4/2');
    expect(hasKeyword(g.s, g.id, 'trample') || hasKeyword(g.s, g.id, 'vigilance')).toBe(false);
  });
  it('the grant lasts until end of turn only: the next turn the creature has neither the +2/+0 nor the keywords', () => {
    const rw = play(colorBear('Test RW Bear', ['R', 'W']));
    expect(pt(rw.s, rw.id)).toBe('4/2');
    const s = advanceTo(rw.s, 3, 'main1');
    expect(pt(s, rw.id)).toBe('2/2');
    expect(hasKeyword(s, rw.id, 'trample') || hasKeyword(s, rw.id, 'vigilance')).toBe(false);
  });
});
void passUntil; void colored; void BOLT2; void toDeclareAttackers; void declareAttackers; void toStep; void tweak;

// ---- Biomancer's Familiar ------------------------------------------------------------------------------------------------------------------------------------------------
const ADAPTER = card('Test Adapter', 'Creature — Hydra', '{0}: Adapt 2.', ['1', '1']);
const MARKER = card('Test Marker', 'Creature — Mutant', '{0}: The next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it.', ['1', '1']);

describe('CR 701.46a: "The next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it."', () => {
  const setup = (counters0 = 0): GameState => scenario([], { defs: [ADAPTER, MARKER], p1: { battlefield: [{ name: 'Test Adapter', counters: counters0 > 0 ? { '+1/+1': counters0 } : {} }, 'Test Marker'] } });
  const activate = (s: GameState, name: string, targets: TargetChoice[] = []): GameState => {
    const source = find(s, name, 'battlefield');
    return resolveAll(act(s, { type: 'activate', player: 'p1', source, ability: activatedAbilities(s, s.objects[source]!)[0]!.key }), { targets });
  };
  const adapter = (s: GameState): ObjectId => find(s, 'Test Adapter', 'battlefield');
  it('is automated', () => { expect(full(ADAPTER)).toBe(true); expect(full(MARKER)).toBe(true); });
  it('without the mark an adapt does nothing once the creature has +1/+1 counters (the plain rule)', () => {
    let s = setup();
    s = activate(s, 'Test Adapter');
    s = activate(s, 'Test Adapter');
    expect(counters(s, adapter(s), '+1/+1')).toBe(2);
  });
  it('with the mark the next adapt puts its counters although the creature has some; the mark covers one adapt only', () => {
    let s = setup(1);
    s = activate(s, 'Test Marker', [obj(adapter(s))]);
    s = activate(s, 'Test Adapter');
    expect(counters(s, adapter(s), '+1/+1')).toBe(3);
    s = activate(s, 'Test Adapter');
    expect(counters(s, adapter(s), '+1/+1')).toBe(3);
  });
  it('two marks cover two adapts; a mark of another creature or of an earlier turn does not count', () => {
    let s = setup(1);
    const a = adapter(s);
    s = activate(s, 'Test Marker', [obj(a)]);
    s = activate(s, 'Test Marker', [obj(a)]);
    s = activate(s, 'Test Adapter');
    s = activate(s, 'Test Adapter');
    s = activate(s, 'Test Adapter');
    expect(counters(s, a, '+1/+1')).toBe(5);
    let t = setup(1);
    t = activate(t, 'Test Marker', [obj(find(t, 'Test Marker', 'battlefield'))]);
    t = activate(t, 'Test Adapter');
    expect(counters(t, adapter(t), '+1/+1')).toBe(1);
    let u = setup(1);
    u = activate(u, 'Test Marker', [obj(adapter(u))]);
    u = advanceTo(u, 3, 'main1');
    u = activate(u, 'Test Adapter');
    expect(counters(u, adapter(u), '+1/+1')).toBe(1);
  });
});
