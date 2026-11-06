/**
 * Commander lane edh-next, round edh-next-51: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 702.78a, 601.2a     "Each noncreature spell you cast from exile has conspire." (Rassilon, the War President)
 *   CR 101.4, 701.23a      "Each other player may search their library for a land card and put that card onto the battlefield. Then each player who searched ... shuffles." (Hired Giant)
 *   CR 603.7, 109.2        "Until end of turn, whenever another creature dies, this creature deals 1 damage to each non-Wall creature." (Electric Seaweed)
 *   CR 603.2c, 701.21a     "Whenever this creature deals damage to one or more creatures, investigate." and "if you sacrificed three or more Clues this turn" (Briarbridge Patrol)
 *   CR 506.3, 508.4        "Activate only during the declare attackers step and only if you're attacking two or more opponents." (Nemesis Phoenix)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { mpScenario, passUntil, resolveStack, drive as mpDrive } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
/** Resolve everything on the stack. `yes` answers every yes/no; `take` picks which of the offered objects a choice takes. */
const resolveAll = (s0: GameState, yes = true, take: 'one' | 'all' | 'none' = 'one'): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 80 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: take === 'none' ? [] : take === 'all' ? (d.options ?? []) : (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
const cast = (s: GameState, name: string, yes = true, take: 'one' | 'all' | 'none' = 'one', player: PlayerId = 'p1'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never)), yes, take);
const targeting = (s: GameState, t: ObjectId | PlayerId): GameState => (s.pending?.kind === 'chooseTargets'
  ? settle(answer(s, { kind: 'chooseTargets', targets: [t === 'p1' || t === 'p2' || t === 'p3' ? { kind: 'player', id: t } : { kind: 'object', id: t }] } as DecisionAnswer)) : s);
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const bf = (s: GameState, p?: PlayerId): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => nameOf(s, id));
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;
const hasKeyword = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id)!.abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === kw);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const TANK = card('Test Tank', 'Creature — Golem', '', { pt: ['4', '4'] });
const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '4'] });
const MOOR = card('Test Moor', 'Land', '');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 702.78a, 601.2a: "Each noncreature spell you cast from exile has conspire."', () => {
  const WARDEN = card('Test Warden', 'Enchantment', 'When this enchantment enters, exile the top card of your library. You may play that card for as long as it remains exiled.\nEach noncreature spell you cast from exile has conspire.');
  const CHARM = card('Test Charm', 'Sorcery', 'You gain 1 life.');
  const defs = [WARDEN, CHARM, BEAR];
  it('is automated', () => { expect(noManual(WARDEN)).toEqual([]); });
  const withExiled = (top: string): GameState => cast(scenario([], { defs, p1: { hand: ['Test Warden', 'Test Charm'], library: [top] } }), 'Test Warden');
  it('a noncreature spell cast from exile has conspire on the stack; the same card cast from the hand does not', () => {
    const s = withExiled('Test Charm');
    const fromExile = legal(s, 'p1', 'cast').find((a) => a.label.includes('from exile'))!;
    const t = settle(act(s, fromExile.action));
    expect(hasKeyword(t, t.zones.stack[t.zones.stack.length - 1]!, 'conspire')).toBe(true);
    const u = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand', 'p1') } as never));
    expect(hasKeyword(u, u.zones.stack[u.zones.stack.length - 1]!, 'conspire')).toBe(false);
  });
  it('a creature spell cast from exile has no conspire', () => {
    const s = withExiled('Test Bear');
    const fromExile = legal(s, 'p1', 'cast').find((a) => a.label.includes('from exile'))!;
    const t = settle(act(s, fromExile.action));
    expect(hasKeyword(t, t.zones.stack[t.zones.stack.length - 1]!, 'conspire')).toBe(false);
  });
});

describe('CR 101.4, 701.23a: "Each other player may search their library for a land card and put that card onto the battlefield."', () => {
  const GIANT = card('Test Giant', 'Creature — Giant', 'When this creature enters, each other player may search their library for a land card and put that card onto the battlefield. Then each player who searched their library this way shuffles.', { pt: ['3', '3'] });
  const defs = [GIANT, MOOR, BEAR];
  it('is automated', () => { expect(noManual(GIANT)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Giant'], library: ['Test Bear', 'Test Moor'] }, p2: { library: ['Test Bear', 'Test Moor'] }, p3: { library: ['Test Bear', 'Test Moor'] } } });
  it('every other player who agrees puts a land from their library onto the battlefield under their control; the caster does not', () => {
    const s = cast(start(), 'Test Giant');
    expect(count(bf(s, 'p2'), 'Test Moor')).toBe(1);
    expect(count(bf(s, 'p3'), 'Test Moor')).toBe(1);
    expect(count(bf(s, 'p1'), 'Test Moor')).toBe(0);
    expect(names(s, 'library', 'p1')).toContain('Test Moor');
    expect(names(s, 'library', 'p2')).not.toContain('Test Moor');
  });
  it('a player who declines searches for nothing: no land arrives', () => {
    const s = cast(start(), 'Test Giant', false);
    expect(count(bf(s), 'Test Moor')).toBe(0);
    expect(names(s, 'library', 'p2')).toContain('Test Moor');
  });
});

describe('CR 603.7, 109.2: "Until end of turn, whenever another creature dies, this creature deals 1 damage to each non-Wall creature."', () => {
  const PLANT = card('Test Plant', 'Creature — Plant Wall', 'When this creature enters, until end of turn, whenever another creature dies, this creature deals 1 damage to each non-Wall creature.', { pt: ['0', '4'] });
  const defs = [PLANT, KILL, BEAR, TANK, WALL];
  it('is automated', () => { expect(noManual(PLANT)).toEqual([]); });
  const dmg = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.damage ?? 0;
  const start = (): GameState => cast(scenario([], { defs, p1: { hand: ['Test Plant', 'Test Kill'] }, p2: { hand: ['Test Kill'], battlefield: ['Test Bear', 'Test Tank', 'Test Wall'] } }), 'Test Plant');
  it('another creature dying deals 1 damage to each creature that is not a Wall, and not to the Walls', () => {
    const s0 = start();
    let t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') } as never));
    t = targeting(t, find(s0, 'Test Bear', 'battlefield'));
    const s = resolveAll(t);
    expect(bf(s)).not.toContain('Test Bear');
    expect(dmg(s, 'Test Tank')).toBe(1);
    expect(dmg(s, 'Test Wall')).toBe(0);
    expect(dmg(s, 'Test Plant')).toBe(0);
  });
  it('the creature itself dying does not trigger it, and the effect ends with the turn', () => {
    const s0 = start();
    let t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') } as never));
    t = targeting(t, find(s0, 'Test Plant', 'battlefield'));
    const s = resolveAll(t);
    expect(bf(s)).not.toContain('Test Plant');
    expect(dmg(s, 'Test Tank')).toBe(0);
    // the next turn (a fresh game): another creature dies, nothing happens any more
    const u0 = start();
    const u1 = advanceTo(u0, 2, 'main1');
    let v = settle(act(u1, { type: 'cast', player: 'p2', card: find(u1, 'Test Kill', 'hand', 'p2') } as never));
    v = targeting(v, find(u1, 'Test Bear', 'battlefield'));
    const w = resolveAll(v);
    expect(dmg(w, 'Test Tank')).toBe(0);
  });
});

describe('CR 603.2c, 701.21a: "Whenever this creature deals damage to one or more creatures, investigate." and "if you sacrificed three or more Clues this turn"', () => {
  const PATROL = card('Test Patrol', 'Creature — Human Warrior', 'Whenever this creature deals damage to one or more creatures, investigate.\nAt the beginning of each end step, if you sacrificed three or more Clues this turn, you may put a creature card from your hand onto the battlefield.\n{0}: This creature deals 1 damage to each creature your opponents control.\n{0}: This creature deals 1 damage to target player.', { pt: ['2', '2'] });
  const CLUE = card('Test Clue', 'Artifact — Clue', '{0}, Sacrifice this artifact: You gain 1 life.');
  const defs = [PATROL, CLUE, BEAR, TANK];
  it('is automated', () => { expect(noManual(PATROL)).toEqual([]); });
  const ability = (s: GameState, text: string) => legal(s, 'p1', 'activate').find((a) => a.label.includes(text))!;
  it('damage to two creatures at once is one occurrence: one Clue, not two', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Patrol'] }, p2: { battlefield: ['Test Bear', 'Test Tank'] } });
    const s = resolveAll(settle(act(s0, ability(s0, 'each creature').action)));
    expect(s.objects[find(s, 'Test Tank', 'battlefield')]!.damage).toBe(1);
    expect(count(bf(s, 'p1'), 'Clue Token')).toBe(1);
  });
  it('damage to a player alone does not trigger it', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Patrol'] }, p2: { battlefield: ['Test Bear'] } });
    let t = settle(act(s0, ability(s0, 'target player').action));
    t = targeting(t, 'p2');
    const s = resolveAll(t);
    expect(count(bf(s, 'p1'), 'Clue Token')).toBe(0);
  });
  const sacrificeClues = (n: number): GameState => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Patrol', 'Test Clue', 'Test Clue', 'Test Clue'] } });
    for (let i = 0; i < n; i++) s = resolveAll(settle(act(s, legal(s, 'p1', 'activate').find((a) => a.label.includes('Sacrifice'))!.action)));
    return resolveAll(advanceTo(s, 1, 'end'));
  };
  it('three Clues sacrificed this turn: at the end step the controller may put a creature card from their hand onto the battlefield', () => {
    expect(bf(sacrificeClues(3), 'p1')).toContain('Test Bear');
  });
  it('two Clues sacrificed are not enough; three sacrificed but the controller declining keeps the card in hand', () => {
    expect(bf(sacrificeClues(2), 'p1')).not.toContain('Test Bear');
  });
  it('three Clues sacrificed but the controller declining keeps the card in hand', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Patrol', 'Test Clue', 'Test Clue', 'Test Clue'] } });
    for (let i = 0; i < 3; i++) s = resolveAll(settle(act(s, legal(s, 'p1', 'activate').find((a) => a.label.includes('Sacrifice'))!.action)));
    s = resolveAll(advanceTo(s, 1, 'end'), true, 'none');
    expect(bf(s, 'p1')).not.toContain('Test Bear');
  });
});

describe('CR 506.3, 508.4: "Activate only during the declare attackers step and only if you\'re attacking two or more opponents."', () => {
  const PHOENIX = card('Test Phoenix', 'Creature — Phoenix', '{0}: Return this card from your graveyard to the battlefield tapped and attacking. Activate only during the declare attackers step and only if you\'re attacking two or more opponents.', { pt: ['3', '3'] });
  const SCOUT = card('Test Scout', 'Creature — Human Scout', '', { pt: ['1', '1'] });
  const defs = [PHOENIX, SCOUT];
  it('is automated', () => { expect(noManual(PHOENIX)).toEqual([]); });
  const activations = (s: GameState): number => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.label.includes('graveyard')).length;
  const attackWith = (defenders: string[]): GameState => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { graveyard: ['Test Phoenix'], battlefield: ['Test Scout', 'Test Scout'] } } });
    const s1 = passUntil(s0, (t) => t.pending?.kind === 'declareAttackers' && t.pending.player === 'p1', 'the attack of p1');
    const scouts = findAll(s1, 'Test Scout', 'battlefield');
    return mpDrive(answer(s1, { kind: 'declareAttackers', attacks: scouts.map((id, i) => ({ attacker: id, defender: defenders[i]! })) }));
  };
  it('attacking two opponents: it may be returned during the declare attackers step, tapped and attacking', () => {
    const s = attackWith(['p2', 'p3']);
    expect(s.turn.step).toBe('declareAttackers');
    expect(activations(s)).toBe(1);
    const t = resolveStack(mpDrive(act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.label.includes('graveyard'))!.action)), [{ kind: 'chooseOption', ids: ['p2'] } as unknown as DecisionAnswer]);
    expect(bf(t, 'p1')).toContain('Test Phoenix');
    expect(t.objects[find(t, 'Test Phoenix', 'battlefield')]!.tapped).toBe(true);
    expect(t.combat!.attackers.some((x) => x.id === find(t, 'Test Phoenix', 'battlefield'))).toBe(true);
  });
  it('attacking one opponent with both creatures: it may not be returned', () => {
    expect(activations(attackWith(['p2', 'p2']))).toBe(0);
  });
  it('a creature removed from combat no longer counts: with one of the two attackers destroyed it may not be returned', () => {
    const s = attackWith(['p2', 'p3']);
    const kill = card('Test Slay', 'Instant', 'Destroy target creature.');
    expect(kill.id).toBeDefined();
    const t = { ...s, combat: { ...s.combat!, attackers: s.combat!.attackers.slice(0, 1) } } as GameState;
    expect(activations(t)).toBe(0);
  });
  it('before attackers are declared (first main phase) it may not be returned even when two opponents will be attacked', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { graveyard: ['Test Phoenix'], battlefield: ['Test Scout', 'Test Scout'] } } });
    expect(activations(s0)).toBe(0);
  });
});
