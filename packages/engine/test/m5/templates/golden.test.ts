/**
 * WP21 golden cards (design 15.2 WP21, section 13): Doom Blade, Swords to Plowshares, Wrath of God, Raise the Alarm, Path to Exile, Rancor and Bonesplitter,
 * parsed by parseCard with the bootstrap templates (WP17), the WP21 templates and test-only stand-ins for the neighbor packages that are not merged yet
 * (WP19 trigger clauses, WP20 "gains life equal to", WP23 the search sequence of Path to Exile; support.ts#NEIGHBORS). Each must give exactly the JSON of
 * design section 13 (read from the design document, test/m5/model/examples.ts), pass the render gate (G6) and the lint (G7), with every WP21 sentence
 * parsed by a WP21 template.
 *
 * Two recorded deviations:
 *  - Raise the Alarm's token has no `name`. Section 13 writes `"name": "Soldier"`, but CR 111.4 names a token whose name the effect does not give after its
 *    subtypes plus the word "Token" ("Soldier Token"), which is what the token handler does when `name` is absent (effects/handlers/token-defs.ts; checked
 *    in scenario.test.ts); the parser never invents a name the text does not state.
 *  - Rancor's granted trample has the display `text` "trample" (as printed in "has trample"; the Abilities hole of WP6 keeps the printed case), where
 *    section 13 writes "Trample". Display data only: no rule reads it.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import { validateAbility } from '../../../src/model/validate';
import { renderGate, renderGateKeywordLine } from '../../../src/render/gate';
import { BOOTSTRAP_TEMPLATES, parseCard } from '../../../src/parser/parse';
import { getCard, loadFixtureCards } from '../../fixtures';
import { EXAMPLES } from '../model/examples';
import { bare, card, NEIGHBORS, options, WP21_TEMPLATES } from './support';

const OPTS = options(NEIGHBORS);
const WP21_IDS = new Set(WP21_TEMPLATES.map((t) => t.id));

/** Path to Exile is not a fixture card: it is built from the Oracle text quoted in design section 13 (the design is the source of the golden JSON too). */
function quoted(name: string, typeLine: string): OracleCard {
  const fixture = loadFixtureCards()[name];
  if (fixture) return fixture;
  const doc = EXAMPLES.find((e) => e.name === name);
  if (!doc) throw new Error(`no worked example ${name}`);
  const text = doc.faces[0]!.abilities.map((a) => a.text).join('\n');
  return card(name, typeLine, text);
}

const GOLDEN: { name: string; rules: string; card: () => OracleCard; wp21: string[] }[] = [
  { name: 'Doom Blade', rules: 'CR 115.1, 701.8a', card: () => getCard('Doom Blade'), wp21: [] },
  { name: 'Swords to Plowshares', rules: 'CR 701.13a, 608.2h', card: () => getCard('Swords to Plowshares'), wp21: ['eff.exile'] },
  { name: 'Wrath of God', rules: 'CR 701.8a, 701.19c', card: () => getCard('Wrath of God'), wp21: [] },
  { name: 'Raise the Alarm', rules: 'CR 111.1, 111.4, 701.7a', card: () => getCard('Raise the Alarm'), wp21: ['eff.token.you'] },
  { name: 'Path to Exile', rules: 'CR 701.13a, 110.2', card: () => quoted('Path to Exile', 'Instant'), wp21: ['eff.exile'] },
  { name: 'Rancor', rules: 'CR 303.4, 613.6, 603.10a, 400.7e', card: () => getCard('Rancor'), wp21: ['sta.attached.pump.has', 'eff.return.hand'] },
  { name: 'Bonesplitter', rules: 'CR 301.5, 702.6a, 613.4c', card: () => getCard('Bonesplitter'), wp21: ['sta.attached.pump'] }, // its equip line: WP19's kw.equip (support.ts#NEIGHBORS)
];

/** The section 13 JSON, with the one deviation recorded above. */
function expected(name: string): unknown[] {
  const abilities = structuredClone(EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities) as AbilityDef[];
  if (name === 'Raise the Alarm') {
    const step = (abilities[0] as Extract<AbilityDef, { kind: 'spell' }>).effect.steps[0] as { token: { name?: string } };
    delete step.token.name; // CR 111.4: "Soldier Token", named by the token handler
  }
  if (name === 'Rancor') {
    // display text only: a granted keyword keeps the case it is printed with in the sentence ("has trample"), section 13 capitalizes it
    const mod = (abilities[1] as Extract<AbilityDef, { kind: 'static' }>).effects[0] as { mods: { add?: { text: string }[] }[] };
    for (const m of mod.mods) for (const a of m.add ?? []) a.text = a.text.toLowerCase();
  }
  return abilities;
}

describe('WP21 golden cards: exactly the JSON of design section 13', () => {
  for (const g of GOLDEN) {
    it(`${g.rules} (${g.name})`, () => {
      const res = parseCard(g.card(), OPTS);
      expect(res.faces).toHaveLength(1);
      const f = res.faces[0]!;
      expect(bare(f.abilities)).toEqual(expected(g.name));
      expect(f.diagnostics.filter((d) => d.level === 'manual'), JSON.stringify(f.diagnostics)).toEqual([]);
      for (const id of g.wp21) expect(f.templatesUsed, id).toContain(id);
      expect(f.experimental).toEqual([]);
    });
  }

  it('guard G6 and G7: the render gate accepts each of them again here, and the lint finds no error', () => {
    for (const g of GOLDEN) {
      const c = g.card();
      const f = parseCard(c, OPTS).faces[0]!;
      expect(f.gate.every((x) => x.ok), g.name).toBe(true);
      f.abilities.forEach((a, i) => {
        const line = (c.oracle_text ?? '').split('\n')[i]!;
        const r = a.kind === 'keyword' ? renderGateKeywordLine([a], [line], { selfNames: [g.name] }) : renderGate(a, a.text.split('\n'), { selfNames: [g.name] });
        expect(r.ok, `${g.name} #${i}: ${r.rendered} / ${r.expected}`).toBe(true);
        expect(validateAbility(a).filter((x) => x.severity === 'error'), g.name).toEqual([]);
      });
    }
  });

  it('every template a golden card uses is one of the bootstrap, WP21 or named neighbor templates (by id, never by prefix)', () => {
    const neighbor = new Set(NEIGHBORS.map((t) => t.id));
    const boot = new Set(BOOTSTRAP_TEMPLATES.map((t) => t.id));
    for (const g of GOLDEN) {
      const used = parseCard(g.card(), OPTS).faces[0]!.templatesUsed;
      for (const id of used) expect(WP21_IDS.has(id) || neighbor.has(id) || boot.has(id), `${g.name}: ${id}`).toBe(true);
    }
  });

  it('without the neighbor stand-ins the WP21 parts still parse and the rest is manual, never guessed (design 6.6)', () => {
    const plain = options();
    const swords = parseCard(getCard('Swords to Plowshares'), plain).faces[0]!;
    // the exile is automated, the life gain is a manual step of the same program (no template of WP20 yet)
    expect(JSON.stringify(swords.abilities)).toContain('"op":"move"');
    expect(JSON.stringify(swords.abilities)).toContain('"op":"manual"');
    const rancor = parseCard(getCard('Rancor'), plain).faces[0]!;
    expect(rancor.abilities[1]!.kind).toBe('static');
    expect(rancor.abilities[2]!.kind).toBe('manual'); // the trigger clause is WP19's
  });
});
