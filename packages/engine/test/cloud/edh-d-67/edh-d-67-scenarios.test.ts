/**
 * Commander coordinator D, lane prevent-r2 (second pass of A's lane prevent), round edh-d-67: the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1; the games have three players. Each test is named after the rule it checks, with its negative case.
 * CR cites are from memory (unverified, see the round's record).
 *
 *   CR 609.7a, 615.1, 615.7, 615.8, 107.1a    "The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down." (Dark Sphere)
 *   CR 609.7a, 615.1a, 615.7, 615.8           "The next time a black or red source of your choice would deal damage this turn, prevent that damage." (Penance)
 *   CR 601.2h, 106.1, 615.1a, 510.2, 119.3    "Prevent all combat damage that would be dealt this turn if {W} was spent to cast this spell. Each player loses 1 life for each attacking creature they control if {B} was spent ..." (Batwing Brume)
 *   CR 615.5, 121.1, 107.1a, 510.2            "If ~ would deal combat damage to a player, prevent that damage. ~'s controller and that player each draw half that many cards, rounded down." (Sokrates, Athenian Teacher)
 *   CR 509.1c, 611.2a                         "All creatures your opponents control able to block that creature this turn do so." (You Look Upon the Tarrasque)
 *   CR 614.1a, 615.8, 705.2, 510.2            "Whenever a creature attacks, flip a coin. If you win the flip, the next time that creature would deal combat damage this turn, it deals double that damage instead. ..." (Impulsive Maneuvers)
 *   CR 120.3, 608.2b                          "~ deals X damage to target creature and 1 damage to each other creature with the same controller." (Fear, Fire, Foes!)
 *   CR 609.7a, 705.1, 614.1a, 615.7           "Choose a source you control and flip a coin. If you win the flip, the next time that source would deal damage ... double ... If you lose ... prevent" (Desperate Gambit)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, reject } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: (ObjectId | PlayerId)[]; yes?: boolean; option?: string; x?: number; pick?: ObjectId[]; all?: boolean } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, o.all === true ? targets.length : 1).map((id) => (id.startsWith('p') && !id.startsWith('o') ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as never);
    else if (p.kind === 'chooseOption') {
      const pick = o.option !== undefined ? p.options.filter((x) => x.label === o.option || x.id === o.option) : p.options.slice(0, p.min);
      s = answer(s, { kind: 'chooseOption', ids: pick.map((x) => x.id) });
    }
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick !== undefined ? o.pick.filter((id) => p.options.includes(id)).slice(0, p.max) : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState => resolveAll(drive(castBy(s, name, player), o), o);
const activate = (s: GameState, source: ObjectId, ability: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState =>
  resolveAll(drive(act(s, { type: 'activate', player, source, ability } as never), o), o);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onBf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (p === undefined || s.objects[id]!.controller === p));
const inGy = (s: GameState, name: string): number => Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]?.name === name).length;
const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const subtypes = (s: GameState, id: ObjectId): string => [...chars(s, id).subtypes].sort().join(' ');

/** Pass priority (answering decisions) until the next declare-attackers decision. */
function toAttackers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.result) throw new Error('The game ended');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
const declareAction = (s: GameState, attacks: [ObjectId, PlayerId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) } });
const declare = (s: GameState, attacks: [ObjectId, PlayerId][]): GameState => act(s, declareAction(s, attacks) as never);
function toBlockers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && s.pending?.kind !== 'declareBlockers'; i++) {
    if (s.turn.step === 'main2') throw new Error('No declare blockers decision came');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  return s;
}
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  throw new Error(`Never reached ${what}`);
}


const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const GOBLIN = card('Test Plain Goblin', 'Creature — Goblin', '', { pt: ['3', '3'], colors: ['R'] });
const BLASTER = card('Test Red Blaster', 'Creature — Goblin', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const ZAPPER = card('Test Zapper', 'Creature — Goblin', '{0}: This creature deals 1 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const GREEN_ZAPPER = card('Test Green Zapper', 'Creature — Elf', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['G'] });
const ORB = card('Test Dull Orb', 'Artifact', '{0}: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.');
const PENITENT = card('Test Penitent', 'Enchantment', 'Put a card from your hand on top of your library: The next time a black or red source of your choice would deal damage this turn, prevent that damage.');
const SWEEP = card('Test Sweep', 'Sorcery', '~ deals X damage to target creature and 1 damage to each other creature with the same controller.', { cost: '{X}' });
const SURGE = card('Test Surge', 'Instant', 'Target creature gets +5/+5 and gains indestructible until end of turn. All creatures your opponents control able to block that creature this turn do so.');
const WASTES = card('Test Wastes', 'Land', '{T}: Add {C}.');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [BEAR, GOBLIN, BLASTER, ZAPPER, GREEN_ZAPPER, ORB, PENITENT, SWEEP, SURGE, WASTES, GLOOM, SAGE, CLOUD, WAGER, GAMBIT]) expect(noManual(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Dark Sphere', 'Penance', 'Batwing Brume', 'Sokrates, Athenian Teacher', 'You Look Upon the Tarrasque', 'Impulsive Maneuvers', 'Fear, Fire, Foes!', 'Desperate Gambit'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 609.7a, 615.7, 615.8, 107.1a: "The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down." (Dark Sphere)', () => {
  const game = () => mpScenario({ players: 3, defs: [ORB, BLASTER, ZAPPER], zones: { p1: { battlefield: [{ name: 'Test Dull Orb', since: -1 }, { name: 'Test Red Blaster', since: -1 }, { name: 'Test Zapper', since: -1 }] } } });
  const orb = (s: GameState, source: ObjectId): GameState => activate(s, onBf(s, 'Test Dull Orb')[0]!, 'p:0:0', { pick: [source] });
  it('the chosen source\'s next damage to you is reduced by half of it rounded down: 3 damage is 2 damage', () => {
    const s0 = game();
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    const s = activate(orb(s0, blaster), blaster, 'p:0:0', { targets: ['p1'] });
    expect(life(s, 'p1')).toBe(18);
  });
  it('only the next time: the same source\'s second damage is dealt in full', () => {
    const s0 = game();
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    let s = activate(orb(s0, blaster), blaster, 'p:0:0', { targets: ['p1'] });
    s = activate(s, blaster, 'p:0:0', { targets: ['p1'] });
    expect(life(s, 'p1')).toBe(15);
  });
  it('1 damage: half rounded down is 0, nothing is prevented, and the shield is used up', () => {
    const s0 = game();
    const zap = onBf(s0, 'Test Zapper')[0]!;
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    let s = activate(orb(s0, zap), zap, 'p:0:0', { targets: ['p1'] });
    expect(life(s, 'p1')).toBe(19);
    s = activate(s, zap, 'p:0:0', { targets: ['p1'] });
    expect(life(s, 'p1')).toBe(18);
    expect(blaster).toBeDefined();
  });
  it('negative: the damage of another source than the chosen one is not reduced; damage to another player or a permanent is not either', () => {
    const s0 = game();
    const zap = onBf(s0, 'Test Zapper')[0]!;
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    const s = orb(s0, zap);
    expect(life(activate(s, blaster, 'p:0:0', { targets: ['p1'] }), 'p1')).toBe(17);
    expect(life(activate(s, zap, 'p:0:0', { targets: ['p2'] }), 'p2')).toBe(19);
    expect(life(activate(s, zap, 'p:0:0', { targets: ['p2'] }), 'p1')).toBe(20);
  });
});

describe('CR 609.7a, 615.1a, 615.7, 615.8: "The next time a black or red source of your choice would deal damage this turn, prevent that damage." (Penance)', () => {
  const game = () => mpScenario({ players: 3, defs: [PENITENT, BLASTER, GREEN_ZAPPER, BEAR], zones: { p1: { hand: ['Test Plain Bear'], battlefield: [{ name: 'Test Penitent', since: -1 }, { name: 'Test Red Blaster', since: -1 }, { name: 'Test Green Zapper', since: -1 }] }, p2: { battlefield: ['Test Plain Bear'] } } });
  const pen = (s: GameState, source: ObjectId): GameState => activate(s, onBf(s, 'Test Penitent')[0]!, 'p:0:0', { pick: [find(s, 'Test Plain Bear', 'hand', 'p1'), source] });
  it('the cost puts a card from your hand on top of your library', () => {
    const s0 = game();
    const s = pen(s0, onBf(s0, 'Test Red Blaster')[0]!);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1);
    expect(s.zones.hand.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name)).not.toContain('Test Plain Bear');
    expect(s.defs[s.objects[s.zones.library.p1![0]!]!.defId]!.name).toBe('Test Plain Bear');
  });
  it('the red source\'s next damage is prevented, whoever would be dealt it (a player; a permanent)', () => {
    const s0 = game();
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    const s = pen(s0, blaster);
    expect(life(activate(s, blaster, 'p:0:0', { targets: ['p2'] }), 'p2')).toBe(20);
    const bear = onBf(s0, 'Test Plain Bear', 'p2')[0]!;
    expect(activate(s, blaster, 'p:0:0', { targets: [bear] }).objects[bear]!.damage).toBe(0);
  });
  it('only the next time: the second damage of that source is dealt', () => {
    const s0 = game();
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    let s = activate(pen(s0, blaster), blaster, 'p:0:0', { targets: ['p2'] });
    s = activate(s, blaster, 'p:0:0', { targets: ['p2'] });
    expect(life(s, 'p2')).toBe(17);
  });
  it('negative: a green source is not offered as the choice', () => {
    const s0 = game();
    const green = onBf(s0, 'Test Green Zapper')[0]!;
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    const s = pen(s0, green); // the pick is not among the options, so the first black or red source is chosen
    expect(life(activate(s, green, 'p:0:0', { targets: ['p2'] }), 'p2')).toBe(17);
    expect(life(activate(s, blaster, 'p:0:0', { targets: ['p2'] }), 'p2')).toBe(20);
  });
});

describe('CR 120.3, 608.2b, 109.4: "~ deals X damage to target creature and 1 damage to each other creature with the same controller." (Fear, Fire, Foes!)', () => {
  const game = () => mpScenario({ players: 3, defs: [SWEEP, BEAR, GOBLIN, WASTES], zones: { p1: { hand: ['Test Sweep'], battlefield: ['Test Wastes', 'Test Wastes', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Goblin', 'Test Plain Bear', 'Test Plain Bear'] }, p3: { battlefield: ['Test Plain Bear'] } } });
  it('the target takes X; each other creature its controller controls takes 1; other players\' creatures and your own are untouched', () => {
    const s0 = game();
    const goblin = onBf(s0, 'Test Plain Goblin', 'p2')[0]!;
    const [b1, b2] = onBf(s0, 'Test Plain Bear', 'p2');
    const mine = onBf(s0, 'Test Plain Bear', 'p1')[0]!;
    const theirs = onBf(s0, 'Test Plain Bear', 'p3')[0]!;
    const s = cast(s0, 'Test Sweep', { targets: [goblin], x: 2 });
    expect(s.objects[goblin]?.zone === 'battlefield' ? s.objects[goblin]!.damage : -1).toBe(2);
    expect(s.objects[b1!]!.damage).toBe(1);
    expect(s.objects[b2!]!.damage).toBe(1);
    expect(s.objects[mine]!.damage).toBe(0);
    expect(s.objects[theirs]!.damage).toBe(0);
  });
});

describe('CR 509.1c, 611.2a: "All creatures your opponents control able to block that creature this turn do so." (You Look Upon the Tarrasque)', () => {
  const game = () => mpScenario({ players: 3, defs: [SURGE, BEAR, GOBLIN], zones: { p1: { hand: ['Test Surge'], battlefield: [{ name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Goblin', since: -1 }] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Goblin'] } } });
  it('every creature an opponent controls that can block the creature must block it: blocking with none, or with only one, is refused; blocking with both is legal', () => {
    const s0 = game();
    const bear = onBf(s0, 'Test Plain Bear', 'p1')[0]!;
    const s1 = cast(s0, 'Test Surge', { targets: [bear] });
    const s3 = toBlockers(declare(toAttackers(s1), [[bear, 'p2']]));
    expect(s3.pending?.kind).toBe('declareBlockers');
    expect((s3.pending as { player: PlayerId }).player).toBe('p2');
    const [b1, b2] = [onBf(s3, 'Test Plain Bear', 'p2')[0]!, onBf(s3, 'Test Plain Goblin', 'p2')[0]!];
    const decl = (blocks: { blocker: ObjectId; attacker: ObjectId }[]) => act(s3, { type: 'answer', player: 'p2', decisionId: (s3.pending as { id: string }).id, answer: { kind: 'declareBlockers', blocks } } as never);
    expect(() => decl([])).toThrow(/requirements/);
    expect(() => decl([{ blocker: b1, attacker: bear }])).toThrow(/requirements/);
    expect(decl([{ blocker: b1, attacker: bear }, { blocker: b2, attacker: bear }]).pending?.kind).not.toBe('declareBlockers');
  });
  it('negative: without the spell blocking nobody is allowed', () => {
    const s0 = game();
    const bear = onBf(s0, 'Test Plain Bear', 'p1')[0]!;
    const s3 = toBlockers(declare(toAttackers(s0), [[bear, 'p2']]));
    const ok = answer(s3, { kind: 'declareBlockers', blocks: [] });
    expect(ok.pending?.kind).not.toBe('declareBlockers');
  });
});

// ---- Batwing Brume ------------------------------------------------------------------------------------------------------------------------------------------------
const GLOOM = card('Test Gloom', 'Instant', 'Prevent all combat damage that would be dealt this turn if {W} was spent to cast this spell. Each player loses 1 life for each attacking creature they control if {B} was spent to cast this spell.', { cost: '{1}' });
describe('CR 601.2h, 106.1, 615.1a, 119.3: "Prevent all combat damage ... if {W} was spent to cast this spell. Each player loses 1 life for each attacking creature they control if {B} was spent ..." (Batwing Brume)', () => {
  const run = (land: string, attackers: string[]) => {
    const s0 = mpScenario({ players: 3, cards: [land], defs: [GLOOM, BEAR, GOBLIN], zones: { p1: { hand: ['Test Gloom'], battlefield: [land, ...attackers.map((name) => ({ name, since: -1 }))] } } });
    let s = declare(toAttackers(s0), attackers.map((n) => [onBf(s0, n)[0]!, 'p2'] as [ObjectId, PlayerId]));
    s = cast(s, 'Test Gloom');
    const lifeAfterCast = [life(s, 'p1'), life(s, 'p2')];
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    return { lifeAfterCast, p1: life(s, 'p1'), p2: life(s, 'p2') };
  };
  it('white mana spent: the combat damage is prevented and nobody loses life', () => {
    const r = run('Plains', ['Test Plain Bear']);
    expect(r.lifeAfterCast).toEqual([20, 20]);
    expect(r.p2).toBe(20);
  });
  it('black mana spent: each player loses 1 life for each attacking creature they control (only the attacker\'s controller here), and the combat damage is dealt', () => {
    const r = run('Swamp', ['Test Plain Bear', 'Test Plain Goblin']);
    expect(r.lifeAfterCast).toEqual([18, 20]);
    expect(r.p2).toBe(15); // 2 + 3 combat damage
  });
  it('negative: neither color spent (colorless mana): no prevention, no life loss', () => {
    const r = run('Wastes', ['Test Plain Bear']);
    expect(r.lifeAfterCast).toEqual([20, 20]);
    expect(r.p2).toBe(18);
  });
});

// ---- Sokrates, Athenian Teacher ----------------------------------------------------------------------------------------------------------------------------------
const CLOUD = card('Test Cloud', 'Artifact', '{0}: Damage can\'t be prevented this turn.');
const SAGE = card('Test Sage', 'Creature — Human Advisor', '{0}: Until end of turn, target creature gains "If this creature would deal combat damage to a player, prevent that damage. This creature\'s controller and that player each draw half that many cards, rounded down."', { pt: ['1', '1'] });
describe('CR 615.5, 121.1, 107.1a, 510.2: "If ~ would deal combat damage to a player, prevent that damage. ~\'s controller and that player each draw half that many cards, rounded down." (Sokrates, Athenian Teacher)', () => {
  const run = (attacker: string, grant: boolean) => {
    const s0 = mpScenario({ players: 3, defs: [SAGE, BEAR, GOBLIN, WASTES], zones: { p1: { battlefield: [{ name: 'Test Sage', since: -1 }, { name: attacker, since: -1 }] } } });
    const att = onBf(s0, attacker)[0]!;
    let s = grant ? activate(s0, onBf(s0, 'Test Sage')[0]!, 'p:0:0', { targets: [att] }) : s0;
    const h = [hand(s, 'p1'), hand(s, 'p2'), hand(s, 'p3')];
    s = declare(toAttackers(s), [[att, 'p2']]);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    return { life: life(s, 'p2'), drew: [hand(s, 'p1') - h[0]!, hand(s, 'p2') - h[1]!, hand(s, 'p3') - h[2]!] };
  };
  it('a 3-power creature with the grant: its damage to the player is prevented; its controller and that player each draw half of 3 rounded down = 1 card; nobody else', () => {
    const r = run('Test Plain Goblin', true);
    expect(r.life).toBe(20);
    expect(r.drew).toEqual([1, 1, 0]);
  });
  it('a 2-power creature: each draws 1', () => {
    const r = run('Test Plain Bear', true);
    expect(r.life).toBe(20);
    expect(r.drew).toEqual([1, 1, 0]);
  });
  it('ruling 2024-07-05: when the damage can\'t be prevented it is dealt, and the players still draw half that many cards, rounded down', () => {
    const s0 = mpScenario({ players: 3, defs: [SAGE, GOBLIN, CLOUD], zones: { p1: { battlefield: [{ name: 'Test Sage', since: -1 }, { name: 'Test Plain Goblin', since: -1 }, { name: 'Test Cloud', since: -1 }] } } });
    const att = onBf(s0, 'Test Plain Goblin')[0]!;
    let s = activate(s0, onBf(s0, 'Test Sage')[0]!, 'p:0:0', { targets: [att] });
    s = activate(s, onBf(s, 'Test Cloud')[0]!, 'p:0:0');
    const h = [hand(s, 'p1'), hand(s, 'p2'), hand(s, 'p3')];
    s = declare(toAttackers(s), [[att, 'p2']]);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(life(s, 'p2')).toBe(17);
    expect([hand(s, 'p1') - h[0]!, hand(s, 'p2') - h[1]!, hand(s, 'p3') - h[2]!]).toEqual([1, 1, 0]);
  });
  it('negative: without the grant the damage is dealt and nobody draws', () => {
    const r = run('Test Plain Goblin', false);
    expect(r.life).toBe(17);
    expect(r.drew).toEqual([0, 0, 0]);
  });
});

// ---- Impulsive Maneuvers ------------------------------------------------------------------------------------------------------------------------------------------
const WAGER = card('Test Wager', 'Enchantment', 'Whenever a creature attacks, flip a coin. If you win the flip, the next time that creature would deal combat damage this turn, it deals double that damage instead. If you lose the flip, the next time that creature would deal combat damage this turn, prevent that damage.');
describe('CR 614.1a, 615.8, 705.2, 510.2: "Whenever a creature attacks, flip a coin. If you win the flip, the next time that creature would deal combat damage this turn, it deals double that damage instead. If you lose ..., prevent that damage." (Impulsive Maneuvers)', () => {
  const run = (seed: string) => {
    const s0 = mpScenario({ players: 3, seed, defs: [WAGER, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Wager', { name: 'Test Plain Bear', since: -1 }] }, p2: { battlefield: ['Test Plain Goblin'] } } });
    const bear = onBf(s0, 'Test Plain Bear')[0]!;
    let s = declare(toAttackers(s0), [[bear, 'p2']]);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    return life(s, 'p2');
  };
  it('the attacking creature\'s combat damage is doubled (4) when the flip is won and prevented (0) when it is lost, never anything else; both outcomes occur', () => {
    const results = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((seed) => 20 - run(`coin-${seed}`));
    for (const r of results) expect([0, 4]).toContain(r);
    expect(results).toContain(0);
    expect(results).toContain(4);
  });
});

// ---- Desperate Gambit ---------------------------------------------------------------------------------------------------------------------------------------------
const GAMBIT = card('Test Gamble', 'Instant', 'Choose a source you control and flip a coin. If you win the flip, the next time that source would deal damage this turn, it deals double that damage instead. If you lose the flip, the next time it would deal damage this turn, prevent that damage.');
describe('CR 609.7a, 705.2, 614.1a, 615.8: "Choose a source you control and flip a coin. ... double ... prevent" (Desperate Gambit)', () => {
  const run = (seed: string, pickOther: boolean) => {
    const s0 = mpScenario({ players: 3, seed, defs: [GAMBIT, BLASTER, ZAPPER], zones: { p1: { hand: ['Test Gamble'], battlefield: [{ name: 'Test Red Blaster', since: -1 }, { name: 'Test Zapper', since: -1 }] } } });
    const blaster = onBf(s0, 'Test Red Blaster')[0]!;
    const zap = onBf(s0, 'Test Zapper')[0]!;
    let s = cast(s0, 'Test Gamble', { pick: [blaster] });
    s = activate(s, blaster, 'p:0:0', { targets: ['p2'] });
    const first = 20 - life(s, 'p2');
    s = activate(s, blaster, 'p:0:0', { targets: ['p2'] });
    const second = 20 - life(s, 'p2') - first;
    s = activate(s, zap, 'p:0:0', { targets: ['p3'] });
    return { first, second, other: 20 - life(s, 'p3'), pickOther };
  };
  it('the chosen source\'s next damage is doubled (6) or prevented (0), only that one time; its later damage and another source\'s damage are normal', () => {
    const results = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => run(`gamble-${seed}`, false));
    for (const r of results) {
      expect([0, 6]).toContain(r.first);
      expect(r.second).toBe(3);
      expect(r.other).toBe(1);
    }
    expect(results.map((r) => r.first)).toContain(0);
    expect(results.map((r) => r.first)).toContain(6);
  });
});

// ---- review fixes: one "time" for simultaneous damage ----------------------------------------------------------------------------------------------------------------
const BURNER = card('Test Burner', 'Creature — Goblin', '{0}: This creature deals 2 damage to each opponent.', { pt: ['1', '1'], colors: ['R'] });
const WAGER2 = card('Test Doubler', 'Instant', 'The next time target creature would deal damage this turn, it deals double that damage instead.');
describe('CR 615.8, 614.5: a doubling "next time" shield changes all the damage the source deals at that moment', () => {
  it('2 damage to each of two opponents at once is 4 and 4 (one time), the next activation is normal', () => {
    const s0 = mpScenario({ players: 3, defs: [BURNER, WAGER2], zones: { p1: { hand: ['Test Doubler'], battlefield: [{ name: 'Test Burner', since: -1 }] } } });
    const b = onBf(s0, 'Test Burner')[0]!;
    let s = cast(s0, 'Test Doubler', { targets: [b] });
    s = activate(s, b, 'p:0:0');
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([16, 16]);
    s = activate(s, b, 'p:0:0');
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([14, 14]);
  });
});
const PBURN = card('Test Penance Pit', 'Enchantment', 'Put a card from your hand on top of your library: The next time a black or red source of your choice would deal damage this turn, prevent that damage.');
describe('CR 615.8: a no-recipient prevention shield prevents all the damage its source deals at that moment (Penance)', () => {
  it('2 damage to each of two opponents is all prevented; the next activation is dealt', () => {
    const s0 = mpScenario({ players: 3, defs: [PBURN, BURNER, BEAR], zones: { p1: { hand: ['Test Plain Bear'], battlefield: [{ name: 'Test Penance Pit', since: -1 }, { name: 'Test Burner', since: -1 }] } } });
    const b = onBf(s0, 'Test Burner')[0]!;
    let s = activate(s0, onBf(s0, 'Test Penance Pit')[0]!, 'p:0:0', { pick: [find(s0, 'Test Plain Bear', 'hand', 'p1'), b] });
    s = activate(s, b, 'p:0:0');
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([20, 20]);
    s = activate(s, b, 'p:0:0');
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([18, 18]);
  });
});
const ORB2 = card('Test Dull Orb Two', 'Artifact', '{0}: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.');
describe('CR 616, 615.7: two half-prevention shields on one source both apply to its first damage and are both used up (Dark Sphere ruling 2013-04-15)', () => {
  it('5 damage then 5 damage with two shields: 3 is dealt, then 5', () => {
    const big = card('Test Big Blaster', 'Creature — Goblin', '{0}: This creature deals 5 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
    const s0 = mpScenario({ players: 3, defs: [ORB, ORB2, big], zones: { p1: { battlefield: [{ name: 'Test Dull Orb', since: -1 }, { name: 'Test Dull Orb Two', since: -1 }, { name: 'Test Big Blaster', since: -1 }] } } });
    const b = onBf(s0, 'Test Big Blaster')[0]!;
    let s = activate(s0, onBf(s0, 'Test Dull Orb')[0]!, 'p:0:0', { pick: [b] });
    s = activate(s, onBf(s, 'Test Dull Orb Two')[0]!, 'p:0:0', { pick: [b] });
    s = activate(s, b, 'p:0:0', { targets: ['p1'] });
    expect(life(s, 'p1')).toBe(18);
    s = activate(s, b, 'p:0:0', { targets: ['p1'] });
    expect(life(s, 'p1')).toBe(13);
  });
});
