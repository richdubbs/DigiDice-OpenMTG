/**
 * std-control-3 (lane std-control): the template data of parser/templates/zz-cloud/std-control-3.json and the round's other parser, lowering and renderer changes:
 *  - op `controlPlayer` (types/ability.ts; effects/handlers/game.ts; render/steps-lasting.ts): "you control <player> during their next turn / combat phase";
 *  - Event (parser/holes/event.ts ORDINALS) and render/evt.ts, render/text.ts: the ordinals sixth to twelfth ("the seventh plan counter is put on ~");
 *  - Cost (parser/holes/cost.ts): "Exile ¤" in an ability an Equipment grants is the granting object, which you control;
 *  - lower/quoted.ts: "This ability costs {X} less to activate, where X is ..." of a quoted activated ability is its own `costChange`, as for a printed one (T38).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-control-3-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdControl3 from '../../../src/parser/templates/zz-cloud/std-control-3.json';
import review from '../../m5/golden/cards/std-control-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C3 = stdControl3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an artifact for an activated ability, a creature for a trigger, else a sorcery. */
const typeOf = (text: string): string => (/^\{/m.test(text) ? 'Artifact' : /^Whenever|^When|^At /m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces.map((f) => f.abilities));

const IDS = ['eff.stdcontrol3.controlPlayer.nextTurn', 'eff.stdcontrol3.controlPlayer.nextCombat'];

describe('std-control-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-control-3.json, after zz-cloud/std-blb.json, before zz-cloud/std-dft.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-control-3.json');
    expect(files.indexOf('zz-cloud/std-control-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-control-3.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(C3.map((t) => t.id)).toEqual(IDS);
    for (const t of C3) {
      expect(t.id, t.id).toMatch(/^eff\.stdcontrol3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (three cards of the whole index print them, all Standard), stable on the hand-verified golden cards plus these tests and the scenarios:
    // a 6.9 deviation named in the round record (guide section 5, "Narrow wordings")
    expect(goldenUsing('eff.stdcontrol3.controlPlayer.nextTurn')).toEqual(['Construct a Cosmic Cube', 'Secret of Bloodbending', 'The Dominion Bracelet']);
    expect(goldenUsing('eff.stdcontrol3.controlPlayer.nextCombat')).toEqual(['Secret of Bloodbending']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'choose', 'control']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-control-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
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
    [/\bduring their next turn\b/, 'during your next turn'], [/\bduring their next turn\b/, 'during their next upkeep'], [/\bduring their next combat phase\b/, 'during their next main phase'],
    [/\bduring their next combat phase\b/, 'during their last combat phase'], [/\bYou control target\b/, 'You gain control of target'], [/\btarget opponent\b/, 'target creature'],
    [/\btarget player\b/, 'target artifact'], [/\bduring their next\b/, 'during their first'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-control-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C3) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-control-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of C3) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1;
        const [cost, rest] = /^(\{[^:]*: )(.*)$/.exec(lines[last]!)?.slice(1) ?? ['', lines[last]!];
        const sentence = rest!.split(/(?<=\.) /)[0]!; // the template's own sentence ("Draw a card." after it is another template's)
        const tail = rest!.slice(sentence.length);
        const words = sentence.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), `${cost}${[...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')}${tail}`].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-control-3 op controlPlayer (types/ability.ts; CR 723.1)', () => {
  it('the turn and the combat phase readings build their own `during`; "that player ... instead" keeps the target', () => {
    expect(json('Sorcery', 'You control target opponent during their next turn.')).toContain('{"op":"controlPlayer","who":{"ref":"target","id":"t0"},"during":"turn"}');
    expect(json('Sorcery', 'You control target opponent during their next combat phase.')).toContain('{"op":"controlPlayer","who":{"ref":"target","id":"t0"},"during":"combat"}');
    const j = json('Sorcery', "As an additional cost to cast this spell, you may discard a card.\nYou control target opponent during their next combat phase. If this spell's additional cost was paid, you control that player during their next turn instead.");
    expect(j).toContain('"then":[{"op":"controlPlayer","who":{"ref":"target","id":"t0"},"during":"turn"}],"else":[{"op":"controlPlayer","who":{"ref":"target","id":"t0"},"during":"combat"}]');
  });
  it('"each opponent" is each of them during their own next turn (one effect per player, effects/handlers/game.ts)', () => {
    expect(json('Sorcery', 'You control each opponent during their next turn.')).toContain('{"op":"controlPlayer","who":{"ref":"each","who":"opponent"},"during":"turn"}');
  });
  it('fails closed on another pronoun or a "that player" with no antecedent', () => {
    expect(level('Sorcery', 'You control target opponent during his next turn.')).not.toBe('full');
    expect(level('Sorcery', 'You control that player during their next turn.')).not.toBe('full');
  });
});

describe('std-control-3 Event ordinals (parser/holes/event.ts, render/evt.ts; CR 122.1, 603.2)', () => {
  it('"the seventh / tenth / twelfth <kind> counter is put on ~" is the event that makes the count reach that number', () => {
    for (const [word, n] of [['sixth', 6], ['seventh', 7], ['tenth', 10], ['twelfth', 12]] as const) {
      const text = `When the ${word} hour counter is put on this artifact, draw a card.`;
      expect(level('Artifact', text), text).toBe('full');
      expect(json('Artifact', text)).toContain(`{"ev":"counters","change":"put","kind":"hour","on":{"self":true},"atLeast":${n}}`);
    }
  });
  it('"your seventh card each turn" is read too (the same ordinals): the Nth draw of the turn', () => {
    expect(json('Creature — Beast', 'Whenever you draw your seventh card each turn, you gain 1 life.')).toContain('{"ev":"draw","player":"you","nth":7}');
  });
  it('fails closed past the twelfth and on a plural', () => {
    expect(level('Artifact', 'When the thirteenth hour counter is put on this artifact, draw a card.')).not.toBe('full');
    expect(level('Artifact', 'When the seventh hour counters are put on this artifact, draw a card.')).not.toBe('full');
  });
});

describe('std-control-3 Cost "Exile ¤" (parser/holes/cost.ts; CR 118.3, 406.1)', () => {
  it('the granting Equipment, from the battlefield, which you control', () => {
    const j = json('Artifact — Equipment', 'Equipped creature has "{2}, Exile Example Relic: Draw a card."\nEquip {1}');
    expect(j).toContain('{"kind":"exileFrom","zone":"battlefield","count":1,"filter":{"is":{"ref":"grantor"},"controller":"you"}}');
    expect(level('Artifact — Equipment', 'Equipped creature has "{2}, Exile Example Relic: Draw a card."\nEquip {1}')).toBe('full');
  });
});

describe('std-control-3 lower/quoted.ts: a quoted ability\'s own cost change (T38; CR 601.2f, 602.2b, 118.7)', () => {
  it('"This ability costs {X} less to activate, where X is this creature\'s power." is the quoted ability\'s `costChange`, read for the creature that has it', () => {
    const text = 'Equipped creature has "{9}: Draw a card. This ability costs {X} less to activate, where X is this creature\'s power."\nEquip {1}';
    expect(level('Artifact — Equipment', text)).toBe('full');
    expect(json('Artifact — Equipment', text)).toContain('"costChange":{"kind":"reduce","generic":{"q":"stat","stat":"power","of":{"ref":"self"}},"floor":"zero"}');
  });
  it('a quoted mana ability with a cost change is not read', () => {
    expect(level('Artifact — Equipment', 'Equipped creature has "{3}: Add {G}. This ability costs {X} less to activate, where X is this creature\'s power."\nEquip {1}')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-control-3 design 6.10 (local index): synthetic examples', () => {
  it('no std-control-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|permanent)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = C3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
