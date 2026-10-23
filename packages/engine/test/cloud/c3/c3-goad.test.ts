/**
 * Cloud C3 follow-up (cloud batch 3): the static goad ("enchanted creature gets +1/+1 and is goaded", `RestrictionDef.goad`), played through the engine with
 * synthetic cards compiled by the game's default compiler (the wordings are invented, design 6.10), mostly in 4-player Free-for-All games (CR 806).
 *
 *   CR 701.15a-b  a goaded creature attacks each combat if able and attacks a player other than the goader if able; the goader of a static goad is the
 *                 controller of the permanent with the ability (CR 109.5), for as long as the ability applies (CR 604.1, 611.3a)
 *   CR 701.15c-d  goaded by several players: a pair of requirements each; by the same player twice (the goad action and an Aura): one pair
 *   CR 303.4, 301.5  "enchanted creature" / "equipped creature": the object the Aura or Equipment is attached to now, so the goad ends as it leaves or moves
 *   CR 508.1d     the attack declaration obeys as many requirements as possible
 *   CR 603.10a, 608.2h  "whenever a goaded creature dies" looks back: the creature was goaded as it left, even if the Aura or the goading creature left with it
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, drive, find, lifeOf, mpScenario, pass, put, resolveStack } from '../../m12/rules/helpers';
import { scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '3']);
const AURA = card('Test Goading Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+1 and is goaded.');
const PLAIN_AURA = card('Test Taunting Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature is goaded.');
const BLADE = card('Test Goading Blade', 'Artifact — Equipment', 'Equipped creature is goaded.\n{0}: Attach this Equipment to target creature an opponent controls. Activate only as a sorcery.');
const TAUNTER = card('Test Taunter', 'Creature — Human', 'Creatures your opponents control with power 2 or less are goaded.', ['3', '3']);
const WATCHER = card('Test Goad Watcher', 'Enchantment', 'Whenever a goaded creature attacks, you gain 2 life.');
const MOURNER = card('Test Goad Mourner', 'Enchantment', 'Whenever a goaded creature dies, you gain 3 life.');
const WARD = card('Test Goad Ward', 'Enchantment', "Goaded creatures can't block.");
const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
const SHOCK = card('Test Shatter', 'Instant', 'Destroy target enchantment.');
const DEFS = [BEAR, OX, AURA, PLAIN_AURA, BLADE, TAUNTER, WATCHER, MOURNER, WARD, WRATH, SHOCK];

/** Pass priority until `player` is asked to declare attackers (nobody else attacks or blocks on the way). */
function toAttacks(s: GameState, player: PlayerId): GameState {
  let t = s;
  for (let i = 0; i < 400; i++) {
    if (t.pending?.kind === 'declareAttackers' && t.pending.player === player) return t;
    if (t.pending?.kind === 'declareAttackers') { t = answer(t, { kind: 'declareAttackers', attacks: [] }); continue; }
    if (t.pending?.kind === 'declareBlockers') { t = answer(t, { kind: 'declareBlockers', blocks: [] }); continue; }
    if (t.pending?.kind !== 'priority') throw new Error(`unexpected ${t.pending?.kind}: ${t.pending?.prompt}`);
    t = pass(t);
  }
  throw new Error(`${player} never declared attackers`);
}
const declare = (s: GameState, attacks: { attacker: ObjectId; defender: string }[]) =>
  applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } });

/** A 4-player game: Bob (p2) has a Test Bear; each `auras` entry is [owner, Aura name] attached to it. */
function goadedBear(auras: [PlayerId, string][], extra: Partial<Record<PlayerId, string[]>> = {}, hand: string[] = []): GameState {
  return mpScenario({
    defs: DEFS,
    zones: {
      p1: { battlefield: [...auras.filter(([p]) => p === 'p1').map(([, n]) => n), ...(extra.p1 ?? [])], hand },
      p2: { battlefield: ['Test Bear', ...(extra.p2 ?? [])] },
      p3: { battlefield: [...auras.filter(([p]) => p === 'p3').map(([, n]) => n), ...(extra.p3 ?? [])] },
      p4: { battlefield: extra.p4 ?? [] },
    },
    setup: (x) => {
      const bear = find(x, 'Test Bear', 'battlefield', 'p2');
      for (const [p, n] of auras) x.objects[find(x, n, 'battlefield', p)]!.attachedTo = bear;
    },
  });
}

describe('Cloud C3: the synthetic static goad cards are automated', () => {
  for (const d of DEFS) it(d.name, () => expect(full(d), JSON.stringify(d.automation)).toBe(true));
});

describe('CR 701.15a-b, 303.4: "Enchanted creature gets +2/+1 and is goaded."', () => {
  it('the enchanted creature gets +2/+1, attacks each combat if able, and attacks a player other than the Aura\'s controller if able', () => {
    let s = goadedBear([['p1', 'Test Goading Aura']]);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(Number(getChars(s, bear)!.power)).toBe(4);
    expect(Number(getChars(s, bear)!.toughness)).toBe(3);
    expect(s.objects[bear]!.goaded).toBeUndefined(); // a static designation: nothing is stored on the creature (CR 611.3a)
    s = toAttacks(s, 'p2');
    expect(s.pending).toMatchObject({ kind: 'declareAttackers', mustObey: 2 });
    expect(declare(s, []).error?.rules).toContain('CR 508.1d');
    expect(declare(s, [{ attacker: bear, defender: 'p1' }]).error?.message).toMatch(/attacks a player other than Alice/);
    expect(declare(s, [{ attacker: bear, defender: 'p3' }]).error).toBeUndefined();
    expect(declare(s, [{ attacker: bear, defender: 'p4' }]).error).toBeUndefined();
  });

  it('CR 109.5: the goader is the controller of the Aura (Carol\'s Aura on Bob\'s creature: it attacks Alice or Dan)', () => {
    let s = goadedBear([['p3', 'Test Taunting Aura']]);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = toAttacks(s, 'p2');
    expect(declare(s, [{ attacker: bear, defender: 'p3' }]).error?.message).toMatch(/attacks a player other than Carol/);
    expect(declare(s, [{ attacker: bear, defender: 'p1' }]).error).toBeUndefined();
  });

  it('CR 611.3a, 303.4: the goad ends as the Aura leaves the battlefield', () => {
    let s = goadedBear([['p1', 'Test Taunting Aura']], {}, ['Test Shatter']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const aura = find(s, 'Test Taunting Aura', 'battlefield', 'p1');
    s = resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shatter', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: aura }] }]));
    expect(s.zones.battlefield).not.toContain(aura);
    s = toAttacks(s, 'p2');
    expect(s.pending).toMatchObject({ kind: 'declareAttackers' });
    expect(s.pending?.kind === 'declareAttackers' ? s.pending.mustObey ?? 0 : -1).toBe(0);
    expect(declare(s, []).error).toBeUndefined();
    expect(declare(s, [{ attacker: bear, defender: 'p1' }]).error).toBeUndefined();
  });

  it('CR 701.15c: goaded by Alice\'s and Carol\'s Auras, it must attack Dan (four requirements)', () => {
    let s = goadedBear([['p1', 'Test Taunting Aura'], ['p3', 'Test Taunting Aura']]);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = toAttacks(s, 'p2');
    expect(s.pending).toMatchObject({ mustObey: 4 });
    expect(declare(s, [{ attacker: bear, defender: 'p1' }]).error?.rules).toContain('CR 508.1d');
    expect(declare(s, [{ attacker: bear, defender: 'p3' }]).error?.rules).toContain('CR 508.1d');
    expect(declare(s, [{ attacker: bear, defender: 'p4' }]).error).toBeUndefined();
  });

  it('CR 701.15d: two Auras of the same player, or its Aura and its goad action, are one goader (one pair of requirements)', () => {
    let s = goadedBear([['p1', 'Test Taunting Aura'], ['p1', 'Test Goading Aura']]);
    let t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ mustObey: 2 });
    s = goadedBear([['p1', 'Test Taunting Aura']]);
    s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.goaded = [{ by: 'p1' }]; // as Alice's goad action would store it
    t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ mustObey: 2 });
  });
});

describe('CR 701.15a-b, 301.5: "Equipped creature is goaded." moves with the Equipment', () => {
  it('attached to Bob\'s creature, then moved to Carol\'s: only the creature it is attached to is goaded', () => {
    let s = mpScenario({
      defs: DEFS,
      zones: { p1: { battlefield: ['Test Goading Blade'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Ox'] } },
      setup: (x) => { x.objects[find(x, 'Test Goading Blade', 'battlefield', 'p1')]!.attachedTo = find(x, 'Test Bear', 'battlefield', 'p2'); },
    });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const ox = find(s, 'Test Ox', 'battlefield', 'p3');
    const blade = find(s, 'Test Goading Blade', 'battlefield', 'p1');
    let t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ mustObey: 2 });
    // Alice moves the Equipment to Carol's Ox (CR 301.5c: an Equipment that becomes attached to another object is no longer attached to the first)
    s = act(s, { type: 'activate', player: 'p1', source: blade, ability: 'p:0:1' });
    s = resolveStack(drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: ox }] }]));
    expect(s.objects[blade]!.attachedTo).toBe(ox);
    t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ kind: 'declareAttackers', player: 'p2' });
    expect(t.pending?.kind === 'declareAttackers' ? t.pending.mustObey ?? 0 : -1).toBe(0); // the Bear is free
    expect(declare(t, []).error).toBeUndefined();
    t = toAttacks(answer(t, { kind: 'declareAttackers', attacks: [] }), 'p3');
    expect(t.pending).toMatchObject({ kind: 'declareAttackers', mustObey: 2 });
    expect(declare(t, [{ attacker: ox, defender: 'p1' }]).error?.message).toMatch(/attacks a player other than Alice/);
    expect(declare(t, [{ attacker: ox, defender: 'p2' }]).error).toBeUndefined();
  });
});

describe('CR 701.15a-b, 611.3a: "Creatures your opponents control with power 2 or less are goaded."', () => {
  it('the creatures it describes now are goaded by its controller; one that grows out of it is not', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Taunter'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
    const bobBear = find(s, 'Test Bear', 'battlefield', 'p2');
    let t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ mustObey: 2 });
    expect(declare(t, [{ attacker: bobBear, defender: 'p1' }]).error?.message).toMatch(/attacks a player other than Alice/);
    // a +1/+1 counter takes Bob's Bear out of the description (power 3): no longer goaded
    s.objects[bobBear]!.counters['+1/+1'] = 1;
    t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ kind: 'declareAttackers', player: 'p2' });
    expect(t.pending?.kind === 'declareAttackers' ? t.pending.mustObey ?? 0 : -1).toBe(0);
  });
});

describe('the goaded filter sees a static goad (CR 701.15b)', () => {
  it('"Whenever a goaded creature attacks, you gain 2 life." triggers for the Aura\'s creature', () => {
    let s = goadedBear([['p1', 'Test Taunting Aura']], { p1: ['Test Goad Watcher'] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = toAttacks(s, 'p2');
    s = act(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p3' }] } });
    s = resolveStack(s);
    expect(lifeOf(s, 'p1')).toBe(22);
  });

  it('"Goaded creatures can\'t block." applies to the Aura\'s creature, not to the others', () => {
    let s = mpScenario({
      defs: DEFS,
      zones: { p1: { battlefield: ['Test Taunting Aura', 'Test Goad Ward', 'Test Ox'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] } },
      setup: (x) => { x.objects[find(x, 'Test Taunting Aura', 'battlefield', 'p1')]!.attachedTo = find(x, 'Test Bear', 'battlefield', 'p2'); },
    });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const bobOx = find(s, 'Test Ox', 'battlefield', 'p2');
    const aliceOx = find(s, 'Test Ox', 'battlefield', 'p1');
    s = toAttacks(s, 'p1');
    s = act(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: aliceOx, defender: 'p2' }] } });
    for (let i = 0; i < 20 && s.pending?.kind !== 'declareBlockers'; i++) s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'declareBlockers', player: 'p2' });
    const block = (blocker: ObjectId) => applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker: aliceOx }] } });
    expect(block(bear).error).toBeDefined();
    expect(block(bobOx).error).toBeUndefined();
  });

  it('CR 603.10a: "Whenever a goaded creature dies" triggers when the creature and the goading creature are destroyed at once', () => {
    let s = mpScenario({
      defs: DEFS,
      zones: { p1: { battlefield: ['Test Taunter'], hand: ['Test Wrath'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Goad Mourner'] } },
    });
    s = resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wrath', 'hand', 'p1') })));
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
    expect(lifeOf(s, 'p3')).toBe(23); // the Bear was goaded by Alice's Taunter as it died; the Taunter (power 3) never was
  });

  it('a creature that was never goaded does not trigger it', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Wrath'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Goad Mourner'] } } });
    s = resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wrath', 'hand', 'p1') })));
    expect(lifeOf(s, 'p3')).toBe(20);
  });
});

describe('m12 design D16: a static goad in a two-player game', () => {
  it('CR 701.15b, 508.1d: the enchanted creature attacks each combat if able; the goader is the only player it can attack', () => {
    let s = scenario([], { p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s.objects[put(s, 'p1', 'battlefield', 'Test Taunting Aura')]!.attachedTo = bear; // attached before any state-based action check (CR 704.5m)
    for (let i = 0; i < 200 && !(s.pending?.kind === 'declareAttackers' && s.pending.player === 'p2'); i++) {
      if (s.pending?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      s = pass(s);
    }
    expect(s.pending).toMatchObject({ kind: 'declareAttackers', mustObey: 1 });
    expect(declare(s, []).error?.rules).toContain('CR 508.1d');
    expect(declare(s, [{ attacker: bear, defender: 'p1' }]).error).toBeUndefined();
  });
});
