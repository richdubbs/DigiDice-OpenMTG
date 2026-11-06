/**
 * Commander lane copy, second round, edh-next-65: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler, each with its negative case. CR cites are from the text of 2026-09-25 where marked "checked", otherwise from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { activate } from '../../m5/cr-examples/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

interface Picks { x?: number[]; yes?: boolean; targets?: TargetChoice[][]; options?: string[][]; objects?: ObjectId[][] }
/** Answer every decision until a player has priority: yes/no by `yes`, targets and options in order, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const oq = [...(o.options ?? [])];
  const cq = [...(o.objects ?? [])];
  const xq = [...(o.x ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: (ObjectId | { id: string })[]; min?: number; max?: number; items?: { id: string }[] };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: cq.shift() ?? (p.options as ObjectId[]).slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: oq.shift() ?? (p.options as { id: string }[]).slice(0, p.min ?? 1).map((x) => x.id) } as never);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((i) => i.id) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: xq.shift() ?? p.min ?? 0 } as never);
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
function castAndResolve(s0: GameState, name: string, o: Picks = {}, mana: string[] = ['C', 'C', 'C']): GameState {
  for (const m of mana) s0.players[0]!.manaPool.push({ type: m } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => chars(s, id).keywords.some((x) => x.keyword === k);

const stackSize = (s: GameState): number => s.zones.stack.length;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const lands = (n: number): string[] => Array(n).fill('Mountain') as string[];

describe('CR 702.56a, 118.9, 707.10 (unverified): "Each instant and sorcery spell you cast has replicate. The replicate cost is equal to its mana cost."', () => {
  const DJINN = card('Test Replicant', 'Creature — Djinn', 'Each instant and sorcery spell you cast has replicate. The replicate cost is equal to its mana cost.', { pt: ['3', '3'], cost: '{3}{R}' });
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
  const defs = [DJINN, SPARK];
  const setup = (withDjinn: boolean) => scenario(['Mountain'], { p1: { hand: ['Test Spark'], battlefield: [...lands(4), ...(withDjinn ? ['Test Replicant'] : [])] }, defs });
  it('is automated', () => expect(automated(DJINN)).toBe(true));
  it('a spell cast with the replicate cost paid twice (its mana cost each time) is copied twice; the copies deal damage too', () => {
    const s0 = setup(true);
    const r = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), { x: [2], targets: [[{ kind: 'player', id: 'p2' }]], yes: false });
    expect(lifeOf(r, 'p2')).toBe(17);
  });
  it('a spell that already has replicate gets a second, separate instance: each instance copies only for its own payments (CR 702.56b)', () => {
    const REP = card('Test Echo', 'Instant', 'Replicate {R}\nTest Echo deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Echo'], battlefield: [...lands(6), 'Test Replicant'] }, defs: [DJINN, REP] });
    // the printed instance paid once, the granted one not at all: one copy (two damage)
    const r = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand', 'p1') }), { x: [1, 0], targets: [[{ kind: 'player', id: 'p2' }]], yes: false });
    expect(lifeOf(r, 'p2')).toBe(18);
  });
  it('NEGATIVE: with the creature gone, the spell has no replicate cost to pay: one damage', () => {
    const s0 = setup(false);
    const r = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]], yes: false });
    expect(lifeOf(r, 'p2')).toBe(19);
  });
});

const p2 = { kind: 'player', id: 'p2' } as TargetChoice;
const SPARK2 = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
const GRUB = card('Test Grub', 'Creature — Insect', '', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
const castSpark = (s0: GameState): GameState => (s0.players[0]!.manaPool.push({ type: 'R' } as never), resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), { targets: [[p2]], yes: false }));

describe('CR 603.7, 603.7b, 707.10, 107.3 (unverified): "When you next cast an instant or sorcery spell this turn, copy that spell X times."', () => {
  const THUNDER = card('Test Thunder', 'Instant', 'When you next cast an instant or sorcery spell this turn, copy that spell X times. You may choose new targets for the copies.', { cost: '{X}{R}', colors: ['R'] });
  const defs = [THUNDER, SPARK2, GRUB];
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Thunder', 'Test Spark', 'Test Spark', 'Test Grub'], battlefield: lands(8) }, defs });
  it('is automated', () => expect(automated(THUNDER)).toBe(true));
  it('with X = 2 the next instant cast this turn is copied twice (three damage)', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Thunder', 'hand', 'p1') }), { x: [2] });
    expect(lifeOf(s, 'p2')).toBe(20);
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('NEGATIVE: only the NEXT such spell: a second instant is not copied (3 + 1 damage)', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Thunder', 'hand', 'p1') }), { x: [2] });
    s = castSpark(s);
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(16);
  });
  it('NEGATIVE: a creature spell is not an instant or sorcery: no copy, and the delayed trigger waits for an instant', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Thunder', 'hand', 'p1') }), { x: [2] });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grub', 'hand', 'p1') }));
    expect(onBf(s, 'Test Grub', 'p1')).toHaveLength(1);
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('X = 0 copies nothing', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Thunder', 'hand', 'p1') }), { x: [0] });
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});

describe('CR 603.7, 603.4, 707.10 (unverified): "If you attacked this turn, when you next cast an instant or sorcery spell this turn, copy that spell an additional time."', () => {
  const HOWL = card('Test Howl', 'Sorcery', 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\nRaid — If you attacked this turn, when you next cast an instant or sorcery spell this turn, copy that spell an additional time. You may choose new targets for the copy.', { cost: '{R}', colors: ['R'] });
  const defs = [HOWL, SPARK2, GRUB];
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Howl', 'Test Spark'], battlefield: [...lands(6), 'Test Grub'] }, defs });
  it('is automated', () => expect(automated(HOWL)).toBe(true));
  it('NEGATIVE: with no attack this turn there is one copy (2 damage)', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Howl', 'hand', 'p1') }));
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('after attacking, the spell is copied twice (3 damage)', () => {
    let s = setup();
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Grub', 'battlefield', 'p1')]]);
    s = advanceTo(s, s.turn.number, 'main2');
    const hp = lifeOf(s, 'p2');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Howl', 'hand', 'p1') }));
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(hp - 3);
  });
});

describe('CR 603.7, 603.7b, 707.10, 702.33a (unverified): "When this creature enters, copy the next instant or sorcery spell with mana value 2 or less you cast this turn when you cast it. If this creature was kicked, copy that spell twice instead."', () => {
  const STORMER = card('Test Stormer', 'Creature — Wizard', 'Kicker {4}{U}\nWhen this creature enters, copy the next instant or sorcery spell with mana value 2 or less you cast this turn when you cast it. If this creature was kicked, copy that spell twice instead. You may choose new targets for the copies.', { pt: ['2', '1'], cost: '{1}{U}', colors: ['U'] });
  const BIGBOLT = card('Test Bigbolt', 'Instant', 'Test Bigbolt deals 1 damage to any target.', { cost: '{2}{R}', colors: ['R'] });
  const defs = [STORMER, SPARK2, BIGBOLT];
  const setup = () => scenario(['Mountain', 'Island'], { p1: { hand: ['Test Stormer', 'Test Spark', 'Test Bigbolt'], battlefield: [...lands(4), ...Array(6).fill('Island')] }, defs });
  it('is automated', () => expect(automated(STORMER)).toBe(true));
  it('unkicked: one copy (2 damage)', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Stormer', 'hand', 'p1') }), { yes: false });
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('kicked: two copies (3 damage)', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Stormer', 'hand', 'p1') }), { yes: true });
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('NEGATIVE: a spell with mana value 3 is not copied (1 damage) and does not use the delayed trigger up', () => {
    const s0 = setup();
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Stormer', 'hand', 'p1') }), { yes: false });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bigbolt', 'hand', 'p1') }), { targets: [[p2]], yes: false });
    expect(lifeOf(s, 'p2')).toBe(19);
    s = castSpark(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

describe('CR 602.2, 603.4, 707.10 (unverified): "Whenever you activate an ability of an artifact, if it isn\'t a mana ability, you may pay {R}. If you do, copy that ability."', () => {
  const KURK = card('Test Kurk', 'Legendary Creature — Ogre', "Whenever you activate an ability of an artifact, if it isn't a mana ability, you may pay {R}. If you do, copy that ability. You may choose new targets for the copy.", { pt: ['4', '3'], cost: '{2}{R}{R}', colors: ['R'] });
  const PINGER = card('Test Pinger', 'Artifact', 'Test Pinger deals 1 damage to any target.'.replace(/^/, '{T}: '), { cost: '{1}' });
  const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}.', { cost: '{1}' });
  const GOBLIN = card('Test Pingling', 'Creature — Goblin', '{T}: Test Pingling deals 1 damage to any target.', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
  const defs = [KURK, PINGER, ROCK, GOBLIN];
  const setup = (extra: string[] = []) => scenario(['Mountain'], { p1: { battlefield: ['Test Kurk', 'Test Pinger', 'Test Rock', 'Test Pingling', ...lands(3), ...extra] }, defs });
  const ping = (s0: GameState, who: string, yes: boolean): GameState => {
    const s1 = activate(s0, find(s0, who, 'battlefield', 'p1'), [{ kind: 'chooseTargets', targets: [p2] } as never], /damage/);
    return resolveAll(s1, { yes, targets: [[p2]] });
  };
  it('is automated', () => expect(automated(KURK)).toBe(true));
  it('activating the artifact\'s ability and paying {R} copies it: two damage', () => {
    const r = ping(setup(), 'Test Pinger', true);
    expect(lifeOf(r, 'p2')).toBe(18);
  });
  it('NEGATIVE: not paying {R} leaves the one ability (one damage)', () => {
    const r = ping(setup(), 'Test Pinger', false);
    expect(lifeOf(r, 'p2')).toBe(19);
  });
  it('NEGATIVE: an ability of a creature that is not an artifact does not trigger it', () => {
    const r = ping(setup(), 'Test Pingling', true);
    expect(lifeOf(r, 'p2')).toBe(19);
  });
});

describe('CR 606.3, 603.4, 707.10 (unverified): "Whenever you activate a loyalty ability of a Chandra planeswalker, you may pay {1}. If you do, copy that ability." and "Discard a Mountain card or a red card"', () => {
  const REG = card('Test Regulator', 'Legendary Artifact', "Whenever you activate a loyalty ability of a Chandra planeswalker, you may pay {1}. If you do, copy that ability. You may choose new targets for the copy.\n{1}, {T}, Discard a Mountain card or a red card: Draw a card.", { cost: '{1}{R}', colors: ['R'] });
  const CHANDRA = card('Test Chandra', 'Legendary Planeswalker — Chandra', '+1: Test Chandra deals 1 damage to each opponent.', { cost: '{3}{R}{R}', colors: ['R'] });
  const GIDEON = card('Test Gideon', 'Legendary Planeswalker — Gideon', '+1: Test Gideon deals 1 damage to each opponent.', { cost: '{3}{W}{W}', colors: ['W'] });
  const defs = [REG, CHANDRA, GIDEON];
  const setup = (pw: string) => {
    return scenario(['Mountain'], { p1: { battlefield: ['Test Regulator', { name: pw, counters: { loyalty: 4 } }, ...lands(3)] }, defs });
  };
  it('is automated', () => expect(automated(REG)).toBe(true));
  it('the loyalty ability of a Chandra planeswalker, copied by paying {1}, deals its damage twice', () => {
    const s0 = setup('Test Chandra');
    const s1 = activate(s0, find(s0, 'Test Chandra', 'battlefield', 'p1'));
    const r = resolveAll(s1, { yes: true });
    expect(lifeOf(r, 'p2')).toBe(18);
  });
  it('NEGATIVE: a planeswalker that is not a Chandra: no trigger (one damage)', () => {
    const s0 = setup('Test Gideon');
    const s1 = activate(s0, find(s0, 'Test Gideon', 'battlefield', 'p1'));
    const r = resolveAll(s1, { yes: true });
    expect(lifeOf(r, 'p2')).toBe(19);
  });
});

const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const hasSuper = (s: GameState, id: ObjectId, t: string): boolean => chars(s, id).supertypes.includes(t as never);
const castCreature = (s0: GameState, name: string, o: Picks): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);

describe('CR 614.12, 707.9b, 603.12 (unverified): "You may have ~ enter as a copy of any creature on the battlefield, except it\'s a Wall in addition to its other types and has defender. When you do, tap the copied creature and it doesn\'t untap ..."', () => {
  const WALL = card('Test Wall', 'Creature — Shapeshifter Wall', "You may have ~ enter as a copy of any creature on the battlefield, except it's a Wall in addition to its other types and has defender. When you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control ~.", { pt: ['0', '0'], cost: '{4}' });
  const defs = [WALL, OGRE];
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Wall'], battlefield: lands(4) }, p2: { battlefield: [{ name: 'Test Ogre' }] }, defs });
  it('is automated', () => expect(automated(WALL)).toBe(true));
  it('copies the Ogre as a Wall with defender; the copied Ogre is tapped', () => {
    const s0 = setup();
    const r = castCreature(s0, 'Test Wall', { yes: true });
    const mine = onBf(r, 'Test Ogre', 'p1');
    expect(mine).toHaveLength(1);
    expect(chars(r, mine[0]!).subtypes).toEqual(expect.arrayContaining(['Ogre', 'Wall']));
    expect(hasKeyword(r, mine[0]!, 'defender')).toBe(true);
    expect(pt(r, mine[0]!)).toEqual([4, 4]);
    expect(r.objects[find(s0, 'Test Ogre', 'battlefield', 'p2')]!.tapped).toBe(true);
  });
  it('the copied Ogre does not untap in its controller\'s next untap step while you control the Wall', () => {
    const s0 = setup();
    let r = castCreature(s0, 'Test Wall', { yes: true });
    r = advanceTo(r, r.turn.number + 1, 'main1');
    expect(r.objects[find(s0, 'Test Ogre', 'battlefield', 'p2')]!.tapped).toBe(true);
  });
  it('NEGATIVE: declining the copy leaves a 0/0 Wall that dies, and the Ogre stays untapped', () => {
    const s0 = setup();
    const r = castCreature(s0, 'Test Wall', { objects: [[]] });
    expect(onBf(r, 'Test Wall', 'p1')).toHaveLength(0);
    expect(r.objects[find(s0, 'Test Ogre', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
});

describe('CR 614.12, 603.4 (unverified): "If you attacked this turn, you may have ~ enter as a copy of any creature on the battlefield." (raid)', () => {
  const RAIDER = card('Test Raider', 'Creature — Shapeshifter Pirate', 'Raid — If you attacked this turn, you may have ~ enter as a copy of any creature on the battlefield.', { pt: ['2', '2'], cost: '{3}' });
  const defs = [RAIDER, OGRE, GRUB];
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Raider'], battlefield: [...lands(3), 'Test Grub'] }, p2: { battlefield: ['Test Ogre'] }, defs });
  it('is automated', () => expect(automated(RAIDER)).toBe(true));
  it('NEGATIVE: with no attack this turn it enters as itself (no copy offered)', () => {
    const s0 = setup();
    const r = castCreature(s0, 'Test Raider', { yes: true });
    expect(onBf(r, 'Test Raider', 'p1')).toHaveLength(1);
  });
  it('after attacking it may enter as a copy of the Ogre', () => {
    let s = setup();
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Grub', 'battlefield', 'p1')]]);
    s = advanceTo(s, s.turn.number, 'main2');
    const r = castCreature(s, 'Test Raider', { yes: true, objects: [[find(s, 'Test Ogre', 'battlefield', 'p2')]] });
    expect(onBf(r, 'Test Ogre', 'p1')).toHaveLength(1);
  });
});

describe('CR 614.12, 707.9b, 707.9e, 707.9f, 205.4a, 702.73a (unverified): "You may have ~ enter as a copy of a permanent you control, except it\'s legendary and snow in addition to its other types and, if it\'s a creature, it enters with two additional +1/+1 counters on it and has changeling."', () => {
  const MORITTE = card('Test Moritte', 'Legendary Snow Creature — Shapeshifter', "Changeling\nYou may have ~ enter as a copy of a permanent you control, except it's legendary and snow in addition to its other types and, if it's a creature, it enters with two additional +1/+1 counters on it and has changeling.", { pt: ['0', '0'], cost: '{5}' });
  const TRINKET = card('Test Trinket', 'Artifact', '', { cost: '{1}' });
  const defs = [MORITTE, BEAR, TRINKET];
  const setup = (target: string) => scenario(['Mountain'], { p1: { hand: ['Test Moritte'], battlefield: [...lands(5), target] }, defs });
  it('is automated', () => expect(automated(MORITTE)).toBe(true));
  it('copying a creature: legendary, snow, two +1/+1 counters, changeling', () => {
    const s0 = setup('Test Bear');
    const r = castCreature(s0, 'Test Moritte', { yes: true, objects: [[find(s0, 'Test Bear', 'battlefield', 'p1')]] });
    const bears = onBf(r, 'Test Bear', 'p1');
    expect(bears).toHaveLength(2);
    const copy = bears.find((id) => id !== find(s0, 'Test Bear', 'battlefield', 'p1'))!;
    expect(hasSuper(r, copy, 'Legendary')).toBe(true);
    expect(hasSuper(r, copy, 'Snow')).toBe(true);
    expect(r.objects[copy]!.counters['+1/+1']).toBe(2);
    expect(hasKeyword(r, copy, 'changeling')).toBe(true);
    expect(pt(r, copy)).toEqual([4, 4]);
  });
  it('NEGATIVE: copying a noncreature artifact: legendary and snow, but no counters', () => {
    const s0 = setup('Test Trinket');
    const r = castCreature(s0, 'Test Moritte', { yes: true, objects: [[find(s0, 'Test Trinket', 'battlefield', 'p1')]] });
    const copy = onBf(r, 'Test Trinket', 'p1').find((id) => id !== find(s0, 'Test Trinket', 'battlefield', 'p1'))!;
    expect(hasSuper(r, copy, 'Legendary')).toBe(true);
    expect(hasSuper(r, copy, 'Snow')).toBe(true);
    expect(r.objects[copy]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 707.10, 707.9b, 105.3 (unverified): "Copy target instant or sorcery spell, except that the copy is red. You may choose new targets for the copy."', () => {
  const FORKER = card('Test Forker', 'Instant', 'Copy target instant or sorcery spell, except that the copy is red. You may choose new targets for the copy.', { cost: '{4}', colors: ['R'] });
  const FROST = card('Test Frost', 'Instant', 'Test Frost deals 1 damage to any target.', { cost: '{1}', colors: ['U'] });
  const defs = [FORKER, FROST];
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Forker', 'Test Frost'], battlefield: lands(6) }, defs });
  it('is automated', () => expect(automated(FORKER)).toBe(true));
  it('the copy of a blue spell is red (the original stays blue) and deals its damage too', () => {
    const s0 = setup();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Frost', 'hand', 'p1') }), { targets: [[p2]] });
    const frost = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Forker', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: frost }]] });
    // resolve Test Forker only: pass until a copy is on the stack above the original
    for (let i = 0; i < 6 && s.zones.stack.length < 2; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, { yes: false });
    const stack = s.zones.stack.map((id) => s.objects[id]!);
    expect(stack).toHaveLength(2);
    const copy = stack.find((o) => o.id !== frost)!;
    expect(chars(s, copy.id).colors).toEqual(['R']);
    expect(chars(s, frost).colors).toEqual(['U']);
    s = resolveAll(s, { yes: false });
    expect(lifeOf(s, 'p2')).toBe(18);
  });
});
