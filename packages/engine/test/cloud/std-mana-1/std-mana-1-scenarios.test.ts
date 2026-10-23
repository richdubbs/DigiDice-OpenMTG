/**
 * Lane std-mana, round std-mana-1: the round's engine concepts played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 106.6, 601.2h, 611.2c, 400.7a   "Add {R}. If that mana is spent on an Elemental creature spell, it gains haste until end of turn.": the rider rides on the
 *                                      mana (ManaUnit.rider), applies as the spell's costs are paid when the spell matches, and the spell carries the keyword
 *                                      onto the battlefield until end of turn; another spell, or the same spell paid with other mana, gets nothing
 *   CR 106.6, 101.2                    "If that mana is spent on an instant spell, that spell can't be countered.": the flag the counter op reads
 *   CR 106.12, 605.1b, 605.4a, 106.3   "Whenever you tap an artifact token you control for mana, add one mana of any type that artifact token produced.": a
 *                                      triggered mana ability that triggers when a mana ability WITH {T} in its cost of an artifact token is activated (the
 *                                      `tapped` of the activation), resolves at once and adds a type the token produced; a nontoken artifact, or a token's
 *                                      mana ability without {T} ("Sacrifice this token: Add ..."), does not trigger it
 *   CR 611.2b, 205.3i, 305.7, 613.1d-f "For as long as that land has a rust counter on it, it loses all land types and abilities and has "{T}: Add {B}."": the
 *                                      target land (the duration's object and the subject, one target) has no land type and only the granted ability while the
 *                                      counter stays; the effect ends for good when the counter is gone
 *   CR 106.12, 605.1b                  "Whenever you tap a land for {C}, add an additional {C}.": only an activation that produced {C}
 *   CR 106.12, 614.1a, 305.6           "If you tap a basic land for mana, it produces three times as much of that mana instead.": a basic land of yours tapped
 *                                      for mana adds three units for each one; a nonbasic land, or an opponent's basic land, is unaffected; two such effects
 *                                      multiply (each replaces the event the other made)
 *   CR 601.2b, 118.3, 106.4, 608.2h    "{T}, Sacrifice one or more artifacts: Choose a color. Target player adds two mana of the chosen color for each artifact
 *                                      sacrificed this way.": the number sacrificed is announced (at least one), and the target player adds that many times two
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Cast `name` from p1's hand paying automatically, then pass until the stack is empty. */
function castAndResolve(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
/** Activate the (one) mana ability `source` has now, printed, intrinsic (CR 305.6) or granted (its key from the legal actions). */
function tapForMana(s: GameState, source: ObjectId): GameState {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === source);
  if (!a) throw new Error(`no mana ability of ${source}`);
  return act(s, a.action);
}

describe('CR 106.6, 611.2c, 400.7a: "If that mana is spent on an Elemental creature spell, it gains haste until end of turn" (ManaSpentRider)', () => {
  const ORB = card('Test Cinder Lens', 'Artifact', '{T}: Add {R}. If that mana is spent on an Elemental creature spell, it gains haste until end of turn.');
  const IMP = card('Test Spark Imp', 'Creature — Elemental', '', ['1', '1'], '{R}');
  const OGRE = card('Test Ash Ogre', 'Creature — Ogre', '', ['2', '2'], '{R}');
  const ROCK = card('Test Red Stone', 'Artifact', '{T}: Add {R}.');
  const DEFS = [ORB, IMP, OGRE, ROCK];
  const setup = (hand: string[], battlefield: string[]): GameState => scenario([], { p1: { hand, battlefield }, defs: DEFS });
  it('is parsed and automated, the rider on the addMana step', () => {
    expect(automated(ORB)).toBe(true);
    expect(JSON.stringify(ORB.faces[0]!.abilities)).toContain('"rider":{"spells":{"types":["Creature"],"subtypes":["Elemental"]},"gains":{"kind":"keyword","keyword":"haste","text":"haste"}}');
  });
  it('an Elemental creature spell paid with that mana enters with haste, which ends with the turn', () => {
    let s = setup(['Test Spark Imp'], ['Test Cinder Lens']);
    s = tapForMana(s, find(s, 'Test Cinder Lens', 'battlefield', 'p1'));
    expect(s.players[0]!.manaPool[0]!.rider?.gains?.keyword).toBe('haste');
    s = castAndResolve(s, 'Test Spark Imp');
    const imp = find(s, 'Test Spark Imp', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, imp)!, 'haste')).toBe(true);
    expect(s.continuousEffects.some((e) => e.duration.d === 'endOfTurn')).toBe(true);
  });
  it('a creature spell of another type paid with that mana gets nothing (the mana still pays for it: the rider is no restriction)', () => {
    let s = setup(['Test Ash Ogre'], ['Test Cinder Lens']);
    s = tapForMana(s, find(s, 'Test Cinder Lens', 'battlefield', 'p1'));
    s = castAndResolve(s, 'Test Ash Ogre');
    expect(hasKeyword(getChars(s, find(s, 'Test Ash Ogre', 'battlefield', 'p1'))!, 'haste')).toBe(false);
    expect(s.players[0]!.manaPool.length).toBe(0);
  });
  it('the same Elemental paid with mana from another source does not gain haste', () => {
    let s = setup(['Test Spark Imp'], ['Test Red Stone', 'Test Cinder Lens']);
    s = tapForMana(s, find(s, 'Test Red Stone', 'battlefield', 'p1'));
    s = castAndResolve(s, 'Test Spark Imp');
    expect(hasKeyword(getChars(s, find(s, 'Test Spark Imp', 'battlefield', 'p1'))!, 'haste')).toBe(false);
  });
});

describe('CR 106.6, 101.2: "If that mana is spent on an instant spell, that spell can\'t be countered"', () => {
  const VAULT = card('Test Quiet Vault', 'Land', '{T}: Add {C}. If that mana is spent on an instant spell, that spell can\'t be countered.');
  const ZAP = card('Test Little Zap', 'Instant', 'You gain 1 life.', undefined, '{1}');
  it('is parsed and automated; the instant paid with that mana carries the flag', () => {
    expect(automated(VAULT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Little Zap'], battlefield: ['Test Quiet Vault'] }, defs: [VAULT, ZAP] });
    s = tapForMana(s, find(s, 'Test Quiet Vault', 'battlefield', 'p1'));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Little Zap', 'hand', 'p1') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[s.zones.stack[0]!]!.stack!.flags).toContain('cantBeCountered');
  });
});

describe('CR 106.12, 605.1b, 106.3: "Whenever you tap an artifact token you control for mana, add one mana of any type that artifact token produced"', () => {
  const MUSE = card('Test Ember Muse', 'Creature — Cat Druid', 'Whenever you tap an artifact token you control for mana, add one mana of any type that artifact token produced.', ['2', '2']);
  const SHARD = card('Test Glass Shard', 'Artifact', '{T}: Add {U}.');
  const DUST = card('Test Mote of Dust', 'Artifact', 'Sacrifice this artifact: Add {B}.');
  const DEFS = [MUSE, SHARD, DUST];
  const setup = (token: boolean, name = 'Test Glass Shard'): { s: GameState; id: ObjectId } => {
    const s = scenario([], { p1: { battlefield: ['Test Ember Muse', name] }, defs: DEFS });
    const id = find(s, name, 'battlefield', 'p1');
    if (token) s.objects[id]!.kind = 'token';
    return { s, id };
  };
  const poolOf = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');
  it('is parsed and automated: the trigger asks for the {T} of the activation', () => {
    expect(automated(MUSE)).toBe(true);
    expect(JSON.stringify(MUSE.faces[0]!.abilities)).toContain('"ev":"activate"');
    expect(JSON.stringify(MUSE.faces[0]!.abilities)).toContain('"tapped":true');
    expect(JSON.stringify(MUSE.faces[0]!.abilities)).toContain('"noun":"artifact token"');
  });
  it('tapping an artifact token for {U} adds another {U} at once (a triggered mana ability, CR 605.4a)', () => {
    const { s: s0, id } = setup(true);
    const s = tapForMana(s0, id);
    expect(poolOf(s)).toBe('UU');
    expect(s.zones.stack.length).toBe(0);
  });
  it('a nontoken artifact tapped for mana does not trigger it', () => {
    const { s: s0, id } = setup(false);
    expect(poolOf(tapForMana(s0, id))).toBe('U');
  });
  it('a token\'s mana ability without {T} in its cost is not tapping it for mana (CR 106.12)', () => {
    const { s: s0, id } = setup(true, 'Test Mote of Dust');
    expect(poolOf(tapForMana(s0, id))).toBe('B');
  });
});

describe('CR 611.2b, 205.3i, 305.7: "For as long as that land has a rust counter on it, it loses all land types and abilities and has "{T}: Add {B}.""', () => {
  const ROD = card('Test Rust Wand', 'Artifact', '{T}: Put a rust counter on target land. For as long as that land has a rust counter on it, it loses all land types and abilities and has "{T}: Add {B}."');
  const GROVE = card('Test Grove', 'Land — Forest', '');
  const DEFS = [ROD, GROVE];
  const setup = (): { s: GameState; rod: ObjectId; grove: ObjectId } => {
    const s = scenario([], { p1: { battlefield: ['Test Rust Wand', 'Test Grove'] }, defs: DEFS });
    return { s, rod: find(s, 'Test Rust Wand', 'battlefield', 'p1'), grove: find(s, 'Test Grove', 'battlefield', 'p1') };
  };
  const activateOn = (s0: GameState, rod: ObjectId, target: ObjectId): GameState => {
    let s = act(s0, { type: 'activate', player: 'p1', source: rod, ability: 'p:0:0' });
    for (let guard = 0; guard < 20 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('is parsed and automated: one target is the duration\'s object and the affected object', () => {
    expect(automated(ROD)).toBe(true);
    const json = JSON.stringify(ROD.faces[0]!.abilities);
    expect(json).toContain('"duration":{"d":"whileObject","object":{"ref":"target","id":"t0"},"as":"counter","counter":"rust"}');
    expect(json).toContain('"affects":{"ref":"target","id":"t0"},"mods":[{"layer":4,"subtypes":{"removeAll":"land"}},{"layer":6,"removeAll":true}');
  });
  it('while the counter stays the land has no land type and taps for {B} only (CR 305.7: the Forest\'s own ability is gone)', () => {
    let { s, rod, grove } = setup();
    expect(getChars(s, grove)!.subtypes).toContain('Forest');
    s = activateOn(s, rod, grove);
    expect(s.objects[grove]!.counters['rust']).toBe(1);
    const c = getChars(s, grove)!;
    expect(c.subtypes).toEqual([]);
    expect(c.types).toContain('Land');
    expect(c.abilities.map((a) => a.def.kind === 'activated' ? a.def.text : a.def.kind)).toEqual(['{T}: Add {B}.']);
    s = tapForMana(s, grove);
    expect(s.players[0]!.manaPool.map((u) => u.type)).toEqual(['B']);
  });
  it('the effect ends for good when the counter is gone (CR 611.2b)', () => {
    let { s, rod, grove } = setup();
    s = activateOn(s, rod, grove);
    s.objects[grove]!.counters = {};
    expect(getChars(s, grove)!.subtypes).toContain('Forest'); // judged live (statics/live.ts)
    s = pass(s); // the record ends (core/durations.ts#endDurations)
    expect(s.continuousEffects.length).toBe(0);
    s.objects[grove]!.counters = { rust: 1 };
    expect(getChars(s, grove)!.subtypes).toContain('Forest');
  });
});

describe('CR 106.12, 605.1b: "Whenever you tap a land for {C}, add an additional {C}" (`produced`)', () => {
  const DRUM = card('Test Hollow Drum', 'Enchantment', 'Whenever you tap a land for {C}, add an additional {C}.');
  const FLAT = card('Test Grey Flat', 'Land', '{T}: Add {C}.');
  const GROVE = card('Test Grove', 'Land — Forest', '');
  const DEFS = [DRUM, FLAT, GROVE];
  it('is parsed and automated', () => {
    expect(automated(DRUM)).toBe(true);
    expect(JSON.stringify(DRUM.faces[0]!.abilities)).toContain('"ev":"activate","player":"you","source":{"types":["Land"]},"manaAbility":true,"produced":"C"');
  });
  it('a land tapped for {C} makes {C}{C}; a land tapped for {G} makes {G} only', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hollow Drum', 'Test Grey Flat', 'Test Grove'] }, defs: DEFS });
    const s1 = tapForMana(s0, find(s0, 'Test Grey Flat', 'battlefield', 'p1'));
    expect(s1.players[0]!.manaPool.map((u) => u.type).join('')).toBe('CC');
    const s2 = tapForMana(s0, find(s0, 'Test Grove', 'battlefield', 'p1'));
    expect(s2.players[0]!.manaPool.map((u) => u.type).join('')).toBe('G');
  });
});

describe('CR 106.12, 614.1a: "If you tap a basic land for mana, it produces three times as much of that mana instead" (rule tapManaMultiplier)', () => {
  const IDOL = card('Test Harvest Idol', 'Enchantment', 'If you tap a basic land for mana, it produces three times as much of that mana instead.');
  const WOODS = card('Test Basic Woods', 'Basic Land — Forest', '');
  const FIELD = card('Test Odd Field', 'Land', '{T}: Add {G}.');
  const DEFS = [IDOL, WOODS, FIELD];
  const poolOf = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).join('');
  it('is parsed and automated', () => {
    expect(automated(IDOL)).toBe(true);
    const rule = (IDOL.faces[0]!.abilities[0] as { effects: { rule: string; of: { types: string[]; supertypes: string[] }; value: number }[] }).effects[0]!;
    expect(rule.rule).toBe('tapManaMultiplier');
    expect(rule.of.types).toEqual(['Land']);
    expect(rule.of.supertypes).toEqual(['Basic']);
    expect(rule.value).toBe(3);
  });
  it('a basic land of yours makes {G}{G}{G}; a nonbasic land makes {G}', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Harvest Idol', 'Test Basic Woods', 'Test Odd Field'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Basic Woods', 'battlefield', 'p1')))).toBe('GGG');
    expect(poolOf(tapForMana(s0, find(s0, 'Test Odd Field', 'battlefield', 'p1')))).toBe('G');
  });
  it('two of them multiply: nine mana', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Harvest Idol', 'Test Harvest Idol', 'Test Basic Woods'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Basic Woods', 'battlefield', 'p1')))).toBe('GGGGGGGGG');
  });
  it('an opponent tapping their basic land gets one mana', () => {
    let s = scenario([], { p1: { battlefield: ['Test Harvest Idol'] }, p2: { battlefield: ['Test Basic Woods'] }, defs: DEFS });
    s = pass(s); // p2 gets priority in p1's main phase
    const woods = find(s, 'Test Basic Woods', 'battlefield', 'p2');
    const a = legalActions(s, 'p2').find((x) => x.kind === 'activate' && x.isMana === true && x.object === woods)!;
    expect(poolOf(act(s, a.action), 1)).toBe('G');
  });
});

describe('CR 601.2b, 118.3: "{T}, Sacrifice one or more artifacts: Choose a color. Target player adds two mana of the chosen color for each artifact sacrificed this way."', () => {
  const BLOOM = card('Test Glass Bloom', 'Artifact', '{T}, Sacrifice one or more artifacts: Choose a color. Target player adds two mana of the chosen color for each artifact sacrificed this way.');
  const COG = card('Test Brass Cog', 'Artifact', '');
  const DEFS = [BLOOM, COG];
  /** Activate the Bloom: announce `n` artifacts, sacrifice the Cogs first, target `who`, choose red; then resolve. */
  const mins: number[] = [];
  function run(s0: GameState, n: number, who: 'p1' | 'p2'): GameState {
    const cogs = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Brass Cog');
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Glass Bloom', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
      const d = s.pending as unknown as { kind: string; [k: string]: unknown };
      if (d.kind === 'chooseNumber') { mins.push(d['min'] as number); s = answer(s, { kind: 'chooseNumber', n }); }
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: who }] });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: cogs.slice(0, d['min'] as number) } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'R' } as never);
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  }
  it('is parsed and automated: an announced count of at least one, read back as the artifacts sacrificed for the cost', () => {
    expect(automated(BLOOM)).toBe(true);
    const json = JSON.stringify(BLOOM.faces[0]!.abilities);
    expect(json).toContain('{"kind":"sacrifice","filter":{"types":["Artifact"]},"count":"any","atLeast":1}');
    expect(json).toContain('"count":{"q":"math","op":"*","args":[2,{"q":"count","of":{"ref":"costSacrificed"}}]}');
  });
  it('two artifacts sacrificed: the target player adds four red mana', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Glass Bloom', 'Test Brass Cog', 'Test Brass Cog'] }, defs: DEFS });
    const s = run(s0, 2, 'p2');
    expect(s.players[1]!.manaPool.map((u) => u.type).join('')).toBe('RRRR');
    expect(s.players[0]!.manaPool.length).toBe(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Brass Cog').length).toBe(0);
  });
  it('one artifact sacrificed: two red mana; the count can\'t be zero', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Glass Bloom', 'Test Brass Cog'] }, defs: DEFS });
    mins.length = 0;
    const s = run(s0, 1, 'p1');
    expect(s.players[0]!.manaPool.map((u) => u.type).join('')).toBe('RR');
    expect(mins).toEqual([1]); // announced as at least one (both artifacts on the battlefield could be sacrificed: max 2)
  });
});

describe('CR 106.12, 605.1b: "Whenever you tap a creature for mana, add an additional {G}" (the activation\'s {T}; FAST1 T4 pinned it manual before)', () => {
  const GROVE = card('Test Moss Shrine', 'Enchantment', 'Whenever you tap a creature for mana, add an additional {G}.');
  const ELF = card('Test Twig Caller', 'Creature — Elf Druid', '{T}: Add {G}.', ['1', '1']);
  const IMP = card('Test Ember Sprite', 'Creature — Elemental', 'Sacrifice this creature: Add {R}.', ['1', '1']);
  const DEFS = [GROVE, ELF, IMP];
  const poolOf = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');
  it('a creature tapped for mana ({T} in the cost) adds the extra {G}; a creature sacrificed for mana (no {T}) does not', () => {
    expect(automated(GROVE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Moss Shrine', 'Test Twig Caller', 'Test Ember Sprite'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Twig Caller', 'battlefield', 'p1')))).toBe('GG');
    expect(poolOf(tapForMana(s0, find(s0, 'Test Ember Sprite', 'battlefield', 'p1')))).toBe('R');
  });
});
