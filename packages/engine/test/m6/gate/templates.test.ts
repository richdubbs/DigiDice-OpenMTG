/**
 * M6-10 (m6 design 5 "M6-10", 6): the template data of parser/templates/zz-m6/gate.json, the shapes that kept acceptance cards of the M6 gate from being full on
 * the game path although the engine already ran their JSON (M6-1, M6-2): "enter as a copy ..., except ..." (CR 707.9b, 707.9e), "Creatures you control enter as
 * a copy of ~" (CR 614.1c), "Create a token that's a copy of ..., except it's a 1/1 green Frog" (CR 707.9b), the doubling and "plus 1" damage replacements
 * (CR 614.1a), "Target player skips their next draw step" (CR 614.10a), the empty-library win (CR 614.6), the redirection to an Aura's creature (CR 614.9) and the land types of Blood Moon and Urborg (CR 305.7),
 * with the renderer readings they needed (render/stat.ts, render/evt.ts, render/mods.ts, render/copy-except.ts). Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; guard G2: a nonsense word in
 * place of any word of an example never leaves the same automated ability. Parsed with the default template set (what the game compiles with).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import gate from '../../../src/parser/templates/zz-m6/gate.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const GATE = gate as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** The card an example is printed on: copy statics on a creature, the redirection on an Aura, the damage and draw statics on an enchantment, effects on a sorcery. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.id.startsWith('rep.m6.enters.copy') || t.id === 'rep.m6.draw.emptyLibrary.win') return card('Example Mimic', 'Creature — Shapeshifter', text, { mana_cost: '{X}{3}{U}', power: '0', toughness: '0' });
  if (t.id === 'rep.m6.damage.you.redirect') return card('Example Ward Charm', 'Enchantment — Aura', text, { mana_cost: '{2}{W}' });
  if (t.kind === 'static') return card('Example Hearth', 'Enchantment', text, { mana_cost: '{2}{R}' });
  return card('Example Lesson', 'Sorcery', text, { mana_cost: '{1}{U}' });
}
const parsedFor = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('M6-10 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-m6/gate.json, path order: after zz-fast*/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-m6/gate.json');
    expect(files.indexOf('zz-m6/gate.json')).toBeGreaterThan(files.indexOf('zz-fast3/t14.json'));
    expect(files.indexOf('zz-m6/gate.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, is stable, of version 6, and needs nothing the engine lacks', () => {
    expect(GATE.length).toBe(13);
    for (const t of GATE) {
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.m6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(6);
      for (const n of t.needs ?? []) expect(ENGINE_CAPABILITIES.has(n), `${t.id}: ${n}`).toBe(true);
    }
  });

  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of GATE) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', 'additional', 'double']) {
        if (words.includes(w)) expect((t.consumes ?? []).includes(w), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('M6-10: what the templates build', () => {
  const ab = (id: string, text: string) => bare(parsedFor(GATE.find((t) => t.id === id)!, text).abilities);

  it('CR 707.9b, 707.9d: "except it\'s 5/5" is a layer 7b exception of the copy (the copied P/T-defining ability is dropped by the copy effect)', () => {
    expect(ab('rep.m6.enters.copy.pt', "You may have ~ enter as a copy of any creature on the battlefield, except it's 5/5.")[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'replace', body: { b: 'enters', copy: { of: { types: ['Creature'] }, optional: true, except: [{ layer: '7b', power: 5, toughness: 5 }] } } }],
    });
  });

  it('CR 707.9e: "except it enters with X additional +1/+1 counters on it" is an additional effect, not a copiable value', () => {
    expect(ab('rep.m6.enters.copy.additionalCounters', 'You may have ~ enter as a copy of any creature on the battlefield, except it enters with X additional +1/+1 counters on it.')[0]).toMatchObject({
      effects: [{ body: { b: 'enters', copy: { optional: true, additional: [{ counters: [{ kind: '+1/+1', count: { q: 'X' } }] }] } } }],
    });
  });

  it('CR 707.9b, 707.9e: Spark Double\'s exceptions: a +1/+1 counter if a creature, a loyalty counter if a planeswalker, and not legendary', () => {
    const [a] = ab('rep.m6.enters.copy.sparkDouble', GATE.find((t) => t.id === 'rep.m6.enters.copy.sparkDouble')!.examples[0]!.text);
    expect(a).toMatchObject({
      effects: [{
        body: {
          b: 'enters',
          copy: {
            optional: true, except: [{ layer: 4, supertypes: { remove: ['Legendary'] } }],
            additional: [{ if: { types: ['Creature'] }, counters: [{ kind: '+1/+1', count: 1 }] }, { if: { types: ['Planeswalker'] }, counters: [{ kind: 'loyalty', count: 1 }] }],
          },
        },
      }],
    });
    expect(JSON.stringify((a as { effects: { body: { copy: { of: unknown } } }[] }).effects[0]!.body.copy.of)).toContain('"you"');
  });

  it('CR 614.1c: "Creatures you control enter as a copy of ~" replaces the entering of the others with a copy of this permanent', () => {
    expect(ab('rep.m6.enters.copy.ofSelf', 'Creatures you control enter as a copy of ~.')[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' }, body: { b: 'enters', copy: { of: { self: true }, optional: false } } }],
    });
  });

  it('CR 614.1a: double damage and "plus 1" from a red source to a player are amount modifications of the damage event', () => {
    expect(ab('rep.m6.damage.double.any', 'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.')[0]).toMatchObject({
      effects: [{ s: 'replace', replaces: { ev: 'damage' }, body: { b: 'modify', amount: { mul: 2 } } }],
    });
    expect(ab('rep.m6.damage.coloredSource.player.plus', 'If a red source would deal damage to a player, it deals that much damage plus 1 to that player instead.')[0]).toMatchObject({
      effects: [{ s: 'replace', replaces: { ev: 'damage', source: { colors: ['R'] }, recipient: { player: 'any' } }, body: { b: 'modify', amount: { add: 1 } } }],
    });
  });

  it('CR 614.10a: "Target player skips their next draw step" is a one-use skip shield on that player\'s draw step', () => {
    expect(ab('eff.m6.skip.nextDraw', 'Target player skips their next draw step.')[0]).toMatchObject({
      kind: 'spell',
      effect: { steps: [{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'replace', replaces: { ev: 'step', step: 'draw', whose: { ref: 'target' } }, body: { b: 'skip' }, shield: { uses: 1 } }] }] },
    });
  });

  it('CR 614.6, 614.9: the empty-library win and the redirection of all damage dealt to you', () => {
    expect(ab('rep.m6.draw.emptyLibrary.win', 'If you would draw a card while your library has no cards in it, you win the game instead.')[0]).toMatchObject({
      effects: [{ replaces: { ev: 'draw', player: 'you' }, condition: { cond: 'compare', op: '==', right: 0 }, body: { b: 'instead', do: [{ op: 'winGame' }] } }],
    });
    const pariah = ab('rep.m6.damage.you.redirect', 'Enchant creature\nAll damage that would be dealt to you is dealt to enchanted creature instead.');
    expect(pariah[1]).toMatchObject({ effects: [{ replaces: { ev: 'damage', recipient: { player: 'you' } }, body: { b: 'redirect', to: { ref: 'attachedTo' } } }] });
  });

  it('CR 305.7: "Nonbasic lands are Mountains" sets the land type of every nonbasic land; "Each land is a Swamp in addition to its other land types" adds one', () => {
    expect(ab('sta.m6.nonbasic.mountains', 'Nonbasic lands are Mountains.')[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Land'], notSupertypes: ['Basic'] } }, mods: [{ layer: 4, subtypes: { set: ['Mountain'] } }] }],
    });
    expect(ab('sta.m6.eachLand.addType', 'Each land is a Swamp in addition to its other land types.')[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Land'] } }, mods: [{ layer: 4, subtypes: { add: ['Swamp'] } }] }],
    });
  });

  it('CR 707.9b: "except it\'s a 1/1 green Frog" sets base P/T, color and creature type of the token copy', () => {
    const [a] = ab('eff.m6.copy.token.ptColorSubtype', "Create a token that's a copy of target creature, except it's a 1/1 green Frog.");
    expect(a).toMatchObject({
      effect: { steps: [{ op: 'copy', result: 'token', except: [{ layer: '7b', power: 1, toughness: 1 }, { layer: 5, colors: { set: ['G'] } }, { layer: 4, subtypes: { set: ['Frog'] } }] }] },
    });
  });
});

describe('M6-10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of GATE) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedFor(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedFor(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = parsedFor(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('M6-10 guard G2 (design 6.8): a nonsense word never leaves the same automated ability', () => {
  for (const t of GATE) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual or changes it`, () => {
      const e = t.examples[0]!;
      const orig = parsedFor(t, e.text);
      const words = e.text.split(' ');
      words.forEach((w, i) => {
        const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
        const f = parsedFor(t, mutated);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
      });
    });
  }
});
