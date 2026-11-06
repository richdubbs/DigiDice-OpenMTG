/**
 * Commander lane edh-next, round edh-next-10: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 614.1a, 120.3, 122.1     "If damage would be dealt to ~, put that many +1/+1 counters on it instead." (Phytohydra); "... noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead." (Soul-Scar Mage)
 *   CR 615.1, 615.5, 122.1      "If damage would be dealt to ~, prevent that damage. Put a -1/-1 counter on ~ for each 1 damage prevented this way." (Phyrexian Hydra)
 *   CR 615.1a, 615.5, 119.3     "Prevent all damage that would be dealt by creatures this turn. You gain life equal to the damage prevented this way." (Chant of Vitu-Ghazi)
 *   CR 615.5, 406.1             "If damage would be dealt to you, prevent that damage. Exile a card from your graveyard for each 1 damage prevented this way." (Immortal Coil)
 *   CR 608.2d, 611.2c, 613.4c   "Target creature gets +1/+1 and gains your choice of deathtouch or lifelink until end of turn." (Alchemist's Gift); "... becomes the color of your choice ..." (Wild Mongrel)
 *   CR 120.3, 615.1a            "Prevent all damage that would be dealt this turn by non-Human sources." (Repel the Abominable)
 *   CR 614.15, 608.2c           "If an opponent has eight or more cards in their graveyard, instead counter that spell, then scry 2." (Anticognition)
 *   CR 613.1f, 613.4b           "Enchanted creature has base power and toughness 0/2, has defender, and loses all other abilities." (Stasis Field); "... is a blue Fish with base power and toughness 0/1." (Ichthyomorphosis)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0', player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player, source, ability } as never), q), q);
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'exile' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const count = (s: GameState, zone: 'graveyard' | 'exile', owner: string): number => Object.values(s.objects).filter((o) => o.zone === zone && o.owner === owner).length;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const marked = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const withGraveyard = (s: GameState, owner: string, n: number, filler = ''): GameState => tweak(s, (g) => {
  for (let i = 0; i < n; i++) {
    const id = `gy-${owner}-${i}` as ObjectId;
    const any = Object.values(g.objects).find((o) => o.owner === owner && (filler === '' || g.defs[o.defId]?.name === filler))!;
    g.objects[id] = { ...any, id, zone: 'graveyard', damage: 0, counters: {} } as never;
    g.zones.graveyard[owner]!.push(id);
  }
});

const PHYTO = card('Test Phytohydra', 'Creature — Plant Hydra', 'If damage would be dealt to this creature, put that many +1/+1 counters on it instead.', ['3', '3']);
const HYDRA = card('Test Hydra', 'Creature — Hydra', 'If damage would be dealt to this creature, prevent that damage. Put a -1/-1 counter on this creature for each 1 damage prevented this way.', ['5', '5']);
const SCAR = card('Test Scar Mage', 'Creature — Wizard', 'If a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead.', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const BIG = card('Test Big Bear', 'Creature — Bear', '', ['5', '5']);
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.');
const CHANT = card('Test Chant', 'Instant', 'Prevent all damage that would be dealt by creatures this turn. You gain life equal to the damage prevented this way.');
const COIL = card('Test Coil', 'Artifact', 'If damage would be dealt to you, prevent that damage. Exile a card from your graveyard for each 1 damage prevented this way.');
const PINGER = card('Test Pinger', 'Creature — Goblin', '{0}: This creature deals 4 damage to target player.', ['2', '2']);
const GIFT = card('Test Gift', 'Instant', 'Target creature gets +1/+1 and gains your choice of deathtouch or lifelink until end of turn.');
const MONGREL = card('Test Mongrel', 'Creature — Dog', 'Discard a card: This creature gets +1/+1 and becomes the color of your choice until end of turn.', ['2', '2']);
const REPEL = card('Test Repel', 'Instant', 'Prevent all damage that would be dealt this turn by non-Human sources.');
const HUMAN = card('Test Human Pinger', 'Creature — Human Wizard', '{0}: This creature deals 2 damage to target player.', ['1', '1']);
const ELF = card('Test Elf Pinger', 'Creature — Elf Wizard', '{0}: This creature deals 2 damage to target player.', ['1', '1']);
const ANTICOG = card('Test Anticog', 'Instant', 'Counter target creature or planeswalker spell unless its controller pays {2}.\nIf an opponent has eight or more cards in their graveyard, instead counter that spell, then scry 2.', undefined, '{0}');
const STASIS = card('Test Stasis', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has base power and toughness 0/2, has defender, and loses all other abilities.');
const FISH = card('Test Fishing', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a blue Fish with base power and toughness 0/1.');
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying\nTrample', ['4', '4']);
const SPELLBEAR = card('Test Spell Bear', 'Creature — Bear', '', ['2', '2'], '{0}');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [PHYTO, HYDRA, SCAR, BEAR, BIG, BOLT, CHANT, COIL, PINGER, GIFT, MONGREL, REPEL, HUMAN, ELF, ANTICOG, STASIS, FISH, FLIER, SPELLBEAR]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 614.1a, 120.3, 122.1: "If damage would be dealt to ~, put that many +1/+1 counters on it instead." (Phytohydra)', () => {
  const game = () => mpScenario({ players: 3, defs: [PHYTO, BOLT, BEAR], zones: { p1: { hand: ['Test Bolt'] }, p2: { battlefield: ['Test Phytohydra', 'Test Bear'] } } });
  it('3 damage to it is no damage: it gets 3 +1/+1 counters instead', () => {
    const s0 = game();
    const s = cast(s0, 'Test Bolt', { targets: [[obj(byName(s0, 'Test Phytohydra'))]] });
    const id = byName(s, 'Test Phytohydra');
    expect(marked(s, id)).toBe(0);
    expect(counters(s, id, '+1/+1')).toBe(3);
    expect(stat(s, id)).toBe('6/6');
  });
  it('negative: another creature takes the damage as usual, and no counters are put on it', () => {
    const s0 = game();
    const s = cast(s0, 'Test Bolt', { targets: [[obj(byName(s0, 'Test Bear'))]] });
    expect(Object.values(s.objects).some((o) => s.defs[o.defId]?.name === 'Test Bear' && o.zone === 'graveyard')).toBe(true); // 3 damage destroyed the 3/3
    expect(counters(s, byName(s, 'Test Phytohydra'), '+1/+1')).toBe(0);
  });
});

describe('CR 615.1, 615.5, 122.1: "If damage would be dealt to ~, prevent that damage. Put a -1/-1 counter on ~ for each 1 damage prevented this way." (Phyrexian Hydra)', () => {
  const game = () => mpScenario({ players: 3, defs: [HYDRA, BOLT, BEAR], zones: { p1: { hand: ['Test Bolt'] }, p2: { battlefield: ['Test Hydra', 'Test Bear'] } } });
  it('3 damage is prevented and it gets three -1/-1 counters (5/5 becomes 2/2, no damage marked)', () => {
    const s0 = game();
    const s = cast(s0, 'Test Bolt', { targets: [[obj(byName(s0, 'Test Hydra'))]] });
    const id = byName(s, 'Test Hydra');
    expect(marked(s, id)).toBe(0);
    expect(counters(s, id, '-1/-1')).toBe(3);
    expect(stat(s, id)).toBe('2/2');
  });
  it('negative: damage to another creature makes no counters on it; damage to a player is not prevented', () => {
    const s0 = game();
    const a = cast(s0, 'Test Bolt', { targets: [[obj(byName(s0, 'Test Bear'))]] });
    expect(counters(a, byName(a, 'Test Hydra'), '-1/-1')).toBe(0);
    const b = cast(s0, 'Test Bolt', { targets: [[plr('p2')]] });
    expect(lifeOf(b, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
  });
});

describe('CR 614.1a, 120.3, 122.1: "If a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead." (Soul-Scar Mage)', () => {
  const game = () => mpScenario({ players: 3, defs: [SCAR, BOLT, BEAR, BIG], zones: { p1: { hand: ['Test Bolt'], battlefield: ['Test Scar Mage', 'Test Bear'] }, p2: { battlefield: ['Test Big Bear'] } } });
  it('your 3 damage to an opponent\'s 5/5 makes three -1/-1 counters (2/2) and marks no damage', () => {
    const s0 = game();
    const s = cast(s0, 'Test Bolt', { targets: [[obj(byName(s0, 'Test Big Bear'))]] });
    const id = byName(s, 'Test Big Bear');
    expect(counters(s, id, '-1/-1')).toBe(3);
    expect(marked(s, id)).toBe(0);
    expect(stat(s, id)).toBe('2/2');
  });
  it('negative: damage to your own creature or to a player is dealt as usual', () => {
    const s0 = game();
    const a = cast(s0, 'Test Bolt', { targets: [[obj(byName(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(Object.values(a.objects).some((o) => a.defs[o.defId]?.name === 'Test Bear' && o.zone === 'graveyard' && o.owner === 'p1')).toBe(true); // 3 damage to your own 3/3 is dealt in full
    const b = cast(s0, 'Test Bolt', { targets: [[plr('p2')]] });
    expect(lifeOf(b, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
  });
});

describe('CR 615.1a, 615.5, 119.3: "Prevent all damage that would be dealt by creatures this turn. You gain life equal to the damage prevented this way." (Chant of Vitu-Ghazi)', () => {
  const game = () => mpScenario({ players: 3, defs: [CHANT, PINGER, BOLT, BEAR], zones: { p1: { hand: ['Test Chant', 'Test Bolt'], battlefield: ['Test Pinger'] }, p2: { battlefield: ['Test Bear'] } } });
  it('damage by a creature is prevented and you gain that much life (4 damage: +4 life for you, none lost by the target)', () => {
    const s0 = game();
    const a = cast(s0, 'Test Chant', {});
    const b = activate(a, byName(a, 'Test Pinger'), { targets: [[plr('p2')]] });
    expect(lifeOf(b, 'p2')).toBe(lifeOf(s0, 'p2'));
    expect(lifeOf(b, 'p1')).toBe(lifeOf(s0, 'p1') + 4);
  });
  it('negative: damage by a noncreature source is not prevented and gains nothing; before the Chant, creature damage is dealt', () => {
    const s0 = game();
    const a = cast(s0, 'Test Chant', {});
    const b = cast(a, 'Test Bolt', { targets: [[plr('p2')]] });
    expect(lifeOf(b, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(lifeOf(b, 'p1')).toBe(lifeOf(s0, 'p1'));
    const c = activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p2')]] });
    expect(lifeOf(c, 'p2')).toBe(lifeOf(s0, 'p2') - 4);
  });
});

describe('CR 615.5, 406.1: "If damage would be dealt to you, prevent that damage. Exile a card from your graveyard for each 1 damage prevented this way." (Immortal Coil)', () => {
  const game = (n: number) => withGraveyard(mpScenario({ players: 3, defs: [COIL, PINGER, BEAR], zones: { p1: { battlefield: ['Test Pinger'] }, p2: { battlefield: ['Test Coil', 'Test Bear'] } } }), 'p2', n);
  it('4 damage to you is prevented and you exile 4 cards from your graveyard (a graveyard of 6 keeps 2)', () => {
    const s0 = game(6);
    const pick: DecisionAnswer = { kind: 'chooseObjects', ids: [0, 1, 2, 3].map((i) => `gy-p2-${i}` as ObjectId) };
    const s = activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p2')]], answers: [pick] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
    expect(count(s, 'graveyard', 'p2')).toBe(2);
    expect(count(s, 'exile', 'p2')).toBe(4);
  });
  it('a graveyard smaller than the damage is exiled whole; negative: damage to a creature or to the other player is not prevented and exiles nothing', () => {
    const s0 = game(3);
    const s = activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p2')]] });
    expect(count(s, 'exile', 'p2')).toBe(3);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
    const t = activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p3')]] });
    expect(lifeOf(t, 'p3')).toBe(lifeOf(s0, 'p3') - 4);
    expect(count(t, 'exile', 'p2')).toBe(0);
  });
});

describe('CR 608.2d, 611.2c, 613.4c: "Target creature gets +1/+1 and gains your choice of deathtouch or lifelink until end of turn." (Alchemist\'s Gift)', () => {
  const game = () => mpScenario({ players: 3, defs: [GIFT, BEAR], zones: { p1: { hand: ['Test Gift'], battlefield: ['Test Bear'] } } });
  const choose = (value: 'deathtouch' | 'lifelink'): DecisionAnswer => ({ kind: 'chooseOption', ids: [value === 'deathtouch' ? '0' : '1'] });
  it('the +1/+1 is given with the keyword you chose, and only that one (deathtouch, then lifelink)', () => {
    const s0 = game();
    const bear = byName(s0, 'Test Bear');
    const a = cast(s0, 'Test Gift', { targets: [[obj(bear)]], answers: [choose('deathtouch')] });
    expect(stat(a, bear)).toBe('4/4');
    expect(kw(a, bear)).toContain('deathtouch');
    expect(kw(a, bear)).not.toContain('lifelink');
    const b = cast(s0, 'Test Gift', { targets: [[obj(bear)]], answers: [choose('lifelink')] });
    expect(kw(b, bear)).toContain('lifelink');
    expect(kw(b, bear)).not.toContain('deathtouch');
  });
  it('negative: the creature not targeted gets nothing', () => {
    const s0 = mpScenario({ players: 3, defs: [GIFT, BEAR], zones: { p1: { hand: ['Test Gift'], battlefield: ['Test Bear', 'Test Bear'] } } });
    const [x, y] = Object.values(s0.objects).filter((o) => s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const a = cast(s0, 'Test Gift', { targets: [[obj(x!)]], answers: [choose('deathtouch')] });
    expect(stat(a, y!)).toBe('3/3');
    expect(kw(a, y!)).not.toContain('deathtouch');
  });
});

describe('CR 608.2d, 611.2c, 105.3: "~ gets +1/+1 and becomes the color of your choice until end of turn." (Wild Mongrel)', () => {
  const discard = (s: GameState): DecisionAnswer => ({ kind: 'chooseObjects', ids: [Object.values(s.objects).find((o) => o.zone === 'hand' && o.owner === 'p1')!.id] });
  const color = (c: 'R' | 'G' | 'U'): DecisionAnswer => ({ kind: 'chooseColor', color: c });
  it('discarding a card makes it a 3/3 of the color you chose (replacing its colors); a second discard stacks', () => {
    const s0 = mpScenario({ players: 3, defs: [MONGREL, BEAR], zones: { p1: { hand: ['Test Bear', 'Test Bear'], battlefield: ['Test Mongrel'] } } });
    const mg = byName(s0, 'Test Mongrel');
    const a = activate(s0, mg, { answers: [discard(s0), color('R')] });
    expect(stat(a, mg)).toBe('3/3');
    expect(getChars(a, mg)!.colors).toEqual(['R']);
    const b = activate(a, mg, { answers: [discard(a), color('G')] });
    expect(stat(b, mg)).toBe('4/4');
    expect(getChars(b, mg)!.colors).toEqual(['G']);
  });
  it('negative: another creature is not changed', () => {
    const s0 = mpScenario({ players: 3, defs: [MONGREL, BEAR], zones: { p1: { hand: ['Test Bear'], battlefield: ['Test Mongrel'] }, p2: { battlefield: ['Test Bear'] } } });
    const a = activate(s0, byName(s0, 'Test Mongrel'), { answers: [discard(s0), color('U')] });
    expect(stat(a, byName(a, 'Test Bear', 'battlefield', 'p2'))).toBe('3/3');
  });
});

describe('CR 120.3, 615.1a: "Prevent all damage that would be dealt this turn by non-Human sources." (Repel the Abominable)', () => {
  const game = () => mpScenario({ players: 3, defs: [REPEL, ELF, HUMAN, BOLT], zones: { p1: { hand: ['Test Repel', 'Test Bolt'], battlefield: ['Test Elf Pinger', 'Test Human Pinger'] } } });
  it('damage by a non-Human creature and by a spell is prevented; damage by a Human is dealt', () => {
    const s0 = game();
    const a = cast(s0, 'Test Repel', {});
    expect(lifeOf(activate(a, byName(a, 'Test Elf Pinger'), { targets: [[plr('p2')]] }), 'p2')).toBe(lifeOf(s0, 'p2'));
    expect(lifeOf(cast(a, 'Test Bolt', { targets: [[plr('p2')]] }), 'p2')).toBe(lifeOf(s0, 'p2'));
    expect(lifeOf(activate(a, byName(a, 'Test Human Pinger'), { targets: [[plr('p2')]] }), 'p2')).toBe(lifeOf(s0, 'p2') - 2);
  });
  it('negative: before it resolves, a non-Human creature deals its damage', () => {
    const s0 = game();
    expect(lifeOf(activate(s0, byName(s0, 'Test Elf Pinger'), { targets: [[plr('p2')]] }), 'p2')).toBe(lifeOf(s0, 'p2') - 2);
  });
});

describe('CR 614.15, 608.2c, 118.12a: "Counter target creature or planeswalker spell unless its controller pays {2}. If an opponent has eight or more cards in their graveyard, instead counter that spell, then scry 2." (Anticognition)', () => {
  /** Alice (with `mana` Plains) casts a bear; Bob (holding Anticognition) casts it on the bear spell; `pay` answers Alice's offer. Alice's graveyard holds `gy` copies of a filler card. */
  const play = (gy: number, plains: number, pay: boolean): { s: GameState; offered: boolean; scried: boolean } => {
    const s0 = withGraveyard(mpScenario({ players: 3, defs: [ANTICOG, SPELLBEAR, BEAR], zones: { p1: { hand: ['Test Spell Bear'], battlefield: Array(plains).fill('Plains'), graveyard: ['Test Bear'] }, p2: { hand: ['Test Anticog'] } } }), 'p1', gy - 1, 'Test Bear'); // plus the Test Bear card the zone list already holds: `gy` cards in all
    const a = pass(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spell Bear', 'hand', 'p1') } as never));
    const spell = Object.values(a.objects).find((o) => o.zone === 'stack' && a.defs[o.defId]?.name === 'Test Spell Bear')!.id;
    let z = settle(act(a, { type: 'cast', player: 'p2', card: find(a, 'Test Anticog', 'hand', 'p2') } as never), { targets: [[obj(spell)]] });
    let offered = false;
    let scried = false;
    for (let i = 0; i < 40 && z.pending; i++) {
      const p = z.pending;
      if (p.kind === 'priority') { if (z.zones.stack.length === 0) break; z = pass(z); }
      else if (p.kind === 'chooseObjects' || p.kind === 'order') { scried = true; z = p.kind === 'order' ? answer(z, { kind: 'order', ids: p.items.map((x) => x.id) }) : answer(z, { kind: 'chooseObjects', ids: [] }); }
      else if (p.kind === 'yesNo') { offered = true; z = answer(z, { kind: 'yesNo', yes: pay }); }
      else if (p.kind === 'payCost') { offered = true; z = answer(z, { kind: 'payCost', auto: true }); }
      else z = settle(z, {});
    }
    return { s: z, offered, scried };
  };
  const bearOn = (s: GameState, zone: string): boolean => Object.values(s.objects).some((o) => s.defs[o.defId]?.name === 'Test Spell Bear' && o.zone === zone);
  it('with eight cards in the opponent\'s graveyard the spell is countered outright: no payment is offered even to a player who could pay, and Bob scries 2', () => {
    const r = play(8, 2, true);
    expect(bearOn(r.s, 'graveyard')).toBe(true);
    expect(bearOn(r.s, 'battlefield')).toBe(false);
    expect(r.offered).toBe(false);
    expect(r.scried).toBe(true);
  });
  it('negative: with seven cards it is the "unless pays" counter: a controller who pays {2} keeps the spell, one who declines loses it, and nobody scries', () => {
    const paid = play(7, 2, true);
    expect(paid.offered).toBe(true);
    expect(bearOn(paid.s, 'battlefield')).toBe(true);
    expect(paid.scried).toBe(false);
    const declined = play(7, 2, false);
    expect(bearOn(declined.s, 'battlefield')).toBe(false);
  });
});

describe('CR 613.1f, 613.4b: "Enchanted creature has base power and toughness 0/2, has defender, and loses all other abilities." (Stasis Field) and "... loses all abilities and is a blue Fish with base power and toughness 0/1." (Ichthyomorphosis)', () => {
  it('Stasis Field: the creature is 0/2 with defender and has lost flying and trample; another creature is unchanged', () => {
    const s0 = mpScenario({ players: 3, defs: [STASIS, FLIER, BEAR], zones: { p1: { hand: ['Test Stasis'], battlefield: ['Test Flier', 'Test Bear'] } } });
    const fl = byName(s0, 'Test Flier');
    const s = cast(s0, 'Test Stasis', { targets: [[obj(fl)]] });
    expect(stat(s, fl)).toBe('0/2');
    expect(kw(s, fl)).toContain('defender');
    expect(kw(s, fl)).not.toContain('flying');
    expect(kw(s, fl)).not.toContain('trample');
    expect(stat(s, byName(s, 'Test Bear'))).toBe('3/3');
  });
  it('Ichthyomorphosis: the creature is a blue Fish 0/1 with no abilities and keeps being a creature; it is back to normal when the Aura leaves', () => {
    const s0 = mpScenario({ players: 3, defs: [FISH, FLIER], zones: { p1: { hand: ['Test Fishing'], battlefield: ['Test Flier'] } } });
    const fl = byName(s0, 'Test Flier');
    const s = cast(s0, 'Test Fishing', { targets: [[obj(fl)]] });
    const c = getChars(s, fl)!;
    expect(stat(s, fl)).toBe('0/1');
    expect(c.colors).toEqual(['U']);
    expect(c.subtypes).toEqual(['Fish']);
    expect(c.types).toContain('Creature');
    expect(kw(s, fl)).toEqual([]);
    const aura = byName(s, 'Test Fishing');
    const gone = tweak(s, (g) => { g.objects[aura]!.zone = 'graveyard'; g.zones.battlefield = g.zones.battlefield.filter((i) => i !== aura); g.zones.graveyard['p1']!.push(aura); });
    expect(stat(gone, fl)).toBe('4/4');
    expect(kw(gone, fl)).toContain('flying');
  });
});
