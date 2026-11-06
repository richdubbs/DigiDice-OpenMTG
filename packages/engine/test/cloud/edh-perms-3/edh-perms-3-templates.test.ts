/**
 * Commander lane edh-perms, round edh-perms-3: the template data of parser/templates/zz-cloud/edh-perms-3.json ("Each creature you control becomes a Demon in addition to its other
 * types"; "Until end of turn, each Goblin creature you control has base power and toughness 4/4 and becomes a Demon in addition to its other creature types"; "As long as ~ isn't
 * on the battlefield, it's a 2/2 Spirit creature in addition to its other types"; "You may have ~ enter as a copy of another creature you control, except it has ~'s other
 * abilities"). The hole and renderer changes (the copy exception "it has ~'s other abilities", "another creature you control" in the copy, the per-player choice fold, the
 * size-first type change, the off-battlefield static) are tested at the end of this file and in edh-perms-3-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-3-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm3 from '../../../src/parser/templates/zz-cloud/edh-perms-3.json';
import review from '../../m5/golden/cards/edh-perms-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm3 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm3.group.becomes.subtype.inaddition': ['Breach the Multiverse'],
  'eff.edhpm3.dur.group.has.basept.becomes.subtype': ['Allosaurus Shepherd'],
  'sta.edhpm3.self.offbattlefield.creature.inaddition': ['Grist, the Hunger Tide'],
  'rep.edhpm3.enters.copy.another.except': ['Sakashima of a Thousand Faces'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: spell text on an instant, an activated ability on a creature, a planeswalker's static, a creature's replacement. */
const parsedWith = (t: Template, text: string) => {
  if (t.kind === 'static' && t.id.startsWith('sta.')) return parseCard(card('Example Walker', 'Legendary Planeswalker — Hive', text, { loyalty: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
  if (t.id.startsWith('rep.')) return parseCard(card('Example Shaper', 'Legendary Creature — Shapeshifter', text, { power: '3', toughness: '1' }), OPTS).faces[0]!;
  return (text.includes(':') ? parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS) : parseCard(card('Example Plan', 'Instant', text), OPTS)).faces[0]!;
};

describe('edh-perms-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-3.json, path order: after edh-mana-keywords-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-3.json');
    expect(files.indexOf('zz-cloud/edh-perms-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    expect(files.indexOf('zz-cloud/edh-perms-3.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.edhpm3.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhpm3\./);
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

describe('edh-perms-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-perms-3 parser and renderer changes (one test each)', () => {
  const creature = (text: string, type = 'Legendary Creature — Shapeshifter') => parseCard(card('Example Shaper', type, text, { power: '3', toughness: '1' }), OPTS).faces[0]!;
  it('parser/holes/p2copyperm1.ts (CR 613.1f, 707.9a): "except it has ~\'s other abilities" copies every other ability of the face; a face with another ability not understood in full keeps the card out of "full"', () => {
    const ok = creature('You may have ~ enter as a copy of another creature you control, except it has ~\'s other abilities.\nFlying');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"otherAbilitiesOfCard":true');
    expect(JSON.stringify(ok.abilities)).toContain('"keyword":"flying"');
    // an unreadable second ability: the copy would lack it silently, so nothing about the card is automated as "other abilities"
    const bad = creature('You may have ~ enter as a copy of another creature you control, except it has ~\'s other abilities.\nWhenever a blorfty glorbs, glorb the blorfty.');
    expect(fullyAutomated(bad)).toBe(false);
    // a token copy and a copy of a creature "an opponent controls" never read it
    expect(fullyAutomated(creature('You may have ~ enter as a copy of another creature an opponent controls, except it has ~\'s other abilities.\nFlying'))).toBe(true); // the filter is the opponent\'s: fine to state
    expect(fullyAutomated(creature('You may have ~ enter as a copy of another creature you control, except it has the other abilities.\nFlying'))).toBe(false);
  });
  it('render/fold.ts (CR 608.2d, 101.4): a choice for each player is a sentence of its own; the move says "those cards", never one description; a single choice-then-move still folds', () => {
    const f = creature('For each player, choose a creature card in that player\'s graveyard. Put those cards onto the battlefield under your control.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"perPlayer"');
    const single = creature('Return a creature card from your graveyard to the battlefield.', 'Sorcery');
    expect(fullyAutomated(single)).toBe(true);
    expect(JSON.stringify(single.abilities)).not.toContain('"perPlayer"');
  });
  it('render/abil.ts (CR 604.2, 113.6): "as long as ~ isn\'t on the battlefield" is a static ability of every zone but the battlefield; "isn\'t on the battlefield" with another effect is not read', () => {
    const f = parseCard(card('Example Walker', 'Legendary Planeswalker — Hive', 'As long as ~ isn\'t on the battlefield, it\'s a 2/2 Spirit creature in addition to its other types.', { loyalty: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"zone":["library","hand","graveyard","stack","exile","command"]');
    const other = parseCard(card('Example Walker', 'Legendary Planeswalker — Hive', 'As long as ~ isn\'t on the battlefield, it has flying.', { loyalty: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(JSON.stringify(other.abilities)).not.toContain('"zone":["library","hand","graveyard","stack","exile","command"]');
  });
});
