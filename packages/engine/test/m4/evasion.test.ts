/**
 * Which creatures can block which attackers: flying/reach, menace, protection, intimidate, fear, shadow, horsemanship, skulk and landwalk
 * (CR 509.1a-b and the keyword rules of CR 702). Every test attacks with the first creature of p1's board and reads the block options
 * the defending player is offered; the engine then rejects what was not offered.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../src/index';
import { nativeDef } from '../fixtures';
import { reject } from '../m3/scenario';
import { declareAttackers, declareBlockers, find, passUntil, scenario, toDeclareAttackers, type ScenarioOptions } from './helpers';

/** Attack with `attacker` (p1) and report, for each name in `blockers` (p2 creatures), whether it is offered as a possible blocker. */
function offers(attacker: string, blockers: string[], extra: { p1?: string[]; p2?: string[]; defs?: CardDef[] } = {}): { map: Record<string, boolean>; state: GameState } {
  const names = [attacker, ...blockers, ...(extra.p1 ?? []), ...(extra.p2 ?? [])];
  const opts: ScenarioOptions = { p1: { battlefield: [attacker, ...(extra.p1 ?? [])] }, p2: { battlefield: [...blockers, ...(extra.p2 ?? [])] }, ...(extra.defs ? { defs: extra.defs } : {}) };
  const s0 = scenario(names.filter((n) => !extra.defs?.some((d) => d.name === n)), opts);
  let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, attacker, 'battlefield', 'p1')]]);
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers', 10);
  const offered = new Set(s.pending?.kind === 'declareBlockers' ? s.pending.candidates.filter((c) => c.attackers.length > 0).map((c) => c.id) : []);
  const map: Record<string, boolean> = {};
  for (const b of blockers) map[b] = offered.has(find(s0, b, 'battlefield', 'p2'));
  return { map, state: s };
}

describe('CR 702.9, 702.17: flying and reach', () => {
  it('CR 702.9b: a creature with flying can be blocked only by creatures with flying or reach (Serra Angel)', () => {
    const { map } = offers('Serra Angel', ['Hill Giant', 'Giant Spider', 'Vampire Nighthawk']);
    expect(map).toEqual({ 'Hill Giant': false, 'Giant Spider': true, 'Vampire Nighthawk': true });
  });

  it('CR 702.9b: a creature with flying can block a creature with or without flying', () => {
    expect(offers('Hill Giant', ['Serra Angel']).map).toEqual({ 'Serra Angel': true });
    expect(offers('Serra Angel', ['Vampire Nighthawk']).map).toEqual({ 'Vampire Nighthawk': true });
  });

  it('CR 702.17b: reach does not let a creature fly, but lets it block flyers; a creature without flying or reach cannot block a flyer', () => {
    const { map } = offers('Ornithopter', ['Canopy Spider', 'Grizzly Bears', 'Wall of Stone']);
    expect(map).toEqual({ 'Canopy Spider': true, 'Grizzly Bears': false, 'Wall of Stone': false });
  });

  it('CR 509.1: a block the engine did not offer is rejected, and the decision stays open', () => {
    const { state } = offers('Serra Angel', ['Hill Giant', 'Giant Spider']);
    const giant = state.zones.battlefield.find((id) => state.defs[state.objects[id]!.defId]!.name === 'Hill Giant')!;
    const angel = find(state, 'Serra Angel', 'battlefield', 'p1');
    const err = reject(state, { type: 'answer', player: 'p2', decisionId: state.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: giant, attacker: angel }] } });
    expect(err.rules).toContain('CR 509.1a');
  });
});

describe('CR 702.111: menace', () => {
  const board = (blockers: string[]) => scenario(['Elephant-Rat', ...blockers], { p1: { battlefield: ['Elephant-Rat'] }, p2: { battlefield: blockers } });

  it('CR 702.111b: with fewer than two creatures able to block it, an attacker with menace is not offered at all', () => {
    const s0 = board(['Grizzly Bears']);
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Elephant-Rat', 'battlefield')]]);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers', 'declare blockers', 10);
    expect(s.pending).toMatchObject({ kind: 'priority' }); // nothing to decide
    expect(s.combat!.attackers[0]!.blocked).toBe(false);
  });

  it('CR 702.111b: with two possible blockers it is offered, flagged as needing two, and a single block is illegal', () => {
    const s0 = board(['Grizzly Bears', 'Hill Giant']);
    const rat = find(s0, 'Elephant-Rat', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[rat]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(s.pending).toMatchObject({ kind: 'declareBlockers', needsMultiple: [rat] });
    const err = reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: bears, attacker: rat }] } });
    expect(err.rules).toContain('CR 702.111b');
    expect(s.pending).toMatchObject({ kind: 'declareBlockers' }); // still waiting for a legal declaration
    const ok = declareBlockers(s, [[bears, rat], [giant, rat]]);
    expect(ok.combat!.attackers[0]).toMatchObject({ blocked: true, blockedBy: [bears, giant] });
    // No block at all is legal too.
    expect(declareBlockers(s, []).combat!.attackers[0]!.blocked).toBe(false);
  });
});

describe('CR 702.16: protection and blocking', () => {
  it('CR 702.16f: an attacker with protection from white cannot be blocked by white creatures (Black Knight)', () => {
    const { map } = offers('Black Knight', ['Serra Angel', 'Hill Giant', 'Vampire Nighthawk']);
    expect(map).toEqual({ 'Serra Angel': false, 'Hill Giant': true, 'Vampire Nighthawk': true });
  });

  it('CR 702.16f: protection from black (White Knight) stops black blockers only', () => {
    const { map } = offers('White Knight', ['Vampire Nighthawk', 'Typhoid Rats', 'Grizzly Bears']);
    expect(map).toEqual({ 'Vampire Nighthawk': false, 'Typhoid Rats': false, 'Grizzly Bears': true });
  });

  it('CR 702.16a: protection from a card type: an attacker with protection from creatures cannot be blocked at all (Beloved Chaplain)', () => {
    const { map } = offers('Beloved Chaplain', ['Grizzly Bears', 'Wall of Stone']);
    expect(map).toEqual({ 'Grizzly Bears': false, 'Wall of Stone': false });
  });

  it('CR 702.16g: protection from two colors is two abilities; both apply (Mirran Crusader: black and green)', () => {
    // WP18 review (D14): the renderer cannot print "protection from black and from green" yet, so the card is compiled with the milestone 4 recognizer
    const { map } = offers('Mirran Crusader', ['Typhoid Rats', 'Giant Spider', 'Hill Giant'], { defs: [nativeDef('Mirran Crusader')] });
    expect(map).toEqual({ 'Typhoid Rats': false, 'Giant Spider': false, 'Hill Giant': true });
  });
});

describe('CR 702.13, 702.36: intimidate and fear', () => {
  it('CR 702.13b: intimidate: only artifact creatures and creatures that share a color can block (Highborn Ghoul is black)', () => {
    const { map } = offers('Highborn Ghoul', ['Grizzly Bears', 'Vampire Nighthawk', 'Phyrexian Digester', 'Ornithopter']);
    expect(map).toEqual({ 'Grizzly Bears': false, 'Vampire Nighthawk': true, 'Phyrexian Digester': true, Ornithopter: true });
  });

  it('CR 702.13b: a creature with intimidate and two colors can be blocked by a creature sharing either (Spectral Rider is white; Obzedat-like check with a white blocker)', () => {
    const { map } = offers('Spectral Rider', ['Serra Angel', 'Hill Giant']);
    expect(map).toEqual({ 'Serra Angel': true, 'Hill Giant': false });
  });

  it('CR 702.36b: fear: only artifact creatures and black creatures can block (Prickly Boggart)', () => {
    const { map } = offers('Prickly Boggart', ['Grizzly Bears', 'Vampire Nighthawk', 'Phyrexian Digester', 'Serra Angel']);
    expect(map).toEqual({ 'Grizzly Bears': false, 'Vampire Nighthawk': true, 'Phyrexian Digester': true, 'Serra Angel': false });
  });
});

describe('CR 702.28, 702.31, 702.118: shadow, horsemanship and skulk', () => {
  it('CR 702.28b: a creature with shadow can be blocked only by creatures with shadow (Soltari Foot Soldier)', () => {
    expect(offers('Soltari Foot Soldier', ['Thalakos Sentry', 'Grizzly Bears']).map).toEqual({ 'Thalakos Sentry': true, 'Grizzly Bears': false });
  });

  it('CR 702.28b: a creature with shadow can block only creatures with shadow (Thalakos Sentry cannot block Grizzly Bears)', () => {
    expect(offers('Grizzly Bears', ['Thalakos Sentry', 'Hill Giant']).map).toEqual({ 'Thalakos Sentry': false, 'Hill Giant': true });
  });

  it('CR 702.31b: a creature with horsemanship can be blocked only by creatures with horsemanship; horsemanship can block anything (Shu Cavalry, Wei Scout)', () => {
    expect(offers('Shu Cavalry', ['Wei Scout', 'Grizzly Bears']).map).toEqual({ 'Wei Scout': true, 'Grizzly Bears': false });
    expect(offers('Grizzly Bears', ['Wei Scout']).map).toEqual({ 'Wei Scout': true });
  });

  it('CR 702.118b: skulk: a creature cannot be blocked by creatures with greater power (Furtive Homunculus has power 2)', () => {
    const { map } = offers('Furtive Homunculus', ['Hill Giant', 'Grizzly Bears', 'Darksteel Myr']);
    expect(map).toEqual({ 'Hill Giant': false, 'Grizzly Bears': true, 'Darksteel Myr': true });
  });
});

describe('CR 702.14: landwalk', () => {
  it('CR 702.14c: swampwalk: the creature cannot be blocked while the defending player controls a Swamp (Bog Raiders)', () => {
    const blocked = offers('Bog Raiders', ['Grizzly Bears'], { p2: ['Swamp'] });
    expect(blocked.map).toEqual({ 'Grizzly Bears': false });
    expect(blocked.state.pending).toMatchObject({ kind: 'priority' }); // nothing could block, so no decision
    expect(offers('Bog Raiders', ['Grizzly Bears'], { p2: ['Forest'] }).map).toEqual({ 'Grizzly Bears': true });
    // Only the defending player's lands count: the attacker's own Swamp doesn't matter.
    expect(offers('Bog Raiders', ['Grizzly Bears'], { p1: ['Swamp'] }).map).toEqual({ 'Grizzly Bears': true });
  });

  it('CR 702.14c: islandwalk and forestwalk look for their own land type (Grayscaled Gharial, Jukai Messenger)', () => {
    expect(offers('Grayscaled Gharial', ['Grizzly Bears'], { p2: ['Island'] }).map['Grizzly Bears']).toBe(false);
    expect(offers('Grayscaled Gharial', ['Grizzly Bears'], { p2: ['Forest'] }).map['Grizzly Bears']).toBe(true);
    expect(offers('Jukai Messenger', ['Hill Giant'], { p2: ['Forest'] }).map['Hill Giant']).toBe(false);
  });

  it('CR 702.14c: nonbasic landwalk needs a land without the supertype basic (Dryad Sophisticate; Taiga is a nonbasic land)', () => {
    // WP18 review (D14): "nonbasic landwalk" is not printable by the renderer yet: the milestone 4 recognizer's reading drives this engine test
    const defs = [nativeDef('Dryad Sophisticate')];
    expect(offers('Dryad Sophisticate', ['Grizzly Bears'], { p2: ['Taiga'], defs }).map['Grizzly Bears']).toBe(false);
    expect(offers('Dryad Sophisticate', ['Grizzly Bears'], { p2: ['Forest', 'Mountain'], defs }).map['Grizzly Bears']).toBe(true);
  });

  it('CR 702.14c: snow landwalk needs a snow land (Zombie Musher); a plain Swamp is not snow', () => {
    const defs = [nativeDef('Zombie Musher')]; // WP18 review (D14): "snow landwalk" is not printable by the renderer yet
    expect(offers('Zombie Musher', ['Grizzly Bears'], { p2: ['Snow-Covered Swamp'], defs }).map['Grizzly Bears']).toBe(false);
    expect(offers('Zombie Musher', ['Grizzly Bears'], { p2: ['Swamp'], defs }).map['Grizzly Bears']).toBe(true);
  });

  it('CR 702.14a, 702.14c: legendary landwalk looks at the supertype legendary (a synthetic legendary land)', () => {
    const land = compileCard({ name: 'Test Legendary Land', layout: 'normal', type_line: 'Legendary Land', oracle_text: '' } as OracleCard);
    const ayumi = nativeDef('Ayumi, the Last Visitor'); // WP18 review (D14): "legendary landwalk" is not printable by the renderer yet
    expect(offers('Ayumi, the Last Visitor', ['Grizzly Bears'], { p2: ['Test Legendary Land'], defs: [land, ayumi] }).map['Grizzly Bears']).toBe(false);
    expect(offers('Ayumi, the Last Visitor', ['Grizzly Bears'], { p2: ['Forest'], defs: [ayumi] }).map['Grizzly Bears']).toBe(true);
  });

  it("CR 702.14d example: a player who controls a snow land can't block a snow landwalker even with a snow landwalker of their own", () => {
    // Both Zombie Mushers have snow landwalk; Bob also controls a snow Swamp, so Alice's Musher still can't be blocked, not even by Bob's.
    const { map } = offers('Zombie Musher', ['Zombie Musher'], { p2: ['Snow-Covered Swamp'], defs: [nativeDef('Zombie Musher')] });
    expect(map).toEqual({ 'Zombie Musher': false });
  });
});

describe('CR 509.1b: evasion abilities are cumulative', () => {
  it('a creature with flying and fear can be blocked only by a black or artifact creature that also has flying or reach', () => {
    const flyer = compileCard({ name: 'Test Flying Fear', layout: 'normal', type_line: 'Creature — Wraith', mana_cost: '{B}', power: '1', toughness: '1', oracle_text: 'Flying, fear' } as OracleCard);
    const { map } = offers('Test Flying Fear', ['Vampire Nighthawk', 'Typhoid Rats', 'Serra Angel', 'Ornithopter'], { defs: [flyer] });
    // Nighthawk: black + flying -> yes. Rats: black, no flying -> no. Angel: flying but neither black nor artifact -> no. Ornithopter: artifact + flying -> yes.
    expect(map).toEqual({ 'Vampire Nighthawk': true, 'Typhoid Rats': false, 'Serra Angel': false, Ornithopter: true });
  });
});
