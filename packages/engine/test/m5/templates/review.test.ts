/**
 * WP21 review fixes ("never silently wrong", design 1.1, 6.4, 6.6, 6.8). Each describe block is one finding of the WP21 review; every text is a synthetic
 * wording (design 6.10). An ability "runs" only when it is automated, passes the render gate (G6) AND the engine has every capability it needs (G8): the
 * pipeline (WP18) degrades a unit with a missing capability to manual, so that is the test of "never fully automated".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import type { FaceParse } from '../../../src/parser/types';
import { capabilitiesOf, ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { hasQuality, parseQuality } from '../../../src/rules/quality';
import { SUBTYPE_QUALITY_WORDS } from '../../../src/cards/keywords';
import { lowerAnaphora, lowerTargets } from '../../../src/parser/lower';
import lexicon from '../../../src/parser/lexicon.generated.json';
import { A, T, creature, draft, freeze, unit } from '../lower/support';
import { act, find, passBoth, scenario, SRC_ROOT, synth } from '../helpers';
import { getCard } from '../../fixtures';
import { drive, objectTarget } from '../announce/support';
import { withAbilities } from '../zones/support';
import { automated, card, exampleCard, face, fullyAutomated, NEIGHBORS, options, WP21_FILES } from './support';

const OPTS = options(NEIGHBORS);
const json = (v: unknown): string => JSON.stringify(v);
const parse = (type: string, text: string): FaceParse => face(card('Test Card', type, text), OPTS);
/** Automated, through the render gate, and nothing the engine lacks (design 5.2, 6.8 G6 and G8). */
const runs = (f: FaceParse): boolean => fullyAutomated(f) && f.abilities.every((a) => missingCapabilities(a, ENGINE_CAPABILITIES).length === 0);
const needs = (f: FaceParse): string[] => f.abilities.flatMap((a) => capabilitiesOf(a));

describe('CR 122.1a, 122.1c, 122.1d, 122.1h, 122.1i: a counter kind whose rules the engine does not run is a capability (never silently inert)', () => {
  const cases: [string, string, string, string][] = [
    // T20 (FAST4): CR 122.1d stun counters are run by the engine now (rules/status.ts#stunInsteadOfUntap): see the test after this list
    // FAST5X E28: CR 122.1c shield counters are run by the engine now (effects/rule-replacements/shield.ts): see the test after this list
    // FAST5X E13: CR 122.1h finality counters are run by the engine now (effects/rule-replacements/finality.ts): see the test after this list
    // std-rx17: rad counters (CR 728.1, core/rad.ts) and every +X/+Y counter with fixed numbers (CR 122.1a, statics/live.ts#counterMods) are run by the engine
    // now: see the tests after this list. A +X/+Y counter named with X still is a capability nothing registers.
    ['CR 122.1a +x/+0', 'Instant', 'Put a +X/+0 counter on target creature.', 'counter:+x/+0'],
  ];
  for (const [rule, type, text, cap] of cases) {
    it(`${rule}: "${text}" needs ${cap} and is never fully automated`, () => {
      const f = parse(type, text);
      expect(needs(f)).toContain(cap);
      expect(ENGINE_CAPABILITIES.has(cap)).toBe(false);
      expect(runs(f)).toBe(false);
    });
  }

  it('CR 122.1i, 728.1 rad (std-rx17): "Target player gets three rad counters." needs counter:rad, which the engine registers (core/rad.ts), so it runs', () => {
    const f = parse('Sorcery', 'Target player gets three rad counters.');
    expect(needs(f)).toContain('counter:rad');
    expect(ENGINE_CAPABILITIES.has('counter:rad')).toBe(true);
    expect(runs(f)).toBe(true);
  });

  it('CR 122.1a (std-rx17): +0/+3, -2/-0 and +2/+2 counters change power and toughness in the core (statics/live.ts#counterMods): they need nothing new and run', () => {
    for (const [type, text] of [['Instant', 'Put a +0/+3 counter on target creature.'], ['Instant', 'Put a -2/-0 counter on target creature.'], ['Artifact Creature — Golem', '{3}: Draw a card, then move a +2/+2 counter from ~ onto target creature.']] as const) {
      const f = parse(type, text);
      expect(needs(f).filter((n) => n.startsWith('counter:')), text).toEqual([]);
      expect(runs(f), text).toBe(true);
    }
  });

  it('CR 122.1d stun (T20, FAST4): "Tap target creature and put two stun counters on it." needs counter:stun, which the engine registers, so it runs', () => {
    const f = parse('Instant', 'Tap target creature and put two stun counters on it.');
    expect(needs(f)).toContain('counter:stun');
    expect(ENGINE_CAPABILITIES.has('counter:stun')).toBe(true);
    expect(runs(f)).toBe(true);
  });

  it('CR 122.1c shield (FAST5X E28): "Put a shield counter on target creature you control." needs counter:shield, which the engine registers, so it runs', () => {
    const f = parse('Sorcery', 'Put a shield counter on target creature you control.');
    expect(needs(f)).toContain('counter:shield');
    expect(ENGINE_CAPABILITIES.has('counter:shield')).toBe(true);
    expect(runs(f)).toBe(true);
  });

  it('CR 122.1h finality (FAST5X E13): a return "with a finality counter on it" needs counter:finality, which the engine registers, so it runs', () => {
    const f = parse('Sorcery', 'Return target creature card from your graveyard to the battlefield with a finality counter on it.');
    expect(needs(f)).toContain('counter:finality');
    expect(ENGINE_CAPABILITIES.has('counter:finality')).toBe(true);
    expect(runs(f)).toBe(true);
  });

  it('CR 122.1a-b, 122.1e-g: +1/+1, -1/-1, keyword counters (statics/live.ts), loyalty, defense, poison (state-based actions) and counters without rules need nothing new', () => {
    for (const text of ['Put two +1/+1 counters on target creature.', 'Put a -1/-1 counter on target creature.', 'Put a flying counter on target creature.', 'Target player gets two poison counters.']) {
      const f = parse('Instant', text);
      expect(needs(f).filter((c) => c.startsWith('counter:')), text).toEqual([]);
      expect(runs(f), text).toBe(true);
    }
    expect(needs(parse('Artifact', '{T}: Put a charge counter on ~.')).filter((c) => c.startsWith('counter:'))).toEqual([]);
  });

  it('CR 122.6, 614.1c: the walker names the kind wherever counters are put (a cost, an `enters` replacement, a token, a destination)', () => {
    const walk = (a: unknown): string[] => capabilitiesOf(a as AbilityDef).filter((c) => c.startsWith('counter:'));
    expect(walk({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'putCounters', counter: 'stun', count: 1, self: true }] }, effect: { targets: [], steps: [] } })).toEqual(['counter:stun']);
    expect(walk({ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: 'shield', count: 1 }] }, selfReplacement: true }] })).toEqual(['counter:shield']);
    expect(walk({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'removeCounters', from: { ref: 'self' }, kind: 'stun', count: 1 }] } })).toEqual([]); // removing a counter needs none of its rules
  });
});

describe('design 6.4: the objects a condition names are candidates for a pronoun (an intervening "if" included, CR 603.4)', () => {
  it('"When this Aura enters, if enchanted creature is green, tap it": two candidates (the Aura, the enchanted creature): manual, never the Aura', () => {
    const f = parse('Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, if enchanted creature is green, tap it.');
    expect(json(f.abilities)).not.toContain('{"op":"tap","what":{"ref":"self"}}');
    expect(automated(f.abilities)).toBe(false);
    expect(f.diagnostics.some((d) => d.code === 'unbound-reference' && /2 compatible/.test(d.message))).toBe(true);
  });
  it('"When this Aura enters, if enchanted permanent is untapped, tap it": manual, never tapping the Aura', () => {
    const f = parse('Enchantment — Aura', 'Enchant permanent\nWhen this Aura enters, if enchanted permanent is untapped, tap it.');
    expect(json(f.abilities)).not.toContain('{"op":"tap","what":{"ref":"self"}}');
    expect(automated(f.abilities)).toBe(false);
  });
});

describe('design 3.1 rules 1 and 4, CR 400.7, 611.2c: an effect that applies to an object after it moved follows the move\'s binding', () => {
  it('"Return target creature card ... to the battlefield. It gets +2/+2 until end of turn.": never the stale target handle', () => {
    const f = parse('Sorcery', 'Return target creature card from your graveyard to the battlefield. It gets +3/+1 until end of turn.');
    expect(json(f.abilities)).not.toContain('"affects":{"ref":"target","id":"t0"}');
    // FAST2 T10: the renderer names a move's binding ("it", render/steps-zones.ts#bindMoved): the effect applies to the returned creature
    expect(runs(f)).toBe(true);
    expect(json(f.abilities)).toContain('"affects":{"ref":"bound","name":"moved"}');
  });
  it('the lowering binds `affects` (and a restriction\'s `subject`) to the moving step\'s `as`', () => {
    const it_ = (): unknown => A({ sort: 'object', number: 'singular', text: 'it' });
    const d = lowerAnaphora(lowerTargets(freeze(draft([
      unit(0, 'destroy target creature', [{ op: 'destroy', what: T(creature()) }]),
      unit(1, 'it gets +1/+1', [{ op: 'effect', effects: [{ s: 'continuous', affects: it_(), mods: [{ layer: '7c', power: 1, toughness: 1 }] }, { s: 'restrict', subject: it_(), action: 'block', mode: 'cant' }], duration: { d: 'endOfTurn' } }]),
    ]))));
    expect(d.units[0]!.steps).toEqual([{ op: 'destroy', what: { ref: 'target', id: 't0' }, as: 'moved' }]);
    expect(json(d.units[1]!.steps)).toContain('"affects":{"ref":"bound","name":"moved"}');
    expect(json(d.units[1]!.steps)).toContain('"subject":{"ref":"bound","name":"moved"}');
  });
});

describe('CR 400.7, 400.7e-f: "~" in a trigger whose event moved the source', () => {
  it('CR 400.7e "When ~ dies, return ~ to ...": the step acts on the event\'s object in the graveyard, never the stale `self`', () => {
    for (const text of ['When ~ dies, return ~ to the battlefield.', "When ~ dies, return ~ to its owner's hand."]) {
      const f = parse('Creature — Spirit', text);
      expect(json(f.abilities), text).not.toContain('"what":{"ref":"self"}');
    }
  });
  // r5-fxz: the Aura's new object has a reference of its own now, `{ref:'self', moved:true}` (effects/refs.ts; played in test/cloud/r5-fxz/r5-fxz-scenarios.test.ts)
  it('CR 400.7f "When enchanted creature dies, return ~ to its owner\'s hand" (an Aura, put into the graveyard by CR 704.5m): the card the Aura became, never the Aura as it was', () => {
    const f = parse('Enchantment — Aura', "Enchant creature\nWhen enchanted creature dies, return ~ to its owner's hand.");
    expect(json(f.abilities)).not.toContain('"what":{"ref":"self"}');
    expect(json(f.abilities)).toContain('"what":{"ref":"self","moved":true}');
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 400.7e through the real engine: a parsed "When ~ dies, return ~ to its owner\'s hand." puts the card back into its owner\'s hand', () => {
    const f = parse('Creature — Phoenix', "When ~ dies, return ~ to its owner's hand.");
    expect(runs(f)).toBe(true);
    const phoenix = synth({ name: 'Test Phoenix', cost: '{1}{R}', type: 'Creature — Phoenix', pt: ['2', '2'], abilities: f.abilities });
    let s = scenario(['Doom Blade', 'Swamp'], { defs: [phoenix], p1: { hand: ['Doom Blade'], battlefield: ['Swamp', 'Swamp', 'Test Phoenix'] } });
    s = withAbilities(s, 'Doom Blade', face(getCard('Doom Blade'), OPTS).abilities);
    const id = find(s, 'Test Phoenix', 'battlefield', 'p1');
    s = passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Doom Blade', 'hand') }), [{ kind: 'chooseTargets', targets: [objectTarget(id)] }]));
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    const named = (zone: readonly string[]): number => zone.filter((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Phoenix').length;
    expect(named(s.zones.hand['p1']!)).toBe(1);
    expect(named(s.zones.graveyard['p1']!)).toBe(0);
  });

  it('CR 603.6a: in the source\'s own "enters" trigger "~" is still the source', () => {
    const f = parse('Creature — Spirit', 'When ~ enters, put a +1/+1 counter on ~.');
    expect(json(f.abilities)).toContain('"on":{"ref":"self"}');
  });
});

describe('CR 109.2, 115.3: "other" with no earlier target is "other than this object" only when this object could match', () => {
  it('an enchantment\'s "up to one other target creature card from your graveyard": "other" means the creature that died; manual, no superset target', () => {
    const f = parse('Enchantment', 'Whenever a creature you control dies, return up to one other target creature card from your graveyard to your hand.');
    expect(json(f.abilities)).not.toContain('"other":true');
    expect(runs(f)).toBe(false);
  });
  it('a sorcery\'s "each other Goblin you control" means other than the token just created: manual', () => {
    const f = parse('Sorcery', 'Create a 1/1 red Goblin creature token, then put a +1/+1 counter on each other Goblin you control.');
    expect(json(f.abilities)).not.toContain('"other":true');
    expect(runs(f)).toBe(false);
  });
  it('a creature\'s "When ~ dies, return another target artifact creature card from your graveyard to your hand" keeps other:true (the source is a creature card there)', () => {
    const f = parse('Creature — Spirit', 'When ~ dies, return another target artifact creature card from your graveyard to your hand.');
    expect(json(f.abilities)).toContain('"other":true');
    expect(fullyAutomated(f)).toBe(true);
  });
});

describe('CR 701.21a: a player sacrifices only permanents they control; the sacrifice step is the controller\'s', () => {
  it('"Tap target creature. Its controller may sacrifice it." is never automated as the controller of the spell sacrificing it', () => {
    expect(fullyAutomated(parse('Instant', 'Tap target creature. Its controller may sacrifice it.'))).toBe(false);
  });
  it('"{1}: Draw a card, then sacrifice ~." is still automated', () => {
    expect(runs(parse('Artifact Creature — Golem', '{1}: Draw a card, then sacrifice ~.'))).toBe(true);
  });
});

describe('CR 702.16a, 205.3m: protection from a creature type with an irregular plural', () => {
  it('"protection from Oxen" protects from an Ox; "Mice" from a Mouse; "Fungi" from a Fungus', () => {
    const chars = (sub: string) => ({ colors: [], types: ['Creature'], subtypes: [sub], supertypes: [] });
    expect(hasQuality(chars('Ox'), parseQuality('Oxen', SUBTYPE_QUALITY_WORDS)!)).toBe(true);
    expect(hasQuality(chars('Mouse'), parseQuality('Mice', SUBTYPE_QUALITY_WORDS)!)).toBe(true);
    expect(hasQuality(chars('Fungus'), parseQuality('Fungi', SUBTYPE_QUALITY_WORDS)!)).toBe(true);
    expect(hasQuality(chars('Goblin'), parseQuality('Oxen', SUBTYPE_QUALITY_WORDS)!)).toBe(false);
  });
  it('every plural of the generated lexicon names its own subtype (rules/quality.ts agrees with parser/lexicon.generated.json)', () => {
    const subs = (lexicon as { subtypes: { singular: string; plural: string }[] }).subtypes;
    const bad = subs.filter((s) => s.plural !== '' && /^[A-Z][a-z]+$/.test(s.plural) && !hasQuality({ colors: [], types: [], subtypes: [s.singular], supertypes: [] }, `subtype:${s.plural.toLowerCase()}`));
    expect(bad.map((s) => `${s.singular}/${s.plural}`)).toEqual([]);
  });
  it('the parsed "Equipped creature has protection from Oxen." protects from an Ox', () => {
    const f = parse('Artifact — Equipment', 'Equip {2}\nEquipped creature has protection from Oxen.');
    const q = /"quality":"([^"]+)"/.exec(json(f.abilities))?.[1];
    expect(q).toBeDefined();
    expect(hasQuality({ colors: [], types: ['Creature'], subtypes: ['Ox'], supertypes: [] }, q!)).toBe(true);
  });
});

/** Every committed template file under parser/templates (the bootstrap and every template package's files). */
function committedTemplates(): Template[] {
  const root = join(SRC_ROOT, 'parser/templates');
  const out: Template[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.json')) out.push(...(JSON.parse(readFileSync(join(dir, e.name), 'utf8')) as Template[]));
    }
  };
  walk(root);
  return out;
}

describe('ownership (STATUS.md, WP21 review): the keyword and static templates kept in effect/attach.json never compete with another package\'s', () => {
  it('each example of kw.equip.mana and sta.attached.* parses with exactly that template when every committed template is loaded (guard G5)', () => {
    const all = committedTemplates();
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    const opts = options([], { templates: all });
    for (const t of WP21_FILES['attach']!.filter((x) => x.kind !== 'effect')) {
      for (const e of t.examples) {
        const f = face(exampleCard(t, e.text), opts);
        expect(f.diagnostics.filter((d) => d.code === 'ambiguous'), `${t.id}: ${e.text}`).toEqual([]);
        expect(f.templatesUsed, `${t.id}: ${e.text}`).toContain(t.id);
        expect(fullyAutomated(f), `${t.id}: ${e.text}`).toBe(true);
      }
    }
  });
});
