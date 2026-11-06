/**
 * Commander top-rank second pass 3, edh-next-95: the template data of parser/templates/zz-cloud/edh-next-95.json ("that player adds {C} for each artifact they control", Blinkmoth Urn; "whenever <event> for the first time during each of your turns", Tale of Katara and Toph;
 * "put any number of ... cards from among them onto the battlefield" after an exile or a mill, Xenagos and Rampant Frogantua; a suffix "if" on a tapped token copy, Scouring Swarm;
 * "the tokens are goaded for the rest of the game", Life of the Party) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any
 * word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-next-95-scenarios.test.ts. CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext95 from '../../../src/parser/templates/zz-cloud/edh-next-95.json';
import review from '../../m5/golden/cards/edh-next-95-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext95 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn95.player.adds.forEach': ['Blinkmoth Urn'],
  'trg.edhn95.event.firstEachOfYourTurns': ['Tale of Katara and Toph'],
  'eff.edhn95.put.anyNumber.fromExiledTop.battlefield': ['Xenagos, the Reveler'],
  'eff.edhn95.put.anyNumber.fromMilled.battlefield.tapped': ['Rampant Frogantua'],
  'eff.edhn95.copy.token.tapped.ifCond': ['Scouring Swarm'],
  'eff.edhn95.goaded.plural.restOfGame': ['Life of the Party'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>(['eff.edhn95.put.anyNumber.fromExiledTop.battlefield', 'eff.edhn95.put.anyNumber.fromMilled.battlefield.tapped']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-95 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-95.json, path order: after edh-next-9, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-95.json');
    expect(files.indexOf('zz-cloud/edh-next-95.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-9.json'));
    expect(files.indexOf('zz-cloud/edh-next-95.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn95.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn95\./);
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

describe('edh-next-95 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-95 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-95 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-next-95 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-95 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-95 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/edhn95.ts, parser/lower/trigger-zone.ts, parser/lower/activation.ts, render/cond.ts (CR 702.62b, 113.6k, 113.6m, 603.4; Deep-Sea Kraken, Greater Gargadon): "if this card is suspended" is a card in exile with suspend and a time counter, and the ability works from exile', () => {
    const t = 'Suspend 3--{1}{U}\nWhenever an opponent casts a spell, if this card is suspended, remove a time counter from it.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"zone":["exile"]');
    expect(fullyAutomated(creature(t.replace('is suspended', 'is exiled')))).toBe(true); // (the older reading of the exiled card, edh-combat-7, unchanged)
    expect(fullyAutomated(creature(t.replace('this card is suspended', 'it is suspended')))).toBe(false);
    expect(fullyAutomated(creature('Suspend 3--{1}{U}\nSacrifice a land: Remove a time counter from this card. Activate only if this card is suspended.'))).toBe(true);
    // a cast of the card itself keeps the older rule: it functions on the stack, never from exile
    expect(fullyAutomated(creature('Suspend 3--{1}{U}\nWhen you cast this spell, if this card is suspended, draw a card.'))).toBe(false);
  });
  it('parser/holes/edhn95.ts, effects/eval.ts, statics/match.ts, render/qty.ts (CR 104.2a, 800.4a; Rampant Frogantua): "for each player who has lost the game" is the players with hasLost, read by a static ability too', () => {
    expect(fullyAutomated(creature('This creature gets +10/+10 for each player who has lost the game.'))).toBe(true);
    expect(JSON.stringify(creature('This creature gets +10/+10 for each player who has lost the game.').abilities)).toContain('"q":"playersLost"');
    expect(fullyAutomated(creature('When ~ enters, draw cards equal to the number of players who have lost the game.'))).toBe(true);
    expect(fullyAutomated(creature('This creature gets +10/+10 for each player who has won the game.'))).toBe(false);
    expect(fullyAutomated(creature('This creature gets +10/+10 for each player who has lost.'))).toBe(false);
  });
  it('parser/holes/p2iv1.ts (CR 404.1, 603.4; Scouring Swarm): "seven or more land cards are in your graveyard" after an effect, with the zone it states', () => {
    expect(fullyAutomated(spell('Create a 2/2 green Wolf creature token if seven or more land cards are in your graveyard.'))).toBe(true);
    expect(fullyAutomated(spell('Create a 2/2 green Wolf creature token if seven or more land cards are in a graveyard.'))).toBe(false);
    expect(fullyAutomated(spell('Create a 2/2 green Wolf creature token if seven or more land cards are in your hand.'))).toBe(false);
  });
  it('parser/holes/object.ts, parser/lower/mentions.ts, render/steps-zones.ts (CR 111.1, 608.2c; Life of the Party): "the tokens" are the tokens an earlier step made, several when each player of a group makes one', () => {
    const t = (who: string) => `When ~ enters, ${who} creates a 1/1 white Soldier creature token. The tokens gain haste until end of turn.`;
    expect(fullyAutomated(creature(t('each opponent')))).toBe(true);
    expect(fullyAutomated(creature(t('target opponent')))).toBe(false); // one token: "the tokens" names no group
    expect(fullyAutomated(creature('When ~ enters, create two 1/1 white Soldier creature tokens. The tokens gain haste until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, create a 1/1 white Soldier creature token. The tokens gain haste until end of turn.'))).toBe(false);
  });
});
