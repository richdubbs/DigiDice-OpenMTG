/**
 * std-rx29 (wave 2, Standard lane rx29, computed quantities): the template data of parser/templates/zz-cloud/std-rx29.json and the round's parser, renderer and
 * engine support ("choose exactly N <permanents> you control"; the quantities "the difference between the chosen creatures' powers", "the amount of damage dealt
 * to it this turn", "their total power" and a permanent's base power; the renderer's "that token" (std-rx12's parser rule), "a permanent you own that your
 * opponents control" (std-rf's np change, ported) and the where-X folds). Guard G9 (design 6.8): every example lowers with its template and passes the exact
 * render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word
 * of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The
 * behavior is in std-rx29-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, renderAbility } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx29 from '../../../src/parser/templates/zz-cloud/std-rx29.json';
import r4copy from '../../../src/parser/templates/zz-cloud/r4-copy.json';
import review from '../../m5/golden/cards/cloud-std-rx29-review.json';
import r4review from '../../m5/golden/cards/cloud-r4-copy-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX = stdRx29 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

/** The type line of an example: a triggered ability's is a creature's (a trigger of "~ attacks" needs one), the others are sorceries. */
const face = (text: string, type = /^(When|Whenever|At)\b/.test(text) ? 'Creature — Elf' : 'Sorcery') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const EXPERIMENTAL = new Set<string>();

describe('std-rx29 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx29.json, after zz-cloud/std-rx19.json, before zz-cloud/std-rx3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx29.json');
    expect(files.indexOf('zz-cloud/std-rx29.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx19.json'));
    expect(files.indexOf('zz-cloud/std-rx29.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX.map((t) => t.id)).toEqual([
      'eff.stdrx29.choose.exactlyN.youControl', 'eff.stdrx29.youDrawX.and.pumpGrant.whereX', 'eff.stdrx29.forEach.powerAboveBase.counters.difference',
      'eff.stdrx29.cast.anyNumber.instantSorcery.free.fromAmong',
    ]);
    for (const t of RX) {
      expect(t.id, t.id).toMatch(/^eff\.stdrx29\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe(EXPERIMENTAL.has(t.id) ? 'experimental' : 'stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings: stable on one hand-verified golden card of this round plus these tests and the scenarios, a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('eff.stdrx29.choose.exactlyN.youControl')).toEqual(['Spry and Mighty']);
    expect(goldenUsing('eff.stdrx29.youDrawX.and.pumpGrant.whereX')).toEqual(['Spry and Mighty']);
    expect(goldenUsing('eff.stdrx29.forEach.powerAboveBase.counters.difference')).toEqual(['Sovereign Okinec Ahau']);
    expect(goldenUsing('eff.stdrx29.cast.anyNumber.instantSorcery.free.fromAmong')).toEqual(['Kylox, Visionary Inventor']);
  });
  it('design 6.9: r4-copy\'s eff.r4copy.mayHave.player.gainControl is stable on its one printing, Iroh, Tea Master, verified in r4-copy\'s review file (std-rx12 asked for it)', () => {
    const t = (r4copy as Template[]).find((x) => x.id === 'eff.r4copy.mayHave.player.gainControl')!;
    expect(t.status).toBe('stable');
    expect(goldenUsing('eff.r4copy.mayHave.player.gainControl', r4review as Golden)).toEqual(['Iroh, Tea Master']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx29 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        if (!EXPERIMENTAL.has(t.id)) expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
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
  const swaps: [RegExp, string][] = [
    [/\bexactly\b/, 'up to'], [/\byou control\b/, 'an opponent controls'], [/\bgreater than\b/, 'less than'], [/\bthe difference\b/, 'that many'],
    [/\binstant and\/or sorcery\b/, 'creature'], [/\bwithout paying their mana costs\b/, 'paying their mana costs'], [/\bwhere X is\b/, 'where Y is'], [/\bthen\b/, 'and'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx29 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx29 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the choice it reads)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (w.includes('/')) return; // a counter kind is any word (CR 122.1: the CounterKind hole reads one), so "+1/+1" is not replaced
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx29 parser support (fail closed)', () => {
  const level = (text: string, type = 'Creature — Elf') => compileCard(card('Example Relic', type, text, { power: '2', toughness: '2' })).automation.level;
  it('CR 107.1b: "the difference between the chosen creatures\' powers" with no choice before it is never automated', () => {
    expect(level("You draw X cards, where X is the difference between the chosen creatures' powers.", 'Sorcery')).not.toBe('full');
  });
  it('CR 400.7 (rules/history.ts#unanswerable): "the amount of damage dealt to it this turn" of an object that is not the source has no answer: not full', () => {
    expect(level('Whenever another creature you control dies, you gain X life, where X is the amount of damage dealt to it this turn.')).not.toBe('full');
    expect(level('Whenever another creature you control dies, create X 1/1 green Saproling creature tokens, where X is the amount of damage dealt to it this turn.')).not.toBe('full');
  });
  it('CR 120.3: in the object\'s own dies trigger it is a history question about the source itself', () => {
    const f = face('When this creature dies, create X 1/1 green Saproling creature tokens, where X is the amount of damage dealt to it this turn.');
    expect(JSON.stringify(f.abilities)).toContain('{"q":"happenedCount","event":{"ev":"damage","recipient":{"object":{"is":{"ref":"self"}}}},"scope":"turn","sum":"amount"}');
  });
  it('CR 608.2h: "their total power" with nothing named before it is never automated', () => {
    expect(level('Draw X cards, where X is their total power.', 'Sorcery')).not.toBe('full');
  });
});

describe('std-rx29 renderer support', () => {
  const render = (a: object): string => renderAbility(a as never, { selfNames: ['Test Card'] }).join(' ');
  it('CR 111.1 (std-rx12\'s parser rule): "that token" names the token just created even after a target permanent of no stated type', () => {
    const text = 'At the beginning of combat on your turn, you may have target opponent gain control of target permanent you control. When you do, create a 1/1 white Ally creature token. Put a +1/+1 counter on that token for each artifact you control.';
    expect(understood(face(text))).toBe(true);
  });
  it('CR 108.3, 109.4 (std-rf\'s np change): "permanents you own that your opponents control", the owner first', () => {
    expect(render({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'count', of: { ref: 'each', filter: { owner: 'you', controller: 'opponent' } } } }] } })).toMatch(/permanents you own that your opponents control/);
  });
  it('CR 613.4: a base power is "<object>\'s base power"; a difference of a group named by no choice has no words here', () => {
    expect(render({ kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }], steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'basePower', of: { ref: 'target', id: 't0' } } }] } })).toMatch(/base power/);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx29 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx29 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RX.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
