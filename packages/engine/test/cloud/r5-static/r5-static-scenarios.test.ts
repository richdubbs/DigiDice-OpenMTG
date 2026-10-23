/**
 * Standard round 5, slice r5-static (static and continuous effects), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10). The costs to attack and block have their own file (r5-static-tax.test.ts).
 *
 *   CR 201.2a, 708.2a   "~ can't be blocked by creatures that don't have a name": a face-down creature has no name; a named one does
 *   CR 611.3a          "Equipped creature has first strike during your turn. Otherwise, it has vigilance.": the effects while the condition is false
 *   CR 611.3a, 613.4b  "Enchanted creature gets +2/+2 as long as it's a Knight you control. Otherwise, it has base power and toughness 1/1 and can't block
 *                      Knights.": a P/T change, or a base P/T and a restriction, by whether the condition holds
 *   CR 613.1f, 201.2a   "~ has all activated abilities of creatures you control that don't have the same name as ~" and "... of all Elf cards in your
 *                      graveyard": the abilities those objects have now, "this" in them being the object that has them
 *   CR 508.1c, 509.1b  "No more than one creature can attack each combat" / "... attack you ..." / "... block ..." and a planeswalker's granted "No more than one
 *                      creature can attack this planeswalker each combat": limits on the whole declaration
 *   CR 702.16b-e       "You have protection from each of your opponents": not dealt damage, targeted or enchanted by what an opponent controls (the player's
 *                      protection, unverified CR 702.16k)
 *   CR 508.1d, 611.2a  "Until your next turn, each creature attacks each combat if able and attacks a player other than you if able": two requirements of a
 *                      resolved effect, the players other than you fixed as it resolves (CR 102.3)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level === 'full')) && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const has = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);

function until(s0: GameState, kind: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind !== kind; guard++) {
    if (guard > 60) throw new Error(`no ${kind}`);
    s = pass(s);
  }
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const KNIGHT = card('Test Knight', 'Creature — Human Knight', '', ['2', '2']);

describe('CR 201.2a, 708.2a: "~ can\'t be blocked by creatures that don\'t have a name."', () => {
  const DANDY = card('Test Dandy', 'Creature — Human', "~ can't be blocked by creatures that don't have a name.", ['2', '2']);
  it('is automated', () => expect(full(DANDY)).toBe(true));
  it('a face-down creature (no name) can\'t block it; a creature with a name can', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dandy'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [DANDY, BEAR] });
    const d = find(s, 'Test Dandy', 'battlefield', 'p1');
    s.objects[d]!.controlledSinceTurn = -1;
    const [hidden, named] = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.defId === 'Test Bear');
    s.objects[hidden!]!.faceDown = true;
    expect(chars(s, hidden!).names.filter((n) => n !== '')).toEqual([]);
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: d, defender: 'p2' }] });
    s = until(s, 'declareBlockers');
    const block = (blocker: string) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker: d }] } as never });
    expect(block(hidden!).error).toBeDefined();
    expect(block(named!).error).toBeUndefined();
  });
});

describe('CR 611.3a: "Equipped creature has first strike during your turn. Otherwise, it has vigilance."', () => {
  const PIPE = card('Test Pipe', 'Artifact — Equipment', 'Equipped creature has first strike during your turn. Otherwise, it has vigilance.\nEquip {2}');
  it('is automated', () => expect(full(PIPE)).toBe(true));
  it('first strike (not vigilance) on its controller\'s turn; vigilance (not first strike) on the opponent\'s turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Pipe', 'Test Bear'] }, defs: [PIPE, BEAR] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[find(s, 'Test Pipe', 'battlefield', 'p1')]!.attachedTo = b;
    expect(has(s, b, 'first strike')).toBe(true);
    expect(has(s, b, 'vigilance')).toBe(false);
    for (let guard = 0; s.turn.activePlayer === 'p1' && guard < 80; guard++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(has(s, b, 'first strike')).toBe(false);
    expect(has(s, b, 'vigilance')).toBe(true);
  });
  it('unattached, nothing has either ability', () => {
    const s = scenario([], { p1: { battlefield: ['Test Pipe', 'Test Bear'] }, defs: [PIPE, BEAR] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(has(s, b, 'first strike') || has(s, b, 'vigilance')).toBe(false);
  });
});

describe('CR 611.3a, 613.4b: "... gets +2/+2 as long as it\'s a Knight you control. Otherwise, it has base power and toughness 1/1 and can\'t block Knights."', () => {
  const ONUS = card('Test Onus', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +2/+2 as long as it's a Knight you control. Otherwise, it has base power and toughness 1/1 and can't block Knights.");
  it('is automated', () => expect(full(ONUS)).toBe(true));
  it('on your Knight: +2/+2; on a Bear you control or on an opponent\'s Knight: base 1/1', () => {
    const s = scenario([], { p1: { battlefield: ['Test Knight', 'Test Bear'] }, p2: { battlefield: ['Test Knight'] }, defs: [ONUS, KNIGHT, BEAR] });
    const aura = put(s, 'p1', 'battlefield', 'Test Onus'); // attached below (an unattached Aura would be put into the graveyard, CR 704.5m)
    const mine = find(s, 'Test Knight', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Knight', 'battlefield', 'p2');
    s.objects[aura]!.attachedTo = mine;
    expect([chars(s, mine).power, chars(s, mine).toughness]).toEqual(['4', '4']);
    s.objects[aura]!.attachedTo = bear;
    expect([chars(s, bear).power, chars(s, bear).toughness]).toEqual(['1', '1']);
    s.objects[aura]!.attachedTo = theirs; // "you" is the Aura's controller (CR 109.5)
    expect([chars(s, theirs).power, chars(s, theirs).toughness]).toEqual(['1', '1']);
    expect([chars(s, mine).power, chars(s, mine).toughness]).toEqual(['2', '2']);
  });
  it('the enchanted non-Knight can\'t block a Knight; it can block a Bear; your enchanted Knight can block Knights', () => {
    let s = scenario([], { p1: { battlefield: ['Test Knight', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [ONUS, KNIGHT, BEAR] });
    const knight = find(s, 'Test Knight', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    for (const id of [knight, bear]) s.objects[id]!.controlledSinceTurn = -1;
    const blocker = find(s, 'Test Bear', 'battlefield', 'p2');
    s.objects[put(s, 'p2', 'battlefield', 'Test Onus')]!.attachedTo = blocker;
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: knight, defender: 'p2' }, { attacker: bear, defender: 'p2' }] });
    s = until(s, 'declareBlockers');
    const block = (attacker: string) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker }] } as never });
    expect(block(knight).error).toBeDefined();
    expect(block(bear).error).toBeUndefined();
  });
});

describe('CR 613.1f, 201.2a: "~ has all activated abilities of creatures you control that don\'t have the same name as ~."', () => {
  const MIMIC = card('Test Mimic', 'Creature — Shapeshifter', "~ has all activated abilities of creatures you control that don't have the same name as ~.", ['2', '2']);
  const PINGER = card('Test Pinger', 'Creature — Human', '{T}: ~ deals 1 damage to any target.', ['1', '1']);
  const ELDER = card('Test Elder', 'Legendary Creature — Elf', '~ has all activated abilities of all Elf cards in your graveyard.', ['3', '3']);
  const ELF = card('Test Elf Sage', 'Creature — Elf', '{T}: You gain 2 life.', ['1', '1']);
  const activations = (s: GameState, id: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.object === id);
  it('are automated', () => { expect(full(MIMIC)).toBe(true); expect(full(ELDER)).toBe(true); });
  it('the Mimic gains the Pinger\'s ability, and using it taps the Mimic and the Mimic deals the damage; another Mimic\'s abilities are not copied', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mimic', 'Test Pinger'] }, defs: [MIMIC, PINGER] });
    const m = find(s, 'Test Mimic', 'battlefield', 'p1');
    const pinger = find(s, 'Test Pinger', 'battlefield', 'p1');
    for (const id of [m, pinger]) s.objects[id]!.controlledSinceTurn = -1;
    const acts = activations(s, m);
    expect(acts.length).toBe(1);
    s = act(s, acts[0]!.action);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    for (let guard = 0; guard < 10 && s.zones.stack.length > 0; guard++) s = pass(s);
    expect(s.objects[m]!.tapped).toBe(true);
    expect(s.objects[pinger]!.tapped).toBe(false);
    expect(life(s, 'p2')).toBe(19);
    expect(s.log.some((l) => /Test Mimic deals 1 damage/.test(l.text))).toBe(true);
  });
  it('two Mimics copy nothing from each other (the same name); the ability leaves with the creature it came from', () => {
    const s = scenario([], { p1: { battlefield: ['Test Mimic', 'Test Mimic', 'Test Pinger'] }, defs: [MIMIC, PINGER] });
    const [m1] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Mimic');
    s.objects[m1!]!.controlledSinceTurn = -1;
    expect(activations(s, m1!).length).toBe(1); // the Pinger's, once (not the other Mimic's copy of it)
    const p = find(s, 'Test Pinger', 'battlefield', 'p1');
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== p);
    s.objects[p]!.zone = 'graveyard';
    s.zones.graveyard['p1']!.push(p);
    expect(activations(s, m1!)).toEqual([]);
  });
  it('an Elf card in your graveyard lends its ability; one in an opponent\'s graveyard does not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elder'] }, p2: { graveyard: ['Test Elf Sage'] }, defs: [ELDER, ELF] });
    const e = find(s, 'Test Elder', 'battlefield', 'p1');
    s.objects[e]!.controlledSinceTurn = -1;
    expect(activations(s, e)).toEqual([]);
    put(s, 'p1', 'graveyard', 'Test Elf Sage');
    expect(activations(s, e).length).toBe(1);
    expect(getChars(s, e)!.abilities.some((a) => a.def.kind === 'activated')).toBe(true);
  });
});

describe('CR 508.1c, 509.1b: limits on the whole declaration', () => {
  const ARBITER = card('Test Arbiter', 'Artifact Creature — Golem', 'No more than one creature can attack each combat.\nNo more than one creature can block each combat.', ['1', '5']);
  const CRAWL = card('Test Crawlway', 'Artifact', 'No more than two creatures can attack you each combat.');
  const LAWMAGE = card('Test Lawmage', 'Creature — Human Advisor', 'Planeswalkers you control have "No more than one creature can attack this planeswalker each combat."', ['2', '3']);
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '+1: You gain 1 life.', loyalty: '3', colors: [] } as unknown as OracleCard);
  const DEFS = [ARBITER, CRAWL, LAWMAGE, WALKER, BEAR];
  const ready = (s: GameState, owner: string): string[] => {
    const ids = s.zones.battlefield.filter((id) => s.objects[id]!.controller === owner && s.objects[id]!.defId === 'Test Bear');
    for (const id of ids) s.objects[id]!.controlledSinceTurn = -1;
    return ids;
  };
  const declare = (s: GameState, attacks: { attacker: string; defender: string }[]) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } as never });
  it('are automated', () => { for (const d of [ARBITER, CRAWL, LAWMAGE]) expect(full(d), d.name).toBe(true); });

  it('"No more than one creature can attack each combat": two attackers are rejected, one is not; the decision lists the limit', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Arbiter'] }, defs: DEFS });
    const [a, b] = ready(s, 'p1');
    s = until(s, 'declareAttackers');
    expect(s.pending!.kind === 'declareAttackers' && s.pending!.limits?.[0]?.max).toBe(1);
    const two = declare(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }]);
    expect(two.error?.rules).toContain('CR 508.1c');
    expect(declare(s, [{ attacker: a!, defender: 'p2' }]).error).toBeUndefined();
  });

  it('"No more than one creature can block each combat": two blockers are rejected', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Arbiter'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: DEFS });
    const [a] = ready(s, 'p1');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }] });
    s = until(s, 'declareBlockers');
    const [x, y] = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.defId === 'Test Bear');
    const blocks = (bl: { blocker: string; attacker: string }[]) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: bl } as never });
    expect(blocks([{ blocker: x!, attacker: a! }, { blocker: y!, attacker: a! }]).error?.rules).toContain('CR 509.1b');
    expect(blocks([{ blocker: x!, attacker: a! }]).error).toBeUndefined();
  });

  it('"No more than two creatures can attack you each combat": attacks on a planeswalker do not count', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Crawlway', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: DEFS });
    const [a, b, c] = ready(s, 'p1');
    const w = find(s, 'Test Walker', 'battlefield', 'p2');
    s = until(s, 'declareAttackers');
    expect(declare(s, [a!, b!, c!].map((x) => ({ attacker: x, defender: 'p2' }))).error).toBeDefined();
    expect(declare(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }, { attacker: c!, defender: w }]).error).toBeUndefined();
  });

  it('a planeswalker\'s granted "No more than one creature can attack this planeswalker each combat": two on it are rejected; the player can still be attacked', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Lawmage', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: DEFS });
    const [a, b] = ready(s, 'p1');
    const w = find(s, 'Test Walker', 'battlefield', 'p2');
    s = until(s, 'declareAttackers');
    expect(declare(s, [{ attacker: a!, defender: w }, { attacker: b!, defender: w }]).error?.rules).toContain('CR 508.1c');
    expect(declare(s, [{ attacker: a!, defender: w }, { attacker: b!, defender: 'p2' }]).error).toBeUndefined();
  });
});

describe('CR 702.16b-e: "You have protection from each of your opponents."', () => {
  const VIRTUE = card('Test Virtue', 'Creature — Avatar', 'You have protection from each of your opponents.', ['2', '2']);
  const QUAKE = card('Test Quake', 'Instant', '~ deals 2 damage to each player.');
  const SHOCK = card('Test Shock', 'Instant', '~ deals 2 damage to any target.');
  const DEFS = [VIRTUE, QUAKE, SHOCK];
  const toP2 = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 5 && s.pending?.player !== 'p2'; g++) s = pass(s); return s; };
  const resolveAll = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 10 && s.zones.stack.length > 0; g++) s = pass(s); return s; };
  it('is automated', () => expect(full(VIRTUE)).toBe(true));
  it('damage from a source an opponent controls is not dealt to you; the opponent still takes theirs', () => {
    let s = scenario([], { p1: { battlefield: ['Test Virtue'] }, p2: { hand: ['Test Quake'] }, defs: DEFS });
    s = toP2(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Quake', 'hand', 'p2') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(18);
  });
  it('an opponent\'s spell can\'t target you; your own can', () => {
    let s = scenario([], { p1: { battlefield: ['Test Virtue'], hand: ['Test Shock'] }, p2: { hand: ['Test Shock'] }, defs: DEFS });
    const mine = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shock', 'hand', 'p1') });
    const meOk = applyAction(mine, { type: 'answer', player: 'p1', decisionId: mine.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] } as never });
    expect(meOk.error).toBeUndefined();
    s = toP2(s);
    const theirs = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Shock', 'hand', 'p2') });
    const bad = applyAction(theirs, { type: 'answer', player: 'p2', decisionId: theirs.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] } as never });
    expect(bad.error).toBeDefined();
  });
  it('without the creature, the opponent\'s damage is dealt', () => {
    let s = scenario([], { p2: { hand: ['Test Quake'] }, defs: DEFS });
    s = toP2(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Quake', 'hand', 'p2') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 508.1d, 611.2a: "Until your next turn, each creature attacks each combat if able and attacks a player other than you if able."', () => {
  const CARNAGE = card('Test Carnage', 'Sorcery', 'Until your next turn, each creature attacks each combat if able and attacks a player other than you if able.');
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '+1: You gain 1 life.', loyalty: '3', colors: [] } as unknown as OracleCard);
  it('is automated', () => expect(full(CARNAGE)).toBe(true));
  it('after it resolves, your creature must attack, and attack the opponent rather than a planeswalker', () => {
    let s = scenario([], { p1: { hand: ['Test Carnage'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: [CARNAGE, WALKER, BEAR] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[b]!.controlledSinceTurn = -1;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Carnage', 'hand', 'p1') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 10 && s.zones.stack.length > 0; g++) s = pass(s);
    s = until(s, 'declareAttackers');
    expect(s.pending!.kind === 'declareAttackers' && s.pending!.mustObey).toBe(2);
    const w = find(s, 'Test Walker', 'battlefield', 'p2');
    const declare = (attacks: { attacker: string; defender: string }[]) => applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } as never });
    expect(declare([]).error?.rules).toContain('CR 508.1d');
    expect(declare([{ attacker: b, defender: w }]).error).toBeDefined();
    expect(declare([{ attacker: b, defender: 'p2' }]).error).toBeUndefined();
  });
});
