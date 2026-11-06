/**
 * Commander coordinator D, round edh-d-88 (must-finish band 5,001-10,000, group combat): the round's readings and engine pieces played through the engine with synthetic cards (invented names,
 * design 6.10), in 4-player games, with negative cases. Alice (p1) is the active player of turn 1. CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-05).
 *
 *   CR 508.1d, 506.4     "If a creature an opponent controls attacks, all creatures that opponent controls attack if able." (War's Toll)
 *   CR 508.1b, 109.4, 508.4  "Whenever ~ attacks a player who controls eight or more lands, ... You may put a creature card from among them onto the battlefield tapped and attacking that player."
 *                        (Owlbear Cub)
 *   CR 601.2b, 118.9, 202.3, 608.2g  "Whenever ~ attacks, you may cast an artifact spell from your hand or graveyard by paying life equal to its mana value rather than paying its mana cost."
 *                        (Anrakyr the Traveller; rulings 2022-10-07: only the life cost, X is 0)
 *   CR 104.3e, 122.1, 406.1, 608.2b  "Whenever ~ deals combat damage to a player, exile target creature that player controls and put a hit counter on that card. That player loses the game
 *                        if they own three or more exiled cards with hit counters on them. ~'s owner shuffles ~ into their library." (Etrata, the Silencer; rulings 2018-10-05)
 *   CR 107.14, 122.1, 608.2h, 702.151a, 118.12a  "... you get {E}, then it gets +X/+X until end of turn, where X is the amount of {E} you have." / "Reconfigure--Pay {2} or {E}{E}{E}."
 *                        (Razorfield Ripper; rulings 2024-06-07: X is counted once, as the ability resolves)
 *   CR 601.2f, 118.7, 611.2c, 608.2h, 506.2  "Whenever you attack, spells you cast from exile this turn cost {X} less to cast, where X is the number of players being attacked. Exile the top X
 *                        cards of your library. Until end of turn, you may cast spells from among those exiled cards." (Commander Liara Portyr; rulings 2022-06-10)
 *   CR 602.2, 602.2a, 508.7, 508.7c  "{2}: Put a +1/+1 counter on ~, then you may reselect which player ~ is attacking. Only the player ~ is attacking may activate this ability and only during
 *                        the declare attackers step." (Capricopian; rulings 2020-04-17)
 *   CR 701.21a, 608.2e, 608.2c, 115.1  "Whenever ~ attacks, for each player, choose target permanent that player controls. Those players sacrifice those permanents. Each player who sacrificed
 *                        a permanent this way reveals the top card of their library, then puts it onto the battlefield if it's a permanent card." (Vaevictis Asmadi, the Dire; rulings 2018-07-13)
 *   CR 701.62a, 122.1, 608.2d, 701.40g  "manifest dread, then put two +1/+1 counters and a trample counter on that creature" / "turn that creature face up or put a +1/+1 counter on it"
 *                        (Experimental Lab // Staff Room; rulings 2024-09-20)
 *   CR 508.1d, 611.2a, 500.8  "Whenever a land you control enters, target creature an opponent controls attacks during its controller's next combat phase if able." (Trench Behemoth; rulings 2020-11-10)
 */
import { describe, expect, it } from 'vitest';
import { obeyRequirements, type DeclareAttackersDecision, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { requirementsFor } from '../../../src/rules/requirements';
import { find, findAll, mpScenario, put, reject } from '../../m12/rules/helpers';
import { declareAttackers, declareBlockers, legalOf, toDeclareAttackers, tweak } from '../../m4/helpers';
import { act, answer } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { card, full, settle } from '../cmd3/helpers';
import { pass } from '../../m3/scenario';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const attackDecision = (s: GameState, attacks: [ObjectId, PlayerId | ObjectId][]): { type: 'answer'; player: PlayerId; decisionId: string; answer: DecisionAnswer } =>
  ({ type: 'answer', player: s.pending!.player as PlayerId, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) } });

// ---- War's Toll: if one attacks, all attack ---------------------------------------------------------------------------------------------------------------------------------
const TOLL = card('Test Toll of Strife', 'Enchantment', 'If a creature an opponent controls attacks, all creatures that opponent controls attack if able.');
describe("CR 508.1d, 506.4: \"If a creature an opponent controls attacks, all creatures that opponent controls attack if able.\" (War's Toll)", () => {
  const start = (): GameState => mpScenario({ defs: [TOLL, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Bear', 'Test Goblin', 'Test Goblin'] }, p2: { battlefield: ['Test Toll of Strife'] } } });
  const mine = (s: GameState): ObjectId[] => [find(s, 'Test Bear', 'battlefield', 'p1'), ...findAll(s, 'Test Goblin', 'battlefield', 'p1')];
  it('is automated', () => expect(full(TOLL)).toBe(true));
  it('the active player has one conditional requirement for each creature that can attack, none of which binds a creature alone', () => {
    const reqs = requirementsFor(start(), 'attack', 'p1');
    expect(reqs).toHaveLength(3);
    expect(reqs.every((r) => r.allIfAny === true && r.group?.length === 3)).toBe(true);
    const d = toDeclareAttackers(start()).pending as DeclareAttackersDecision;
    expect(d.candidates.some((c) => c.mustAttack === true)).toBe(false);
  });
  it('declaring no attackers is legal (the condition is false, so nothing must attack)', () => {
    const s0 = toDeclareAttackers(start());
    expect(declareAttackers(s0, []).combat?.attackers ?? []).toHaveLength(0);
  });
  it('once one creature attacks, every creature of that player that can attack must attack (any players: each chooses its own defender)', () => {
    const s0 = toDeclareAttackers(start());
    const [bear, g1, g2] = mine(s0);
    expect(reject(s0, attackDecision(s0, [[bear!, 'p2']])).rules).toContain('CR 508.1d');
    expect(reject(s0, attackDecision(s0, [[bear!, 'p2'], [g1!, 'p3']])).rules).toContain('CR 508.1d');
    expect(declareAttackers(s0, [[bear!, 'p2'], [g1!, 'p3'], [g2!, 'p4']]).combat?.attackers.length).toBe(3);
  });
  it('a creature that can\'t attack (tapped) is not bound: the others attacking is enough (CR 508.1d "if able")', () => {
    const s0 = toDeclareAttackers(tweak(start(), (x) => { x.objects[findAll(x, 'Test Goblin', 'battlefield', 'p1')[1]!]!.tapped = true; }));
    const [bear, g1] = mine(s0);
    expect(requirementsFor(s0, 'attack', 'p1')).toHaveLength(2);
    expect(declareAttackers(s0, [[bear!, 'p3'], [g1!, 'p3']]).combat?.attackers.length).toBe(2);
  });
  it("negative: War's Toll's controller is bound by nothing on their own turn (it names creatures of an opponent)", () => {
    const own = mpScenario({ defs: [TOLL, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Toll of Strife', 'Test Bear', 'Test Goblin'] } } });
    expect(requirementsFor(own, 'attack', 'p1')).toEqual([]);
    const s0 = toDeclareAttackers(own);
    expect(declareAttackers(s0, [[find(s0, 'Test Bear', 'battlefield', 'p1'), 'p2']]).combat?.attackers.length).toBe(1);
  });
  it("review: a creature that can't attack alone may still not attack alone under War's Toll (CR 506.5, 508.1c: the empty declaration obeys the requirement, so nothing forces the lone attack)", () => {
    const FLUNKY = card('Test Lone Flunky', 'Creature — Goblin', "This creature can't attack alone.", ['1', '1']);
    const s0 = toDeclareAttackers(mpScenario({ defs: [TOLL, FLUNKY], zones: { p1: { battlefield: ['Test Lone Flunky'] }, p2: { battlefield: ['Test Toll of Strife'] } } }));
    expect(reject(s0, attackDecision(s0, [[find(s0, 'Test Lone Flunky', 'battlefield', 'p1'), 'p2']])).rules).toContain('CR 506.5');
    expect(declareAttackers(s0, []).combat?.attackers ?? []).toHaveLength(0);
  });
  it('bots and clients: an answer with one attacker is completed with the rest of the group; an empty answer stays empty', () => {
    const s0 = toDeclareAttackers(start());
    const d = s0.pending as DeclareAttackersDecision;
    const [bear] = mine(s0);
    expect(obeyRequirements(d, [])).toEqual([]);
    const fixed = obeyRequirements(d, [{ attacker: bear!, defender: 'p3' }]);
    expect(fixed).toHaveLength(3);
    expect(fixed[0]).toEqual({ attacker: bear!, defender: 'p3' });
    expect(declareAttackers(s0, fixed.map((a) => [a.attacker, a.defender] as [ObjectId, PlayerId | ObjectId])).combat?.attackers.length).toBe(3);
  });
});

// ---- Owlbear Cub: attacks a player who controls eight or more lands -------------------------------------------------------------------------------------------------------
const CUB = card('Test Owl Cub', 'Creature — Bird Bear', 'Whenever this creature attacks a player who controls eight or more lands, look at the top eight cards of your library. You may put a creature card from among them onto the battlefield tapped and attacking that player. Put the rest on the bottom of your library in a random order.', ['2', '2']);
describe('CR 508.1b, 109.4, 508.4: "Whenever ~ attacks a player who controls eight or more lands, ... tapped and attacking that player" (Owlbear Cub)', () => {
  const lands = (n: number): string[] => Array(n).fill('Plains') as string[];
  const onTop = (s: GameState): void => { const id = put(s, 'p1', 'library', 'Test Bear'); s.zones.library['p1'] = [id, ...s.zones.library['p1']!.filter((x) => x !== id)]; }; // index 0: the top
  const start = (p2Lands: number): GameState => tweak(mpScenario({ defs: [CUB, BEAR], zones: { p1: { battlefield: ['Test Owl Cub'] }, p2: { battlefield: lands(p2Lands) }, p3: { battlefield: lands(9) } } }), onTop);
  const attack = (s0: GameState, defender: PlayerId): GameState => {
    const s = toDeclareAttackers(s0);
    let t = declareAttackers(s, [[find(s, 'Test Owl Cub', 'battlefield', 'p1'), defender]]);
    for (let i = 0; i < 12 && t.zones.stack.length === 0 && t.turn.step === 'declareAttackers'; i++) t = pass(t);
    return t;
  };
  it('is automated', () => expect(full(CUB)).toBe(true));
  it('attacking a player with eight lands triggers it; the creature card put onto the battlefield is tapped and attacking THAT player', () => {
    let s = attack(start(8), 'p2');
    expect(s.zones.stack.length).toBe(1);
    const inLib = s.zones.library['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear');
    expect(inLib).toHaveLength(1);
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = settle(pass(s), { objects: inLib });
    const bear = findAll(s, 'Test Bear', 'battlefield', 'p1');
    expect(bear, s.log.slice(-12).map((l) => l.text).join('\n')).toHaveLength(1);
    expect(s.objects[bear[0]!]!.tapped).toBe(true);
    expect(s.combat?.attackers.find((a) => a.id === bear[0])?.defender).toBe('p2');
  });
  it('the player of the choice may put nothing ("you may"); the rest goes to the bottom', () => {
    let s = attack(start(8), 'p2');
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) {
      s = pass(s);
      if (s.pending?.kind === 'chooseObjects') s = settle(s, { objects: [] });
      else s = settle(s, {});
    }
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
  });
  it('negative: attacking a player with seven lands does not trigger it (the land count is read as the attack is declared)', () => {
    const s = attack(start(7), 'p2');
    expect(s.zones.stack.length).toBe(0);
  });
});

// ---- Anrakyr the Traveller: cast an artifact spell from hand or graveyard for life -----------------------------------------------------------------------------------------
const TRAVELLER = card('Test Tomb Traveller', 'Creature — Necron', 'Whenever this creature attacks, you may cast an artifact spell from your hand or graveyard by paying life equal to its mana value rather than paying its mana cost.', ['4', '4']);
const IDOL = card('Test Brass Idol', 'Artifact', '', undefined, '{3}');
const STATUE = card('Test Clay Statue', 'Artifact Creature — Golem', '', ['2', '2'], '{2}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
describe('CR 601.2b, 118.9, 202.3, 608.2g: "Whenever ~ attacks, you may cast an artifact spell from your hand or graveyard by paying life ..." (Anrakyr the Traveller)', () => {
  const start = (): GameState => mpScenario({ defs: [TRAVELLER, IDOL, STATUE, OGRE], zones: { p1: { battlefield: ['Test Tomb Traveller'], graveyard: ['Test Brass Idol'], hand: ['Test Clay Statue', 'Test Ogre'] } } });
  const attacked = (): GameState => {
    const s = toDeclareAttackers(start());
    let t = declareAttackers(s, [[find(s, 'Test Tomb Traveller', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 12 && t.zones.stack.length === 0 && t.turn.step === 'declareAttackers'; i++) t = pass(t);
    return t;
  };
  const resolveWith = (s0: GameState, pick: (s: GameState) => ObjectId[]): GameState => {
    let s = s0;
    for (let i = 0; i < 20 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseObjects') s = settle(s, { objects: pick(s) });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s, {});
    }
    return s;
  };
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('is automated', () => expect(full(TRAVELLER)).toBe(true));
  it('the choice offers the artifact cards of the hand and the graveyard (not the Ogre); the one chosen is cast for life equal to its mana value and resolves', () => {
    const s0 = attacked();
    expect(s0.zones.stack.length).toBe(1);
    let offered: string[] = [];
    const s = resolveWith(s0, (x) => {
      offered = (x.pending as unknown as { options: ObjectId[] }).options.map((id) => x.defs[x.objects[id]!.defId]!.name).sort();
      return (x.pending as unknown as { options: ObjectId[] }).options.filter((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Brass Idol');
    });
    expect(offered).toEqual(['Test Brass Idol', 'Test Clay Statue']);
    expect(findAll(s, 'Test Brass Idol', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s)).toBe(20 - 3);
  });
  it('from the hand too: the artifact creature card is cast for 2 life', () => {
    const s = resolveWith(attacked(), (x) => (x.pending as unknown as { options: ObjectId[] }).options.filter((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Clay Statue'));
    expect(findAll(s, 'Test Clay Statue', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s)).toBe(20 - 2);
  });
  it('negative ("you may"): choosing nothing casts nothing and costs no life', () => {
    const s = resolveWith(attacked(), () => []);
    expect(findAll(s, 'Test Brass Idol', 'graveyard', 'p1')).toHaveLength(1);
    expect(life(s)).toBe(20);
  });
});

// ---- Etrata, the Silencer: hit counters on exiled cards ----------------------------------------------------------------------------------------------------------------------
const SILENCER = card('Test Quiet Assassin', 'Creature — Vampire Assassin', "This creature can't be blocked.\nWhenever this creature deals combat damage to a player, exile target creature that player controls and put a hit counter on that card. That player loses the game if they own three or more exiled cards with hit counters on them. This creature's owner shuffles this creature into their library.", ['3', '3']);
describe('CR 104.3e, 122.1, 406.1, 608.2b: hit counters on exiled cards (Etrata, the Silencer)', () => {
  const start = (marked: number, victim = 'Test Bear'): GameState => mpScenario({
    defs: [SILENCER, BEAR, GOBLIN],
    zones: { p1: { battlefield: ['Test Quiet Assassin'] }, p2: { battlefield: [victim], exile: Array(marked).fill({ name: 'Test Goblin', counters: { hit: 1 } }) }, p3: { exile: [{ name: 'Test Goblin', counters: { hit: 1 } }, { name: 'Test Goblin', counters: { hit: 1 } }] } },
  });
  const hit = (s0: GameState, victim = 'Test Bear', before?: (s: GameState) => GameState): GameState => {
    const s1 = toDeclareAttackers(s0);
    let s = declareAttackers(s1, [[find(s1, 'Test Quiet Assassin', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 30 && !(s.zones.stack.length > 0 && s.turn.step === 'combatDamage') && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : s.pending?.kind === 'chooseTargets' ? s : pass(s);
    if (s.pending?.kind === 'chooseTargets') {
      const target = findAll(s, victim, 'battlefield', 'p2')[0]!;
      s = settle(s, { targets: [{ kind: 'object', id: target }] });
    }
    if (before) s = before(s);
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  it('is automated', () => expect(full(SILENCER)).toBe(true));
  it('the creature is exiled with a hit counter; with two more of their cards marked, that player loses; Etrata goes into its owner\'s library', () => {
    const s = hit(start(2));
    expect(s.log.some((l) => /1 hit counter put on Test Bear/.test(l.text))).toBe(true); // (Bob then leaves the game with his cards, CR 800.4a)
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    expect(findAll(s, 'Test Quiet Assassin', 'library', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Quiet Assassin', 'battlefield', 'p1')).toHaveLength(0);
  });
  it("negative: with only one other marked card of theirs (another player's marked cards do not count), that player stays in; Etrata is shuffled away anyway", () => {
    const s = hit(start(1));
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
    const exiled = findAll(s, 'Test Bear', 'exile', 'p2');
    expect(exiled).toHaveLength(1);
    expect(s.objects[exiled[0]!]!.counters['hit']).toBe(1);
    expect(findAll(s, 'Test Quiet Assassin', 'library', 'p1')).toHaveLength(1);
  });
});


// ---- Razorfield Ripper: the amount of {E} you have; reconfigure paid with {2} or {E}{E}{E} -------------------------------------------------------------------------------------------
const RIPPER = card('Test Charge Rhino', 'Artifact Creature — Equipment Rhino', 'Whenever this creature or equipped creature attacks, you get {E} (an energy counter), then it gets +X/+X until end of turn, where X is the amount of {E} you have.\nReconfigure—Pay {2} or {E}{E}{E}. (Pay {2} or {E}{E}{E}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn\'t a creature.)', ['3', '3'], '{2}{W}');
describe('CR 107.14, 122.1, 608.2h, 702.151a, 118.12a: "where X is the amount of {E} you have" and "Reconfigure--Pay {2} or {E}{E}{E}" (Razorfield Ripper)', () => {
  const start = (energy: number): GameState => tweak(mpScenario({ defs: [RIPPER, BEAR], zones: { p1: { battlefield: ['Test Charge Rhino', 'Test Bear'] } } }), (x) => { x.players.find((p) => p.id === 'p1')!.counters = { ...(x.players.find((p) => p.id === 'p1')!.counters ?? {}), energy }; });
  const energyOf = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.counters?.['energy'] ?? 0;
  const attackAndResolve = (s0: GameState, who: string): GameState => {
    const s1 = toDeclareAttackers(s0);
    let s = declareAttackers(s1, [[find(s1, who, 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 12 && s.zones.stack.length === 0 && s.turn.step === 'declareAttackers'; i++) s = pass(s);
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  it('is automated', () => expect(full(RIPPER)).toBe(true));
  it('attacking with two energy: you get one more, then it gets +3/+3 (the energy you have as the ability resolves)', () => {
    const s = attackAndResolve(start(2), 'Test Charge Rhino');
    expect(energyOf(s)).toBe(3);
    const id = find(s, 'Test Charge Rhino', 'battlefield', 'p1');
    expect([Number(getChars(s, id)!.power), Number(getChars(s, id)!.toughness)]).toEqual([6, 6]);
    // ruling 2024-06-07: X is counted once; more energy later does not change it
    const more = tweak(s, (x) => { x.players.find((p) => p.id === 'p1')!.counters!['energy'] = 9; });
    expect(Number(getChars(more, id)!.power)).toBe(6);
  });
  it('review (CR 601.2b, 601.2f): a cost increase applies to the cost chosen: with "Activated abilities cost {2} more", the {E}{E}{E} option costs {2} too', () => {
    const TAX = card('Test Toll Field', 'Enchantment', "Activated abilities cost {2} more to activate unless they're mana abilities.");
    let s = tweak(mpScenario({ defs: [RIPPER, BEAR, TAX], zones: { p1: { battlefield: ['Test Charge Rhino', 'Test Bear', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Toll Field'] } } }), (x) => { x.players.find((p) => p.id === 'p1')!.counters = { ...(x.players.find((p) => p.id === 'p1')!.counters ?? {}), energy: 3 }; });
    expect(full(TAX)).toBe(true);
    const rhino = find(s, 'Test Charge Rhino', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const acts = legalOf(s).filter((a) => a.kind === 'activate' && a.object === rhino);
    expect(acts).toHaveLength(1);
    s = act(s, acts[0]!.action);
    for (let i = 0; i < 6 && s.pending?.kind !== 'priority'; i++) s = s.pending?.kind === 'chooseOption' ? settle(s, { option: (s.pending as unknown as { options: { id: string; label: string }[] }).options.find((o) => o.label.includes('{E}'))!.id }) : settle(s, { targets: [{ kind: 'object', id: bear }] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(s.objects[rhino]!.attachedTo).toBe(bear);
    expect(energyOf(s)).toBe(0);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains' && s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped)).toHaveLength(2);
  });
  it('reconfigure: with three energy and no mana the {E}{E}{E} option is paid; the Ripper attaches and the equipped creature\'s attack pumps that creature', () => {
    let s = start(3);
    const rhino = find(s, 'Test Charge Rhino', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    for (const id of s.zones.battlefield) if (s.defs[s.objects[id]!.defId]!.name === 'Plains') s = tweak(s, (x) => { x.objects[id]!.tapped = true; });
    const acts = legalOf(s).filter((a) => a.kind === 'activate' && a.object === rhino);
    expect(acts).toHaveLength(1); // the attach half (the unattach half needs the Ripper attached)
    s = act(s, acts[0]!.action);
    s = settle(s, { targets: [{ kind: 'object', id: bear }] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(s.objects[rhino]!.attachedTo).toBe(bear);
    expect(energyOf(s)).toBe(0);
    s = attackAndResolve(s, 'Test Bear');
    expect(energyOf(s)).toBe(1);
    expect(Number(getChars(s, bear)!.power)).toBe(3 + 1);
  });
});

// ---- Commander Liara Portyr: spells cast from exile cost X less, X players attacked ----------------------------------------------------------------------------------------------
const LIARA = card('Test Fleet Commander', 'Legendary Creature — Human Soldier', 'Whenever you attack, spells you cast from exile this turn cost {X} less to cast, where X is the number of players being attacked. Exile the top X cards of your library. Until end of turn, you may cast spells from among those exiled cards.', ['3', '3']);
describe('CR 601.2f, 118.7, 611.2c, 608.2h: "spells you cast from exile this turn cost {X} less ..., where X is the number of players being attacked" (Commander Liara Portyr)', () => {
  const start = (): GameState => tweak(mpScenario({ defs: [LIARA, BEAR, IDOL, OGRE], zones: { p1: { battlefield: ['Test Fleet Commander', 'Test Bear', 'Test Bear', 'Plains'], hand: ['Test Ogre'] } } }), (x) => {
    const top = [put(x, 'p1', 'library', 'Test Brass Idol'), put(x, 'p1', 'library', 'Test Ogre')];
    x.zones.library['p1'] = [...top, ...x.zones.library['p1']!.filter((id) => !top.includes(id))];
  });
  const attackTwo = (): GameState => {
    const s1 = toDeclareAttackers(start());
    const [b1, b2] = findAll(s1, 'Test Bear', 'battlefield', 'p1');
    let s = declareAttackers(s1, [[b1!, 'p2'], [b2!, 'p3']]);
    for (let i = 0; i < 12 && s.zones.stack.length === 0 && s.turn.step === 'declareAttackers'; i++) s = pass(s);
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  const toMain2 = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.pending?.kind === 'priority' && s.pending.player === 'p1'); i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : s.pending?.kind === 'priority' ? pass(s) : settle(s);
    return s;
  };
  it('is automated', () => expect(full(LIARA)).toBe(true));
  it('two players attacked: the top two cards are exiled, and the Idol ({3}) is cast from exile for {1} (one Plains) in the second main phase', () => {
    let s = toMain2(attackTwo());
    const idol = findAll(s, 'Test Brass Idol', 'exile', 'p1');
    expect(idol).toHaveLength(1);
    expect(findAll(s, 'Test Ogre', 'exile', 'p1')).toHaveLength(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: idol[0]! }));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(findAll(s, 'Test Brass Idol', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('negative: a spell cast from the hand is not reduced (the Ogre in hand costs {3}: one Plains is not enough)', () => {
    const s = toMain2(attackTwo());
    expect(legalOf(s).some((a) => a.kind === 'cast' && a.object === findAll(s, 'Test Ogre', 'hand', 'p1')[0])).toBe(false);
  });
});

// ---- Capricopian: only the player it attacks may activate; reselect which player it attacks ------------------------------------------------------------------------------------------
const GOAT = card('Test Shifty Goat', 'Creature — Goat Hydra', 'This creature enters with X +1/+1 counters on it.\n{2}: Put a +1/+1 counter on this creature, then you may reselect which player this creature is attacking. Only the player this creature is attacking may activate this ability and only during the declare attackers step.', ['0', '0'], '{X}{G}');
describe('CR 602.2, 508.7: "Only the player ~ is attacking may activate this ability" and "you may reselect which player ~ is attacking" (Capricopian)', () => {
  const start = (): GameState => mpScenario({ defs: [GOAT], zones: { p1: { battlefield: [{ name: 'Test Shifty Goat', counters: { '+1/+1': 2 } }] }, p2: { battlefield: ['Plains', 'Plains'] }, p3: { battlefield: ['Plains', 'Plains'] } } });
  const attacked = (who: PlayerId = 'p2'): GameState => {
    const s1 = toDeclareAttackers(start());
    return declareAttackers(s1, [[find(s1, 'Test Shifty Goat', 'battlefield', 'p1'), who]]);
  };
  const goatActs = (s: GameState) => legalOf(s).filter((a) => a.kind === 'activate' && a.object === find(s, 'Test Shifty Goat', 'battlefield', 'p1'));
  const toPriorityOf = (s0: GameState, p: PlayerId): GameState => {
    let s = s0;
    for (let i = 0; i < 6 && !(s.pending?.kind === 'priority' && s.pending.player === p) && s.turn.step === 'declareAttackers'; i++) s = pass(s);
    return s;
  };
  it('is automated', () => expect(full(GOAT)).toBe(true));
  it('the player it attacks (p2) activates it in the declare attackers step, pays {2}, puts the counter on it and reselects p3', () => {
    let s = toPriorityOf(attacked('p2'), 'p2');
    expect(s.pending?.player).toBe('p2');
    const acts = goatActs(s);
    expect(acts).toHaveLength(1);
    s = act(s, acts[0]!.action);
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['p3'] });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    const goat = find(s, 'Test Shifty Goat', 'battlefield', 'p1');
    expect(s.objects[goat]!.counters['+1/+1']).toBe(3);
    const att = s.combat!.attackers.find((a) => a.id === goat)!;
    expect([att.defender, att.defendingPlayer]).toEqual(['p3', 'p3']);
    expect(s.log.some((l) => /Test Shifty Goat attacks/.test(l.text) && /Carol/.test(l.text))).toBe(false); // ruling: no new attack (CR 508.7a)
  });
  it('negative: its controller and a player it does not attack may not activate it; nobody may outside the declare attackers step', () => {
    const s0 = attacked('p2');
    expect(s0.pending?.player).toBe('p1');
    expect(goatActs(s0)).toHaveLength(0);
    const s3 = toPriorityOf(s0, 'p3');
    expect(s3.pending?.player).toBe('p3');
    expect(goatActs(s3)).toHaveLength(0);
    // the declare blockers step: p2 is still attacked, but the step is over
    let s = s0;
    for (let i = 0; i < 20 && s.turn.step !== 'declareBlockers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : s;
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = toPriorityOfAny(s, 'p2');
    expect(goatActs(s)).toHaveLength(0);
  });
  const toPriorityOfAny = (s0: GameState, p: PlayerId): GameState => {
    let s = s0;
    for (let i = 0; i < 6 && !(s.pending?.kind === 'priority' && s.pending.player === p); i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    return s;
  };
});

// ---- Vaevictis Asmadi, the Dire: each target's controller sacrifices it, then reveals and puts a permanent card -------------------------------------------------------------------
const DIRE = card('Test Dire Elder Dragon', 'Legendary Creature — Elder Dragon', 'Flying\nWhenever this creature attacks, for each player, choose target permanent that player controls. Those players sacrifice those permanents. Each player who sacrificed a permanent this way reveals the top card of their library, then puts it onto the battlefield if it\'s a permanent card.', ['6', '6']);
const SPARK = card('Test Spark', 'Instant', 'Draw a card.');
describe('CR 701.21a, 608.2e, 608.2c: "Those players sacrifice those permanents. Each player who sacrificed a permanent this way reveals ..." (Vaevictis Asmadi, the Dire)', () => {
  const onTop = (x: GameState, p: PlayerId, name: string): void => { const id = put(x, p, 'library', name); x.zones.library[p] = [id, ...x.zones.library[p]!.filter((y) => y !== id)]; };
  const start = (): GameState => tweak(mpScenario({ defs: [DIRE, BEAR, GOBLIN, SPARK], zones: { p1: { battlefield: ['Test Dire Elder Dragon', 'Test Goblin'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] }, p4: { battlefield: ['Test Goblin'] } } }), (x) => {
    onTop(x, 'p1', 'Test Bear'); onTop(x, 'p2', 'Test Spark'); onTop(x, 'p3', 'Test Goblin'); onTop(x, 'p4', 'Test Bear');
  });
  const attackWithTargets = (s0: GameState, pick: (s: GameState) => ObjectId[], before?: (s: GameState) => GameState): GameState => {
    const s1 = toDeclareAttackers(s0);
    let s = declareAttackers(s1, [[find(s1, 'Test Dire Elder Dragon', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 12 && s.pending?.kind !== 'chooseTargets' && s.zones.stack.length === 0 && s.turn.step === 'declareAttackers'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    s = settle(s, { targets: pick(s).map((id) => ({ kind: 'object' as const, id })) });
    if (before) s = before(s);
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  const ctl = (s: GameState, name: string, p: PlayerId): ObjectId => findAll(s, name, 'battlefield').find((id) => s.objects[id]!.controller === p)!;
  const picks = (s: GameState): ObjectId[] => [ctl(s, 'Test Goblin', 'p1'), ctl(s, 'Test Bear', 'p2'), ctl(s, 'Test Bear', 'p3'), ctl(s, 'Test Goblin', 'p4')];
  it('is automated', () => expect(full(DIRE)).toBe(true));
  it('each player sacrifices the permanent chosen for them (you too); each reveals the top card and puts it onto the battlefield if it is a permanent card', () => {
    const s = attackWithTargets(start(), picks);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1); // p1 revealed a Bear
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2')).toHaveLength(0); // p2 revealed an instant: it stays on top
    expect(s.zones.library['p2']![0] !== undefined && s.defs[s.objects[s.zones.library['p2']![0]!]!.defId]!.name).toBe('Test Spark');
    expect(findAll(s, 'Test Goblin', 'battlefield', 'p3')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p4')).toHaveLength(1);
    expect(findAll(s, 'Test Goblin', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('ruling: a target that became illegal is not sacrificed, and its controller reveals nothing', () => {
    const s = attackWithTargets(start(), picks, (x) => tweak(x, (y) => { const id = find(y, 'Test Bear', 'battlefield', 'p3'); y.objects[id]!.controller = 'p2'; }));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p3')).toHaveLength(1); // still there (now under p2: an illegal target, CR 608.2b)
    expect(findAll(s, 'Test Goblin', 'battlefield', 'p3')).toHaveLength(0); // p3 revealed nothing
  });
  it('a permanent one player controls and another owns: the player who sacrificed it (its controller) reveals', () => {
    const s0 = tweak(start(), (x) => { const id = find(x, 'Test Bear', 'battlefield', 'p3'); x.objects[id]!.owner = 'p4'; });
    const s = attackWithTargets(s0, picks);
    expect(findAll(s, 'Test Goblin', 'battlefield', 'p3')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'battlefield').filter((id) => s.objects[id]!.controller === 'p4')).toHaveLength(1); // p4 revealed once (for its own Goblin)
    expect(findAll(s, 'Test Bear', 'graveyard', 'p4')).toHaveLength(1); // the Bear p3 sacrificed went to its owner's graveyard
  });
});

// ---- Experimental Lab // Staff Room: manifest dread with two counter kinds; turn face up or put a counter ---------------------------------------------------------------------------
const LAB = card('Test Lab Bench', 'Creature — Scientist', 'When this creature enters, manifest dread, then put two +1/+1 counters and a trample counter on that creature.', ['1', '1']);
const STAFF = card('Test Staff Lounge', 'Enchantment', 'Whenever a creature you control deals combat damage to a player, turn that creature face up or put a +1/+1 counter on it.');
describe('CR 701.62a, 122.1, 608.2d, 701.40g: Experimental Lab // Staff Room', () => {
  it('both are automated', () => { expect(full(LAB)).toBe(true); expect(full(STAFF)).toBe(true); });
  const manifested = (): { s: GameState; id: ObjectId } => {
    let s = mpScenario({ defs: [LAB, BEAR, STAFF], zones: { p1: { hand: ['Test Lab Bench'], battlefield: ['Test Staff Lounge'] } } });
    s = tweak(s, (x) => { for (const n of ['Test Bear', 'Test Bear']) { const id = put(x, 'p1', 'library', n); x.zones.library['p1'] = [id, ...x.zones.library['p1']!.filter((y) => y !== id)]; } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Lab Bench', 'hand', 'p1') }));
    for (let i = 0; i < 10 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown === true)!;
    return { s, id };
  };
  it('Lab: the manifested creature gets two +1/+1 counters and a trample counter', () => {
    const { s, id } = manifested();
    expect(id).toBeDefined();
    expect(s.objects[id]!.counters).toMatchObject({ '+1/+1': 2, trample: 1 });
  });
  const hitWith = (s0: GameState, id: ObjectId, option?: string): GameState => {
    const s1 = toDeclareAttackers(tweak(s0, (x) => { x.objects[id]!.controlledSinceTurn = 0; }));
    let s = declareAttackers(s1, [[id, 'p2']]);
    for (let i = 0; i < 40 && s.turn.step !== 'endCombat'; i++) {
      if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
      else if (s.pending?.kind === 'chooseOption') {
        const opts = (s.pending as unknown as { options: { id: string; label: string }[] }).options;
        if (option !== undefined && !opts.some((o) => o.id === option)) throw new Error(JSON.stringify(opts));
        s = settle(s, option !== undefined ? { option } : {});
      }
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    return s;
  };
  it('Staff Room: a face-down creature that hits may be turned face up (the manifested Bear is a creature card)', () => {
    const { s: s0, id } = manifested();
    const s = hitWith(s0, id, '0'); // the first instruction
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
  });
  it('... or gets a +1/+1 counter instead', () => {
    const { s: s0, id } = manifested();
    const s = hitWith(s0, id, '1'); // the second instruction
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(s.objects[id]!.counters['+1/+1']).toBe(3);
  });
  it('negative (CR 608.2d): a face-up creature can\'t be turned face up, so the counter is the only option', () => {
    const s0 = mpScenario({ defs: [BEAR, STAFF], zones: { p1: { battlefield: ['Test Bear', 'Test Staff Lounge'] } } });
    const s = hitWith(s0, find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(1);
  });
});

// ---- Trench Behemoth: attacks during its controller's next combat phase if able ---------------------------------------------------------------------------------------------------
const QUAKE = card('Test Quake Shrine', 'Enchantment', "Whenever a land you control enters, target creature an opponent controls attacks during its controller's next combat phase if able.");
describe("CR 508.1d, 611.2a, 500.8: \"... attacks during its controller's next combat phase if able\" (Trench Behemoth)", () => {
  const landed = (): GameState => {
    let s = mpScenario({ defs: [QUAKE, BEAR], zones: { p1: { battlefield: ['Test Quake Shrine'], hand: ['Plains'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } } });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') });
    const bear = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    s = settle(s, { targets: [{ kind: 'object', id: bear }] });
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    return s;
  };
  it('is automated', () => expect(full(QUAKE)).toBe(true));
  it("in its controller's next combat phase the creature must attack (no attack, or the other Bear alone, is refused); attacking with it is accepted", () => {
    const s0 = toDeclareAttackers(landed());
    expect(s0.turn.activePlayer).toBe('p2');
    const [b1, b2] = findAll(s0, 'Test Bear', 'battlefield', 'p2');
    expect(reject(s0, attackDecision(s0, [])).rules).toContain('CR 508.1d');
    expect(reject(s0, attackDecision(s0, [[b2!, 'p1']])).rules).toContain('CR 508.1d');
    const s = declareAttackers(s0, [[b1!, 'p3']]);
    expect(s.combat?.attackers.map((a) => a.id)).toEqual([b1]);
  });
  it('negative: the requirement is gone once that combat phase ends (it lasts through that one combat only)', () => {
    let s = declareAttackers(toDeclareAttackers(landed()), [[findAll(landed(), 'Test Bear', 'battlefield', 'p2')[0]!, 'p3']]);
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(s.continuousEffects.some((e) => e.duration.d === 'duringNextCombat')).toBe(false);
  });
  it("negative: during the land's own controller's turn (p1's combat) nothing is required of the creature", () => {
    const s = landed();
    expect(s.continuousEffects.some((e) => e.duration.d === 'duringNextCombat')).toBe(true);
    expect(requirementsFor(s, 'attack', 'p2')).toEqual([]); // not p2's combat phase
  });
});
