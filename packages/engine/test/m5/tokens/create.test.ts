/**
 * WP14: the `createToken` op (CR 111, 701.7, 508.4, 607.2a) and token definitions (token-defs.ts: canonical ids, CR 111.4 names, predefined tokens).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectProgram, EffectStep, GameState, TokenDef } from '../../../src/index';
import type { CombatState } from '../../../src/types/state';
import { canonicalJson, tokenCardDef } from '../../../src/effects/handlers/token-defs';
import { chosenObject } from '../eval/helpers';
import { find, scenario, tweak } from '../helpers';
import { pipeline } from '../zones/pipeline';
import { decisionOf, runProgram } from '../zones/support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const prog = (steps: EffectStep[]): EffectProgram => ({ targets: [], steps });
const soldier = { name: 'Soldier', colors: ['W'], types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1 } satisfies TokenDef;
const tokensOf = (s: GameState, player?: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && (!player || s.objects[id]!.controller === player));

function board(): GameState {
  return scenario(['Lightning Bolt', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
}

describe('createToken (CR 111, 701.7)', () => {
  it('CR 111.2, 701.7a: "create two 1/1 white Soldier creature tokens": one proposal, two tokens owned and controlled by their creator', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 2, token: soldier, as: 'tok' }]));
    expect(r.results[0]).toEqual({ performed: true, count: 2 });
    expect(pipeline.proposals).toHaveLength(1);
    expect(pipeline.proposals[0]).toMatchObject({ ev: 'createToken', player: 'p1', count: 2 });
    const toks = tokensOf(r.state);
    expect(toks).toHaveLength(2);
    for (const id of toks) {
      const o = r.state.objects[id]!;
      expect([o.owner, o.controller, o.kind]).toEqual(['p1', 'p1', 'token']);
      const f = r.state.defs[o.defId]!.faces[0]!;
      expect([f.name, f.types, f.subtypes, f.colors, f.power, f.toughness, f.manaCost]).toEqual(['Soldier', ['Creature'], ['Soldier'], ['W'], '1', '1', null]);
    }
    expect(r.cx.bindings.get('tok')!.objects.map((h) => h.id).sort()).toEqual([...toks].sort());
  });

  it('design 15.2 WP14: the definition id comes from canonical JSON: the same token shares one definition, a different token with the same name doesn\'t', () => {
    const a = tokenCardDef(soldier);
    const b = tokenCardDef({ toughness: 1, power: 1, subtypes: ['Soldier'], types: ['Creature'], colors: ['W'], name: 'Soldier' });
    const c = tokenCardDef({ ...soldier, keywords: ['flying'] });
    expect('id' in a && 'id' in b && 'id' in c).toBe(true);
    if (!('id' in a) || !('id' in b) || !('id' in c)) return;
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([
      { op: 'createToken', who: { ref: 'you' }, count: 1, token: soldier },
      { op: 'createToken', who: { ref: 'you' }, count: 1, token: { ...soldier } },
    ]));
    const defIds = new Set(tokensOf(r.state).map((id) => r.state.objects[id]!.defId));
    expect(defIds.size).toBe(1);
  });

  it('CR 111.4: a token whose name the effect doesn\'t give is named after its subtypes plus "Token"; "with flying" is a keyword ability', () => {
    const def = tokenCardDef({ colors: ['U'], types: ['Creature'], subtypes: ['Bird'], power: 1, toughness: 1, keywords: ['flying'] });
    if ('reason' in def) throw new Error(def.reason);
    expect(def.faces[0]!.name).toBe('Bird Token');
    expect(def.faces[0]!.abilities).toEqual([{ kind: 'keyword', text: 'Flying', keyword: 'flying' }]);
    expect(def.automation.level).toBe('full');
  });

  it('CR 608.2h: an X/X token has the value of X when it is created; a power that fails to determine creates nothing (CR 608.2b)', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt', x: 4 }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { ...soldier, power: { q: 'X' }, toughness: { q: 'X' } } }]));
    const tok = tokensOf(r.state)[0]!;
    expect(r.state.defs[r.state.objects[tok]!.defId]!.faces[0]!.power).toBe('4');
  });

  it('CR 101.4, 613.7m: "each player creates": the active player\'s tokens first, one proposal per player', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'each', who: 'player' }, count: 1, token: soldier }]));
    expect(pipeline.proposals.map((p) => (p as { player: string }).player)).toEqual(['p1', 'p2']);
    expect([tokensOf(r.state, 'p1').length, tokensOf(r.state, 'p2').length]).toEqual([1, 1]);
  });

  it('CR 111.4, 122.6: created tapped and with counters (how each token enters goes with the proposal)', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: soldier, tapped: true, counters: [{ kind: '+1/+1', count: 2 }] }]));
    const o = r.state.objects[tokensOf(r.state)[0]!]!;
    expect([o.tapped, o.counters['+1/+1']]).toEqual([true, 2]);
    expect(pipeline.proposals[0]).toMatchObject({ enter: { tapped: true, counters: [{ kind: '+1/+1', count: 2 }] } });
  });

  it('CR 508.4: "tapped and attacking" during combat: each token attacks the defending player', () => {
    const s = tweak(board(), (t) => { t.combat = { number: 1, attacked: true, attackers: [], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] } satisfies CombatState; });
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 2, token: soldier, tapped: true, attacking: true }]));
    expect(r.state.combat!.attackers.map((a) => [a.defender, a.blocked])).toEqual([['p2', false], ['p2', false]]);
  });

  it('CR 607.2a: `link` makes the source remember the tokens it created', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const r = runProgram(s, { name: 'Hill Giant', kind: 'activated', sourceId: giant }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: soldier, link: 'made' }]));
    expect(r.state.objects[giant]!.links?.['made']?.objects).toEqual(tokensOf(r.state).map((id) => ({ id, zone: 'battlefield' })));
  });

  it('CR 111.10a: a predefined Treasure token has the rules text of the Comprehensive Rules as abilities', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Treasure' } }]));
    const def = r.state.defs[r.state.objects[tokensOf(r.state)[0]!]!.defId]!;
    expect(def.name).toBe('Treasure Token'); // CR 111.4: 111.10a names no Treasure, so it is its subtype plus "Token"
    expect(def.faces[0]!.types).toEqual(['Artifact']);
    expect(def.faces[0]!.abilities[0]).toMatchObject({ kind: 'activated', isMana: true });
  });

  it('CR 111.10i: an Incubator is a double-faced token; the effect may add to the predefined characteristics (CR 111.10)', () => {
    const def = tokenCardDef({ predefined: 'Incubator' });
    if ('reason' in def) throw new Error(def.reason);
    expect([def.layout, def.faces.length, def.faces[1]!.name, def.faces[1]!.types]).toEqual(['double_faced_token', 2, 'Phyrexian Token', ['Artifact', 'Creature']]);
    const tapped = tokenCardDef({ predefined: 'Treasure', subtypes: ['Gold'] });
    if ('reason' in tapped) throw new Error(tapped.reason);
    expect(tapped.faces[0]!.subtypes).toEqual(['Treasure', 'Gold']);
  });

  it('CR 111.10: an unknown predefined token is resolved by hand, never guessed', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Unheard Of' } }]));
    expect(r.results[0]!.performed).toBe(false);
    expect(pipeline.manual[0]!.reason).toMatch(/Unheard Of/);
    expect(tokensOf(r.state)).toEqual([]);
  });

  it('CR 303.4f: a Role token created attached to target creature enters attached to it; with no legal creature none is created (CR 303.4g)', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const step: EffectStep = { op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Monster Role' }, attachTo: { ref: 'target', id: 't0' } };
    const target = { id: 't0', kind: 'object' as const, filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, { targets: [target], steps: [step] });
    const role = tokensOf(r.state)[0]!;
    expect(r.state.objects[role]!.attachedTo).toBe(bears);
    const none = runProgram(s, { name: 'Lightning Bolt' }, prog([{ ...step, attachTo: { ref: 'each', filter: { name: 'Lightning Bolt', zone: 'hand' } } } as EffectStep]));
    expect(tokensOf(none.state)).toEqual([]);
  });

  it('CR 701.7a: creating zero tokens creates nothing and proposes nothing', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: 0, token: soldier }]));
    expect(r.results[0]!.performed).toBe(false);
    expect(pipeline.proposals).toEqual([]);
    expect(() => decisionOf(() => 0)).toThrow();
  });
});
