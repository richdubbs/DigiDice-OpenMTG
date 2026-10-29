/**
 * WP30 (W1 follow-up e): the hot spots that made the suite about twice as slow during W1, fixed without changing behavior. Each change has a guard here:
 *  - `GameState.history` is append-only and shared between states like the log (util/clone.ts): an action copies the array, never the entries;
 *  - the starting characteristics of a face are computed once per frozen card definition (statics/layers.ts templates, rules/characteristics.ts#faceChars) and
 *    handed out as copies, so no caller can reach another's arrays (design 4.3), and an unfrozen definition is never memoized;
 *  - `readingStable` checks the characteristics cache of a layered state once per scope instead of once per object, and never changes what a read returns.
 * The soak tests (m3/soak.test.ts, m5/statics/soak.test.ts, m5/announce/soak.test.ts) are the behavior check: their tallies and replays are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getChars, type Action, type CardDef, type GameConfig, type GameState } from '../../../src/index';
import { cloneState } from '../../../src/util/clone';
import { charsOfObject, faceChars, readingStable, STABLE_READS } from '../../../src/rules/characteristics';
import { computeAll, intrinsicChars, startingChars } from '../../../src/statics/layers';
import { compiledDefs } from '../../fixtures';
import { Bot } from '../../m3/bot';
import { board, continuous, creature, each, enchantment, find, staticOf } from './fixtures';

describe('the history is shared between states like the log (it is append-only)', () => {
  it('an action copies the array and shares the entries; the earlier state keeps its own history', () => {
    const cfg: GameConfig = { seed: 'wp30-history', players: [{ name: 'A', deck: Array(40).fill('Plains') }, { name: 'B', deck: Array(40).fill('Plains') }], defs: compiledDefs(['Plains']) };
    let s0 = createGame(cfg);
    const bot = new Bot('wp30-history');
    for (let i = 0; i < 60 && s0.history.length < 3; i++) { const r = applyAction(s0, bot.next(s0)); if (!r.error) s0 = r.state; } // written when triggers are collected
    expect(s0.history.length).toBeGreaterThan(0);
    const copy = cloneState(s0);
    expect(copy.history).not.toBe(s0.history);
    expect(copy.history.every((e, i) => e === s0.history[i])).toBe(true);
    copy.history.push({ turn: 99, combat: 0, ev: 'draw', facts: {} });
    expect(s0.history.some((e) => e.turn === 99)).toBe(false);
    const before = JSON.stringify(s0.history);
    const d = s0.pending!;
    applyAction(s0, d.kind === 'priority' ? { type: 'pass', player: d.player } : { type: 'concede', player: d.player } as Action);
    expect(JSON.stringify(s0.history)).toBe(before); // the input state is never mutated (docs/ARCHITECTURE.md, principle 1)
  });
});

describe('characteristics computed once per frozen definition', () => {
  const s = (): GameState => createGame({
    seed: 'wp30-templates',
    players: [{ name: 'A', deck: [...Array(30).fill('Forest'), ...Array(10).fill('Grizzly Bears')] }, { name: 'B', deck: Array(40).fill('Forest') }],
    defs: compiledDefs(['Forest', 'Grizzly Bears']),
  });

  it('the definitions of a created game are frozen, and two calls give equal records with their own arrays', () => {
    const st = s();
    const id = st.zones.library.p1!.find((x) => st.objects[x]!.defId === 'Grizzly Bears') ?? st.zones.hand.p1!.find((x) => st.objects[x]!.defId === 'Grizzly Bears')!;
    expect(Object.isFrozen(st.defs[st.objects[id]!.defId]!)).toBe(true);
    const a = getChars(st, id);
    const b = getChars(st, id);
    expect(b).toEqual(a);
    for (const k of ['names', 'colors', 'supertypes', 'types', 'subtypes', 'abilities', 'keywords', 'cantHave'] as const) expect(b[k]).not.toBe(a[k]);
    a.types.push('Artifact');
    a.abilities.length = 0;
    expect(getChars(st, id).types).toEqual(['Creature']); // editing what a caller got never reaches the template
    expect(getChars(st, id).abilities).toEqual(b.abilities);
  });

  it('a template gives exactly what a fresh computation gives (an unfrozen copy of the same definitions is never memoized)', () => {
    const st = s();
    const fresh: GameState = { ...st, defs: Object.fromEntries(Object.entries(st.defs).map(([k, v]) => [k, structuredClone(v)])) };
    for (const id of Object.keys(st.objects)) {
      expect(JSON.stringify(intrinsicChars(st, st.objects[id]!))).toBe(JSON.stringify(intrinsicChars(fresh, fresh.objects[id]!)));
      expect(JSON.stringify(startingChars(st, st.objects[id]!))).toBe(JSON.stringify(startingChars(fresh, fresh.objects[id]!)));
    }
    // CR 305.6: the basic land type's mana ability is generated for the Forest (from the template too).
    const forest = st.zones.library.p1!.find((x) => st.objects[x]!.defId === 'Forest')!;
    expect(intrinsicChars(st, st.objects[forest]!).abilities.map((a) => a.key)).toContain('r:basic:G');
  });

  it('an unfrozen definition edited in place is seen at once (only frozen definitions are memoized)', () => {
    const st = structuredClone(s()); // structuredClone un-freezes (util/clone.ts#clone no longer does: F17/F9)
    const id = Object.keys(st.objects).find((x) => st.objects[x]!.defId === 'Grizzly Bears')!;
    expect(charsOfObject(st, st.objects[id]!).subtypes).toEqual(['Bear']);
    st.defs['Grizzly Bears']!.faces[0]!.subtypes.push('Elf');
    expect(charsOfObject(st, st.objects[id]!).subtypes).toEqual(['Bear', 'Elf']);
  });

  it('faceChars of a frozen definition is a copy each time', () => {
    const st = s();
    const def = st.defs['Grizzly Bears']!;
    const a = faceChars(def, 0);
    a.types.length = 0;
    expect(faceChars(def, 0).types).toEqual(['Creature']);
  });
});

describe('readingStable: one cache check per scope', () => {
  const ANTHEM = enchantment('Test Anthem', '{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
  const BEAR = creature('Test Bear', '2', '2', [], { cost: '{W}' });

  it('a scope answers what the per-call path answers, nests, and ends with the call', () => {
    const st = board([ANTHEM, BEAR], ['Test Anthem', 'Test Bear', 'Test Bear'], ['Test Bear']);
    const ids = Object.keys(st.objects);
    const plain = ids.map((id) => JSON.stringify(getChars(st, id)));
    const scoped = readingStable(st, () => ids.map((id) => JSON.stringify(readingStable(st, () => getChars(st, id)))));
    expect(scoped).toEqual(plain);
    expect(getChars(st, find(st, 'Test Bear', 'battlefield')).power).toBe('3');
    const fresh = computeAll(st);
    for (const id of ids) expect(JSON.stringify(getChars(st, id))).toBe(JSON.stringify(fresh.get(id)));
  });

  it('outside a scope a change is seen at once; a scope that changed its state is a bug the verify mode reports', () => {
    const st = board([ANTHEM, BEAR], ['Test Anthem', 'Test Bear']);
    const bear = find(st, 'Test Bear', 'battlefield');
    expect(getChars(st, bear).power).toBe('3');
    const anthem = find(st, 'Test Anthem', 'battlefield');
    st.objects[anthem]!.zone = 'exile'; // a change made by hand, between calls
    st.zones.battlefield = st.zones.battlefield.filter((x) => x !== anthem);
    st.zones.exile.push(anthem);
    expect(getChars(st, bear).power).toBe('2');
    STABLE_READS.verify = true;
    try {
      expect(() => readingStable(st, () => { st.objects[bear]!.counters['+1/+1'] = 1; })).toThrow(/promised to hold still/);
    } finally {
      STABLE_READS.verify = false;
    }
  });

  it('every scope the engine opens holds its state still: random games with static abilities, verified after every scope', () => {
    const defs: CardDef[] = [...compiledDefs(['Plains']), ANTHEM, BEAR];
    const deck = [...Array(22).fill('Plains'), ...Array(4).fill('Test Anthem'), ...Array(14).fill('Test Bear')];
    STABLE_READS.verify = true;
    try {
      for (let g = 0; g < 2; g++) {
        const bot = new Bot(`wp30-stable-${g}`);
        let st = createGame({ seed: `wp30-stable-${g}`, players: [{ name: 'A', deck, stops: { fullControl: true } }, { name: 'B', deck, stops: { fullControl: true } }], defs });
        for (let i = 0; i < 120 && !st.result; i++) {
          const r = applyAction(st, bot.next(st));
          if (!r.error) st = r.state;
        }
        expect(st.zones.battlefield.length).toBeGreaterThan(0);
      }
    } finally {
      STABLE_READS.verify = false;
    }
  });
});
