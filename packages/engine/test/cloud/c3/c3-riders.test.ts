/**
 * Cloud C3 follow-up (cloud batch 3): the family extension, played through the engine with synthetic cards compiled by the game's default compiler (the
 * wordings are invented, design 6.10): untap restrictions of groups, of the source under a condition and of a tapped creature for as long as you control the
 * source, and the riders of Auras and Equipment ("gets +N/+N and can't attack", "can't attack, block, or transform", "can't block as long as ...", "can't be
 * the target of spells", "assigns combat damage equal to its toughness", "prevent all combat damage that would be dealt to and dealt by enchanted creature",
 * "its activated abilities can't be activated"), and the goads of resolved effects and of an identity-changing Aura.
 *
 *   CR 502.3        the untap step: a restriction keeps a permanent tapped; CR 611.2b "for as long as you control ~"; CR 611.3a a static ability's condition
 *   CR 508.1c, 509.1b  attack and block restrictions; CR 701.27a transform; CR 115.1 targets; CR 510.1a combat damage; CR 615.1 prevention; CR 602.5
 *   CR 701.15a-b, 611.2a  a goad that lasts for the rest of the game
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '3']);
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '');
const PRISON = card('Test Rust Prison', 'Enchantment', "Artifacts don't untap during their controllers' untap steps.");
const LAZY = card('Test Lazy Golem', 'Artifact Creature — Golem', "Test Lazy Golem doesn't untap during your untap step if you control a Wizard.", ['4', '4']);
const WARDEN = card('Test Frost Warden', 'Creature — Spirit', "When this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's untap step for as long as you control this creature.", ['2', '2']);
const SNARE = card('Test Tide Snare', 'Enchantment — Aura', "Enchant creature\nAs long as you control an Island, enchanted creature doesn't untap during its controller's untap step.");
const IRONS = card('Test Iron Weights', 'Artifact — Equipment', "Equipped creature gets +3/+1 and doesn't untap during its controller's untap step.\nEquip {0}");
const CAGE = card('Test Cage', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +1/+3 and can't attack.");
const MOONBOUND = card('Test Moonbound', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack, block, or transform.");
const MIRE = card('Test Mire Chains', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't block as long as you control a Swamp.");
const CLOAK = card('Test Thief Cloak', 'Artifact — Equipment', "Equipped creature can't be blocked as long as you control a Wizard.\nEquip {0}");
const VEIL = card('Test Veil', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +0/+2 and can't be the target of spells.");
const BARK = card('Test Barkskin', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+3 and assigns combat damage equal to its toughness rather than its power.');
const MIST = card('Test Mist Form', 'Enchantment — Aura', 'Enchant creature\nPrevent all combat damage that would be dealt to and dealt by enchanted creature.');
const KISS = card('Test Numbing Kiss', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets -1/-1, and its activated abilities can't be activated.");
const PINGER = card('Test Pinger', 'Creature — Human Wizard', '{0}: You gain 1 life.', ['2', '2']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to target creature.');
const BLAST = card('Test Blast', 'Creature — Goblin', '{0}, Sacrifice this creature: It deals 1 damage to target creature.', ['1', '1']);
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target creature.');
const VEHICLE = card('Test Wagon', 'Artifact — Vehicle', 'Crew 1', ['3', '3']);
const RIG = card('Test Rigging', 'Enchantment — Aura', "Enchant creature or Vehicle\nAs long as enchanted permanent is a Vehicle, it's a creature in addition to its other types.\nEnchanted creature gets +1/+1 and has haste.");
const DEFS = [BEAR, OX, WIZARD, RELIC, PRISON, LAZY, WARDEN, SNARE, IRONS, CAGE, MOONBOUND, MIRE, CLOAK, VEIL, BARK, MIST, KISS, PINGER, BOLT, BLAST, SHATTER, VEHICLE, RIG];

const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped === true;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
/** Attach `what` (on the battlefield) to `to`, before any state-based action check (CR 704.5m-n). */
function attach(s: GameState, owner: PlayerId, what: string, to: ObjectId): ObjectId {
  const id = put(s, owner, 'battlefield', what);
  s.objects[id]!.attachedTo = to;
  return id;
}
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** p1's attack with the given creatures at p2 (no blocks unless given), through combat damage. */
function attackWith(s0: GameState, attackers: ObjectId[], blocks: { blocker: ObjectId; attacker: ObjectId }[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
    if (guard > 30) throw new Error('no declare attackers');
    s = pass(s);
  }
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((a) => ({ attacker: a, defender: 'p2' })) });
  for (let guard = 0; s.turn.step !== 'main2' && guard < 60; guard++) {
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks });
    else s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  }
  return s;
}

describe('Cloud C3 follow-up: the synthetic rider cards are automated', () => {
  for (const d of DEFS) it(d.name, () => expect(full(d), JSON.stringify(d.automation)).toBe(true));
});

describe('CR 502.3, 611.3a: untap restrictions', () => {
  it('"Artifacts don\'t untap during their controllers\' untap steps.": the tapped artifact stays tapped, the creature untaps', () => {
    let s = scenario([], { p1: { battlefield: ['Test Rust Prison'] }, p2: { battlefield: [{ name: 'Test Relic', tapped: true }, { name: 'Test Bear', tapped: true }] }, defs: DEFS });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = advanceTo(s, 2, 'upkeep');
    expect(tapped(s, relic)).toBe(true);
    expect(tapped(s, bear)).toBe(false);
  });

  it('"~ doesn\'t untap during your untap step if you control a Wizard.": with a Wizard it stays tapped, without one it untaps', () => {
    const golemAfterUntap = (cards: (string | { name: string; tapped: boolean })[]) => {
      let s = scenario([], { p2: { battlefield: [{ name: 'Test Lazy Golem', tapped: true }, ...cards] }, defs: DEFS });
      const golem = find(s, 'Test Lazy Golem', 'battlefield', 'p2');
      s = advanceTo(s, 2, 'upkeep');
      return tapped(s, golem);
    };
    expect(golemAfterUntap(['Test Wizard'])).toBe(true);
    expect(golemAfterUntap(['Test Bear'])).toBe(false);
  });

  it('CR 611.2b: "That creature doesn\'t untap during its controller\'s untap step for as long as you control this creature." ends as it leaves', () => {
    let s = scenario([], { p1: { hand: ['Test Frost Warden', 'Test Shatter'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Frost Warden', 'hand', 'p1') }));
    for (let guard = 0; (s.zones.stack.length > 0 || s.pending?.kind !== 'priority') && guard < 20; guard++) {
      s = s.pending?.kind === 'priority' ? pass(s) : settle(s, [obj(bear)]); // the enters trigger targets the Bear
    }
    expect(tapped(s, bear)).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(tapped(s, bear)).toBe(true); // Bob's untap step: still tapped
    s = advanceTo(s, 3, 'main1');
    const warden = find(s, 'Test Frost Warden', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shatter', 'hand', 'p1') }), [obj(warden)]);
    s = settle(pass(pass(s)));
    expect(s.zones.battlefield).not.toContain(warden);
    s = advanceTo(s, 4, 'upkeep');
    expect(tapped(s, bear)).toBe(false); // the effect ended with Alice's control of the Warden
  });

  it('"As long as you control an Island, enchanted creature doesn\'t untap during its controller\'s untap step."', () => {
    const bearAfterUntap = (aliceLand: string) => {
      let s = scenario(['Island', 'Plains'], { p1: { battlefield: [aliceLand] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] }, defs: DEFS });
      const bear = find(s, 'Test Bear', 'battlefield', 'p2');
      attach(s, 'p1', 'Test Tide Snare', bear);
      s = advanceTo(s, 2, 'upkeep');
      return tapped(s, bear);
    };
    expect(bearAfterUntap('Island')).toBe(true);
    expect(bearAfterUntap('Plains')).toBe(false);
  });

  it('"Equipped creature gets +3/+1 and doesn\'t untap during its controller\'s untap step."', () => {
    let s = scenario([], { p2: { battlefield: [{ name: 'Test Bear', tapped: true }] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    attach(s, 'p2', 'Test Iron Weights', bear);
    expect(Number(getChars(s, bear)!.power)).toBe(5);
    expect(Number(getChars(s, bear)!.toughness)).toBe(3);
    s = advanceTo(s, 2, 'upkeep');
    expect(tapped(s, bear)).toBe(true);
  });
});

describe('CR 508.1c, 509.1b, 701.27a, 611.3a: combat restrictions of Auras and Equipment', () => {
  /** Alice at her declare attackers step with the Bear (her creature), the Aura or Equipment `name` attached to it. */
  const enchantedBear = (name: string, extra: string[] = [], bob: string[] = []) => {
    // Alice's Ox can attack, so the declaration is asked (CR 508.1: with no creature able to attack there is nothing to declare)
    let s = scenario(['Swamp', 'Plains'], { p1: { battlefield: ['Test Bear', 'Test Ox', ...extra] }, p2: { battlefield: bob }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    attach(s, 'p1', name, bear);
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
    return { s, bear };
  };
  const tryAttack = (s: GameState, attacker: ObjectId) => applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] } }).error;

  it('"Enchanted creature gets +1/+3 and can\'t attack."', () => {
    const { s, bear } = enchantedBear('Test Cage');
    expect(Number(getChars(s, bear)!.toughness)).toBe(5);
    expect(tryAttack(s, bear)).toBeDefined();
    expect(tryAttack(s, find(s, 'Test Ox', 'battlefield', 'p1'))).toBeUndefined();
  });

  it('"Enchanted creature can\'t attack, block, or transform." (attack)', () => {
    const { s, bear } = enchantedBear('Test Moonbound');
    expect(tryAttack(s, bear)).toBeDefined();
  });

  it('"Enchanted creature can\'t block as long as you control a Swamp." / "Equipped creature can\'t be blocked as long as you control a Wizard."', () => {
    // Bob's Ox carries Alice's Mire Chains; Alice's Bear attacks
    const blockable = (aliceLand: string) => {
      // Bob's Wizard can block, so the declaration is asked either way
      let s = scenario(['Swamp', 'Plains'], { p1: { battlefield: ['Test Bear', aliceLand] }, p2: { battlefield: ['Test Ox', 'Test Wizard'] }, defs: DEFS });
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      const ox = find(s, 'Test Ox', 'battlefield', 'p2');
      attach(s, 'p1', 'Test Mire Chains', ox);
      for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
      for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) s = pass(s);
      return applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: ox, attacker: bear }] } }).error === undefined;
    };
    expect(blockable('Swamp')).toBe(false);
    expect(blockable('Plains')).toBe(true);
    const unblockable = (aliceCreature: string) => {
      // Alice's Ox attacks too, so Bob is asked to declare blockers either way
      let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ox', aliceCreature] }, p2: { battlefield: ['Test Ox'] }, defs: DEFS });
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      attach(s, 'p1', 'Test Thief Cloak', bear);
      for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }, { attacker: find(s, 'Test Ox', 'battlefield', 'p1'), defender: 'p2' }] });
      for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) s = pass(s);
      return applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Ox', 'battlefield', 'p2'), attacker: bear }] } }).error !== undefined;
    };
    expect(unblockable('Test Wizard')).toBe(true);
    expect(unblockable('Test Bear')).toBe(false);
  });
});

describe('CR 115.1, 510.1a, 615.1, 602.5: other riders', () => {
  it('"Enchanted creature gets +0/+2 and can\'t be the target of spells.": a spell can\'t target it, an ability can', () => {
    let s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Blast'] }, p2: { battlefield: ['Test Ox'] }, defs: DEFS });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    attach(s, 'p2', 'Test Veil', ox);
    expect(Number(getChars(s, ox)!.toughness)).toBe(5);
    const cast = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bolt', 'hand', 'p1') });
    expect(cast.pending?.kind).toBe('chooseTargets');
    expect(applyAction(cast, { type: 'answer', player: 'p1', decisionId: cast.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(ox)] } }).error).toBeDefined();
    const blast = find(s, 'Test Blast', 'battlefield', 'p1');
    const t = act(s, { type: 'activate', player: 'p1', source: blast, ability: 'p:0:0' });
    expect(t.pending?.kind).toBe('chooseTargets');
    expect(applyAction(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(ox)] } }).error).toBeUndefined();
  });

  it('"Enchanted creature gets +0/+3 and assigns combat damage equal to its toughness rather than its power."', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    attach(s, 'p1', 'Test Barkskin', bear);
    s = attackWith(s, [bear]);
    expect(life(s, 'p2')).toBe(15); // toughness 5, not power 2
  });

  it('"Prevent all combat damage that would be dealt to and dealt by enchanted creature."', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ox'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    const bobBear = find(s, 'Test Bear', 'battlefield', 'p2');
    attach(s, 'p1', 'Test Mist Form', bear);
    s = attackWith(s, [bear, ox], [{ blocker: bobBear, attacker: bear }]);
    expect(s.objects[bear]?.damage ?? 0).toBe(0); // dealt to it: prevented
    expect(s.objects[bobBear]?.damage ?? 0).toBe(0); // dealt by it: prevented
    expect(life(s, 'p2')).toBe(19); // the Ox's damage is not prevented
  });

  it('"Enchanted creature gets -1/-1, and its activated abilities can\'t be activated."', () => {
    const s = scenario([], { p1: { battlefield: ['Test Pinger'] }, defs: DEFS });
    const pinger = find(s, 'Test Pinger', 'battlefield', 'p1');
    expect(applyAction(s, { type: 'activate', player: 'p1', source: pinger, ability: 'p:0:0' }).error).toBeUndefined();
    attach(s, 'p2', 'Test Numbing Kiss', pinger);
    expect(Number(getChars(s, pinger)!.power)).toBe(1);
    expect(applyAction(s, { type: 'activate', player: 'p1', source: pinger, ability: 'p:0:0' }).error?.rules).toContain('CR 602.5');
  });
});

describe('CR 611.3a, 613.1d, 301.7: "As long as enchanted permanent is a Vehicle, it\'s a creature in addition to its other types."', () => {
  it('the enchanted Vehicle is an artifact creature with its printed power and toughness, and the other ability then applies to it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Wagon'] }, defs: DEFS });
    const wagon = find(s, 'Test Wagon', 'battlefield', 'p1');
    expect(getChars(s, wagon)!.types).not.toContain('Creature');
    attach(s, 'p1', 'Test Rigging', wagon);
    const c = getChars(s, wagon)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(c.keywords.some((k) => k.keyword === 'haste')).toBe(true);
  });
  it('on a creature that is not a Vehicle it changes no type', () => {
    const s = scenario([], { p1: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    attach(s, 'p1', 'Test Rigging', bear);
    expect(getChars(s, bear)!.types).toEqual(['Creature']);
    expect(Number(getChars(s, bear)!.power)).toBe(3);
  });
});

describe('CR 701.15a-b: a resolved goad for the rest of the game, and an identity-changing goading Aura', () => {
  const NUISANCE = card('Test Goblin Hexer', 'Creature — Goblin', 'Whenever this creature deals combat damage to a player, that player creates a 1/1 red Goblin creature token. The token is goaded for the rest of the game.', ['1', '1']);
  const HEX = card('Test Dragon Hex', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature is a red Goblin with base power and toughness 3/1, has haste and menace, and is goaded.');
  it('both are automated', () => {
    expect(full(NUISANCE)).toBe(true);
    expect(full(HEX)).toBe(true);
  });

  it('the token is goaded by the trigger\'s controller, and still after that player\'s next turn began (CR 611.2a)', () => {
    let s = mpScenario({ defs: [...DEFS, NUISANCE], zones: { p1: { battlefield: [{ name: 'Test Goblin Hexer', since: -1 } as never] } } });
    const hexer = find(s, 'Test Goblin Hexer', 'battlefield', 'p1');
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: hexer, defender: 'p2' }] });
    for (let guard = 0; s.turn.step !== 'main2' && guard < 60; guard++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = resolveStack(pass(s));
    }
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p2');
    expect(token).toBeDefined();
    // a full round later (Alice's next turn has begun), Bob's token is still goaded by Alice
    for (let guard = 0; guard < 600 && !(s.turn.activePlayer === 'p2' && s.turn.number === 6 && s.pending?.kind === 'declareAttackers'); guard++) {
      // on Bob's turn 2 the token must attack (it is goaded): it attacks Carol, which obeys both requirements
      if (s.pending?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: s.pending.player === 'p2' ? [{ attacker: token!, defender: 'p3' }] : [] }); continue; }
      if (s.pending?.kind === 'declareBlockers') { s = answer(s, { kind: 'declareBlockers', blocks: [] }); continue; }
      s = pass(s);
    }
    expect(s.pending).toMatchObject({ kind: 'declareAttackers', player: 'p2', mustObey: 2 });
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: token!, defender: 'p1' }] } }).error?.message).toMatch(/attacks a player other than Alice/);
  });

  it('"Enchanted creature is a red Goblin with base power and toughness 3/1, has haste and menace, and is goaded."', () => {
    let s = mpScenario({ defs: [...DEFS, HEX], zones: { p2: { battlefield: ['Test Ox'] } } });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    const hex = put(s, 'p1', 'battlefield', 'Test Dragon Hex');
    s.objects[hex]!.attachedTo = ox;
    const c = getChars(s, ox)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 1]);
    expect(c.colors).toEqual(['R']);
    expect(c.subtypes).toEqual(['Goblin']);
    expect(c.keywords.map((k) => k.keyword).sort()).toEqual(['haste', 'menace']);
    for (let guard = 0; guard < 400 && !(s.pending?.kind === 'declareAttackers' && s.pending.player === 'p2'); guard++) {
      if (s.pending?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      s = pass(s);
    }
    expect(s.pending).toMatchObject({ mustObey: 2 });
  });
});
