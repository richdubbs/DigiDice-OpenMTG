/**
 * Commander lane edh-combat, round edh-combat-7: readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). CR cites are checked against the real Comprehensive Rules text of 2026-09-25 where marked.
 *
 *   CR 500.8, 500.10, 303.4, 603.2   "At the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase."
 *   CR 508.7, 115.1                 "you may reselect which player or permanent target attacking creature is attacking" (Misleading Signpost)
 *   CR 702.48a-c, 601.2b, 601.2f   "Artifact offering": cast any time you could cast an instant by sacrificing an artifact; the total cost is reduced by its mana cost (colors included)
 *   CR 508.1b, 102.3                "Creatures attacking your opponents have double strike" (Blast-Furnace Hellkite)
 *   CR 506.4, 500.8, 508.1d, 601.3 "Cast this spell only during the declare blockers step on an opponent's turn. Remove all attacking creatures from combat and untap them. After this phase, there is an additional
 *                                  combat phase. Each of those creatures attacks that combat if able. They can't attack you or planeswalkers you control that combat." (Illusionist's Gambit)
 *   CR 509.1, 723.1, 508.1, 603.2c  "Whenever ~ and at least three other creatures attack, you choose which creatures block this combat and how those creatures block." (Odric, Master Tactician)
 *   CR 113.6m, 603.4, 508.4         a card in exile: "When a legendary creature you control attacks and isn't blocked, if ~ is exiled, put it onto the battlefield attacking." (Senu)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { advanceTo, pass, scenario } from '../../m3/scenario';
import { act, answer, find } from '../../m5/helpers';
import { applyAction, mayActAs } from '../../../src/index';
import { drive } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';
import { card, cast, full, resolveAll } from '../cmd3/helpers';
import { advanceTo as advanceToStep, labels } from '../../m5/helpers';
import { castCard } from '../../m5/announce/support';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const attackWith = (ids: ObjectId[], defender = 'p2') => ({ kind: 'declareAttackers' as const, attacks: ids.map((attacker) => ({ attacker, defender })) });
/** Pass priority (no blocks) until `done`. */
function run(s0: GameState, done: (s: GameState) => boolean, what: string): GameState {
  let s = s0;
  for (let i = 0; i < 200; i++) {
    if (done(s)) return s;
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else throw new Error(`waiting for ${what}, a ${s.pending?.kind} decision is pending`);
  }
  throw new Error(`never reached ${what}`);
}

const SHADOW = card('Test Shade', 'Enchantment — Aura', 'Enchant player\nAt the beginning of each of enchanted player\'s postcombat main phases, there is an additional beginning phase after this phase.');

describe('CR 500.8, 303.4, 603.2: "at the beginning of each of enchanted player\'s postcombat main phases, there is an additional beginning phase after this phase"', () => {
  const steps = (s0: GameState): string[] => {
    let s = s0;
    const out: string[] = [];
    for (let guard = 0; guard < 60 && !(s.turn.step === 'end' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      if (s.pending?.kind !== 'priority') throw new Error(`unexpected decision ${s.pending?.kind}`);
      if (out[out.length - 1] !== s.turn.step) out.push(s.turn.step);
      s = pass(s);
    }
    out.push(s.turn.step);
    return out;
  };
  const aura = (target: 'p1' | 'p2'): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shade'] }, defs: [SHADOW] });
    s = resolveAll(cast(s, 'Test Shade', { targets: [{ kind: 'player', id: target }] }));
    return s;
  };
  it('is fully automated', () => expect(full(SHADOW)).toBe(true));
  it("the enchanted player's postcombat main phase is followed by an additional beginning phase", () => {
    const s = advanceTo(aura('p2'), 2, 'main2');
    expect(steps(s)).toEqual(['main2', 'upkeep', 'draw', 'end']);
  });
  it("the negative case: the Aura's controller's own postcombat main phase gets none while another player is enchanted", () => {
    const s = advanceTo(aura('p2'), 3, 'main2');
    expect(steps(s)).toEqual(['main2', 'end']);
  });
  it('the Aura on its own controller adds the phase on their turn instead (the attachment decides)', () => {
    const s = advanceTo(aura('p1'), 3, 'main2');
    expect(steps(s)).toEqual(['main2', 'upkeep', 'draw', 'end']);
  });
});

// ---- Misleading Signpost: reselect what a target attacking creature attacks ---------------------------------------------------------------------------------
const COMPASS = synthetic('Test Compass', 'Artifact', '{0}', 'Flash\nWhen ~ enters during the declare attackers step, you may reselect which player or permanent target attacking creature is attacking.');
const RAIDER = synthetic('Test Raider', 'Creature — Warrior', '{1}', '', { power: '3', toughness: '3' });
const SAGE = synthetic('Test Wall Sage', 'Legendary Planeswalker — Sage', '{2}', '+1: You gain 1 life.', { loyalty: '4' });
describe('CR 508.7, 115.1: "When ~ enters during the declare attackers step, you may reselect which player or permanent target attacking creature is attacking."', () => {
  const defs = [COMPASS, RAIDER, SAGE];
  const setup = (): { s: GameState; raider: ObjectId; sage: ObjectId } => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Raider'], hand: ['Test Compass'] }, p2: { battlefield: [{ name: 'Test Wall Sage', counters: { loyalty: 4 } }] } });
    const raider = onField(s, 'Test Raider')!;
    const sage = onField(s, 'Test Wall Sage')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([raider])));
    return { s, raider, sage };
  };
  const flashIn = (s0: GameState, raider: ObjectId, pick: string | null): GameState => {
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Compass', 'hand', 'p1') }));
    s = pass(pass(s)); // the artifact spell resolves, its enters trigger asks for a target
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: raider }] });
    s = pass(pass(s)); // the trigger resolves
    if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: pick === null ? [] : [pick] });
    return s;
  };
  const defenderOf = (s: GameState, id: ObjectId): string | null | undefined => s.combat?.attackers.find((a) => a.id === id)?.defender;
  it('is full', () => expect(full(COMPASS)).toBe(true));
  it('the target attacker attacks the planeswalker instead of the player; the damage goes to the planeswalker', () => {
    const { s: s0, raider, sage } = setup();
    expect(defenderOf(s0, raider)).toBe('p2');
    const s = flashIn(s0, raider, sage);
    expect(defenderOf(s, raider)).toBe(sage);
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(lifeOf(t, 'p2')).toBe(20);
    expect(t.objects[sage]!.counters['loyalty']).toBe(1);
  });
  it('"you may": keeping what it attacks is allowed (the player takes the damage)', () => {
    const { s: s0, raider } = setup();
    const s = flashIn(s0, raider, null);
    expect(defenderOf(s, raider)).toBe('p2');
    expect(lifeOf(run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2'), 'p2')).toBe(17);
  });
  it('the negative case: entering in the main phase triggers nothing (the declare attackers step is required)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Raider'], hand: ['Test Compass'] }, p2: { battlefield: [{ name: 'Test Wall Sage', counters: { loyalty: 4 } }] } });
    s = pass(pass(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Compass', 'hand', 'p1') }))));
    expect(s.zones.stack).toHaveLength(0);
    expect(s.pending?.kind).toBe('priority');
  });
});

// ---- Senu: a triggered ability of a card in exile -----------------------------------------------------------------------------------------------------------
const HAWK = synthetic('Test Hawk', 'Legendary Creature — Bird Scout', '{2}{W}', 'Flying, vigilance\nWhen a legendary creature you control attacks and isn\'t blocked, if ~ is exiled, put it onto the battlefield attacking.', { power: '2', toughness: '2' });
const KNIGHT = synthetic('Test Knight', 'Legendary Creature — Human Knight', '{1}', '', { power: '3', toughness: '3' });
const SQUIRE = synthetic('Test Squire', 'Creature — Human', '{1}', '', { power: '3', toughness: '3' });
const WALL = synthetic('Test Wall', 'Creature — Wall', '{1}', 'Defender', { power: '0', toughness: '5' });
describe('CR 113.6m, 603.4, 508.4: "When a legendary creature you control attacks and isn\'t blocked, if ~ is exiled, put it onto the battlefield attacking."', () => {
  const defs = [HAWK, KNIGHT, SQUIRE, WALL];
  const attack = (z: { exile?: string[]; hand?: string[]; battlefield?: string[] }, attacker: string, block = false): GameState => {
    let s = scenario([], { defs, p1: { battlefield: [attacker, ...(z.battlefield ?? [])], ...(z.exile ? { exile: z.exile } : {}), ...(z.hand ? { hand: z.hand } : {}) }, p2: { battlefield: block ? ['Test Wall'] : [] } });
    const a = onField(s, attacker)!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([a])));
    if (block) {
      s = run(s, (x) => x.pending?.kind === 'declareBlockers', 'declare blockers');
      s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: onField(s, 'Test Wall')!, attacker: a }] });
    }
    return run(drive(s), (x) => x.turn.step === 'combatDamage' && x.pending?.kind === 'priority', 'combat damage');
  };
  it('is full', () => expect(full(HAWK)).toBe(true));
  it('an unblocked legendary attacker brings the exiled card onto the battlefield attacking: it deals its damage too', () => {
    const s = attack({ exile: ['Test Hawk'] }, 'Test Knight');
    const hawk = onField(s, 'Test Hawk');
    expect(hawk).toBeDefined();
    expect(s.combat!.attackers.map((a) => a.id)).toContain(hawk);
    expect(s.objects[hawk!]!.tapped).toBe(false); // attacking, not tapped
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(lifeOf(t, 'p2')).toBe(15); // the knight's 3 and the hawk's 2
  });
  it('the negative cases: a blocked attacker, a creature that is not legendary, and a card that is not in exile (in hand) put nothing onto the battlefield', () => {
    expect(onField(attack({ exile: ['Test Hawk'] }, 'Test Knight', true), 'Test Hawk')).toBeUndefined();
    expect(onField(attack({ exile: ['Test Hawk'] }, 'Test Squire'), 'Test Hawk')).toBeUndefined();
    expect(onField(attack({ hand: ['Test Hawk'] }, 'Test Knight'), 'Test Hawk')).toBeUndefined();
  });
  it('on the battlefield the ability does nothing (its condition needs the card in exile)', () => {
    const s = attack({ battlefield: ['Test Hawk'] }, 'Test Knight');
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Hawk')).toHaveLength(1);
  });
});

// ---- Blast-Furnace Hellkite: artifact offering ----------------------------------------------------------------------------------------------------------------
const DRAKE = synthetic('Test Drake', 'Creature — Dragon', '{4}{R}{R}', 'Artifact offering\nFlying, double strike\nCreatures attacking your opponents have double strike.', { power: '6', toughness: '5' });
const IDOL = synthetic('Test Idol', 'Artifact', '{2}{R}', '');
const TRINKET = synthetic('Test Trinket', 'Artifact', '{U}', '');
const COLOSSUS = synthetic('Test Colossus', 'Artifact', '{9}', '');
const BALLISTA = synthetic('Test Ballista', 'Artifact Creature — Construct', '{X}{X}', '', { power: '1', toughness: '1' });
const OFFER_DEFS = [DRAKE, IDOL, TRINKET, COLOSSUS, BALLISTA];
describe('CR 702.48a-c: "Artifact offering" (cast any time you could cast an instant by sacrificing an artifact; the total cost is reduced by its mana cost)', () => {
  const board = (battlefield: string[], lands: number): GameState =>
    scenario(['Mountain'], { defs: OFFER_DEFS, p1: { hand: ['Test Drake'], battlefield: [...battlefield, ...Array(lands).fill('Mountain')] } });
  const names = (s: GameState, zone: 'battlefield' | 'stack'): string[] => s.zones[zone].map((id) => nameOf(s, id));
  const inYard = (s: GameState, name: string): boolean => (s.zones.graveyard['p1'] ?? []).some((id) => nameOf(s, id) === name);
  const manaPaid = (s: GameState): number => s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.length;
  it('is full', () => expect(full(DRAKE)).toBe(true));
  it('during the beginning of combat step (no sorcery timing) it is offered only by the offering method; sacrificing the {2}{R} artifact reduces {4}{R}{R} to {2}{R}', () => {
    let s = advanceToStep(board(['Test Idol'], 3), 1, 'beginCombat');
    expect(labels(s, 'p1')).toContain('Cast Test Drake (offering)');
    expect(labels(s, 'p1')).not.toContain('Cast Test Drake');
    s = castCard(s, 'Test Drake', { method: 'offering' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Idol')!] });
    s = drive(s);
    expect(names(s, 'stack')).toEqual(['Test Drake']);
    expect(inYard(s, 'Test Idol')).toBe(true);
    expect(manaPaid(s)).toBe(3);
  });
  it('colored mana reduces its own color and the excess generic: a {U} artifact takes off {1} generic (the cost has no blue), leaving {3}{R}{R}', () => {
    expect(labels(advanceToStep(board(['Test Trinket'], 4), 1, 'beginCombat'), 'p1')).not.toContain('Cast Test Drake (offering)'); // four lands are one short of five
    let s = advanceToStep(board(['Test Trinket'], 5), 1, 'beginCombat');
    s = castCard(s, 'Test Drake', { method: 'offering' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Trinket')!] });
    s = drive(s);
    expect(manaPaid(s)).toBe(5);
  });
  it('the total cost never drops below {0}: a {9} artifact makes the spell cost {R}{R} (generic mana only)', () => {
    let s = advanceToStep(board(['Test Colossus'], 2), 1, 'beginCombat');
    s = castCard(s, 'Test Drake', { method: 'offering' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Colossus')!] });
    s = drive(s);
    expect(manaPaid(s)).toBe(2);
  });
  it('an {X} in the mana cost of the sacrificed artifact counts as 0 (CR 107.3): it may be sacrificed and reduces nothing', () => {
    let s = advanceToStep(board(['Test Ballista'], 6), 1, 'beginCombat');
    expect(labels(s, 'p1')).toContain('Cast Test Drake (offering)');
    s = castCard(s, 'Test Drake', { method: 'offering' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Ballista')!] });
    s = drive(s);
    expect(manaPaid(s)).toBe(6);
  });
  it('the negative cases: without an artifact there is no offering cast; in a main phase the plain cast costs the full {4}{R}{R} and sacrifices nothing', () => {
    expect(labels(advanceToStep(board([], 6), 1, 'beginCombat'), 'p1')).not.toContain('Cast Test Drake (offering)');
    let s = board(['Test Idol'], 6);
    s = drive(castCard(s, 'Test Drake'));
    expect(manaPaid(s)).toBe(6);
    expect(onField(s, 'Test Idol')).toBeDefined();
  });
});

describe('CR 508.1b, 102.3: "Creatures attacking your opponents have double strike."', () => {
  const GIANT = synthetic('Test Giant', 'Creature — Giant', '{1}', '', { power: '4', toughness: '4' });
  it('your attacker has double strike while it attacks one of your opponents (the static ability, not its controller, decides)', () => {
    const defs = [...OFFER_DEFS, GIANT];
    let s = scenario([], { defs, p1: { battlefield: ['Test Drake', 'Test Giant'] } });
    const giant = onField(s, 'Test Giant')!;
    expect(getChars(s, giant)!.keywords?.some?.((k) => String(k).toLowerCase().includes('double strike')) ?? false).toBe(false);
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([giant])));
    expect(JSON.stringify(getChars(s, giant)!.abilities)).toContain('double strike');
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(lifeOf(t, 'p2')).toBe(12); // double strike: 4 + 4
  });
  it('the negative case: without the Dragon the same attacker deals its damage once', () => {
    let s = scenario([], { defs: [...OFFER_DEFS, GIANT], p1: { battlefield: ['Test Giant'] } });
    const giant = onField(s, 'Test Giant')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([giant])));
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(lifeOf(t, 'p2')).toBe(16);
  });
});

// ---- Illusionist's Gambit ---------------------------------------------------------------------------------------------------------------------------------
const GAMBIT = synthetic('Test Gambit', 'Instant', '{0}', "Cast this spell only during the declare blockers step on an opponent's turn.\nRemove all attacking creatures from combat and untap them. After this phase, there is an additional combat phase. Each of those creatures attacks that combat if able. They can't attack you or planeswalkers you control that combat.");
const REGROUP = synthetic('Test Regroup', 'Instant', '{0}', 'Remove all attacking creatures from combat and untap them. After this phase, there is an additional combat phase. Each of those creatures attacks that combat if able. They can\'t attack you or planeswalkers you control that combat.');
const BRUTE = synthetic('Test Brute', 'Creature — Ogre', '{1}', '', { power: '3', toughness: '3' });
const SCOUT = synthetic('Test Scout', 'Creature — Human', '{1}', '', { power: '2', toughness: '2' });
const WARDEN = synthetic('Test Warden', 'Legendary Planeswalker — Warden', '{2}', '+1: You gain 1 life.', { loyalty: '4' });
describe('CR 506.4, 500.8, 508.1d: "Remove all attacking creatures from combat and untap them. After this phase, there is an additional combat phase. Each of those creatures attacks that combat if able. ..."', () => {
  const defs = [GAMBIT, REGROUP, BRUTE, SCOUT, WARDEN];
  /** p1's turn: the Brute attacks, the Scout stays home; at the declare blockers step p1 casts the regrouping spell. */
  const regrouped = (): { s: GameState; brute: ObjectId; scout: ObjectId } => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Brute', 'Test Scout'], hand: ['Test Regroup'] }, p2: { battlefield: [{ name: 'Test Warden', counters: { loyalty: 4 } }] } });
    const brute = onField(s, 'Test Brute')!;
    const scout = onField(s, 'Test Scout')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([brute])));
    s = run(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'declare blockers');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Regroup', 'hand', 'p1') }));
    s = pass(pass(s)); // it resolves
    return { s, brute, scout };
  };
  it('is full', () => { expect(full(GAMBIT)).toBe(true); expect(full(REGROUP)).toBe(true); });
  it('the attacker leaves combat untapped and no damage is dealt in the first combat', () => {
    const { s, brute } = regrouped();
    expect(s.combat?.attackers.some((a) => a.id === brute) ?? false).toBe(false);
    expect(s.objects[brute]!.tapped).toBe(false);
    const t = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the added declare attackers step');
    expect(lifeOf(t, 'p2')).toBe(20);
    expect(t.turn.number).toBe(1);
  });
  it('in the additional combat phase the removed creature attacks if able: a declaration without it is refused; with it, it deals its damage; the creature that did not attack before is free to stay home', () => {
    const { s, brute, scout } = regrouped();
    const t = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the added declare attackers step');
    const bad = applyAction(t, answer0({ kind: 'declareAttackers', attacks: [] }, t));
    expect(bad.error).toBeDefined();
    expect(bad.error?.rules?.some((r) => r.includes('508.1d'))).toBe(true);
    const u = drive(answer(t, attackWith([brute])));
    const w = run(u, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(lifeOf(w, 'p2')).toBe(17);
    expect(w.objects[scout]!.tapped).toBe(false);
  });
  it('the negative case: without the spell a creature that attacked is not forced to attack again, and no combat phase is added', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Brute'] } });
    const brute = onField(s, 'Test Brute')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([brute])));
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(lifeOf(t, 'p2')).toBe(17);
    expect(t.turn.step).toBe('main2');
  });
  const answer0 = (a: Parameters<typeof answer>[1], s: GameState) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });
});

describe('CR 601.3, 500.1, 508.1b, 506.3: Illusionist\'s Gambit cast on an opponent\'s declare blockers step: the removed creatures can\'t attack you or your planeswalkers that combat', () => {
  const defs = [GAMBIT, BRUTE, SCOUT, WARDEN];
  const THE_BRUTE = 'Test Brute';
  /** p2's turn: its Brute attacks p1; at the declare blockers step p1 casts the Gambit. */
  const setup = (): { s: GameState; brute: ObjectId; scout: ObjectId; warden: ObjectId } => {
    let s = scenario([], { defs, p1: { hand: ['Test Gambit'], battlefield: [{ name: 'Test Warden', counters: { loyalty: 4 } }] }, p2: { battlefield: [THE_BRUTE, 'Test Scout'] } });
    const brute = onField(s, THE_BRUTE)!;
    const scout = onField(s, 'Test Scout')!;
    const warden = onField(s, 'Test Warden')!;
    s = run(s, (x) => x.turn.number === 2 && x.turn.step === 'declareAttackers' && x.pending?.kind === 'declareAttackers', 'the opponent\'s declare attackers');
    s = drive(answer(s, attackWith([brute], 'p1')));
    return { s, brute, scout, warden };
  };
  const toBlockers = (s0: GameState): GameState => run(s0, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'p1 priority in declare blockers');
  it('is castable only during the declare blockers step of an opponent\'s turn', () => {
    const { s } = setup();
    expect(labels(s, 'p1')).not.toContain('Cast Test Gambit'); // the declare attackers step
    const t = toBlockers(s);
    expect(labels(t, 'p1')).toContain('Cast Test Gambit');
    // p1's own declare blockers step: not an opponent's turn
    let own = scenario([], { defs, p1: { hand: ['Test Gambit'], battlefield: ['Test Brute'] } });
    const b = onField(own, 'Test Brute')!;
    own = run(own, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    own = drive(answer(own, attackWith([b])));
    own = run(own, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'declare blockers');
    expect(labels(own, 'p1')).not.toContain('Cast Test Gambit');
  });
  it('removes the attacking creature from combat and untaps it; in the added combat it can\'t attack the caster or the caster\'s planeswalker, while a creature that did not attack before can attack the caster', () => {
    const { s: s0, brute, scout, warden } = setup();
    let s = toBlockers(s0);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gambit', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.combat?.attackers.some((a) => a.id === brute) ?? false).toBe(false);
    expect(s.objects[brute]!.tapped).toBe(false);
    const t = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the added declare attackers step');
    expect(t.pending!.player).toBe('p2');
    for (const defender of ['p1', warden]) {
      const r = applyAction(t, { type: 'answer', player: 'p2', decisionId: t.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: brute, defender }] } });
      expect(r.error, `the Brute attacking ${defender}`).toBeDefined();
    }
    const u = drive(answer(t, attackWith([scout], 'p1')));
    expect(u.combat!.attackers.map((a) => a.id)).toEqual([scout]);
    const w = run(u, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(lifeOf(w, 'p1')).toBe(18);
  });
});

// ---- Odric, Master Tactician: control of the block declaration -----------------------------------------------------------------------------------------------------
const MARSHAL = synthetic('Test Marshal', 'Legendary Creature — Human Soldier', '{0}', "First strike\nWhenever ~ and at least three other creatures attack, you choose which creatures block this combat and how those creatures block.", { power: '2', toughness: '2' });
const PIKE = synthetic('Test Pikeman', 'Creature — Human Soldier', '{0}', '', { power: '1', toughness: '1' });
const GUARD = synthetic('Test Guard', 'Creature — Human Soldier', '{0}', '', { power: '2', toughness: '2' });
const SENTRY = synthetic('Test Sentry', 'Creature — Human Soldier', '{0}', '', { power: '1', toughness: '3' });
describe('CR 509.1, 723.1, 603.2c: "Whenever ~ and at least three other creatures attack, you choose which creatures block this combat and how those creatures block."', () => {
  const defs = [MARSHAL, PIKE, GUARD, SENTRY];
  /** p1 attacks with the Marshal and `others` Pikemen; p2 has a Guard and a Sentry. Returns the state when blockers are to be declared. */
  const toBlocks = (others: number): { s: GameState; marshal: ObjectId; pikes: ObjectId[]; guard: ObjectId; sentry: ObjectId } => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Marshal', ...Array(others).fill('Test Pikeman')] }, p2: { battlefield: ['Test Guard', 'Test Sentry'] } });
    const marshal = onField(s, 'Test Marshal')!;
    const pikes = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Pikeman');
    const guard = onField(s, 'Test Guard')!;
    const sentry = onField(s, 'Test Sentry')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([marshal, ...pikes])));
    s = run(s, (x) => x.pending?.kind === 'declareBlockers', 'declare blockers');
    return { s, marshal, pikes, guard, sentry };
  };
  it('is full', () => expect(full(MARSHAL)).toBe(true));
  it('with three other attackers the attacking player decides the blocks: the decision is p2\'s, answered from p1\'s seat only; the blocks they choose are made', () => {
    const { s, marshal, pikes, guard, sentry } = toBlocks(3);
    expect(s.pending!.kind).toBe('declareBlockers');
    expect(s.pending!.player).toBe('p2');
    expect(s.pending!.decidedBy).toBe('p1');
    const act1 = { type: 'answer' as const, player: 'p2' as const, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks: [{ blocker: guard, attacker: marshal }, { blocker: sentry, attacker: pikes[0]! }] } };
    expect(mayActAs(s, 'p1', act1)).toBe(true);
    expect(mayActAs(s, 'p2', act1)).toBe(false);
    const t = applyAction(s, act1).state;
    expect(t.combat!.blockers.map((b) => b.id).sort()).toEqual([guard, sentry].sort());
    expect(t.combat!.attackers.find((a) => a.id === marshal)!.blockedBy).toEqual([guard]);
  });
  it('the blocks must still be legal: a creature that is not a defender\'s blocker can\'t be named, and a creature can\'t block twice', () => {
    const { s, marshal, pikes, guard } = toBlocks(3);
    const bad = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: pikes[0]!, attacker: marshal }] } });
    expect(bad.error).toBeDefined();
    const twice = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: guard, attacker: marshal }, { blocker: guard, attacker: pikes[0]! }] } });
    expect(twice.error).toBeDefined();
  });
  it('the negative case: with only two other attackers the defending player declares their own blockers (nobody else answers)', () => {
    const { s } = toBlocks(2);
    expect(s.pending!.kind).toBe('declareBlockers');
    expect(s.pending!.player).toBe('p2');
    expect(s.pending!.decidedBy).toBeUndefined();
    expect(mayActAs(s, 'p1', { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [] } })).toBe(false);
  });
  it('the choice lasts this combat only: once the combat phase is over nothing is left of it', () => {
    const { s, guard, marshal } = toBlocks(3);
    expect(s.combat!.blocksBy).toBe('p1');
    const t = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: guard, attacker: marshal }] } }).state;
    const u = run(t, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(u.combat ?? null).toBeNull();
  });
});

describe('edh-combat-7: the exile trigger rewrites a bare "it" only in a one-sentence effect', () => {
  it('a second sentence with "it" is not read as the exiled card (it names the returned card or the ability stays manual)', () => {
    const d = synthetic('Test Cat', 'Legendary Creature — Cat', '{1}', "When a legendary creature you control attacks and isn't blocked, if ~ is exiled, return target creature card from your graveyard to your hand. It gains haste until end of turn.", { power: '1', toughness: '1' });
    expect(full(d) ? JSON.stringify(d.faces).split('"effect"')[1] ?? '' : '').not.toMatch(/"affects":\{"ref":"self"\}/);
  });
});
