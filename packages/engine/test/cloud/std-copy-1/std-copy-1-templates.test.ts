/**
 * Lane std-copy, round std-copy-1: the template data of parser/templates/zz-cloud/std-copy-1.json ("This spell can't be copied", "The copy gains <abilities>",
 * "If the copy is a permanent spell, it gains <abilities>", "When you win / lose the flip, <effects>"), and the two r3 templates the round promoted
 * (sta.r3static.legendRule.exempt.filter, rid.r3copy.ifYouDo.copy.newTargets).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-copy-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdCopy1 from '../../../src/parser/templates/zz-cloud/std-copy-1.json';
import review from '../../m5/golden/cards/std-copy-1-review.json';
import r3CopyReview from '../../m5/golden/cards/cloud-r3-copy-review.json';
import r3StaticReview from '../../m5/golden/cards/cloud-r3-static-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdCopy1 as Template[];
const MECH_COUNT = 5;
type Golden = { card: string; verified: string; expect?: string };
const GOLDEN = [...(review as Golden[]), ...(r3CopyReview as Golden[]), ...(r3StaticReview as Golden[])];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two cards (or three spells, one of them not otherwise full), with their template tests (G9, G2) and played scenarios. Listed in the round's
 * record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'abl.stdcopy1.cantBeCopied': ['Choreographed Sparks', 'See Double'], // and Display of Power (other gaps)
  'rid.stdcopy1.copy.gains': ['Choreographed Sparks'],
  'rid.stdcopy1.copy.gains.ifPermanent': ['Spider-Verse'], // and Mizzix, Replica Rider (held-out, not opened)
  'rf.stdcopy1.flip.win': ['Breeches, the Blastmaker'],
  'rf.stdcopy1.flip.lose': ['Breeches, the Blastmaker'],
  'rid.r3copy.ifYouDo.copy.newTargets': ['Spider-Verse'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An example is spell text (an instant) unless it is a triggered or activated ability, then an ability of a creature. */
const parsedWith = (text: string) =>
  (/^(Whenever|When |At |\{)/.test(text) ? parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS) : parseCard(card('Example Subject', 'Instant', text), OPTS)).faces[0]!;

const usedBy = (id: string): string[] => GOLDEN.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('std-copy-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-copy-1.json, path order after std-blb, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-copy-1.json');
    expect(files.indexOf('zz-cloud/std-copy-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-copy-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (abl|rid|rf).stdcopy1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(abl|rid|rf)\.stdcopy1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const r3 = [
      ...(TEMPLATE_FILES.find((f) => f.file === 'zz-cloud/r3-static.json')?.templates ?? []).filter((t) => t.id === 'sta.r3static.legendRule.exempt.filter'),
      ...(TEMPLATE_FILES.find((f) => f.file === 'zz-cloud/r3-copy.json')?.templates ?? []).filter((t) => t.id === 'rid.r3copy.ifYouDo.copy.newTargets'),
    ];
    expect(r3.map((t) => t.status)).toEqual(['stable', 'stable']);
    for (const t of [...MECH, ...r3].filter((x) => x.status === 'stable')) {
      const cards = usedBy(t.id);
      if (NARROW[t.id] !== undefined) for (const c of NARROW[t.id]!) expect(cards, t.id).toContain(c);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    expect(usedBy('sta.r3static.legendRule.exempt.filter')).toEqual(expect.arrayContaining(['Spider-Verse', 'Cadric, Soul Kindler', 'Council of Reeds']));
    for (const g of review as Golden[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'when', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-copy-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
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
    [/\bcan't be copied\b/, "can't be countered"], [/\bThe copy gains\b/, 'The copy has'], [/\bpermanent spell\b/, 'creature spell'], [/\bwin the flip\b/, 'win a flip'],
    [/\blose the flip\b/, 'lose a flip'], [/\bthe copy\b/, 'that spell'], [/\bThis spell\b/, 'Target spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-copy-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-copy-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-copy-1: parser, lowering and renderer changes (one test each)', () => {
  it('CR 707.10, 107.3a: "This ability can\'t be copied and X can\'t be 0." is two activation restrictions (uncopiable, xMin), rendered back as one sentence', () => {
    const f = parsedWith("{X}, {T}: You gain X life. This ability can't be copied and X can't be 0.");
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', uncopiable: true, xMin: 1 });
    const alone = parsedWith("{T}: You gain 2 life. This ability can't be copied.");
    expect(fullyAutomated(alone)).toBe(true);
    expect(alone.abilities[0]).toMatchObject({ kind: 'activated', uncopiable: true });
    expect('xMin' in alone.abilities[0]!).toBe(false);
  });
  it('CR 603.12, 705.2: "When you win the flip" is a reflexive trigger inside the flip\'s win branch, waiting for the flip by its name; also after "If you do, flip a coin."', () => {
    const f = parsedWith('{T}: You may sacrifice an artifact. If you do, flip a coin. When you win the flip, you gain 3 life. When you lose the flip, ~ deals 2 damage to any target.');
    expect(fullyAutomated(f)).toBe(true);
    const json = JSON.stringify(f.abilities[0]);
    expect(json).toContain('"op":"flipCoin","who":{"ref":"you"},"as":"flip","onWin":[{"op":"reflexive","when":{"did":"flip"}');
    expect(json).toContain('"onLose":[{"op":"reflexive","when":{"did":"flip"},"targets":[{"id":"t0","kind":"anyTarget"');
  });
  it('CR 603.12, 705.2: a "When you win the flip" with no coin flip right before it stays manual (fail closed)', () => {
    const f = parsedWith('{T}: Draw a card. When you win the flip, you gain 3 life.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 608.2c: "that spell" after "When you win the flip, copy that spell." is still the spell the ability names, not the copy of the other branch', () => {
    const f = parsedWith("Whenever you cast your second spell each turn, flip a coin. When you win the flip, copy that spell. When you lose the flip, ~ deals damage equal to that spell's mana value to any target.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"amount":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}');
  });
  it('CR 707.10, 611.2a: "The copy gains haste" merges into the copy step (`gains`); with "If the copy is a permanent spell" it is `ifPermanent`', () => {
    const a = parsedWith('Copy target creature spell you control. The copy gains haste.');
    expect(JSON.stringify(a.abilities)).toContain('"gains":{"add":[{"kind":"keyword","keyword":"haste"');
    const b = parsedWith('Copy target spell you control. If the copy is a permanent spell, it gains haste.');
    expect(JSON.stringify(b.abilities)).toContain('"ifPermanent":true');
  });
  it('CR 707.10: a rider on a copy that made several copies is not rendered (fail closed: "the copy gains" names one copy)', () => {
    const f = parsedWith('Copy target creature spell twice. The copy gains haste.');
    expect(fullyAutomated(f)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-copy-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-copy-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
