/**
 * WP2: near-miss mutations (design 6.8, G6 and G9). Every worked example is mutated in every small way (a number plus one, a boolean flipped, a color, type,
 * zone or player swapped, a key or an array element deleted) and the gate must reject the result. A mutation the gate still accepts is a field the
 * renderer does not print. The allowlist below is the complete list of fields that have no words in Oracle text; every other survivor is a bug.
 */
import { describe, expect, it } from 'vitest';
import { renderGate } from '../../../src/index';
import { examples } from './examples';

type J = unknown;
/** Display data the model keeps beside the structure (it is derived from the structure and never read by the renderer). */
const NOISE = new Set(['text', 'span', 'sentence', 'src', 'prov', 'label']);

function* paths(node: J, path: (string | number)[] = []): Generator<(string | number)[]> {
  yield path;
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* paths(node[i], [...path, i]);
  else if (node && typeof node === 'object') for (const k of Object.keys(node as object)) if (!NOISE.has(k)) yield* paths((node as Record<string, J>)[k], [...path, k]);
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const get = (root: J, path: (string | number)[]): J => path.reduce<J>((n, k) => (n as Record<string | number, J>)[k], root);

const NEXT: Record<string, string> = {
  W: 'U', U: 'B', B: 'R', R: 'G', G: 'W', Creature: 'Artifact', Artifact: 'Land', Land: 'Enchantment', Enchantment: 'Creature', you: 'opponent', opponent: 'you',
  graveyard: 'exile', hand: 'library', library: 'hand', exile: 'graveyard', battlefield: 'graveyard',
};

function mutations(root: J): { desc: string; make: () => J }[] {
  const out: { desc: string; make: () => J }[] = [];
  const assign = (p: (string | number)[], value: J): J => {
    const c = clone(root);
    (get(c, p.slice(0, -1)) as Record<string | number, J>)[p[p.length - 1]!] = value;
    return c;
  };
  for (const p of paths(root)) {
    if (p.length === 0) continue;
    const v = get(root, p);
    const parent = get(root, p.slice(0, -1));
    const key = p[p.length - 1]!;
    const where = p.join('.');
    if (typeof v === 'number') out.push({ desc: `${where}: ${v} -> ${v + 1}`, make: () => assign(p, v + 1) });
    else if (typeof v === 'boolean') out.push({ desc: `${where}: flip`, make: () => assign(p, !v) });
    else if (typeof v === 'string' && NEXT[v] !== undefined) out.push({ desc: `${where}: ${v} -> ${NEXT[v]}`, make: () => assign(p, NEXT[v]!) });
    if (Array.isArray(parent)) {
      out.push({ desc: `${where}: delete element`, make: () => { const c = clone(root); (get(c, p.slice(0, -1)) as J[]).splice(key as number, 1); return c; } });
    } else if (typeof key === 'string' && !['kind', 'op', 'ref', 'ev', 's', 'q', 'cond', 'd', 'b', 'layer', 'id'].includes(key)) {
      out.push({ desc: `${where}: delete key`, make: () => { const c = clone(root); delete (get(c, p.slice(0, -1)) as Record<string, J>)[key]; return c; } });
    }
  }
  return out;
}

/** Fields (and cards) whose changes Oracle text cannot show. Each entry says why. */
const SILENT: [RegExp, string][] = [
  [/ #\d+ (isMana|isLoyalty): /, 'flags: a mana ability and a loyalty ability read like any activated ability (the loyalty cost prints its number)'],
  [/ #\d+ zone(\.\d+)?: /, 'the zones an ability functions in are not in its text'],
  [/\.link: delete key$/, 'a link id names a CR 607 link; no words'],
  [/\.capture(\.\d+)?: delete/, 'the names a delayed trigger captures'],
  [/steps\.\d+\.(reason|reminder): delete key$/, 'a manual step prints its own text; the reason and the chip lifetime have no words'],
  [/token\.name: delete key$/, 'the token name is the creature type it prints'],
  [/^(Rancor|Bonesplitter) #\d+ effects\.0\.mods\.\d+\.toughness: delete key$/, '+2/+0: a missing toughness is +0'],
  [/^Path to Exile #0 effect\.steps\.1\.do\.0\.filter\.zone/, 'the zone of a search is printed from `search.zone`'],
  [/^(Path to Exile #0 effect\.steps\.1\.do\.1|Sneak Attack #0 effect\.steps\.1)\.to\.controller: delete key$/, 'CR 110.2a: what a player puts onto the battlefield enters under that player control, so "under your control" is optional in the text'],
  [/^Sneak Attack #0 effect\.steps\.[23]\.guard: delete key$/, '"did" guards on an optional choice that the step names are implied by "that creature" (CR 608.2c)'],
  [/^Chaos Orb #0 cost: delete key$/, 'a manual ability may carry no understood cost: the cost is then in its text and paid by hand'],
  [/^Chaos Orb #0 (reason|shape): delete key$/, 'a manual ability prints its own text; why it is manual and which shape it has are not words'],
  [/^Paradise Plume #1 trigger\.on\.0\.(player|spell\.stackKind): delete key$/, 'a cast event is about a spell and "any player" is the default'],
  [/^Fire \/\/ Ice #0 effect\.targets\.0\.(divide|filter)/, 'the division is announced metadata beside "divided as you choose"; an any-target has no filter'],
  [/^Cryptic Command #0 effect\.modes\.options\.1\.program\.targets\.0\.filter: delete key$/, 'an empty filter is "permanent"'],
  [/^(Fireball|Death-Rattle Oni) #\d+ effects\.0\.applies\.caster/, 'a self cost modifier has no caster in its words'],
  [/^Death-Rattle Oni #1 effects\.0\.change\.floor: delete key$/, 'costs cannot go below zero in any case'],
  [/^Thalia, Guardian of Thraben #1 effects\.0\.applies\.spells\.zone: delete key$/, 'spells are on the stack'],
  [/^Glacial Fortress #0 effects\.0\.body\.tapped/, '"enters tapped unless" is `tappedUnless` alone'],
];

describe('design 6.8 (G6, G9): every near-miss mutation of the worked examples is rejected by the gate', () => {
  it('survivors are only fields without words', () => {
    const survivors: string[] = [];
    let total = 0;
    for (const ex of examples as unknown as { name: string; oracle: string[]; card: { abilities?: J[]; faces?: { name: string; abilities: J[] }[] } }[]) {
      const faces = ex.card.faces ?? [{ name: ex.name, abilities: ex.card.abilities ?? [] }];
      for (const face of faces) {
        const lines = ex.card.faces ? ex.oracle.filter((l) => l.startsWith(`${face.name}: `)).map((l) => l.slice(face.name.length + 2)) : ex.oracle;
        const ctx = { selfNames: [face.name, ...(face.name.includes(',') ? [face.name.split(',')[0]!] : [])] };
        face.abilities.forEach((def, i) => {
          let covered: string[] | null = null;
          for (let start = 0; start < lines.length && !covered; start++) {
            for (let k = 1; start + k <= lines.length && !covered; k++) {
              if (renderGate(def as never, lines.slice(start, start + k), ctx).ok) covered = lines.slice(start, start + k);
            }
          }
          if (!covered) return;
          for (const m of mutations(def)) {
            total++;
            let ok: boolean;
            try {
              ok = renderGate(m.make() as never, covered, ctx).ok;
            } catch {
              ok = false;
            }
            if (ok) survivors.push(`${ex.name} #${i} ${m.desc}`);
          }
        });
      }
    }
    expect(total).toBeGreaterThan(1500);
    const unexplained = survivors.filter((s) => !SILENT.some(([re]) => re.test(s)));
    expect(unexplained, `${unexplained.length} of ${total} mutations still pass the gate:\n${unexplained.join('\n')}`).toEqual([]);
  });
});
