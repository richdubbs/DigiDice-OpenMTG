/**
 * FAST1 T4: the trigger and activated-ability shapes that are not template data, read by the parser (hole grammars, activation restrictions, wrapper
 * keywords), printed back by the renderer (the exact gate, G6) and played by the engine: synthetic cards compiled by the game's default pipeline.
 *
 *   - "~ or another <subtype> you control" (CR 603.2, 603.6a), "dies" of a creature type (CR 700.4), "whenever you attack [with N or more creatures]" (CR 508.3c-d),
 *     "historic" (CR 700.6), "combat damage to a player or planeswalker" (CR 120.1), "the target of a spell or ability an opponent controls" (CR 115.1),
 *     "first main phase" (CR 505.1a), "the upkeep of enchanted creature's controller" (CR 503.1);
 *   - "a player taps a land for mana" / "enchanted land is tapped for mana" (CR 106.12, 605.1b) with "adds an additional {G}" (the ManaUnits hole);
 *   - "you cast your second spell each turn" (`cast.nth`, CR 601.2i);
 *   - "Activate only during your upkeep", "Activate only once", "Activate no more than twice each turn", "Activate only during combat" (CR 602.5b);
 *   - "Exhaust -- [Cost]: [Effect]" (CR 702.177a), "Return ~ from your graveyard to ..." (CR 113.6m), battalion (CR 508.3a), "cycle or discard" (CR 702.29a).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, GameState, OracleCard } from '../../../src/index';
import { compileCard } from '../../../src/index';
import type { FaceParse } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { runHole } from '../../../src/parser/holes';
import { adaptTokens } from '../../../src/parser/holes/tok';
import { tokenize } from '../../../src/parser/tokenize';
import { GENERATED_LEXICON } from '../../../src/parser/front/lexicon-index';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import { card } from '../../m5/templates/support';
import { act, advanceTo, answer, castAuto, find, legal, life, passBoth, pool, put, reject, scenario } from '../../m5/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });
const faceOf = (type: string, text: string): FaceParse => parseCard(card('Trial Subject', type, text), OPTS).faces[0]!;
type Rec = Record<string, unknown>;
const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== 'object') return v;
  const o: Rec = {};
  for (const [k, x] of Object.entries(v as Rec)) if (!['text', 'src', 'prov', 'span', 'sentence', 'label'].includes(k)) o[k] = strip(x);
  return o;
};
/** The abilities without display fields, and whether every one is fully automated and passed the gate. */
function read(type: string, text: string): { abilities: Rec[]; full: boolean } {
  const f = faceOf(type, text);
  const full = f.abilities.every((a) => a.kind !== 'manual' && !JSON.stringify(a).includes('"op":"manual"')) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
  return { abilities: strip(f.abilities) as Rec[], full };
}
const triggerOf = (type: string, text: string): unknown => (read(type, text).abilities.find((a) => a['kind'] === 'triggered') as Rec | undefined)?.['trigger'];

describe('FAST1 T4: trigger conditions the renderer now prints exactly (design 6.8 G6)', () => {
  it('CR 603.2, 603.6a: "~ or another Elf you control enters" on an Elf is "an Elf you control enters"; on a creature that is no Elf it is two events', () => {
    const elf = read('Creature — Elf Druid', 'Whenever ~ or another Elf you control enters, you gain 1 life.');
    expect(elf.full).toBe(true);
    expect(elf.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'zoneChange', subject: { subtypes: ['Elf'], controller: 'you' }, to: 'battlefield' }] });
    // FAST4 T23 (render/evt.ts, family subjects-one-predicate): the one-filter reading would leave ~ out, so the Event hole's reading of ~ entering and
    // another Elf you control entering is the one that passes the render gate (the guard G10 retry without trg.selfOrAnother.enters)
    const human = read('Creature — Human Druid', 'Whenever ~ or another Elf you control enters, you gain 1 life.');
    expect(human.full).toBe(true);
    expect(human.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, { ev: 'zoneChange', subject: { subtypes: ['Elf'], controller: 'you', other: true }, to: 'battlefield' }] });
  });
  it('CR 700.4: "another Goblin you control dies" is "put into a graveyard from the battlefield"', () => {
    const r = read('Creature — Goblin', 'Whenever another Goblin you control dies, you gain 1 life.');
    expect(r.full).toBe(true);
    expect(r.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'zoneChange', subject: { subtypes: ['Goblin'], other: true, controller: 'you' }, from: 'battlefield', to: 'graveyard' }] });
  });
  it('CR 508.3c-d: "whenever you attack" and "whenever you attack with two or more creatures" (one trigger per declaration, CR 603.2c)', () => {
    const one = read('Creature — Soldier', 'Whenever you attack, you gain 1 life.');
    expect(one.full).toBe(true);
    expect(one.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 } }], batch: true });
    const two = read('Creature — Soldier', 'Whenever you attack with two or more creatures, you gain 1 life.');
    expect(two.full).toBe(true);
    expect(two.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' }, count: { op: '>=', value: 2 } }], batch: true });
  });
  it('CR 508.3a: battalion is ~ attacking with at least two others (the attackers of one declaration), not a batch trigger', () => {
    const r = read('Creature — Soldier', 'Whenever ~ and at least two other creatures attack, you gain 1 life.');
    expect(r.full).toBe(true);
    expect(r.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'attacks', attacker: { self: true }, count: { op: '>=', value: 3 } }] });
  });
  it('CR 700.6: "a historic spell" is an artifact, legendary or Saga spell', () => {
    const r = read('Creature — Human', 'Whenever you cast a historic spell, you gain 1 life.');
    expect(r.full).toBe(true);
    expect(r.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'cast', player: 'you', spell: { anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] } }] });
  });
  it('CR 120.1: "combat damage to a player or planeswalker" names both recipients (never the bare "deals combat damage")', () => {
    const r = read('Creature — Rogue', 'Whenever ~ deals combat damage to a player or planeswalker, you gain 1 life.');
    expect(r.full).toBe(true);
    expect(JSON.stringify(r.abilities[0]!['trigger'])).toContain('"recipient"');
    expect(triggerOf('Creature — Rogue', 'Whenever ~ deals combat damage, you gain 1 life.')).not.toEqual(r.abilities[0]!['trigger']);
  });
  // std-rx19 (changed on purpose): "that player" there is the opponent who controls the targeting spell or ability, now bound as such (parser/lower/scope.ts#eventMentions)
  it('CR 115.1: "the target of a spell or ability an opponent controls"; "that player" there is the opponent who controls it, not the event\'s player', () => {
    const r = read('Creature — Elf', 'Whenever ~ becomes the target of a spell or ability an opponent controls, you gain 1 life.');
    expect(r.full).toBe(true);
    expect(r.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'becomes', what: 'targeted', object: { self: true }, by: { controller: 'opponent' } }] });
    const that = read('Creature — Elf', 'Whenever ~ becomes the target of a spell or ability an opponent controls, destroy target creature that player controls.');
    expect(that.full).toBe(true);
    expect(JSON.stringify(that.abilities[0])).toContain('"controller":{"ref":"controllerOf","object":{"ref":"event","role":"spell"}}');
  });
  it('CR 505.1a: the first main phase is the precombat one; the second main phase is not the postcombat one (an extra combat adds another)', () => {
    expect(read('Creature — Elf', 'At the beginning of your first main phase, you gain 1 life.').full).toBe(true);
    // FAST5X E17 (CR 505.1b): automated now as the main phase numbered 2 in its turn (`nth: 2`), which the renderer prints back as "second main phase"
    const second = read('Creature — Elf', 'At the beginning of your second main phase, you gain 1 life.');
    expect(second.full).toBe(true);
    expect(second.abilities[0]!['trigger']).toEqual({ on: [{ ev: 'step', step: 'main2', whose: 'you', nth: 2 }] });
  });
  it('CR 503.1, 603.2: "the upkeep of enchanted creature\'s controller" is that player\'s upkeep; "that player" and "that creature" are bound', () => {
    const r = read('Enchantment — Aura', "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.");
    expect(r.full).toBe(true);
    expect(r.abilities[1]!['trigger']).toEqual({ on: [{ ev: 'step', step: 'upkeep', whose: { ref: 'controllerOf', object: { ref: 'attachedTo' } } }] });
    expect(r.abilities[1]!['effect']).toEqual({ targets: [], steps: [{ op: 'loseLife', who: { ref: 'event', role: 'player' }, amount: 1 }] });
    const c = read('Enchantment — Aura', "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, tap that creature.");
    expect(c.abilities[1]!['effect']).toEqual({ targets: [], steps: [{ op: 'tap', what: { ref: 'attachedTo' } }] });
  });
});

describe('FAST1 T4: lands tapped for mana (CR 106.12, 605.1b) and "an additional" mana (the ManaUnits hole)', () => {
  it('"a player taps a land for mana" and "a Forest is tapped for mana" are activations of a mana ability of a land; a creature is never read', () => {
    expect(triggerOf('Enchantment', 'Whenever a player taps a land for mana, ~ deals 1 damage to that player.')).toEqual({ on: [{ ev: 'activate', player: 'any', source: { types: ['Land'] }, manaAbility: true }] });
    const forest = read('Enchantment', 'Whenever a Forest is tapped for mana, its controller adds an additional {G}.');
    expect(forest.full).toBe(true);
    expect(forest.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'activate', source: { subtypes: ['Forest'] }, manaAbility: true }] }, effect: { steps: [{ op: 'addMana', who: { ref: 'controllerOf', object: { ref: 'event', role: 'source' } }, units: [['G']] }] } });
    // a creature's mana ability may have no {T} ("Sacrifice a Goblin: Add {R}"): std-mana-1 reads "taps a creature for mana" with the {T} of the activation
    // (`tapped`, rules/mana.ts#addMana, CR 106.12), so an activation without {T} does not trigger it (played in test/cloud/std-mana-1/std-mana-1-scenarios.test.ts)
    const creature = read('Enchantment', 'Whenever you tap a creature for mana, add an additional {G}.');
    expect(creature.full).toBe(true);
    expect(creature.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'activate', source: { types: ['Creature'] }, manaAbility: true, tapped: true }] } });
  });
  const units = (text: string): unknown[] => {
    const toks = adaptTokens(tokenize(text, { lexicon: GENERATED_LEXICON }));
    return runHole('ManaUnits', toks, 0, { lexicon: GENERATED_LEXICON, keywords: OPTS.keywords }).filter((a) => a.end === toks.length).map((a) => a.value);
  };
  it('the ManaUnits hole: a run of symbols, one unit chosen from a list (Oxford comma for three), the filter lands\' pairs; nothing else', () => {
    expect(units('{B}{G}')).toEqual([[['B'], ['G']]]);
    expect(units('{R} or {G}')).toEqual([[['R', 'G']]]);
    expect(units('{W}, {U}, or {B}')).toEqual([[['W', 'U', 'B']]]);
    expect(units('{W}{W}, {W}{B}, or {B}{B}')).toEqual([[['W', 'B'], ['W', 'B']]]);
    for (const no of ['{W}, {U} or {B}', '{R}, or {G}', '{R}{R} or {G}{G}', '{R} or {R}', '{2}', '{G/W}', '{W}{W}, {W}{U}, or {B}{B}']) expect(units(no), no).toEqual([]);
  });
});

describe('FAST1 T4: "your second spell each turn" (cast.nth, CR 601.2i)', () => {
  it('you, an opponent, a player; "their" only for another player', () => {
    expect(triggerOf('Creature — Monk', 'Whenever you cast your second spell each turn, you gain 1 life.')).toEqual({ on: [{ ev: 'cast', player: 'you', nth: 2 }] });
    expect(triggerOf('Creature — Monk', 'Whenever an opponent casts their second spell each turn, you gain 1 life.')).toEqual({ on: [{ ev: 'cast', player: 'opponent', nth: 2 }] });
    expect(read('Creature — Monk', 'Whenever you cast their second spell each turn, you gain 1 life.').full).toBe(false);
  });
});

describe('FAST1 T4: activation restrictions and wrapper keywords (CR 602.5b, 702.177a)', () => {
  const activatedOf = (text: string): Rec => read('Artifact Creature — Golem', text).abilities.find((a) => a['kind'] === 'activated' || a['kind'] === 'manual')!;
  it('"during your upkeep", "during combat", "only once", "no more than twice each turn"', () => {
    expect(activatedOf('{1}: You gain 1 life. Activate only during your upkeep.')).toMatchObject({ kind: 'activated', onlyIf: { cond: 'turnOf', whose: 'you', step: 'upkeep' } });
    expect(activatedOf('{1}: You gain 1 life. Activate only during combat.')).toMatchObject({ kind: 'activated', onlyIf: { cond: 'turnOf', whose: 'any' } });
    expect(activatedOf('{1}: You gain 1 life. Activate only once.')).toMatchObject({ kind: 'activated', limit: { per: 'game', max: 1 } });
    expect(activatedOf('{1}: You gain 1 life. Activate no more than twice each turn.')).toMatchObject({ kind: 'activated', limit: { per: 'turn', max: 2 } });
    for (const t of ['{1}: You gain 1 life. Activate only during your upkeep.', '{1}: You gain 1 life. Activate only once.', '{1}: You gain 1 life. Activate no more than twice each turn.']) expect(read('Artifact Creature — Golem', t).full, t).toBe(true);
  });
  it('"Exhaust -- [Cost]: [Effect]" is the activated ability with the keyword\'s limit; an exhaust ability with a restriction the keyword does not give has both (cloud std-dsk), one the keyword gives too stays manual but keeps the limit', () => {
    const r = read('Creature — Elf', 'Exhaust — {2}: You gain 3 life.');
    expect(r.full).toBe(true);
    expect(r.abilities[0]).toEqual({ kind: 'activated', cost: { mana: [{ kind: 'generic', amount: 2 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }] }, limit: { per: 'game', max: 1 }, keyword: 'exhaust' });
    // cloud std-dsk (CR 702.177a, 602.5b): the keyword's "once" and the ability's own "as a sorcery" both apply (parser/lower/ability.ts; render/abil.ts says the own one)
    const own = read('Creature — Elf', 'Exhaust — {2}: You gain 3 life. Activate only as a sorcery.');
    expect(own.full).toBe(true);
    expect(own.abilities[0]).toMatchObject({ kind: 'activated', keyword: 'exhaust', limit: { per: 'game', max: 1 }, sorcerySpeed: true });
    const twice = read('Creature — Elf', 'Exhaust — {2}: You gain 3 life. Activate only once each turn.');
    expect(twice.full).toBe(false);
    expect(twice.abilities[0]).toMatchObject({ kind: 'manual', shape: 'activated', limit: { per: 'game', max: 1 } });
  });
  it('CR 113.6m: "Return ~ from your graveyard to your hand" functions in the graveyard', () => {
    const r = read('Creature — Spirit', '{2}{B}{B}{B}: Return ~ from your graveyard to your hand.');
    expect(r.full).toBe(true);
    expect(r.abilities[0]).toMatchObject({ kind: 'activated', zone: ['graveyard'], effect: { steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'hand' } }] } });
    // std-sos (and cloud std-woe, the same rule): a trigger that returns ~ from the graveyard functions there too (triggers/collect.ts collects an ability with `zone` from the cards in graveyards): automated, played in test/cloud/std-sos
    const trg = read('Creature — Spirit', 'At the beginning of your upkeep, you may return ~ from your graveyard to your hand.');
    expect(trg.full).toBe(true);
    expect(trg.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['graveyard'] });
    // ... and (p2-c-cast-zone-1, CR 113.6m, 603.4) one with an intervening "if" reading ~ in the graveyard, where the ability functions (parser/holes/cond.ts)
    expect(read('Creature — Spirit', 'At the beginning of your upkeep, if ~ is in your graveyard, you may return it to your hand.').full).toBe(true);
    // (an "if" right after the trigger condition is an intervening "if", CR 603.4: r5-cost reads it on a graveyard trigger, played in test/cloud/r5-cost/graveyard-attack-return.test.ts
    // and test/cloud/r5-fxz; merge wave 8 kept r5-cost's reading of r5-fxz's same rule)
    expect(read('Creature — Spirit', 'At the beginning of your upkeep, if you control a Swamp, you may return ~ from your graveyard to your hand.').full).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Played: synthetic cards through the default pipeline
// ---------------------------------------------------------------------------------------------------------------------------------------------------

function compiled(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const nothing = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));

const spark = compiled('Test Spark', 'Sorcery', 'You gain 1 life.');
const monk = compiled('Test Monk', 'Creature — Monk', 'Whenever you cast your second spell each turn, you gain 10 life.', '{1}', ['1', '1']);
const captain = compiled('Test Captain', 'Creature — Soldier', 'Whenever ~ and at least two other creatures attack, you gain 5 life.', '{1}', ['1', '1']);
const growth = compiled('Test Growth', 'Enchantment — Aura', 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.');
const exhauster = compiled('Test Exhauster', 'Creature — Elf', 'Exhaust — {0}: You gain 3 life.', '{1}', ['1', '1']);
const phoenix = compiled('Test Phoenix', 'Creature — Phoenix', '{0}: Return ~ from your graveyard to your hand.', '{1}', ['1', '1']);
const vizier = compiled('Test Vizier', 'Creature — Zombie', 'Whenever you cycle or discard a card, you gain 2 life.', '{1}', ['1', '1']);
const cycler = compiled('Test Cycler', 'Creature — Beast', 'Cycling {0}', '{5}', ['4', '4']);
const lash = compiled('Test Lash', 'Enchantment — Aura', "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 3 life.");
const augur = compiled('Test Augur', 'Creature — Wizard', '{0}: You gain 4 life. Activate only during your upkeep.', '{1}', ['1', '1']);
const DEFS = [spark, monk, captain, growth, exhauster, phoenix, vizier, cycler, lash, augur];

describe('FAST1 T4: the synthetic cards are fully automated', () => {
  it('no manual ability or step', () => {
    for (const d of DEFS) expect(nothing(d), d.name).toEqual([]);
  });
});

const lifeOf = (s: GameState, p: string): number => life(s, p);
/** Activate an ability of an object and pay automatically (test only). */
function activate(s: GameState, source: string, ability: string): GameState {
  let t = act(s, { type: 'activate', player: 'p1', source, ability });
  while (t.pending && t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  return t;
}

describe('FAST1 T4 (CR 601.2i): "Whenever you cast your second spell each turn" triggers on the second spell only', () => {
  it('first spell: no trigger; second: the trigger resolves; third: no trigger', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Spark', 'Test Spark', 'Test Spark'], battlefield: ['Test Monk'] } });
    const start = lifeOf(s, 'p1');
    s = passBoth(castAuto(s, 'Test Spark'));
    expect(lifeOf(s, 'p1')).toBe(start + 1);
    s = castAuto(s, 'Test Spark');
    s = passBoth(passBoth(s)); // the trigger, then the spell
    expect(lifeOf(s, 'p1')).toBe(start + 1 + 10 + 1);
    s = passBoth(castAuto(s, 'Test Spark'));
    expect(lifeOf(s, 'p1')).toBe(start + 1 + 10 + 1 + 1);
  });
});

describe('FAST1 T4 (CR 508.3a): battalion triggers when ~ and at least two others attack', () => {
  const board = (): GameState => scenario(['Grizzly Bears', 'Hill Giant'], { defs: DEFS, p1: { battlefield: ['Test Captain', 'Grizzly Bears', 'Hill Giant'] } });
  const ids = (s: GameState): string[] => [find(s, 'Test Captain', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
  it('three attackers: once; two attackers: never', () => {
    const s0 = board();
    const start = lifeOf(s0, 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), ids(s0).map((id) => [id] as [string]));
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.turn.step !== 'declareAttackers', 'the trigger resolved', 10);
    expect(lifeOf(s, 'p1')).toBe(start + 5);
    const t0 = board();
    let t = declareAttackers(toDeclareAttackers(t0), ids(t0).slice(0, 2).map((id) => [id] as [string]));
    t = passUntil(t, (x) => x.turn.step !== 'declareAttackers', 'the next step', 10);
    expect(lifeOf(t, 'p1')).toBe(start);
  });
});

describe('FAST1 T4 (CR 106.12, 605.4a): "Whenever enchanted land is tapped for mana, its controller adds an additional {G}"', () => {
  it('the enchanted Forest makes {G}{G} at once (no stack); another Forest makes {G}', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Forest', 'Forest'] } });
    const [enchanted, other] = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Forest');
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Growth')]!.attachedTo = enchanted!; // test setup: the Aura on the first Forest (CR 303.4)
    let s = act(s0, { type: 'activate', player: 'p1', source: enchanted!, ability: 'r:basic:G' });
    expect(s.zones.stack).toEqual([]);
    expect(pool(s, 'p1')).toBe('GG');
    s = act(s, { type: 'activate', player: 'p1', source: other!, ability: 'r:basic:G' });
    expect(pool(s, 'p1')).toBe('GGG');
  });
});

describe('FAST1 T4 (CR 702.177a): an exhaust ability can be activated only once', () => {
  it('the second activation is refused', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Exhauster'] } });
    const id = find(s0, 'Test Exhauster', 'battlefield');
    const start = lifeOf(s0, 'p1');
    const s = passBoth(activate(s0, id, 'p:0:0'));
    expect(lifeOf(s, 'p1')).toBe(start + 3);
    expect(reject(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }).message).toContain('only once');
  });
});

describe('FAST1 T4 (CR 113.6m): "{0}: Return ~ from your graveyard to your hand" is activated from the graveyard', () => {
  it('offered in the graveyard, not on the battlefield; it returns the card', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { graveyard: ['Test Phoenix'] }, p2: { battlefield: ['Test Phoenix'] } });
    const gy = find(s0, 'Test Phoenix', 'graveyard', 'p1');
    expect(legal(s0, 'p1', 'activate').some((a) => a.object === gy)).toBe(true);
    const s = passBoth(activate(s0, gy, 'p:0:0'));
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Phoenix')).toBe(true);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Phoenix')).toBe(false);
    const s1 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Phoenix'] } });
    expect(legal(s1, 'p1', 'activate').some((a) => a.object === find(s1, 'Test Phoenix', 'battlefield'))).toBe(false);
  });
});

describe('FAST1 T4 (CR 702.29a): "Whenever you cycle or discard a card" triggers once for a cycled card', () => {
  it('cycling discards the card: one trigger, 2 life', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Vizier'], hand: ['Test Cycler'] } });
    const start = lifeOf(s0, 'p1');
    const cyc = legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Cycler', 'hand'));
    expect(cyc).toBeDefined();
    let s = act(s0, cyc!.action);
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the stack resolved', 10);
    expect(lifeOf(s, 'p1')).toBe(start + 2);
  });
});

describe('FAST1 T4 (CR 503.1): "At the beginning of the upkeep of enchanted creature\'s controller, that player loses 3 life"', () => {
  it('the Aura of p1 on a creature of p2: p2 loses 3 life in p2\'s upkeep, p1 nothing in p1\'s', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: DEFS, p2: { battlefield: ['Grizzly Bears'] } });
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Lash')]!.attachedTo = find(s0, 'Grizzly Bears', 'battlefield', 'p2'); // test setup (CR 303.4)
    const [a, b] = [lifeOf(s0, 'p1'), lifeOf(s0, 'p2')];
    let s = advanceTo(s0, 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.turn.step !== 'upkeep', 'the trigger resolved', 10);
    expect(lifeOf(s, 'p2')).toBe(b - 3);
    expect(lifeOf(s, 'p1')).toBe(a);
  });
});

describe('FAST1 T4 (CR 602.5b): "Activate only during your upkeep"', () => {
  it('not offered in the main phase; offered in your upkeep', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Augur'] } });
    const id = find(s0, 'Test Augur', 'battlefield');
    expect(legal(s0, 'p1', 'activate').some((a) => a.object === id)).toBe(false);
    const s = advanceTo(s0, 3, 'upkeep');
    expect(s.turn.activePlayer).toBe('p1');
    expect(legal(s, 'p1', 'activate').some((a) => a.object === id)).toBe(true);
  });
});
