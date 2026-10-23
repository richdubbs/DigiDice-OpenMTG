/**
 * WP22 golden cards (design 15.2): Giant Growth, Glorious Anthem, Humility, Opalescence, Kavu Titan, Thalia, Doubling Season, Leyline of the Void, Clone,
 * Oko, Mutavault and History of Benalia must parse to EXACTLY the JSON of design section 13 (read from the design document itself, test/m5/model/examples.ts),
 * pass the exact render gate (G6) and the lint (G7). Their classification with the engine's capabilities is full exactly when the engine has every
 * capability they use: the replacement and copy effects of milestone 6 (Doubling Season, Leyline of the Void, Clone) parse to the model but are not full,
 * and two cards waited for capabilities of other packages (op:exchange.control arrived with MX2, feature:chapter with M6-6, keyword:kicker with M6-5a), listed per card below.
 *
 * Templates of other packages the cards need (WP21's "Create a ... token", WP23's exchange and "It's still a land" rider, WP20's "Add {C}") are test
 * stand-ins (support.ts#STANDINS). Fixture cards give the Oracle text; Oko and Mutavault, which are not fixture cards, take it from the quote in design
 * section 13.
 *
 * Three documented differences from section 13, both display or redundant data (asserted exactly, not ignored):
 *  - a keyword granted inside another ability keeps the case it is printed with ("and with trample"); section 13 writes "Trample";
 *  - Thalia's `applies.spells` carries `stackKind: 'spell'`, which the Filter hole gives every "... spells" noun phrase (WP6); section 13 omits it
 *    (`zone: 'stack'` already says it; a cost modification only ever applies to spells being cast, CR 601.2f);
 *  - History of Benalia's Knight token has no `name`: the token comes from a stand-in of WP21's token template, whose TokenDesc hole (WP6) does not
 *    name tokens; the chapter structure and chapter III (WP22) are exact.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { classifyCard } from '../../../src/model/classify';
import { validateAbility } from '../../../src/model/validate';
import { getCard } from '../../fixtures';
import { EXAMPLES } from '../model/examples';
import { STANDINS, WP22_TEMPLATES, bare, designOracle, options } from './support';

/** `missing`: the capabilities ENGINE_CAPABILITIES lacks for the card (none of them is WP22's); the card is full exactly when there are none. */
interface Golden { name: string; rules: string; templates: string[]; missing: string[]; fixture: boolean }

const GOLDEN: Golden[] = [
  { name: 'Giant Growth', rules: 'CR 611.2a, 611.2c, 613.4c: a resolved pump until end of turn', templates: ['eff.pump'], missing: [], fixture: true },
  { name: 'Glorious Anthem', rules: 'CR 604.1, 611.3a, 613.4c: a live anthem', templates: ['sta.anthem'], missing: [], fixture: true },
  { name: 'Humility', rules: 'CR 613.1f, 613.4b, 613.6: two layers of one sentence', templates: ['sta.loseall.base'], missing: [], fixture: true },
  { name: 'Opalescence', rules: 'CR 205.1b, 613.1d, 613.4b: a type added and a base P/T read from the subject', templates: ['sta.typeadd.manavalue'], missing: [], fixture: true },
  { name: 'Kavu Titan', rules: 'CR 702.33d, 614.1c, 613.1f: a kicked enters replacement and a conditional grant', templates: ['kw.line', 'abl.kicked.counters.grant'], missing: [], fixture: true }, // M6-5a registered keyword:kicker
  { name: 'Thalia, Guardian of Thraben', rules: 'CR 601.2f, 118.7: a cost increase for every caster', templates: ['kw.line', 'cm.spells.more.any'], missing: [], fixture: true },
  { name: 'Doubling Season', rules: 'CR 614.1a, 616.1: two foreign replacements (milestone 6)', templates: ['rep.double.tokens', 'rep.double.counters'], missing: [], fixture: true }, // M6-1: full (body:modify.count, feature:replace.foreign, feature:replace.byEffect registered)
  { name: 'Leyline of the Void', rules: 'CR 103.6a, 614.1a, 111.1: a pregame action and a foreign replacement (milestone 6)', templates: ['abl.pregame.begin', 'rep.graveyard.exile.opponent'], missing: [], fixture: true }, // M6-1 registered feature:replace.foreign; FAST4 MX1 static:pregame (core/pregame.ts)
  { name: 'Clone', rules: 'CR 707.5, 614.1c, 613.2a: enter as a copy (layer 1a, M6-2)', templates: ['rep.enters.copy'], missing: [], fixture: true },
  { name: 'Oko, Thief of Crowns', rules: 'CR 606, 613.1d-f, 613.4b: loyalty abilities and a permanent multi-layer effect', templates: ['eff.cont.elk', 'test.wp22.create', 'test.wp22.exchange'], missing: [], fixture: false }, // MX2: op:exchange.control (core/control.ts)
  { name: 'Mutavault', rules: 'CR 205.1b, 613.1d, 613.4b, 702.73a: a land that becomes a creature, kept a land by its rider', templates: ['eff.cont.becomes.alltypes', 'test.wp22.rid.still', 'test.wp22.manaC'], missing: [], fixture: false },
  { name: 'History of Benalia', rules: 'CR 714.2, 611.2c, 613.4c: saga chapters and a resolved anthem until end of turn', templates: ['eff.cont.pump.each', 'test.wp22.create'], missing: [], fixture: true }, // M6-6: feature:chapter
];

const oracleCard = (g: Golden): OracleCard => {
  if (g.fixture) return getCard(g.name);
  const text = designOracle(g.name);
  const typeLine = g.name === 'Mutavault' ? 'Land' : 'Legendary Planeswalker — Oko';
  return { name: g.name, layout: 'normal', type_line: typeLine, oracle_text: text, ...(g.name === 'Mutavault' ? {} : { loyalty: '4', mana_cost: '{1}{G}{U}' }) } as OracleCard;
};

/** Section 13's JSON with the three documented differences applied (see the header). */
function expected(g: Golden): unknown[] {
  const ex = EXAMPLES.find((e) => e.name === g.name || e.name.startsWith(`${g.name},`))!;
  const abilities = JSON.parse(JSON.stringify(ex.faces[0]!.abilities)) as AbilityDef[];
  if (g.name.startsWith('Thalia')) {
    const st = abilities.find((a) => a.kind === 'static') as Extract<AbilityDef, { kind: 'static' }>;
    const cm = st.effects[0] as unknown as { applies: { spells: Record<string, unknown> } };
    cm.applies.spells = { ...cm.applies.spells, stackKind: 'spell' };
  }
  if (g.name === 'History of Benalia') {
    const step = (abilities[0] as Extract<AbilityDef, { kind: 'chapter' }>).effect.steps[0] as unknown as { token: Record<string, unknown> };
    delete step.token['name'];
  }
  return abilities;
}

describe('WP22 golden cards produce exactly the JSON of design section 13', () => {
  const opts = options(STANDINS, { capabilities: ENGINE_CAPABILITIES });
  for (const g of GOLDEN) {
    it(`${g.rules} (${g.name})`, () => {
      const res = parseCardFace(oracleCard(g), opts);
      expect(bare(res.abilities, { keywordCase: true })).toEqual(expected(g));
      expect(res.diagnostics.filter((d) => d.level === 'manual')).toEqual([]);
      for (const id of g.templates) expect(res.templatesUsed, g.name).toContain(id);
    });
  }
});

describe('WP22 golden cards pass the render gate (G6) and the lint (G7), and classify as the design says (design 10.3)', () => {
  const opts = options(STANDINS, { capabilities: ENGINE_CAPABILITIES });
  for (const g of GOLDEN) {
    it(`${g.name}: gate and lint clean; ${g.missing.length === 0 ? 'full' : `not full: the engine lacks ${g.missing.join(', ')}`}`, () => {
      const res = parseCardFace(oracleCard(g), opts);
      expect(res.gate.every((x) => x.ok), JSON.stringify(res.gate)).toBe(true);
      for (const a of res.abilities) expect(validateAbility(a).filter((i) => i.severity === 'error'), a.text).toEqual([]);
      // classified without the experimental-template cap (design 6.9), which the pipeline (WP18) applies on top; asserted separately below
      const level = classifyCard({ faces: [{ abilities: res.abilities, lines: { lines: [], sentences: [] } }], source: 'templates' }, ENGINE_CAPABILITIES).level;
      const missing = [...new Set(res.abilities.flatMap((a) => missingCapabilities(a, ENGINE_CAPABILITIES)))].sort();
      expect(missing).toEqual(g.missing);
      if (g.missing.length === 0) expect(level).toBe('full');
      else expect(level).not.toBe('full');
    });
  }
  it('design 6.9: a golden card that uses an experimental WP22 template is capped at partial by the pipeline until the template is reviewed', () => {
    // T3 (push wave): sta.loseall.base is stable since the T3 review (both index matches, Humility and Poppet Factory, read against CR 613.1f, 613.4b), so
    // Humility is no longer capped; the cap itself is still what an experimental template does
    const humility = parseCardFace(getCard('Humility'), opts);
    expect(humility.experimental).toEqual([]);
    const level = (experimentalTemplates: string[]): string =>
      classifyCard({ faces: [{ abilities: humility.abilities, lines: { lines: [], sentences: [] } }], source: 'templates', experimentalTemplates }, ENGINE_CAPABILITIES).level;
    expect(level([])).toBe('full');
    expect(level(['sta.loseall.base'])).toBe('partial');
    const anthem = parseCardFace(getCard('History of Benalia'), opts);
    expect(anthem.experimental.filter((id) => WP22_TEMPLATES.some((t) => t.id === id))).toEqual([]);
  });
});

describe('WP22 golden cards without the stand-ins of other packages: never wrong, only less automated (design 6.6, 6.7)', () => {
  const own = options([], { capabilities: ENGINE_CAPABILITIES });
  it('Mutavault without the "It\'s still a land" rider (WP23): the whole second ability is one manual step (T2 contagion on "still", CR 205.1b), never a non-land creature', () => {
    const res = parseCardFace(oracleCard(GOLDEN.find((g) => g.name === 'Mutavault')!), own);
    const second = res.abilities[1]!;
    expect(second.kind).toBe('activated');
    expect(JSON.stringify(second)).not.toContain('"set":["Creature"]');
    expect((second as Extract<AbilityDef, { kind: 'activated' }>).effect.steps.map((s) => s.op)).toEqual(['manual']);
  });
  it('Oko without the token and exchange templates: the +1 is automated, +2 and -5 keep their costs and are manual', () => {
    const res = parseCardFace(oracleCard(GOLDEN.find((g) => g.name.startsWith('Oko'))!), own);
    const [plus2, plus1, minus5] = res.abilities as Extract<AbilityDef, { kind: 'activated' }>[];
    expect(bare([plus1!])).toEqual([expected(GOLDEN.find((g) => g.name.startsWith('Oko'))!)[1]]);
    expect(plus2!.effect.steps.map((s) => s.op)).toEqual(['manual']);
    expect(plus2!.cost).toEqual({ loyalty: 2 });
    expect(JSON.stringify(minus5)).toContain('"op":"manual"');
  });
});

function parseCardFace(c: OracleCard, opts: ReturnType<typeof options>) {
  return parseCardFaces(c, opts)[0]!;
}

import { parseCard } from '../../../src/parser/parse';
function parseCardFaces(c: OracleCard, opts: ReturnType<typeof options>) {
  return parseCard(c, opts).faces;
}
