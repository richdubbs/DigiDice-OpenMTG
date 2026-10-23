/**
 * std-rx24 (wave 2, EDH lane rx24): the template data of parser/templates/zz-cloud/std-rx24.json and the round's other parser, renderer and keyword changes:
 *  - Cond (parser/holes/cond.ts#poisonCounters): "an opponent has three or more poison counters", "<player> has N or more poison counters", "<player> is poisoned"
 *    (CR 122.1f), rendered by render/cond.ts (family poisoned-one-or-more);
 *  - keywords umbra armor (CR 702.89a), jump-start (CR 702.133a) and champion (CR 702.72a) as keyword data; "Champion a Faerie" said with its article (render/kw.ts);
 *  - "~ enters with your choice of a <kind> counter or a <kind> counter on it" (render/stat.ts#enters) and the untap-step skips (CR 614.10a).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-rx24-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx24 from '../../../src/parser/templates/zz-cloud/std-rx24.json';
import review from '../../m5/golden/cards/cloud-std-rx24-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX24 = stdRx24 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for an entering choice or a trigger, else a sorcery. */
const typeOf = (text: string): string => (/enters with|^Whenever|^When/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;

const IDS = ['rep.stdrx24.enters.choiceOfTwoCounters', 'eff.stdrx24.skip.nextUntap', 'eff.stdrx24.skip.nextUntap.you'];

describe('std-rx24 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx24.json, after zz-cloud/std-rx18.json, before zz-cloud/std-rx3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx24.json');
    expect(files.indexOf('zz-cloud/std-rx24.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx18.json'));
    expect(files.indexOf('zz-cloud/std-rx24.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX24.map((t) => t.id)).toEqual(IDS);
    for (const t of RX24) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.stdrx24\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, stable on one or two hand-verified golden cards (tuning half) plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('rep.stdrx24.enters.choiceOfTwoCounters')).toEqual(['Ferocious Tigorilla']);
    expect(goldenUsing('eff.stdrx24.skip.nextUntap')).toEqual(['Yosei, the Morning Star']);
    expect(goldenUsing('eff.stdrx24.skip.nextUntap.you')).toEqual(['Avizoa']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX24) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'skip', 'skips', 'choice']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w === 'skips' ? 'skip' : w);
      }
    }
  });
});

describe('std-rx24 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX24) {
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
    [/\bnext untap step\b/, 'next upkeep'], [/\bnext untap step\b/, 'untap step'], [/\byour choice of\b/, 'two'], [/ or an? (\S+) counter on it/, ' and a $1 counter on it'],
    [/\bskips their\b/, 'untaps their'], [/^You skip your\b/m, 'You skip their'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx24 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX24) {
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

describe('std-rx24 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX24) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword of the card)
        const sentences = lines[last]!.split(/(?<=\.) /);
        const lastSentence = sentences.length - 1; // the sentence of the template (an earlier one is another instruction of the example)
        const words = sentences[lastSentence]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const line = [...sentences.slice(0, lastSentence), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join(' ');
          const mutated = [...lines.slice(0, last), line].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx24 Cond (parser/holes/cond.ts#poisonCounters; CR 122.1f): poison counters of players', () => {
  const left = (text: string, type = 'Creature — Horror'): unknown => {
    const f = face(text, type);
    expect(understood(f), `${text}: ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
    return f.abilities;
  };
  it('"an opponent has three or more poison counters": at least one opponent with at least three (countPlayers poisonIs), in a static, a cost change and an activation restriction', () => {
    for (const [type, text] of [
      ['Creature — Horror', 'As long as an opponent has three or more poison counters, this creature has deathtouch.'],
      ['Sorcery', 'This spell costs {1} less to cast if an opponent has three or more poison counters.\nDraw a card.'],
      ['Artifact', '{T}: You gain 1 life. Activate only if an opponent has three or more poison counters.'],
    ] as const) {
      expect(JSON.stringify(left(text, type)), text).toContain('"left":{"q":"countPlayers","of":{"ref":"each","who":"opponent"},"poisonIs":{"op":">=","n":3}}');
    }
  });
  it('"defending player is poisoned" (an intervening "if", CR 603.4) and "you have two or more poison counters": that one player\'s poison counters', () => {
    expect(JSON.stringify(left('Whenever this creature attacks, if defending player is poisoned, it gets +1/+1 until end of turn.'))).toContain('"left":{"q":"counters","on":{"ref":"defending"},"kind":"poison"},"op":">=","right":1');
    expect(JSON.stringify(left('As long as you have two or more poison counters, this creature gets +2/+2.'))).toContain('"left":{"q":"counters","on":{"ref":"you"},"kind":"poison"},"op":">=","right":2');
    // "an opponent is poisoned" is one or more for an opponent (family poisoned-one-or-more)
    expect(JSON.stringify(left('This creature has menace as long as an opponent is poisoned.'))).toContain('"poisonIs":{"op":">=","n":1}');
  });
  it('fails closed: "or fewer", an exact number, "each opponent who ..." and a group of players are not read', () => {
    expect(level('Creature — Horror', 'As long as an opponent has two or fewer poison counters, this creature has deathtouch.')).not.toBe('full');
    expect(level('Creature — Horror', 'As long as each opponent has three or more poison counters, this creature has deathtouch.')).not.toBe('full');
    expect(level('Sorcery', 'Each opponent who has three or more poison counters loses 2 life.')).not.toBe('full');
    expect(level('Creature — Horror', 'As long as a player is poisoned, this creature has deathtouch.')).not.toBe('full');
  });
});

describe('std-rx24 keywords (keywords/data; CR 702.89a, 702.133a, 702.72a)', () => {
  it('umbra armor: a static ability of the Aura with the umbraArmor replacement of the enchanted permanent\'s destruction', () => {
    const d = compiled('Enchantment — Aura', 'Enchant creature\nUmbra armor');
    expect(d.automation.level).toBe('full');
  });
  it('jump-start: the card is castable from the graveyard with a discard cost and exiled on leaving the stack (exileOnLeave); the line is full', () => {
    expect(level('Sorcery', 'Draw a card.\nJump-start')).toBe('full');
  });
  it('render/kw.ts: "Champion a Faerie", "Champion an Elf" and "Champion a Goblin or Shaman" are said with their article; the expansion links the exiled card (op:pay.costLink)', () => {
    for (const [type, text] of [['Creature — Faerie', 'Flying\nChampion a Faerie'], ['Creature — Elf', 'Champion an Elf'], ['Creature — Goblin Shaman', 'Champion a Goblin or Shaman'], ['Creature — Shapeshifter', 'Champion a creature']] as const) {
      expect(level(type, text), text).toBe('full');
    }
  });
});

describe('std-rx24 renderer support (G6: the render gate is exact)', () => {
  it('render/stat.ts#enters: an entering choice of two kinds of one counter only; riot (a counter or haste) stays the keyword\'s', () => {
    expect(level('Creature — Ape', 'This creature enters with your choice of a flying counter or a deathtouch counter on it.')).toBe('full');
    expect(level('Creature — Ape', 'This creature enters with your choice of a +1/+1 counter or haste.')).not.toBe('full');
    expect(level('Creature — Ape', 'This creature enters with your choice of two +1/+1 counters or a trample counter on it.')).not.toBe('full');
  });
  // std-ry3 changed this pin on purpose: render/stat.ts says the shield's player against the trigger's events now (render/state.ts outerTrigger)
  it('the untap-step skip of a triggered ability\'s "that player" is full since std-ry3 (the shield\'s player is the trigger\'s event player)', () => {
    expect(level('Creature — Snake', 'Whenever this creature deals combat damage to a player, that player skips their next untap step.')).toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx24 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx24 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RX24.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
