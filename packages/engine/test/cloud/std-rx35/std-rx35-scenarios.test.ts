/**
 * EDH lane rx35 (std-rx35): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 509.1h, 603.2       "Whenever this creature attacks and isn't blocked": triggers once as blockers are declared when no blocker was declared for it;
 *                          not when it is blocked; "defending player" is the player it attacks; a group pattern triggers once per unblocked attacker it names
 *   CR 609.7a, 615.1,      "The next time a source of your choice would deal damage to you this turn, prevent that damage.": the source is chosen as the ability
 *   615.7                  resolves; the damage that source would deal next to you is prevented once; the same source's next damage, another source's damage
 *                          and damage to another recipient are not
 *   CR 615.5               "... You gain life equal to the damage prevented this way.": you gain the amount the shield prevented, right after it
 *   CR 615.7, 115.1        "... would deal damage to target creature this turn, prevent that damage.": the shield is on that creature only
 *   CR 701.17a, 608.2c     "You gain 1 life for each creature card milled this way.": the creature cards among the cards that mill step put into a graveyard
 *   CR 121.1, 401.4        "Draw two cards, then put a card from your hand on the bottom of your library.": the drawn cards are in hand when the card is chosen;
 *                          the chosen card ends on the bottom of the library
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; objects?: ObjectId[][]; attacks?: ObjectId[]; blocks?: { blocker: ObjectId; attacker: ObjectId }[] }
/** Answer the decisions that come up until a player has priority with an empty stack or `stop` says so. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: (script.attacks ?? []).map((attacker) => ({ attacker, defender: 'p2' })) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: script.blocks ?? [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const player = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

// ---- triggers: "attacks and isn't blocked" ------------------------------------------------------------------------------------------------------------------

/** Play turn 1's combat: p1 attacks with `attackers`, p2 blocks as `blocks` says; returns the state at the end of combat with every trigger resolved. */
function combat(s0: GameState, attackers: ObjectId[], blocks: { blocker: ObjectId; attacker: ObjectId }[] = []): { s: GameState; triggered: number } {
  let s = advanceTo(s0, 1, 'beginCombat');
  let triggered = 0;
  for (let guard = 0; guard < 200 && s.turn.number === 1 && s.turn.step !== 'endCombat'; guard++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
    else if (d?.kind === 'declareBlockers') {
      s = answer(s, { kind: 'declareBlockers', blocks });
      triggered += s.zones.stack.length;
    } else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? resolveAll(s) : pass(s);
    else if (d) s = drive(s);
    else break;
  }
  return { s, triggered };
}

describe('CR 509.1h, 603.2: "Whenever this creature attacks and isn\'t blocked, draw a card."', () => {
  const SKULKER = card('Test Grove Skulker', 'Creature — Elf Rogue', "Whenever this creature attacks and isn't blocked, draw a card.", ['2', '2']);
  const WALL = card('Test Mud Wall', 'Creature — Wall', 'Defender', ['0', '4']);
  const defs = [SKULKER, WALL];
  it('is automated, on the event attacksUnblocked of itself', () => {
    expect(full(SKULKER)).toBe(true);
    expect(JSON.stringify(SKULKER.faces)).toContain('"on":[{"ev":"attacksUnblocked","attacker":{"self":true}}]');
  });
  it('unblocked: it triggers once as blockers are declared and its controller draws a card', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grove Skulker'], library: ['Test Mud Wall', 'Test Mud Wall'] }, p2: { battlefield: ['Test Mud Wall'] } });
    const hand = s0.zones.hand.p1!.length;
    const { s, triggered } = combat(s0, [find(s0, 'Test Grove Skulker', 'battlefield', 'p1')]);
    expect(triggered).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
  });
  it('blocked: it does not trigger (a blocker was declared for it)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grove Skulker'], library: ['Test Mud Wall', 'Test Mud Wall'] }, p2: { battlefield: ['Test Mud Wall'] } });
    const hand = s0.zones.hand.p1!.length;
    const sk = find(s0, 'Test Grove Skulker', 'battlefield', 'p1');
    const { s, triggered } = combat(s0, [sk], [{ blocker: find(s0, 'Test Mud Wall', 'battlefield', 'p2'), attacker: sk }]);
    expect(triggered).toBe(0);
    expect(s.zones.hand.p1!.length).toBe(hand);
  });
  it('not attacking: it does not trigger', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grove Skulker'], library: ['Test Mud Wall', 'Test Mud Wall'] }, p2: { battlefield: ['Test Mud Wall'] } });
    expect(combat(s0, []).triggered).toBe(0);
  });
});

describe('CR 509.1h, 506.2: "Whenever this creature attacks and isn\'t blocked, defending player gets a poison counter."', () => {
  const GNAT = card('Test Bog Gnat', 'Creature — Insect', "Flying\nWhenever this creature attacks and isn't blocked, defending player gets a poison counter.", ['1', '1']);
  it('the player it attacks gets the poison counter, not its controller', () => {
    expect(full(GNAT)).toBe(true);
    const s0 = scenario([], { defs: [GNAT], p1: { battlefield: ['Test Bog Gnat'] } });
    const { s } = combat(s0, [find(s0, 'Test Bog Gnat', 'battlefield', 'p1')]);
    expect(player(s, 'p2').poison).toBe(1);
    expect(player(s, 'p1').poison).toBe(0);
  });
});

describe('CR 509.1h, 603.2c: "Whenever a Wolf you control attacks and isn\'t blocked, you gain 2 life."', () => {
  const DEN = card('Test Den Mother', 'Enchantment', "Whenever a Wolf you control attacks and isn't blocked, you gain 2 life.");
  const WOLF = card('Test Gray Wolf', 'Creature — Wolf', '', ['2', '2']);
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  const WALL = card('Test Mud Wall', 'Creature — Wall', 'Defender', ['0', '4']);
  it('triggers once for each unblocked Wolf: two Wolves attack, one is blocked, a Bear is unblocked: one trigger', () => {
    expect(full(DEN)).toBe(true);
    const s0 = scenario([], { defs: [DEN, WOLF, BEAR, WALL], p1: { battlefield: ['Test Den Mother', 'Test Gray Wolf', 'Test Gray Wolf', 'Test Brown Bear'] }, p2: { battlefield: ['Test Mud Wall'] } });
    const [w1, w2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Gray Wolf');
    const { s, triggered } = combat(s0, [w1!, w2!, find(s0, 'Test Brown Bear', 'battlefield', 'p1')], [{ blocker: find(s0, 'Test Mud Wall', 'battlefield', 'p2'), attacker: w1! }]);
    expect(triggered).toBe(1);
    expect(life(s, 'p1')).toBe(22);
  });
});

// ---- the shield: "the next time a source of your choice would deal damage to <recipient> this turn, prevent that damage" ---------------------------------------

describe('CR 609.7a, 615.1, 615.7: "{1}: The next time a source of your choice would deal damage to you this turn, prevent that damage."', () => {
  const WARD = card('Test Pale Ward', 'Enchantment', '{1}: The next time a source of your choice would deal damage to you this turn, prevent that damage.');
  const IMP = card('Test Ember Imp', 'Creature — Imp', '{0}: This creature deals 2 damage to any target.', ['1', '1']);
  const defs = [WARD, IMP];
  const start = (): GameState => {
    const s = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Pale Ward', 'Test Ember Imp', { name: 'Test Ember Imp' }] } }), 1, 'main1');
    player(s, 'p1').manaPool.push({ type: 'C' } as never);
    return s;
  };
  const imps = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Ember Imp');
  const shield = (s: GameState, source: ObjectId): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Pale Ward', 'battlefield', 'p1'), ability: 'p:0:0' })), { objects: [[source]] });
  const ping = (s: GameState, imp: ObjectId, to: TargetChoice): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { targets: [[to]] }));
  it('is automated: a choice of one object on the battlefield, the stack or the command zone (audit-fix-1, CR 609.7a), then a one-use shield on damage from it to you', () => {
    expect(full(WARD)).toBe(true);
    const j = JSON.stringify(WARD.faces);
    expect(j).toContain('"from":{"ref":"each","filter":{"zone":["battlefield","stack","command"]}}');
    expect(j).toContain('"damageSource":true');
    expect(j).toContain('"recipient":{"player":"you"}');
    expect(j).toContain('"shield":{"uses":1}');
  });
  it('prevents the chosen source\'s next damage to you, once; its second damage and the other source\'s damage are dealt', () => {
    let s = start();
    const [a, b] = imps(s);
    s = shield(s, a!);
    s = ping(s, a!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(20);
    s = ping(s, a!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(18);
    s = ping(s, b!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(16);
  });
  it('the chosen source\'s damage to another player is not prevented and does not use the shield', () => {
    let s = start();
    const [a] = imps(s);
    s = shield(s, a!);
    s = ping(s, a!, { kind: 'player', id: 'p2' });
    expect(life(s, 'p2')).toBe(18);
    s = ping(s, a!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 615.5: "... prevent that damage. You gain life equal to the damage prevented this way."', () => {
  const CHARM = card('Test Mending Charm', 'Enchantment', '{1}: The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way.');
  const IMP = card('Test Ember Imp', 'Creature — Imp', '{0}: This creature deals 2 damage to any target.', ['1', '1']);
  it('is automated as one instruction (prevent.then gains the prevented amount) and you gain 2 when it prevents 2', () => {
    expect(full(CHARM)).toBe(true);
    expect(JSON.stringify(CHARM.faces)).toContain('"then":[{"op":"gainLife","who":{"ref":"you"},"amount":{"q":"preventedAmount"}}]');
    let s = advanceTo(scenario([], { defs: [CHARM, IMP], p1: { battlefield: ['Test Mending Charm', 'Test Ember Imp'] } }), 1, 'main1');
    player(s, 'p1').manaPool.push({ type: 'C' } as never);
    const imp = find(s, 'Test Ember Imp', 'battlefield', 'p1');
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Mending Charm', 'battlefield', 'p1'), ability: 'p:0:0' })), { objects: [[imp]] });
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 615.7, 115.1: "... would deal damage to target creature this turn, prevent that damage."', () => {
  const MONK = card('Test Shield Monk', 'Creature — Human Monk', '{1}: The next time a source of your choice would deal damage to target creature this turn, prevent that damage.', ['1', '1']);
  const IMP = card('Test Ember Imp', 'Creature — Imp', '{0}: This creature deals 2 damage to any target.', ['1', '1']);
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '3']);
  it('is automated; the targeted creature is spared, another creature is not', () => {
    expect(full(MONK)).toBe(true);
    let s = advanceTo(scenario([], { defs: [MONK, IMP, BEAR], p1: { battlefield: ['Test Shield Monk', 'Test Ember Imp', 'Test Brown Bear'] }, p2: { battlefield: ['Test Brown Bear'] } }), 1, 'main1');
    player(s, 'p1').manaPool.push({ type: 'C' } as never);
    const imp = find(s, 'Test Ember Imp', 'battlefield', 'p1');
    const mine = find(s, 'Test Brown Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Brown Bear', 'battlefield', 'p2');
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Shield Monk', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[{ kind: 'object', id: mine }]] }), { objects: [[imp]] });
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { targets: [[{ kind: 'object', id: mine }]] }));
    expect(s.objects[mine]!.damage).toBe(0);
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { targets: [[{ kind: 'object', id: theirs }]] }));
    expect(s.objects[theirs]!.damage).toBe(2);
  });
});

describe('CR 615.7, 608.2h: "Sacrifice this Aura: The next time a source of your choice would deal damage to enchanted creature this turn, prevent that damage."', () => {
  const PLATE = card('Test Bark Plate', 'Enchantment — Aura', 'Enchant creature\nSacrifice this Aura: The next time a source of your choice would deal damage to enchanted creature this turn, prevent that damage.');
  const IMP = card('Test Ember Imp', 'Creature — Imp', '{0}: This creature deals 2 damage to any target.', ['1', '1']);
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '3']);
  it('is automated; the creature the Aura enchanted as it was sacrificed (last known information) is the one spared', () => {
    expect(full(PLATE)).toBe(true);
    let s = advanceTo(scenario([], { defs: [PLATE, IMP, BEAR], p1: { hand: ['Test Bark Plate'], battlefield: ['Test Ember Imp', 'Test Brown Bear'] } }), 1, 'main1');
    const bear = find(s, 'Test Brown Bear', 'battlefield', 'p1');
    const imp = find(s, 'Test Ember Imp', 'battlefield', 'p1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bark Plate', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: bear }]] }));
    expect(s.objects[find(s, 'Test Bark Plate', 'battlefield', 'p1')]!.attachedTo).toBe(bear);
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Bark Plate', 'battlefield', 'p1'), ability: 'p:0:1' })), { objects: [[imp]] });
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { targets: [[{ kind: 'object', id: bear }]] }));
    expect(s.objects[bear]!.damage).toBe(0);
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { targets: [[{ kind: 'object', id: bear }]] }));
    expect(s.objects[bear]!.damage).toBe(2);
  });
});

// ---- Qty "for each <card> milled this way" ------------------------------------------------------------------------------------------------------------------

describe('CR 701.17a, 608.2c: "When this creature enters, mill four cards. You gain 1 life for each creature card milled this way."', () => {
  const KITE = card('Test Carrion Kite', 'Creature — Bird', 'Flying\nWhen this creature enters, mill four cards. You gain 1 life for each creature card milled this way.', ['2', '2'], '{2}');
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  it('is automated; with two creature cards among the four milled you gain 2 (creature cards already in the graveyard do not count)', () => {
    expect(full(KITE)).toBe(true);
    let s = advanceTo(scenario([], { defs: [KITE, BEAR, MOTE], p1: { hand: ['Test Carrion Kite'], library: ['Test Brown Bear', 'Test Dust Mote', 'Test Brown Bear', 'Test Dust Mote', 'Test Brown Bear'], graveyard: ['Test Brown Bear'] } }), 1, 'main1');
    player(s, 'p1').manaPool.push({ type: 'C' } as never, { type: 'C' } as never);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Carrion Kite', 'hand', 'p1') })));
    expect(s.zones.graveyard.p1!.length).toBe(5);
    expect(life(s, 'p1')).toBe(22);
  });
});

// ---- "Draw N cards, then put a card from your hand on the bottom of your library" -------------------------------------------------------------------------------

describe('CR 121.1, 401.4: "Draw two cards, then put a card from your hand on the bottom of your library."', () => {
  const STUDY = card('Test Quiet Study', 'Sorcery', 'Draw two cards, then put a card from your hand on the bottom of your library.');
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; a drawn card may be the one put on the bottom; the hand ends with one more card', () => {
    expect(full(STUDY)).toBe(true);
    let s = advanceTo(scenario([], { defs: [STUDY, MOTE, BEAR], p1: { hand: ['Test Quiet Study'], library: ['Test Brown Bear', 'Test Dust Mote', 'Test Dust Mote'] } }), 1, 'main1');
    const before = s.zones.hand.p1!.length;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quiet Study', 'hand', 'p1') }));
    s = passBoth(s);
    const d = s.pending;
    expect(d?.kind).toBe('chooseObjects');
    const bear = find(s, 'Test Brown Bear', 'hand', 'p1');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [bear] }));
    const lib = s.zones.library.p1!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Test Brown Bear');
    expect(s.zones.hand.p1!.length).toBe(before - 1 + 2 - 1);
  });
});
