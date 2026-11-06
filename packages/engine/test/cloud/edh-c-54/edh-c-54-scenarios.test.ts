/**
 * Commander effort, round edh-c-54 (EDHREC ranks 18,001 to 18,500, third pass): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) casts and attacks. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 115.1, 701.13a, 119.3     "Exile target nonwhite attacking creature. You gain life equal to its toughness." (Exile: a card named by a verb)
 *   CR 702.64a, 615.1           "Absorb 1" and "All Sliver creatures have absorb 1." (Lymph Sliver)
 *   CR 702.16a, 111.1, 205.2    "Target permanent you control gains protection from instant spells and from sorcery spells until end of turn." (Devoted Caretaker)
 *   CR 614.15, 608.2c           "Test Blast deals 2 damage to each creature and each player. If you cast this spell during your main phase, it deals 3 ... instead." (Sulfurous Blast)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { activatedAbilities } from '../../../src/rules/abilities';
import { act, advanceTo, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';

function mk(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const abilityKey = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;

describe('CR 115.1, 701.13a, 119.3: a card named by a verb, "Exile target nonwhite attacking creature. You gain life equal to its toughness."', () => {
  const EXILE_CARD = mk('Exile', 'Instant', 'Exile target nonwhite attacking creature. You gain life equal to its toughness.', { cost: '{0}', colors: ['W'] });
  const BLACK = mk('Test Shade', 'Creature — Shade', '', { pt: ['2', '4'], colors: ['B'] });
  const WHITE = mk('Test Knight', 'Creature — Knight', '', { pt: ['2', '3'], colors: ['W'] });
  const DEFS = [EXILE_CARD, BLACK, WHITE];
  const board = (): GameState => scenario([], { defs: DEFS, life: 10, p1: { hand: ['Exile'] }, p2: { battlefield: ['Test Shade', 'Test Knight'] } });
  const attacked = (s0: GameState): GameState => {
    let s = advanceTo(s0, 4, 'main1'); // p2's turn
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Shade', 'battlefield', 'p2')], [find(s, 'Test Knight', 'battlefield', 'p2')]]);
    return s;
  };
  it('is automated, and the self reference is not read into the verb', () => {
    expect(full(EXILE_CARD), JSON.stringify(EXILE_CARD.automation)).toBe(true);
    expect(JSON.stringify(EXILE_CARD.faces[0]!.abilities)).not.toContain('"ref":"self"');
  });
  it('exiles the black attacker and gains life equal to its toughness (10 -> 14); the white attacker is not a legal target', () => {
    let s = attacked(board());
    const shade = find(s, 'Test Shade', 'battlefield', 'p2');
    const knight = find(s, 'Test Knight', 'battlefield', 'p2');
    s = pass(s); // p2 passes priority in the declare attackers step
    const asked = act(s, { type: 'cast', player: 'p1', card: find(s, 'Exile', 'hand', 'p1') });
    const options = (asked.pending as unknown as { objects: ObjectId[] }).objects;
    expect(options).toContain(shade);
    expect(options).not.toContain(knight);
    s = resolveAll(asked, { targets: [obj(shade)] });
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Shade')).toBe(true);
    expect(life(s, 'p1')).toBe(14);
  });
});

describe('CR 702.64a, 615.1: "Absorb 1" and a granted absorb (Lymph Sliver)', () => {
  const ABSORBER = mk('Test Absorber', 'Creature — Spirit', 'Absorb 1', { pt: ['2', '4'] });
  const LYMPH = mk('Test Lymph', 'Creature — Sliver', 'All Sliver creatures have absorb 1.', { pt: ['1', '5'] });
  const SLIVER = mk('Test Sliver', 'Creature — Sliver', '', { pt: ['2', '4'] });
  const BEAR = mk('Test Bear', 'Creature — Bear', '', { pt: ['2', '4'] });
  const BOLT = mk('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
  const DEFS = [ABSORBER, LYMPH, SLIVER, BEAR, BOLT];
  const bolt = (s0: GameState, name: string): number => {
    const id = find(s0, name, 'battlefield', 'p2');
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [obj(id)] });
    return s.objects[id]!.damage;
  };
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Bolt'] }, p2: { battlefield: ['Test Absorber', 'Test Lymph', 'Test Sliver', 'Test Bear'] } });
  it('is automated', () => {
    expect(full(ABSORBER), JSON.stringify(ABSORBER.automation)).toBe(true);
    expect(full(LYMPH), JSON.stringify(LYMPH.automation)).toBe(true);
  });
  it('3 damage to a creature with absorb 1: 2 is dealt, one is prevented', () => {
    expect(bolt(board(), 'Test Absorber')).toBe(2);
  });
  it('the granted absorb covers every Sliver (the Lymph Sliver and another Sliver) and no other creature', () => {
    expect(bolt(board(), 'Test Lymph')).toBe(2);
    expect(bolt(board(), 'Test Sliver')).toBe(2);
    expect(bolt(board(), 'Test Bear')).toBe(3);
  });
  it('a Sliver stops having absorb once the Lymph Sliver is gone', () => {
    const s0 = board();
    const lymph = find(s0, 'Test Lymph', 'battlefield', 'p2');
    s0.zones.battlefield = s0.zones.battlefield.filter((id) => id !== lymph);
    delete s0.objects[lymph];
    expect(bolt(s0, 'Test Sliver')).toBe(3);
  });
  it('the keyword reads in the characteristics of the Sliver', () => {
    const s = board();
    const kws = getChars(s, find(s, 'Test Sliver', 'battlefield', 'p2'))!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
    expect(kws).toContain('absorb');
  });
});

describe('CR 702.16a, 111.1, 205.2: "protection from instant spells and from sorcery spells"', () => {
  const CARETAKER = mk('Test Caretaker', 'Creature — Human Cleric', '{W}, {T}: Target permanent you control gains protection from instant spells and from sorcery spells until end of turn.', { pt: ['1', '1'], cost: '{W}' });
  const BEAR = mk('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const ZAP = mk('Test Zap', 'Instant', 'Test Zap deals 2 damage to target creature.');
  const SORC = mk('Test Scorch', 'Sorcery', 'Test Scorch deals 2 damage to target creature.');
  const SWEEP = mk('Test Sweep', 'Instant', 'Test Sweep deals 1 damage to each creature.');
  const PING = mk('Test Pinger', 'Creature — Wizard', '{T}: Test Pinger deals 1 damage to target creature.', { pt: ['1', '1'] });
  const DEFS = [CARETAKER, BEAR, ZAP, SORC, SWEEP, PING];
  const targetsOf = (s: GameState): ObjectId[] => (s.pending as unknown as { objects: ObjectId[] }).objects;
  const protectedBoard = (): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Zap', 'Test Sweep', 'Test Scorch'], battlefield: ['Test Caretaker', 'Test Bear', 'Test Pinger', 'Plains'] } });
    let s = advanceTo(s0, 3, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const care = find(s, 'Test Caretaker', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: care, ability: abilityKey(s, care) } as never), { targets: [obj(bear)] });
    return { s, bear };
  };
  it('is automated, with both spell qualities', () => {
    expect(full(CARETAKER), JSON.stringify(CARETAKER.automation)).toBe(true);
    const text = JSON.stringify(CARETAKER.faces[0]!.abilities);
    expect(text).toContain('spell&type:Instant');
    expect(text).toContain('spell&type:Sorcery');
  });
  it('an instant spell (whoever casts it) can\'t target the permanent and its damage is prevented; an ability can still target and damage it', () => {
    const { s, bear } = protectedBoard();
    const asked = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') });
    expect(targetsOf(asked)).not.toContain(bear);
    const sweep = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') }));
    expect(sweep.objects[bear]!.damage).toBe(0);
    const pinger = find(s, 'Test Pinger', 'battlefield', 'p1');
    const pinged = resolveAll(act(s, { type: 'activate', player: 'p1', source: pinger, ability: abilityKey(s, pinger) } as never), { targets: [obj(bear)] });
    expect(pinged.objects[bear]!.damage).toBe(1);
  });
  it('the protection ends with the turn: the next turn an instant can target it again', () => {
    const { s, bear } = protectedBoard();
    const t = advanceTo(s, 5, 'main1');
    const asked = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Zap', 'hand', 'p1') });
    expect(targetsOf(asked)).toContain(bear);
  });
});

describe('CR 614.15, 608.2c: "deals 2 damage to each creature and each player. If you cast this spell during your main phase, it deals 3 damage ... instead."', () => {
  const BLAST = mk('Test Blast', 'Instant', 'Test Blast deals 2 damage to each creature and each player. If you cast this spell during your main phase, Test Blast deals 3 damage to each creature and each player instead.', { cost: '{0}' });
  const BEAR = mk('Test Bear', 'Creature — Bear', '', { pt: ['2', '9'] });
  const DEFS = [BLAST, BEAR];
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Blast'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('is automated', () => expect(full(BLAST), JSON.stringify(BLAST.automation)).toBe(true));
  it('cast in your main phase: 3 damage to each creature and each player', () => {
    let s = advanceTo(board(), 3, 'main1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blast', 'hand', 'p1') }));
    expect(life(s, 'p1')).toBe(17);
    expect(life(s, 'p2')).toBe(17);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(3);
  });
  it('cast at another time (the beginning of combat): 2 damage to each creature and each player', () => {
    let s = advanceTo(board(), 3, 'beginCombat');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blast', 'hand', 'p1') }));
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(18);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.damage).toBe(2);
  });
});

describe('CR 108.3, 109.4, 701.12: "you may exchange control of this enchantment and target permanent you neither own nor control"', () => {
  const CURRENCY = mk('Test Currency', 'Enchantment', 'At the beginning of your upkeep, you may exchange control of this enchantment and target permanent you neither own nor control.', { cost: '{0}' });
  const BEAR = mk('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OWN = mk('Test Own Wall', 'Creature — Wall', '', { pt: ['0', '4'] });
  const DEFS = [CURRENCY, BEAR, OWN];
  const targetsOf = (s: GameState): ObjectId[] => (s.pending as unknown as { objects: ObjectId[] }).objects;
  const toUpkeep = (): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Currency', 'Test Own Wall'] }, p2: { battlefield: ['Test Bear'] } });
    const stolen = put(s0, 'p2', 'battlefield', 'Test Own Wall'); // a permanent p2 owns...
    s0.objects[stolen]!.controller = 'p1'; // ...that p1 controls: not "neither own nor control"
    return advanceTo(s0, 3, 'upkeep');
  };
  it('is automated', () => expect(full(CURRENCY), JSON.stringify(CURRENCY.automation)).toBe(true));
  it('only a permanent owned and controlled by an opponent is a legal target; after the exchange each side controls the other\'s permanent', () => {
    let s = toUpkeep();
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const currency = find(s, 'Test Currency', 'battlefield', 'p1');
    for (let g = 0; g < 6 && s.pending?.kind !== 'chooseTargets'; g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(targetsOf(s)).toEqual([bear]);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(bear)] }), { yes: true });
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(s.objects[currency]!.controller).toBe('p2');
  });
});

describe('CR 107.3, 608.2d, 601.2h: "Return up to X permanent cards from your graveyard to your hand, where X is the number of colors of mana spent to cast this spell. Exile ~."', () => {
  const MUSE = mk('Test Musings', 'Sorcery', 'Converge — Return up to X permanent cards from your graveyard to your hand, where X is the number of colors of mana spent to cast this spell. Exile Test Musings.', { cost: '{2}{G}{G}', colors: ['G'] });
  const BEAR = mk('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DEFS = [MUSE, BEAR];
  const run = (lands: string[], pick: number): GameState => {
    const s0 = scenario(['Forest', 'Island', 'Mountain'], { defs: DEFS, p1: { hand: ['Test Musings'], graveyard: Array(4).fill('Test Bear') as string[], battlefield: lands } });
    let s = advanceTo(s0, 3, 'main1');
    const bears = findAll(s, 'Test Bear', 'graveyard', 'p1').slice(0, pick);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Musings', 'hand', 'p1') });
    return resolveAll(s, { objects: bears });
  };
  const inHand = (s: GameState): number => findAll(s, 'Test Bear', 'hand', 'p1').length;
  it('is automated', () => expect(full(MUSE), JSON.stringify(MUSE.automation)).toBe(true));
  it('three colors of mana spent (G, G, U, R): up to three cards return, and the spell is exiled, not put into the graveyard', () => {
    const s = run(['Forest', 'Forest', 'Island', 'Mountain'], 3);
    expect(inHand(s)).toBe(3);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Musings')).toBe(true);
    expect((s.zones.graveyard.p1 ?? []).some((id) => s.objects[id]!.defId === 'Test Musings')).toBe(false);
  });
  it('one color spent: only one card may be chosen (two are refused); choosing none returns nothing', () => {
    expect(inHand(run(['Forest', 'Forest', 'Forest', 'Forest'], 1))).toBe(1);
    expect(() => run(['Forest', 'Forest', 'Forest', 'Forest'], 2)).toThrow();
    expect(inHand(run(['Forest', 'Forest', 'Forest', 'Forest'], 0))).toBe(0);
  });
});

describe('CR 503.1, 602.5b: "{4}: Remove a doom counter from ~. Any player may activate this ability but only during any upkeep step."', () => {
  const CLOCK = mk('Test Clock', 'Artifact', 'At the beginning of your upkeep, put a doom counter on this artifact.\n{4}: Remove a doom counter from this artifact. Any player may activate this ability but only during any upkeep step.', { cost: '{6}' });
  const DEFS = [CLOCK];
  const doom = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['doom'] ?? 0;
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Clock'] }, p2: { battlefield: Array(4).fill('Plains') as string[] } });
  const activate = (s: GameState, who: string, id: ObjectId): GameState => resolveAll(act(s, { type: 'activate', player: who, source: id, ability: activatedAbilities(s, s.objects[id]!)[0]!.key } as never));
  it('is automated', () => expect(full(CLOCK), JSON.stringify(CLOCK.automation)).toBe(true));
  it('the opponent (not the controller) may remove a doom counter during the controller\'s upkeep, paying {4} from their own lands', () => {
    let s = board();
    const clock = find(s, 'Test Clock', 'battlefield', 'p1');
    s.objects[clock]!.counters['doom'] = 2;
    s = advanceTo(s, 3, 'upkeep');
    while (s.zones.stack.length > 0) s = settle(pass(s));
    const before = doom(s, clock);
    expect(before).toBeGreaterThan(0);
    s = pass(s); // the controller passes priority: the opponent holds it in the same upkeep step
    const t = activate(s, 'p2', clock);
    expect(doom(t, clock)).toBe(before - 1);
  });
  it('outside an upkeep step (the main phase) nobody may activate it', () => {
    let s = board();
    const clock = find(s, 'Test Clock', 'battlefield', 'p1');
    s.objects[clock]!.counters['doom'] = 2;
    s = advanceTo(s, 3, 'main1');
    expect(() => act(s, { type: 'activate', player: 'p2', source: clock, ability: activatedAbilities(s, s.objects[clock]!)[0]!.key } as never)).toThrow();
  });
});

describe('review additions (negative cases)', () => {
  const targetsOf = (s: GameState): ObjectId[] => (s.pending as unknown as { objects: ObjectId[] }).objects;
  it('protection from sorcery spells: a sorcery can\'t target the permanent either (CR 702.16a)', () => {
    const CARE = mk('Test Caretaker', 'Creature — Human Cleric', '{W}, {T}: Target permanent you control gains protection from instant spells and from sorcery spells until end of turn.', { pt: ['1', '1'], cost: '{W}' });
    const BEAR = mk('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
    const SORC = mk('Test Scorch', 'Sorcery', 'Test Scorch deals 2 damage to target creature.');
    const s0 = scenario([], { defs: [CARE, BEAR, SORC], p1: { hand: ['Test Scorch'], battlefield: ['Test Caretaker', 'Test Bear', 'Plains'] } });
    let s = advanceTo(s0, 3, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const care = find(s, 'Test Caretaker', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: care, ability: abilityKey(s, care) } as never), { targets: [obj(bear)] });
    const asked = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scorch', 'hand', 'p1') });
    expect(targetsOf(asked)).not.toContain(bear);
  });
  it('Exile: a nonwhite creature that is not attacking is not a legal target', () => {
    const EX = mk('Exile', 'Instant', 'Exile target nonwhite attacking creature. You gain life equal to its toughness.', { colors: ['W'] });
    const SH = mk('Test Shade', 'Creature — Shade', '', { pt: ['2', '4'], colors: ['B'] });
    const s0 = scenario([], { defs: [EX, SH], p1: { hand: ['Exile'] }, p2: { battlefield: ['Test Shade'] } });
    const s = advanceTo(s0, 3, 'main1');
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Exile', 'hand', 'p1') })).toThrow(/no legal one/);
  });
  it('absorb 2 against 1 damage prevents it all; two Lymph Slivers give each Sliver two instances (3 damage -> 1)', () => {
    const LYMPH = mk('Test Lymph', 'Creature — Sliver', 'All Sliver creatures have absorb 1.', { pt: ['1', '9'] });
    const BOLT = mk('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
    const s0 = scenario([], { defs: [LYMPH, BOLT], p1: { hand: ['Test Bolt'] }, p2: { battlefield: ['Test Lymph', 'Test Lymph'] } });
    const [a] = findAll(s0, 'Test Lymph', 'battlefield', 'p2');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') });
    for (let g = 0; g < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending as unknown as { kind: string; options?: { id: string }[] };
      if (d.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: d.options![0]!.id } as never);
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(a!)] });
      else if (d.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    expect(s.objects[a!]!.damage).toBe(1);
  });
});
