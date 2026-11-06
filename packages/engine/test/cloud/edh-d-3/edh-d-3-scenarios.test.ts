/**
 * Coordinator D, round edh-d-3 (EDHREC ranks 12,501-13,750): the round's readings and engine changes played through the engine with synthetic cards (invented names
 * and wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its
 * negative case. CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-02).
 *
 *   CR 702.69a, 700.4      gravestorm: one copy for each permanent (a token too, whoever owned it) put into a graveyard from the battlefield this turn
 *   CR 601.3, 101.2        "Cast this spell only during an opponent's turn after their upkeep step."
 *   CR 118.12a, 700.8      "counter target spell unless its controller pays {1} plus an additional {1} for each creature in your party"
 *   CR 119.3, 603.2        "put a +1/+1 counter on target creature for each 1 life you gained"
 *   CR 613.1d, 613.1e      "target token you control becomes a green Bear creature with base power and toughness 4/4 in addition to its other colors and types"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, passBoth, reject, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: opts.cost ?? '{0}', colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const yes = { kind: 'yesNo' as const, yes: true };

/** Cast a card of `player` and answer its decisions (targets by `pick`, payment automatic) until it is on the stack. */
function castWith(s0: GameState, name: string, player: 'p1' | 'p2', pick: (offered: ObjectId[]) => TargetChoice[] = () => []): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick(s.pending.objects) });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'yesNo') s = answer(s, yes);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty (decisions such as "may" and payments answered yes / automatically). */
function resolveAll(s0: GameState, answers: 'yes' | 'no' = 'yes'): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    if (s.pending && s.pending.kind !== 'priority') {
      const k = s.pending.kind;
      s = k === 'yesNo' ? answer(s, { kind: 'yesNo', yes: answers === 'yes' }) : k === 'payCost' ? answer(s, { kind: 'payCost', auto: true })
        : k === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [obj((s.pending as { objects: ObjectId[] }).objects[0]!)] }) : pass(s);
    } else s = pass(s);
  }
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
const EXILER = card('Test Exiler', 'Sorcery', 'Exile all creatures.');
const SOLDIERS = card('Test Muster', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const STORMER = card('Test Gravestormer', 'Sorcery', 'Gravestorm\nYou gain 1 life.');
const GRAVE_DEFS = [BEAR, OGRE, WRATH, EXILER, SOLDIERS, STORMER];

describe('CR 702.69a: gravestorm (Bitter Ordeal, Follow the Bodies)', () => {
  it('the synthetic cards are automated', () => { for (const d of GRAVE_DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  const start = (hand: string[]) => scenario([], { p1: { hand, battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: GRAVE_DEFS });
  it('with no permanent put into a graveyard this turn it has no copy: one resolution (+1 life)', () => {
    const s = resolveAll(castWith(start(['Test Gravestormer']), 'Test Gravestormer', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('two creatures (any controller) and a token that died this turn: three copies, four resolutions (+4 life)', () => {
    let s = resolveAll(castWith(start(['Test Muster', 'Test Wrath', 'Test Gravestormer']), 'Test Muster', 'p1'));
    s = resolveAll(castWith(s, 'Test Wrath', 'p1'));
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear'); // the Bear died; the token ceased to exist after it was in the graveyard
    s = resolveAll(castWith(s, 'Test Gravestormer', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(24); // 1 + one copy for each of: Bear, Ogre, Soldier token
  });
  it('negative: creatures that were exiled, not put into a graveyard, and the spells themselves are not counted', () => {
    let s = resolveAll(castWith(start(['Test Exiler', 'Test Gravestormer']), 'Test Exiler', 'p1'));
    s = resolveAll(castWith(s, 'Test Gravestormer', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('negative: a permanent card put into a graveyard from the hand (discarded) is not counted', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gravestormer'], graveyard: ['Test Bear'] }, defs: GRAVE_DEFS });
    expect(lifeOf(resolveAll(castWith(s0, 'Test Gravestormer', 'p1')), 'p1')).toBe(21); // a card already in the graveyard was not put there from the battlefield
  });
});

const RESET = card('Test Reset', 'Instant', "Cast this spell only during an opponent's turn after their upkeep step.\nYou gain 1 life.");
describe('CR 601.3, 101.2, 500.1: "Cast this spell only during an opponent\'s turn after their upkeep step." (Reset)', () => {
  it('is automated', () => expect(full(RESET)).toBe(true));
  const game = () => scenario([], { p1: { hand: ['Test Reset'] }, defs: [RESET] });
  it('it cannot be cast on its controller\'s own turn', () => {
    const s = game();
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reset', 'hand', 'p1') }).message).toMatch(/restriction/i);
  });
  it('in an opponent\'s turn it cannot be cast in the upkeep step but can in the draw step', () => {
    let s = passUntil(game(), (x) => x.turn.number === 2 && x.turn.step === 'upkeep', "p2's upkeep");
    for (let i = 0; i < 4 && s.pending?.player !== 'p1'; i++) s = pass(s);
    expect(s.pending?.player).toBe('p1');
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reset', 'hand', 'p1') }).message).toMatch(/restriction/i);
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'draw' && x.pending?.player === 'p1', "p2's draw step, p1 priority");
    const done = resolveAll(castWith(s, 'Test Reset', 'p1'));
    expect(zoneNames(done, 'graveyard', 'p1')).toContain('Test Reset');
  });
});

const HUSH = card('Test Hush', 'Instant', 'Counter target spell unless its controller pays {1} plus an additional {1} for each creature in your party.');
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const CLERIC = card('Test Cleric', 'Creature — Human Cleric', '', { pt: ['1', '1'] });
const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', { pt: ['1', '1'] });
const CLERIC2 = card('Test Second Cleric', 'Creature — Human Cleric', '', { pt: ['1', '1'] });
describe('CR 118.12a, 700.8: "unless its controller pays {1} plus an additional {1} for each creature in your party" (Concerted Defense)', () => {
  it('is automated', () => expect(full(HUSH)).toBe(true));
  /** p1 casts a free instant, p2 (the party below) responds with the counterspell; p1 has `lands` Plains. Returns the state once the counterspell resolves up to the payment. */
  const toPayment = (lands: number, party: string[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Spark'], battlefield: Array(lands).fill('Plains') as string[] }, p2: { hand: ['Test Hush'], battlefield: party }, defs: [HUSH, SPARK, CLERIC, ROGUE, CLERIC2, BEAR] });
    s = castWith(s, 'Test Spark', 'p1');
    s = pass(s);
    s = castWith(s, 'Test Hush', 'p2', (o) => [obj(o[0]!)]);
    return passBoth(s);
  };
  it('a Cleric, a Rogue and a Bear make a party of two: the payment is {3}, and a player with three lands can pay it and keep the spell', () => {
    let s = toPayment(3, ['Test Cleric', 'Test Rogue', 'Test Bear']);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((s.pending as { prompt: string }).prompt).toContain('{1}{1}{1}');
    s = answer(s, yes);
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, s.pending.kind === 'payCost' ? { kind: 'payCost', auto: true } : yes);
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = pass(s);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Spark');
    expect(lifeOf(s, 'p1')).toBe(21); // it resolved, it was not countered
  });
  it('negative: two Clerics are one party member (up to one of each type): the payment is {2}, so two lands pay it and one land cannot', () => {
    const two = toPayment(2, ['Test Cleric', 'Test Second Cleric']);
    expect(two.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((two.pending as { prompt: string }).prompt).toContain('{1}{1}');
    const one = toPayment(1, ['Test Cleric', 'Test Second Cleric']);
    expect(one.pending?.kind).toBe('priority'); // cannot pay {2} with one land: countered, nobody is asked
    expect(lifeOf(one, 'p1')).toBe(20);
  });
  it('negative: a player with too few lands cannot pay and the spell is countered', () => {
    const s = toPayment(2, ['Test Cleric', 'Test Rogue']);
    expect(s.pending?.kind).toBe('priority');
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

const CRADLE = card('Test Cradle', 'Enchantment', 'Whenever you gain life, you may pay {1}{W}. If you do, put a +1/+1 counter on target creature for each 1 life you gained.');
const HEAL = card('Test Heal', 'Instant', 'You gain 3 life.');
describe('CR 119.3, 603.2, 122.1: "put a +1/+1 counter on target creature for each 1 life you gained" (Cradle of Vitality)', () => {
  it('is automated', () => expect(full(CRADLE)).toBe(true));
  const game = () => scenario([], { p1: { hand: ['Test Heal'], battlefield: ['Test Cradle', 'Test Bear', 'Plains', 'Plains'] }, p2: { hand: ['Test Heal'], battlefield: ['Test Ogre'] }, defs: [CRADLE, HEAL, BEAR, OGRE] });
  const counters = (s: GameState, name: string, p: 'p1' | 'p2') => s.objects[find(s, name, 'battlefield', p)]!.counters['+1/+1'] ?? 0;
  it('gaining 3 life and paying {1}{W}: three +1/+1 counters on the target', () => {
    const s = resolveAll(castWith(game(), 'Test Heal', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(counters(s, 'Test Bear', 'p1')).toBe(3);
  });
  it('negative: declining to pay puts no counters', () => {
    const s = resolveAll(castWith(game(), 'Test Heal', 'p1'), 'no');
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(counters(s, 'Test Bear', 'p1')).toBe(0);
  });
  it('negative: an opponent gaining life does not trigger it', () => {
    let s = pass(game());
    s = castWith(s, 'Test Heal', 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(23);
    expect(counters(s, 'Test Bear', 'p1')).toBe(0);
  });
});

const HALSIN = card('Test Druid', 'Legendary Creature — Elf Druid', '{1}: Until end of turn, target token you control becomes a green Bear creature with base power and toughness 4/4 in addition to its other colors and types.', { pt: ['3', '4'] });
describe('CR 613.1d, 613.1e, 611.2a: "target token you control becomes a green Bear creature with base power and toughness 4/4 in addition to its other colors and types" (Halsin)', () => {
  it('is automated', () => expect(full(HALSIN)).toBe(true));
  it('the token becomes a green Bear 4/4 until end of turn and keeps its other color and creature type; a nontoken is not a legal target', () => {
    const s0 = scenario([], { p1: { hand: ['Test Muster'], battlefield: ['Test Druid', 'Plains', 'Plains', 'Test Bear'] }, defs: [HALSIN, SOLDIERS, BEAR] });
    let s = resolveAll(castWith(s0, 'Test Muster', 'p1'));
    const token = findAll(s, 'Soldier', 'battlefield', 'p1')[0] ?? s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    const druid = find(s, 'Test Druid', 'battlefield', 'p1');
    const key = (s.defs[s.objects[druid]!.defId]!.faces[0]!.abilities.findIndex((a) => a.kind === 'activated'));
    s = act(s, { type: 'activate', player: 'p1', source: druid, ability: `p:0:${key}` } as never);
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = (s.pending as { objects: ObjectId[] }).objects;
    expect(offered).toContain(token);
    expect(offered).not.toContain(find(s, 'Test Bear', 'battlefield', 'p1'));
    s = answer(s, { kind: 'chooseTargets', targets: [obj(token)] });
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    const c = getChars(s, token)!;
    expect(`${c.power}/${c.toughness}`).toBe('4/4');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Soldier', 'Bear']));
    expect(c.colors).toEqual(expect.arrayContaining(['W', 'G']));
    s = passUntil(declareAttackers(toDeclareAttackers(s), []), (x) => x.turn.number === 2, 'next turn');
    expect(`${getChars(s, token)!.power}/${getChars(s, token)!.toughness}`).toBe('1/1');
  });
});

const PALADIN = card('Test Paladin', 'Creature — Human Ally', 'Whenever this creature or another Ally you control enters, you may have Allies you control gain lifelink until end of turn, and you may put a +1/+1 counter on this creature.', { pt: ['2', '2'] });
const SCOUT = card('Test Scout', 'Creature — Elf Ally', '', { pt: ['1', '1'] });
const TROLL = card('Test Troll', 'Creature — Troll', '', { pt: ['3', '3'] });
describe('CR 603.5, 608.2d, 611.2a, 122.1: "you may have Allies you control gain lifelink until end of turn, and you may put a +1/+1 counter on this creature" (Talus Paladin)', () => {
  it('is automated', () => expect(full(PALADIN)).toBe(true));
  const game = () => scenario([], { p1: { hand: ['Test Scout', 'Test Troll'], battlefield: ['Test Paladin', 'Test Bear'] }, defs: [PALADIN, SCOUT, TROLL, BEAR] });
  /** Cast the card, then answer each "may" of the trigger in turn with `answers`. */
  const run = (name: string, answers: boolean[]): GameState => {
    let s = castWith(game(), name, 'p1');
    s = pass(s); // the creature resolves: the trigger goes on the stack
    for (let guard = 0; guard < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      if (s.pending && s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: answers.shift() ?? false });
      else if (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    return s;
  };
  const lifelink = (s: GameState, name: string) => hasKeyword(getChars(s, find(s, name, 'battlefield', 'p1'))!, 'lifelink');
  const plus = (s: GameState, name: string) => s.objects[find(s, name, 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  it('another Ally entering: both choices accepted: every Ally you control gains lifelink (not the Bear) and the Paladin gets the counter', () => {
    const s = run('Test Scout', [true, true]);
    expect(lifelink(s, 'Test Scout')).toBe(true);
    expect(lifelink(s, 'Test Paladin')).toBe(true);
    expect(lifelink(s, 'Test Bear')).toBe(false);
    expect(plus(s, 'Test Paladin')).toBe(1);
  });
  it('each choice is its own: refusing the first and taking the second gives the counter but no lifelink', () => {
    const s = run('Test Scout', [false, true]);
    expect(lifelink(s, 'Test Paladin')).toBe(false);
    expect(plus(s, 'Test Paladin')).toBe(1);
  });
  it('taking the first and refusing the second gives lifelink but no counter', () => {
    const s = run('Test Scout', [true, false]);
    expect(lifelink(s, 'Test Scout')).toBe(true);
    expect(plus(s, 'Test Paladin')).toBe(0);
  });
  it('negative: a creature that is not an Ally entering does not trigger it', () => {
    const s = run('Test Troll', [true, true]);
    expect(lifelink(s, 'Test Paladin')).toBe(false);
    expect(plus(s, 'Test Paladin')).toBe(0);
  });
});

const SYLEX = card('Test Sylex', 'Artifact', "Players can't pay life to cast spells or to activate abilities that aren't mana abilities.");
const PAIN_IDOL = card('Test Pain Idol', 'Artifact', '{T}, Pay 1 life: Draw a card.');
const PAIN_MANA = card('Test Pain Engine', 'Artifact', '{T}, Pay 1 life: Add {G}.');
const PHYREXIAN = card('Test Phyrexian Spark', 'Instant', 'You gain 1 life.', { cost: '{1}{W/P}' });
describe('CR 118.3, 119.4, 605.1a: "Players can\'t pay life to cast spells or to activate abilities that aren\'t mana abilities" (Karn\'s Sylex)', () => {
  it('is automated', () => { for (const d of [SYLEX, PAIN_IDOL, PAIN_MANA, PHYREXIAN]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  const game = (sylex: boolean) => scenario([], { p1: { hand: ['Test Phyrexian Spark'], battlefield: [...(sylex ? ['Test Sylex'] : []), 'Test Pain Idol', 'Test Pain Engine', 'Plains'] }, defs: [SYLEX, PAIN_IDOL, PAIN_MANA, PHYREXIAN] });
  const idolKey = (s: GameState, name: string) => `p:0:${s.defs[s.objects[find(s, name, 'battlefield', 'p1')]!.defId]!.faces[0]!.abilities.findIndex((a) => a.kind === 'activated')}`;
  it('without it, life pays for an ability of an artifact and for a Phyrexian symbol', () => {
    const s = game(false);
    const idol = find(s, 'Test Pain Idol', 'battlefield', 'p1');
    expect(() => act(s, { type: 'activate', player: 'p1', source: idol, ability: idolKey(s, 'Test Pain Idol') } as never)).not.toThrow();
  });
  it('with it, a non-mana ability that costs life can\'t be activated', () => {
    const s = game(true);
    const idol = find(s, 'Test Pain Idol', 'battlefield', 'p1');
    expect(() => act(s, { type: 'activate', player: 'p1', source: idol, ability: idolKey(s, 'Test Pain Idol') } as never)).toThrow(/Action rejected/);
  });
  it('with it, life can\'t pay a Phyrexian mana symbol of a spell: one land is not enough for {1}{W/P} (the {1} is paid, the W/P needs W)', () => {
    const s = scenario(['Mountain'], { p1: { hand: ['Test Phyrexian Spark'], battlefield: ['Test Sylex', 'Mountain'] }, defs: [SYLEX, PHYREXIAN] });
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Phyrexian Spark', 'hand', 'p1') })).toThrow(/Action rejected/);
    const free = scenario(['Mountain'], { p1: { hand: ['Test Phyrexian Spark'], battlefield: ['Mountain'] }, defs: [SYLEX, PHYREXIAN] });
    expect(() => act(free, { type: 'cast', player: 'p1', card: find(free, 'Test Phyrexian Spark', 'hand', 'p1') })).not.toThrow();
  });
  it('negative: a resolving effect that has a player pay life is not banned (ruling 2022-09-09): "You may pay 2 life. If you do, draw two cards." still works', () => {
    const BARGAIN = card('Test Bargain', 'Sorcery', 'You may pay 2 life. If you do, draw two cards.');
    expect(full(BARGAIN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Bargain'], battlefield: ['Test Sylex'] }, defs: [SYLEX, BARGAIN] });
    const hand0 = s0.zones.hand['p1']!.length;
    const s = resolveAll(castWith(s0, 'Test Bargain', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 2);
  });
  it('negative: a mana ability that costs life is still allowed (it pays 1 life and adds mana)', () => {
    let s = game(true);
    const engine = find(s, 'Test Pain Engine', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: engine, ability: idolKey(s, 'Test Pain Engine') } as never);
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'payCost', auto: true });
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.map((u) => u.type)).toContain('G');
  });
});
