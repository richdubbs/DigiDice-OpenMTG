/**
 * Commander lane edh-cast, round edh-cast-14: the template data of parser/templates/zz-cloud/edh-cast-14.json ("Copy that card three times" and its free cast, Mnemonic Deluge; "If ~ was cast from a graveyard,
 * you may play cards this way without paying their mana costs", Ignite the Future; "If C, rather than pay ~'s mana cost, you may have an opponent gain 3 life", Invigorate; "copy that spell for each other
 * creature you control that the spell could target. Each copy targets a different one of those creatures", Zada; "you may cast any number of spells from your hand without paying their mana costs",
 * Jin-Gitaxias // The Great Synthesis) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-14-scenarios.test.ts. CR cites checked against the
 * Comprehensive Rules text of 2026-09-25 unless the record names them.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast14 from '../../../src/parser/templates/zz-cloud/edh-cast-14.json';
import review from '../../m5/golden/cards/edh-cast-14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast14 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhc14.copy.nTimes': ['Mnemonic Deluge'],
  'rid.edhc14.if.playThisWay.free': ['Ignite the Future'],
  'cm.edhc14.alternative.if.ratherFirst': ['Invigorate'],
  'eff.edhc14.copy.forEach.couldTarget': ['Zada, Hedron Grinder'],
  'rid.edhc14.eachCopyTargetsDifferent': ['Zada, Hedron Grinder'],
  'eff.edhc14.cast.anyNumber.free.fromYourHand': ['Jin-Gitaxias // The Great Synthesis'],
  'eff.edhc14.cast.fromGraveyard.free': ['Sword of Once and Future'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the Invigorate-style one is an instant; the others are abilities of a creature (static, triggered). */
const SPELL = new Set<string>(['eff.edhc14.copy.nTimes', 'rid.edhc14.if.playThisWay.free', 'eff.edhc14.cast.anyNumber.free.fromYourHand', 'eff.edhc14.copy.forEach.couldTarget', 'rid.edhc14.eachCopyTargetsDifferent', 'eff.edhc14.cast.fromGraveyard.free_']);
const parsedWith = (t: Template, text: string) =>
  (t.id === 'cm.edhc14.alternative.if.ratherFirst'
    ? parseCard(card('Example Plan', 'Instant', text), OPTS)
    : SPELL.has(t.id)
      ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
      : parseCard(card('Example Relic', 'Artifact Creature — Goblin', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-14.json, path order: after edh-cast-13, before edh-cast-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-14.json');
    expect(files.indexOf('zz-cloud/edh-cast-14.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-13.json'));
    expect(files.indexOf('zz-cloud/edh-cast-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc14.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhc14\./);
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

describe('edh-cast-14 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-cast-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-14 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-14 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Goblin', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/steps-zones.ts (CR 707.10c, 707.12; Mnemonic Deluge): a fixed number of copies of one exiled card, each cast or not without paying: three times, not once, not as a group', () => {
    const base = 'Exile target instant card from your graveyard. Copy that card three times. You may cast the copies without paying their mana costs.';
    expect(fullyAutomated(face(base))).toBe(true);
    expect(JSON.stringify(face(base).abilities)).toContain('"count":3');
    expect(fullyAutomated(face(base.replace('three times', 'twice')))).toBe(true); // two copies are a count of 2
    expect(fullyAutomated(face(base.replace('You may cast the copies without paying their mana costs', 'You may cast the copies')))).toBe(false);
    expect(fullyAutomated(face(base.replace('Copy that card three times', 'Copy that card three times, then copy it'))) ).toBe(false);
  });
  it('render/steps-flow.ts (CR 118.9, 608.2c; Ignite the Future): "If C, you may play cards this way without paying their mana costs" follows a play permission and keeps its duration; alone it is not read', () => {
    const base = 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards. If ~ was cast from a graveyard, you may play cards this way without paying their mana costs.';
    const f = face(base);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"costChange":{"kind":"set","cost":{}}');
    expect(fullyAutomated(face('If ~ was cast from a graveyard, you may play cards this way without paying their mana costs.'))).toBe(false);
    expect(fullyAutomated(face(base.replace('If ~ was cast from a graveyard', 'If ~ was cast from your hand')))).toBe(true); // any condition of the spell's own cast (CR 601.2a, 603.4): the condition is not part of the reading
    expect(fullyAutomated(face(base.replace('play those cards', 'cast those cards')))).toBe(false);
  });
  it('rules/cost.ts, rules/pay-parts.ts, parser/holes/cost.ts, render/costs.ts (CR 118.1, 119.3, 119.7; Invigorate): "have an opponent gain N life" is a cost part with a number; X or "each opponent" is not read', () => {
    const base = "If you control a Forest, rather than pay ~'s mana cost, you may have an opponent gain 3 life.";
    const f = face(base, 'Instant');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"kind":"opponentGainsLife","amount":3');
    expect(ENGINE_CAPABILITIES.has('cost:opponentGainsLife')).toBe(true);
    expect(fullyAutomated(face(base.replace('an opponent', 'each opponent'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(base.replace('an opponent', 'you'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(base.replace('3 life', 'X life'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(base.replace('If you control a Forest, rather', 'Rather'), 'Instant'))).toBe(false);
  });
  it('effects/handlers/tokens-copy.ts#retargetCandidates, render/steps-zones.ts (CR 707.10c, 115.1; Zada): both sentences are needed; the group is a description of permanents you control', () => {
    const base = 'Whenever you cast a sorcery spell that targets only ~, copy that spell for each other artifact you control that the spell could target. Each copy targets a different one of those artifacts.';
    expect(fullyAutomated(creature(base))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:copy.retargetEach')).toBe(true);
    expect(fullyAutomated(creature(base.split('. ')[0] + '.'))).toBe(false);
    expect(fullyAutomated(creature(base.replace('the spell could target', 'it could target')))).toBe(false);
    expect(fullyAutomated(creature(base.replace('Each copy targets a different one of those artifacts', 'Each copy targets the same one of those artifacts')))).toBe(false);
  });
  it('render/steps-zones.ts (CR 608.2d, 608.2g; Jin-Gitaxias): "any number of spells from your hand" is one choice; "a spell", your graveyard or "up to" are not read by it', () => {
    const base = 'You may cast any number of spells from your hand without paying their mana costs.';
    expect(fullyAutomated(face(base))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:cast.select')).toBe(true);
    expect(fullyAutomated(face(base.replace('your hand', 'your graveyard')))).toBe(false);
    expect(fullyAutomated(face(base.replace('any number of spells', 'up to two spells')))).toBe(false);
    expect(fullyAutomated(face(base.replace('their mana costs', 'their mana costs, then you lose 2 life')))).toBe(false);
  });
  it('render/fold.ts#castFromOwnZone (CR 608.2g, 118.9, 305.9; Sword of Once and Future): one spell of a description from your graveyard cast free, with the exile-instead rider; from another graveyard, two spells or paying are other templates or not read', () => {
    const base = 'Draw a card. Then you may cast an instant or sorcery spell with mana value 2 or less from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.';
    expect(fullyAutomated(face(base))).toBe(true);
    expect(JSON.stringify(face(base).abilities)).toContain('"free":true');
    expect(fullyAutomated(face(base.replace('your graveyard', "an opponent's graveyard")))).toBe(false);
    expect(fullyAutomated(face(base.replace('an instant or sorcery spell', 'two instant or sorcery spells')))).toBe(false);
    expect(fullyAutomated(face(base.replace(' without paying its mana cost', '')))).toBe(true); // the paid wording of eff.stdrw7.cast.fromGraveyard (unchanged)
  });
});
