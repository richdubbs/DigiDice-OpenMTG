/**
 * FAST5 T37: scenarios (synthetic cards, wordings invented, design 6.10) played through the engine.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, reject, scenario } from '../../m3/scenario';
import { attackUnblocked, declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (an experimental template caps the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ctr = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;

/** Answer the decisions that come up: pay costs automatically; stop at priority. */
function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), answers);
const castWith = (s0: GameState, name: string, answers: DecisionAnswer[] = []): GameState =>
  settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), answers);
void legal;

describe('CR 601.2h, 614.1c: "~ enters with a +1/+1 counter on it for each color of mana spent to cast it" (converge)', () => {
  const ARCHAIC = card('Test Archaic', 'Creature — Avatar', 'Test Archaic enters with a +1/+1 counter on it for each color of mana spent to cast it.', ['2', '2'], '{3}{R}');
  it('two colors spent: two counters', () => {
    expect(automated(ARCHAIC)).toBe(true);
    const s0 = scenario(['Mountain', 'Forest'], { p1: { hand: ['Test Archaic'], battlefield: ['Mountain', 'Forest', 'Forest', 'Forest'] }, defs: [ARCHAIC] });
    const s = resolve(castWith(s0, 'Test Archaic'));
    expect(ctr(s, find(s, 'Test Archaic', 'battlefield'))).toBe(2);
  });
  it('one color spent: one counter', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Archaic'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, defs: [ARCHAIC] });
    const s = resolve(castWith(s0, 'Test Archaic'));
    expect(ctr(s, find(s, 'Test Archaic', 'battlefield'))).toBe(1);
  });
  it('put onto the battlefield without being cast: no counters', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Archaic'] }, defs: [ARCHAIC] });
    expect(ctr(s0, find(s0, 'Test Archaic', 'battlefield'))).toBe(0);
  });
});

describe('CR 601.2h: adamant, "if at least three white mana was spent to cast ~, ~ enters with a +1/+1 counter on it"', () => {
  const PALADIN = card('Test Paladin', 'Creature — Human Knight', 'If at least three white mana was spent to cast Test Paladin, Test Paladin enters with a +1/+1 counter on it.', ['2', '2'], '{3}{W}');
  it('three white mana spent: one counter', () => {
    expect(automated(PALADIN)).toBe(true);
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Paladin'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: [PALADIN] });
    const s = resolve(castWith(s0, 'Test Paladin'));
    expect(ctr(s, find(s, 'Test Paladin', 'battlefield'))).toBe(1);
  });
  it('only two white mana spent: no counter', () => {
    const s0 = scenario(['Plains', 'Mountain'], { p1: { hand: ['Test Paladin'], battlefield: ['Plains', 'Plains', 'Mountain', 'Mountain'] }, defs: [PALADIN] });
    const s = resolve(castWith(s0, 'Test Paladin'));
    expect(ctr(s, find(s, 'Test Paladin', 'battlefield'))).toBe(0);
  });
  it('never cast (put onto the battlefield): no counter', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Paladin'] }, defs: [PALADIN] });
    expect(ctr(s0, find(s0, 'Test Paladin', 'battlefield'))).toBe(0);
  });
});

describe('CR 701.37: monstrosity N', () => {
  const WURM = card('Test Wurm', 'Creature — Wurm', '{0}: Monstrosity 3.\nWhen Test Wurm becomes monstrous, you gain 2 life.', ['2', '2']);
  const activateIt = (s: GameState): GameState => {
    const id = find(s, 'Test Wurm', 'battlefield');
    const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
    if (!la) throw new Error('no activation');
    return settle(act(s, la.action));
  };
  it('puts N +1/+1 counters on it and it becomes monstrous (the trigger sees it)', () => {
    expect(automated(WURM)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Wurm'] }, defs: [WURM] });
    const wurm = find(s, 'Test Wurm', 'battlefield');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
    s = resolve(activateIt(s));
    expect(ctr(s, wurm)).toBe(3);
    expect(s.objects[wurm]!.monstrous).toBe(true);
    // the "becomes monstrous" trigger is on the stack now
    expect(s.zones.stack.length).toBe(1);
    s = resolve(s);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
  it('a monstrous permanent does nothing more: no counters, no second trigger', () => {
    let s = scenario([], { p1: { battlefield: ['Test Wurm'] }, defs: [WURM] });
    const wurm = find(s, 'Test Wurm', 'battlefield');
    s = resolve(resolve(activateIt(s)));
    s = resolve(activateIt(s));
    expect(ctr(s, wurm)).toBe(3);
    expect(s.zones.stack.length).toBe(0);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
});

describe('CR 510.1b-c: "You may have ~ assign its combat damage as though it weren\'t blocked"', () => {
  const THORN = card('Test Thorn', 'Creature — Elemental', "You may have Test Thorn assign its combat damage as though it weren't blocked.", ['4', '4']);
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5']);
  const block = (yes: boolean): { s: GameState; thorn: ObjectId; wall: ObjectId } => {
    let s = scenario([], { p1: { battlefield: ['Test Thorn'] }, p2: { battlefield: ['Test Wall'] }, defs: [THORN, WALL] });
    const thorn = find(s, 'Test Thorn', 'battlefield');
    const wall = find(s, 'Test Wall', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[thorn]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[wall, thorn]]);
    s = passUntil(s, (x) => x.pending?.kind === 'yesNo', 'the damage choice');
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'yesNo', yes });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    return { s, thorn, wall };
  };
  it('the card is automated', () => expect(automated(THORN)).toBe(true));
  it('yes: all of the damage goes to the player the blocked creature attacks; the blocker is untouched', () => {
    const { s, wall } = block(true);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(16);
    expect(s.objects[wall]!.damage).toBe(0);
  });
  it('no: the damage goes to the blocker as usual', () => {
    const { s, wall } = block(false);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
    expect(s.objects[wall]!.damage).toBe(4);
  });
  it('an unblocked creature is not asked', () => {
    let s = scenario([], { p1: { battlefield: ['Test Thorn'] }, defs: [THORN] });
    s = attackUnblocked(s, [find(s, 'Test Thorn', 'battlefield')]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(16);
  });
});

describe('CR 506.5: "~ can\'t attack or block alone"', () => {
  const FLUNKY = card('Test Flunky', 'Creature — Goblin', "Test Flunky can't attack or block alone.", ['3', '3']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  const attackAnswer = (ids: ObjectId[]): DecisionAnswer => ({ kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) });
  it('the card is automated', () => expect(automated(FLUNKY)).toBe(true));
  it('attacking alone is refused; the decision stays open and flags the creature', () => {
    const s0 = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Flunky', 'Test Elf'] }, defs: [FLUNKY, ELF] }));
    const flunky = find(s0, 'Test Flunky', 'battlefield');
    const d = s0.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d.candidates.find((c) => c.id === flunky)!.onlyWithOthers).toBe(true);
    expect(d.candidates.find((c) => c.id !== flunky)!.onlyWithOthers).toBeUndefined();
    const err = reject(s0, { type: 'answer', player: 'p1', decisionId: d.id, answer: attackAnswer([flunky]) });
    expect(err.message).toMatch(/alone/);
    expect(err.rules).toContain('CR 506.5');
  });
  it('attacking together with another creature is allowed (and so is the other creature alone)', () => {
    const s0 = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Flunky', 'Test Elf'] }, defs: [FLUNKY, ELF] }));
    const flunky = find(s0, 'Test Flunky', 'battlefield');
    const elf = find(s0, 'Test Elf', 'battlefield');
    const s = answer(s0, attackAnswer([flunky, elf]));
    expect(s.combat!.attackers.map((a) => a.id).sort()).toEqual([flunky, elf].sort());
    const t = answer(toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Flunky', 'Test Elf'] }, defs: [FLUNKY, ELF] })), attackAnswer([elf]));
    expect(t.combat!.attackers.length).toBe(1);
  });
  it('blocking alone is refused; blocking together with another creature is allowed', () => {
    const base = scenario([], { p1: { battlefield: [{ name: 'Test Ogre' }] }, p2: { battlefield: ['Test Flunky', 'Test Elf'] }, defs: [FLUNKY, ELF, card('Test Ogre', 'Creature — Ogre', '', ['2', '2'])] });
    const ogre = find(base, 'Test Ogre', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(base), [[ogre]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const flunky = find(s, 'Test Flunky', 'battlefield');
    const elf = find(s, 'Test Elf', 'battlefield');
    const d = s.pending;
    if (d?.kind !== 'declareBlockers') throw new Error('no declareBlockers');
    expect(d.candidates.find((c) => c.id === flunky)!.onlyWithOthers).toBe(true);
    const err = reject(s, { type: 'answer', player: 'p2', decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: flunky, attacker: ogre }] } });
    expect(err.message).toMatch(/alone/);
    s = declareBlockers(s, [[flunky, ogre], [elf, ogre]]);
    expect(s.combat!.attackers[0]!.blockedBy.sort()).toEqual([flunky, elf].sort());
  });
});

describe('CR 105.1: "~ gets -2/-2 as long as white is the most common color among all permanents or is tied for most common"', () => {
  const colored = (name: string, cost: string, colors: string[]): CardDef =>
    compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Creature — Test', oracle_text: '', colors, power: '1', toughness: '1' } as OracleCard);
  const DJINN = compileCard({ name: 'Test Djinn', layout: 'normal', mana_cost: '{5}{W}', type_line: 'Creature — Djinn', oracle_text: 'Test Djinn gets -2/-2 as long as white is the most common color among all permanents or is tied for most common.', colors: ['W'], power: '5', toughness: '5' } as OracleCard);
  const RED = colored('Test Red', '{R}', ['R']);
  const BOROS = colored('Test Boros', '{R}{W}', ['R', 'W']);
  const GREY = colored('Test Grey', '{1}', []);
  const size = (s: GameState): string => { const c = getChars(s, find(s, 'Test Djinn', 'battlefield'))!; return `${c.power}/${c.toughness}`; };
  it('the card is full', () => expect(DJINN.automation.level).toBe('full'));
  it('white is the most common color (the Djinn is white itself): -2/-2', () => {
    const s = scenario([], { p1: { battlefield: ['Test Djinn'] }, defs: [DJINN] });
    expect(size(s)).toBe('3/3');
  });
  it('tied with red (any controller): still -2/-2', () => {
    const s = scenario([], { p1: { battlefield: ['Test Djinn'] }, p2: { battlefield: ['Test Red'] }, defs: [DJINN, RED] });
    expect(size(s)).toBe('3/3');
  });
  it('red has more permanents than white: no penalty', () => {
    const s = scenario([], { p1: { battlefield: ['Test Djinn', 'Test Red'] }, p2: { battlefield: ['Test Red'] }, defs: [DJINN, RED] });
    expect(size(s)).toBe('5/5');
  });
  it('a red-and-white permanent counts for both colors (white 2, red 2: tied) and colorless permanents count for no color', () => {
    const s = scenario([], { p1: { battlefield: ['Test Djinn', 'Test Boros', 'Test Red'] }, p2: { battlefield: ['Test Grey', 'Test Grey', 'Test Grey'] }, defs: [DJINN, RED, BOROS, GREY] });
    expect(size(s)).toBe('3/3');
    const t = scenario([], { p1: { battlefield: ['Test Djinn', 'Test Boros', 'Test Red', 'Test Red'] }, defs: [DJINN, RED, BOROS] });
    expect(size(t)).toBe('5/5'); // white 2, red 3
  });
});

describe('CR 702.29d: "When you cycle ~, put a flying counter on target creature you control"', () => {
  const ODDITY = card('Test Oddity', 'Creature — Bird', 'Flying\nCycling {1}\nWhen you cycle Test Oddity, put a flying counter on target creature you control.', ['2', '4'], '{3}{U}');
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  const cycleIt = (s: GameState): GameState => {
    const id = find(s, 'Test Oddity', 'hand', 'p1');
    const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
    if (!la) throw new Error('no cycling');
    return settle(act(s, la.action), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Elf', 'battlefield') }] }]);
  };
  it('the card is automated', () => expect(automated(ODDITY)).toBe(true));
  it('cycling it triggers from the graveyard and the counter goes on the target', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Oddity'], battlefield: ['Island', 'Test Elf'] }, defs: [ODDITY, ELF] });
    const elf = find(s0, 'Test Elf', 'battlefield');
    let s = cycleIt(s0);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Oddity')).toBe(true);
    expect(s.zones.stack.length).toBe(2); // the cycling ability and the trigger
    s = resolve(resolve(s));
    expect(ctr(s, elf, 'flying')).toBe(1);
  });
  it('typecycling is cycling too (CR 702.29e): "whenever you cycle a card" sees it,', () => {
    const WATCHER = card('Test Watcher', 'Enchantment', 'Whenever you cycle a card, you gain 1 life.');
    const FETCH = card('Test Fetch', 'Creature — Bird', 'Plainscycling {1}', ['1', '1'], '{2}{U}');
    const s0 = scenario(['Island'], { p1: { hand: ['Test Fetch'], battlefield: ['Island', 'Test Watcher'] }, defs: [WATCHER, FETCH] });
    expect(automated(WATCHER)).toBe(true);
    const id = find(s0, 'Test Fetch', 'hand', 'p1');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
    if (!la) throw new Error('no typecycling');
    const s = settle(act(s0, la.action));
    expect(s.zones.stack.length).toBe(2); // the typecycling ability and the watcher's trigger
  });
});
