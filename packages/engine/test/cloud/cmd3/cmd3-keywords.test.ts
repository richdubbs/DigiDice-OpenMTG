/**
 * CMD3 (commander batch): expansion keywords, played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each keyword's data file (keywords/data/<name>.json) holds its expansion.
 *
 *   CR 702.92a   living weapon: a 0/0 black Phyrexian Germ token, then the Equipment is attached to it
 *   CR 702.86a   annihilator N: whenever it attacks, defending player sacrifices N permanents
 *   CR 702.135a  afterlife N: N 1/1 white and black Spirit tokens with flying when it is put into a graveyard from the battlefield
 *   CR 702.107a  outlast [cost]: [cost], {T}: a +1/+1 counter, only as a sorcery
 *   CR 702.115a  ingest: combat damage to a player exiles the top card of that player's library
 *   CR 702.130a  afflict N: whenever it becomes blocked, defending player loses N life
 *   CR 702.46a   soulshift N: dies, may return target Spirit card with mana value N or less from your graveyard to your hand
 *   CR 702.123a  fabricate N: N +1/+1 counters or N 1/1 Servo tokens (Servos when the permanent is gone)
 *   CR 702.43a   modular N: enters with N +1/+1 counters; dies, its +1/+1 counters (as it last existed, CR 608.2h) go on target artifact creature
 *   CR 702.44a   sunburst: a +1/+1 counter for each color of mana spent to cast it if it enters as a creature, else that many charge counters; "as a creature" is
 *                the permanent as it would exist on the battlefield (CR 614.12), type-changing effects included
 *   CR 702.32a   fading N: enters with N fade counters; upkeep: remove one, if you can't, sacrifice it
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, find, legal, life, scenario } from '../../m3/scenario';
import { declareBlockers, passUntil, toDeclareBlockers } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, inYard, named, permanentsOf, pt, resolveAll, settle, tokens } from './helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SPEAR = card('Test Spear', 'Artifact — Equipment', 'Living weapon\nEquipped creature gets +2/+1.\nEquip {2}');
const DEVOURER = card('Test Devourer', 'Creature — Eldrazi', 'Annihilator 2', ['5', '5']);
const MARTYR = card('Test Martyr', 'Creature — Human Cleric', 'Afterlife 2', ['1', '1']);
const SQUIRE = card('Test Squire', 'Creature — Human Knight', 'Outlast {0}', ['1', '1']);
const MAW = card('Test Maw', 'Creature — Eldrazi Drone', 'Ingest', ['2', '2']);
const SCOURGE = card('Test Scourge', 'Creature — Zombie', 'Afflict 3', ['2', '2']);
const KAMI = card('Test Kami', 'Creature — Spirit', 'Soulshift 3', ['1', '1']);
const SMALL_SPIRIT = card('Test Small Spirit', 'Creature — Spirit', '', ['1', '1'], '{2}{W}');
const BIG_SPIRIT = card('Test Big Spirit', 'Creature — Spirit', '', ['3', '3'], '{3}{W}');
const ARTISAN = card('Test Artisan', 'Creature — Dwarf Artificer', 'Fabricate 2', ['1', '1']);
const DRONE = card('Test Drone', 'Artifact Creature — Construct', 'Modular 2', ['0', '0']);
const HOST = card('Test Host', 'Artifact Creature — Golem', '', ['1', '1']);
const PRISMATIC = card('Test Prismatic', 'Artifact Creature — Golem', 'Sunburst', ['0', '0'], '{2}');
const CRYSTAL = card('Test Crystal', 'Artifact', 'Sunburst', undefined, '{2}');
const WISP = card('Test Wisp', 'Creature — Spirit', 'Fading 1', ['3', '3']);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const FOUNDRY = card('Test Foundry', 'Enchantment', 'Artifacts you control are creatures in addition to their other types.');
const MIMIC = card('Test Mimic', 'Artifact Creature — Shapeshifter', 'You may have this creature enter as a copy of any artifact on the battlefield.', ['0', '0'], '{2}');
const DEFS = [BEAR, SPEAR, DEVOURER, MARTYR, SQUIRE, MAW, SCOURGE, KAMI, SMALL_SPIRIT, BIG_SPIRIT, ARTISAN, DRONE, HOST, PRISMATIC, CRYSTAL, WISP, SMITE, FOUNDRY, MIMIC];

const smite = (s: GameState, id: string): GameState => resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id }] }), { targets: [] });

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.92a: living weapon', () => {
  it('a 0/0 black Phyrexian Germ token is created and the Equipment is attached to it (it survives as 2/1)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Spear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Spear'));
    const germ = tokens(s);
    expect(germ).toHaveLength(1);
    const c = getChars(s, germ[0]!)!;
    expect(c.subtypes).toEqual(expect.arrayContaining(['Phyrexian', 'Germ']));
    expect(c.colors).toEqual(['B']);
    expect(s.objects[find(s, 'Test Spear', 'battlefield')]!.attachedTo).toBe(germ[0]);
    expect(pt(s, germ[0]!)).toBe('2/1');
  });
});

describe('CR 702.86a: annihilator', () => {
  it('whenever it attacks, defending player sacrifices two permanents', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Devourer'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Plains'] }, defs: DEFS });
    expect(permanentsOf(s0, 'p2')).toHaveLength(3);
    const a = attackWith(s0, [find(s0, 'Test Devourer', 'battlefield')]);
    expect(a.zones.stack).toHaveLength(1);
    const r = resolveAll(a);
    expect(permanentsOf(r, 'p2')).toHaveLength(1);
    expect((r.zones.graveyard['p2'] ?? []).length).toBe(2);
  });
});

describe('CR 702.135a: afterlife', () => {
  it('when it dies, two 1/1 white and black Spirit tokens with flying are created', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Smite'], battlefield: ['Test Martyr'] }, defs: DEFS });
    const s = smite(s0, find(s0, 'Test Martyr', 'battlefield'));
    const spirits = tokens(s);
    expect(spirits).toHaveLength(2);
    for (const id of spirits) {
      const c = getChars(s, id)!;
      expect(c.colors.sort()).toEqual(['B', 'W']);
      expect(c.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword))).toContain('flying');
      expect(pt(s, id)).toBe('1/1');
    }
  });
});

describe('CR 702.107a: outlast', () => {
  it('its cost and {T}: a +1/+1 counter, as a sorcery only', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Squire', since: -1 }] }, defs: DEFS });
    const squire = find(s0, 'Test Squire', 'battlefield');
    const acts = legal(s0, 'p1', 'activate').filter((a) => a.object === squire);
    expect(acts).toHaveLength(1);
    const s = resolveAll(settle(act(s0, acts[0]!.action)));
    expect(counters(s, squire, '+1/+1')).toBe(1);
    expect(s.objects[squire]!.tapped).toBe(true);
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === squire)).toHaveLength(0); // {T} is part of the cost
    // not at instant speed: the opponent's turn
    const t2 = advanceTo(s, 2, 'main1');
    expect(legal(t2, 'p1', 'activate').filter((a) => a.object === squire)).toHaveLength(0);
  });
});

describe('CR 702.115a: ingest', () => {
  it('combat damage to a player exiles the top card of their library', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Maw', since: -1 }] }, defs: DEFS });
    const lib = new Set(s0.zones.library['p2']!.map((id) => s0.objects[id]!.cardId));
    const before = s0.zones.library['p2']!.length;
    const r = resolveAll(passUntil(attackWith(s0, [find(s0, 'Test Maw', 'battlefield')]), (x) => x.zones.stack.length > 0, 'the ingest trigger'));
    expect(life(r, 'p2')).toBe(18);
    expect(r.zones.library['p2']!.length).toBe(before - 1);
    expect(r.zones.exile.length).toBe(1);
    expect(lib.has(r.objects[r.zones.exile[0]!]!.cardId)).toBe(true); // a card of that player's library
  });
});

describe('CR 702.130a: afflict', () => {
  it('whenever it becomes blocked, defending player loses 3 life; unblocked, nothing extra', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Scourge', since: -1 }] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const scourge = find(s0, 'Test Scourge', 'battlefield');
    const s = toDeclareBlockers(attackWith(s0, [scourge]));
    const b = resolveAll(passUntil(declareBlockers(s, [[find(s0, 'Test Bear', 'battlefield', 'p2'), scourge]]), (x) => x.zones.stack.length > 0, 'the afflict trigger'));
    expect(life(b, 'p2')).toBe(17);
    const u = passUntil(declareBlockers(toDeclareBlockers(attackWith(s0, [scourge])), []), (x) => x.turn.step === 'endCombat', 'the end of combat');
    expect(life(u, 'p2')).toBe(18); // only the combat damage
  });
});

describe('CR 702.46a: soulshift', () => {
  it('when it dies, you may return target Spirit card with mana value 3 or less (not 4) from your graveyard to your hand', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Smite'], battlefield: ['Test Kami'], graveyard: ['Test Small Spirit', 'Test Big Spirit'] }, defs: DEFS });
    const small = find(s0, 'Test Small Spirit', 'graveyard');
    const big = find(s0, 'Test Big Spirit', 'graveyard');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smite', 'hand') }), { targets: [{ kind: 'object', id: find(s0, 'Test Kami', 'battlefield') }] });
    s = act(act(s, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' });
    // the trigger asks for its target: the big Spirit (mana value 4) is not a legal one
    expect(s.pending?.kind).toBe('chooseTargets');
    const opts = JSON.stringify(s.pending);
    expect(opts).toContain(small);
    expect(opts).not.toContain(big);
    const r = resolveAll(s, { targets: [{ kind: 'object', id: small }], yes: true });
    expect((r.zones.hand['p1'] ?? []).map((id) => r.objects[id]!.defId)).toEqual(['Test Small Spirit']);
    expect(inYard(r, 'Test Big Spirit')).toBe(true);
  });
});

describe('CR 702.123a: fabricate', () => {
  it('you may put two +1/+1 counters on it', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Artisan'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Artisan'), { yes: true });
    expect(counters(s, find(s, 'Test Artisan', 'battlefield'), '+1/+1')).toBe(2);
    expect(tokens(s)).toHaveLength(0);
  });
  it("if you don't, two 1/1 colorless Servo artifact creature tokens are created", () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Artisan'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Artisan'), { yes: false });
    expect(counters(s, find(s, 'Test Artisan', 'battlefield'), '+1/+1')).toBe(0);
    const servos = tokens(s);
    expect(servos).toHaveLength(2);
    for (const id of servos) {
      expect(getChars(s, id)!.subtypes).toEqual(['Servo']);
      expect(getChars(s, id)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    }
  });
  it('the permanent left the battlefield before the ability resolved: the Servos are created (no counters can be put on it)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Artisan', 'Test Smite'] }, defs: DEFS });
    s = cast(s, 'Test Artisan');
    s = settle(act(s, { type: 'pass', player: 'p1' }));
    s = settle(act(s, { type: 'pass', player: 'p2' })); // the creature resolves; the fabricate trigger goes on the stack
    expect(s.zones.stack).toHaveLength(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand') }), { targets: [{ kind: 'object', id: find(s, 'Test Artisan', 'battlefield') }] });
    s = resolveAll(s, { yes: true });
    expect(named(s, 'Test Artisan')).toEqual([]);
    expect(tokens(s)).toHaveLength(2);
  });
});

describe('CR 702.43a: modular', () => {
  it('it enters with two +1/+1 counters; when it dies, its counters go on target artifact creature', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Drone', 'Test Smite'], battlefield: ['Test Host'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Drone'));
    const drone = find(s, 'Test Drone', 'battlefield');
    expect(counters(s, drone, '+1/+1')).toBe(2);
    expect(pt(s, drone)).toBe('2/2');
    const host = find(s, 'Test Host', 'battlefield');
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: drone }] }), { targets: [{ kind: 'object', id: host }], yes: true });
    expect(inYard(s, 'Test Drone')).toBe(true);
    expect(counters(s, host, '+1/+1')).toBe(2);
  });
});

describe('CR 702.44a: sunburst', () => {
  const twoColors = (hand: string): GameState => scenario(['Plains', 'Island'], { p1: { hand: [hand], battlefield: ['Plains', 'Island'] }, defs: DEFS });
  it('a creature enters with a +1/+1 counter for each color of mana spent to cast it', () => {
    const s = resolveAll(cast(twoColors('Test Prismatic'), 'Test Prismatic'));
    const golem = find(s, 'Test Prismatic', 'battlefield');
    expect(counters(s, golem, '+1/+1')).toBe(2);
    expect(counters(s, golem, 'charge')).toBe(0);
  });
  it('CR 702.44a, 614.12: a noncreature artifact that enters as a creature (an effect makes artifacts creatures) gets +1/+1 counters, not charge counters', () => {
    const s0 = scenario(['Plains', 'Island'], { p1: { hand: ['Test Crystal'], battlefield: ['Plains', 'Island', 'Test Foundry'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Crystal'));
    const crystal = find(s, 'Test Crystal', 'battlefield');
    expect(getChars(s, crystal)!.types).toContain('Creature');
    expect(counters(s, crystal, '+1/+1')).toBe(2);
    expect(counters(s, crystal, 'charge')).toBe(0);
  });
  it('a noncreature permanent enters with charge counters instead', () => {
    const s = resolveAll(cast(twoColors('Test Crystal'), 'Test Crystal'));
    const crystal = find(s, 'Test Crystal', 'battlefield');
    expect(counters(s, crystal, 'charge')).toBe(2);
    expect(counters(s, crystal, '+1/+1')).toBe(0);
  });
  it('CR 702.44a, 614.12, 616.1c: a creature spell that enters as a copy of a noncreature sunburst artifact is judged as the copy: charge counters', () => {
    const s0 = scenario(['Plains', 'Island'], { p1: { hand: ['Test Mimic'], battlefield: ['Plains', 'Island', 'Test Crystal'] }, defs: DEFS });
    const original = find(s0, 'Test Crystal', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Mimic'), { yes: true, objects: [original] });
    const copy = s.zones.battlefield.find((id) => id !== original && getChars(s, id)!.name === 'Test Crystal')!;
    expect(copy).toBeDefined();
    expect(getChars(s, copy)!.types).not.toContain('Creature');
    expect(counters(s, copy, 'charge')).toBe(2);
    expect(counters(s, copy, '+1/+1')).toBe(0);
  });
});

describe('CR 702.32a: fading', () => {
  it('enters with a fade counter; the next upkeep removes it; the one after, it is sacrificed because none can be removed', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wisp'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Wisp'));
    const wisp = find(s, 'Test Wisp', 'battlefield');
    expect(counters(s, wisp, 'fade')).toBe(1);
    s = resolveAll(passUntil(advanceTo(s, 3, 'upkeep'), (x) => x.zones.stack.length > 0, 'the fading trigger'));
    expect(counters(s, wisp, 'fade')).toBe(0);
    expect(named(s, 'Test Wisp')).toEqual([wisp]);
    s = resolveAll(passUntil(advanceTo(s, 5, 'upkeep'), (x) => x.zones.stack.length > 0, 'the fading trigger'));
    expect(named(s, 'Test Wisp')).toEqual([]);
    expect(inYard(s, 'Test Wisp')).toBe(true);
  });
  it("only in its controller's upkeep (not the opponent's)", () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wisp'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Wisp'));
    s = advanceTo(s, 2, 'draw');
    expect(counters(s, find(s, 'Test Wisp', 'battlefield'), 'fade')).toBe(1);
  });
});
