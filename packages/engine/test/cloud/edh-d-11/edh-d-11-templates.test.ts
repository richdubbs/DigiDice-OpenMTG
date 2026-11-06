/**
 * Commander coordinator D, round edh-d-11 (EDHREC ranks 11,251-12,500, third pass): the template data of parser/templates/zz-cloud/edh-d-11.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-11-scenarios.test.ts.
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
import edhD11 from '../../../src/parser/templates/zz-cloud/edh-d-11.json';
import review from '../../m5/golden/cards/edh-d-11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD11 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 15,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'trg.edhd11.players.sacrifice.wholeBatch': ['Evin, Waterdeep Opportunist'],
  'eff.edhd11.put.eachPermanentCardExiledWith.underOwnersControl': ['Trove Warden'],
  'eff.edhd11.selfDamage.numberCountersOnIt': ['Herald of Ilharg'],
  'eff.edhd11.player.mayPut.onto.battlefield': ['Gate to the Aether'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-11.json, path order: after edh-d-1.json, before edh-d-2.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-11.json');
    expect(files.indexOf('zz-cloud/edh-d-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd11.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd11\./);
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

describe('edh-d-11 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-11 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-d-11 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/holes/filter.ts#headAt, render/np.ts#buildAnyOfPlain (CR 205.4a, 205.3m): "snow and Zombie creatures" is the creatures that are snow or Zombies; a singular, a second subtype or a non-supertype first word is not that reading', () => {
    expect(fullyAutomated(creature('Other snow and Zombie creatures you control get +1/+1.'))).toBe(true);
    expect(fullyAutomated(creature('Other legendary and Elf creatures you control get +1/+1.'))).toBe(true);
    expect(fullyAutomated(creature('Target snow and Zombie creature gets +1/+1 until end of turn.'))).toBe(false);
    expect(fullyAutomated(creature('Other snow and Zombie and Elf creatures you control get +1/+1.'))).toBe(false);
    expect(fullyAutomated(creature('Other blorfty and Zombie creatures you control get +1/+1.'))).toBe(false);
  });
  it('parser/holes/misc.ts#qualityAt, statics/mods.ts#withChosenQualities, rules/protection.ts (CR 702.16j-k, 607.2d): "protection from the chosen player" needs the face\'s one "choose a player" as it enters; without it, or with the choice made by another ability, it is manual', () => {
    expect(fullyAutomated(creature('As this creature enters, choose a player.\nThis creature has protection from the chosen player.'))).toBe(true);
    expect(fullyAutomated(creature('This creature has protection from the chosen player.'))).toBe(false);
    expect(fullyAutomated(creature('As this creature enters, choose a color.\nThis creature has protection from the chosen player.'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/qty.ts (CR 120.2, 701.50a): "the amount of damage it dealt to that player" is the damage of the trigger\'s event; another count of damage is not', () => {
    expect(fullyAutomated(creature('Whenever this creature deals combat damage to a player, it connives X, where X is the amount of damage it dealt to that player.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature deals combat damage to a player, it connives X, where X is the amount of damage it dealt to that creature.'))).toBe(false);
  });
  it('parser/holes/event.ts, render/evt.ts (CR 603.2c, 701.21a): "one or more players sacrifice one or more creatures" triggers once for the whole batch; a single sacrifice or an opponents-only subject is another reading', () => {
    expect(fullyAutomated(creature('Whenever one or more players sacrifice one or more creatures, draw a card.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Whenever one or more players sacrifice a creature, draw a card.', 'Enchantment'))).toBe(false);
  });
  it('templates made stable (design 6.9 deviation, docs/CARD_AUTOMATION.md section 5): eff.damage.foreach and eff.m6.cloak.top', () => {
    for (const id of ['eff.damage.foreach', 'eff.m6.cloak.top']) expect(TEMPLATE_SET.find((t) => t.id === id)?.status, id).toBe('stable');
    expect(fullyAutomated(creature('When this creature enters, it deals 1 damage to target opponent for each creature card in your graveyard.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, it deals 1 damage to target opponent for each blorfty card in your graveyard.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, cloak the top card of your library.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, cloak the top card of target library.'))).toBe(false);
  });
});
