/**
 * Commander lane mana (second pass), round edh-d-31 (code edhd31, over the EDHREC top 20,000): the template data of parser/templates/zz-cloud/edh-d-31.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-31-scenarios.test.ts.
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
import edhD31 from '../../../src/parser/templates/zz-cloud/edh-d-31.json';
import review from '../../m5/golden/cards/edh-d-31-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD31 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd31.mana.chooseColorOf.one': ['Meteor Crater', 'Corrupted Grafstone'],
  'eff.edhd31.nextCast.entersWith.it.additional': ['Chocobo Camp'],
  'eff.edhd31.nextCast.drawGainHalfX': ['Brass Infiniscope'],
  'eff.edhd31.nextCast.entersWith.that.nAdditional': ['Yuna, Grand Summoner'], // promoted by edh-next-84 (the card is full there: its trigger's "that number of" reading)
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-31 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-31.json, path order: after edh-next-5.json, before edh-next-6.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-31.json');
    expect(files.indexOf('zz-cloud/edh-d-31.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd31.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd31\./);
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

describe('edh-d-31 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-31 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-31 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
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

describe.skipIf(index === null)('edh-d-31 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-31 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-d-31 renderer, lowering, parser and engine changes (one test each)', () => {
  const land = (text: string) => parseCard(card('Example Land', 'Land', text), OPTS).faces[0]!;
  const clazz = (text: string) => parseCard(card('Example Class', 'Enchantment — Class', text), OPTS).faces[0]!;
  it('parser/lower/ability.ts#joinChooseColor, render/steps-cards.ts (CR 105.2, 106.5, 605.1a): "Choose a color of <objects>. Add one mana of that color." is one mana ability; other counts and other sentences between are not read', () => {
    expect(fullyAutomated(land('{T}: Choose a color of a permanent you control. Add one mana of that color.'))).toBe(true);
    expect(fullyAutomated(land('{T}: Choose a color of a card in your graveyard. Add one mana of that color.'))).toBe(true);
    expect(fullyAutomated(land('{T}: Choose a color of a permanent you control. Add two mana of that color.'))).toBe(false);
    expect(fullyAutomated(land('{T}: Choose a color of a permanent you control. Draw a card. Add one mana of that color.'))).toBe(false);
    expect(fullyAutomated(land('{T}: Choose a color of a permanent you control. Add one mana of any color.'))).toBe(false);
  });
  it('render/steps-lasting.ts#spellEntersWith, model/next-cast-rider.ts (CR 603.7a, 614.1c, 605.3b): the next-spell counters rider is part of a mana ability, for a creature spell of a subtype too; "it" for the spell; nothing else is let through a mana ability', () => {
    expect(fullyAutomated(land('{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it.'))).toBe(true);
    // a further instruction that is not mana, with a target: the whole ability is no longer a mana ability (CR 605.1a), it uses the stack
    const withTarget = land('{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it. Destroy target creature.');
    expect(withTarget.abilities.some((a) => a.kind === 'activated' && a.isMana === true)).toBe(false);
    expect(land('{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it.').abilities.some((a) => a.kind === 'activated' && a.isMana === true)).toBe(true);
    expect(fullyAutomated(land('{T}: Add {G}. When you next cast an artifact spell this turn, it enters with an additional +1/+1 counter on it.'))).toBe(false);
    expect(fullyAutomated(land('{T}: Add {G}. When you next cast a Bird creature spell this turn, target creature enters with an additional +1/+1 counter on it.'))).toBe(false);
  });
  it('effects/eval.ts#spellX, render/steps-life.ts (CR 107.3e, 107.1a, 119.1): "half X life, rounded down" is read where a cast event names the spell (the X of that spell); "half X life, rounded up", a spell\'s X outside a cast and another player are not', () => {
    expect(fullyAutomated(land('{T}: Add {C}{C}. When you next cast a spell with {X} in its mana cost this turn, you draw a card and gain half X life, rounded down.'))).toBe(true);
    expect(fullyAutomated(land('{T}: Add {C}{C}. When you next cast a spell with {X} in its mana cost this turn, each opponent draws a card and gains half X life, rounded down.'))).toBe(false);
    expect(fullyAutomated(land('{T}: Add {C}{C}. Draw a card and gain half X life, rounded down.'))).toBe(false);
  });
  it('parser/holes/spend.ts, render/steps-cards.ts, statics/levels.ts (CR 716.2a, 106.6): "Spend this mana only to ... gain a Class level" restricts the mana to the level-up ability of a Class; "gain Class levels" and other words are not read', () => {
    expect(fullyAutomated(clazz('{T}: Add {U} or {R}. Spend this mana only to cast an instant or sorcery spell or to gain a Class level.'))).toBe(true);
    expect(fullyAutomated(land('{T}: Add {U}. Spend this mana only to gain a Class level.'))).toBe(true);
    expect(fullyAutomated(land('{T}: Add {U}. Spend this mana only to gain a level.'))).toBe(false);
    expect(fullyAutomated(land('{T}: Add {U}. Spend this mana only to gain Class levels.'))).toBe(false);
    expect(fullyAutomated(land('{T}: Add {U}. Spend this mana only to cast a creature spell and gain a Class level.'))).toBe(false);
  });
});
