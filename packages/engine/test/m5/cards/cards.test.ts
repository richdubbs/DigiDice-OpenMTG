/**
 * WP13 acceptance: the section 13 cards that use the card, library and mana ops (design 15.2: Jace Beleren, Fact or Fiction, Think Twice, Llanowar Elves,
 * Cavern of Souls; and, design 15.1.4, every other section 13 card with a WP13 op: Paradise Plume, Mana Vault, Glacial Fortress, Mutavault, Path to Exile,
 * Jace, the Mind Sculptor), plus cycling, which WP13's `draw` turns on. Their abilities are the JSON of the design (test/m5/model/examples.ts reads it from the document), put on the real fixture cards where
 * the fixture has them. Casting and activation are the real ones (WP7); the resolution runs the real handlers through the harness standing in for WP10.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AbilityDef, CardDef, GameState } from '../../../src/index';
import { compileCard, legalActions } from '../../../src/index';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { findAbility } from '../../../src/rules/abilities';
import { compiledDef } from '../../fixtures';
import { drive } from '../announce/support';
import { act, answer, castAuto, find, keyword, scenario, synth } from '../helpers';
import { EXAMPLES } from '../model/examples';
import { performed, replacements } from './fakes';
import { hand, lib, names, onStack, runAll, runOn, stackProgram, top, yard } from './harness';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));

afterEach(() => {
  replacements.length = 0;
  performed.length = 0;
});

const abilitiesOf = (name: string): AbilityDef[] => {
  const ex = EXAMPLES.find((e) => e.name === name);
  if (!ex) throw new Error(`no worked example ${name}`);
  return ex.faces[0]!.abilities;
};
/** The fixture card with the abilities of its section 13 example (what the milestone 5 compiler will produce). */
const designed = (name: string): CardDef => compiledDef(name, () => ({ abilities: abilitiesOf(name), unsupported: [] }));
const pool = (s: GameState, p = 'p1') => s.players.find((x) => x.id === p)!.manaPool;
const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label === `Cast ${name}`);
const missing2 = (name: string, i: number): string[] => missingCapabilities(abilitiesOf(name)[i]!, ENGINE_CAPABILITIES);

describe('section 13 cards: what this build can run (capabilities, design 5.2)', () => {
  const missing = (name: string, i: number): string[] => missingCapabilities(abilitiesOf(name)[i]!, ENGINE_CAPABILITIES);

  it('design 5.2: Think Twice, Jace Beleren and Llanowar Elves need nothing this build lacks for their draw, mill and mana abilities', () => {
    expect(missing('Think Twice', 0)).toEqual([]);
    expect([0, 1, 2].map((i) => missing('Jace Beleren', i))).toEqual([[], [], []]);
    expect(missing('Llanowar Elves', 0)).toEqual([]);
  });

  it('design 5.2: Fact or Fiction needs nothing since WP14 merged `move`; Cavern of Souls\'s restricted mana needs nothing since std-lci registered the "can\'t be countered" rider', () => {
    expect(missing('Fact or Fiction', 0)).toEqual([]);
    expect(missing('Cavern of Souls', 1)).toEqual([]);
    expect(missing('Cavern of Souls', 2)).toEqual([]); // std-lci: actions/cast.ts flags the spell and the counter op honors it (CR 106.6, 101.2)
    const plain: AbilityDef = { kind: 'activated', text: '{T}: Add {G}. Spend this mana only to cast creature spells.', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['G']], restriction: { spells: { types: ['Creature'] } } }] } };
    expect(missingCapabilities(plain, ENGINE_CAPABILITIES)).toEqual([]);
    expect(ENGINE_CAPABILITIES.has('feature:mana.restriction')).toBe(true);
  });

  it('design 5.2: every op of the family is a capability (handler and renderer, design 5.2)', () => {
    for (const op of ['draw', 'discard', 'mill', 'scry', 'surveil', 'reveal', 'look', 'search', 'shuffle', 'piles', 'addMana']) expect(ENGINE_CAPABILITIES.has(`op:${op}`), op).toBe(true);
  });
});

describe('Jace Beleren (CR 606, 121, 701.17)', () => {
  const jace = designed('Jace Beleren');
  const board = (loyalty: number): GameState => scenario(['Island'], {
    p1: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty } }], library: ['Island'] }, p2: { library: ['Island'] }, defs: [jace],
  });
  const activate = (s: GameState, i: number): GameState => act(s, { type: 'activate', player: 'p1', source: find(s, 'Jace Beleren', 'battlefield'), ability: `p:0:${i}` });

  it('CR 606.4, 121.2c: +2: each player draws a card (APNAP), after the loyalty cost is paid', () => {
    const s = activate(board(3), 0);
    expect(s.objects[find(s, 'Jace Beleren', 'battlefield')]!.counters['loyalty']).toBe(5);
    const out = runOn(s, top(s), stackProgram(s, top(s)));
    expect(out.events.filter((e) => e.type === 'drew').map((e) => (e.type === 'drew' ? e.player : ''))).toEqual(['p1', 'p2']);
    expect(hand(out.s, 'p2')).toHaveLength(1);
  });

  it('CR 121.1: -1: target player draws a card', () => {
    let s = activate(board(3), 1);
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    const out = runOn(s, top(s), stackProgram(s, top(s)));
    expect(hand(out.s, 'p2')).toHaveLength(1);
    expect(hand(out.s, 'p1')).toHaveLength(0);
  });

  it('CR 701.17a, 608.2b: -10: target player mills twenty cards; a target that left the game mills nothing', () => {
    let s = activate(board(10), 2);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    const before = lib(s, 'p2').length;
    const out = runOn(s, top(s), stackProgram(s, top(s)));
    expect(yard(out.s, 'p2')).toHaveLength(20);
    expect(lib(out.s, 'p2')).toHaveLength(before - 20);
    const gone = structuredClone(s);
    gone.players[1]!.hasLost = true;
    expect(yard(runOn(gone, top(gone), stackProgram(gone, top(gone))).s, 'p2')).toHaveLength(0);
  });
});

describe('Think Twice (CR 121.1, 702.34)', () => {
  const tt = designed('Think Twice');
  const board = (): GameState => scenario(['Island'], { p1: { hand: ['Think Twice'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island'], library: ['Island'] }, defs: [tt] });

  it('CR 121.1, 702.34a: cast from the hand, it draws a card; cast again with flashback from the graveyard, it draws again', () => {
    let s = castAuto(board(), 'Think Twice');
    const out = runOn(s, top(s), stackProgram(s, top(s)));
    expect(names(out.s, hand(out.s, 'p1'))).toEqual(['Island']);
    s = structuredClone(out.s);
    // what WP10's finishSpell does with the resolved instant (CR 608.2n), so flashback can be tried
    const spell = top(s);
    s.zones.stack = s.zones.stack.filter((x) => x !== spell);
    s.objects[spell]!.zone = 'graveyard';
    delete s.objects[spell]!.stack;
    s.zones.graveyard.p1!.push(spell);
    expect(castable(s, 'Think Twice with flashback')).toBe(true);
    s = castAuto(s, 'Think Twice', { method: 'flashback' });
    const again = runOn(s, top(s), stackProgram(s, top(s)));
    expect(hand(again.s, 'p1')).toHaveLength(2);
  });
});

describe('Fact or Fiction (CR 701.20, 608.2d)', () => {
  const fof = synth({ name: 'Fact or Fiction', cost: '{3}{U}', type: 'Instant', abilities: abilitiesOf('Fact or Fiction') });
  const s0 = scenario(['Island', 'Forest', 'Mountain', 'Swamp', 'Plains'], { p1: { library: ['Island', 'Forest', 'Mountain', 'Swamp', 'Plains'] }, defs: [fof] });

  it('CR 701.20a, 608.2d: reveals the top five, the opponent separates, the caster keeps a pile in hand and the other goes to the graveyard', () => {
    const { s, id } = onStack(s0, { name: 'Fact or Fiction' });
    const program = abilitiesOf('Fact or Fiction')[0]!;
    if (program.kind !== 'spell') throw new Error('spell expected');
    const [island, forest] = lib(s, 'p1');
    const out = runAll(s, id, program.effect, (d) => {
      if (d.kind === 'chooseObjects') { expect(d.player).toBe('p2'); return { kind: 'chooseObjects', ids: [island!, forest!] }; }
      if (d.kind === 'chooseOption') { expect(d.player).toBe('p1'); return { kind: 'chooseOption', ids: ['pile2'] }; }
      throw new Error(`unexpected ${d.kind}`);
    });
    expect(names(out.s, hand(out.s, 'p1')).sort()).toEqual(['Mountain', 'Plains', 'Swamp']);
    expect(names(out.s, yard(out.s, 'p1')).sort()).toEqual(['Forest', 'Island']);
    expect(out.s.log.some((l) => l.text === 'Alice reveals Island, Forest, Mountain, Swamp, Plains.')).toBe(true);
  });
});

describe('Llanowar Elves (CR 605.3b, 106.4)', () => {
  const elves = designed('Llanowar Elves');

  it('CR 605.1a: the milestone 3 compiler already produces the design\'s JSON for its mana ability', () => {
    const m3 = compiledDef('Llanowar Elves').faces[0]!.abilities[0]!;
    const want = abilitiesOf('Llanowar Elves')[0]!;
    expect(m3).toMatchObject({ kind: want.kind, cost: (want as { cost: unknown }).cost, isMana: true, effect: (want as { effect: unknown }).effect });
  });

  it('CR 605.3b, 106.4: activated (no stack), the addMana handler adds {G} from the Elves, and the activation path of milestone 3 adds the same', () => {
    const s = scenario([], { p1: { battlefield: ['Llanowar Elves'] }, defs: [elves] });
    const id = find(s, 'Llanowar Elves', 'battlefield');
    const ab = abilitiesOf('Llanowar Elves')[0]!;
    if (ab.kind !== 'activated') throw new Error('activated expected');
    expect(pool(runOn(s, id, ab.effect).s)).toEqual([{ type: 'G', sourceId: id, sourceSubtypes: ['Elf', 'Druid'] }]); // FAST5X E19 (CR 106.3)
    expect(pool(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }))).toEqual([{ type: 'G', sourceId: id, sourceSubtypes: ['Elf', 'Druid'] }]);
  });
});

describe('Cavern of Souls (CR 106.6, 607.2d)', () => {
  const cavern = synth({ name: 'Cavern of Souls', type: 'Land', abilities: abilitiesOf('Cavern of Souls') });
  const bear = synth({ name: 'Test Bear', cost: '{G}', type: 'Creature — Bear', pt: ['2', '2'], abilities: [] });
  const board = (chosen: string | null): GameState => {
    const s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Cavern of Souls'], hand: ['Llanowar Elves', 'Test Bear'] }, defs: [cavern, bear] });
    // the choice "As this land enters, choose a creature type" (WP11's enters replacement) as it is stored: the land's link store (CR 607.2d)
    if (chosen) s.objects[find(s, 'Cavern of Souls', 'battlefield')]!.links = { type: { values: [chosen] } };
    return s;
  };

  it('CR 106.6, 607.2d: its restricted mana pays only for a creature spell of the chosen type, and that spell carries "can\'t be countered"', () => {
    const s = board('Elf');
    expect(castable(s, 'Llanowar Elves')).toBe(true);
    expect(castable(s, 'Test Bear')).toBe(false);
    const cast = castAuto(s, 'Llanowar Elves');
    expect(cast.objects[top(cast)]!.stack!.flags).toContain('cantBeCountered');
  });

  it('CR 607.5a: with no type chosen, the colored mana can be spent on nothing', () => {
    expect(castable(board(null), 'Llanowar Elves')).toBe(false);
  });

  it('CR 106.3, 106.6: the addMana handler leaves the same restricted unit in the pool, spendable only on the chosen type', () => {
    const s = board('Elf');
    const id = find(s, 'Cavern of Souls', 'battlefield');
    const ab = abilitiesOf('Cavern of Souls')[2]!;
    if (ab.kind !== 'activated') throw new Error('activated expected');
    const out = runOn(s, id, ab.effect, [{ kind: 'chooseColor', color: 'G' }]);
    expect(pool(out.s)).toEqual([{ type: 'G', sourceId: id, restriction: (ab.effect.steps[0] as { restriction: unknown }).restriction }]);
    const t = structuredClone(out.s);
    t.objects[id]!.tapped = true; // only the floating mana is left to pay with
    expect(castable(t, 'Test Bear')).toBe(false);
    expect(castable(t, 'Llanowar Elves')).toBe(true);
    const cast = castAuto(t, 'Llanowar Elves');
    expect(pool(cast)).toEqual([]);
    expect(cast.objects[top(cast)]!.stack!.flags).toContain('cantBeCountered');
  });
});

/** The program of one ability of a section 13 example. */
const effectOf = (name: string, i: number) => {
  const a = abilitiesOf(name)[i]!;
  if (a.kind !== 'activated' && a.kind !== 'spell') throw new Error(`${name} [${i}] has no effect`);
  return a.effect;
};

describe('Paradise Plume (CR 607.2d, 607.5a, 106.4)', () => {
  const plume = synth({ name: 'Paradise Plume', cost: '{4}', type: 'Artifact', abilities: abilitiesOf('Paradise Plume') });
  const board = (color: string | null): GameState => {
    const s = scenario([], { p1: { battlefield: ['Paradise Plume'] }, defs: [plume] });
    // "As this enters, choose a color" (WP11's enters replacement) stores the choice in the artifact's link store (CR 607.2d)
    if (color) s.objects[find(s, 'Paradise Plume', 'battlefield')]!.links = { color: { values: [color] } };
    return s;
  };

  it('design 5.2, CR 605.3b: its mana ability needs nothing this build lacks: the native activation path runs the `dynamic` "chosen color" (WP31 resolver)', () => {
    // WP20 INTERFACE CHANGE (model/cap-walk.ts) kept it manual while activating it through `applyAction` tapped the Plume for nothing; since WP31
    // rules/mana.ts resolves it through the interpreter's handler (wp31-spine.test.ts), so FAST2 T7 lets it be automated.
    expect(missingCapabilities(abilitiesOf('Paradise Plume')[2]!, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('CR 607.2d, 106.4: "{T}: Add one mana of the chosen color" adds the color its enters ability chose, with the Plume as the source (CR 106.3)', () => {
    const s = board('blue');
    const id = find(s, 'Paradise Plume', 'battlefield');
    expect(pool(runOn(s, id, effectOf('Paradise Plume', 2)).s)).toEqual([{ type: 'U', sourceId: id }]);
  });

  it('CR 607.5a: with no color chosen, the linked ability adds nothing', () => {
    const s = board(null);
    const out = runOn(s, find(s, 'Paradise Plume', 'battlefield'), effectOf('Paradise Plume', 2));
    expect(pool(out.s)).toEqual([]);
    expect(out.events).toEqual([]);
  });
});

describe('Mana Vault, Glacial Fortress, Mutavault: their mana abilities (CR 605.3b, 106.1b, 106.4)', () => {
  const vault = synth({ name: 'Mana Vault', cost: '{1}', type: 'Artifact', abilities: abilitiesOf('Mana Vault') });
  const fortress = synth({ name: 'Glacial Fortress', type: 'Land', abilities: abilitiesOf('Glacial Fortress') });
  const muta = synth({ name: 'Mutavault', type: 'Land', abilities: abilitiesOf('Mutavault') });
  const s0 = scenario([], { p1: { battlefield: ['Mana Vault', 'Glacial Fortress', 'Mutavault'] }, defs: [vault, fortress, muta] });

  it('design 5.2: none of the three mana abilities needs anything this build lacks', () => {
    expect([missing2('Mana Vault', 3), missing2('Glacial Fortress', 1), missing2('Mutavault', 0)]).toEqual([[], [], []]);
  });

  it('CR 106.4: Mana Vault adds {C}{C}{C}, as the milestone 3 activation path does', () => {
    const id = find(s0, 'Mana Vault', 'battlefield');
    const viaHandler = pool(runOn(s0, id, effectOf('Mana Vault', 3)).s);
    expect(viaHandler).toEqual([{ type: 'C', sourceId: id }, { type: 'C', sourceId: id }, { type: 'C', sourceId: id }]);
    expect(pool(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:3' }))).toEqual(viaHandler);
  });

  it('CR 106.1b: Glacial Fortress asks for {W} or {U} and adds the one chosen', () => {
    const id = find(s0, 'Glacial Fortress', 'battlefield');
    const first = runOn(s0, id, effectOf('Glacial Fortress', 1));
    expect(first.pending).toMatchObject({ kind: 'chooseColor', player: 'p1', options: ['W', 'U'] });
    expect(pool(runOn(s0, id, effectOf('Glacial Fortress', 1), [{ kind: 'chooseColor', color: 'U' }]).s)).toEqual([{ type: 'U', sourceId: id }]);
  });

  it('CR 106.4: Mutavault adds {C}, as the milestone 3 activation path does', () => {
    const id = find(s0, 'Mutavault', 'battlefield');
    expect(pool(runOn(s0, id, effectOf('Mutavault', 0)).s)).toEqual([{ type: 'C', sourceId: id }]);
    expect(pool(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }))).toEqual([{ type: 'C', sourceId: id }]);
  });
});

describe('Path to Exile: the search and shuffle part (CR 701.23b, 701.24a)', () => {
  const pte = synth({ name: 'Path to Exile', cost: '{W}', type: 'Instant', abilities: abilitiesOf('Path to Exile') });
  const s0 = scenario(['Grizzly Bears', 'Plains', 'Lightning Bolt'], { p2: { battlefield: ['Grizzly Bears'], library: ['Lightning Bolt', 'Plains'] }, defs: [pte] });
  // The JSON's `may` (WP10) is answered "yes" by running its `do` steps in place; `move` is the harness's fake (WP14).
  const steps = effectOf('Path to Exile', 0).steps;
  const may = steps[1]!;
  if (may.op !== 'may') throw new Error('may expected');
  const program = { targets: effectOf('Path to Exile', 0).targets, steps: [steps[0]!, ...may.do] };

  it('CR 701.23b, 110.2: the exiled creature\'s controller searches their own library for a basic land and may find none; the land enters and the library is shuffled', () => {
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const { s, id } = onStack(s0, { name: 'Path to Exile', targets: [[{ kind: 'object', id: bears }]] });
    const first = runOn(s, id, program);
    const plains = lib(s, 'p2').find((c) => names(s, [c])[0] === 'Plains')!;
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', min: 0, max: 1 });
    expect(first.pending!.kind === 'chooseObjects' && first.pending.options.every((o) => names(s, [o])[0] === 'Plains')).toBe(true);
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [plains] }]);
    expect(out.s.zones.battlefield.map((c) => names(out.s, [c])[0])).toContain('Plains');
    expect(out.s.zones.exile.map((c) => names(out.s, [c])[0])).toEqual(['Grizzly Bears']);
    expect(out.events.filter((e) => e.type === 'shuffled')).toEqual([{ type: 'shuffled', player: 'p2' }]);
    const none = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }]);
    expect(none.events.filter((e) => e.type === 'shuffled')).toEqual([{ type: 'shuffled', player: 'p2' }]);
  });

  // CR 608.2d (WP10): the end-to-end run (the "may" asked of the exiled creature's controller, through resolveStackObject) is in wp31-spine.test.ts (WP31).
});

describe('Jace, the Mind Sculptor: +2 (CR 701.20e, 606.4)', () => {
  const jtms = synth({ name: 'Jace, the Mind Sculptor', cost: '{2}{U}{U}', type: 'Legendary Planeswalker — Jace', abilities: abilitiesOf('Jace, the Mind Sculptor') });
  const s0 = scenario(['Island', 'Swamp'], { p1: { battlefield: [{ name: 'Jace, the Mind Sculptor', counters: { loyalty: 3 } }] }, p2: { library: ['Swamp', 'Island'] }, defs: [jtms] });
  const steps = effectOf('Jace, the Mind Sculptor', 0).steps;
  const may = steps[1]!;
  if (may.op !== 'may') throw new Error('may expected');

  it('CR 701.20e: "look at the top card of target player\'s library" shows it to Jace\'s controller only; "you may put that card on the bottom" moves the looked-at card', () => {
    const jace = find(s0, 'Jace, the Mind Sculptor', 'battlefield');
    const { s, id } = onStack(s0, { name: 'Jace, the Mind Sculptor', kind: 'activated', sourceId: jace, targets: [[{ kind: 'player', id: 'p2' }]] });
    const card = lib(s, 'p2')[0]!;
    const looked = runOn(s, id, { targets: effectOf('Jace, the Mind Sculptor', 0).targets, steps: [steps[0]!] });
    expect(looked.s.objects[card]!.revealedTo).toEqual(['p1']);
    expect(looked.cx!.bindings.get('top')!.objects).toEqual([{ id: card, zone: 'library' }]);
    // the `may` (WP10) answered "yes": its `do` runs, with WP14's real `move` (the harness's fake stands in only when no handler exists)
    const out = runOn(s, id, { targets: effectOf('Jace, the Mind Sculptor', 0).targets, steps: [steps[0]!, ...may.do] });
    expect(names(out.s, lib(out.s, 'p2')).at(-1)).toBe(names(s, [card])[0]);
    expect(lib(out.s, 'p2')[0]).not.toBe(card);
  });

  // CR 606.4 (WP10, WP14): +2 activated and resolved end to end, the `may` answered both ways: wp31-spine.test.ts (WP31).
});

describe('Cycling (CR 702.29), which WP13\'s `draw` turns on', () => {
  it('CR 702.29a, design 5.2: keyword:cycling is advertised because op:draw now has a handler (a capability WP13 turns on)', () => {
    expect(ENGINE_CAPABILITIES.has('op:draw')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:cycling')).toBe(true);
  });

  it('CR 702.29a: cycling from the hand: the card is discarded as a cost (CR 701.9a), then the ability draws a card', () => {
    const cycler = synth({ name: 'Test Cycler', cost: '{3}', type: 'Creature — Beast', pt: ['3', '3'], abilities: [keyword('cycling', { mana: [{ kind: 'generic', amount: 1 }] })] });
    const s0 = scenario(['Mountain', 'Island'], { p1: { hand: ['Test Cycler'], battlefield: ['Mountain'], library: ['Island'] }, defs: [cycler] });
    const card = find(s0, 'Test Cycler', 'hand');
    const action = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === card);
    expect(action).toBeDefined();
    const s = drive(act(s0, action!.action), []);
    expect(names(s, yard(s, 'p1'))).toEqual(['Test Cycler']);
    const ability = findAbility(s0, card, (action!.action as { ability: string }).ability)!.def; // the expansion of the keyword (keywords/data/cycling.json)
    if (ability.kind !== 'activated') throw new Error('activated expected');
    const program = ability.effect;
    expect(program.steps).toEqual([{ op: 'draw', who: { ref: 'you' }, count: 1 }]);
    expect(s.zones.stack).toHaveLength(1);
    const out = runOn(s, top(s), program);
    expect(names(out.s, hand(out.s, 'p1'))).toEqual(['Island']);
  });
});

describe('determinism (design 8.8)', () => {
  it('design 8.8: a resolution with decisions re-executed from the same base and answers gives the same state', () => {
    const fof = synth({ name: 'Fact or Fiction', cost: '{3}{U}', type: 'Instant', abilities: abilitiesOf('Fact or Fiction') });
    const s0 = scenario([], { defs: [fof] });
    const { s, id } = onStack(s0, { name: 'Fact or Fiction' });
    const program = (abilitiesOf('Fact or Fiction')[0] as Extract<AbilityDef, { kind: 'spell' }>).effect;
    const answers = [{ kind: 'chooseObjects' as const, ids: [lib(s, 'p1')[0]!] }, { kind: 'chooseOption' as const, ids: ['pile1'] }];
    expect(runOn(s, id, program, answers).s).toEqual(runOn(s, id, program, answers).s);
  });

  it('design 1 (data, not code): compileCard keeps the design JSON unchanged (the handlers read it as data, never per card)', () => {
    const def = compileCard({ name: 'X', layout: 'normal', type_line: 'Sorcery', oracle_text: '(synthetic)' }, () => ({ abilities: abilitiesOf('Think Twice').slice(0, 1), unsupported: [] }));
    expect(def.faces[0]!.abilities[0]).toEqual(abilitiesOf('Think Twice')[0]);
  });
});
