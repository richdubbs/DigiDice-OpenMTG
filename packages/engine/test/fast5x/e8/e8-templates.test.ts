/**
 * FAST5X E8: the template data of parser/templates/zz-fast5x/e8.json (Rooms, CR 709.5: "when you unlock this door", "whenever you fully unlock a Room", eerie's
 * "whenever <an enchantment you control> enters and whenever you fully unlock a Room", "unlock a locked door of", "lock or unlock a door of", "spend this mana
 * only to cast Room spells and unlock doors") and the renderer additions the mechanic needed (render/evt.ts, render/abil.ts, render/steps-lasting.ts,
 * render/steps-cards.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate; every counter-example
 * does not parse or parses to different JSON; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are
 * synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e8 from '../../../src/parser/templates/zz-fast5x/e8.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E8 = e8 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const card = (type: string, text: string) => ({ name: 'Example Parlor', layout: 'normal', type_line: type, oracle_text: text, ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) }) as never;
const face = (text: string, type: string) => parseCard(card(type, text), OPTS).faces[0]!;
const typeFor = (text: string): string =>
  /unlock ~/.test(text) ? 'Enchantment — Room' : /^\{[^}]*\}(, \{T\})?:|^\{T\}:/.test(text) ? (/Add \{/.test(text) ? 'Land' : 'Artifact') : /^(Unlock|Lock)/.test(text) ? 'Sorcery' : 'Enchantment Creature — Spirit';
const parsedWith = (text: string) => face(text, typeFor(text));
const trig = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { trigger: unknown }).trigger;

describe('E8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e8.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e8.json');
    expect(files.indexOf('zz-fast5x/e8.json')).toBeGreaterThan(files.indexOf('zz-fast5x/e4.json'));
    expect(files.indexOf('zz-fast5x/e8.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E8.length).toBe(7);
    for (const t of E8) {
      expect(t.id, t.id).toMatch(/^(trg|rid|eff)\.e8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E8) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E8) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        // FAST5X E23: the stable general spending-restriction template reads this sentence to the same JSON (asserted below), and a stable reading wins over
        // an experimental one (parser/parse.ts, design 6.9, guard G10)
        const same = t.id === 'rid.e8.mana.roomAndUnlock' ? ['rid.e8.mana.roomAndUnlock', 'rid.e23.mana.spendOnly'] : [t.id];
        expect(f.templatesUsed.some((id) => same.includes(id)), e.text).toBe(true);
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

describe('E8 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E8) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty';
          const mutated = [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(face(mutated, typeFor(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('E8 lowering: what the Room shapes mean', () => {
  it('CR 709.5h, 709.5j: on a Room, "this door" is the door the ability is on (the parser reads it as the object itself, the trigger names the door)', () => {
    const f = face('When you unlock this door, draw a card.', 'Enchantment — Room');
    expect(trig(f)).toEqual({ on: [{ ev: 'becomes', what: 'unlocked', object: { self: true }, door: 'this' }] });
    expect(automated(f.abilities) && f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 709.5i: eerie names two events, either of which triggers it', () => {
    const f = face('Whenever an enchantment you control enters and whenever you fully unlock a Room, this creature gets +1/+1 until end of turn.', 'Creature — Spirit');
    expect(trig(f)).toEqual({ on: [{ ev: 'zoneChange', subject: { types: ['Enchantment'], controller: 'you' }, to: 'battlefield' }, { ev: 'becomes', what: 'fullyUnlocked', object: { subtypes: ['Room'] } }] });
    expect(automated(f.abilities) && f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 106.6, 709.5e: the Room-and-unlock mana restriction', () => {
    const f = face('{T}: Add {R}. Spend this mana only to cast Room spells and unlock doors.', 'Land');
    expect(JSON.stringify(f.abilities[0])).toContain('"restriction":{"spells":{"subtypes":["Room"]},"unlock":true}');
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
});
