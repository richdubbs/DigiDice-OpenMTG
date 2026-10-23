/**
 * std-rx16 (wave 2, slice s11): the template data of parser/templates/zz-cloud/std-rx16.json and the round's parser, renderer and engine support: the quantity
 * "the difference between <stat> and <stat>" (parser/holes/qty.ts#differenceBetween, render/qty.ts#differenceBetweenPhrase); the `subject` role of a combat
 * event, named by a disjunction "attacks or blocks" of a creature other than ~ (model/lint-roles.ts#silentRole, parser/lower/scope.ts#roleObject,
 * render/refs.ts#antecedents, triggers/normalize.ts); the moved cards of "For each of those cards, its owner may play it ..." (parser/lower/anaphora.ts#actingPaths,
 * render/fold.ts#forEachOwnerMayPlay); `toughnessGreaterThanPower` in the static filter matcher (statics/match.ts). Guard G9 (design 6.8): every example lowers
 * with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in std-rx16-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { silentRole } from '../../../src/model/lint-roles';
import type { EventPattern } from '../../../src/types/ability';
import stdRx16 from '../../../src/parser/templates/zz-cloud/std-rx16.json';
import review from '../../m5/golden/cards/cloud-std-rx16-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX16 = stdRx16 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'cm.stdrx16.each.spell.toughnessGreater.less': 'Creature — Treefolk',
  'eff.stdrx16.forEachOfThose.ownerMayPlay.remainsExiled': 'Sorcery',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rx16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx16.json, after zz-cloud/std-rw6.json, before zz-cloud/std-rx9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx16.json');
    expect(files.indexOf('zz-cloud/std-rx16.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rw6.json'));
    expect(files.indexOf('zz-cloud/std-rx16.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX16.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX16) {
      expect(t.id, t.id).toMatch(/^(cm|eff)\.stdrx16\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one Oracle card each in the whole index): stable on one hand-verified golden card plus these tests and the scenarios, a 6.9
    // deviation named in the round record and the PR
    expect(goldenUsing('cm.stdrx16.each.spell.toughnessGreater.less')).toEqual(['Doran, Besieged by Time']);
    expect(goldenUsing('eff.stdrx16.forEachOfThose.ownerMayPlay.remainsExiled')).toEqual(['Extraordinary Journey']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX16) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx16 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX16) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\btoughness greater than its power\b/, 'power greater than its toughness'], [/\byou cast\b/, 'your opponents cast'], [/\bless to cast\b/, 'more to cast'],
    [/\bits owner may\b/, 'you may'], [/\bmay play it\b/, 'may cast it'], [/\bremains exiled\b/, 'remains tapped'], [/\bEach creature spell\b/, 'Each artifact spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX16) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx16 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX16) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx16 parser: "the difference between <statistic> and <statistic>" (CR 208.1, 202.3, 107.1)', () => {
  const DIFF = (of: unknown, a: string, b: string) => ({ q: 'math', op: '-', args: [{ q: 'math', op: 'max', args: [{ q: 'stat', stat: a, of }, { q: 'stat', stat: b, of }] }, { q: 'math', op: 'min', args: [{ q: 'stat', stat: a, of }, { q: 'stat', stat: b, of }] }] });
  it('"its power and toughness" is the larger of the two statistics of the one object minus the smaller', () => {
    const f = face('', 'Target creature gets +X/+X until end of turn, where X is the difference between its power and toughness.', 'Instant');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain(JSON.stringify(DIFF({ ref: 'target', id: 't0' }, 'power', 'toughness')));
  });
  it('two statistics written out ("~\'s power and toughness", "its power and its toughness") read the same', () => {
    expect(fullyAutomated(face('', "When this creature enters, target opponent loses life equal to the difference between this creature's power and toughness.", 'Creature — Elf'))).toBe(true);
    expect(fullyAutomated(face('', 'Target creature gets +X/+X until end of turn, where X is the difference between its power and its toughness.', 'Instant'))).toBe(true);
  });
  it('a total or a greatest statistic among a group is not one object\'s statistic: no reading (fail closed)', () => {
    expect(fullyAutomated(face('', 'You gain life equal to the difference between the total power of creatures you control and the total toughness of creatures you control.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(face('', 'You gain life equal to the difference between its power.', 'Sorcery'))).toBe(false);
  });
});

describe('std-rx16 parser and renderer: the creature of "attacks or blocks" (CR 508.1, 509.1)', () => {
  const C = 'Creature — Elf';
  it('"Whenever a creature you control attacks or blocks, it ..." names that creature (the `subject` role of each event)', () => {
    const f = face('', 'Whenever a creature you control attacks or blocks, put a +1/+1 counter on it.', C);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"on":{"ref":"event","role":"subject"}');
    expect(fullyAutomated(face('', 'Whenever a creature you control attacks or blocks, that creature gets +1/+1 until end of turn.', C))).toBe(true);
  });
  it('the readings of ~ itself and of one event are unchanged: "~ attacks or blocks" is the object itself, a lone "attacks" its attacker', () => {
    expect(JSON.stringify(face('', 'Whenever this creature attacks or blocks, put a +1/+1 counter on it.', C).abilities)).toContain('"on":{"ref":"self"}');
    expect(JSON.stringify(face('', 'Whenever a creature you control attacks, put a +1/+1 counter on it.', C).abilities)).toContain('"on":{"ref":"event","role":"attacker"}');
  });
  it('model/lint-roles.ts#silentRole: `subject` is an antecedent only in a disjunction of combat events of different sides, none of them ~ itself', () => {
    const atk: EventPattern = { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' } };
    const blk: EventPattern = { ev: 'blocks', blocker: { types: ['Creature'], controller: 'you' } };
    const selfAtk: EventPattern = { ev: 'attacks', attacker: { self: true } };
    const selfBlk: EventPattern = { ev: 'blocks', blocker: { self: true } };
    expect(silentRole([atk, blk], 'subject')).toBe(false);
    expect(silentRole([atk], 'subject')).toBe(true);
    expect(silentRole([blk], 'subject')).toBe(true);
    expect(silentRole([selfAtk, selfBlk], 'subject')).toBe(true);
  });
  it('"blocks or becomes blocked" stays manual for "it": the creature of the trigger and the other combatant are both candidates (design 6.4)', () => {
    expect(fullyAutomated(face('', 'Whenever a creature you control blocks or becomes blocked, it gets +1/+1 until end of turn.', C))).toBe(false);
  });
});

describe('std-rx16 lowering: the cards of "For each of those cards, its owner may play it ..." are the cards an earlier instruction moved (CR 400.7, 608.2f)', () => {
  it('after "Exile up to two target creatures.", "those cards" is the moved cards (a binding), never the targets on the battlefield', () => {
    const f = face('', 'Exile up to two target creatures. For each of those cards, its owner may play it until the end of their next turn.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"op":"forEach","over":{"ref":"bound","name":"moved"}');
    expect(json).not.toContain('"op":"forEach","over":{"ref":"target"');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx16 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx16 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RX16.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
