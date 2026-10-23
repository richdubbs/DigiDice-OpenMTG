/**
 * std-ry5 (wave 2, Commander fresh lane ry5): the template data of parser/templates/zz-cloud/std-ry5.json and the round's other parser, renderer and engine
 * changes:
 *  - templates: "you skip your next [two] turn(s)" (CR 614.10, 500.7); "<cards> can't be the targets of spells or abilities" (CR 115.1); "<obj> doesn't untap
 *    during its controller's untap step for as long as ~ remains tapped" and "They don't untap during their controllers' untap steps ..." (CR 502.3, 611.2b);
 *    "If damage would be dealt to ~, prevent that damage. <effects>" (CR 615.5);
 *  - Filter (parser/holes/filter.ts, render/np.ts): "<Aura> attached to a <creature | land | ...> [you control]" (CR 303.4);
 *  - Cond (parser/holes/cond.ts, render/cond.ts family discarded-this-turn): "you('ve) discarded a card this turn" (CR 701.9a);
 *  - announcement (actions/announce-cond.ts, model/forms.ts): "creatures you control have total power 8 or greater" read as the ability is activated (formidable,
 *    CR 602.5b, 208.1);
 *  - render: "cards in graveyards" (np.ts), "can't be the targets" (family targets-plural), a turn-skip shield (stat.ts);
 *  - model/cap-walk.ts: removing the abilities of cards outside the battlefield stays manual (fail closed).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-ry5-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRy5 from '../../../src/parser/templates/zz-cloud/std-ry5.json';
import review from '../../m5/golden/cards/cloud-std-ry5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RY5 = stdRy5 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an artifact for an activated ability, a creature for a static or a trigger, else a sorcery. */
const typeOf = (text: string): string => (/^\{[^}]*\}.*:/m.test(text) ? 'Artifact' : /^(If damage|When|Whenever|Haste|Flying)/m.test(text) ? 'Creature — Beast' : /can't be the targets/.test(text) ? 'Enchantment' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;

const IDS = ['eff.stdry5.skip.nextTurn.you', 'eff.stdry5.skip.nextTwoTurns.you', 'sta.stdry5.objs.cantBeTargeted', 'eff.stdry5.untapstep.whileTapped', 'eff.stdry5.untapstep.whileTapped.they', 'sta.stdry5.damageToSelf.prevent.sentence'];

describe('std-ry5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ry5.json, after zz-cloud/std-rx9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ry5.json');
    expect(files.indexOf('zz-cloud/std-ry5.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx9.json'));
    expect(files.indexOf('zz-cloud/std-ry5.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RY5.map((t) => t.id)).toEqual(IDS);
    for (const t of RY5) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdry5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // design 6.9 met: three or more hand-verified golden cards (tuning half)
    expect(goldenUsing('eff.stdry5.untapstep.whileTapped').length).toBeGreaterThanOrEqual(3);
    expect(goldenUsing('sta.stdry5.damageToSelf.prevent.sentence').length).toBeGreaterThanOrEqual(3);
    // narrow wordings, stable on one or two hand-verified golden cards (tuning half) plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.stdry5.skip.nextTurn.you').sort()).toEqual(['Chronatog', 'Chronosavant']);
    expect(goldenUsing('eff.stdry5.skip.nextTwoTurns.you')).toEqual(['Eater of Days']);
    expect(goldenUsing('sta.stdry5.objs.cantBeTargeted')).toEqual(['Ground Seal']);
    expect(goldenUsing('eff.stdry5.untapstep.whileTapped.they')).toEqual(['Kill Switch']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RY5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'skip', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
      if (words.includes("doesn't") || words.includes("don't")) expect(t.consumes ?? [], `${t.id}: not`).toContain('not');
    }
  });
});

describe('std-ry5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RY5) {
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
    [/\bnext turn\b/, 'next upkeep'], [/\bnext two turns\b/, 'next turn'], [/^You skip your\b/m, 'You skip their'], [/\bYou skip your\b/, 'Each opponent skips their'],
    [/\bremains tapped\b/, 'remains untapped'], [/\bfor as long as ~ remains tapped\b/, 'for as long as you control ~'], [/\buntap step\b/, 'next untap step'],
    [/\bin graveyards\b/, 'in your graveyard'], [/\bspells or abilities\b/, 'spells'], [/\bwould be dealt to ~/, 'would be dealt by ~'], [/\bprevent that damage\b/, 'prevent 1 of that damage'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ry5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RY5) {
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

describe('std-ry5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RY5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword of the card)
        const sentences = lines[last]!.split(/(?<=\.) /);
        // the sentences of the template: the last one, or the last two when the template spans a sentence break ("prevent that damage. <effects>")
        const firstOfTemplate = t.pattern.includes(' . ') ? sentences.length - 2 : sentences.length - 1;
        sentences.forEach((sentence, si) => {
          if (si < firstOfTemplate) return; // another instruction of the example
          const words = sentence.split(' ');
          words.forEach((w, i) => {
            if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole)
            const end = w.match(/[.,"]+$/)?.[0] ?? '';
            const changed = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
            const line = sentences.map((x, j) => (j === si ? changed : x)).join(' ');
            const mutated = [...lines.slice(0, last), line].join('\n');
            expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
          });
        });
      }
    });
  }
});

describe('std-ry5 Filter (parser/holes/filter.ts#isAttachHostKind; CR 303.4): "<Aura> attached to a <kind> [you control]"', () => {
  const targetFilter = (text: string): unknown => {
    const f = face(text, 'Instant');
    expect(understood(f), `${text}: ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
    return (f.abilities[0] as { effect: { targets: { filter: unknown }[] } }).effect.targets[0]!.filter;
  };
  it('"attached to a creature" names every creature as the host; "a creature you control" puts the controller on the host, not on the Aura', () => {
    expect(targetFilter('Destroy target Aura attached to an artifact.')).toEqual({ subtypes: ['Aura'], attachedToObject: { ref: 'each', filter: { types: ['Artifact'] } } });
    expect(targetFilter('Return target Aura attached to a creature you control to its owner\'s hand.')).toEqual({ subtypes: ['Aura'], attachedToObject: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } });
  });
  it('fails closed: a host with more than a card type and its controller is not read', () => {
    expect(level('Instant', 'Destroy target Aura attached to a creature with flying.')).not.toBe('full');
    expect(level('Instant', 'Destroy target Aura attached to a tapped creature.')).not.toBe('full');
  });
});

describe('std-ry5 Cond (parser/holes/cond.ts; CR 701.9a): "you\'ve discarded a card this turn"', () => {
  it('is a discard by you this turn, as an activation restriction (read as it is activated), an intervening "if" and a spell\'s condition', () => {
    const want = '{"cond":"happened","event":{"ev":"action","verb":"discard","actor":"you"},"scope":"turn"}';
    for (const [type, text] of [
      ['Artifact', '{T}: You gain 2 life. Activate only if you\'ve discarded a card this turn.'],
      ['Creature — Beast', 'At the beginning of your end step, if you discarded a card this turn, draw a card.'],
      ['Sorcery', 'Tap target creature. If you\'ve discarded a card this turn, draw a card.'],
    ] as const) {
      const f = face(text, type);
      expect(understood(f), text).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain(want);
    }
  });
  it('fails closed: "two cards" and another player are not read', () => {
    expect(level('Artifact', '{T}: You gain 2 life. Activate only if you\'ve discarded two cards this turn.')).not.toBe('full');
    expect(level('Artifact', '{T}: You gain 2 life. Activate only if an opponent discarded a card this turn.')).not.toBe('full');
  });
});

describe('std-ry5 announcement (actions/announce-cond.ts, model/forms.ts; CR 602.5b, 208.1): formidable', () => {
  it('"Activate only if creatures you control have total power 8 or greater" is a restriction the engine checks (no attestation)', () => {
    const d = compiled('Creature — Bear', '{1}{G}: Regenerate this creature. Activate only if creatures you control have total power 8 or greater.');
    expect(d.automation.level).toBe('full');
    expect(JSON.stringify(d.faces[0]!.abilities)).toContain('"onlyIf":{"cond":"compare","left":{"q":"stat","stat":"power","of":{"ref":"each","filter":{"types":["Creature"],"controller":"you"}},"sum":true}');
  });
  it('the greatest power among a group is still not read at announcement (it stays the controller\'s attestation)', () => {
    expect(level('Creature — Bear', '{1}{G}: Regenerate this creature. Activate only if the greatest power among creatures you control is 4 or greater.')).not.toBe('full');
  });
});

describe('std-ry5 renderer support and fail-closed rules (G6: the render gate is exact)', () => {
  it('render/np.ts: "cards in graveyards" is the set of cards in every graveyard; render/stat.ts: a plural subject "can\'t be the targets"', () => {
    expect(level('Enchantment', 'Creature cards in graveyards can\'t be the targets of spells or abilities.')).toBe('full');
  });
  it('model/cap-walk.ts: "Cards in graveyards lose all abilities" stays manual (the engine reads flashback from the card itself); on permanents it is full', () => {
    const d = compiled('Creature — Zombie', 'Cards in graveyards lose all abilities.');
    expect(d.automation.level).not.toBe('full');
    expect(level('Enchantment', 'Creatures your opponents control lose all abilities.')).toBe('full');
  });
  it('render/stat.ts: a turn-skip shield with more than two uses, or one for another player, has no wording here (fail closed)', () => {
    expect(level('Sorcery', 'You skip your next three turns.')).not.toBe('full');
    expect(level('Sorcery', 'Target opponent skips their next turn.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ry5 design 6.10 (local index): synthetic examples', () => {
  it('no std-ry5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const context = /^(Haste|Flying)$/;
    const verbatim = RY5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
