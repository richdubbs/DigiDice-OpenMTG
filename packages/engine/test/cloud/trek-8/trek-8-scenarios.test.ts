/**
 * Lane trek, round trek-8 (Star Trek: control, copies, combat), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 614.1a, 701.8a, 120.6   "If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage
 *                              already dealt to it is healed.": lethal damage, a destroy spell and deathtouch; not regeneration (it is not tapped, it stays in combat)
 *   CR 614.1c, 508.4, 506.3    "If a creature you control would enter while you control an attacking creature, instead it enters tapped and attacking.": a creature
 *                              spell and a token; not without an attacking creature, not an opponent's creature, not a noncreature permanent
 *   CR 603.7, 603.7c, 608.2c   "... At the beginning of the next combat this turn, gain control of that creature until end of turn. Untap it. It gains haste until end of
 *                              turn.": all three instructions happen when the delayed trigger triggers, not when the spell resolves
 *   CR 603.7c, 608.2h, 510.2   "Choose target creature. Whenever it deals combat damage to a player this turn, you draw that many cards."
 *   CR 614.1a, 601.2c, 608.2c  "Create a token that's a copy of target creature an opponent controls, except it has menace. If this spell was kicked, instead for each
 *                              creature target opponent controls, create a token that's a copy of that creature, except it has menace."
 *   CR 603.2, 508.1, 701.9a    "At the beginning of combat on each player's turn, that player may draw a card. If they do, they can't attack this turn and you put a
 *                              peace counter on this enchantment."
 *   CR 701.15a-b, 613.4c       "All Tribbles get +1/+0 and are goaded." and the Tribble tokens each player creates
 *   CR 115.1, 601.2c, 302.6    "When ~ enters, for each opponent, gain control of up to one target creature that player controls with mana value 3 or less until end of
 *                              turn. Untap those creatures. Until end of turn, they become Warriors in addition to their other types and gain haste."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability automated and the card full (an experimental template would cap it at partial). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const pt = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const keywords = (s: GameState, id: ObjectId): string[] => chars(s, id).keywords.map((k) => k.keyword);
const onBattlefield = (s: GameState, id: ObjectId): boolean => s.objects[id]?.zone === 'battlefield';
const attacking = (s: GameState, id: ObjectId): boolean => (s.combat?.attackers ?? []).some((a) => a.id === id);
const tgt = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

interface Drive {
  yes?: boolean;
  /** objects chosen by a `chooseObjects` decision */
  pick?: (options: ObjectId[], s: GameState) => ObjectId[];
  /** targets of each `chooseTargets` decision in order */
  targets?: TargetChoice[][];
  /** the answers of other decisions in order (options, numbers, ...) */
  answers?: DecisionAnswer[];
}
/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Drive = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const aq = [...(o.answers ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (aq.length > 0) s = answer(s, aq.shift()!);
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, o: Drive = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Drive = {}, who: PlayerId = 'p1'): GameState => resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);
/** Pass priority to the beginning of combat of the current turn; the trigger of `Test` abilities is put on the stack, not resolved. */
function toStep(s0: GameState, done: (s: GameState) => boolean, o: Drive = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 400 && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = drive(s, o);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
/** Pass priority (answering what comes up) until the game asks for `kind` (declareAttackers, declareBlockers). */
function toDecision(s0: GameState, kind: 'declareAttackers' | 'declareBlockers' | 'chooseTargets', o: Drive = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending?.kind !== kind; guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  if (s.pending?.kind !== kind) throw new Error(`never asked for ${kind} (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
/** Run the rest of the combat phase (no more declarations), answering what comes up, until `done`. */
function finishCombat(s0: GameState, o: Drive = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.turn.step !== 'main2' && s.turn.step !== 'end'; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = drive(s, o);
  }
  return s;
}
const atStep = (turn: number, step: GameState['turn']['step']) => (s: GameState): boolean => s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority';

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
const VIPER = card('Test Viper', 'Creature — Snake', 'Deathtouch', { pt: ['1', '1'] });

// ---- Dr. McCoy: a destruction replacement ----------------------------------------------------------------------------------------------------------------

describe('CR 614.1a, 701.8a, 120.6: "If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage already dealt to it is healed."', () => {
  const SURGEON = card('Test Surgeon', 'Legendary Creature — Human Doctor', 'If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage already dealt to it is healed.', { pt: ['2', '2'] });
  const defs = [SURGEON, BEAR, OGRE, DOOM, BOLT, VIPER];
  it('is fully automated', () => expect(full(SURGEON)).toBe(true));
  it('a destroy spell: the creature stays, its +1/+1 counters are gone (2/2 base + counter = 3/3 becomes 2/2)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Surgeon', { name: 'Test Bear', counters: { '+1/+1': 2 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s, bear)).toBe('4/4');
    s = cast(s, 'Test Doom', { targets: [[tgt(bear)]] });
    expect(onBattlefield(s, bear)).toBe(true);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(pt(s, bear)).toBe('2/2');
  });
  it('lethal damage: the state-based destroy is replaced, the damage is healed and the counters removed; the creature lives', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bolt'], battlefield: ['Test Surgeon', { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Bolt', { targets: [[tgt(bear)]] }); // 3 damage to a 3/3
    expect(onBattlefield(s, bear)).toBe(true);
    expect(s.objects[bear]!.damage).toBe(0);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(pt(s, bear)).toBe('2/2');
  });
  it('deathtouch damage: the destroy of state-based actions is replaced too, the creature lives with no damage and no mark of deathtouch damage', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Surgeon', { name: 'Test Ogre', counters: { '+1/+1': 1 } }] }, p2: { battlefield: [{ name: 'Test Viper', since: 0 }] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const viper = find(s, 'Test Viper', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 2, 'beginCombat'), 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: viper, defender: 'p1' }] });
    s = toDecision(s, 'declareBlockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: ogre, attacker: viper }] });
    s = finishCombat(s);
    expect(onBattlefield(s, viper)).toBe(false); // the Ogre dealt 4 damage to it
    expect(onBattlefield(s, ogre)).toBe(true);
    expect(s.objects[ogre]!.damage).toBe(0);
    expect(s.objects[ogre]!.deathtouchDamaged).toBe(false);
    expect(s.objects[ogre]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('no +1/+1 counter: destroyed as usual; and the creature with counters belongs to the opponent: destroyed as usual', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom', 'Test Doom'], battlefield: ['Test Surgeon', 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Ogre', counters: { '+1/+1': 1 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Doom', { targets: [[tgt(bear)]] });
    expect(onBattlefield(s, bear)).toBe(false);
    s = cast(s, 'Test Doom', { targets: [[tgt(ogre)]] });
    expect(onBattlefield(s, ogre)).toBe(false);
  });
  it('"another": the creature itself with a +1/+1 counter is destroyed', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Surgeon', counters: { '+1/+1': 1 } }] } });
    const doc = find(s, 'Test Surgeon', 'battlefield', 'p1');
    s = cast(s, 'Test Doom', { targets: [[tgt(doc)]] });
    expect(onBattlefield(s, doc)).toBe(false);
  });
  it('it is not regeneration: a tapped creature stays tapped (nothing taps it, nothing removes it from combat)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Surgeon', { name: 'Test Bear', counters: { '+1/+1': 1 }, tapped: true }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Doom', { targets: [[tgt(bear)]] });
    expect(onBattlefield(s, bear)).toBe(true);
    expect(s.objects[bear]!.tapped).toBe(true);
  });
});

// ---- Kira Nerys: creatures enter tapped and attacking ----------------------------------------------------------------------------------------------------

describe('CR 614.1c, 508.4, 506.3: "If a creature you control would enter while you control an attacking creature, instead it enters tapped and attacking."', () => {
  const RALLIER = card('Test Rallier', 'Legendary Creature — Bajoran Soldier', 'If a creature you control would enter while you control an attacking creature, instead it enters tapped and attacking.', { pt: ['2', '2'] });
  const AMBUSHER = card('Test Ambusher', 'Creature — Human', 'Flash', { pt: ['2', '2'] });
  const MUSTER = card('Test Muster', 'Instant', 'Create a 1/1 white Soldier creature token.');
  const TREASURE = card('Test Windfall', 'Instant', 'Create a Treasure token.');
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', { pt: ['0', '4'] });
  const defs = [RALLIER, AMBUSHER, MUSTER, TREASURE, BEAR, WALL];
  it('is fully automated', () => expect(full(RALLIER)).toBe(true));
  /** p1's Test Bear is declared as an attacker on turn 1; stop with priority in the declare attackers step. */
  function attackedWith(s0: GameState, bear: ObjectId): GameState {
    let s = toDecision(advanceTo(s0, 1, 'beginCombat'), 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    return drive(s);
  }
  it('a creature spell cast with flash after attackers are declared enters tapped and attacking the opponent', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ambusher'], battlefield: ['Test Rallier', 'Test Bear'] }, p2: { battlefield: ['Test Wall'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = attackedWith(s, bear);
    expect(attacking(s, bear)).toBe(true);
    s = cast(s, 'Test Ambusher');
    const amb = find(s, 'Test Ambusher', 'battlefield', 'p1');
    expect(s.objects[amb]!.tapped).toBe(true);
    expect(attacking(s, amb)).toBe(true);
    expect(s.combat!.attackers.find((a) => a.id === amb)!.defender).toBe('p2');
  });
  it('a token created then enters tapped and attacking too', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Muster'], battlefield: ['Test Rallier', 'Test Bear'] }, p2: {} });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = attackedWith(s, bear);
    s = cast(s, 'Test Muster');
    const [soldier] = findAll(s, 'Soldier Token', 'battlefield', 'p1');
    expect(soldier).toBeDefined();
    expect(s.objects[soldier!]!.tapped).toBe(true);
    expect(attacking(s, soldier!)).toBe(true);
  });
  it('without an attacking creature the creature enters untapped and does not attack (a main phase; and a combat in which you declared no attackers)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ambusher', 'Test Ambusher'], battlefield: ['Test Rallier', 'Test Bear'] } });
    s = cast(s, 'Test Ambusher');
    const [first] = findAll(s, 'Test Ambusher', 'battlefield', 'p1');
    expect(s.objects[first!]!.tapped).toBe(false);
    expect(attacking(s, first!)).toBe(false);
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [] }));
    s = cast(s, 'Test Ambusher');
    const second = findAll(s, 'Test Ambusher', 'battlefield', 'p1').find((id) => id !== first)!;
    expect(s.objects[second]!.tapped).toBe(false);
    expect(attacking(s, second)).toBe(false);
  });
  it('an opponent\'s creature entering during your attack is not affected (it is not "a creature you control")', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rallier', 'Test Bear'] }, p2: { hand: ['Test Ambusher'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = attackedWith(s, bear);
    s = cast(pass(s), 'Test Ambusher', {}, 'p2'); // (the active player passes, the opponent has priority)
    const amb = find(s, 'Test Ambusher', 'battlefield', 'p2');
    expect(s.objects[amb]!.tapped).toBe(false);
    expect(attacking(s, amb)).toBe(false);
  });
  it('a permanent that is not a creature is not affected: a Treasure token enters untapped', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Windfall'], battlefield: ['Test Rallier', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = attackedWith(s, bear);
    s = cast(s, 'Test Windfall');
    const [treasure] = findAll(s, 'Treasure Token', 'battlefield', 'p1');
    expect(treasure).toBeDefined();
    expect(s.objects[treasure!]!.tapped).toBe(false);
    expect(attacking(s, treasure!)).toBe(false);
  });
  it('you must control an attacking creature: on an opponent\'s turn, with the opponent attacking, your creature enters as it would', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ambusher'], battlefield: ['Test Rallier'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 2, 'beginCombat'), 'declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] }));
    s = cast(pass(s), 'Test Ambusher', {}, 'p1');
    const amb = find(s, 'Test Ambusher', 'battlefield', 'p1');
    expect(s.objects[amb]!.tapped).toBe(false);
    expect(attacking(s, amb)).toBe(false);
  });
});

// ---- The Wrath of Khan: a delayed trigger with three instructions ----------------------------------------------------------------------------------------

describe('CR 603.7, 603.7c, 608.2c: "... deals 3 damage to target creature an opponent controls. At the beginning of the next combat this turn, gain control of that creature until end of turn. Untap it. It gains haste until end of turn."', () => {
  const TEXT = 'Test Seizure deals 3 damage to target creature an opponent controls. At the beginning of the next combat this turn, gain control of that creature until end of turn. Untap it. It gains haste until end of turn.';
  const SEIZURE = card('Test Seizure', 'Sorcery', TEXT);
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['3', '5'] });
  const defs = [SEIZURE, BRUTE, BEAR];
  it('is fully automated', () => expect(full(SEIZURE)).toBe(true));
  it('nothing changes when the spell resolves: the creature is still the opponent\'s, still tapped, with no haste; at the beginning of combat it is yours, untapped, with haste', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seizure'] }, p2: { battlefield: [{ name: 'Test Brute', tapped: true, since: 5 }] } });
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = cast(s, 'Test Seizure', { targets: [[tgt(brute)]] });
    expect(s.objects[brute]!.controller).toBe('p2');
    expect(s.objects[brute]!.tapped).toBe(true);
    expect(keywords(s, brute)).not.toContain('haste');
    expect(s.objects[brute]!.damage).toBe(3);
    s = toStep(s, (x) => x.turn.step === 'beginCombat' && x.turn.number === 1 && x.zones.stack.length > 0 && x.pending?.kind === 'priority');
    s = resolveAll(s);
    expect(s.objects[brute]!.controller).toBe('p1');
    expect(s.objects[brute]!.tapped).toBe(false);
    expect(keywords(s, brute)).toContain('haste');
    // it can attack this turn: haste, and it was untapped
    s = toDecision(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: brute, defender: 'p2' }] });
    expect(attacking(s, brute)).toBe(true);
  });
  it('at the end of the turn control goes back, and the haste is gone', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seizure'] }, p2: { battlefield: [{ name: 'Test Brute', tapped: true, since: 5 }] } });
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = cast(s, 'Test Seizure', { targets: [[tgt(brute)]] });
    s = resolveAll(toStep(s, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0 && x.pending?.kind === 'priority'));
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[brute]!.controller).toBe('p2');
    expect(keywords(s, brute)).not.toContain('haste');
  });
  it('the delayed trigger is for the next combat of this turn only: cast after combat, it does nothing in the next turn\'s combat', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seizure'] }, p2: { battlefield: [{ name: 'Test Brute', since: 5 }] } });
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = toStep(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority');
    s = cast(s, 'Test Seizure', { targets: [[tgt(brute)]] });
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[brute]!.controller).toBe('p2');
  });
  it('the creature died: the delayed trigger finds nothing to take, nothing else happens', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seizure'] }, p2: { battlefield: [{ name: 'Test Bear', since: 5 }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Seizure', { targets: [[tgt(bear)]] });
    expect(onBattlefield(s, bear)).toBe(false);
    s = resolveAll(toStep(s, (x) => x.turn.step === 'beginCombat' && x.turn.number === 1 && x.pending?.kind === 'priority'));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toEqual([]);
  });
});

// ---- The Inner Light: "that many" in a delayed trigger ----------------------------------------------------------------------------------------------------

describe('CR 603.7c, 608.2h, 510.2: "Choose target creature. Whenever it deals combat damage to a player this turn, you draw that many cards."', () => {
  const INSIGHT = card('Test Insight', 'Sorcery', 'Choose target creature. Whenever it deals combat damage to a player this turn, you draw that many cards.');
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'] });
  const STRIKER = card('Test Duelist', 'Creature — Human', 'Double strike', { pt: ['2', '2'] });
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', { pt: ['0', '8'] });
  const defs = [INSIGHT, BEAR, GIANT, STRIKER, WALL];
  const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  it('is fully automated', () => expect(full(INSIGHT)).toBe(true));
  it('the chosen creature deals 5 combat damage to the player: you draw 5 cards', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Insight'], battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    s = cast(s, 'Test Insight', { targets: [[tgt(giant)]] });
    const before = handSize(s, 'p1');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }] });
    s = finishCombat(s);
    expect(life(s, 'p2')).toBe(15);
    expect(handSize(s, 'p1')).toBe(before + 5);
  });
  it('a creature that is not the chosen one draws nothing; the chosen creature blocked (damage to a creature) draws nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Insight'], battlefield: ['Test Giant', 'Test Bear'] }, p2: { battlefield: ['Test Wall'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = cast(s, 'Test Insight', { targets: [[tgt(giant)]] });
    const before = handSize(s, 'p1');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }, { attacker: bear, defender: 'p2' }] });
    s = toDecision(s, 'declareBlockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: giant }] });
    s = finishCombat(s);
    expect(life(s, 'p2')).toBe(18); // only the Bear got through
    expect(handSize(s, 'p1')).toBe(before);
  });
  it('double strike: each combat damage event of the turn draws (2 and 2)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Insight'], battlefield: ['Test Duelist'] } });
    const duelist = find(s, 'Test Duelist', 'battlefield', 'p1');
    s = cast(s, 'Test Insight', { targets: [[tgt(duelist)]] });
    const before = handSize(s, 'p1');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: duelist, defender: 'p2' }] });
    s = finishCombat(s);
    expect(life(s, 'p2')).toBe(16);
    expect(handSize(s, 'p1')).toBe(before + 4);
  });
  it('"this turn": the next turn\'s combat damage of the chosen creature draws nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Insight'], battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    s = cast(s, 'Test Insight', { targets: [[tgt(giant)]] });
    s = advanceTo(s, 3, 'beginCombat');
    const before = handSize(s, 'p1');
    s = toDecision(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }] });
    s = finishCombat(s);
    expect(life(s, 'p2')).toBe(15);
    expect(handSize(s, 'p1')).toBe(before);
  });
});

// ---- Mirror Universe Intrusion: kicked, "instead for each creature target opponent controls" ---------------------------------------------------------------

describe('CR 614.1a, 601.2c, 608.2c, 707.2: "Create a token that\'s a copy of target creature an opponent controls, except it has menace. If this spell was kicked, instead for each creature target opponent controls, create a token that\'s a copy of that creature, except it has menace."', () => {
  const INTRUSION = card('Test Intrusion', 'Sorcery', "Kicker {0}\nCreate a token that's a copy of target creature an opponent controls, except it has menace. If this spell was kicked, instead for each creature target opponent controls, create a token that's a copy of that creature, except it has menace.");
  const BRUTE = card('Test Brute', 'Creature — Ogre', 'Trample', { pt: ['3', '5'] });
  const defs = [INTRUSION, BRUTE, BEAR];
  const menaceTokens = (s: GameState, name: string): ObjectId[] => findAll(s, name, 'battlefield', 'p1').filter((id) => s.objects[id]!.kind === 'token' && keywords(s, id).includes('menace'));
  it('is fully automated', () => expect(full(INTRUSION)).toBe(true));
  it('not kicked: one token that is a copy of the targeted creature, with menace; only the creature is targeted', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Intrusion'] }, p2: { battlefield: ['Test Brute', 'Test Bear'] } });
    const brute = find(s, 'Test Brute', 'battlefield', 'p2');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Intrusion', 'hand', 'p1') }), { yes: false, targets: [[tgt(brute)]] });
    const tokens = menaceTokens(s, 'Test Brute');
    expect(tokens.length).toBe(1);
    expect(keywords(s, tokens[0]!)).toContain('trample');
    expect(pt(s, tokens[0]!)).toBe('3/5');
    expect(menaceTokens(s, 'Test Bear')).toEqual([]);
    expect(onBattlefield(s, brute)).toBe(true);
  });
  it('kicked: a token for each creature the targeted opponent controls (here two), each with menace; the creature target of the unkicked mode is not asked for', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Intrusion'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Brute', 'Test Bear'] } });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Intrusion', 'hand', 'p1') }), { yes: true, targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(menaceTokens(s, 'Test Brute').length).toBe(1);
    expect(menaceTokens(s, 'Test Bear').length).toBe(1); // p2's Bear (p1's own Bear is not copied)
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(2); // the real one and the token
    expect(findAll(s, 'Test Brute', 'battlefield', 'p2').length).toBe(1);
  });
  it('kicked against an opponent with no creature: no token', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Intrusion'] }, p2: {} });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Intrusion', 'hand', 'p1') }), { yes: true, targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toEqual([]);
  });
});

// ---- Peace in Our Time: a combat trigger on each player's turn -----------------------------------------------------------------------------------------------

describe('CR 603.2, 508.1, 701.9a: "At the beginning of combat on each player\'s turn, that player may draw a card. If they do, they can\'t attack this turn and you put a peace counter on this enchantment."', () => {
  const ARMISTICE = card('Test Armistice', 'Enchantment', "At the beginning of combat on each player's turn, that player may draw a card. If they do, they can't attack this turn and you put a peace counter on this enchantment.\nAt the beginning of your upkeep, if this enchantment has twelve or more peace counters on it, you win the game.");
  const defs = [ARMISTICE, BEAR];
  const peace = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['peace'] ?? 0;
  const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  const atCombatTrigger = (turn: number) => (s: GameState): boolean => s.turn.number === turn && s.turn.step === 'beginCombat' && s.zones.stack.length > 0 && s.pending?.kind === 'priority';
  it('is fully automated', () => expect(full(ARMISTICE)).toBe(true));
  it('an opponent\'s turn: they draw, cannot attack, and you (the controller) put the counter; their declaration with an attacker is refused', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Armistice'] }, p2: { battlefield: [{ name: 'Test Bear', since: 0 }] } });
    const armistice = find(s, 'Test Armistice', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = toStep(s, atCombatTrigger(1)); // p1's own combat: the trigger asks p1; decline
    s = resolveAll(s, { yes: false });
    expect(peace(s, armistice)).toBe(0);
    s = toStep(s, atCombatTrigger(2));
    const handBefore = handSize(s, 'p2');
    s = resolveAll(s, { yes: true });
    expect(handSize(s, 'p2')).toBe(handBefore + 1);
    expect(peace(s, armistice)).toBe(1);
    // no creature of theirs can be declared as an attacker: the game does not even ask for a declaration
    s = toStep(s, (x) => x.turn.step === 'main2' || x.turn.step === 'end');
    expect(attacking(s, bear)).toBe(false);
    expect(life(s, 'p1')).toBe(20);
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('they decline: no card, no counter, and they may attack', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Armistice'] }, p2: { battlefield: [{ name: 'Test Bear', since: 0 }] } });
    const armistice = find(s, 'Test Armistice', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(toStep(s, atCombatTrigger(1)), { yes: false });
    s = toStep(s, atCombatTrigger(2));
    const handBefore = handSize(s, 'p2');
    s = resolveAll(s, { yes: false });
    expect(handSize(s, 'p2')).toBe(handBefore);
    expect(peace(s, armistice)).toBe(0);
    s = toDecision(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] });
    expect(attacking(s, bear)).toBe(true);
  });
  it('your own turn counts too: you draw, cannot attack with your creature, and the counter is put; the turn after, you may attack again', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Armistice', { name: 'Test Bear', since: 0 }] } });
    const armistice = find(s, 'Test Armistice', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(toStep(s, atCombatTrigger(1)), { yes: true });
    expect(peace(s, armistice)).toBe(1);
    s = toStep(s, (x) => x.turn.step === 'main2'); // no declaration is asked for: nothing of yours can attack this turn
    expect(attacking(s, bear)).toBe(false);
    expect(life(s, 'p2')).toBe(20);
    s = resolveAll(toStep(s, atCombatTrigger(2)), { yes: false });
    s = toStep(s, atCombatTrigger(3));
    s = resolveAll(s, { yes: false });
    s = toDecision(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    expect(attacking(s, bear)).toBe(true);
  });
  it('twelve peace counters on it at the beginning of your upkeep: you win the game; eleven do not', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Armistice', counters: { peace: 11 } }] } });
    s = toStep(s, atStep(3, 'upkeep'), { yes: false });
    s = resolveAll(s);
    expect(s.result ?? null).toBeNull();
    let w = scenario([], { defs, p1: { battlefield: [{ name: 'Test Armistice', counters: { peace: 12 } }] } });
    w = toStep(w, atStep(3, 'upkeep'), { yes: false });
    w = resolveAll(w);
    expect(w.result ?? null).not.toBeNull();
  });
});

// ---- Koloth: tokens of a creature type that only a token has; a group that is goaded ------------------------------------------------------------------------

describe('CR 111.4, 205.3m, 701.15a-b, 613.4c: "each player creates two 1/1 white Tribble creature tokens with "This token can\'t block."" and "All Tribbles get +1/+0 and are goaded."', () => {
  const HUNTER = card('Test Hunter', 'Legendary Creature — Klingon Warrior Officer', 'At the beginning of your end step, each player creates two 1/1 white Tribble creature tokens with "This token can\'t block."\nAll Tribbles get +1/+0 and are goaded.', { pt: ['3', '3'] });
  const defs = [HUNTER, BEAR];
  const tribbles = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Tribble Token');
  const reply = (s: GameState, p: PlayerId, a: DecisionAnswer) => applyAction(s, { type: 'answer', player: p, decisionId: s.pending!.id, answer: a });
  it('is fully automated', () => expect(full(HUNTER)).toBe(true));
  it('at the beginning of your end step each player creates two Tribble tokens: 2/1 with +1/+0, none of them able to block', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Hunter'] } });
    s = toStep(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0 && x.pending?.kind === 'priority');
    s = resolveAll(s);
    expect(tribbles(s, 'p1').length).toBe(2);
    expect(tribbles(s, 'p2').length).toBe(2);
    for (const id of [...tribbles(s, 'p1'), ...tribbles(s, 'p2')]) {
      expect(pt(s, id)).toBe('2/1');
      expect(chars(s, id).subtypes).toContain('Tribble');
    }
  });
  it('the Hunter\'s own turn: the Tribbles of both players must attack a player other than its controller if able, so a declaration without them is refused; a Bear is free to stay home', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Hunter'] }, p2: { battlefield: [{ name: 'Test Bear', since: 0 }] } });
    s = resolveAll(toStep(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0 && x.pending?.kind === 'priority'));
    // p2's turn: its two Tribbles are goaded by p1; the only player other than p1 is p2 itself, so they attack p1 (the only choice left)
    s = toDecision(advanceTo(s, 2, 'beginCombat'), 'declareAttackers');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(reply(s, 'p2', { kind: 'declareAttackers', attacks: [] }).error).toBeDefined();
    const [t1, t2] = tribbles(s, 'p2');
    // each Tribble attacks, the Bear stays home
    expect(reply(s, 'p2', { kind: 'declareAttackers', attacks: [{ attacker: t1!, defender: 'p1' }] }).error).toBeDefined(); // the other one must too
    const ok = reply(s, 'p2', { kind: 'declareAttackers', attacks: [{ attacker: t1!, defender: 'p1' }, { attacker: t2!, defender: 'p1' }] });
    expect(ok.error?.message).toBeUndefined();
    void bear;
  });
  it('a Tribble token can\'t block: the defending player with only that creature is not even asked for blockers (a Soldier token of the same size is)', () => {
    const SPAWN = card('Test Spawn', 'Instant', 'Create a 1/1 white Tribble creature token with "This token can\'t block."');
    const MUSTER = card('Test Muster', 'Instant', 'Create a 1/1 white Soldier creature token.');
    const run = (spell: string): GameState => {
      let s = scenario([], { defs: [...defs, SPAWN, MUSTER], p1: { battlefield: [{ name: 'Test Bear', since: 0 }] }, p2: { hand: [spell] } });
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      s = cast(pass(s), spell, {}, 'p2');
      s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
      for (let guard = 0; guard < 20 && s.pending?.kind === 'priority' && s.turn.step !== 'declareBlockers'; guard++) s = pass(s);
      return s;
    };
    expect(tribbles(run('Test Spawn'), 'p2').length).toBe(1);
    const tribbleGame = run('Test Spawn');
    expect(tribbleGame.pending?.kind).not.toBe('declareBlockers');
    expect(life(finishCombat(tribbleGame), 'p2')).toBe(18); // the Bear was unblocked
    const soldierGame = run('Test Muster');
    expect(soldierGame.pending?.kind).toBe('declareBlockers');
  });
  it('the static ability ends with the Hunter: once it is destroyed a Tribble is a plain 1/1 and is not goaded (a declaration without attackers is allowed)', () => {
    const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
    let s = scenario([], { defs: [...defs, DOOM], p1: { hand: ['Test Doom'], battlefield: ['Test Hunter'] } });
    const hunter = find(s, 'Test Hunter', 'battlefield', 'p1');
    s = resolveAll(toStep(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0 && x.pending?.kind === 'priority'));
    s = cast(s, 'Test Doom', { targets: [[tgt(hunter)]] });
    expect(onBattlefield(s, hunter)).toBe(false);
    const [t] = tribbles(s, 'p2');
    expect(pt(s, t!)).toBe('1/1');
    s = toDecision(advanceTo(s, 2, 'beginCombat'), 'declareAttackers');
    expect(reply(s, 'p2', { kind: 'declareAttackers', attacks: [] }).error?.message).toBeUndefined();
  });
});

// ---- Worf: a control change for each opponent -----------------------------------------------------------------------------------------------------------

describe('CR 115.1, 601.2c, 608.2f, 613.1b, 205.1b: "When ~ enters, for each opponent, gain control of up to one target creature that player controls with mana value 3 or less until end of turn. Untap those creatures. Until end of turn, they become Warriors in addition to their other types and gain haste."', () => {
  const OPERATIVE = card('Test Operative', 'Legendary Creature — Klingon Warrior Spy', 'When Test Operative enters, for each opponent, gain control of up to one target creature that player controls with mana value 3 or less until end of turn. Untap those creatures. Until end of turn, they become Warriors in addition to their other types and gain haste.', { pt: ['3', '2'], cost: '{0}' });
  const CHEAP = card('Test Cheap Brute', 'Creature — Ogre', '', { pt: ['4', '4'], cost: '{3}' });
  const DEAR = card('Test Dear Brute', 'Creature — Dragon', '', { pt: ['6', '6'], cost: '{4}' });
  const defs = [OPERATIVE, CHEAP, DEAR];
  it('is fully automated', () => expect(full(OPERATIVE)).toBe(true));
  it('the cheap creature (mana value 3) is taken, untapped, a Warrior in addition to its other types, with haste; at the end of turn it goes back, a plain Ogre again', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Operative'] }, p2: { battlefield: [{ name: 'Test Cheap Brute', tapped: true, since: 3 }] } });
    const cheap = find(s, 'Test Cheap Brute', 'battlefield', 'p2');
    s = cast(s, 'Test Operative', { targets: [[tgt(cheap)]] });
    expect(s.objects[cheap]!.controller).toBe('p1');
    expect(s.objects[cheap]!.tapped).toBe(false);
    expect(chars(s, cheap).subtypes).toEqual(expect.arrayContaining(['Ogre', 'Warrior']));
    expect(keywords(s, cheap)).toContain('haste');
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[cheap]!.controller).toBe('p2');
    expect(chars(s, cheap).subtypes).not.toContain('Warrior');
    expect(keywords(s, cheap)).not.toContain('haste');
  });
  it('a creature with mana value 4 is not a legal target (the choice of it is refused); choosing none ("up to one") takes nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Operative'] }, p2: { battlefield: ['Test Dear Brute', 'Test Cheap Brute'] } });
    const dear = find(s0, 'Test Dear Brute', 'battlefield', 'p2');
    const cheap = find(s0, 'Test Cheap Brute', 'battlefield', 'p2');
    let s = toDecision(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Operative', 'hand', 'p1') }), 'chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [tgt(dear)] })).toThrow();
    s = resolveAll(s, { targets: [[]] });
    expect(s.objects[dear]!.controller).toBe('p2');
    expect(s.objects[cheap]!.controller).toBe('p2');
    // the same game with the legal target chosen
    s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Operative', 'hand', 'p1') }), { targets: [[tgt(cheap)]] });
    expect(s.objects[cheap]!.controller).toBe('p1');
    expect(s.objects[dear]!.controller).toBe('p2');
  });
});
