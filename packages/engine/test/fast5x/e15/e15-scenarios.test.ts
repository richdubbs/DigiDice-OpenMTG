/**
 * FAST5X E15 (MX18): the greatest and least value among a set, played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 208.1, 202.3, 608.2h   "the greatest power / toughness / mana value among <set>" is read once, as the effect is applied; no object at all is 0
 *   CR 601.2f                 a cost reduction reads it while the spell is cast ("costs {X} less to cast, where X is the greatest power among ...")
 *   CR 604.3, 613.4a          a characteristic-defining power ("~'s power is equal to the greatest mana value among permanents you control"), itself included
 *   CR 613.4c                 "~ gets +X/+0, where X is the greatest mana value among other artifacts you control" (continuously; "other" leaves it out)
 *   CR 701.21a, 608.2d        "target opponent sacrifices a creature with the greatest power among creatures they control": a tie is the player's choice
 *   CR 406.1, 608.2d          "... exiles a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control"
 *   CR 107.3                  "2 or the greatest power among Dinosaurs you control, whichever is greater"
 *   CR 603.12, 608.2h         a reflexive trigger's "where X is the greatest mana value among cards in your graveyard" is read as it resolves
 *   CR 121.2, 608.2c          "You lose life equal to the number of cards drawn this way."
 *   CR 118.12a                "counter up to one target spell unless its controller pays mana equal to the greatest power among creatures you control"
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, type CardDef, type GameState, type ManaSymbol, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { inGraveyard, lifeOf, onBattlefield, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

/** The answers to the decisions, in order of kind; payment is automatic. Stops at the next priority decision. Records the chooseObjects options asked. */
interface Script { targets?: TargetChoice[][]; objects?: ObjectId[][]; yes?: boolean[]; asked?: ObjectId[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], yes: [...(script.yes ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') { script.asked?.push([...p.options]); s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
function costOf(s: GameState, id: ObjectId, def: CardDef): string {
  const m = modifiedPlan(s, 'p1', id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const power = (s: GameState, id: ObjectId): string | undefined => charsOfObject(s, s.objects[id]!).power;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['4', '4']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{2}', ['4', '1']);
const WALL = card('Test Wall', 'Creature — Wall', '', '{2}', ['0', '6']);
const DINO = card('Test Dino', 'Creature — Dinosaur', '', '{4}', ['5', '5']);
const IDOL = card('Test Idol', 'Artifact', '', '{5}');
const TRINKET = card('Test Trinket', 'Artifact', '', '{1}');
const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{6}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '', colors: [], keywords: [], loyalty: '3' } as OracleCard);
const GIANT = card('Test Giant', 'Creature — Giant', '', '{4}', ['6', '6']);

const RISE = card('Test Rise', 'Sorcery', 'Draw cards equal to the greatest power among creatures you control. You lose life equal to the number of cards drawn this way.');
const COLOSSUS = card('Test Colossus', 'Creature — Dinosaur', 'This spell costs {X} less to cast, where X is the greatest power among creatures you control.\nTrample', '{10}', ['12', '12']);
const HUNTER = card('Test Hunter', 'Legendary Creature — Human Warrior', 'Vigilance\nTest Hunter\'s power is equal to the greatest mana value among permanents you control.', '{3}', ['*', '1']);
const ESCORT = card('Test Escort', 'Artifact Creature — Robot', 'This creature gets +X/+0, where X is the greatest mana value among other artifacts you control.', '{2}', ['0', '4']);
const GREED = card('Test Greed', 'Instant', 'Target opponent sacrifices a creature with the greatest power among creatures they control.');
const HUNT = card('Test Hunt', 'Sorcery', 'Target opponent exiles a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.');
const CHOMP = card('Test Chomp', 'Sorcery', 'Test Chomp deals damage to target creature equal to 2 or the greatest power among Dinosaurs you control, whichever is greater.');
const PATROL = card('Test Patrol', 'Creature — Rat', 'When this creature enters, mill three cards. When you do, target creature an opponent controls gets -X/-X until end of turn, where X is the greatest mana value among cards in your graveyard.', '{0}', ['1', '1']);
const MUTATION = card('Test Mutation', 'Instant', 'Draw a card. Then counter up to one target spell unless its controller pays mana equal to the greatest power among creatures you control.');
const WARS = card('Test Wars', 'Sorcery', 'Test Wars deals X damage to target opponent, where X is the greatest mana value among artifacts you control.');
const HIRELING = card('Test Hireling', 'Creature — Giant', 'When this creature enters, you gain X life, where X is the greatest power among Giants you control.', '{0}', ['4', '4']);
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const LEAST = card('Test Least', 'Sorcery', 'You gain life equal to the least toughness among creatures you control.');
const SUM = card('Test Sum', 'Sorcery', 'You gain life equal to the total power of creatures you control.');
const DEFS = [BEAR, OGRE, BRUTE, WALL, DINO, IDOL, TRINKET, WALKER, GIANT, RISE, COLOSSUS, HUNTER, ESCORT, GREED, HUNT, CHOMP, PATROL, MUTATION, WARS, HIRELING, LEAST, SUM, SPARK];

describe('the E15 cards compile to full automation', () => {
  it('design 6.9: every synthetic card here is fully automated', () => {
    for (const d of [RISE, COLOSSUS, HUNTER, ESCORT, GREED, HUNT, CHOMP, PATROL, MUTATION, WARS, HIRELING, LEAST, SUM]) expect(full(d), `${d.name}: ${JSON.stringify(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'))}`).toBe(true);
  });
});

describe('CR 208.1, 608.2h: the greatest / least value among a set, read once as the effect is applied', () => {
  it('draws cards equal to the greatest power among creatures you control (4 of 2, 4 and 0), then loses that much life (CR 121.2, 608.2c)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rise'], battlefield: ['Test Bear', 'Test Ogre', 'Test Wall'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Rise'));
    expect(handSize(s, 'p1')).toBe(4);
    expect(lifeOf(s, 'p1')).toBe(16);
  });
  it('the number of cards drawn this way counts the cards actually drawn: with two cards in the library, two (CR 121.2)', () => {
    const s0 = tweak(scenario([], { p1: { hand: ['Test Rise'], battlefield: ['Test Ogre'], library: ['Test Bear', 'Test Bear'] }, defs: DEFS }), (t) => { t.zones.library['p1'] = t.zones.library['p1']!.slice(0, 2); });
    const s = resolveAll(cast(s0, 'Test Rise'));
    expect(handSize(s, 'p1')).toBe(2);
    expect(lifeOf(s, 'p1')).toBe(18);
  });
  it('with no creature the greatest power is 0: no card, no life (an opponent\'s creatures are not among "creatures you control")', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rise'], library: ['Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Rise'));
    expect(handSize(s, 'p1')).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('the least toughness among creatures you control (6, 4, 2 -> 2); the total of the old `sum` reading is unchanged (2 + 4 + 0 = 6)', () => {
    const s1 = resolveAll(cast(scenario([], { p1: { hand: ['Test Least'], battlefield: ['Test Bear', 'Test Ogre', 'Test Wall'] }, defs: DEFS }), 'Test Least'));
    expect(lifeOf(s1, 'p1')).toBe(22);
    const s2 = resolveAll(cast(scenario([], { p1: { hand: ['Test Sum'], battlefield: ['Test Bear', 'Test Ogre', 'Test Wall'] }, defs: DEFS }), 'Test Sum'));
    expect(lifeOf(s2, 'p1')).toBe(26);
  });
  it('X damage to target opponent, where X is the greatest mana value among artifacts you control (5 of 1 and 5)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Wars'], battlefield: ['Test Trinket', 'Test Idol'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Wars', { targets: [[player('p2')]] }));
    expect(lifeOf(s, 'p2')).toBe(15);
  });
  it('an enters trigger: you gain X life, where X is the greatest power among Giants you control (the 6/6 Giant, not the creature itself, 4)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hireling'], battlefield: ['Test Giant', 'Test Dino'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Hireling'));
    expect(lifeOf(s, 'p1')).toBe(26);
  });
});

describe('CR 601.2f: a cost reduction reads the greatest power while the spell is cast', () => {
  it('{10} costs {6} with a 4/4 and a 2/2, {10} with no creature, {5} with a 5/5 (generic only)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Colossus'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    const id = find(s0, 'Test Colossus', 'hand', 'p1');
    expect(costOf(s0, id, COLOSSUS)).toBe('{6}');
    const none = scenario([], { p1: { hand: ['Test Colossus'] }, p2: { battlefield: ['Test Giant'] }, defs: DEFS });
    expect(costOf(none, find(none, 'Test Colossus', 'hand', 'p1'), COLOSSUS)).toBe('{10}');
    const dino = scenario([], { p1: { hand: ['Test Colossus'], battlefield: ['Test Dino', 'Test Bear'] }, defs: DEFS });
    expect(costOf(dino, find(dino, 'Test Colossus', 'hand', 'p1'), COLOSSUS)).toBe('{5}');
  });
});

describe('CR 604.3, 613.4a, 613.4c: continuous values', () => {
  it('a characteristic-defining power: the greatest mana value among permanents you control, its own included (3 alone, 5 with a {5} artifact)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hunter'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: DEFS });
    expect(power(s0, find(s0, 'Test Hunter', 'battlefield', 'p1'))).toBe('3');
    const s1 = scenario([], { p1: { battlefield: ['Test Hunter', 'Test Idol', 'Test Bear'] }, defs: DEFS });
    expect(power(s1, find(s1, 'Test Hunter', 'battlefield', 'p1'))).toBe('5');
  });
  it('+X/+0 where X is the greatest mana value among OTHER artifacts you control: +0 alone (its own {2} is not counted), +5 with a {5} and a {1} artifact', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Escort'] }, defs: DEFS });
    expect(power(s0, find(s0, 'Test Escort', 'battlefield', 'p1'))).toBe('0');
    const s1 = scenario([], { p1: { battlefield: ['Test Escort', 'Test Idol', 'Test Trinket'] }, defs: DEFS });
    expect(power(s1, find(s1, 'Test Escort', 'battlefield', 'p1'))).toBe('5');
    // it changes as the set does (CR 611.3a)
    const s2 = tweak(s1, (t) => {
      const idol = find(t, 'Test Idol', 'battlefield', 'p1');
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== idol);
      t.zones.graveyard['p1']!.push(idol);
      t.objects[idol]!.zone = 'graveyard';
    });
    expect(power(s2, find(s2, 'Test Escort', 'battlefield', 'p1'))).toBe('1');
  });
});

describe('CR 701.21a, 406.1, 608.2d: "with the greatest <stat> among" a set: the tied greatest, the player chooses', () => {
  it('a tie between two power-4 creatures is the sacrificing player\'s choice; the 2/2 is never among the choices; the caster\'s creatures do not count', () => {
    const s0 = scenario([], { p1: { hand: ['Test Greed'], battlefield: ['Test Giant'] }, p2: { battlefield: ['Test Bear', 'Test Ogre', 'Test Brute'] }, defs: DEFS });
    const asked: ObjectId[][] = [];
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Greed', { targets: [[player('p2')]] }), { objects: [[brute]], asked });
    expect(asked.length).toBe(1);
    expect([...asked[0]!].sort()).toEqual([find(s0, 'Test Ogre', 'battlefield', 'p2'), brute].sort());
    expect(inGraveyard(s, 'Test Brute', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Test Ogre', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Test Bear', 'p2')).toBe(true);
  });
  it('one greatest: no choice, it is sacrificed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Greed'] }, p2: { battlefield: ['Test Bear', 'Test Giant'] }, defs: DEFS });
    const asked: ObjectId[][] = [];
    const s = resolveAll(cast(s0, 'Test Greed', { targets: [[player('p2')]] }), { asked });
    expect(asked).toEqual([]);
    expect(inGraveyard(s, 'Test Giant', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Test Bear', 'p2')).toBe(true);
  });
  it('exiles the creature or planeswalker with the greatest mana value among them (the {6} planeswalker, not the {5} artifact)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hunt'] }, p2: { battlefield: ['Test Ogre', { name: 'Test Walker', counters: { loyalty: 3 } }, 'Test Idol'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Hunt', { targets: [[player('p2')]] }));
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Walker')).toBe(true);
    expect(onBattlefield(s, 'Test Walker', 'p2')).toBe(false);
    expect(onBattlefield(s, 'Test Ogre', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Test Idol', 'p2')).toBe(true);
  });
});

describe('CR 107.3: "N or Q, whichever is greater"', () => {
  it('2 with no Dinosaur, 5 with a 5/5 Dinosaur', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chomp'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Chomp', { targets: [[obj(wall)]] }));
    expect(s1.objects[wall]!.damage).toBe(2);
    const s2 = scenario([], { p1: { hand: ['Test Chomp'], battlefield: ['Test Dino'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall2 = find(s2, 'Test Wall', 'battlefield', 'p2');
    const s3 = resolveAll(cast(s2, 'Test Chomp', { targets: [[obj(wall2)]] }));
    expect(s3.objects[wall2]!.damage).toBe(5);
  });
});

describe('CR 603.12, 608.2h: "where X is" in a reflexive trigger is read as it resolves', () => {
  it('mill three ({6}, {1}, {3}); the target gets -6/-6 and dies', () => {
    const s0 = scenario([], { p1: { hand: ['Test Patrol'], library: ['Test Walker', 'Test Trinket', 'Test Ogre'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Patrol'), { targets: [[obj(wall)]] });
    expect(s.zones.graveyard['p1']!.length).toBe(3);
    expect(inGraveyard(s, 'Test Wall', 'p2')).toBe(true);
  });
});

describe('CR 118.12a: "unless its controller pays mana equal to the greatest power among creatures you control"', () => {
  it('the controller of the target spell has no mana to pay {4}: the spell is countered', () => {
    const s0 = scenario([], { p1: { hand: ['Test Spark', 'Test Mutation'], battlefield: ['Test Ogre'], library: ['Test Bear'] }, defs: DEFS });
    const s1 = cast(s0, 'Test Spark');
    const spark = find(s1, 'Test Spark', 'stack', 'p1');
    const s = resolveAll(cast(s1, 'Test Mutation', { targets: [[obj(spark)]] }));
    expect(inGraveyard(s, 'Test Spark', 'p1')).toBe(true);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(1); // the card drawn first
  });
  it('with no creature the amount is 0: paying nothing, the spell is not countered', () => {
    const s0 = scenario([], { p1: { hand: ['Test Spark', 'Test Mutation'], library: ['Test Bear'] }, defs: DEFS });
    const s1 = cast(s0, 'Test Spark');
    const spark = find(s1, 'Test Spark', 'stack', 'p1');
    const s = resolveAll(cast(s1, 'Test Mutation', { targets: [[obj(spark)]] }), { yes: [true, true] });
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});
