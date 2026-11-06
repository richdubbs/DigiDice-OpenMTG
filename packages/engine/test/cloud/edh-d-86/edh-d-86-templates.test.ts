/**
 * Commander coordinator D, round edh-d-86 (EDHREC band 5,001-10,000, group combat): the template data of parser/templates/zz-cloud/edh-d-86.json and the round's parser, lowering and
 * renderer changes (hole readings, anaphora, folds), tested at the end of this file and played in edh-d-86-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked
 * against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD86 from '../../../src/parser/templates/zz-cloud/edh-d-86.json';
import review from '../../m5/golden/cards/edh-d-86-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD86 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one card, with
 * their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhd86.once.playLandOrPermanent.among.fromLibrary': ['Kagha, Shadow Archdruid'],
  'sta.edhd86.spells.cast.have.freerunning': ['Ezio Auditore da Firenze'],
  'eff.edhd86.damageEqual.unlessControllerHasThatMuch': ['Craig Boone, Novac Guard'],
  'eff.edhd86.choose.creature.any': ['Azra Oddsmaker'],
  'rid.edhd86.foretold.costIsManaCostLess': ['Ethereal Valkyrie'],
  'rep.edhd86.lifeReducedToZero.insteadTransformSetLife': ['Enduring Angel // Angelic Enforcer'],
  'eff.edhd86.put.bf.thenShuffleRest': ['Aspiring Champion'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or a triggered / activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || t.kind === 'rider' || text.includes(':') || /^(When|Whenever|At the beginning|Once)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const compiled = (type: string, text: string) => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;

describe('edh-d-86 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-86.json, path order: after edh-d-8, before edh-d-9) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-86.json');
    expect(files.indexOf('zz-cloud/edh-d-86.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-8.json'));
    expect(files.indexOf('zz-cloud/edh-d-86.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd86.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhd86\./);
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

describe('edh-d-86 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [[/\blibrary this turn\b/, 'hand this turn'], [/\bfreerunning\b/, 'prowl'], [/\bthat much\b/, 'twice that much'], [/\breduced by \{2\}/, 'reduced by {1}'], [/\bshuffle the rest\b/, 'put the rest']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-86 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    }, 120_000);
  }
});

describe('edh-d-86 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

describe('edh-d-86: the hole readings, lowering and renderer changes (one test each)', () => {
  const steps = (f: ReturnType<typeof compiled>): string => JSON.stringify(f.abilities);
  it('holes/player.ts#dealtDamageBy (CR 120.1, 510.2): "each opponent dealt combat damage this game by a creature named X" is eachWho of the game history; "this year" is not read', () => {
    const f = compiled('Creature — Horror', 'At the beginning of your end step, each opponent dealt combat damage this game by a creature named Example Relic loses 2 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(steps(f)).toContain('"who":{"ref":"eachWho","who":"opponent","did":{"ev":"damage","source":{"types":["Creature"],"name":"Example Relic"},"combat":true},"scope":"game"}');
    expect(fullyAutomated(compiled('Creature — Horror', 'At the beginning of your end step, each opponent dealt combat damage this year by a creature named Example Relic loses 2 life.'))).toBe(false);
    expect(fullyAutomated(compiled('Creature — Horror', 'At the beginning of your end step, each opponent dealt combat damage this game by a creature you control loses 2 life.'))).toBe(false); // a controller of its own: not read
  });
  it('holes/filter.ts + holes/event.ts (CR 205.2a, 305.1, 601.2a): "a card with two or more card types" (minCardTypes) and "you play a card with ..."; five card types is not a reading', () => {
    const f = compiled('Enchantment', 'Whenever you play a card with two or more card types, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(steps(f)).toContain('{"ev":"action","verb":"playLand","actor":"you","object":{"minCardTypes":2}},{"ev":"cast","player":"you","spell":{"isCard":true,"minCardTypes":2}}');
    expect(fullyAutomated(compiled('Enchantment', 'Whenever you cast a spell with three or more card types, draw a card.'))).toBe(true);
    expect(fullyAutomated(compiled('Enchantment', 'Whenever you cast a spell with five or more card types, draw a card.'))).toBe(false);
  });
  it('holes/cond.ts (CR 608.2c): "if that player has 10 or less life" compares the life of the player the anaphor names', () => {
    const f = compiled('Creature — Assassin', 'Whenever this creature deals combat damage to a player, you may draw a card if that player has 10 or less life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(steps(f)).toContain('{"cond":"compare","left":{"q":"life","of":{"ref":"event","role":"recipient"}},"op":"<=","right":10}');
  });
  it('lower/anaphora.ts (CR 608.2c, 614.15): an "instead" rider\'s condition never names what the replaced instruction makes: "the creature" is the creature that died', () => {
    const f = compiled('Creature — Satyr', 'Whenever a creature you control dies, create a 1/1 red Satyr creature token. If the creature had power 4 or greater, create two of those tokens instead.');
    expect(fullyAutomated(f)).toBe(true);
    expect(steps(f)).toContain('"cond":{"cond":"matches","object":{"ref":"event","role":"subject"},"filter":{"power":{"op":">=","value":4}}}');
  });
  it('render/steps-flow.ts#sentenceDone (CR 113.2c): a token with a quoted ability ends its sentence inside the quotation marks before an "instead" rider', () => {
    expect(fullyAutomated(compiled('Sorcery', 'Create a 1/1 red Satyr creature token with "This token can\'t block." If you control a Mountain, create two of those tokens instead.'))).toBe(true);
  });
  it('lower/scope.ts#eventMentions + render/refs.ts (CR 608.2c): in an attack trigger of another object, "that permanent" after a target is the target', () => {
    const f = compiled('Creature — Dragon', 'Whenever a Wizard you control attacks, tap target artifact an opponent controls. That artifact doesn\'t untap during its controller\'s next untap step.');
    expect(fullyAutomated(f)).toBe(true);
    expect(steps(f)).toContain('"subject":{"ref":"target","id":"t0"}');
  });
  it('render/steps-flow.ts#testedTarget (CR 608.2c): "If that creature is a Demon, it deals ..." after a bound object (the parser\'s std-r8 rule)', () => {
    const f = compiled('Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield, then shuffle the rest into your library. If that creature is a Horror, it deals damage equal to its power to each opponent.');
    expect(fullyAutomated(f)).toBe(true);
  });
  it('render/steps-flow.ts#unlessHas (CR 118.12a, 115.1): "up to one target creature unless that creature\'s controller has ~ deal N damage to them" with literal amounts too', () => {
    expect(fullyAutomated(compiled('Artifact Creature — Construct', '{T}: Example Relic deals 2 damage to up to one target creature unless that creature\'s controller has Example Relic deal 2 damage to them.'))).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-86 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-86 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
