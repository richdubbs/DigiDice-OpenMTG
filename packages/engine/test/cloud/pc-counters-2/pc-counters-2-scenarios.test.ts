/**
 * Precon lane pc-counters, round pc-counters-2, played through the engine with synthetic cards compiled by the game's default compiler (invented names, design
 * 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 613.4c, 122.1   "Enchanted creature gets +1/+1 for each counter on ~", "... for each charge counter on ~ and has vigilance": counters of every kind / of one kind
 *   CR 613.4c, 107.3   "Other Humans you control get +1/+1 for each counter on ~", "Each other Zombie you control gets +X/+X, where X is the number of counters on ~"
 *   CR 122.1           "Return each creature without a +1/+1 counter on it to its owner's hand.", "Destroy each nonland permanent without a fate counter on it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
/** How many objects of this name are in the zone (an object that changes zone is a new object, CR 400.7: ids do not follow it). */
const inZone = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'exile' | 'hand', who?: PlayerId): number => findAll(s, name, zone, who).length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => s.objects[id]!.counters;

/** Answer every decision: yes/no by `yes`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; targets?: ObjectId[][]; players?: PlayerId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const pq = [...(o.players ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') {
      const objs = (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id }));
      const plrs = (pq.shift() ?? []).map((id) => ({ kind: 'player' as const, id }));
      s = answer(s, { kind: 'chooseTargets', targets: [...objs, ...plrs] });
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const HUMAN = card('Test Human', 'Creature — Human', '', { pt: ['1', '1'], colors: ['W'] });
const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', { pt: ['2', '2'], colors: ['B'] });
const num = (x: string | number | undefined): number => Number(x);

describe('CR 613.4c, 122.1: "Enchanted creature gets +1/+1 for each counter on ~." (every kind of counter)', () => {
  const GAVEL = card('Test Gavel', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each counter on this Aura.');
  const defs = [GAVEL, BEAR];
  it('is fully automated', () => expect(full(GAVEL)).toBe(true));
  it('counts counters of every kind on the Aura (not those on the creature); none gives no bonus', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Gavel'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 3 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Gavel', { targets: [[bear]] });
    const gavel = find(s, 'Test Gavel', 'battlefield', 'p1');
    expect(num(chars(s, bear).power)).toBe(5); // 2 base + 3 counters of its own, no bonus yet
    s.objects[gavel]!.counters['charge'] = 2;
    s.objects[gavel]!.counters['soul'] = 1;
    expect(num(chars(s, bear).power)).toBe(8);
    expect(num(chars(s, bear).toughness)).toBe(8);
  });
});

describe('CR 613.4c, 122.1: "Enchanted creature gets +1/+1 for each charge counter on ~ and has vigilance." (one kind)', () => {
  const MACE = card('Test Mace', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each charge counter on this Aura and has vigilance.');
  const defs = [MACE, BEAR];
  it('is fully automated', () => expect(full(MACE)).toBe(true));
  it('only charge counters count; the creature has vigilance', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mace'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Mace', { targets: [[bear]] });
    const mace = find(s, 'Test Mace', 'battlefield', 'p1');
    s.objects[mace]!.counters['charge'] = 2;
    s.objects[mace]!.counters['soul'] = 5;
    expect(num(chars(s, bear).power)).toBe(4);
    expect(chars(s, bear).keywords.some((k) => k.keyword === 'vigilance')).toBe(true);
  });
});

describe('CR 613.4c: "Other Humans you control get +1/+1 for each counter on ~."', () => {
  const KYLER = card('Test Kyler', 'Creature — Human Cleric', 'Other Humans you control get +1/+1 for each counter on this creature.', { pt: ['2', '2'] });
  const defs = [KYLER, HUMAN, BEAR];
  it('is fully automated', () => expect(full(KYLER)).toBe(true));
  it('your other Humans get +N/+N for N counters of any kind on it; it, a non-Human and the opponent\'s Human do not', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Kyler', counters: { '+1/+1': 2, flying: 1 } }, 'Test Human', 'Test Bear'] }, p2: { battlefield: ['Test Human'] } });
    const kyler = find(s, 'Test Kyler', 'battlefield', 'p1');
    expect(num(chars(s, find(s, 'Test Human', 'battlefield', 'p1')).power)).toBe(4);
    expect(num(chars(s, find(s, 'Test Bear', 'battlefield', 'p1')).power)).toBe(2);
    expect(num(chars(s, find(s, 'Test Human', 'battlefield', 'p2')).power)).toBe(1);
    expect(num(chars(s, kyler).power)).toBe(4); // its own two +1/+1 counters, not a bonus from itself
  });
});

describe('CR 613.4c, 107.3: "Each other creature you control that\'s a Zombie or Mutant gets +X/+X, where X is the number of counters on ~."', () => {
  const MAYOR = card('Test Mayor', 'Creature — Zombie Advisor', 'Each other creature you control that\'s a Zombie or Mutant gets +X/+X, where X is the number of counters on this creature.', { pt: ['2', '2'] });
  const defs = [MAYOR, ZOMBIE, BEAR];
  it('is fully automated', () => expect(full(MAYOR)).toBe(true));
  it('X is the number of counters on the Mayor right now; the Mayor itself and non-Zombies are unaffected', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Mayor', counters: { '+1/+1': 1, shield: 2 } }, 'Test Zombie', 'Test Bear'] } });
    expect(num(chars(s, find(s, 'Test Zombie', 'battlefield', 'p1')).power)).toBe(5);
    expect(num(chars(s, find(s, 'Test Bear', 'battlefield', 'p1')).power)).toBe(2);
    expect(num(chars(s, find(s, 'Test Mayor', 'battlefield', 'p1')).power)).toBe(3); // 2 + its own +1/+1 counter
  });
});

describe('CR 122.1: "without a K counter on it"', () => {
  const WAVE = card('Test Wave', 'Sorcery', "Return each creature without a +1/+1 counter on it to its owner's hand.");
  const WRATH = card('Test Fate', 'Sorcery', 'Destroy each nonland permanent without a fate counter on it.');
  const RELIC = card('Test Relic', 'Artifact', '');
  const defs = [WAVE, WRATH, BEAR, RELIC];
  it('are fully automated', () => { for (const d of [WAVE, WRATH]) expect(full(d)).toBe(true); });
  it('only creatures with no +1/+1 counter are returned (a creature with a counter of another kind is too)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Wave'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, { name: 'Test Bear', counters: { charge: 1 } }, 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Wave');
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(1);
    expect(counters(s, findAll(s, 'Test Bear', 'battlefield', 'p1')[0]!)['+1/+1']).toBe(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2').length).toBe(0);
    expect(findAll(s, 'Test Bear', 'hand').length).toBe(3);
  });
  it('only permanents with no fate counter are destroyed', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fate'], battlefield: [{ name: 'Test Relic', counters: { fate: 1 } }, 'Test Relic', { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    s = cast(s, 'Test Fate');
    expect(findAll(s, 'Test Relic', 'battlefield', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
  });
});
