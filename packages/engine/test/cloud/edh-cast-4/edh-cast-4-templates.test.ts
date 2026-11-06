/**
 * Commander lane edh-cast, round edh-cast-4: the template data of parser/templates/zz-cloud/edh-cast-4.json ("your opponents can't block with creatures with even mana
 * values", "any player may cast Sliver spells as though they had flash", "as long as you've cast a spell this turn, you may play cards from the top of your library",
 * "creature spells you cast cost {W}{U} less to cast. This effect reduces only the amount of colored mana you pay") and the parser, renderer and engine changes of the round
 * (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-4-scenarios.test.ts. CR cites checked
 * against the Comprehensive Rules 2026-09-25 (media.wizards.com), see the record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast4 from '../../../src/parser/templates/zz-cloud/edh-cast-4.json';
import review from '../../m5/golden/cards/edh-cast-4-review.json';
import r3cost from '../../m5/golden/cards/cloud-r3-cost-review.json'; // Fortune Teller's Talent: the earlier round's entry, updated by this round (guide section 6)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { manaValueParityMatches } from '../../../src/rules/base-chars';
import { modifyMana } from '../../../src/statics/costmods';

const MECH = edhCast4 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'rst.edhc4.opponents.cantBlockWith.filter': ['Void Winnower'],
  'prm.edhc4.anyPlayer.haveFlash': ['Quick Sliver', 'Tidal Barracuda'],
  'sta.edhc4.aslong.top.play.cards': ["Fortune Teller's Talent"],
  'cm.edhc4.spells.less.you.colored.only': ['Morophon, the Boundless'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (statics of a creature or an enchantment). */
const parsedWith = (_t: Template, text: string) =>
  parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;

describe('edh-cast-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-4.json, path order: after cmd5 and edh-cast-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-4.json');
    expect(files.indexOf('zz-cloud/edh-cast-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-4.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhc4.* (or sta., cm., rst., prm.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|prm)\.edhc4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(r3cost as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === "Fortune Teller's Talent")];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-cast-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/opponents/, 'creatures'], [/can't/, 'can'], [/flash/, 'haste'], [/any player/, 'you'], [/block/, 'attack'], [/play/, 'sacrifice'],
    [/top/, 'bottom'], [/less/, 'more'], [/only/, 'also'], [/colored/, 'generic'], [/may/, 'must'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-cast-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-cast-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-cast-4 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it('parser/holes/filter.ts, types/ability.ts (CR 202.3): "with even / odd mana value(s)" is the filter field manaValueParity; "with an even mana value" in a cast ban and a block ban', () => {
    const f = face("Your opponents can't cast spells with even mana values.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"manaValueParity":"even"');
    expect(JSON.stringify(face("Your opponents can't cast spells with odd mana values.").abilities)).toContain('"manaValueParity":"odd"');
    expect(fullyAutomated(face("Your opponents can't cast spells with even power."))).toBe(false);
    expect(fullyAutomated(face("Your opponents can't cast spells with mana value even."))).toBe(false);
  });
  it('rules/base-chars.ts#manaValueParityMatches (CR 202.3e): zero is even (Oracle reminder of Void Winnower); a spell with {X} still to be announced is neither even nor odd', () => {
    const o = (zone: string, x?: number) => ({ zone, ...(x !== undefined ? { stack: { x } } : { stack: undefined }) }) as never;
    const cost = [{ kind: 'variable', name: 'X' }] as never;
    expect(manaValueParityMatches(o('battlefield'), { manaValue: 0, manaCost: null }, 'even')).toBe(true);
    expect(manaValueParityMatches(o('battlefield'), { manaValue: 3, manaCost: null }, 'even')).toBe(false);
    expect(manaValueParityMatches(o('stack'), { manaValue: 0, manaCost: cost }, 'even')).toBe(false);
    expect(manaValueParityMatches(o('stack'), { manaValue: 0, manaCost: cost }, 'odd')).toBe(false);
    expect(manaValueParityMatches({ zone: 'stack', stack: {} } as never, { manaValue: 0, manaCost: cost }, 'even')).toBe(true); // on the stack with no X announced: X = 0
    expect(manaValueParityMatches(o('stack', 5), { manaValue: 5, manaCost: cost }, 'odd')).toBe(true);
    expect(manaValueParityMatches(o('stack', 6), { manaValue: 6, manaCost: cost }, 'odd')).toBe(false);
  });
  it('render/stat.ts (CR 509.1b, 101.2): "Your opponents can\'t block with <creatures>" is the opponents\' creatures of that description; a ban on blocking with all creatures has other words', () => {
    const f = face("Your opponents can't block with green creatures.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"controller":"opponent"');
    expect(fullyAutomated(face("Your opponents can't block with creatures."))).toBe(true);
    expect(fullyAutomated(face("Your opponents can't block with creatures with even mana values and flying."))).toBe(false);
  });
  it('statics/costmods.ts#modifyMana (CR 601.2f, 118.7): `coloredOnly` reduces the cost\'s own colored mana only; without it a colored symbol the cost lacks reduces generic mana (CR 118.7b)', () => {
    const hit = (coloredOnly: boolean) => [{ unknown: false, name: 'x', controller: 'p1', source: null, def: { s: 'costMod', applies: { caster: 'you' }, change: { kind: 'reduce', mana: [{ kind: 'colored', color: 'W' }, { kind: 'colored', color: 'U' }], ...(coloredOnly ? { coloredOnly: true } : {}) } } }] as never;
    const cost = [{ kind: 'generic', amount: 4 }] as never;
    expect((modifyMana(cost, hit(true)) as { mana: unknown }).mana).toEqual([{ kind: 'generic', amount: 4 }]);
    expect((modifyMana(cost, hit(false)) as { mana: unknown }).mana).toEqual([{ kind: 'generic', amount: 2 }]);
    const colored = [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'W' }, { kind: 'colored', color: 'W' }, { kind: 'colored', color: 'U' }] as never;
    expect((modifyMana(colored, hit(true)) as { mana: unknown }).mana).toEqual([{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'W' }]);
  });
  it('parser (CR 601.2f): the explanatory sentence is the reduction of colored mana alone, and "colored" for one color or the color\'s own name both parse; a generic reduction with the sentence stays manual', () => {
    expect(fullyAutomated(face('Creature spells you cast cost {G} less to cast. This effect reduces only the amount of green mana you pay.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('Creature spells you cast cost {G} less to cast. This effect reduces only the amount of colored mana you pay.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('Creature spells you cast cost {G} less to cast. This effect reduces only the amount of red mana you pay.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face('Creature spells you cast cost {1} less to cast. This effect reduces only the amount of colored mana you pay.', 'Enchantment'))).toBe(false);
  });
  it('actions/cast.ts, statics/hooks.ts (CR 601.2b, 202.3e): a "can\'t cast" effect that reads a mana value is judged again once X is announced (CastVia.xAnnounced); the played proof is in the scenarios file', () => {
    expect(ENGINE_CAPABILITIES.has('feature:costMod.coloredOnly')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('filter:manaValueParity')).toBe(true);
  });
});
