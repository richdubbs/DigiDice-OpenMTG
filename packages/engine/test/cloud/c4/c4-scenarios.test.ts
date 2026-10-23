/**
 * CLOUD C4 (edict and mass-destroy riders), played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented,
 * design 6.10).
 *
 *   CR 107.3          X is the value chosen as the spell was cast; "If X is 5 or more" reads that value as the spell resolves
 *   CR 115.1, 601.2c  "up to one target ... with mana value X": the target is chosen (or not) as the spell is cast, with X already chosen
 *   CR 608.2c, 109.2  "all other artifacts and creatures": every one of them except the target the earlier sentence named
 *   CR 701.8a         destroy: from the battlefield to its owner's graveyard; lands are not artifacts or creatures and stay
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manualOf = (d: CardDef): string[] => [...d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text), ...(JSON.stringify(d.faces).includes('"op":"manual"') ? ['a manual step'] : [])];

const PURGE = card('Test Purge', 'Sorcery', 'Destroy up to one target artifact or creature with mana value X. If X is 3 or more, destroy all other artifacts and creatures.', { cost: '{X}', colors: ['B'] });
const CULL = card('Test Cull', 'Sorcery', 'Destroy target creature. If X is 2 or more, destroy all other creatures.', { cost: '{X}', colors: ['B'] });
const SIFT = card('Test Sift', 'Sorcery', 'Target player mills X cards. If X is 3 or more, you gain 4 life.', { cost: '{X}', colors: ['U'] });
const ONE = card('Test One', 'Creature — Bear', '', { cost: '{1}', pt: ['1', '1'], colors: ['G'] });
const THREE = card('Test Three', 'Creature — Giant', '', { cost: '{2}{G}', pt: ['3', '3'], colors: ['G'] });
const ROD = card('Test Rod', 'Artifact', '', { cost: '{3}' });
const MUSTER = card('Test Muster', 'Sorcery', 'Create X 1/1 white Soldier creature tokens. If X is 2 or more, destroy all other creatures.', { cost: '{X}', colors: ['W'] });
const ALL = [PURGE, CULL, SIFT, MUSTER, ONE, THREE, ROD];

/** Cast `name` from p1's hand with X = `x` at `targets` (none chosen for an empty list, "up to one") and let it resolve. */
function cast(s0: GameState, name: string, x: number, targets: TargetChoice[]): GameState {
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; t.pending && t.pending.kind !== 'priority' && guard < 20; guard++) {
    if (t.pending.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: x });
    else if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets });
    else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else break;
  }
  return passBoth(t);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const onBf = (s: GameState): string[] => s.zones.battlefield.map((id) => s.objects[id]!.defId).sort();

function board(spell: string): GameState {
  return scenario([], {
    defs: ALL,
    p1: { hand: [spell], battlefield: ['Plains', 'Plains', 'Plains', 'Test One'] },
    p2: { battlefield: ['Test Three', 'Test Rod', 'Plains'], library: ['Plains', 'Plains', 'Plains', 'Plains'] },
  });
}

describe('design 6.9: the C4 test cards compile to data, nothing manual', () => {
  it('no manual ability or step', () => {
    for (const d of [PURGE, CULL, SIFT, MUSTER]) expect(manualOf(d), d.name).toEqual([]);
  });
});

describe('CR 107.3, 608.2c: "Destroy up to one target artifact or creature with mana value X. If X is 3 or more, destroy all other artifacts and creatures."', () => {
  it('X = 1: only the target with mana value 1 is destroyed; the rider does nothing', () => {
    const s0 = board('Test Purge');
    const s = cast(s0, 'Test Purge', 1, [obj(find(s0, 'Test One', 'battlefield', 'p1'))]);
    expect(onBf(s)).toEqual(['Plains', 'Plains', 'Plains', 'Plains', 'Test Rod', 'Test Three']);
  });
  it('X = 3: the target and then every other artifact and creature are destroyed; lands stay', () => {
    const s0 = board('Test Purge');
    const s = cast(s0, 'Test Purge', 3, [obj(find(s0, 'Test Three', 'battlefield', 'p2'))]);
    expect(onBf(s)).toEqual(['Plains', 'Plains', 'Plains', 'Plains']);
  });
  it('X = 3 with no target chosen ("up to one", CR 115.1): "other" leaves out nothing, so every artifact and creature is destroyed', () => {
    const s0 = board('Test Purge');
    const s = cast(s0, 'Test Purge', 3, []);
    expect(onBf(s)).toEqual(['Plains', 'Plains', 'Plains', 'Plains']);
  });
  it('a permanent whose mana value is not X is no legal target (CR 115.1, 601.2c)', () => {
    const s0 = board('Test Purge');
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Purge', 'hand', 'p1') });
    for (let guard = 0; t.pending && t.pending.kind !== 'chooseTargets' && guard < 5; guard++) if (t.pending.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: 1 });
    expect(t.pending?.kind).toBe('chooseTargets');
    const legal = JSON.stringify(t.pending);
    expect(legal).toContain(find(s0, 'Test One', 'battlefield', 'p1'));
    expect(legal).not.toContain(find(s0, 'Test Three', 'battlefield', 'p2'));
    expect(legal).not.toContain(find(s0, 'Test Rod', 'battlefield', 'p2'));
  });
});

describe('CR 608.2c, 109.2: "Destroy target creature. If X is 2 or more, destroy all other creatures."', () => {
  it('X = 1: only the target', () => {
    const s0 = board('Test Cull');
    const s = cast(s0, 'Test Cull', 1, [obj(find(s0, 'Test Three', 'battlefield', 'p2'))]);
    expect(onBf(s)).toEqual(['Plains', 'Plains', 'Plains', 'Plains', 'Test One', 'Test Rod']);
  });
  it('X = 2: the target and every other creature; the artifact stays', () => {
    const s0 = board('Test Cull');
    const s = cast(s0, 'Test Cull', 2, [obj(find(s0, 'Test Three', 'battlefield', 'p2'))]);
    expect(onBf(s)).toEqual(['Plains', 'Plains', 'Plains', 'Plains', 'Test Rod']);
  });
});

describe('CR 107.3: "Target player mills X cards. If X is 3 or more, you gain 4 life."', () => {
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  it('X = 2: two cards milled, no life', () => {
    const s0 = board('Test Sift');
    const s = cast(s0, 'Test Sift', 2, [{ kind: 'player', id: 'p2' }]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('X = 3: three cards milled and 4 life', () => {
    const s0 = board('Test Sift');
    const s = cast(s0, 'Test Sift', 3, [{ kind: 'player', id: 'p2' }]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 4);
  });
});

describe('CR 608.2c, 109.2, 111.1: "Create X 1/1 white Soldier creature tokens. If X is 2 or more, destroy all other creatures."', () => {
  const soldiers = (s: GameState): number => s.zones.battlefield.filter((id) => /Soldier/.test(JSON.stringify(s.objects[id]!))).length;
  it('X = 1: one token, nothing destroyed', () => {
    const s0 = board('Test Muster');
    const s = cast(s0, 'Test Muster', 1, []);
    expect(onBf(s).filter((n) => n.startsWith('Test '))).toEqual(['Test One', 'Test Rod', 'Test Three']);
    expect(soldiers(s)).toBe(1);
  });
  it('X = 2: the two new tokens stay, every other creature is destroyed, the artifact stays', () => {
    const s0 = board('Test Muster');
    const s = cast(s0, 'Test Muster', 2, []);
    expect(onBf(s).filter((n) => n.startsWith('Test '))).toEqual(['Test Rod']);
    expect(soldiers(s)).toBe(2);
  });
});
