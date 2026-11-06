/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-7: the template data of parser/templates/zz-cloud/edh-mana-keywords-7.json ("Each instant and sorcery card in your
 * graveyard has flashback. The flashback cost is equal to that card's mana cost." (Lier) and "When you spend this mana to cast your commander, scry X, where X is the number of times it's been cast from the
 * command zone this game." (Study Hall) and "This mana can't be spent to pay generic mana costs." (Jegantha)). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10).
 * The behavior is in edh-mana-keywords-7-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk7 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-7.json';
import review from '../../m5/golden/cards/edh-mana-keywords-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk7 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards that print each wording and are full (held-out, opened by the owner, commander request 2026-10-27)
  'sta.edhmk7.each.flashback.manacost': ['Lier, Disciple of the Drowned'],
  'rid.edhmk7.mana.youSpend.commander.scryCasts': ['Study Hall'],
  'rid.edhmk7.mana.cantBeSpent.generic': ['Jegantha, the Wellspring'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>([]);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-7.json, path order: after edh-mana-keywords-5, before edh-misc-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-7.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-5.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-7.json')).toBeLessThan(files.indexOf('zz-cloud/edh-misc-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are trg./rid./eff.edhmk7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
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

describe('edh-mana-keywords-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bdifferent colors\b/, 'the same color'], [/\bless\b/, 'more'], [/\byou activate\b/, 'your opponents activate'], [/\btwo mana\b/, 'three mana'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-mana-keywords-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-mana-keywords-7 parser, renderer and engine changes (one test each)', () => {
  // the whole pipeline (parse, the capabilities of the engine, lint): `full` is what a decklist card gets
  const level = (text: string, type: string, pt?: [string, string]): string =>
    compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard).automation.level;
  const face = (text: string, type = 'Artifact'): string => level(text, type);
  const creature = (text: string, type = 'Artifact Creature — Equipment Fox'): string => level(text, type, ['2', '2']);
  it('keywords/data/reconfigure.json, actions/announce-cond.ts, effects/handlers/zones-status.ts (CR 702.151a-b, 301.5c): reconfigure expands into attach, unattach and "not a creature while attached"', () => {
    expect(creature('Equipped creature gets +1/+1.\nReconfigure {2}') === 'full').toBe(true);
    expect(creature('Reconfigure {2}', 'Artifact Creature — Fox') === 'full').toBe(true); // the keyword stands for its abilities whatever the types say; attaching needs an Equipment (CR 301.5)
  });
  it('keywords/data/backup.json, parser/parse.ts#fillBackupAbilities, keywords/expand.ts (CR 702.165a-d): backup grants the abilities printed below it, only when every one is understood; the ones above it are not granted', () => {
    expect(creature('Backup 1\nFlying\nWhenever this creature attacks, you gain 1 life.', 'Creature — Human') === 'full').toBe(true);
    expect(creature('Backup 2\nTrample', 'Creature — Human') === 'full').toBe(true);
    // fail closed: a manual line below the keyword cannot be copied into the grant, so the keyword is manual too
    expect(creature('Backup 1\nFlying\nThis creature wibbles every frotzing blorp.', 'Creature — Human') === 'full').toBe(false);
    const f = parseCard(card('Example Relic', 'Creature — Human', 'Menace\nBackup 1\nFlying', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    const kw = (f.abilities as unknown as { kind: string; keyword?: string; below?: { keyword?: string }[] }[]).find((a) => a.keyword === 'backup');
    expect(kw?.below?.map((b) => b.keyword)).toEqual(['flying']);
  });
  it('keywords/data/demonstrate.json (CR 702.144a): demonstrate is a cast trigger of the spell itself', () => {
    expect(face('Demonstrate\nYou gain 2 life.', 'Sorcery') === 'full').toBe(true);
  });
  it('parser/holes/event.ts#EACH_OF_YOUR_STEPS, render/evt.ts (CR 505.1a, 603.2): "at the beginning of each of your main phases" is both of your main phases; another number of phases is not read', () => {
    expect(face('At the beginning of each of your main phases, you gain 1 life.') === 'full').toBe(true);
    expect(face('At the beginning of each of your first main phases, you gain 1 life.') === 'full').toBe(false);
    expect(face('At the beginning of each player\'s main phases, you gain 1 life.') === 'full').toBe(false);
  });
  it('model/cap-walk.ts, effects/refs.ts (CR 603.2, 601.2i): "each other player" of a cast trigger is every player but the caster; for any other event of another player it stays manual', () => {
    expect(face('Whenever a player casts a spell, each other player draws a card.') === 'full').toBe(true);
    expect(face('Whenever a player draws a card, each other player discards a card.') === 'full').toBe(false);
  });
  it('parser/lower/quantities.ts#movedGroups, parser/lower/anaphora.ts, render/steps-zones.ts (CR 701.8a, 614.6): "for each permanent put into a graveyard this way" after a destroy of several targets; after a destroy of a group the std-eoe reading stays', () => {
    expect(face('Destroy up to three target artifacts. For each artifact put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.', 'Sorcery') === 'full').toBe(true);
    // a mill beside the destroy makes "put into a graveyard this way" ambiguous: manual
    expect(face('Destroy up to three target artifacts. Mill three cards. For each artifact put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.', 'Sorcery') === 'full').toBe(false);
  });
  it('actions/announce-cond.ts, parser/holes/cond.ts, render/cond.ts (CR 201.2, 602.5b): "three or more lands with the same name" is the most lands you control that share a name, read as an ability is activated; of an opponent, or "as that land", it is not read', () => {
    expect(face('{2}, {T}: Draw a card. Activate only if you control three or more lands with the same name.') === 'full').toBe(true);
    expect(face('{2}, {T}: Draw a card. Activate only if an opponent controls three or more lands with the same name.') === 'full').toBe(false);
    expect(face('{2}, {T}: Draw a card. Activate only if you control three or more lands with the same name as target land.') === 'full').toBe(false);
  });
  it('effects/eval.ts, model/cap-walk.ts (CR 903.8): the commander casts of the spell the mana was spent on exist only in that rider', () => {
    expect(face('{T}: Add {C}. When you spend this mana to cast your commander, scry X, where X is the number of times it\'s been cast from the command zone this game.') === 'full').toBe(true);
    expect(face('{T}: Add {C}. When you spend this mana to cast a creature spell, scry X, where X is the number of times it\'s been cast from the command zone this game.') === 'full').toBe(false);
  });
});
