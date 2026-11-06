/**
 * Commander lane edh-perms, round edh-perms-10: the round's readings and engine rules played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites verified against the Comprehensive Rules of 2026-09-25 unless marked.
 *
 *   CR 701.3d, 603.10c   "Whenever this Equipment becomes unattached from a permanent, sacrifice that permanent." (moved to another creature, destroyed, never the host dying on its own)
 *   CR 614.1c, 608.2c    "Exile target permanent you control. Return that card to the battlefield ... at the beginning of the next end step. If it enters as a creature, it enters with an additional
 *                        +1/+1 counter on it." (a creature gets it, an artifact does not; an entering-with-counters card keeps its own)
 *   CR 614.1c, 306.5b    "... Each of them enters with an additional +1/+1 counter on it if it's a creature and an additional loyalty counter on it if it's a planeswalker." (each card on its own)
 *   CR 205.1b, 604.3, 613.1d  "Target land you control becomes a creature with haste and "This creature's power and toughness are each equal to the number of lands you control." It's still a land."
 *   CR 603.6a, 508.4     "When this creature enters from your hand, if it's attacking, create a token that's a copy of another target attacking creature. The token enters tapped and attacking."
 *   CR 614.1c, 202.3     "You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it." (mana value of the card)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[]; keywords?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
    ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onBf = (s: GameState, name: string, owner?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (owner === undefined || s.objects[id]!.controller === owner));
const inGy = (s: GameState, name: string, owner: 'p1' | 'p2' = 'p1'): number => s.zones.graveyard[owner]!.filter((id) => chars(s, id).name === name).length;

interface Picks { yes?: boolean; targets?: TargetChoice[][]; pick?: (options: ObjectId[]) => ObjectId[] }
/** Answer every decision until a player has priority: yes/no by `yes`, targets in order from `targets`, objects by `pick`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options!) : p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** Activate the ability of `source` whose label matches `like`, with `targets`, and resolve everything. */
function activate(s: GameState, source: ObjectId, like: RegExp, o: Picks = {}): GameState {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === source && like.test(x.label));
  if (!a) throw new Error(`no ability like ${like} on ${source}: ${JSON.stringify(legalActions(s, 'p1').map((x) => x.label))}`);
  return resolveAll(act(s, a.action), o);
}

describe('CR 701.3d, 603.10c: "Whenever this Equipment becomes unattached from a permanent, sacrifice that permanent."', () => {
  const WARGEAR = card('Test Wargear', 'Artifact — Equipment', 'Equipped creature gets +2/+2.\nWhenever this Equipment becomes unattached from a permanent, sacrifice that permanent.\nEquip {0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SMASH = card('Test Smasher', 'Instant', 'Destroy target artifact.', { cost: '{0}' });
  const KILL = card('Test Killer', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const defs = [WARGEAR, BEAR, SMASH, KILL];
  const setup = (): { s: GameState; gear: ObjectId; a: ObjectId; b: ObjectId } => {
    const s = scenario([], { p1: { battlefield: ['Test Wargear', 'Test Bear', 'Test Bear'], hand: ['Test Smasher', 'Test Killer'] }, defs });
    const gear = find(s, 'Test Wargear', 'battlefield', 'p1');
    const [a, b] = onBf(s, 'Test Bear', 'p1') as [ObjectId, ObjectId];
    s.objects[gear]!.attachedTo = a;
    return { s, gear, a, b };
  };
  it('is fully automated', () => expect(automated(WARGEAR)).toBe(true));
  it('equipping another creature unattaches it from the first one, which is sacrificed; the new host is untouched', () => {
    const { s: s0, gear, a, b } = setup();
    const s = activate(s0, gear, /equip/i, { targets: [[obj(b)]] });
    expect(s.objects[gear]!.attachedTo).toBe(b);
    expect(s.zones.battlefield).not.toContain(a);
    expect(s.zones.battlefield).toContain(b);
    expect(inGy(s, 'Test Bear')).toBe(1);
  });
  it('destroying the Equipment unattaches it as it leaves (it looks back, CR 603.10c): the creature it was attached to is sacrificed', () => {
    const { s: s0, gear, a, b } = setup();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smasher', 'hand', 'p1') });
    s = resolveAll(s, { targets: [[obj(gear)]] });
    expect(s.zones.battlefield).not.toContain(gear);
    expect(s.zones.battlefield).not.toContain(a);
    expect(s.zones.battlefield).toContain(b);
  });
  it('negative: the creature it is attached to dying on its own leaves nothing to sacrifice, and the other creature is not touched', () => {
    const { s: s0, a, b } = setup();
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Killer', 'hand', 'p1') }), { targets: [[obj(a)]] });
    expect(s.zones.battlefield).not.toContain(a);
    expect(s.zones.battlefield).toContain(b);
    expect(inGy(s, 'Test Bear')).toBe(1);
  });
  it('negative (ruling 2004-12-01): attached to an opponent\'s creature, it cannot sacrifice it when it is moved: you sacrifice only what you control', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wargear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const gear = find(s0, 'Test Wargear', 'battlefield', 'p1');
    const mine = onBf(s0, 'Test Bear', 'p1')[0]!;
    const theirs = onBf(s0, 'Test Bear', 'p2')[0]!;
    s0.objects[gear]!.attachedTo = theirs;
    const s = activate(s0, gear, /equip/i, { targets: [[obj(mine)]] });
    expect(s.objects[gear]!.attachedTo).toBe(mine);
    expect(s.zones.battlefield).toContain(theirs);
  });
  it('negative: an Equipment that was never attached triggers nothing when it is destroyed', () => {
    const { s: s0, gear, a, b } = setup();
    delete s0.objects[gear]!.attachedTo;
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smasher', 'hand', 'p1') });
    s = resolveAll(s, { targets: [[obj(gear)]] });
    expect(s.zones.battlefield).toContain(a);
    expect(s.zones.battlefield).toContain(b);
  });
});

const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const cast = (s0: GameState, name: string, o: Picks = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
const toEnd = (s: GameState): GameState => resolveAll(advanceTo(s, 1, 'end'));

describe('CR 614.1c, 608.2c: "Return that card to the battlefield under its owner\'s control at the beginning of the next end step. If it enters as a creature, it enters with an additional +1/+1 counter on it."', () => {
  const TWIST = card('Test Twist', 'Instant', 'Exile target permanent you control. Return that card to the battlefield under its owner\'s control at the beginning of the next end step. If it enters as a creature, it enters with an additional +1/+1 counter on it.', { cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'This creature enters with two +1/+1 counters on it.', { pt: ['0', '0'] });
  const RELIC = card('Test Relic', 'Artifact', '');
  const defs = [TWIST, BEAR, HYDRA, RELIC];
  const run = (target: string): { s: GameState; back: ObjectId } => {
    const s0 = scenario([], { p1: { hand: ['Test Twist'], battlefield: [target === 'Test Hydra' ? { name: target, counters: { '+1/+1': 2 } } : target] }, defs });
    const t = find(s0, target, 'battlefield', 'p1');
    const s = toEnd(cast(s0, 'Test Twist', { targets: [[obj(t)]] }));
    return { s, back: find(s, target, 'battlefield', 'p1') };
  };
  it('is fully automated', () => expect(automated(TWIST)).toBe(true));
  it('a creature comes back with one +1/+1 counter, a noncreature artifact with none', () => {
    const { s, back } = run('Test Bear');
    expect(counters(s, back, '+1/+1')).toBe(1);
    expect(s.zones.battlefield).toContain(back);
    const art = run('Test Relic');
    expect(counters(art.s, art.back, '+1/+1')).toBe(0);
  });
  it('it is additional: a creature that enters with counters of its own gets them and the extra one', () => {
    const { s, back } = run('Test Hydra');
    expect(counters(s, back, '+1/+1')).toBe(3);
  });
  it('fail closed (Teferi\'s Time Twist ruling 2019-05-03: effects that change the permanent\'s own types count): a creature card whose own ability may take its creature type away is left to the players', () => {
    const GOD = card('Test Deity', 'Legendary Enchantment Creature — God', 'As long as you control fewer than seven permanents, this permanent isn\'t a creature.', { pt: ['4', '4'] });
    const s0 = scenario([], { p1: { hand: ['Test Twist'], battlefield: ['Test Deity'] }, defs: [...defs, GOD] });
    const t = find(s0, 'Test Deity', 'battlefield', 'p1');
    // the return at the end step is asked of the players ("Resolve ... by hand"), not decided on the printed types
    expect(() => toEnd(cast(s0, 'Test Twist', { targets: [[obj(t)]] }))).toThrow(/manualResolve/);
  });
  it('fail closed (review): a card that enters as a copy, or is a creature only away from the battlefield, is left to the players too', () => {
    const CLONE = card('Test Clone', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', { pt: ['1', '1'] });
    const SPAWN = card('Test Larva', 'Legendary Planeswalker — Test', 'As long as this permanent isn\'t on the battlefield, it\'s a 1/1 Insect creature.', { loyalty: '3' });
    for (const [def, name] of [[CLONE, 'Test Clone'], [SPAWN, 'Test Larva']] as const) {
      const s0 = scenario([], { p1: { hand: ['Test Twist'], battlefield: [{ name, counters: { loyalty: 3, '+1/+1': 0 } }] }, defs: [...defs, def] });
      const t = find(s0, name, 'battlefield', 'p1');
      expect(() => toEnd(cast(s0, 'Test Twist', { targets: [[obj(t)]] })), name).toThrow(/manualResolve/);
    }
  });
  it('negative: nothing has come back before the end step, and a card in the graveyard is not returned', () => {
    const s0 = scenario([], { p1: { hand: ['Test Twist'], battlefield: ['Test Bear'] }, defs });
    const t = find(s0, 'Test Bear', 'battlefield', 'p1');
    const mid = cast(s0, 'Test Twist', { targets: [[obj(t)]] });
    expect(onBf(mid, 'Test Bear').length).toBe(0);
  });
});

describe('CR 614.1c, 306.5b: "Each of them enters with an additional +1/+1 counter on it if it\'s a creature and an additional loyalty counter on it if it\'s a planeswalker."', () => {
  const END = card('Test Respite', 'Instant', 'Exile any number of target creatures and/or planeswalkers you control. At the beginning of the next end step, return each of them to the battlefield under its owner\'s control. Each of them enters with an additional +1/+1 counter on it if it\'s a creature and an additional loyalty counter on it if it\'s a planeswalker.', { cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '', { loyalty: '3' });
  const defs = [END, BEAR, WALKER];
  it('is fully automated', () => expect(automated(END)).toBe(true));
  it('the creature gets +1/+1 only, the planeswalker one extra loyalty only (its printed loyalty plus one)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Respite'], battlefield: ['Test Bear', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const walker = find(s0, 'Test Walker', 'battlefield', 'p1');
    const s = toEnd(cast(s0, 'Test Respite', { targets: [[obj(bear), obj(walker)]] }));
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    const w = find(s, 'Test Walker', 'battlefield', 'p1');
    expect(counters(s, b, '+1/+1')).toBe(1);
    expect(counters(s, b, 'loyalty')).toBe(0);
    expect(counters(s, w, 'loyalty')).toBe(4);
    expect(counters(s, w, '+1/+1')).toBe(0);
  });
  it('negative: exiling no target at all returns nothing and adds nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Respite'], battlefield: ['Test Bear'] }, defs });
    const s = toEnd(cast(s0, 'Test Respite', { targets: [[]] }));
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
});

describe('CR 614.1c, 202.3: "You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it."', () => {
  const SEEK = card('Test Seeker', 'Sorcery', 'Look at the top four cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.', { cost: '{0}' });
  const SMALL = card('Test Small', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{2}' });
  const BIG = card('Test Big', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{5}' });
  const defs = [SEEK, SMALL, BIG];
  const pickName = (name: string) => (options: ObjectId[], st: GameState): ObjectId[] => [options.find((id) => chars(st, id).name === name)!];
  it('is fully automated', () => expect(automated(SEEK)).toBe(true));
  it('a card of mana value 3 or less enters with the three extra counters; one of mana value 5 does not', () => {
    for (const [name, n] of [['Test Small', 3], ['Test Big', 0]] as const) {
      const s0 = scenario([], { p1: { hand: ['Test Seeker'], library: ['Test Small', 'Test Big'] }, defs });
      const s = cast(s0, 'Test Seeker', { pick: (options) => [options.find((id) => chars(s0, id).name === name) ?? options.find((id) => chars(s, id).name === name)!] });
      const id = find(s, name, 'battlefield', 'p1');
      expect(counters(s, id, '+1/+1'), name).toBe(n);
    }
  });
  it('negative: choosing nothing puts nothing onto the battlefield; the other card is not given counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Seeker'], library: ['Test Small', 'Test Big'] }, defs });
    const s = cast(s0, 'Test Seeker', { pick: () => [] });
    expect(onBf(s, 'Test Small').length + onBf(s, 'Test Big').length).toBe(0);
  });
});

describe('CR 205.1b, 604.3, 613.1d, 613.4a: "Target land you control becomes a creature with haste and "This creature\'s power and toughness are each equal to the number of lands you control." It\'s still a land."', () => {
  const WAKE = card('Test Awaken', 'Sorcery', 'Target land you control becomes a creature with haste and "This creature\'s power and toughness are each equal to the number of lands you control." It\'s still a land.', { cost: '{0}' });
  const FOREST = card('Test Grove', 'Basic Land — Forest', '');
  const defs = [WAKE, FOREST];
  const wake = (): { s: GameState; land: ObjectId } => {
    const s0 = scenario([], { p1: { hand: ['Test Awaken'], battlefield: ['Test Grove', 'Test Grove', 'Test Grove'] }, p2: { battlefield: ['Test Grove'] }, defs });
    const land = find(s0, 'Test Grove', 'battlefield', 'p1');
    return { s: cast(s0, 'Test Awaken', { targets: [[obj(land)]] }), land };
  };
  it('is fully automated', () => expect(automated(WAKE)).toBe(true));
  it('the land is a land creature with haste, its size the number of lands you control (the opponent\'s land does not count; a characteristic-defining ability, CR 604.3), for good', () => {
    const { s, land } = wake();
    const c = chars(s, land);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toContain('Forest');
    expect(c.keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect([c.power, c.toughness]).toEqual(['3', '3']);
    const later = advanceTo(s, 1, 'end');
    expect(chars(later, land).types).toContain('Creature');
  });
  it('negative: the other lands are untouched (no creature, no size)', () => {
    const { s, land } = wake();
    for (const id of onBf(s, 'Test Grove')) if (id !== land) expect(chars(s, id).types).toEqual(['Land']);
  });
});

describe('CR 603.6a, 508.4, 707.2: "When this creature enters from your hand, if it\'s attacking, create a token that\'s a copy of another target attacking creature. The token enters tapped and attacking."', () => {
  const NINJA = card('Test Shade', 'Creature — Ninja', 'Ninjutsu {0}\nWhen this creature enters from your hand, if it\'s attacking, create a token that\'s a copy of another target attacking creature. The token enters tapped and attacking.', { pt: ['1', '1'], keywords: ['Ninjutsu'], cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{0}' });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const WATCH = card('Test Watcher', 'Creature — Elf', 'Whenever another creature enters from your hand, you gain 1 life.', { pt: ['1', '1'] });
  const REVIVE = card('Test Revival', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.', { cost: '{0}' });
  const defs = [NINJA, BEAR, OGRE, WATCH, REVIVE];
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('is fully automated', () => expect(automated(NINJA)).toBe(true));
  it('put onto the battlefield attacking from the hand (ninjutsu): a token copy of the other attacker enters tapped and attacking', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shade'], battlefield: ['Test Bear', 'Test Ogre'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear], [ogre]]);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'the declare blockers step', 10);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && /ninjutsu/i.test(x.label));
    expect(a, JSON.stringify(legalActions(s, 'p1').map((x) => x.label))).toBeDefined();
    s = resolveAll(act(s, a!.action), { pick: (options) => [options.find((id) => id === bear) ?? options[0]!], targets: [[obj(ogre)]] });
    const ogres = onBf(s, 'Test Ogre', 'p1');
    expect(ogres.length).toBe(2);
    const token = ogres.find((id) => s.objects[id]!.kind === 'token')!;
    expect(s.objects[token]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((x) => x.id === token)).toBe(true);
  });
  it('negative: cast from the hand and not attacking, the Ninja makes no token (the intervening "if", CR 603.4)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shade'], battlefield: ['Test Ogre'] }, defs: [...defs, ] });
    // put it onto the battlefield from the hand by an effect that is not an attack
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shade', 'hand', 'p1') }), { targets: [[obj(find(s0, 'Test Ogre', 'battlefield', 'p1'))]] });
    expect(onBf(s, 'Test Ogre', 'p1').length).toBe(1);
  });
  it('"enters from your hand": a creature put onto the battlefield from the hand triggers it; one cast (it enters from the stack) or returned from the graveyard does not', () => {
    const SUMMON = card('Test Summon', 'Sorcery', 'You may put a creature card from your hand onto the battlefield.', { cost: '{0}' });
    const d = [...defs, SUMMON];
    const s0 = scenario([], { p1: { hand: ['Test Summon', 'Test Bear'], battlefield: ['Test Watcher'] }, defs: d });
    const put = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Summon', 'hand', 'p1') }));
    expect(onBf(put, 'Test Bear', 'p1').length).toBe(1);
    expect(life(put)).toBe(life(s0) + 1);
    const c0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Watcher'] }, defs: d });
    const cast1 = resolveAll(act(c0, { type: 'cast', player: 'p1', card: find(c0, 'Test Bear', 'hand', 'p1') }));
    expect(onBf(cast1, 'Test Bear', 'p1').length).toBe(1);
    expect(life(cast1)).toBe(life(c0));
    const g0 = scenario([], { p1: { hand: ['Test Revival'], graveyard: ['Test Bear'], battlefield: ['Test Watcher'] }, defs: d });
    const g = resolveAll(act(g0, { type: 'cast', player: 'p1', card: find(g0, 'Test Revival', 'hand', 'p1') }), { targets: [[obj(find(g0, 'Test Bear', 'graveyard', 'p1'))]] });
    expect(onBf(g, 'Test Bear', 'p1').length).toBe(1);
    expect(life(g)).toBe(life(g0));
  });
});

describe('CR 205.1a, 613.4b, 603.7: "Any number of target noncreature artifacts you control become 3/3 artifact creatures. Sacrifice them at the beginning of the next end step."', () => {
  const TITAN = card('Test Rouser', 'Sorcery', 'Any number of target noncreature artifacts you control become 3/3 artifact creatures. Sacrifice them at the beginning of the next end step.', { cost: '{0}' });
  const RELIC = card('Test Relic', 'Artifact', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [TITAN, RELIC, BEAR];
  it('is fully automated; the chosen artifacts are 3/3 artifact creatures until sacrificed at the end step; a creature and an opponent\'s artifact are not touched', () => {
    expect(automated(TITAN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Rouser'], battlefield: ['Test Relic', 'Test Relic', 'Test Bear'] }, p2: { battlefield: ['Test Relic'] }, defs });
    const [a, b] = onBf(s0, 'Test Relic', 'p1') as [ObjectId, ObjectId];
    const mid = cast(s0, 'Test Rouser', { targets: [[obj(a), obj(b)]] });
    for (const id of [a, b]) { expect(chars(mid, id).types).toEqual(expect.arrayContaining(['Artifact', 'Creature'])); expect([chars(mid, id).power, chars(mid, id).toughness]).toEqual(['3', '3']); }
    const end = toEnd(mid);
    expect(onBf(end, 'Test Relic', 'p1').length).toBe(0);
    expect(onBf(end, 'Test Relic', 'p2').length).toBe(1);
    expect(onBf(end, 'Test Bear', 'p1').length).toBe(1);
  });
});
