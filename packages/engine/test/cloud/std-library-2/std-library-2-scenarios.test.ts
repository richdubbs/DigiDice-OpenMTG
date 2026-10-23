/**
 * Lane std-library, round std-library-2: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.21a, 608.2c,    "Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another creature card from
 *   109.2, 400.7           your graveyard to your hand.": the card returned is any creature card of your graveyard but the one you sacrificed; nothing when you
 *                          sacrificed nothing
 *   CR 101.4, 608.2d,      "Each player may put any number of creature cards from their hand onto the battlefield.": each player chooses among their own hand;
 *   110.2a                 the cards enter under their owners' control; a player may choose none
 *   CR 615.5, 603.12,      "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way,
 *   608.2h                 ~ deals that much damage to that source's controller and you draw that many cards.": the reflexive trigger deals the amount prevented
 *                          to the source's controller and draws that many; damage from another source is neither prevented nor triggers it
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer the one pending decision (chooseObjects: the fewest allowed; yes to an option). */
function step(s: GameState): GameState {
  const p = s.pending!;
  if (p.kind === 'chooseObjects') return answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
  if (p.kind === 'yesNo') return answer(s, { kind: 'yesNo', yes: true });
  return drive(s);
}
/** Answer the decisions that come up until a player has priority (chooseObjects from the script in order, else the fewest allowed). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Resolve the stack, answering with one shared script (its queues are consumed across the resolutions). */
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  const shared: Script = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) {
    s = passBoth(s);
    for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: shared.objects!.shift() ?? p.options.slice(0, p.min) });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: shared.targets!.shift() ?? [] });
      else s = drive(s);
    }
  }
  return s;
};
const ofDef = (s: GameState, zone: 'battlefield', name: string): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.defId === name);
const inZone = (s: GameState, zone: 'hand' | 'graveyard' | 'exile' | 'library', p: string, name: string): ObjectId[] => (s.zones[zone] as Record<string, ObjectId[]>)[p]!.filter((id) => s.objects[id]!.defId === name);

// ---- "another" after a sacrifice -------------------------------------------------------------------------------------------------------------------------

describe('CR 701.21a, 109.2, 400.7: "Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another creature card from your graveyard to your hand."', () => {
  const BREW = card('Test Bitter Draught', 'Sorcery', 'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another creature card from your graveyard to your hand.');
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  const WOLF = card('Test Gray Wolf', 'Creature — Wolf', '', ['2', '2']);
  const defs = [BREW, BEAR, WOLF];
  it('is automated: the sacrifice binds its cards and the return leaves them out', () => {
    expect(full(BREW)).toBe(true);
    expect(JSON.stringify(BREW.faces)).toContain('"not":{"is":{"ref":"bound","name":"sacrificed","which":{"controller":"you"}}}'); // audit-fix-1: only the one YOU sacrificed
  });
  it('the creature cards offered are the ones already in your graveyard, never the one you just sacrificed', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bitter Draught'], battlefield: ['Test Brown Bear'], graveyard: ['Test Gray Wolf', 'Test Gray Wolf'] }, p2: { battlefield: ['Test Brown Bear'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bitter Draught', 'hand', 'p1') }));
    s = passBoth(s);
    let offered: string[] | undefined;
    for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects' && p.player === 'p1' && p.options.some((id) => s.zones.graveyard.p1!.includes(id))) offered = p.options.map((id) => s.objects[id]!.defId); // the names as offered (a card that moves is a new object, CR 400.7)
      s = p.kind === 'chooseObjects' || p.kind === 'yesNo' ? step(s) : drive(s);
    }
    const wolf = inZone(s, 'hand', 'p1', 'Test Gray Wolf');
    expect(offered).toBeDefined();
    expect(offered!.length).toBe(2);
    expect(offered).toEqual(['Test Gray Wolf', 'Test Gray Wolf']);
    expect(wolf.length).toBe(1);
    expect(inZone(s, 'graveyard', 'p1', 'Test Gray Wolf').length).toBe(1);
    expect(inZone(s, 'graveyard', 'p1', 'Test Brown Bear').length).toBe(1);
    expect(inZone(s, 'graveyard', 'p2', 'Test Brown Bear').length).toBe(1);
  });
  it('the negative case: you control no creature, so you sacrifice nothing and return nothing (the opponent still sacrifices)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bitter Draught'], graveyard: ['Test Gray Wolf'] }, p2: { battlefield: ['Test Brown Bear'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bitter Draught', 'hand', 'p1') })));
    expect(inZone(s, 'hand', 'p1', 'Test Gray Wolf').length).toBe(0);
    expect(inZone(s, 'graveyard', 'p1', 'Test Gray Wolf').length).toBe(1);
    expect(inZone(s, 'graveyard', 'p2', 'Test Brown Bear').length).toBe(1);
  });
});

describe('CR 109.2, 608.2d, 400.3: "When this creature enters, return another Goblin card from your graveyard to your hand."', () => {
  const RAKE = card('Test Ash Rake', 'Creature — Goblin', 'When this creature enters, return another Goblin card from your graveyard to your hand.', ['1', '1']);
  const GOB = card('Test Mud Goblin', 'Creature — Goblin', '', ['1', '1']);
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; a Goblin card of your graveyard returns to your hand, a Bear card stays there', () => {
    expect(full(RAKE)).toBe(true);
    let s = scenario([], { defs: [RAKE, GOB, BEAR], p1: { hand: ['Test Ash Rake'], graveyard: ['Test Mud Goblin', 'Test Brown Bear'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ash Rake', 'hand', 'p1') })));
    expect(inZone(s, 'hand', 'p1', 'Test Mud Goblin').length).toBe(1);
    expect(inZone(s, 'graveyard', 'p1', 'Test Brown Bear').length).toBe(1);
  });
  it('the negative case: with only a Bear card in your graveyard, nothing returns', () => {
    let s = scenario([], { defs: [RAKE, GOB, BEAR], p1: { hand: ['Test Ash Rake'], graveyard: ['Test Brown Bear'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ash Rake', 'hand', 'p1') })));
    expect(s.zones.hand.p1!.length).toBe(0);
    expect(inZone(s, 'graveyard', 'p1', 'Test Brown Bear').length).toBe(1);
  });
});

// ---- "each player may put any number of <cards> from their hand onto the battlefield" -----------------------------------------------------------------

describe('CR 101.4, 608.2d, 110.2a: "Exile all creatures. Each player may put any number of creature cards from their hand onto the battlefield. Then put all cards exiled this way into their owners\' hands."', () => {
  const SWAP = card('Test Turning Tide', 'Sorcery', "Exile all creatures. Each player may put any number of creature cards from their hand onto the battlefield. Then put all cards exiled this way into their owners' hands.");
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  const WOLF = card('Test Gray Wolf', 'Creature — Wolf', '', ['2', '2']);
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  const defs = [SWAP, BEAR, WOLF, MOTE];
  it('is automated', () => {
    expect(full(SWAP)).toBe(true);
  });
  it('each player puts creature cards of their own hand under their own control; one may put none; the exiled creatures return to their owners\' hands', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Turning Tide', 'Test Gray Wolf', 'Test Gray Wolf', 'Test Dust Mote'], battlefield: ['Test Brown Bear'] }, p2: { hand: ['Test Gray Wolf'], battlefield: ['Test Brown Bear'] } });
    const p1Wolves = inZone(s, 'hand', 'p1', 'Test Gray Wolf');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Turning Tide', 'hand', 'p1') }));
    s = passBoth(s);
    const asked: { player: string; options: ObjectId[] }[] = [];
    for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') {
        asked.push({ player: p.player, options: [...p.options] });
        s = answer(s, { kind: 'chooseObjects', ids: p.player === 'p1' ? p1Wolves : [] });
      } else s = drive(s);
    }
    // APNAP: the active player chooses first, among their own creature cards only (not the artifact, not the opponent's card)
    expect(asked.map((a) => a.player)).toEqual(['p1', 'p2']);
    expect([...asked[0]!.options].sort()).toEqual([...p1Wolves].sort());
    expect(asked[1]!.options.every((id) => s.objects[id]!.owner === 'p2')).toBe(true);
    const wolves = ofDef(s, 'battlefield', 'Test Gray Wolf');
    expect(wolves.length).toBe(2);
    for (const id of wolves) expect(s.objects[id]!.controller ?? s.objects[id]!.owner).toBe('p1');
    expect(ofDef(s, 'battlefield', 'Test Brown Bear').length).toBe(0);
    expect(inZone(s, 'hand', 'p1', 'Test Brown Bear').length).toBe(1);
    expect(inZone(s, 'hand', 'p2', 'Test Brown Bear').length).toBe(1);
    expect(inZone(s, 'hand', 'p2', 'Test Gray Wolf').length).toBe(1);
    expect(inZone(s, 'hand', 'p1', 'Test Dust Mote').length).toBe(1);
  });
});

// ---- the reflexive trigger on a prevention -----------------------------------------------------------------------------------------------------------

describe('CR 615.5, 603.12, 608.2h: "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, ~ deals that much damage to that source\'s controller and you draw that many cards."', () => {
  const TURN = card('Test Bright Rebuke', 'Instant', "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, Test Bright Rebuke deals that much damage to that source's controller and you draw that many cards.");
  const IMP = card('Test Ember Imp', 'Creature — Imp', '{0}: This creature deals 3 damage to any target.', ['1', '1']);
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  const defs = [TURN, IMP, MOTE];
  const start = (): GameState => advanceTo(scenario([], { defs, p1: { hand: ['Test Bright Rebuke'], library: ['Test Dust Mote', 'Test Dust Mote', 'Test Dust Mote', 'Test Dust Mote'] }, p2: { battlefield: ['Test Ember Imp', 'Test Ember Imp'] } }), 1, 'main1');
  const imps = (s: GameState): ObjectId[] => ofDef(s, 'battlefield', 'Test Ember Imp');
  const ping = (s: GameState, imp: ObjectId, to: TargetChoice): GameState => {
    let t = act(s, { type: 'pass', player: 'p1' });
    t = drive(act(t, { type: 'activate', player: 'p2', source: imp, ability: 'p:0:0' }), { targets: [[to]] });
    return resolveAll(t);
  };
  it('is automated', () => {
    expect(full(TURN)).toBe(true);
  });
  it('the chosen source\'s 3 damage to you is prevented; the reflexive trigger deals 3 to its controller and you draw 3 cards', () => {
    let s = start();
    const [a] = imps(s);
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bright Rebuke', 'hand', 'p1') })), { objects: [[a!]] });
    s = ping(s, a!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.hand.p1!.length).toBe(hand - 1 + 3);
  });
  it('the negative case: damage from the other source is dealt, nothing triggers, and the shield still waits for the chosen one', () => {
    let s = start();
    const [a, b] = imps(s);
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bright Rebuke', 'hand', 'p1') })), { objects: [[a!]] });
    s = ping(s, b!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(17);
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.hand.p1!.length).toBe(hand - 1);
    s = ping(s, a!, { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(17);
    expect(life(s, 'p2')).toBe(17);
  });
});
