/**
 * FAST4 T33: the template data of parser/templates/zz-fast4/t33.json (permanent statics: Aura and Equipment restrictions and type changes, evasion and
 * blocking statics, combat pump riders) and the parser and renderer additions the package's shapes needed (design 6.3-6.8: parser/holes/filter.ts,
 * parser/holes/object.ts, parser/lower/scope.ts, parser/lower/anaphora.ts; render/abil.ts, render/cond.ts, render/fold.ts, render/kw.ts, render/mods.ts,
 * render/np.ts, render/refs.ts, render/stat.ts, render/steps-lasting.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated
 * and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word
 * in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T33 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t33 from '../../../src/parser/templates/zz-fast4/t33.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T33 = t33 as Template[];
const OPTS = defaultParseOptions();
/** The example's card: a creature for an ability of the object itself ("~ can't be blocked", "{2}: ~ can block ..."), else the shared example card. */
const cardFor = (t: Template, text: string) => (/(^|\n|: )~ /.test(text) || /^When ~ enters|^Whenever ~ attacks/.test(text)
  ? { name: 'Example Wisp', layout: 'normal', type_line: 'Creature — Spirit', oracle_text: text, power: '2', toughness: '2' } as never
  : /^Equipped/m.test(text) ? { ...exampleCard(t, text), type_line: 'Artifact — Equipment' } : exampleCard(t, text));
const parsedWith = (t: Template, text: string) => parseCard(cardFor(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text, power: '2', toughness: '2' } as never, OPTS).faces[0]!;

describe('T33 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t33.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t33.json');
    expect(files.indexOf('zz-fast4/t33.json')).toBeGreaterThan(files.indexOf('zz-fast4/t30.json'));
    expect(files.indexOf('zz-fast4/t33.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T33.length).toBe(21);
    for (const t of T33) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(sta|eff)\.t33\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T33) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'must', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('T33 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T33) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /can't|can block|must|block it|gets|loses|is a|have|has/.test(l));
  const at = i < 0 ? lines.length - 1 : i;
  const body = lines[at]!.replace(/\.$/, '');
  const put = (b: string): string => [...lines.slice(0, at), `${b.replace(/\s+/g, ' ').trim()}.`, ...lines.slice(at + 1)].join('\n');
  const out = [put(`${body} unless it is blue`), put(`${body} instead`), put(`${body} at random`), put(`${body} twice`)];
  const swaps: [RegExp, string][] = [
    [/\bcan't be blocked\b/, "can't block"], [/\bcan't attack\b/, "can't block"], [/\bblock\b/, 'attack'], [/\byou control\b/, 'an opponent controls'],
    [/\byour graveyard\b/, 'your hand'], [/\bdefending player\b/, 'you'], [/\bthis turn\b/, 'this combat'], [/\beach combat\b/, 'this turn'],
    [/\ban additional\b/, 'two additional'], [/\ball abilities\b/, 'flying'], [/\bcolorless\b/, 'green'], [/\bmana abilities\b/, 'loyalty abilities'],
    [/\bnonbasic\b/, 'basic'], [/\bdeals\b/, 'prevents'], [/\bto you\b/, 'to any target'], [/\buntapped\b/, 'tapped'], [/\bcounters\b/, 'damage'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(put(body.replace(re, by)));
  return out;
}

describe('T33 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T33) {
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

describe('T33 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T33) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const at = Math.max(0, lines.findIndex((l) => /can't|can block|must|block it|gets|loses|is a|have|has/.test(l)));
        const words = lines[at]!.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutatedLine = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const mutated = [...lines.slice(0, at), mutatedLine, ...lines.slice(at + 1)].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T33 lowering: what the shapes mean', () => {
  const eff0 = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effects: unknown[] }).effects;
  const steps0 = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { steps: unknown[] } }).effect.steps;
  it('CR 509.1b, 506.2: "can\'t be blocked as long as defending player controls an artifact" is a restriction whose condition names the defending player', () => {
    const f = face('Creature — Serpent', "~ can't be blocked as long as defending player controls an artifact.");
    expect(f.abilities[0]).toMatchObject({ kind: 'static', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked',
      when: { cond: 'exists', of: { ref: 'each', filter: { controller: { ref: 'defending' }, anyOf: [{ types: ['Artifact'] }] } } } }] });
  });
  it('CR 601.2i: "if you\'ve cast two or more spells this turn" is the count of its controller\'s spells cast this turn (not a history question)', () => {
    const f = face('Creature — Rogue', "~ can't be blocked if you've cast two or more spells this turn.");
    expect(eff0(f)).toEqual([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked', when: { cond: 'compare', left: { q: 'spellsCastThisTurn' }, op: '>=', right: 2 } }]);
  });
  it('CR 509.1a, 611.2a: "can block an additional creature this turn" is a resolved extra block of the object itself; "each creature you control" a static', () => {
    const f = face('Creature — Human', '{2}: ~ can block an additional creature this turn.');
    expect((f.abilities[0] as unknown as { effect: { steps: unknown[] } }).effect.steps).toEqual([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'rule', rule: 'extraBlockers', value: 1, of: { self: true } }] }]);
    const g = face('Enchantment', 'Each creature you control can block an additional creature each combat.');
    expect(eff0(g)).toEqual([{ s: 'rule', rule: 'extraBlockers', value: 1, of: { types: ['Creature'], controller: 'you' } }]);
  });
  it('CR 509.1a, 509.1c: in "you may have target creature block it this turn if able" the creature blocked is the object itself, never the target', () => {
    const f = face('Creature — Insect', 'When ~ enters, you may have target creature block it this turn if able.');
    expect(steps0(f)).toEqual([{ op: 'may', who: { ref: 'you' }, do: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'mustIfAble', action: 'block', other: { is: { ref: 'self' } } }] }] }]);
    const g = face('Artifact — Equipment', 'Whenever equipped creature attacks, you may have target creature block it this turn if able.');
    expect(JSON.stringify(steps0(g))).toContain('"other":{"is":{"ref":"event","role":"attacker"}}');
  });
  it('CR 509.1: "the blocking creature" is the blocker of the trigger\'s block, whichever creature the trigger names first', () => {
    const f = face('Enchantment', 'Whenever a creature blocks a green creature, the blocking creature gets +1/+1 until end of turn.');
    expect(JSON.stringify(steps0(f))).toContain('"affects":{"ref":"event","role":"blocker"}');
    const g = face('Creature — Knight', 'Whenever ~ becomes blocked by a creature, the blocking creature gets -1/-1 until end of turn.');
    expect(JSON.stringify(steps0(g))).toContain('"affects":{"ref":"event","role":"blocker"}');
  });
  it('CR 205.1a, 305.7, 105.2c: "is a colorless Forest land" sets the card types and the land type, and no color', () => {
    const f = face('Enchantment — Aura', 'Enchant permanent\nEnchanted permanent is a colorless Forest land.');
    expect(f.abilities[1]).toMatchObject({ kind: 'static', effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, types: { set: ['Land'] }, subtypes: { set: ['Forest'] } }, { layer: 5, colors: { set: [] } }] }] });
  });
  it('CR 508.1b-c: "can\'t attack you or planeswalkers you control" is a ban on attacking you and one on attacking your planeswalkers', () => {
    const f = face('Enchantment', "Creatures with flying can't attack you or planeswalkers you control.");
    const subject = { ref: 'each', filter: { types: ['Creature'], keyword: 'flying' } };
    expect(eff0(f)).toEqual([
      { s: 'restrict', subject, mode: 'cant', action: 'attackPlayer', otherPlayer: { ref: 'you' } },
      { s: 'restrict', subject, mode: 'cant', action: 'attack', other: { types: ['Planeswalker'], controller: 'you' } },
    ]);
  });
  it('CR 700.9, 301.5, 122.1, 303.4: "modified", "attacking equipped", "with +1/+1 counters on them" and "other than enchanted creature" are filters', () => {
    expect(JSON.stringify(eff0(face('Creature — Spirit', 'Modified creatures you control have trample.')))).toContain('"filter":{"modified":true,"types":["Creature"],"controller":"you"}');
    expect(JSON.stringify(steps0(face('Creature — Human', 'Whenever you attack, target attacking equipped creature gains menace until end of turn.'))))
      .not.toContain('"op":"manual"');
    expect(JSON.stringify(f2('Enchantment', 'Creatures you control with +1/+1 counters on them have trample.'))).toContain('"counters":{"kind":"+1/+1"}');
    const d = face('Enchantment — Aura', 'Enchant creature\nWhen ~ enters, target creature you control other than enchanted creature gets +1/+1 until end of turn.');
    expect(JSON.stringify(d.abilities)).toContain('"attachedToSource":false');
  });
  it('fails closed: the shapes this package leaves manual stay manual (no attack costs, no bare "equipped creature" filter; the min-blockers hook is FAST5 T57)', () => {
    for (const [type, text] of [
      // (Standard round 5 r5-static: "Creatures can't attack you or planeswalkers you control unless their controller pays {2} for each of those creatures." is
      // read by sta.r5static.attackTax.youOrPlaneswalkers, the CR 508.1h-j attack-cost path of core/combat-tax.ts, played in test/cloud/r5-static/r5-static-tax.test.ts)
      ['Creature — Human', 'Whenever you attack, target equipped creature gains menace until end of turn.'], // "equipped creature" alone is the attached object (parser/holes/object.ts)
      // (Standard round 3 r3-fx: "~ can't be blocked if you've cast two or more creature spells this turn" is read by sta.r3fx.self.unblockable.if as a count of the
      // turn's cast events with a creature filter (CR 509.1b, 604.1, 611.3a), played in test/cloud/r3-fx/r3-fx-scenarios.test.ts; no longer a manual shape)
    ] as const) {
      const f = face(type, text);
      expect(automated(f.abilities) && f.gate.every((g) => g.ok), text).toBe(false);
    }
  });
});

const f2 = (type: string, text: string): unknown => face(type, text).abilities;

const index = localIndex();

/** Lines of other templates an example needs as they are: an Aura's enchant line, a keyword line. */
const SHARED_LINES = new Set(['Enchant creature', 'Enchant permanent', 'Flying', 'Flash', 'Vigilance']);

describe.skipIf(index === null)('T33 design 6.10: examples are synthetic', () => {
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
    const verbatim = T33.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
