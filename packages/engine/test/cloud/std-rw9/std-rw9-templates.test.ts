/**
 * std-rw9 (card wave 2, slice s9): the template data of parser/templates/zz-cloud/std-rw9.json and the round's parser and renderer support: "If a <card> is put
 * into a graveyard this way" after a destroy (parser/lower/conditions.ts#movedFits, effects StepResult.beforeTo, render/steps-zones.ts#destroyedOne); std-ra's
 * reading of "that target <short name>" (parser/front/selfref.ts); a later choice among a group is the one "the rest" follows (parser/lower/mentions.ts#
 * supersededRests); "sacrifice it" never names a target that may be a player (parser/lower/anaphora.ts, render/refs.ts#candidateCheck); the seen group's "them"
 * in two dig folds and "Then" after the "you may" sentence (render/fold.ts, families seen-group-them and then-after-may-dig). Guard G9 (design 6.8): every
 * example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations
 * fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in std-rw9-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRw9 from '../../../src/parser/templates/zz-cloud/std-rw9.json';
import review from '../../m5/golden/cards/cloud-std-rw9-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RW9 = stdRw9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const face = (text: string, type = 'Sorcery', name = 'Example Relic') =>
  parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
/** A legendary creature whose short name is a land subtype (CR 205.3i: Cloud). */
const cloudFace = (text: string) => face(text, 'Legendary Creature — Human Soldier', 'Cloud, Test Pilot');

describe('std-rw9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rw9.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rw9.json');
    expect(files.indexOf('zz-cloud/std-rw9.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rw9.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RW9.map((t) => t.id)).toEqual(['eff.stdrw9.dig.anyNumber.bf.tapped.rest.graveyard']);
    for (const t of RW9) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // a narrow wording (one card in the index): stable on one hand-verified golden card plus these tests, a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('eff.stdrw9.dig.anyNumber.bf.tapped.rest.graveyard')).toEqual(['Choco, Seeker of Paradise']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RW9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rw9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RW9) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text, e.text.startsWith('Whenever ~') ? 'Creature — Bird' : 'Sorcery');
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [[/\btapped and\b/, 'untapped and'], [/\binto your graveyard\.$/, 'into your hand.'], [/\bland cards\b/, 'creature cards'], [/\bany number of\b/, 'up to two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rw9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RW9) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const type = e.text.startsWith('Whenever ~') ? 'Creature — Bird' : 'Sorcery';
        const orig = face(e.text, type);
        for (const m of nearMisses(e.text)) {
          const f = face(m, type);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rw9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RW9) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const type = e.text.startsWith('Whenever ~') ? 'Creature — Bird' : 'Sorcery';
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, type)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rw9 parser and renderer support', () => {
  const COME_BACK = 'Destroy target creature. If a creature card is put into a graveyard this way, return it to the battlefield under your control.';
  it('CR 701.8a, 608.2c: "If a creature card is put into a graveyard this way" after a destroy names the destroy (what went to a graveyard), and "it" is that card', () => {
    const f = face(`${COME_BACK} Sacrifice it at the beginning of your next end step.`);
    expect(fullyAutomated(f)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('{"op":"destroy","what":{"ref":"target","id":"t0"},"as":"moved"}');
    expect(json).toContain('"cond":{"cond":"did","step":"moved","which":{"types":["Creature"],"isCard":true},"to":"graveyard"}');
    expect(json).toContain('{"op":"move","what":{"ref":"bound","name":"moved"},"to":{"zone":"battlefield","controller":{"ref":"you"}}}');
  });
  it('CR 608.2c: the words after an exile (no move into a graveyard) stay unresolved: the sentence is not understood', () => {
    expect(understood(face('Exile target creature. If a creature card is put into a graveyard this way, return it to the battlefield under your control.'))).toBe(false);
  });
  it('CR 201.5c (std-ra\'s reading): "that target Cloud" is the card itself; "destroy target Cloud" stays the land type', () => {
    const f = cloudFace('Equip abilities you activate that target Cloud cost {2} less to activate.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.templatesUsed).toContain('eff.cost.costmod.equipTargetingSelf');
    const g = cloudFace('{T}: Destroy target Cloud.');
    expect(JSON.stringify(g.abilities)).not.toContain('"ref":"self"');
  });
  it('CR 608.2c: "the rest" follows the later choice among the group when the earlier choice\'s cards left the library', () => {
    const f = face('Look at the top four cards of your library. You may put one of them into your hand. Then put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard.');
    expect(fullyAutomated(f)).toBe(true);
  });
  it('CR 608.2c, design 6.4: an earlier choice whose card stays in the library keeps its own "rest": two candidates, not understood', () => {
    const f = face('Look at the top four cards of your library. Put one of them on top of your library. Then put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard.');
    expect(understood(f)).toBe(false);
  });
  it('CR 701.21a, 115.4: "sacrifice it" is the creature you control, never "any other target"', () => {
    const f = face('Target creature you control deals damage equal to its power to any other target. Then sacrifice it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"op":"sacrifice","what":{"ref":"target","id":"t0"}}');
  });
  it('design 6.4: "destroy it" may still be either target (a permanent any other target may be): not understood', () => {
    expect(understood(face('Target creature you control deals damage equal to its power to any other target. Then destroy it.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rw9 design 6.10 (local index): synthetic examples', () => {
  it('no std-rw9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RW9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
