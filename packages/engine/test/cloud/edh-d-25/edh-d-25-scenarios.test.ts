/**
 * Coordinator D, round edh-d-25 (lane combat): the round's readings and engine changes played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are
 * from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 302.6, 508.1a, 609.4          "Enchanted creature can attack as though it had haste." (Instill Energy)
 *   CR 510.1b-c, 604.1, 611.3a       "As long as ~ is attacking, for each creature you control, you may have that creature assign its combat damage as though it weren't blocked." (Siege Behemoth)
 *   CR 510.1b-c, 611.2a              "You may have creatures you control assign their combat damage this turn as though they weren't blocked." (Predatory Focus)
 *   CR 510.1b-c, 509.1h, 611.2a      "Two target blocked creatures assign their combat damage this turn as though they weren't blocked." (Outmaneuver): no choice, they stay blocked
 *   CR 509.1a, 609.4                 "Tapped creatures you control can block as though they were untapped." (Masako the Humorless)
 *   CR 509.1c, 604.1, 611.3a         "As long as equipped creature is attacking, it has first strike and must be blocked by a Dalek if able." (Ace's Baseball Bat)
 *   CR 509.1b, 508.1b-c, 604.1       "Survivors your opponents control can't block, and they can't attack you or planeswalkers you control." (Varchild, Betrayer of Kjeldor)
 *   CR 510.1a, 611.2a                "Until end of turn, target creature you control assigns combat damage equal to its toughness rather than its power." (Bill the Pony)
 *   CR 509.3a, 509.3c, 603.2         "Whenever a creature with deathtouch blocks or becomes blocked by this creature, destroy that creature." (Mirror Shield)
 *   CR 509.3a, 509.3c, 608.2c        "Whenever equipped creature blocks or becomes blocked by a creature, that creature loses all abilities until end of turn." (Barrow-Blade)
 *   CR 508.1d, 611.2a                "Until your next turn, creatures your opponents control attack each combat if able." (The Akroan War)
 */
import { describe, expect, it } from 'vitest';
import { attackDenial, blockDenial, compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const mine = (s: GameState, name: string, p: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && s.objects[id]!.controller === p);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5']);
const DALEK = card('Test Dalek', 'Creature — Dalek', '', ['1', '1']);
const VIPER = card('Test Viper', 'Creature — Snake', 'Deathtouch', ['1', '1']);
const SURVIVOR = card('Test Survivor', 'Creature — Survivor', '', ['2', '2']);
const OPEN = (extra: CardDef[]): CardDef[] => [BEAR, WALL, DALEK, VIPER, SURVIVOR, ...extra];

/** Attack with `attackers`, block with `blocks` (blocker, attacker), then stop at the first decision or at the end of combat. */
function combatTo(s0: GameState, attackers: ObjectId[], blocks: [ObjectId, ObjectId][]): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a] as [ObjectId]));
  s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), blocks);
  return passUntil(s, (x) => x.pending?.kind === 'yesNo' || x.turn.step === 'endCombat', 'the damage choice or the end of combat');
}
const toEnd = (s: GameState): GameState => passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');

// ---- Instill Energy --------------------------------------------------------------------------------------------------------------------------------------------------
const HASTE_AURA = card('Test Haste Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can attack as though it had haste.');
const HASTE_GEAR = card('Test Haste Gear', 'Artifact — Equipment', 'Equipped creature can attack as though it had haste.\nEquip {1}');
describe('CR 302.6, 508.1a, 609.4: "Enchanted creature can attack as though it had haste." (Instill Energy)', () => {
  it('is automated', () => { expect(full(HASTE_AURA)).toBe(true); expect(full(HASTE_GEAR)).toBe(true); });
  // (the Equipment says the same thing as the Aura and stays on the battlefield in a scenario, where an unattached Aura would be put into the graveyard)
  const setup = (aura: boolean) => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Bear', since: 1 }, ...(aura ? ['Test Haste Gear'] : [])] }, p2: { battlefield: ['Test Wall'] }, defs: OPEN([HASTE_AURA, HASTE_GEAR]) });
    return aura ? tweak(s0, (g) => { g.objects[find(g, 'Test Haste Gear', 'battlefield')]!.attachedTo = find(g, 'Test Bear', 'battlefield'); }) : s0;
  };
  it('the enchanted creature, which came under its controller\'s control this turn, may attack', () => {
    const s0 = setup(true);
    const s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Bear', 'battlefield')]]);
    expect(s.combat?.attackers.length).toBe(1);
  });
  it('negative: the same creature without the Equipment is held back by summoning sickness', () => {
    const s0 = setup(false);
    const bear = s0.objects[find(s0, 'Test Bear', 'battlefield')]!;
    expect(attackDenial(s0, bear, getChars(s0, bear.id), ['p2'])?.message).toMatch(/no haste/);
    const s1 = setup(true);
    const bear1 = s1.objects[find(s1, 'Test Bear', 'battlefield')]!;
    expect(attackDenial(s1, bear1, getChars(s1, bear1.id), ['p2'])).toBeNull();
  });
});

// ---- Siege Behemoth ------------------------------------------------------------------------------------------------------------------------------------------------
const BEHEMOTH = card('Test Behemoth', 'Creature — Giant', "As long as this creature is attacking, for each creature you control, you may have that creature assign its combat damage as though it weren't blocked.", ['5', '5']);
describe('CR 510.1b-c, 604.1, 611.3a: "As long as ~ is attacking, for each creature you control, you may have that creature assign its combat damage as though it weren\'t blocked." (Siege Behemoth)', () => {
  it('is automated', () => { expect(full(BEHEMOTH)).toBe(true); });
  const setup = () => scenario([], { p1: { battlefield: ['Test Behemoth', 'Test Bear'] }, p2: { battlefield: ['Test Wall', 'Test Wall'] }, defs: OPEN([BEHEMOTH]) });
  it('while the Behemoth attacks, a blocked Bear is asked and, answering yes, deals its damage to the player and leaves its blocker undamaged', () => {
    const s0 = setup();
    const [w1, w2] = mine(s0, 'Test Wall', 'p2');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const beh = find(s0, 'Test Behemoth', 'battlefield');
    let s = combatTo(s0, [beh, bear], [[w1!, bear], [w2!, beh]]);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending!.player).toBe('p1');
    // each creature is asked in turn: the Bear says yes, the Behemoth (a creature of the same description) says no and assigns to its blocker
    while (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: s.pending.prompt.includes('Test Bear') });
    s = toEnd(s);
    expect(s.objects[w1!]!.damage).toBe(0);
    expect(life(s, 'p2')).toBe(17);
  });
  it('negative: with the Behemoth at home (not attacking) a blocked Bear is not asked and its damage goes to the blocker', () => {
    const s0 = setup();
    const [w1] = mine(s0, 'Test Wall', 'p2');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = combatTo(s0, [bear], [[w1!, bear]]);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.objects[w1!]!.damage).toBe(3);
    expect(life(s, 'p2')).toBe(20);
  });
  it('negative: the opponent\'s Behemoth gives nothing to Alice\'s creatures', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Behemoth', 'Test Wall'] }, defs: OPEN([BEHEMOTH]) });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    const s = combatTo(s0, [bear], [[wall, bear]]);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.objects[wall]!.damage).toBe(3);
  });
});

// ---- Predatory Focus and Outmaneuver ------------------------------------------------------------------------------------------------------------------------
const FOCUS = card('Test Focus', 'Instant', "You may have creatures you control assign their combat damage this turn as though they weren't blocked.");
const OUTMANEUVER = card('Test Outmaneuver', 'Instant', "Two target blocked creatures assign their combat damage this turn as though they weren't blocked.");
describe('CR 510.1b-c, 611.2a: "You may have creatures you control assign their combat damage this turn as though they weren\'t blocked." (Predatory Focus)', () => {
  it('is automated', () => { expect(full(FOCUS)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Focus'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall'] }, defs: OPEN([FOCUS]) });
  /** Cast the spell, let it resolve and answer the choice it asks of its controller (Scryfall ruling 2008-04-01: chosen as the spell resolves). */
  const cast = (s0: GameState, use: boolean): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Focus', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending!.player).toBe('p1');
    return answer(s, { kind: 'yesNo', yes: use });
  };
  it('using it as it resolves: a blocked Bear is not asked again, all its damage goes to the player and the blocker takes none', () => {
    let s = cast(setup(), true);
    expect(s.zones.stack.length).toBe(0);
    const bear = find(s, 'Test Bear', 'battlefield');
    const wall = find(s, 'Test Wall', 'battlefield');
    s = combatTo(s, [bear], [[wall, bear]]);
    expect(s.pending?.kind).not.toBe('yesNo');
    s = toEnd(s);
    expect(s.objects[wall]!.damage).toBe(0);
    expect(life(s, 'p2')).toBe(17);
  });
  it('negative: declining it as it resolves leaves the damage with the blocker', () => {
    let s = cast(setup(), false);
    const bear = find(s, 'Test Bear', 'battlefield');
    const wall = find(s, 'Test Wall', 'battlefield');
    s = toEnd(combatTo(s, [bear], [[wall, bear]]));
    expect(s.objects[wall]!.damage).toBe(3);
    expect(life(s, 'p2')).toBe(20);
  });
  it('negative: without the spell the blocked Bear is not asked', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    const s = combatTo(s0, [bear], [[wall, bear]]);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.objects[wall]!.damage).toBe(3);
  });
});
describe('CR 510.1b-c, 509.1h, 611.2a: "Two target blocked creatures assign their combat damage this turn as though they weren\'t blocked." (Outmaneuver)', () => {
  it('is automated', () => { expect(full(OUTMANEUVER)).toBe(true); });
  it('two blocked attackers, no choice: all their damage goes to the player, their blockers take none; a third blocked attacker the spell did not name still hits its blocker', () => {
    const s0 = scenario([], { p1: { hand: ['Test Outmaneuver'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Wall', 'Test Wall', 'Test Wall'] }, defs: OPEN([OUTMANEUVER]) });
    const bears = mine(s0, 'Test Bear', 'p1');
    const walls = mine(s0, 'Test Wall', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), bears.map((b) => [b] as [ObjectId]));
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), walls.map((w, i) => [w, bears[i]!] as [ObjectId, ObjectId]));
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'priority after blockers');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Outmaneuver', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears[0]! }, { kind: 'object', id: bears[1]! }] });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(s);
    if (s.zones.stack.length > 0) s = pass(s);
    s = passUntil(s, (x) => x.pending?.kind === 'yesNo' || x.turn.step === 'endCombat', 'damage');
    expect(s.pending?.kind).not.toBe('yesNo'); // no choice is offered for a mandatory assignment
    expect(s.objects[walls[0]!]!.damage).toBe(0);
    expect(s.objects[walls[1]!]!.damage).toBe(0);
    expect(s.objects[walls[2]!]!.damage).toBe(3);
    expect(life(s, 'p2')).toBe(14);
  });
});

// ---- Masako the Humorless ---------------------------------------------------------------------------------------------------------------------------------------
const MASAKO = card('Test Masako', 'Creature — Human', 'Flash\nTapped creatures you control can block as though they were untapped.', ['2', '2']);
describe('CR 509.1a, 609.4: "Tapped creatures you control can block as though they were untapped." (Masako the Humorless)', () => {
  it('is automated', () => { expect(full(MASAKO)).toBe(true); });
  it('a tapped creature of the controller may block', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Masako', { name: 'Test Wall', tapped: true }] }, defs: OPEN([MASAKO]) });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[wall, bear]]);
    expect(s.combat?.blockers.length).toBe(1);
  });
  it('negative: without it a tapped creature cannot block; and an opponent\'s Masako does not help the controller\'s own tapped creatures', () => {
    for (const board of [{ p2: { battlefield: [{ name: 'Test Wall', tapped: true }] } }, { p1: { battlefield: ['Test Bear', 'Test Masako'] }, p2: { battlefield: [{ name: 'Test Wall', tapped: true }] } }]) {
      const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, ...board, defs: OPEN([MASAKO]) });
      const bear = find(s0, 'Test Bear', 'battlefield');
      const wall = find(s0, 'Test Wall', 'battlefield');
      // no creature of Bob's can block, so he is never asked to declare blockers, and a block declared by hand is refused
      const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[bear]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage');
      expect(s.pending?.kind).not.toBe('declareBlockers');
      expect(blockDenial(s, s.objects[wall]!, getChars(s, wall), s.objects[bear]!, getChars(s, bear), 'p2')).not.toBeNull();
    }
  });
});

// ---- Ace's Baseball Bat -------------------------------------------------------------------------------------------------------------------------------------
const BAT = card('Test Bat', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nAs long as equipped creature is attacking, it has first strike and must be blocked by a Dalek if able.\nEquip {1}');
describe('CR 509.1c, 604.1, 611.3a: "As long as equipped creature is attacking, it has first strike and must be blocked by a Dalek if able." (Ace\'s Baseball Bat)', () => {
  it('is automated', () => { expect(full(BAT)).toBe(true); });
  const setup = (daleks: number) => tweak(scenario([], { p1: { battlefield: ['Test Bear', 'Test Bat'] }, p2: { battlefield: ['Test Wall', ...Array(daleks).fill('Test Dalek') as string[]] }, defs: OPEN([BAT]) }), (g) => {
    g.objects[find(g, 'Test Bat', 'battlefield')]!.attachedTo = find(g, 'Test Bear', 'battlefield');
  });
  it('the attacking equipped creature gains first strike', () => {
    const s0 = setup(1);
    const s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Bear', 'battlefield')]]);
    expect(hasKeyword(getChars(s, find(s0, 'Test Bear', 'battlefield')), 'first strike')).toBe(true);
  });
  it('a Dalek able to block must block it: blocking with the Wall only, or not blocking, is refused; blocking with the Dalek is legal', () => {
    const s0 = setup(1);
    const bear = find(s0, 'Test Bear', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    const dalek = find(s0, 'Test Dalek', 'battlefield');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[bear]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const id = s.pending!.id;
    reject(s, { type: 'answer', player: 'p2', decisionId: id, answer: { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: bear }] } } as never);
    reject(s, { type: 'answer', player: 'p2', decisionId: id, answer: { kind: 'declareBlockers', blocks: [] } } as never);
    expect(declareBlockers(s, [[dalek, bear]]).combat?.blockers.length).toBe(1);
  });
  it('negative: with no Dalek on the battlefield nothing is required', () => {
    const s0 = setup(0);
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[bear]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(declareBlockers(s, []).combat?.blockers.length).toBe(0);
  });
});

// ---- Varchild, Betrayer of Kjeldor --------------------------------------------------------------------------------------------------------------------------
const VARCHILD = card('Test Varchild', 'Legendary Creature — Human Warrior', "Survivors your opponents control can't block, and they can't attack you or planeswalkers you control.", ['3', '3']);
describe('CR 509.1b, 508.1b-c, 604.1: "Survivors your opponents control can\'t block, and they can\'t attack you or planeswalkers you control." (Varchild, Betrayer of Kjeldor)', () => {
  it('is automated', () => { expect(full(VARCHILD)).toBe(true); });
  const setup = () => scenario([], { p1: { battlefield: ['Test Bear', 'Test Varchild'] }, p2: { battlefield: ['Test Survivor', 'Test Wall'] }, defs: OPEN([VARCHILD]) });
  it('an opposing Survivor cannot block; a Wall still can', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[bear]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const surv = find(s0, 'Test Survivor', 'battlefield');
    const r = reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: surv, attacker: bear }] } } as never);
    expect(r.rules.join(' ')).toMatch(/509/);
    expect(declareBlockers(s, [[find(s0, 'Test Wall', 'battlefield'), bear]]).combat?.blockers.length).toBe(1);
  });
  it('an opposing Survivor cannot attack Alice or her planeswalkers; the Wall (not a Survivor) is unaffected', () => {
    const s0 = setup();
    const surv = s0.objects[find(s0, 'Test Survivor', 'battlefield')]!;
    const wall = s0.objects[find(s0, 'Test Wall', 'battlefield')]!;
    // from Bob's side the Survivor may not attack Alice; the same question for the Wall is answered with no denial
    const afterTurn = tweak(s0, (g) => { g.turn.activePlayer = 'p2'; g.turn.number = 2; for (const id of g.zones.battlefield) g.objects[id]!.controlledSinceTurn = -1; }); // (so nothing is held back by summoning sickness)
    const sd = attackDenial(afterTurn, afterTurn.objects[surv.id]!, getChars(afterTurn, surv.id), ['p1']);
    expect(sd?.message ?? '', JSON.stringify(sd)).not.toMatch(/no haste/);
    expect(sd).not.toBeNull();
    const d = attackDenial(afterTurn, afterTurn.objects[wall.id]!, getChars(afterTurn, wall.id), ['p1']);
    expect(d?.message ?? null, JSON.stringify(d)).toBeNull();
  });
  it('negative: a Survivor Alice controls herself is not restricted', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Varchild', 'Test Survivor'] }, p2: { battlefield: ['Test Wall'] }, defs: OPEN([VARCHILD]) });
    const surv = find(s0, 'Test Survivor', 'battlefield');
    const s = declareAttackers(toDeclareAttackers(s0), [[surv]]);
    expect(s.combat?.attackers.length).toBe(1);
  });
});

// ---- Bill the Pony -------------------------------------------------------------------------------------------------------------------------------------------
const PONY = card('Test Pony', 'Creature — Horse', '{0}: Until end of turn, target creature you control assigns combat damage equal to its toughness rather than its power.', ['1', '1']);
describe('CR 510.1a, 611.2a: "Until end of turn, target creature you control assigns combat damage equal to its toughness rather than its power." (Bill the Pony)', () => {
  it('is automated', () => { expect(full(PONY)).toBe(true); });
  const setup = () => scenario([], { p1: { battlefield: ['Test Pony', 'Test Wall'] }, p2: {}, defs: OPEN([PONY]) });
  it('a 0/5 Wall deals 5 to the player after the ability, 0 without it', () => {
    const run = (activate: boolean): number => {
      let s = setup();
      if (activate) {
        const pony = find(s, 'Test Pony', 'battlefield');
        s = act(s, { type: 'activate', player: 'p1', source: pony, ability: 'p:0:0' } as never);
        if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Wall', 'battlefield') }] });
        if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        s = pass(s);
        if (s.zones.stack.length > 0) s = pass(s);
      }
      const wall = find(s, 'Test Wall', 'battlefield');
      s = declareAttackers(toDeclareAttackers(s), [[wall]]);
      s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers');
      if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
      return life(toEnd(s), 'p2');
    };
    expect(run(true)).toBe(15);
    expect(run(false)).toBe(20);
  });
});

// ---- Mirror Shield and Barrow-Blade ------------------------------------------------------------------------------------------------------------------------
const SHIELD = card('Test Shield', 'Artifact — Equipment', 'Equipped creature gets +0/+2 and has hexproof and "Whenever a creature with deathtouch blocks or becomes blocked by this creature, destroy that creature."\nEquip {3}');
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nWhenever equipped creature blocks or becomes blocked by a creature, that creature loses all abilities until end of turn.\nEquip {1}');
const equip = (s0: GameState, gear: string, creature: string, p: 'p1' | 'p2'): GameState => tweak(s0, (g) => { g.objects[mine(g, gear, p)[0]!]!.attachedTo = mine(g, creature, p)[0]!; });
describe('CR 509.3a, 509.3c, 603.2: "Whenever a creature with deathtouch blocks or becomes blocked by this creature, destroy that creature." (Mirror Shield)', () => {
  it('is automated', () => { expect(full(SHIELD)).toBe(true); });
  it('a deathtouch creature that blocks the equipped attacker is destroyed before damage, so the attacker survives; a Wall that blocks it is not destroyed', () => {
    for (const blocker of ['Test Viper', 'Test Wall']) {
      const s0 = equip(scenario([], { p1: { battlefield: ['Test Bear', 'Test Shield'] }, p2: { battlefield: [blocker] }, defs: OPEN([SHIELD]) }), 'Test Shield', 'Test Bear', 'p1');
      const bear = find(s0, 'Test Bear', 'battlefield');
      const b = find(s0, blocker, 'battlefield');
      let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
      s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[b, bear]]);
      s = passUntil(s, (x) => x.turn.step === 'endCombat' || (x.pending?.kind !== 'priority' && x.pending !== null), 'end of combat');
      if (blocker === 'Test Viper') {
        expect(s.zones.graveyard.p2!.some((id) => nameOf(s, id) === 'Test Viper')).toBe(true);
        expect(s.objects[bear]!.zone).toBe('battlefield');
        expect(s.objects[bear]!.damage).toBe(0);
      } else {
        expect(s.objects[b]!.zone).toBe('battlefield');
      }
    }
  });
  it('a deathtouch attacker that the equipped creature blocks is destroyed too ("becomes blocked by this creature")', () => {
    const s0 = equip(scenario([], { p1: { battlefield: ['Test Viper'] }, p2: { battlefield: ['Test Wall', 'Test Shield'] }, defs: OPEN([SHIELD]) }), 'Test Shield', 'Test Wall', 'p2');
    const viper = find(s0, 'Test Viper', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[viper]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[wall, viper]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    expect(s.zones.graveyard.p1!.some((id) => nameOf(s, id) === 'Test Viper')).toBe(true); // destroyed by the trigger before it could deal damage
    expect(s.objects[wall]!.zone).toBe('battlefield');
    expect(s.objects[wall]!.damage).toBe(0);
  });
  it('negative: without the Shield on the creature, nothing is destroyed before damage', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Shield'] }, p2: { battlefield: ['Test Viper'] }, defs: OPEN([SHIELD]) });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const viper = find(s0, 'Test Viper', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[viper, bear]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    expect(s.zones.graveyard.p1!.some((id) => nameOf(s, id) === 'Test Bear')).toBe(true); // killed by deathtouch damage
  });
});
describe('CR 509.3a, 509.3c, 608.2c: "Whenever equipped creature blocks or becomes blocked by a creature, that creature loses all abilities until end of turn." (Barrow-Blade)', () => {
  it('is automated', () => { expect(full(BLADE)).toBe(true); });
  const STRIKER = card('Test Striker', 'Creature — Soldier', 'First strike', ['2', '2']);
  it('the creature that blocks the equipped attacker loses its abilities (first strike), the equipped creature keeps its own', () => {
    const s0 = equip(scenario([], { p1: { battlefield: ['Test Bear', 'Test Blade'] }, p2: { battlefield: ['Test Striker'] }, defs: OPEN([BLADE, STRIKER]) }), 'Test Blade', 'Test Bear', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const striker = find(s0, 'Test Striker', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[striker, bear]]);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority' && x.zones.stack.length === 0, 'the trigger resolved');
    expect(JSON.stringify(getChars(s, striker).abilities ?? getChars(s, striker))).not.toContain('first strike');
  });
  it('negative: without the Blade on the creature the blocker keeps first strike', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Blade'] }, p2: { battlefield: ['Test Striker'] }, defs: OPEN([BLADE, STRIKER]) });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const striker = find(s0, 'Test Striker', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[striker, bear]]);
    expect(JSON.stringify(getChars(s, striker))).toContain('first strike');
  });
});

// ---- The Akroan War, chapter II -----------------------------------------------------------------------------------------------------------------------------------
const EDICT = card('Test Edict', 'Sorcery', 'Until your next turn, creatures your opponents control attack each combat if able.');
describe('CR 508.1d, 611.2a: "Until your next turn, creatures your opponents control attack each combat if able." (The Akroan War)', () => {
  it('is automated', () => { expect(full(EDICT)).toBe(true); });
  /** Cast the spell on turn 1, then pass to Bob's declare attackers decision (turn 2), answering Alice's own decisions with no attack. */
  function toBobAttack(s0: GameState): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Edict', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 120 && !(s.turn.number === 2 && s.pending?.kind === 'declareAttackers'); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    return s;
  }
  it('Bob\'s creature must attack on his turn: declaring no attackers is refused', () => {
    const s0 = scenario([], { p1: { hand: ['Test Edict'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Test Bear', since: 0 }] }, defs: OPEN([EDICT]) });
    const s = toBobAttack(s0);
    expect(s.pending?.kind).toBe('declareAttackers');
    expect(s.pending!.player).toBe('p2');
    reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [] } } as never);
    const bob = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(declareAttackers(s, [[bob]]).combat?.attackers.length).toBe(1);
  });
  it('negative: without the spell Bob may decline to attack', () => {
    const s0 = scenario([], { p1: { hand: ['Test Edict'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: OPEN([EDICT]) });
    let s = s0;
    for (let i = 0; i < 120 && !(s.turn.number === 2 && s.pending?.kind === 'declareAttackers'); i++) {
      const d = s.pending!;
      s = d.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : d.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
    }
    expect(s.pending!.player).toBe('p2');
    expect(answer(s, { kind: 'declareAttackers', attacks: [] }).pending).not.toBeNull();
  });
});

// keep imports used
void [findAll, blockDenial];
