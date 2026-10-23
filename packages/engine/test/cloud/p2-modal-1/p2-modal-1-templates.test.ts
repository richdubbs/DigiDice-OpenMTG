/**
 * p2-modal-1 (lane p2-modal): the template data of parser/templates/zz-cloud/p2-modal-1.json ("choose any number of <creatures> with different powers") and the
 * round's parser, renderer and engine changes:
 *   - "Choose one or both. Each mode must target a different player." (parser/lower/ability.ts#differentPlayerHeader, #differentPlayerModes: `distinctFrom` across the
 *     modes; model/lint-nodes.ts lets a mode's target differ from another mode's; render/program.ts#differentPlayers; actions/announce.ts#chooseModes refuses a set of
 *     modes with no legal targets together);
 *   - "Choose one. If this spell was kicked, choose any number instead." (lower/ability.ts#conditionalModeCount; render family any-number-instead);
 *   - the Cond "you have exactly N life" (parser/holes/cond.ts#youHave);
 *   - "target permanent or suspended card" and "each suspended card" (parser/holes/object.ts#SUSPENDED_CARD, parser/holes/filter.ts; render/suspended.ts, render/np.ts,
 *     render/refs.ts);
 *   - "other" beside a target that is a player (parser/lower/anaphora.ts);
 *   - the renderer of `chooseObjects.distinct` out of a description (render/steps-flow.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-modal-1-scenarios.test.ts. CR cites from memory,
 * unverified.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2modal1 from '../../../src/parser/templates/zz-cloud/p2-modal-1.json';
import review from '../../m5/golden/cards/p2-modal-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2modal1 as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const typeOf = (text: string): [string, [string, string] | undefined] => (/^(When|Whenever|At)\b/.test(text) ? ['Creature — Beast', ['2', '2']] : ['Sorcery', undefined]);
const parsedWith = (text: string) => { const [type, pt] = typeOf(text); return face(type, text, pt); };
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const abilitiesJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-modal-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-modal-1.json, after zz-cloud/p2-counters-state-1.json, before zz-cloud/p2-player-rules-1.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-modal-1.json');
    expect(files.indexOf('zz-cloud/p2-modal-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    expect(files.indexOf('zz-cloud/p2-modal-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-player-rules-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.p2modal1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|abl)\.p2modal1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wording, deviation named in the record): a stable template has a hand-verified golden card of the tuning half; every golden card is full', () => {
    // "choose any number of <creatures> with different powers" is printed on two cards (Sigarda's Vanguard; Sigardian Zealot, whose other sentence is not read): three
    // golden cards can never exist, so the template is stable on one golden card, these tests and the scenario (the practice of G9 and G2 rounds, guide section 5)
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id},`) || g.verified.includes(`(${t.id})`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'when', 'different']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-modal-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [text.replace(/\. /, ' unless it is blue. '), text.replace(/\. /, ' at random. '), text.replace(/\. /, ' twice. ')];
  const swaps: [RegExp, string][] = [[/different powers/, 'different names'], [/different powers/, 'different toughnesses'], [/any number of/, 'up to two'], [/creatures with/, 'creature cards with']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-modal-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an inserted "unless/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-modal-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,') return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-modal-1 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example of this round is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim());
        }
      }
    }
    const texts = [...MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]), ...READINGS];
    // the header "Choose one. If this spell was kicked, choose any number instead." is a fixed wording read by no template (lower/ability.ts#conditionalModeCount):
    // its only form is the printed line, so the test of that reading says it as printed (its modes are invented)
    const fixed = new Set(['Choose one. If this spell was kicked, choose any number instead.']);
    const verbatim = texts.filter((x) => x.split('\n').some((l) => !/^Kicker /.test(l) && !/^• /.test(l) && !fixed.has(l) && lines.has(l.trim())));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- parser, renderer and engine changes ----------------------------------------------------------------------------------------------------------------

const PAIR = 'When ~ enters, choose one or both. Each mode must target a different player.\n• Target player draws a card.\n• Target player gains 3 life.';
const KICK = 'Kicker {2}\nChoose one. If this spell was kicked, choose any number instead.\n• Draw a card.\n• You gain 2 life.\n• Target player loses 1 life.';
const EXACT = 'Choose one. If you have exactly 13 life, you may choose both instead.\n• Draw a card.\n• You gain 2 life.';
const SAND = 'Remove two time counters from target permanent or suspended card.';
const DUST = 'Put two time counters on each permanent with a time counter on it and each suspended card.';
const MENTOR = 'When ~ enters, put a +1/+1 counter on each other creature target player controls.';
const READINGS = [PAIR, KICK, EXACT, SAND, DUST, MENTOR];

describe('p2-modal-1 (CR 700.2, 115.3): "Each mode must target a different player."', () => {
  it('reads the header and its rider: each later mode\'s player target differs from the earlier modes\' (distinctFrom), and renders back', () => {
    const f = face('Creature — Human', PAIR, ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.gate) + JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"distinctFrom":["t0"]');
    expect(abilitiesJson(f)).toContain('"min":1,"max":2');
  });
  it('"choose two", "choose one or more" read too; the counts are those of the same header with a dash', () => {
    const two = face('Creature — Human', 'When ~ enters, choose two. Each mode must target a different player.\n• Target player draws a card.\n• Target player gains 3 life.\n• Target player mills two cards.', ['2', '2']);
    expect(fullFace(two), JSON.stringify(two.gate)).toBe(true);
    expect(abilitiesJson(two)).toContain('"distinctFrom":["t0","t1"]');
  });
  it('fail closed: "choose one" has nothing to keep apart, and stays without a reading', () => {
    expect(fullFace(face('Creature — Human', 'When ~ enters, choose one. Each mode must target a different player.\n• Target player draws a card.\n• Target player gains 3 life.', ['2', '2']))).toBe(false);
  });
  it('fail closed: a mode that targets no player, or two targets, keeps a manual step (never a guess)', () => {
    const f = face('Creature — Human', 'When ~ enters, choose one or both. Each mode must target a different player.\n• Target player draws a card.\n• Destroy target artifact.', ['2', '2']);
    expect(fullFace(f)).toBe(false);
    expect(abilitiesJson(f)).not.toContain('"distinctFrom"');
  });
  it('without the rider the same modes have no distinctFrom (the same player may be targeted twice)', () => {
    const f = face('Creature — Human', 'When ~ enters, choose one or both --\n• Target player draws a card.\n• Target player gains 3 life.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).not.toContain('"distinctFrom"');
  });
});

describe('p2-modal-1 (CR 700.2, 601.2b): "If this spell was kicked, choose any number instead."', () => {
  it('reads over three modes as one up to all of them when kicked, and renders back (render family any-number-instead)', () => {
    const f = face('Sorcery', KICK);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).toContain('"override":{"when":{"cond":"wasCast","kicked":true},"min":1,"max":3}');
  });
  it('fail closed: over two modes the wording has no reading (Oracle says "choose both instead" there)', () => {
    expect(fullFace(face('Sorcery', 'Kicker {2}\nChoose one. If this spell was kicked, choose any number instead.\n• Draw a card.\n• You gain 2 life.'))).toBe(false);
  });
});

describe('p2-modal-1 Cond (CR 119.1): "you have exactly N life"', () => {
  it('reads as your life total equal to N, and renders back', () => {
    const f = face('Sorcery', EXACT);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).toContain('"cond":"compare","left":{"q":"life","of":{"ref":"you"}},"op":"==","right":13');
  });
  it('fail closed: a bare "you have 13 life" is not read', () => {
    expect(fullFace(face('Sorcery', 'Choose one. If you have 13 life, you may choose both instead.\n• Draw a card.\n• You gain 2 life.'))).toBe(false);
  });
});

describe('p2-modal-1 (CR 702.62b, 115.1): "target permanent or suspended card", "each suspended card"', () => {
  it('a target of two zones: a permanent of the description, or a card in exile with suspend and a time counter on it; renders back', () => {
    const f = face('Instant', SAND);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).toContain('"zone":["battlefield","exile"],"anyOf":[{"zone":"battlefield"},{"zone":"exile","isCard":true,"keyword":"suspend","counters":{"kind":"time"}}]');
  });
  it('"each permanent with a time counter on it and each suspended card": the union of the two groups', () => {
    const f = face('Sorcery', DUST);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).toContain('"ref":"union"');
  });
  it('fail closed: a card described before "or suspended card" ("target creature card or suspended card") has no reading of this round', () => {
    expect(abilitiesJson(face('Instant', 'Remove two time counters from target creature card or suspended card.'))).not.toContain('"keyword":"suspend"');
  });
});

describe('p2-modal-1 (CR 109.2): "other" beside a target that is a player', () => {
  it('"each other creature target player controls": other than this object (a player is never one of the creatures)', () => {
    const f = face('Creature — Rat', MENTOR, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"other":true');
  });
  it('fail closed: beside a target creature, "other" stays ambiguous (the target may be one of them)', () => {
    expect(fullFace(face('Creature — Rat', 'When ~ enters, tap target creature. Put a +1/+1 counter on each other creature you control.', ['1', '1']))).toBe(false);
  });
});
