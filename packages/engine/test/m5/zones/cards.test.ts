/**
 * WP14 acceptance cards (design section 13, 15.2): Doom Blade, Swords to Plowshares, Wrath of God, Raise the Alarm, Path to Exile, Counterspell, Fork (and
 * Twincast, Fork without the exception). Each is cast with real actions (WP7 announcement: targets, payment) with its section 13 ability, then resolved by the
 * WP10 stand-in (support.ts#resolveTop) over the faked WP11 pipeline. `gainLife` (WP12), `may` (WP10), `search` and `shuffle` (WP13) are faked in support.ts
 * where a card needs them; integration.test.ts runs the same cards through `applyAction` once the real neighbors have merged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbilityDef, DecisionAnswer, EffectProgram, GameState } from '../../../src/index';
import { evalQty } from '../../../src/effects/eval';
import { propose } from '../../../src/effects/propose';
import { resolvePlayers } from '../../../src/effects/refs';
import { drive, objectTarget, playerTarget } from '../announce/support';
import { act, find, keyword, scenario, synth, tweak } from '../helpers';
import { EXAMPLES } from '../model/examples';
import { pipeline } from './pipeline';
import { NEIGHBOR_FAKES, resolveTop, withAbilities, withExamples } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

// WP12's gainLife, faked like the other neighbors (support.ts): evaluate the amount (CR 608.2h), propose a life gain (CR 119.3).
NEIGHBOR_FAKES['gainLife'] = (cx, st) => {
  const s = st as Extract<typeof st, { op: 'gainLife' }>;
  const n = evalQty(cx, s.amount);
  if (n === undefined) return { performed: false, count: 0 };
  let k = 0;
  for (const p of resolvePlayers(cx, s.who)) if (n > 0 && propose(cx.g, { ev: 'life', change: 'gain', player: p, amount: n })) k++;
  return { performed: k > 0, count: k };
};

const example = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities;
const pathToExile = synth({ name: 'Path to Exile', cost: '{W}', type: 'Instant', abilities: example('Path to Exile') });
const twincastJson: EffectProgram = {
  targets: [{ id: 't0', kind: 'spell', filter: { types: ['Instant', 'Sorcery'] }, min: 1, max: 1, text: 'target instant or sorcery spell' }],
  steps: [{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' }, newTargets: 'may' }],
};
const forkJson: EffectProgram = { ...twincastJson, steps: [{ ...twincastJson.steps[0]!, except: [{ layer: 5, colors: { set: ['R'] } }] } as EffectProgram['steps'][number]] };
const hexproofBear = synth({ name: 'Test Hexproof Bear', cost: '{1}{G}', type: 'Creature — Bear', pt: ['2', '2'], abilities: [keyword('hexproof')] });

const LANDS = ['Plains', 'Plains', 'Island', 'Island', 'Swamp', 'Swamp', 'Mountain', 'Mountain'];

function board(): GameState {
  const s = scenario(['Doom Blade', 'Swords to Plowshares', 'Wrath of God', 'Raise the Alarm', 'Counterspell', 'Fork', 'Twincast', 'Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Black Knight', 'Plains', 'Island', 'Swamp', 'Mountain'], {
    defs: [pathToExile, hexproofBear],
    p1: { hand: ['Doom Blade', 'Swords to Plowshares', 'Wrath of God', 'Raise the Alarm', 'Path to Exile', 'Counterspell', 'Fork', 'Twincast'], battlefield: [...LANDS, 'Plains', 'Plains', 'Island', 'Island', 'Hill Giant'] },
    p2: { hand: ['Lightning Bolt'], battlefield: ['Grizzly Bears', 'Black Knight', 'Mountain', 'Test Hexproof Bear'] },
  });
  return withAbilities(withAbilities(withExamples(s, 'Doom Blade', 'Swords to Plowshares', 'Wrath of God', 'Raise the Alarm', 'Counterspell', 'Lightning Bolt'),
    'Fork', [{ kind: 'spell', text: 'Copy target instant or sorcery spell, except that the copy is red. You may choose new targets for the copy.', effect: forkJson }]),
  'Twincast', [{ kind: 'spell', text: 'Copy target instant or sorcery spell. You may choose new targets for the copy.', effect: twincastJson }]);
}

const cast = (s: GameState, name: string, answers: DecisionAnswer[], player: 'p1' | 'p2' = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers);
const onBattlefield = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('section 13 cards (WP14 acceptance)', () => {
  it('Doom Blade: "Destroy target nonblack creature" (CR 701.8a): a black creature is not a legal target', () => {
    const s = board();
    const d = act(s, { type: 'cast', player: 'p1', card: find(s, 'Doom Blade', 'hand') });
    expect(d.pending!.kind).toBe('chooseTargets');
    const offered = (d.pending as Extract<typeof d.pending, { kind: 'chooseTargets' }>).objects;
    expect(offered).toContain(find(s, 'Grizzly Bears', 'battlefield'));
    expect(offered).not.toContain(find(s, 'Black Knight', 'battlefield'));
    const t = cast(s, 'Doom Blade', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    const r = resolveTop(t);
    expect(r.results).toEqual([{ performed: true, count: 1 }]);
    expect(onBattlefield(r.state, 'Grizzly Bears')).toBe(false);
    expect(r.state.zones.graveyard['p2']!.some((id) => r.state.objects[id]!.defId === 'Grizzly Bears')).toBe(true);
  });

  it('Swords to Plowshares (CR 608.2h): the controller gains life equal to the creature\'s power as it last existed on the battlefield (with its +1/+1 counter)', () => {
    const s = tweak(board(), (x) => { x.objects[find(x, 'Grizzly Bears', 'battlefield')]!.counters['+1/+1'] = 1; });
    const t = cast(s, 'Swords to Plowshares', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    const r = resolveTop(t);
    expect(r.state.zones.exile.some((id) => r.state.objects[id]!.defId === 'Grizzly Bears')).toBe(true);
    expect(r.state.players[1]!.life).toBe(23);
  });

  it('Swords to Plowshares (CR 608.2b): with its only target illegal on resolution, it does nothing and nobody gains life', () => {
    const s = board();
    const t = cast(s, 'Swords to Plowshares', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    const gone = tweak(t, (x) => { const b = find(x, 'Grizzly Bears', 'battlefield'); x.zones.battlefield = x.zones.battlefield.filter((id) => id !== b); x.zones.hand['p2']!.push(b); x.objects[b]!.zone = 'hand'; });
    const r = resolveTop(gone);
    expect(r.resolved).toBe(false);
    expect(r.state.players[1]!.life).toBe(20);
  });

  it('Wrath of God: "Destroy all creatures. They can\'t be regenerated." (CR 701.8a, 701.19c) on both sides', () => {
    const s = board();
    const r = resolveTop(cast(s, 'Wrath of God', []));
    expect(r.state.zones.battlefield.filter((id) => r.state.defs[r.state.objects[id]!.defId]!.faces[0]!.types.includes('Creature'))).toEqual([]);
    expect(pipeline.proposals.filter((p) => p.ev === 'destroy')).toHaveLength(4);
  });

  it('Raise the Alarm: two 1/1 white Soldier creature tokens (CR 111.2, 701.7a)', () => {
    const s = board();
    const r = resolveTop(cast(s, 'Raise the Alarm', []));
    const toks = r.state.zones.battlefield.filter((id) => r.state.objects[id]!.kind === 'token');
    expect(toks).toHaveLength(2);
    expect(toks.map((id) => { const f = r.state.defs[r.state.objects[id]!.defId]!.faces[0]!; return [f.name, f.power, f.toughness, f.colors]; })).toEqual([['Soldier', '1', '1', ['W']], ['Soldier', '1', '1', ['W']]]);
  });

  it('Path to Exile (CR 110.2): the exiled creature\'s controller searches; the land enters tapped under THEIR control', () => {
    const s = board();
    const t = cast(s, 'Path to Exile', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    const plains = t.zones.library['p2']!.find((id) => t.objects[id]!.defId === 'Plains')!;
    const r = resolveTop(t, [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [plains] }]);
    expect(r.state.zones.exile.some((id) => r.state.objects[id]!.defId === 'Grizzly Bears')).toBe(true);
    const land = r.state.objects[r.state.lki[plains]!.newId!]!;
    expect([land.zone, land.controller, land.owner, land.tapped]).toEqual(['battlefield', 'p2', 'p2', true]);
  });

  it('Counterspell: "Counter target spell" (CR 701.6a): the spell goes to its owner\'s graveyard', () => {
    const s = board();
    const bolted = drive(act(s, { type: 'pass', player: 'p1' }), []); // p2 gets priority on p1's turn
    const withBolt = cast(bolted, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [playerTarget('p1')] }], 'p2');
    const bolt = withBolt.zones.stack[0]!;
    const t = cast(act(withBolt, { type: 'pass', player: 'p2' }), 'Counterspell', [{ kind: 'chooseTargets', targets: [objectTarget(bolt)] }]);
    const r = resolveTop(t);
    expect(r.results).toEqual([{ performed: true, count: 1 }]);
    expect(r.state.zones.graveyard['p2']!.some((id) => r.state.objects[id]!.defId === 'Lightning Bolt')).toBe(true);
    expect(r.state.players[0]!.life).toBe(20);
  });

  // M6-0 (m6 design 4.3): a milestone 6 absence pin left here (it needs this file's mocked pipeline); M6-2 updates it (op:copy.except). CLOUD std-misc runs a spell
  // copy's color exception (effects/handlers/token-defs.ts#exceptedSpellDef), so Fork's copy now goes on the stack, red (CR 707.9b, 707.10).
  it('Twincast copies the spell (CR 707.10); Fork\'s "except that the copy is red" makes a red copy (CR 707.9b): no step is resolved by hand', () => {
    const s = board();
    const bolted = drive(act(s, { type: 'pass', player: 'p1' }), []);
    const withBolt = cast(bolted, 'Lightning Bolt', [{ kind: 'chooseTargets', targets: [playerTarget('p1')] }], 'p2');
    const bolt = withBolt.zones.stack[0]!;
    const p1 = act(withBolt, { type: 'pass', player: 'p2' });
    const twin = resolveTop(cast(p1, 'Twincast', [{ kind: 'chooseTargets', targets: [objectTarget(bolt)] }]), [{ kind: 'yesNo', yes: true }, { kind: 'chooseTargets', targets: [playerTarget('p2')] }]);
    const copy = twin.state.objects[twin.state.zones.stack[twin.state.zones.stack.length - 1]!]!;
    expect([copy.kind, copy.controller, copy.stack!.targets]).toEqual(['spellCopy', 'p1', [[{ kind: 'player', id: 'p2' }]]]);
    const fork = resolveTop(cast(p1, 'Fork', [{ kind: 'chooseTargets', targets: [objectTarget(bolt)] }]), [{ kind: 'yesNo', yes: true }, { kind: 'chooseTargets', targets: [playerTarget('p2')] }]);
    expect(pipeline.manual).toHaveLength(0);
    const red = fork.state.objects[fork.state.zones.stack[fork.state.zones.stack.length - 1]!]!;
    expect([red.kind, red.controller, red.stack!.targets, fork.state.defs[red.defId]!.faces[0]!.colors]).toEqual(['spellCopy', 'p1', [[{ kind: 'player', id: 'p2' }]], ['R']]);
  });
});
