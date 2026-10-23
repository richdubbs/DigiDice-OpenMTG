/**
 * FAST5X E3: the template data of parser/templates/zz-fast5x/e3.json (saddle, CR 702.171: "when ~ enters and whenever it attacks while saddled", "becomes
 * saddled for the first time each turn", "becomes saddled until end of turn", the crew and saddle power statics of CR 702.122a / 702.171a) and the parser and
 * renderer additions the mechanic needed: "attacks while saddled" in the event hole (parser/holes/event.ts), "saddled" and "that saddled it this turn" in the
 * filter hole (parser/holes/filter.ts), the object itself with a status in the trigger's mentions (parser/lower/scope.ts, render/refs.ts), and the matching
 * render (render/evt.ts, render/np.ts, render/cond.ts, render/abil.ts, render/stat.ts, render/steps-lasting.ts). Guard G9 (design 6.8): every example lowers
 * with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; a nonsense word
 * in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e3 from '../../../src/parser/templates/zz-fast5x/e3.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E3 = e3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const card = (type: string, text: string) => ({ name: 'Example Steed', layout: 'normal', type_line: type, oracle_text: text, power: '3', toughness: '3' }) as never;
const face = (text: string, type = 'Creature — Horse Mount') => parseCard(card(type, text), OPTS).faces[0]!;
const typeFor = (text: string): string => (/^\{\d\}, \{T\}:/.test(text) ? 'Artifact' : 'Creature — Horse Mount');
const parsedWith = (text: string) => face(text, typeFor(text));
const trig = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { trigger: unknown }).trigger;
const steps = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { steps: unknown[] } }).effect.steps;

describe('E3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e3.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e3.json');
    expect(files.indexOf('zz-fast5x/e3.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5x/e3.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E3.length).toBe(5);
    for (const t of E3) {
      expect(t.id, t.id).toMatch(/^(trg|sta|eff)\.e3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) {
          const got = t.kind === 'trigger' ? trig(f) : bare(f.abilities);
          expect(got, e.text).toEqual(e.expect);
        }
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E3 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const at = lines.length - 1;
        const words = lines[at]!.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // CR 122.1: any word can name a kind of counter
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty';
          const mutated = [...lines.slice(0, at), [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('E3 lowering: what the saddle shapes mean', () => {
  it('CR 702.171b, 508.1: "whenever ~ attacks while saddled" is the attack of the object itself while it has the saddled designation; "it" is the object', () => {
    const f = face('Whenever ~ attacks while saddled, it gets +2/+1 until end of turn.');
    expect(trig(f)).toEqual({ on: [{ ev: 'attacks', attacker: { self: true, saddled: true } }] });
    expect(JSON.stringify(steps(f))).toContain('"affects":{"ref":"event","role":"attacker"}');
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 702.171c: "target creature that saddled it this turn" is a creature the object remembers as having saddled it', () => {
    const f = face('Whenever ~ attacks while saddled, put a +1/+1 counter on target creature that saddled it this turn.');
    expect(JSON.stringify(f.abilities[0])).toContain('"filter":{"types":["Creature"],"saddledThisTurn":{"ref":"self"}}');
    expect(automated(f.abilities) && f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 702.171b: "if ~ is saddled", "as long as ~ is saddled" and "a saddled creature" read the designation', () => {
    const f = face('Whenever ~ deals combat damage to a player, if ~ is saddled, draw a card.');
    expect((f.abilities[0] as unknown as { interveningIf: unknown }).interveningIf).toEqual({ cond: 'matches', object: { ref: 'self' }, filter: { saddled: true } });
    const g = face('As long as ~ is saddled, it has flying.');
    expect((g.abilities[0] as unknown as { condition: unknown }).condition).toEqual({ cond: 'matches', object: { ref: 'self' }, filter: { saddled: true } });
    const h = face('Whenever a saddled creature you control attacks, it gets +2/+2 until end of turn.');
    expect(trig(h)).toEqual({ on: [{ ev: 'attacks', attacker: { saddled: true, types: ['Creature'], controller: 'you' } }] });
    for (const x of [f, g, h]) expect(automated(x.abilities) && x.gate.every((r) => r.ok)).toBe(true);
  });
  it('design 6.2: a sentence that ends inside the quotes of a granted ability ends there ("... greater." Activate only as a sorcery.); a quote mid-sentence does not', () => {
    const f = face('{1}{W}, {T}, Sacrifice ~: Create a 1/1 colorless Pilot creature token with "This token saddles Mounts and crews Vehicles as though its power were 2 greater." Activate only as a sorcery.', 'Land');
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', sorcerySpeed: true, effect: { steps: [{ op: 'createToken', token: { subtypes: ['Pilot'], abilities: [{ kind: 'static', effects: [{ s: 'rule', rule: 'crewSaddlePowerBonus', value: 2 }] }] } }] } });
    expect(automated(f.abilities) && f.gate.every((g) => g.ok)).toBe(true);
    const g = face('Create a 1/1 colorless Pilot creature token with "This token saddles Mounts and crews Vehicles as though its power were 2 greater." Draw a card.', 'Sorcery');
    expect(JSON.stringify(g.abilities[0])).toContain('{"op":"draw","who":{"ref":"you"},"count":1}');
    expect(automated(g.abilities) && g.gate.every((x) => x.ok)).toBe(true);
    const h = face('{T}: Target creature you control gains "{T}: Add {G}." until end of turn.', 'Artifact');
    expect(JSON.stringify(h.abilities[0])).toContain('"duration":{"d":"endOfTurn"}');
  });
  it('a creature that attacks while saddled is not the object\'s attack with any other status, and "while" with another word stays manual', () => {
    for (const text of ['Whenever ~ attacks while tapped, draw a card.', 'Whenever ~ blocks while saddled, draw a card.', 'Whenever a creature attacks while saddled, draw a card.']) {
      const f = face(text);
      expect(automated(f.abilities) && f.gate.every((g) => g.ok) && JSON.stringify(f.abilities).includes('"saddled":true'), text).toBe(false);
    }
  });
});
