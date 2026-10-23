/**
 * WP14 review findings for the token ops (createToken, copy, cast) and the token definitions: each test is named after the rule the finding was about and
 * failed before the fix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/index';
import type { AbilityDef, EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { PREDEFINED_TOKENS, tokenCardDef } from '../../../src/effects/handlers/token-defs';
import { capabilitiesOf, ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import { renderGate } from '../../../src/render/gate';
import { chosenObject } from '../eval/helpers';
import { find, put, scenario, synth, tweak } from '../helpers';
import { pipeline } from '../zones/pipeline';
import { decisionOf, runProgram, withExamples } from '../zones/support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const spellOf = (effect: EffectProgram): AbilityDef => ({ kind: 'spell', text: 'x', effect });

/** Is every ability of this predefined token automated by this build (no manual ability, exact render gate, every capability present)? */
function automated(t: (typeof PREDEFINED_TOKENS)[number]): boolean {
  return t.faces.every((f) => (f.abilities as AbilityDef[]).every((a) => a.kind !== 'manual'
    && renderGate(a, a.text.split('\n'), { selfNames: [f.name, 'this token'], selfTypes: [...f.types, ...f.subtypes] }).ok
    && missingCapabilities(a, ENGINE_CAPABILITIES).length === 0));
}

describe('CR 111.10, design 5.2 and 10.3: a predefined token is classified from the engine\'s capabilities, never asserted', () => {
  it('CR 111.10b: a Food token is not full while the engine lacks what its ability needs (op:gainLife)', () => {
    const food = PREDEFINED_TOKENS.find((t) => t.name === 'Food')!;
    const needs = (food.faces[0]!.abilities as AbilityDef[]).flatMap((a) => missingCapabilities(a, ENGINE_CAPABILITIES));
    const def = tokenCardDef({ predefined: 'Food' });
    if ('reason' in def) throw new Error(def.reason);
    expect(def.automation.level === 'full').toBe(needs.length === 0);
  });

  it('CR 111.10: every predefined token is full exactly when all its abilities are automated, and the engine advertises it exactly then', () => {
    for (const t of PREDEFINED_TOKENS) {
      const def = tokenCardDef({ predefined: t.name });
      if ('reason' in def) throw new Error(def.reason);
      expect(def.automation.level === 'full', t.name).toBe(automated(t));
      expect(ENGINE_CAPABILITIES.has(`feature:token.${t.name.toLowerCase().replace(/ /g, '-')}`), t.name).toBe(automated(t));
    }
  });

  it('CR 111.10p, design 6.8: Virtuous Role, whose ability passes the exact render gate since WP22 fixed the "+1/+1 for each ..." reading (render/mods.ts), is full', () => {
    const def = tokenCardDef({ predefined: 'Virtuous Role' });
    if ('reason' in def) throw new Error(def.reason);
    expect(def.automation.level).toBe('full');
  });

  it('CR 111.10b: a card that creates a Food token needs what the Food\'s ability needs (the walker names the predefined token)', () => {
    const caps = capabilitiesOf(spellOf(prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Food' } }])));
    expect(caps).toContain('feature:token.food');
  });

  it('CR 111.4: an inline token with a keyword the engine lacks is not full', () => {
    const def = tokenCardDef({ name: 'Spirit', types: ['Creature'], subtypes: ['Spirit'], power: 1, toughness: 1, keywords: ['not-a-keyword'] });
    if ('reason' in def) throw new Error(def.reason);
    expect(def.automation.level).not.toBe('full');
  });
});

describe('CR 111.4: a token\'s name', () => {
  it('CR 111.4, 111.10a: a Treasure token (not named by CR 111.10a) is named "Treasure Token"; a Walker (named by 111.10d) is "Walker"; a Role is its name', () => {
    const name = (n: string): string => { const d = tokenCardDef({ predefined: n }); if ('reason' in d) throw new Error(d.reason); return d.faces[0]!.name; };
    expect(name('Treasure')).toBe('Treasure Token');
    expect(name('Food')).toBe('Food Token');
    expect(name('Incubator')).toBe('Incubator Token');
    expect(name('Walker')).toBe('Walker');
    expect(name('Cursed Role')).toBe('Cursed');
  });
});

describe('CR 608.2g, 733.1: a card cast while an effect resolves can\'t be taken back', () => {
  function board(): GameState {
    return withExamples(scenario(['Twincast', 'Lightning Bolt', 'Grizzly Bears', 'Mountain'], {
      p1: { hand: ['Twincast'], exile: ['Lightning Bolt'], battlefield: ['Mountain'] },
      p2: { battlefield: ['Grizzly Bears'] },
    }), 'Lightning Bolt');
  }
  const castBolt = (free: boolean): EffectStep => ({ op: 'cast', who: { ref: 'you' }, what: { ref: 'each', filter: { zone: 'exile', name: 'Lightning Bolt' } }, free }) as EffectStep;

  it('CR 608.2g: the targets decision of a resolution-time cast is not cancellable', () => {
    const d = decisionOf(() => runProgram(board(), { name: 'Twincast' }, prog([castBolt(true)])));
    expect(d.kind).toBe('chooseTargets');
    expect(d.cancellable).not.toBe(true);
  });

  it('CR 608.2g: the payment decision of a resolution-time cast is not cancellable', () => {
    const s = board();
    const pick = { kind: 'chooseTargets' as const, targets: [{ kind: 'object' as const, id: find(s, 'Grizzly Bears', 'battlefield') }] };
    const d = decisionOf(() => runProgram(s, { name: 'Twincast' }, prog([castBolt(false)]), [pick]));
    expect(d.kind).toBe('payCost');
    expect(d.cancellable).not.toBe(true);
  });
});

describe('CR 707.10f: a copy of a permanent spell', () => {
  it('CR 707.10f: "copy target permanent spell" is named by the walker; M6-2 registers it (the copy becomes a token as it resolves: core/move-parts/copy.ts)', () => {
    const spec: TargetSpec = { id: 't0', kind: 'spell', filter: { types: ['Artifact', 'Creature', 'Enchantment', 'Planeswalker', 'Battle'] }, min: 1, max: 1, text: 'target permanent spell' };
    const caps = capabilitiesOf(spellOf(prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [spec])));
    expect(caps).toContain('op:copy.permanentSpell');
    expect(ENGINE_CAPABILITIES.has('op:copy.permanentSpell')).toBe(true);
  });

  it('CR 707.10: "copy target instant or sorcery spell" (Twincast) is not', () => {
    const spec: TargetSpec = { id: 't0', kind: 'spell', filter: { types: ['Instant', 'Sorcery'] }, min: 1, max: 1, text: 'target instant or sorcery spell' };
    expect(capabilitiesOf(spellOf(prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [spec])))).not.toContain('op:copy.permanentSpell');
  });
});

describe('CR 303.4f-i, 301.5e: what a token enters attached to', () => {
  const pro = synth({ name: 'Test Pro Bear', cost: '{1}{W}', type: 'Creature — Bear', pt: ['2', '2'], abilities: [{ kind: 'keyword', keyword: 'protection', quality: 'type:Enchantment', text: 'protection from enchantments' } as AbilityDef] });

  function board(): GameState {
    return scenario(['Lightning Bolt', 'Grizzly Bears', 'Pacifism', 'Bonesplitter'], { defs: [pro], p1: { hand: ['Lightning Bolt'], battlefield: ['Bonesplitter'] }, p2: { battlefield: ['Grizzly Bears', 'Test Pro Bear'] } });
  }

  it('CR 303.4i, 702.16c: a Role token can\'t be attached to a creature with protection from enchantments, so it isn\'t created', () => {
    const s = board();
    const bear = find(s, 'Test Pro Bear', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bear)]] }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Wicked Role' }, attachTo: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.results[0]!.count).toBe(0);
    expect(pipeline.proposals.filter((p) => p.ev === 'createToken')).toEqual([]);
  });

  it('CR 303.4f: a Role token on a legal creature is created attached to it', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Monster Role' }, attachTo: { ref: 'target', id: 't0' } }], [creature]));
    const tok = r.state.zones.battlefield.find((id) => r.state.objects[id]!.kind === 'token')!;
    expect(r.state.objects[tok]!.attachedTo).toBe(bears);
  });

  it('CR 301.5e: an Equipment token "attached to" a creature that has left is created unattached', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const gone = tweak(s, (x) => { x.zones.battlefield = x.zones.battlefield.filter((id) => id !== bears); x.objects[bears]!.zone = 'graveyard'; x.zones.graveyard['p2']!.push(bears); });
    const r = runProgram(gone, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { name: 'Sword', types: ['Artifact'], subtypes: ['Equipment'] }, attachTo: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.results[0]!.count).toBe(1);
    const tok = r.state.zones.battlefield.find((id) => r.state.objects[id]!.kind === 'token')!;
    expect(r.state.objects[tok]!.attachedTo).toBeUndefined();
  });

  it('CR 303.4f, 707.2: a token copy of an Aura enters attached to what its controller chooses; protection is respected', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = tweak(s0, (t) => { t.objects[put(t, 'p2', 'battlefield', 'Pacifism')]!.attachedTo = bears; });
    const pac = find(s, 'Pacifism', 'battlefield');
    const step: EffectStep = { op: 'copy', what: { ref: 'each', filter: { name: 'Pacifism' } }, result: 'token', who: { ref: 'you' } };
    const d = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step])));
    expect(d.kind).toBe('chooseObjects');
    const options = (d as Extract<typeof d, { kind: 'chooseObjects' }>).options;
    expect(options).toContain(bears);
    expect(options).not.toContain(find(s, 'Test Pro Bear', 'battlefield'));
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([step]), [{ kind: 'chooseObjects', ids: [bears] }]);
    const tok = r.state.zones.battlefield.find((id) => r.state.objects[id]!.kind === 'token')!;
    expect(r.state.objects[tok]!.attachedTo).toBe(bears);
    expect(pac).toBeDefined();
  });
});
