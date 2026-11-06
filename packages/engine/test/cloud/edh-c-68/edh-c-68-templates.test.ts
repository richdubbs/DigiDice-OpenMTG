/**
 * Commander lane edh-c, round edh-c-68 (EDHREC ranks 26,001-26,500, second pass): the template data of parser/templates/zz-cloud/edh-c-68.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-68-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC68 from '../../../src/parser/templates/zz-cloud/edh-c-68.json';
import review from '../../m5/golden/cards/edh-c-68-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC68 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'eff.edhv68.player.discardN.drawAsManyDiscarded': ['Forget'],
  'eff.edhv68.untapstep.whileOnBattlefield': ['Somnophore'],
  'eff.edhv68.put.target.attachedToSelf': ['Iridescent Drake'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-68 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-68.json, path order: after edh-c-6, before edh-c-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-68.json');
    expect(files.indexOf('zz-cloud/edh-c-68.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-6.json'));
    expect(files.indexOf('zz-cloud/edh-c-68.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv68.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm)\.edhv68\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-c-68 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElemental\b/, 'Elementals'], [/\bhaste\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bloses\b/, 'gains'], [/\bcounters\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-68 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-68 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-68 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-68 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-68 renderer and lowering changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Warrior') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('render/steps-life.ts (CR 601.2d, 107.3; family divided-as-you-cast): a count divided as the spell is cast says "as you cast this spell"; "as you resolve" is not the same', () => {
    expect(fullyAutomated(spell('~ deals X damage divided as you choose among any number of target creatures, where X is the number of creatures on the battlefield as you cast this spell.'))).toBe(true);
    expect(fullyAutomated(spell('~ deals X damage divided as you choose among any number of target creatures, where X is the number of creatures on the battlefield as you resolve this spell.'))).toBe(false);
  });
  it('render/steps-util.ts (CR 107.3, 119.3; family gain-x-plus-where): "You gain X plus 1 life, where X is ..."; X plus a second number, or X minus 1, is not the same', () => {
    expect(fullyAutomated(spell('You gain X plus 1 life, where X is the number of green creatures on the battlefield.'))).toBe(true);
    expect(jsonKey(spell('You gain X plus 1 life, where X is the number of green creatures on the battlefield.').abilities)).not.toBe(jsonKey(spell('You gain X plus 2 life, where X is the number of green creatures on the battlefield.').abilities));
    expect(fullyAutomated(spell('You gain X minus 1 life, where X is the number of green creatures on the battlefield.'))).toBe(false);
  });
  it('parser/holes/cond.ts, render/cond.ts (CR 102.3; family team-controls): "your team controls another Warrior" is "you control another Warrior"; an opponent\'s team is not read', () => {
    const a = creature('Whenever this creature attacks, if your team controls another Warrior, you gain 1 life.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(creature('Whenever this creature attacks, if you control another Warrior, you gain 1 life.').abilities));
    expect(fullyAutomated(creature("Whenever this creature attacks, if your opponent's team controls another Warrior, you gain 1 life."))).toBe(false);
  });
  it('parser/holes/event.ts, render/evt.ts (CR 603.2; family subject-list-one-article): three or more descriptions with the article before the first; two stay as they were', () => {
    const e = (list: string) => creature(`Whenever ${list} becomes tapped, you gain 1 life.`, 'Enchantment');
    expect(fullyAutomated(e('a Swamp, Mountain, black permanent, or red permanent'))).toBe(true);
    expect(fullyAutomated(e('a Swamp, black permanent, or red permanent'))).toBe(true);
    expect(fullyAutomated(e('a Swamp, Mountain, or Forest'))).toBe(true); // one list of subtypes, read as before
    expect(fullyAutomated(e('a Swamp, Mountain, black permanent, red permanent'))).toBe(false); // no closing "or"
    expect(fullyAutomated(e('Swamp, Mountain, or black permanent'))).toBe(false); // no article before the first
  });
  it('render/evt.ts (CR 120.1, 120.3; family noncreature-source-deals): "a noncreature source you control deals damage" is a source that is not a creature; a source an opponent controls is not read', () => {
    const a = creature('Whenever a noncreature source you control deals damage, you gain that much life.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).not.toBe(jsonKey(creature('Whenever a creature source you control deals damage, you gain that much life.').abilities));
  });
  it('model/lint-roles.ts, triggers/normalize.ts, render/refs.ts (CR 508.1b, 509.3c): the defender of a blocked attacker is named only by "the player or planeswalker it\'s attacking"; "that player" after a block names nobody', () => {
    expect(fullyAutomated(creature("Whenever this creature becomes blocked, it deals 1 damage to the player or planeswalker it's attacking."))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature becomes blocked, it deals 1 damage to that player.'))).toBe(false);
  });
  it('render/steps-util.ts (CR 303.4f; family attached-after-control): "under your control attached to ~"; the other order is the model\'s own wording', () => {
    expect(fullyAutomated(creature('When this creature enters, put target Aura card from a graveyard onto the battlefield under your control attached to this creature.'))).toBe(true);
  });
});
