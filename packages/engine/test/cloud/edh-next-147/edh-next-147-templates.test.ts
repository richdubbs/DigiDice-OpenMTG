/**
 * Must-finish round edh-next-147 (group "other", EDHREC 5,001-10,000): the template data of parser/templates/zz-cloud/edh-next-147.json (see the file) and the round's parser,
 * lowering, engine and renderer changes, tested at the end of this file and in edh-next-147-scenarios.test.ts.
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
import edhNext147 from '../../../src/parser/templates/zz-cloud/edh-next-147.json';
import review147 from '../../m5/golden/cards/edh-next-147-review.json';
import review60 from '../../m5/golden/cards/edh-next-60-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext147 as Template[];
const MECH_COUNT = 7;
/** The round's golden entries: its own file, and Multiclass Baldric in edh-next-60's (the evidence of that round's prevention template lives there, design 6.9). */
const review = [...(review147 as unknown[]), ...(review60 as { card: string }[]).filter((g) => g.card === 'Multiclass Baldric')];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (each wording is printed on that one card)
  'eff.edhn147.startingWithNextOpp.eachPlayerChooses': ['Sadistic Shell Game'],
  'eff.edhn147.putNameSticker': ['_____ Goblin'],
  'eff.edhn147.mana.forEachUniqueVowel': ['_____ Goblin'],
  'sta.edhn147.attached.has.ifEach.four': ['Multiclass Baldric'],
  'sta.edhn147.allAndAll.areCreaturesAndLands.inAddition': ['Life and Limb'],
  'eff.edhn147.eachPlayer.chooseParty.sacrificeRest': ['Stick Together'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /equipped creature/i.test(text) ? card('Example Gear', 'Artifact — Equipment', text) :
  /enchanted (creature|land|artifact|permanent|enchantment)/i.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-147 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-147.json, path order: after edh-next-14, before edh-next-15) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-147.json');
    expect(files.indexOf('zz-cloud/edh-next-147.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-147.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn147.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn147\./);
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
    expect(MECH.filter((x) => x.status === 'experimental').map((x) => x.id)).toEqual(['sta.edhn147.attached.has.ifEach.three']); // no card prints the three-grant wording yet
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

describe('edh-next-147 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bnext opponent\b/, 'chosen opponent'], [/\bchooses an?\b/, 'chooses two'], [/\bname sticker\b/, 'art sticker'], [/\bunique vowel\b/, 'consonant'],
    [/\bif you control\b/, 'if an opponent controls'], [/\bin addition to their other types\b/, 'instead of their other types'], [/\ba party\b/, 'a creature'],
    [/\bthe rest\b/, 'the chosen ones'], [/\blands\b/, 'artifacts'], [/\bcreatures and\b/, 'artifacts and'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-147 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-147 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-147 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-147 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-next-147 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const relic = (text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
  it('parser/lower/activation.ts#wholeAlternatives (CR 601.2b, 602.2b): "{3}, {T} or {R}, {T}" is a choice between two whole costs; a one-part choice keeps its part-level reading', () => {
    const f = relic('{3}, {T} or {R}, {T}: Example Relic deals 1 damage to any target.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"kind":"oneOf","options":[{"mana":[{"kind":"generic","amount":3}],"tap":true},{"mana":[{"kind":"colored","color":"R"}],"tap":true}]');
    expect(JSON.stringify(relic('{1}, {T}, Sacrifice an artifact or discard a card: Draw a card.').abilities)).not.toContain('"options":[{"mana"');
    expect(JSON.stringify(relic('{3}, {T} or {R}: Draw a card.').abilities), 'one side of one part only: no choice between whole costs').toContain('"kind":"manual"');
  });
  it('parser/holes/player.ts + render/refs.ts + render/stat.ts (CR 120.3, 608.2c): "players dealt damage this way" after a damage step; without one it is not read', () => {
    expect(fullyAutomated(spell("Example Plan deals 2 damage to each opponent. Players dealt damage this way can't cast creature spells this turn.", 'Instant'))).toBe(true);
    expect(fullyAutomated(spell("Players dealt damage this way can't cast creature spells this turn.", 'Instant'))).toBe(false);
  });
  it('parser/holes/event.ts + render/evt.ts (CR 601.2i, 603.2; family spell-is-cast): "an artifact spell is cast" is a cast by any player; a creature that "is cast" is not a spell', () => {
    const f = relic('Whenever an artifact spell is cast, you gain 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"on":[{"ev":"cast","player":"any","spell":{"types":["Artifact"]}}]');
    expect(fullyAutomated(relic('Whenever an artifact is cast, you gain 1 life.'))).toBe(false);
  });
  it('parser/holes/qty.ts#spellsCastBefore + render/qty.ts (CR 601.2i, 603.4): "the number of creature spells cast before that spell this turn" (any player, before the triggering cast)', () => {
    const f = relic('Whenever a creature spell is cast, you gain life equal to the number of creature spells cast before that spell this turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"happenedCount","event":{"ev":"cast","player":"any","spell":{"types":["Creature"]}},"scope":"turn","beforeEvent":true');
    expect(fullyAutomated(relic('Whenever a creature spell is cast, you gain life equal to the number of creature spells cast before that spell this game.'))).toBe(false);
  });
  it('parser/holes/cost.ts + render/costs.ts (CR 118.3, 701.21a): "sacrifice any number of creatures with total power N or greater" as an activation cost and a payment; a fixed count is not read so', () => {
    expect(fullyAutomated(relic('Sacrifice any number of creatures with total power 6 or greater: Draw two cards.'))).toBe(true);
    expect(fullyAutomated(relic('{1}: Example Relic deals 2 damage to any target unless you sacrifice any number of creatures with total power 4 or greater.'))).toBe(true);
    expect(JSON.stringify(relic('Sacrifice two creatures with total power 6 or greater: Draw two cards.').abilities)).toContain('"kind":"manual"');
  });
  it('render/abil.ts#perConditionGrants (CR 611.3a): two grants each under its own condition; a grant without a condition beside them is not this wording', () => {
    const gear = (text: string) => parseCard(card('Example Gear', 'Artifact — Equipment', `${text}\nEquip {1}`), OPTS).faces[0]!;
    expect(fullyAutomated(gear('Equipped creature has vigilance if you control a Knight, reach if you control an Elf, trample if you control a Beast, and menace if you control a Goblin.'))).toBe(true);
    expect(fullyAutomated(gear('Equipped creature has vigilance if you control a Knight, reach if you control an Elf, trample if you control a Beast, and menace.'))).toBe(false);
  });
  it('model/cap-walk.ts (CR 611.3a): a static ability with a continuous effect of its own condition needs feature:static.effectWhen; the engine registers it', () => {
    expect(ENGINE_CAPABILITIES.has('feature:static.effectWhen')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:static.effectWhen.other')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('op:sacrificeChoice.keepParty')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:putSticker')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('cost:sacrifice.totalPower')).toBe(true);
  });
});
