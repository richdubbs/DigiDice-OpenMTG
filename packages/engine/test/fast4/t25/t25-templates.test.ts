/**
 * FAST4 T25: the template data of parser/templates/zz-fast4/t25.json (one-shot effects on permanents and spells: damage, removal, control, colors, Living
 * Death, the top or bottom of a library, a sacrifice at the next end step), the hole-grammar readings the package added (parser/holes/filter.ts "with power
 * or toughness N or greater", parser/holes/object.ts "each of up to three targets" and the serial comma of a list of targets) and the renderer readings the
 * shapes needed (design 6.8 G6: render/fold.ts, render/mods.ts, render/np.ts, render/refs.ts, render/steps-life.ts, render/steps-util.ts). Guard G9 (design
 * 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T25 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t25 from '../../../src/parser/templates/zz-fast4/t25.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T25 = t25 as Template[];
const OPTS = defaultParseOptions();
/** A trigger needs a permanent to live on (CR 113.6): an example that is a triggered ability is a creature's; anything else as the m5 support builds it. */
const cardFor = (t: Template, text: string): OracleCard =>
  /^(When|Whenever|At) /m.test(text) ? ({ name: 'Example Wisp', layout: 'normal', mana_cost: '{1}', type_line: 'Creature — Spirit', oracle_text: text, power: '2', toughness: '2', colors: [] } as unknown as OracleCard) : exampleCard(t, text);
const parsedWith = (t: Template, text: string) => parseCard(cardFor(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const stepsOf = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { steps: unknown[] } }).effect.steps;
const targetsOf = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { targets: unknown[] } }).effect.targets;
const ok = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('T25 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t25.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t25.json');
    expect(files.indexOf('zz-fast4/t25.json')).toBeGreaterThan(files.indexOf('zz-fast4/t22.json'));
    expect(files.indexOf('zz-fast4/t25.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T25.length).toBe(11);
    for (const t of T25) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t25\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T25) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T25 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T25) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

describe('T25 lowering: what the shapes mean', () => {
  it('CR 105.3, 611.2a: "target spell or permanent becomes white" is a layer-5 color set with no duration (permanent), on a spell or a permanent', () => {
    const f = face('Instant', 'Target spell or permanent becomes white.');
    expect(f.templatesUsed).toContain('eff.t25.becomes.color.permanent');
    expect(targetsOf(f)).toEqual([{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target spell or permanent', filter: { zone: ['stack', 'battlefield'] } }]);
    expect(stepsOf(f)).toEqual([{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 5, colors: { set: ['W'] } }] }] }]);
    // with a duration it stays the older template's reading (until end of turn)
    expect(face('Instant', 'Target spell or permanent becomes white until end of turn.').templatesUsed).not.toContain('eff.t25.becomes.color.permanent');
  });
  it('CR 108.3, 613.1b: "each player gains control of all creatures they own" is layer 2 to the owner of each object (the set locked as it begins)', () => {
    const f = face('Land', '{T}: Each player gains control of all creatures they own.');
    expect(stepsOf(f)).toEqual([{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: 2, controller: { ref: 'ownerOf', object: { ref: 'subject' } } }] }] }]);
  });
  it('CR 401.1, 608.2d: the owner chooses top or bottom; one move per choice', () => {
    const f = face('Instant', "Target creature's owner puts it on their choice of the top or bottom of their library.");
    const steps = stepsOf(f) as { op: string; who?: unknown; options?: unknown }[];
    expect(steps.map((s) => s.op)).toEqual(['chooseValue', 'if', 'if']);
    expect(steps[0]).toMatchObject({ who: { ref: 'ownerOf', object: { ref: 'target', id: 't0' } }, what: 'option', options: ['top', 'bottom'] });
    expect(JSON.stringify(steps[1])).toContain('"position":"top"');
    expect(JSON.stringify(steps[2])).toContain('"position":"bottom"');
  });
  it('CR 701.21a: Living Death\'s sacrifice is each player\'s, of what they control (never the controller of the spell sacrificing it all)', () => {
    const f = face('Sorcery', 'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.');
    const steps = stepsOf(f) as { op: string }[];
    expect(steps.map((s) => s.op)).toEqual(['move', 'sacrificeChoice', 'move']);
    expect(steps[1]).toMatchObject({ who: { ref: 'each', who: 'player' }, filter: { types: ['Creature'] }, mode: 'all' });
    expect(steps[2]).toMatchObject({ what: { ref: 'bound', name: 'exiledThisWay' }, to: { zone: 'battlefield', controller: 'owner' } });
  });
  it('CR 102.3: "each other opponent" after "deals combat damage to an opponent" is the opponents other than the event\'s recipient', () => {
    const f = face('Creature — Monk', 'Whenever ~ deals combat damage to an opponent, it deals that much damage to each other opponent.');
    expect(ok(f)).toBe(true);
    expect(JSON.stringify(stepsOf(f))).toContain('"to":{"ref":"otherOpponents","than":{"ref":"event","role":"recipient"}}');
    // no event that names a player: "each other opponent" has nothing to be other than, and is not read
    expect(ok(face('Creature — Monk', 'When ~ enters, it deals 2 damage to each other opponent.'))).toBe(false);
  });
  it('CR 603.7a, 118.12: "If you do, sacrifice it at the beginning of the next end step" creates the delayed trigger only if you did (never a delayed "if you do")', () => {
    const f = face('Artifact Creature — Toy', 'Whenever ~ attacks, you may have it get +3/+0 until end of turn. If you do, sacrifice it at the beginning of the next end step.');
    expect(ok(f)).toBe(true);
    const steps = stepsOf(f) as { op: string; then?: { op: string }[] }[];
    expect(steps.map((s) => s.op)).toEqual(['may', 'if']);
    expect(steps[1]!.then!.map((s) => s.op)).toEqual(['delay']);
  });
});

describe('T25 hole grammar and renderer readings (existing templates, new wordings)', () => {
  it('CR 208.1: "with power or toughness 4 or greater" is anyOf power, toughness with the one comparison; rendered back exactly', () => {
    const f = face('Instant', 'Destroy target creature with power or toughness 4 or greater.');
    expect(ok(f)).toBe(true);
    expect((targetsOf(f) as { filter: unknown }[])[0]!.filter).toEqual({ types: ['Creature'], anyOf: [{ power: { op: '>=', value: 4 } }, { toughness: { op: '>=', value: 4 } }] });
    expect(ok(face('Instant', 'Exile target creature an opponent controls with power or toughness 2 or less.'))).toBe(true);
    // never "without power or toughness", and no other quantity after it
    expect(ok(face('Instant', 'Destroy target creature without power or toughness 4 or greater.'))).toBe(false);
  });
  it('CR 120.3, 601.2c: "each of up to three targets" is one spec of up to three "any target" targets; the damage is not divided', () => {
    const f = face('Sorcery', '~ deals 2 damage to each of up to three targets.');
    expect(ok(f)).toBe(true);
    expect(targetsOf(f)).toEqual([{ id: 't0', kind: 'anyTarget', min: 0, max: 3, text: 'each of up to three targets' }]);
    expect(stepsOf(f)).toEqual([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2 }]);
    expect(ok(face('Sorcery', '~ deals 2 damage to each of up to two target creatures.'))).toBe(true);
    // a single target has no "each of"
    expect(ok(face('Sorcery', '~ deals 2 damage to each of any target.'))).toBe(false);
  });
  it('CR 115.1: "A, B, and C" with the serial comma is three target specs of one destroy (one event, CR 701.8a)', () => {
    const f = face('Instant', 'Destroy up to one target artifact, up to one target creature, and up to one target land.');
    expect(ok(f)).toBe(true);
    expect((targetsOf(f) as { min: number; max: number }[]).map((t) => [t.min, t.max])).toEqual([[0, 1], [0, 1], [0, 1]]);
    expect(stepsOf(f)).toEqual([{ op: 'destroy', what: { ref: 'union', of: [{ ref: 'target', id: 't0' }, { ref: 'target', id: 't1' }, { ref: 'target', id: 't2' }] } }]);
  });
  it('CR 109.4: "each opponent and each creature they control": the creatures your opponents control', () => {
    const f = face('Sorcery', '~ deals 3 damage to each opponent and each creature they control.');
    expect(ok(f)).toBe(true);
    expect(JSON.stringify(stepsOf(f))).toContain('"controller":"opponent"');
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bdestroy\b/, 'exile'], [/\bowner\b/, 'controller'], [/\btop or bottom\b/, 'top'], [/\beach opponent\b/, 'each player'], [/\bthey control\b/, 'you control'],
    [/\bthey own\b/, 'they control'], [/\bother opponent\b/, 'opponent'], [/\bnext end step\b/, 'next upkeep'], [/\bIf you do\b/, "If you don't"], [/\bsacrifices\b/, 'exiles'],
    [/\bblack\b/, 'black and green'], [/\bgreen\b/, 'green and white'], [/\bonto the battlefield\b/, 'into their hand'], [/\bthis way\b/, 'that way'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T25 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T25) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T25 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T25) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** Templates whose pattern is the whole sentence of the cards it is for, with no hole to vary (Living Death, Living End): its examples are that sentence. */
const LITERAL = new Set(['eff.t25.eachPlayer.livingDeath']);

describe.skipIf(index === null)('T25 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T25.filter((t) => !LITERAL.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
