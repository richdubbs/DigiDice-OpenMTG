/**
 * M6-2 tests that need M6-1 too (m6 design 4.3: "A test that needs two packages lives in the directory of the one that merges later"; merge order M6-1, then
 * M6-2). They need M6-1's foreign replacement effects (Essence of the Wild, Doubling Season: `feature:replace.foreign`) and its `asItWouldEnter` (CR 614.12),
 * which calls the copy enters part's `hypothetical` so the replacement effects that apply as an object enters are the ones of the object it is becoming a copy
 * of. They are skipped while `feature:replace.foreign` is not a capability of this build (this branch alone) and run once both packages are on main.
 *
 * Without M6-1 (this branch): Altered Ego's own X counters (CR 707.9e) and a Clone of Voice of All choosing its own color (CR 707.6, 614.12: the entering
 * object's own replacement effects are read with the copy applied, effects/replacements.ts#withEntersFacts) already work; those blocks always run.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type AbilityDef, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { equivalent } from '../../m5/cr-examples/helpers';
import { act } from '../../m5/helpers';
import { cast, drive, find, looks, M6_1_MERGED, pick, resolveAll, resolveTop, scenario, target } from './support';

const islands = (n: number): string[] => Array(n).fill('Island') as string[];
const forests = (n: number): string[] => Array(n).fill('Forest') as string[];

/** Answer every pending choice of a color (CR 614.12a "as ~ enters, choose a color") with `colors` in order; returns the state and how many were asked. */
function chooseColors(s: GameState, colors: string[]): { s: GameState; asked: number } {
  let asked = 0;
  let t = s;
  for (let i = 0; i < 20 && t.pending && t.pending.kind !== 'priority'; i++) {
    const p = t.pending as { kind: string; options?: { id: string; label: string }[] };
    if (p.kind === 'chooseOption' && p.options?.some((o) => /white|blue|black|red|green/i.test(o.label))) {
      const want = colors[asked++] ?? 'White';
      const opt = p.options.find((o) => o.label.toLowerCase() === want.toLowerCase()) ?? p.options[0]!;
      t = drive(t, [{ kind: 'chooseOption', ids: [opt.id] }]);
    } else if (p.kind === 'chooseColor') {
      const want = (colors[asked++] ?? 'W')[0]!.toUpperCase() as 'W';
      t = drive(t, [{ kind: 'chooseColor', color: want }]);
    } else break;
  }
  return { s: t, asked };
}

/** "You may have this creature enter as a copy of any creature on the battlefield, except it enters with X additional +1/+1 counters on it." (Altered Ego) */
const alteredEgo = (): CardDef => equivalent({ name: 'Altered Ego', type_line: 'Creature — Shapeshifter', mana_cost: '{X}{2}{G}{U}', power: '0', toughness: '0', colors: ['G', 'U'] }, [{
  kind: 'static', text: 'You may have this creature enter as a copy of any creature on the battlefield, except it enters with X additional +1/+1 counters on it.',
  zone: ['stack', 'battlefield'],
  effects: [{
    s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
    body: { b: 'enters', copy: { of: { types: ['Creature'] }, optional: true, additional: [{ counters: [{ kind: '+1/+1', count: { q: 'X' } }] }] } },
  }],
} as AbilityDef]);

/** Cast Altered Ego with X = `x` (CR 107.3, 601.2b), paying automatically. */
function castEgo(s: GameState, x: number): GameState {
  s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Altered Ego', 'hand') });
  return drive(s, [{ kind: 'chooseNumber', n: x }]);
}

describe.runIf(M6_1_MERGED)('with M6-1: CR 614.12, 616.1c, 616.1g, 707.6, 707.9e', () => {
  it('CR 616.1c (CR 616.1f example): Rusted Sentinel enters as a copy of Essence of the Wild untapped: the copy effect is applied first', () => {
    const essence = equivalent({ name: 'Essence of the Wild', type_line: 'Creature — Avatar', mana_cost: '{3}{G}{G}{G}', power: '6', toughness: '6', colors: ['G'] }, [{
      kind: 'static', text: 'Creatures you control enter as a copy of Essence of the Wild.',
      effects: [{
        s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' },
        body: { b: 'enters', copy: { of: { self: true }, optional: false } },
      }],
    } as AbilityDef]);
    let s = scenario(['Rusted Sentinel', 'Island'], { p1: { hand: ['Rusted Sentinel'], battlefield: [...islands(4), 'Essence of the Wild'] }, defs: [essence] });
    s = resolveAll(cast(s, 'Rusted Sentinel'));
    const sentinel = find(s, 'Rusted Sentinel', 'battlefield');
    expect(looks(s, sentinel)).toMatchObject({ name: 'Essence of the Wild', pt: [6, 6] });
    expect(s.objects[sentinel]!.tapped).toBe(false);
  });

  it('CR 616.1g: Doubling Season and a token copy of Voice of All: the doubling first, then each token chooses its color', () => {
    const maker = compileCard({ name: 'Test Duplicate', layout: 'normal', type_line: 'Sorcery', mana_cost: '{U}', oracle_text: 'Create a token that\'s a copy of target creature.', colors: [] } as OracleCard);
    let s = scenario(['Voice of All', 'Doubling Season', 'Island'], { p1: { hand: ['Test Duplicate'], battlefield: ['Island', 'Doubling Season', 'Voice of All'] }, defs: [maker] });
    s = cast(s, 'Test Duplicate', [target(find(s, 'Voice of All', 'battlefield'))]);
    s = resolveTop(s);
    const r = chooseColors(s, ['Red', 'Green']);
    expect(r.asked).toBe(2);
    expect(r.s.zones.battlefield.filter((id) => r.s.objects[id]!.kind === 'token')).toHaveLength(2);
  });

  it('CR 707.9e, 614.12: Altered Ego that enters as a copy of a Clone becomes a copy of what the Clone ability chooses, and gets no counters', () => {
    // p2's Clone copies nothing (put onto the battlefield directly): a 0/0 that the anthem keeps alive (CR 704.5f), so Altered Ego can copy it
    const anthem = compileCard({ name: 'Test Anthem', layout: 'normal', type_line: 'Enchantment', mana_cost: '{1}{W}', oracle_text: 'Creatures you control get +1/+1.', colors: [] } as OracleCard);
    expect(anthem.automation.level).toBe('full');
    let s = scenario(['Clone', 'Grizzly Bears', 'Island', 'Forest'], {
      p1: { hand: ['Altered Ego'], battlefield: [...islands(4), ...forests(4)] }, p2: { battlefield: ['Test Anthem', 'Clone', 'Grizzly Bears'] }, defs: [alteredEgo(), anthem],
    });
    expect(looks(s, find(s, 'Clone', 'battlefield')).pt).toEqual([1, 1]);
    s = castEgo(s, 2);
    s = resolveTop(s);
    s = drive(s, [pick(find(s, 'Clone', 'battlefield')), pick(find(s, 'Grizzly Bears', 'battlefield'))]);
    const ego = find(s, 'Altered Ego', 'battlefield');
    expect(looks(s, ego)).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2] });
    expect(s.objects[ego]!.counters['+1/+1']).toBeUndefined();
  });
});

describe('CR 707.6, 614.12 without M6-1: the copied "as enters" ability of the copy is the one that applies (effects/replacements.ts#withEntersFacts)', () => {
  it('CR 707.6, 614.12: Clone copying Voice of All chooses its own color as it enters (the copied "as enters" choice)', () => {
    let s = scenario(['Clone', 'Voice of All', 'Island'], { p1: { hand: ['Clone'], battlefield: islands(4) }, p2: { battlefield: ['Voice of All'] } });
    s = resolveTop(cast(s, 'Clone'));
    s = drive(s, [pick(find(s, 'Voice of All', 'battlefield'))]);
    const r = chooseColors(s, ['Red']);
    expect(r.asked).toBe(1);
    const clone = find(r.s, 'Clone', 'battlefield');
    expect(getChars(r.s, clone).name).toBe('Voice of All');
    const links = Object.entries(r.s.objects[clone]!.links ?? {});
    // stored in the copy effect's link namespace (E20: renamed from the hypothetical copy's), as a color letter or name
    expect(links.some(([k, v]) => /^e\d+#/.test(k) && (v.values ?? []).some((x) => /^r$|red/i.test(x)))).toBe(true);
  });
});

describe('CR 707.9e without M6-1: Altered Ego copying Grizzly Bears enters with X additional +1/+1 counters', () => {
  it('X = 2: a 4/4 Grizzly Bears (the X of its spell, CR 107.3)', () => {
    let s = scenario(['Grizzly Bears', 'Island', 'Forest'], { p1: { hand: ['Altered Ego'], battlefield: [...islands(4), ...forests(4)] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [alteredEgo()] });
    s = castEgo(s, 2);
    s = resolveTop(s);
    s = drive(s, [pick(find(s, 'Grizzly Bears', 'battlefield'))]);
    const ego = find(s, 'Altered Ego', 'battlefield');
    expect(looks(s, ego)).toMatchObject({ name: 'Grizzly Bears', pt: [4, 4] });
    expect(s.objects[ego]!.counters['+1/+1']).toBe(2);
  });
});
