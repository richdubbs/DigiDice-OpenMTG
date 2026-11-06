/**
 * Coordinator D, round edh-d-38 (lane combat, second pass): the round's readings and engine changes played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 509.1d, 107.3, 611.2a        "{X}{R}: This turn, creatures can't block unless their controller pays {X} for each blocking creature they control." (War Cadence)
 *   CR 509.1c                       "~ must be blocked if able, and ~ must be blocked by two or more creatures if able." (Gorm the Great)
 *   CR 120.10, 603.4                "Whenever ~ deals damage to a creature, if that creature was dealt excess damage this turn, that creature's controller sacrifices a noncreature, nonland permanent." (Maarika, Brutal Gladiator)
 *   CR 613.4c, 604.1, 611.3a        "As long as enchanted permanent is a creature, it gets +1/+1 for each creature and/or Vehicle you control." (Born to Drive)
 *   CR 113.6m, 602.2, 508.4         "{2}{U}{B}, Return an unblocked attacking Rogue you control to its owner's hand: Put this card from your hand onto the battlefield tapped and attacking." (Zareth San, the Trickster)
 *   CR 603.7, 508.1                 "... Whenever that creature attacks one of your opponents this turn, you draw a card." (Maeve, Insidious Singer)
 *   CR 613.4c, 508.1d, 613.1f       "Each Skeleton you control has trample, attacks each combat if able, and gets +X/+0, where X is the number of other Skeletons you control." (Skeletal Swarming)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { blockTaxes } from '../../../src/statics/combat-tax';
import { requirementsFor } from '../../../src/rules/requirements';
import { act, answer, find, findAll, legal, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const OPEN = (extra: CardDef[]): CardDef[] => [BEAR, WALL, GOBLIN, ...extra];

// ---- War Cadence ----------------------------------------------------------------------------------------------------------------------------------------------------
const CADENCE = card('Test Cadence', 'Enchantment', "{X}{R}: This turn, creatures can't block unless their controller pays {X} for each blocking creature they control.");
describe('CR 509.1d, 107.3, 611.2a: "{X}{R}: This turn, creatures can\'t block unless their controller pays {X} for each blocking creature they control." (War Cadence)', () => {
  it('is automated', () => { expect(full(CADENCE)).toBe(true); });
  const setup = () => scenario(['Mountain'], { p1: { battlefield: ['Test Cadence', 'Test Bear', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Wall', 'Test Wall'] }, defs: OPEN([CADENCE]) });
  const activate = (s: GameState, x: number): GameState => {
    const a = legal(s, 'p1', 'activate').find((l) => l.action.type === 'activate' && l.action.source === find(s, 'Test Cadence', 'battlefield'));
    expect(a, 'the activation is offered').toBeDefined();
    let t = act(s, a!.action);
    for (let i = 0; i < 12 && t.pending && t.pending.kind !== 'priority'; i++) {
      const d = t.pending as { kind: string; min?: number; max?: number };
      if (d.kind === 'chooseNumber' || d.kind === 'chooseX') t = answer(t, { kind: 'chooseNumber', n: x } as never);
      else if (d.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}: ${JSON.stringify(d)}`);
    }
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(t); // the ability resolves
    return t;
  };
  it('after X = 2 each blocker costs {2}: the tax of a Wall blocking the Bear is two generic mana', () => {
    const s0 = setup();
    const s = activate(s0, 2);
    const walls = findAll(s, 'Test Wall', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(blockTaxes(s, [{ blocker: walls[0]!, attacker: bear }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 2 }] }]);
    expect(blockTaxes(s, [{ blocker: walls[0]!, attacker: bear }, { blocker: walls[1]!, attacker: bear }]).length).toBe(2);
  });
  it('negative: before the ability is activated, blocking costs nothing', () => {
    const s0 = setup();
    const walls = findAll(s0, 'Test Wall', 'battlefield', 'p2');
    expect(blockTaxes(s0, [{ blocker: walls[0]!, attacker: find(s0, 'Test Bear', 'battlefield', 'p1') }])).toEqual([]);
  });
});

// ---- Gorm the Great -------------------------------------------------------------------------------------------------------------------------------------------------
const GORM = card('Test Gorm', 'Legendary Creature — Giant Warrior', 'Vigilance\nThis creature must be blocked if able, and this creature must be blocked by two or more creatures if able.', ['6', '6']);
describe('CR 509.1c: "~ must be blocked if able, and ~ must be blocked by two or more creatures if able." (Gorm the Great)', () => {
  it('is automated', () => { expect(full(GORM)).toBe(true); });
  const setup = (blockers: number): GameState => tweak(scenario([], { p1: { battlefield: ['Test Gorm'] }, p2: { battlefield: Array(blockers).fill('Test Wall') as string[] }, defs: OPEN([GORM]) }), (g) => { for (const id of g.zones.battlefield) g.objects[id]!.controlledSinceTurn = -1; });
  const atBlockers = (s0: GameState): GameState => passUntil(declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Gorm', 'battlefield')]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
  const refuse = (s: GameState, blocks: { blocker: string; attacker: string }[]) =>
    reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks } } as never);
  it('with three creatures able to block, no block and a single blocker are refused; two and three blockers are legal', () => {
    const s0 = setup(3);
    const gorm = find(s0, 'Test Gorm', 'battlefield');
    const [w1, w2, w3] = findAll(s0, 'Test Wall', 'battlefield', 'p2') as [string, string, string];
    const s = atBlockers(s0);
    refuse(s, []);
    refuse(s, [{ blocker: w1, attacker: gorm }]);
    expect(declareBlockers(s, [[w1, gorm], [w2, gorm]]).combat?.blockers.length).toBe(2);
    expect(declareBlockers(s, [[w1, gorm], [w2, gorm], [w3, gorm]]).combat?.blockers.length).toBe(3);
  });
  it('the requirement lists the minimum for the defending player', () => {
    const s = atBlockers(setup(2));
    const reqs = requirementsFor(s, 'block', 'p2').filter((r) => r.kind === 'beBlocked');
    expect(reqs.map((r) => r.min ?? 1).sort()).toEqual([1, 2]);
  });
  it('negative: with only one creature able to block, that one must block and is the whole requirement (blocking with it is legal, not blocking is refused)', () => {
    const s0 = setup(1);
    const gorm = find(s0, 'Test Gorm', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s = atBlockers(s0);
    refuse(s, []);
    expect(declareBlockers(s, [[wall, gorm]]).combat?.blockers.length).toBe(1);
  });
  it('negative: with no creature able to block nothing is required', () => {
    const s0 = setup(0);
    // (no creature can block, so no blockers decision is asked at all)
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Gorm', 'battlefield')]]), (x) => x.turn.step === 'combatDamage', 'combat damage');
    expect(s.combat?.blockers.length).toBe(0);
  });
});

// ---- Skeletal Swarming ----------------------------------------------------------------------------------------------------------------------------------------------
const SWARM = card('Test Swarm', 'Enchantment', 'Each Goblin you control has trample, attacks each combat if able, and gets +X/+0, where X is the number of other Goblins you control.');
describe('CR 613.4c, 508.1d, 613.1f: "Each Goblin you control has trample, attacks each combat if able, and gets +X/+0, where X is the number of other Goblins you control." (Skeletal Swarming)', () => {
  it('is automated', () => { expect(full(SWARM)).toBe(true); });
  const setup = (goblins: number) => scenario([], { p1: { battlefield: ['Test Swarm', ...Array(goblins).fill('Test Goblin') as string[], 'Test Bear'] }, p2: { battlefield: ['Test Goblin'] }, defs: OPEN([SWARM]) });
  it('with three Goblins each one counts the other two: power 1 + 2 = 3, and each has trample', () => {
    const s = setup(3);
    for (const g of findAll(s, 'Test Goblin', 'battlefield', 'p1')) {
      const c = getChars(s, g);
      expect(Number(c.power)).toBe(3);
      expect(Number(c.toughness)).toBe(1);
      expect(hasKeyword(c, 'trample')).toBe(true);
    }
  });
  it('with one Goblin there are no others: +0', () => {
    const s = setup(1);
    expect(Number(getChars(s, find(s, 'Test Goblin', 'battlefield', 'p1')).power)).toBe(1);
  });
  it('negative: another player\'s Goblin and a non-Goblin are not changed and are not counted', () => {
    const s = setup(2);
    expect(Number(getChars(s, find(s, 'Test Goblin', 'battlefield', 'p2')).power)).toBe(1);
    expect(Number(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1')).power)).toBe(3);
    expect(Number(getChars(s, findAll(s, 'Test Goblin', 'battlefield', 'p1')[0]!).power)).toBe(2);
  });
  it('the Goblins must attack: attacking with the Bear alone is refused', () => {
    const s0 = tweak(setup(2), (g) => { for (const id of g.zones.battlefield) g.objects[id]!.controlledSinceTurn = -1; });
    const s = toDeclareAttackers(s0);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] } } as never);
    const gobs = findAll(s, 'Test Goblin', 'battlefield', 'p1');
    expect(declareAttackers(s, gobs.map((g) => [g] as [string])).combat?.attackers.length).toBe(2);
  });
});

// ---- Maarika, Brutal Gladiator --------------------------------------------------------------------------------------------------------------------------------------
const MAARIKA = card('Test Maarika', 'Legendary Creature — Human Gladiator', "Whenever this creature deals damage to a creature, if that creature was dealt excess damage this turn, that creature's controller sacrifices a noncreature, nonland permanent.", ['3', '3']);
const TRINKET = card('Test Trinket', 'Artifact', '');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
describe('CR 120.10, 603.4: "Whenever ~ deals damage to a creature, if that creature was dealt excess damage this turn, that creature\'s controller sacrifices a noncreature, nonland permanent." (Maarika, Brutal Gladiator)', () => {
  it('is automated', () => { expect(full(MAARIKA)).toBe(true); });
  const fight = (blockerName: string): GameState => {
    const s0 = tweak(scenario([], { p1: { battlefield: ['Test Maarika'] }, p2: { battlefield: [blockerName, 'Test Trinket'] }, defs: [...OPEN([MAARIKA]), TRINKET, CUB] }), (g) => { for (const id of g.zones.battlefield) g.objects[id]!.controlledSinceTurn = -1; });
    const maarika = find(s0, 'Test Maarika', 'battlefield');
    const blocker = find(s0, blockerName, 'battlefield', 'p2');
    const s1 = passUntil(declareAttackers(toDeclareAttackers(s0), [[maarika]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    return passUntil(declareBlockers(s1, [[blocker, maarika]]), (x) => x.turn.step === 'endCombat', 'end of combat');
  };
  const trinketGone = (s: GameState): boolean => !s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Trinket');
  it('3 damage to a 2/2 is excess (1 beyond lethal): its controller sacrifices the noncreature, nonland permanent', () => {
    expect(trinketGone(fight('Test Cub'))).toBe(true);
  });
  it('negative: 3 damage to a 0/5 Wall is not excess: nothing is sacrificed', () => {
    expect(trinketGone(fight('Test Wall'))).toBe(false);
  });
  it('negative: exactly lethal damage (3 to a 3/3) is not excess: nothing is sacrificed', () => {
    expect(trinketGone(fight('Test Bear'))).toBe(false);
  });
});

// (an Aura without its Enchant ability stays on the battlefield in a scenario, where an unattached Aura would be put into the graveyard; the attachment is set directly)
// ---- Born to Drive --------------------------------------------------------------------------------------------------------------------------------------------------
const DRIVE = card('Test Drive', 'Enchantment', 'As long as enchanted permanent is a creature, it gets +1/+1 for each creature and/or Vehicle you control.');
const CAR = card('Test Car', 'Artifact — Vehicle', 'Crew 3', ['3', '3']);
describe('CR 613.4c, 604.1, 611.3a: "As long as enchanted permanent is a creature, it gets +1/+1 for each creature and/or Vehicle you control." (Born to Drive)', () => {
  it('is automated', () => { expect(full(DRIVE)).toBe(true); });
  const setup = (onName: string) => tweak(scenario([], { p1: { battlefield: ['Test Drive', 'Test Bear', 'Test Wall', 'Test Car', 'Test Trinket'] }, p2: { battlefield: ['Test Bear'] }, defs: [...OPEN([DRIVE, TRINKET]), CAR] }), (g) => {
    g.objects[find(g, 'Test Drive', 'battlefield')]!.attachedTo = find(g, onName, 'battlefield', 'p1');
  });
  it('on a creature: +1/+1 for each creature and Vehicle (Bear, Wall and the Car = 3): the 3/3 Bear is 6/6', () => {
    const s = setup('Test Bear');
    const c = getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect([Number(c.power), Number(c.toughness)]).toEqual([6, 6]);
  });
  it('negative: on a noncreature artifact it does nothing (the artifact is not a creature); other creatures and the opponent\'s Bear are unchanged', () => {
    const s = setup('Test Trinket');
    expect(getChars(s, find(s, 'Test Trinket', 'battlefield', 'p1')).types).not.toContain('Creature');
    expect(Number(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1')).power)).toBe(3);
    expect(Number(getChars(s, find(s, 'Test Bear', 'battlefield', 'p2')).power)).toBe(3);
  });
});

// ---- Maeve, Insidious Singer (the delayed trigger) -------------------------------------------------------------------------------------------------------------------
const SCOUT = card('Test Scout', 'Enchantment', '{0}: Target creature gets +1/+1 until end of turn. Whenever that creature attacks one of your opponents this turn, you draw a card.');
describe('CR 603.7, 508.1: "Target creature gets +1/+1 until end of turn. Whenever that creature attacks one of your opponents this turn, you draw a card." (Maeve, Insidious Singer)', () => {
  it('is automated', () => { expect(full(SCOUT)).toBe(true); });
  const setup = () => tweak(scenario([], { p1: { battlefield: ['Test Scout', 'Test Bear', 'Test Wall'], library: ['Test Wall', 'Test Wall', 'Test Wall'] }, p2: { battlefield: ['Test Goblin'] }, defs: OPEN([SCOUT]) }), (g) => { for (const id of g.zones.battlefield) g.objects[id]!.controlledSinceTurn = -1; });
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  const activateOn = (s: GameState, target: string): GameState => {
    const a = legal(s, 'p1', 'activate').find((l) => l.action.type === 'activate' && l.action.source === find(s, 'Test Scout', 'battlefield'));
    expect(a).toBeDefined();
    let t = act(s, a!.action);
    for (let i = 0; i < 8 && t.pending && t.pending.kind !== 'priority'; i++) {
      if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] } as never);
      else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${t.pending.kind}: ${JSON.stringify(t.pending).slice(0, 300)}`);
    }
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(t);
    return t;
  };
  it('the targeted creature attacks the opponent this turn: its controller draws a card', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = activateOn(s0, bear);
    const before = handSize(s1);
    let s2 = declareAttackers(toDeclareAttackers(s1), [[bear]]);
    for (let i = 0; i < 6 && s2.zones.stack.length === 0 && s2.pending?.kind === 'priority' && s2.turn.step === 'declareAttackers'; i++) s2 = pass(s2);
    expect(handSize(s2)).toBe(before);
    // (the trigger is on the stack or already resolved; resolve it)
    let s3 = s2;
    for (let i = 0; i < 6 && s3.zones.stack.length > 0; i++) s3 = pass(s3);
    expect(handSize(s3)).toBe(before + 1);
  });
  it('negative: another creature attacking does not draw, and neither does the target without the ability', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const wall = find(s0, 'Test Wall', 'battlefield', 'p1');
    const s1 = activateOn(s0, bear);
    const before = handSize(s1);
    let s2 = declareAttackers(toDeclareAttackers(s1), [[wall]]);
    for (let i = 0; i < 6 && s2.zones.stack.length > 0; i++) s2 = pass(s2);
    expect(handSize(s2)).toBe(before);
    const c0 = setup();
    let c1 = declareAttackers(toDeclareAttackers(c0), [[find(c0, 'Test Bear', 'battlefield', 'p1')]]);
    for (let i = 0; i < 6 && c1.zones.stack.length > 0; i++) c1 = pass(c1);
    expect(handSize(c1)).toBe(handSize(c0));
  });
});

// ---- Zareth San, the Trickster -------------------------------------------------------------------------------------------------------------------------------------
const ZARETH = card('Test Zareth', 'Legendary Creature — Human Rogue', "Flash\n{2}{U}{B}, Return an unblocked attacking Rogue you control to its owner's hand: Put this card from your hand onto the battlefield tapped and attacking.", ['3', '3']);
const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', ['2', '2']);
describe('CR 113.6m, 602.2, 508.4: "{2}{U}{B}, Return an unblocked attacking Rogue you control to its owner\'s hand: Put this card from your hand onto the battlefield tapped and attacking." (Zareth San, the Trickster)', () => {
  it('is automated', () => { expect(full(ZARETH)).toBe(true); });
  const setup = (rogueName: string) => scenario(['Island', 'Island', 'Swamp', 'Swamp'], { p1: { battlefield: [rogueName, 'Island', 'Island', 'Swamp', 'Swamp'], hand: ['Test Zareth'] }, p2: { battlefield: [] }, defs: [...OPEN([ZARETH]), ROGUE] });
  const toBlockersStep = (s0: GameState, attacker: string): GameState => {
    const s1 = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
    return passUntil(s1, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'the declare blockers step');
  };
  const zarethActivation = (s: GameState) => legal(s, 'p1', 'activate').find((l) => l.action.type === 'activate' && l.action.source === find(s, 'Test Zareth', 'hand', 'p1'));
  it('returning an unblocked attacking Rogue puts the Zareth into the battlefield tapped and attacking', () => {
    const s0 = setup('Test Rogue');
    const rogue = find(s0, 'Test Rogue', 'battlefield', 'p1');
    const s1 = toBlockersStep(s0, rogue);
    const a = zarethActivation(s1);
    expect(a, 'the ability is offered from the hand').toBeDefined();
    let t = act(s1, a!.action);
    for (let i = 0; i < 10 && t.pending && t.pending.kind !== 'priority'; i++) {
      const d = t.pending as { kind: string; candidates?: string[]; options?: unknown[] };
      if (d.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: [rogue] } as never);
      else throw new Error(`unexpected decision ${d.kind}: ${JSON.stringify(t.pending).slice(0, 400)}`);
    }
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(t);
    const z = find(t, 'Test Zareth', 'battlefield', 'p1');
    expect(t.objects[z]!.tapped).toBe(true);
    expect(t.combat?.attackers.some((a) => a.id === z)).toBe(true);
    expect(t.zones.hand['p1']!.some((id) => t.objects[id]!.defId === 'Test Rogue')).toBe(true);
  });
  it('negative: with no Rogue attacking (a Bear attacks), the cost cannot be paid and the ability is not offered', () => {
    const s0 = setup('Test Bear');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = toBlockersStep(s0, bear);
    expect(zarethActivation(s1)).toBeUndefined();
  });
});
