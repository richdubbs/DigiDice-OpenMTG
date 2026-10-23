/**
 * WP2 review fixes: no field of the model is silent everywhere (design 3.3, 6.8 G6; replaces the claim of mutation.test.ts, which only mutates the fields
 * of the 53 worked examples). The seeded generator (gen.ts) covers every node kind. Each field that is present is deleted, flipped, increased or swapped in
 * turn; a field for which the printed text NEVER changes (in at least five tries) has no words anywhere, and must be on the list below with the reason
 * its text cannot show it. A field that changes the words in some node and not in another (a flag a node kind does not read) is not a finding here: the
 * per-field tests (filters.test.ts, dropped.test.ts, numbers.test.ts, durations.test.ts) cover those one by one.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { Gen, rng } from './gen';

const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
/** Display data the model keeps beside the structure. */
const NOISE = new Set(['text', 'span', 'sentence', 'src', 'prov', 'label']);
/** The keys that name the kind of a node. */
const DISCRIMINATORS = ['op', 's', 'q', 'cond', 'ev', 'kind', 'ref', 'layer', 'b', 'd', 'at'];
const SWAP: Record<string, string> = {
  W: 'U', U: 'B', B: 'R', R: 'G', G: 'W', Creature: 'Artifact', Artifact: 'Land', Land: 'Enchantment', Enchantment: 'Creature', you: 'opponent', opponent: 'you',
  graveyard: 'exile', hand: 'library', library: 'hand', exile: 'graveyard', battlefield: 'graveyard',
};

/** Fields without words, with the reason each has none. A label is `<node kind>.<field>: <mutation>`. */
const SILENT: [RegExp, string][] = [
  [/^kind=manual\.(reason|shape): /, 'a manual ability prints its own text; why it is manual and which shape it has are not words'],
  [/^op=manual\.reason: /, 'a manual step prints its own text; why it is manual is not a word'],
  [/^kind=activated\.isMana: /, 'a mana ability reads like any activated ability (CR 605.1a is a property of its effect)'],
  [/^ref=bound\.name: /, 'a binding name is a handle: the renderer follows the order of the text, not the name (design 6.4)'],
  [/^(op=(piles\.(chosen|other)|search\.as|look\.as|reveal\.as|may\.as|let\.name|move\.link|delay\.capture)|q=(var\.name|resultCount\.step)|cond=did\.step|<when>\.did|<chosen>\.link|kind=chosen\.link): /, 'names and link ids are handles (CR 607 links, `as` bindings); the words are the same'],
  [/^s=alternativeCost\.name: /, 'the name is read by linked abilities and by `wasCast.via`; the printed cost has none'],
  [/^s=continuous\.cda: /, 'a characteristic-defining ability (CR 604.3) is written like any static statement; the flag is derived from its shape'],
  [/^<token>\.name: /, 'the token name is the creature type it prints'],
  [/^(<divide>\.(what|total)|kind=\w+\.divide): /, 'the division is announced beside the step, whose text says "divided as you choose"'],
  [/^kind=reveal\.zone: /, 'the zone of a reveal cost is always the hand'],
  [/^op=chooseValue\.options: /, 'options are printed for a choice among options only'],
  [/^op=reveal\.to: /, '"to: all" is the default of a reveal'],
  [/^op=search\.min: /, 'a search may always fail to find (CR 701.23b), so a minimum has no words'],
  [/^layer=(1b\.faceDown|7d\.switchPT): /, 'a constant: the modification says it all'],
];

const text = (def: AbilityDef): string | null => {
  try {
    return K.ability(def, newState(ctx));
  } catch {
    return null;
  }
};

describe('CR 109.3 and design 3.3: a field of the model that changes no word in any ability is on the list of fields without words', () => {
  it('holds over 4000 generated abilities', () => {
    const tried = new Map<string, number>();
    const silent = new Map<string, number>();
    for (let seed = 1; seed <= 4000; seed++) {
      const def = new Gen(rng(seed)).ability();
      const base = text(def);
      if (base === null) continue;
      const visit = (node: unknown, parentLabel: string): void => {
        if (Array.isArray(node)) {
          for (const x of node) visit(x, parentLabel);
          return;
        }
        if (node === null || typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        const disc = DISCRIMINATORS.map((k) => (typeof o[k] === 'string' ? `${k}=${o[k] as string}` : null)).find((x) => x !== null);
        const label = disc ?? `<${parentLabel}>`;
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (NOISE.has(k) || DISCRIMINATORS.includes(k) || v === undefined) continue;
          if ((Array.isArray(v) && v.length === 0) || (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) continue;
          const mutations: [string, () => void][] = [];
          // deleting a false flag is no change at all (false is the default)
          if (v !== false) mutations.push(['delete', () => delete o[k]]);
          if (typeof v === 'boolean') mutations.push(['flip', () => (o[k] = !v)]);
          if (typeof v === 'number') mutations.push(['+1', () => (o[k] = v + 1)]);
          if (typeof v === 'string' && SWAP[v] !== undefined) mutations.push(['swap', () => (o[k] = SWAP[v]!)]);
          for (const [name, apply] of mutations) {
            apply();
            const label2 = `${label}.${k}: ${name}`;
            tried.set(label2, (tried.get(label2) ?? 0) + 1);
            if (text(def) === base) silent.set(label2, (silent.get(label2) ?? 0) + 1);
            o[k] = v;
          }
          visit(v, k);
        }
      };
      visit(def, 'ability');
    }
    expect([...tried.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(30000);
    const findings = [...silent.entries()]
      .filter(([label, n]) => n === tried.get(label) && n >= 5)
      .map(([label, n]) => `${label} (${n} of ${n} tries)`)
      .filter((l) => !SILENT.some(([re]) => re.test(l)));
    expect(findings, `${findings.length} field(s) never change the words:\n${findings.join('\n')}`).toEqual([]);
  }, 60_000); // WP31, WP21: about 3.5-4.5 s alone (on main too), over the 5 s default when the whole suite runs in parallel on a loaded machine
});
