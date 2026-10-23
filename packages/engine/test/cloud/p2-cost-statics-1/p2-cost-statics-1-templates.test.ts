/**
 * Phase 2 lane p2-cost-statics, round p2-cost-statics-1: the template data of parser/templates/zz-cloud/p2-cost-statics-1.json (cost statics, CR 601.2f, 118.7:
 * "~ costs {M} less to cast for each <a count of the turn's history>", "<spells> and <spells> cost {M} more to cast"), the promotion of K1's
 * cm.alternative.mana.if (CR 118.9) and the round's parser, renderer and announcement changes: the readings of parser/holes/p2cst1.ts (Qty: "spell your opponents
 * have cast this turn", "creature you attacked with this turn"; Cond: "three or more creatures are attacking", "exactly one creature is attacking", "an opponent cast
 * three or more spells this turn"), their words in render/ and the announcement reader of the per-opponent spell count (actions/announce-cond.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-cost-statics-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Condition } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { isOpponentSpellsPerPlayer } from '../../../src/model/forms';
import { announceReadable } from '../../../src/actions/announce-cond';
import p2cst1 from '../../../src/parser/templates/zz-cloud/p2-cost-statics-1.json';
import review from '../../m5/golden/cards/p2-cost-statics-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cst1 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two cards of the tuning half, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'cm.p2cst1.spells.pair.more.any': ['High Seas', 'Irini Sengir'],
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const parsedWith = (_t: Template, text: string) => parseCard(card('Example Ledger', 'Creature — Snake', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-cost-statics-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-cost-statics-1.json, after zz-cloud/p2-copy-perm-1.json, before zz-cloud/p2-counters-state-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-cost-statics-1.json');
    expect(files.indexOf('zz-cloud/p2-cost-statics-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-copy-perm-1.json'));
    expect(files.indexOf('zz-cloud/p2-cost-statics-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are cm.p2cst1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^cm\.p2cst1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one or two cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    const ids = [...MECH.filter((x) => x.status === 'stable').map((t) => t.id), 'cm.alternative.mana.if'];
    for (const id of ids) {
      const cards = golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`) || g.verified.includes(`${id})`)).map((g) => g.card);
      if (NARROW[id] !== undefined) for (const c of NARROW[id]!) expect(cards, id).toContain(c);
      else expect(cards.length, id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'twice', 'no']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-cost-statics-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bless\b/, 'more'], [/\bmore\b/, 'less'], [/\bopponents\b/, 'teammates'], [/\bdied\b/, 'entered'], [/\bthis turn\b/, 'last turn'],
    [/\bcast\b/, 'activate'], [/\band\b/, 'or'], [/\bcreature\b/, 'artifact']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-cost-statics-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/at random/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-cost-statics-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-cost-statics-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-cost-statics-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the round's parser, renderer and announcement changes ------------------------------------------------------------------------------------------------

describe('p2-cost-statics-1 Qty (parser/holes/p2cst1.ts; CR 601.2i, 508.1): history counts after "for each" and "the number of"', () => {
  it('CR 601.2i: "for each spell your opponents have cast this turn" is every cast of the turn by an opponent of the controller', () => {
    const f = face('Sorcery', 'This spell costs {1} less to cast for each spell your opponents have cast this turn.\nDraw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('{"q":"happenedCount","event":{"ev":"cast","player":"opponent"},"scope":"turn"}');
  });
  it('CR 508.1, 506.4: "for each creature you attacked with this turn" is each creature you controlled declared as an attacker this turn', () => {
    const f = face('Sorcery', 'This spell costs {2} less to cast for each creature you attacked with this turn.\nDraw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('{"q":"happenedCount","event":{"ev":"attacks","attacker":{"types":["Creature"],"controller":"you"}},"scope":"turn"}');
  });
  it('fails closed: "for each spell you cast" with a description of the attackers that names a controller, and an unknown event, stay manual', () => {
    expect(fullFace(face('Sorcery', 'This spell costs {1} less to cast for each creature your opponents control you attacked with this turn.\nDraw a card.'))).toBe(false);
    expect(fullFace(face('Sorcery', 'This spell costs {1} less to cast for each spell your opponents have copied this turn.\nDraw a card.'))).toBe(false);
  });
});

describe('p2-cost-statics-1 Cond (parser/holes/p2cst1.ts; CR 506.4, 601.2i, 118.9): the traps\' conditions', () => {
  it('CR 506.4: "if three or more creatures are attacking": three or more attacking creatures of any player, read at announcement', () => {
    const f = face('Instant', 'If three or more creatures are attacking, you may pay {U} rather than pay this spell\'s mana cost.\nDraw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"when":{"cond":"exists","of":{"ref":"each","filter":{"types":["Creature"],"attacking":true}},"atLeast":3}');
  });
  it('CR 506.4: "if exactly one creature is attacking": the number of attacking creatures is one', () => {
    const f = face('Instant', 'If exactly one creature is attacking, you may pay {W} rather than pay this spell\'s mana cost.\nDraw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"when":{"cond":"compare","left":{"q":"count","of":{"ref":"each","filter":{"types":["Creature"],"attacking":true}}},"op":"==","right":1}');
  });
  it('CR 601.2i: "if an opponent cast three or more spells this turn": the most spells one opponent cast this turn, readable as the spell is announced', () => {
    const f = face('Instant', 'If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell\'s mana cost.\nDraw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const when = { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'cast' }, scope: 'turn', per: 'player', by: 'opponent' }, op: '>=', right: 3 } as const;
    expect(steps(f)).toContain(JSON.stringify(when).slice(1, -1));
    expect(isOpponentSpellsPerPlayer(when.left)).toBe(true);
    expect(announceReadable(when)).toBe(true);
  });
  it('fails closed: "exactly two creatures are attacking", "one or more creatures are blocking" and an opponent\'s spells of a kind are not read here', () => {
    expect(fullFace(face('Instant', 'If exactly two creatures are attacking, you may pay {W} rather than pay this spell\'s mana cost.\nDraw a card.'))).toBe(false);
    expect(fullFace(face('Instant', 'If three or more creatures are blocking, you may pay {W} rather than pay this spell\'s mana cost.\nDraw a card.'))).toBe(false);
    expect(isOpponentSpellsPerPlayer({ q: 'happenedCount', event: { ev: 'cast', spell: { colors: ['U'] } }, scope: 'turn', per: 'player', by: 'opponent' })).toBe(false);
  });
});

describe('p2-cost-statics-1 announcement (model/forms.ts \'altCost\'; CR 118.9, 601.2b): an alternative cost\'s condition reads the turn\'s history', () => {
  it('CR 118.9: "If an opponent cast a blue spell this turn" and "If you attacked this turn" are readable as the alternative cost\'s `when` (and, since p2-modal-2, as a mode count\'s override: CR 601.2b, 603.3c, the history synced first)', () => {
    const blue = { cond: 'happened', event: { ev: 'cast', player: 'opponent', spell: { colors: ['U'] } }, scope: 'turn', times: { op: '>=', value: 1 } } as Condition;
    const raid = { cond: 'happened', event: { ev: 'attacks', attacker: { controller: 'you' } }, scope: 'turn' } as Condition;
    for (const c of [blue, raid]) {
      expect(announceReadable(c, 'altCost'), JSON.stringify(c)).toBe(true);
      expect(announceReadable(c, 'mode'), JSON.stringify(c)).toBe(true); // p2-modal-2 (model/forms.ts): turn history in a mode position, damage aside
    }
    const f = face('Instant', 'If an opponent cast a red spell this turn, you may pay {U} rather than pay this spell\'s mana cost.\nDraw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});

describe('p2-cost-statics-1 engine capabilities (CR 601.2i, 118.9)', () => {
  it('the per-opponent spell count at announcement is registered', () => {
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.happenedCount.opponentSpellsPerPlayer')).toBe(true);
  });
});
