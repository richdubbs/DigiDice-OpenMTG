/**
 * FAST4 T32: the casting statics of parser/templates/zz-fast4/t32.json (and the render support they needed) played through the
 * engine with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 601.2f, 601.2i          "~ costs {2} less to cast if you've cast another spell this turn" (the spell being cast is not counted yet)
 *   CR 601.2f, 102.3           "~ costs {2} less to cast if your opponents control three or more creatures" (every opponent's, counted together)
 *   CR 601.2f, 208.1           "~ costs {3} less to cast if creatures you control have total toughness 10 or greater"
 *   CR 601.2f, 400.3, 603.10a  "~ costs {2} less to cast if one or more cards left your graveyard this turn"
 *   CR 601.2c, 601.2f          "~ costs {2} more to cast if it targets a Dragon"; "~ costs {1} less to cast if it targets an attacking nontoken creature"
 *   CR 601.2f, 202.3           "Colorless spells you cast with mana value 7 or greater cost {1} less to cast."
 *   CR 601.2f, 102.1           "Each spell costs {3} more to cast except during its controller's turn."
 *   CR 601.2f, 601.2i          "The first instant or sorcery spell you cast each turn costs {3} less to cast."
 *   CR 118.9, 601.2b           "You may pay {B} rather than pay ~'s mana cost if there are thirteen or more creatures on the battlefield."
 *   CR 118.9, 601.2b           "If an opponent controls a Swamp and you control a Forest, you may cast ~ without paying its mana cost."
 *   CR 601.3, 506.1            "Cast ~ only during combat."; "You can't cast ~ unless there are seven or more cards in your graveyard."
 *   CR 601.3, 601.2a           "Your opponents can't cast spells from anywhere other than their hands."
 *   CR 601.3, 602.5, 109.2     "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ManaSymbol, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { castCheck, modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, advanceTo, answer, castAuto, find, legal, life, pass, passBoth, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` for `player` after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}
/** Test setup: the card `id` as a spell on the stack controlled by `player`, with these announced targets (CR 601.2c comes before the total cost, 601.2f). */
function onStack(s: GameState, id: ObjectId, targets: TargetChoice[], player = 'p1'): GameState {
  return tweak(s, (x) => {
    const o = x.objects[id]!;
    x.zones.hand[o.owner] = x.zones.hand[o.owner]!.filter((y) => y !== id);
    o.zone = 'stack';
    o.controller = player;
    x.zones.stack.push(id);
    o.stack = { kind: 'spell', face: 0, targets: [targets], costsPaid: {}, castFrom: 'hand' } as never;
  });
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);
const denied = (s: GameState, player: string, id: ObjectId, method?: string): boolean => 'denial' in castCheck(s, player, id, undefined, method);
/** Cast from a player's hand, choosing these targets and paying automatically. */
function castWith(s0: GameState, name: string, targets: TargetChoice[], player = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const untappedLands = (s: GameState, player: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && !s.objects[id]!.tapped && /Plains|Island|Mountain|Forest|Swamp/.test(s.objects[id]!.defId)).length;

const FOCUS = card('Test Focus', 'Instant', "This spell costs {2} less to cast if you've cast another spell this turn.\nDraw two cards.", { cost: '{4}{U}', colors: ['U'] });
const TRINKET = card('Test Trinket', 'Artifact', '', { cost: '{0}' });
const LASHER = card('Test Lasher', 'Creature — Plant Beast', 'This spell costs {2} less to cast if your opponents control three or more creatures.\nReach', { cost: '{4}{G}{G}', colors: ['G'], pt: ['6', '5'] });
const DANCER = card('Test Dancer', 'Creature — Merfolk Bard', 'This spell costs {3} less to cast if creatures you control have total toughness 10 or greater.', { cost: '{4}{U}', colors: ['U'], pt: ['3', '3'] });
const HEAT = card('Test Heat', 'Instant', 'This spell costs {2} less to cast if one or more cards left your graveyard this turn.\nTest Heat deals 5 damage to target creature.', { cost: '{2}{R}{W}', colors: ['R', 'W'] });
const RECALL = card('Test Recall', 'Sorcery', 'Exile target card from a graveyard.', { cost: '{0}' });
const PREY = card('Test Prey', 'Instant', 'This spell costs {2} more to cast if it targets a Dragon.\nDestroy target creature.', { cost: '{2}{B}', colors: ['B'] });
const PARTING = card('Test Parting', 'Instant', 'This spell costs {1} less to cast if it targets an attacking nontoken creature.\nReturn target creature to its owner\'s hand.', { cost: '{3}{U}', colors: ['U'] });
const HERALD = card('Test Herald', 'Creature — Eldrazi Drone', 'Colorless spells you cast with mana value 7 or greater cost {1} less to cast.', { cost: '{2}', pt: ['2', '2'] });
const TITAN = card('Test Titan', 'Creature — Eldrazi', '', { cost: '{7}', pt: ['7', '7'] });
const SIX = card('Test Six', 'Creature — Eldrazi', '', { cost: '{6}', pt: ['6', '6'] });
const WURM = card('Test Wurm', 'Creature — Wurm', '', { cost: '{6}{G}', colors: ['G'], pt: ['7', '7'] });
const GRID = card('Test Grid', 'Artifact', "Each spell costs {3} more to cast except during its controller's turn.", { cost: '{2}' });
const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
const RESEARCHER = card('Test Researcher', 'Creature — Weird Detective', 'The first instant or sorcery spell you cast each turn costs {3} less to cast.', { cost: '{3}{U}{R}', colors: ['U', 'R'], pt: ['2', '2'] });
const STUDY = card('Test Study', 'Sorcery', 'Draw a card.', { cost: '{3}{U}', colors: ['U'] });
const EDICT = card('Test Edict', 'Sorcery', "You may pay {B} rather than pay this spell's mana cost if there are thirteen or more creatures on the battlefield.\nDraw a card.", { cost: '{3}{B}{B}', colors: ['B'] });
const RAIN = card('Test Rain', 'Instant', 'If an opponent controls a Swamp and you control a Forest, you may cast this spell without paying its mana cost.\nYou gain 6 life.', { cost: '{3}{G}', colors: ['G'] });
const EMBRACE = card('Test Embrace', 'Instant', 'Cast this spell only during combat.\nDraw a card.', { cost: '{U}', colors: ['U'] });
const MASTERMIND = card('Test Mastermind', 'Creature — Human Rogue', "You can't cast this spell unless there are seven or more cards in your graveyard.\nMenace", { cost: '{2}{B}', colors: ['B'], pt: ['4', '4'] });
const MAGISTRATE = card('Test Magistrate', 'Creature — Human Wizard', "Your opponents can't cast spells from anywhere other than their hands.", { cost: '{1}{W}', colors: ['W'], pt: ['1', '3'] });
const FLASH = card('Test Flashback', 'Instant', 'Draw a card.\nFlashback {R}', { cost: '{R}', colors: ['R'] });
const ABOLISHER = card('Test Abolisher', 'Creature — Human Cleric', "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.", { cost: '{W}{W}', colors: ['W'], pt: ['2', '2'] });
const CYCLER = card('Test Cycler', 'Creature — Beast', 'Cycling {R}', { cost: '{4}{R}', colors: ['R'], pt: ['5', '5'] });
const PINGER = card('Test Pinger', 'Creature — Human Shaman', '{T}: Test Pinger deals 1 damage to any target.', { cost: '{R}', colors: ['R'], pt: ['1', '1'] });
const SPRING = card('Test Spring', 'Land', '{T}: You gain 1 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', colors: ['G'], pt: ['2', '2'] });
const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Flying', { cost: '{4}{R}', colors: ['R'], pt: ['4', '4'] });
const ALL = [FOCUS, TRINKET, LASHER, DANCER, HEAT, RECALL, PREY, PARTING, HERALD, TITAN, SIX, WURM, GRID, SPARK, RESEARCHER, STUDY, EDICT, RAIN, EMBRACE, MASTERMIND, MAGISTRATE, FLASH, ABOLISHER, CYCLER, PINGER, SPRING, BEAR, DRAGON];

describe('design 6.9: every T32 sentence is compiled to data, none left manual', () => {
  it('CR 601.2f, 118.9, 601.3: no manual ability on the T32 test cards', () => {
    for (const d of [FOCUS, LASHER, DANCER, HEAT, PREY, PARTING, HERALD, GRID, RESEARCHER, EDICT, RAIN, EMBRACE, MASTERMIND, MAGISTRATE, ABOLISHER]) expect(noManual(d), d.name).toEqual([]);
  });
  it('design 6.9: the T32 templates are stable (golden review fast4-t32-review.json), so the cards they read completely are fully automated', () => {
    for (const d of [FOCUS, LASHER, DANCER, HEAT, PREY, PARTING, HERALD, GRID, RESEARCHER, EDICT, RAIN, EMBRACE, MASTERMIND, MAGISTRATE, ABOLISHER]) expect(d.automation.level, d.name).toBe('full');
  });
});

describe("CR 601.2f, 601.2i: \"~ costs {2} less to cast if you've cast another spell this turn\"", () => {
  it('no spell cast yet: {4}{U}; after casting one (the spell being cast is not counted, CR 601.2i comes after 601.2f): {2}{U}', () => {
    const s0 = scenario([], { p1: { hand: ['Test Focus', 'Test Trinket'] }, defs: ALL });
    const id = find(s0, 'Test Focus', 'hand');
    expect(costOf(s0, id, FOCUS)).toBe('{4}{U}');
    const s1 = passBoth(castAuto(s0, 'Test Trinket'));
    expect(costOf(s1, id, FOCUS)).toBe('{2}{U}');
  });
  it("an opponent's spells are not yours: {4}{U}", () => {
    const s0 = scenario([], { p1: { hand: ['Test Focus'] }, defs: ALL });
    const s = tweak(s0, (x) => { x.players.find((p) => p.id === 'p2')!.turnStats.spellsCast = 3; });
    expect(costOf(s, find(s, 'Test Focus', 'hand'), FOCUS)).toBe('{4}{U}');
  });
});

describe('CR 601.2f, 102.3: "~ costs {2} less to cast if your opponents control three or more creatures"', () => {
  it("two of the opponent's creatures: {4}{G}{G}; three: {2}{G}{G}; your own creatures do not count", () => {
    const two = scenario([], { p1: { hand: ['Test Lasher'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: ALL });
    expect(costOf(two, find(two, 'Test Lasher', 'hand'), LASHER)).toBe('{4}{G}{G}');
    const three = scenario([], { p1: { hand: ['Test Lasher'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: ALL });
    expect(costOf(three, find(three, 'Test Lasher', 'hand'), LASHER)).toBe('{2}{G}{G}');
  });
});

describe('CR 601.2f, 208.1: "~ costs {3} less to cast if creatures you control have total toughness 10 or greater"', () => {
  it("four Bears (toughness 8): {4}{U}; five (10): {1}{U}; the opponent's creatures do not count", () => {
    const four = scenario([], { p1: { hand: ['Test Dancer'], battlefield: Array(4).fill('Test Bear') }, p2: { battlefield: Array(5).fill('Test Bear') }, defs: ALL });
    expect(costOf(four, find(four, 'Test Dancer', 'hand'), DANCER)).toBe('{4}{U}');
    const five = scenario([], { p1: { hand: ['Test Dancer'], battlefield: Array(5).fill('Test Bear') }, defs: ALL });
    expect(costOf(five, find(five, 'Test Dancer', 'hand'), DANCER)).toBe('{1}{U}');
  });
});

describe('CR 601.2f, 400.3, 603.10a: "~ costs {2} less to cast if one or more cards left your graveyard this turn"', () => {
  it("nothing left: {2}{R}{W}; after a card of yours is exiled from your graveyard: {R}{W}; a card leaving the opponent's graveyard does not count", () => {
    const s0 = scenario([], { p1: { hand: ['Test Heat', 'Test Recall'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear'] }, defs: ALL });
    const id = find(s0, 'Test Heat', 'hand');
    expect(costOf(s0, id, HEAT)).toBe('{2}{R}{W}');
    const theirs = passBoth(castWith(s0, 'Test Recall', [obj(find(s0, 'Test Bear', 'graveyard', 'p2'))]));
    expect(s0.zones.graveyard['p2']!.length - theirs.zones.graveyard['p2']!.length).toBe(1);
    expect(costOf(theirs, id, HEAT)).toBe('{2}{R}{W}');
    const mine = passBoth(castWith(s0, 'Test Recall', [obj(find(s0, 'Test Bear', 'graveyard', 'p1'))]));
    expect(costOf(mine, id, HEAT)).toBe('{R}{W}');
  });
  it('a card cast from your graveyard has left it too (flashback, CR 702.34a)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Heat'], graveyard: ['Test Flashback'], battlefield: ['Mountain'] }, defs: ALL });
    const s = passBoth(castAuto(s0, 'Test Flashback', { method: 'flashback' }));
    expect(costOf(s, find(s, 'Test Heat', 'hand'), HEAT)).toBe('{R}{W}');
  });
});

describe('CR 601.2c, 601.2f: cost changes read from the chosen targets', () => {
  it('"~ costs {2} more to cast if it targets a Dragon": a Dragon {4}{B}, a Bear {2}{B}; castCheck (nothing chosen yet) counts the least, {2}{B}', () => {
    const s = scenario([], { p1: { hand: ['Test Prey'] }, p2: { battlefield: ['Test Dragon', 'Test Bear'] }, defs: ALL });
    const id = find(s, 'Test Prey', 'hand');
    expect(costOf(s, id, PREY)).toBe('{2}{B}');
    expect(costOf(onStack(s, id, [obj(find(s, 'Test Dragon', 'battlefield'))]), id, PREY)).toBe('{4}{B}');
    expect(costOf(onStack(s, id, [obj(find(s, 'Test Bear', 'battlefield'))]), id, PREY)).toBe('{2}{B}');
  });
  it('"~ costs {1} less to cast if it targets an attacking nontoken creature": an attacking card {2}{U}; a creature that is not attacking {3}{U}', () => {
    const s = scenario([], { p1: { hand: ['Test Parting'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: ALL });
    const id = find(s, 'Test Parting', 'hand');
    const [a, b] = s.zones.battlefield.filter((x) => s.objects[x]!.defId === 'Test Bear');
    const attacking = tweak(s, (x) => { x.combat = { number: 1, attacked: true, attackers: [{ id: a!, defender: 'p1', defendingPlayer: 'p1', blockedBy: [] }], blockers: [], damageSteps: 0, extraDamageStep: false } as never; });
    expect(costOf(onStack(attacking, id, [obj(a!)]), id, PARTING)).toBe('{2}{U}');
    expect(costOf(onStack(attacking, id, [obj(b!)]), id, PARTING)).toBe('{3}{U}');
  });
});

describe('CR 601.2f, 202.3: "Colorless spells you cast with mana value 7 or greater cost {1} less to cast."', () => {
  it('a colorless 7: {6}; a colorless 6: {6}; a green 7: {6}{G}; an opponent casting a colorless 7: {7}', () => {
    const s = scenario([], { p1: { hand: ['Test Titan', 'Test Six', 'Test Wurm'], battlefield: ['Test Herald'] }, p2: { hand: ['Test Titan'] }, defs: ALL });
    expect(costOf(s, find(s, 'Test Titan', 'hand', 'p1'), TITAN)).toBe('{6}');
    expect(costOf(s, find(s, 'Test Six', 'hand'), SIX)).toBe('{6}');
    expect(costOf(s, find(s, 'Test Wurm', 'hand'), WURM)).toBe('{6}{G}');
    expect(costOf(s, find(s, 'Test Titan', 'hand', 'p2'), TITAN, 'p2')).toBe('{7}');
  });
});

describe('CR 601.2f, 102.1: "Each spell costs {3} more to cast except during its controller\'s turn."', () => {
  it("during p1's turn: p1's spell {R}, p2's spell {3}{R}; during p2's turn the other way round (the Grid's controller is no exception)", () => {
    const s = scenario([], { p1: { hand: ['Test Spark'], battlefield: ['Test Grid'] }, p2: { hand: ['Test Spark'] }, defs: ALL });
    const mine = find(s, 'Test Spark', 'hand', 'p1');
    const theirs = find(s, 'Test Spark', 'hand', 'p2');
    expect(costOf(s, mine, SPARK, 'p1')).toBe('{R}');
    expect(costOf(s, theirs, SPARK, 'p2')).toBe('{3}{R}');
    const p2Turn = tweak(s, (x) => { x.turn.activePlayer = 'p2'; });
    expect(costOf(p2Turn, mine, SPARK, 'p1')).toBe('{3}{R}');
    expect(costOf(p2Turn, theirs, SPARK, 'p2')).toBe('{R}');
  });
});

describe('CR 601.2f, 601.2i: "The first instant or sorcery spell you cast each turn costs {3} less to cast."', () => {
  it('the first sorcery {U}; a creature spell cast before it changes nothing; after one sorcery the next one costs {3}{U}', () => {
    const s0 = scenario(['Island', 'Forest'], { p1: { hand: ['Test Study', 'Test Study', 'Test Bear'], battlefield: ['Test Researcher', 'Island', 'Forest', 'Forest'] }, defs: ALL });
    const [first, second] = s0.zones.hand['p1']!.filter((x) => s0.objects[x]!.defId === 'Test Study');
    expect(costOf(s0, first!, STUDY)).toBe('{U}');
    expect(costOf(s0, find(s0, 'Test Bear', 'hand'), BEAR)).toBe('{1}{G}');
    const s1 = passBoth(castAuto(s0, 'Test Bear'));
    expect(costOf(s1, first!, STUDY)).toBe('{U}');
    const s2 = passBoth(castAuto(s1, 'Test Study'));
    expect(s2.zones.hand['p1']!.includes(second!)).toBe(true);
    expect(costOf(s2, second!, STUDY)).toBe('{3}{U}');
  });
});

describe('CR 118.9, 601.2b: conditional alternative costs', () => {
  it('"You may pay {B} rather than pay ~\'s mana cost if there are thirteen or more creatures on the battlefield": 12 creatures no, 13 yes (paid with one Swamp)', () => {
    const twelve = scenario(['Swamp'], { p1: { hand: ['Test Edict'], battlefield: ['Swamp', ...Array(6).fill('Test Bear')] }, p2: { battlefield: Array(6).fill('Test Bear') }, defs: ALL });
    expect(denied(twelve, 'p1', find(twelve, 'Test Edict', 'hand'), 'alternative')).toBe(true);
    const thirteen = scenario(['Swamp'], { p1: { hand: ['Test Edict'], battlefield: ['Swamp', ...Array(6).fill('Test Bear')] }, p2: { battlefield: Array(7).fill('Test Bear') }, defs: ALL });
    expect(denied(thirteen, 'p1', find(thirteen, 'Test Edict', 'hand'), 'alternative')).toBe(false);
    const s = castAuto(thirteen, 'Test Edict', { method: 'alternative' });
    expect(s.zones.stack.length).toBe(1);
    expect(untappedLands(s, 'p1')).toBe(0);
  });
  it('"If an opponent controls a Swamp and you control a Forest, you may cast ~ without paying its mana cost": no mana paid; both parts are needed', () => {
    const s0 = scenario(['Forest', 'Swamp'], { p1: { hand: ['Test Rain'], battlefield: ['Forest'] }, p2: { battlefield: ['Swamp'] }, defs: ALL });
    const id = find(s0, 'Test Rain', 'hand');
    expect(denied(s0, 'p1', id, 'alternative')).toBe(false);
    const s = passBoth(castAuto(s0, 'Test Rain', { method: 'alternative' }));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 6);
    expect(untappedLands(s, 'p1')).toBe(1);
    const noSwamp = scenario(['Forest'], { p1: { hand: ['Test Rain'], battlefield: ['Forest'] }, defs: ALL });
    expect(denied(noSwamp, 'p1', find(noSwamp, 'Test Rain', 'hand'), 'alternative')).toBe(true);
    const mySwamp = scenario(['Forest', 'Swamp'], { p1: { hand: ['Test Rain'], battlefield: ['Forest', 'Swamp'] }, defs: ALL });
    expect(denied(mySwamp, 'p1', find(mySwamp, 'Test Rain', 'hand'), 'alternative')).toBe(true);
  });
});

describe('CR 601.3, 101.2: casting restrictions of the spell itself', () => {
  it('"Cast ~ only during combat.": not in the first main phase, yes at the beginning of combat, not in the second main phase', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Embrace'], battlefield: ['Island'] }, defs: ALL });
    expect(denied(s0, 'p1', find(s0, 'Test Embrace', 'hand'))).toBe(true);
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(denied(combat, 'p1', find(combat, 'Test Embrace', 'hand'))).toBe(false);
    const after = advanceTo(s0, 1, 'main2');
    expect(denied(after, 'p1', find(after, 'Test Embrace', 'hand'))).toBe(true);
  });
  it('"You can\'t cast ~ unless there are seven or more cards in your graveyard.": six no, seven yes; the opponent\'s graveyard does not count', () => {
    const six = scenario(['Swamp'], { p1: { hand: ['Test Mastermind'], graveyard: Array(6).fill('Test Bear'), battlefield: ['Swamp', 'Swamp', 'Swamp'] }, p2: { graveyard: Array(7).fill('Test Bear') }, defs: ALL });
    expect(denied(six, 'p1', find(six, 'Test Mastermind', 'hand'))).toBe(true);
    const seven = scenario(['Swamp'], { p1: { hand: ['Test Mastermind'], graveyard: Array(7).fill('Test Bear'), battlefield: ['Swamp', 'Swamp', 'Swamp'] }, defs: ALL });
    expect(denied(seven, 'p1', find(seven, 'Test Mastermind', 'hand'))).toBe(false);
  });
});

describe('CR 601.3, 601.2a: "Your opponents can\'t cast spells from anywhere other than their hands."', () => {
  it('an opponent: from the hand yes, flashback from the graveyard no; its controller still may; without it the opponent may', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Magistrate', 'Mountain'], graveyard: ['Test Flashback'] }, p2: { hand: ['Test Spark'], graveyard: ['Test Flashback'], battlefield: ['Mountain'] }, defs: ALL });
    const s = pass(s0); // p2 has priority in p1's first main phase
    expect(s.pending?.player).toBe('p2');
    expect(denied(s, 'p2', find(s, 'Test Spark', 'hand', 'p2'))).toBe(false);
    expect(denied(s, 'p2', find(s, 'Test Flashback', 'graveyard', 'p2'), 'flashback')).toBe(true);
    expect(denied(s0, 'p1', find(s0, 'Test Flashback', 'graveyard', 'p1'), 'flashback')).toBe(false);
    const without = scenario(['Mountain'], { p2: { graveyard: ['Test Flashback'], battlefield: ['Mountain'] }, defs: ALL });
    expect(denied(pass(without), 'p2', find(without, 'Test Flashback', 'graveyard', 'p2'), 'flashback')).toBe(false);
  });
});

describe('CR 601.3, 602.5, 109.2: "During your turn, your opponents can\'t cast spells or activate abilities of artifacts, creatures, or enchantments."', () => {
  const board = (): GameState => scenario(['Mountain'], { p1: { battlefield: ['Test Abolisher', 'Test Pinger', 'Mountain'], hand: ['Test Spark'] }, p2: { hand: ['Test Spark', 'Test Cycler'], battlefield: ['Test Pinger', 'Test Spring', 'Mountain'] }, defs: ALL });
  const activations = (s: GameState, player: string, name: string): number => legal(s, player, 'activate').filter((a) => (a as { object?: string }).object !== undefined && s.objects[(a as { object: string }).object]?.defId === name).length;
  it("during its controller's turn: the opponent can't cast a spell or activate a creature's ability; a land's ability is fine; its controller is not restricted", () => {
    const s = pass(board());
    expect(s.pending?.player).toBe('p2');
    expect(denied(s, 'p2', find(s, 'Test Spark', 'hand', 'p2'))).toBe(true);
    expect(activations(s, 'p2', 'Test Pinger')).toBe(0);
    expect(activations(s, 'p2', 'Test Spring')).toBeGreaterThan(0);
    expect(activations(s, 'p2', 'Test Cycler')).toBeGreaterThan(0); // CR 109.2: a creature CARD in a hand is not a creature (cycling, CR 702.29a)
    const mine = board();
    expect(denied(mine, 'p1', find(mine, 'Test Spark', 'hand', 'p1'))).toBe(false);
    expect(activations(mine, 'p1', 'Test Pinger')).toBeGreaterThan(0);
  });
  it("during the opponent's turn the opponent casts and activates as usual", () => {
    const s = advanceTo(board(), 2, 'main1');
    expect(s.pending?.player).toBe('p2');
    expect(denied(s, 'p2', find(s, 'Test Spark', 'hand', 'p2'))).toBe(false);
    expect(activations(s, 'p2', 'Test Pinger')).toBeGreaterThan(0);
  });
});
