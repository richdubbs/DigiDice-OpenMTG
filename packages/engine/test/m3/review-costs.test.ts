/**
 * Fixes from the milestone 3 review: paying costs. Mana abilities are activated before the other costs are paid
 * (CR 601.2g-h), cost parts that compete for permanents are checked together, and auto-pay spends the least valuable sources.
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type CardDef, type GameState, type ObjectId } from '../../src/index';
import { act, answer, battlefieldNames, castAuto, find, isTapped, labels, legal, passBoth, pool, reject, scenario, zoneNames } from './scenario';
import { activated, synth, targetPlayer } from './synthetic';

const activate = (s: GameState, name: string, key = 'p:0:0', player = 'p1') => ({ type: 'activate' as const, player, source: find(s, name, 'battlefield', player), ability: key });
const creature = (name: string): CardDef => synth({ name, cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });
const sacCreature = { kind: 'sacrifice' as const, filter: { types: ['Creature'] }, count: 1 };
const untapped = (s: GameState): string[] => s.zones.battlefield.filter((id) => !s.objects[id]!.tapped).map((id) => s.objects[id]!.defId);
const artifact = (name: string, cost: string): CardDef => synth({ name, cost, type: 'Artifact', abilities: [] });

describe('CR 601.2g-h, 602.2b: mana abilities are activated before costs are paid', () => {
  const altarG = (): CardDef => synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('{G}, Sacrifice a land: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [{ kind: 'sacrifice', filter: { types: ['Land'] }, count: 1 }] })] });

  it('the only land can be tapped for the mana and then sacrificed as the cost', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Altar', 'Forest'] }, defs: [altarG()] });
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.label)).toEqual(['Test Altar: {G}, Sacrifice a land: go.']);
    s = act(s, activate(s, 'Test Altar'));
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Forest']);
    expect(s.zones.stack).toHaveLength(1);
    expect(s.log.map((e) => e.text).join('\n')).toMatch(/taps Forest for \{G\}[\s\S]*sacrifices Forest/);
  });

  it('with two creatures the player still chooses which one is sacrificed, even the mana creature', () => {
    const altar = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('{G}, Sacrifice a creature: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [sacCreature] })] });
    const base = scenario(['Llanowar Elves'], { p1: { battlefield: ['Test Altar', 'Llanowar Elves', 'Bear'] }, defs: [altar, creature('Bear')] });
    let s = act(base, activate(base, 'Test Altar'));
    s = answer(s, { kind: 'payCost', auto: true }); // the mana comes first (CR 601.2g); the Elves are tapped for it
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', cancellable: true });
    expect((s.pending as { options: ObjectId[] }).options).toHaveLength(2);
    s = answer(s, { kind: 'chooseObjects', ids: [find(base, 'Llanowar Elves', 'battlefield')] });
    expect(battlefieldNames(s)).toEqual(['Test Altar', 'Bear']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Llanowar Elves']);
  });

  it('CR 701.21, 605.3b: a mana ability that sacrifices its own permanent (Lotus Petal) is not also sacrificed as the cost', () => {
    const altar = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('{1}, Sacrifice an artifact: go.', { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 1 }] })] });
    const base = scenario(['Lotus Petal', 'Mind Stone'], { p1: { battlefield: ['Test Altar', 'Lotus Petal', 'Mind Stone'] }, defs: [altar] });
    let s = act(base, activate(base, 'Test Altar'));
    s = answer(s, { kind: 'payCost', auto: true }); // paid with the Mind Stone: the Petal stays an option for the sacrifice
    expect((s.pending as { options: ObjectId[] }).options).toHaveLength(3);
    s = answer(s, { kind: 'chooseObjects', ids: [find(base, 'Lotus Petal', 'battlefield')] });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Lotus Petal']); // sacrificed once, as the cost
    expect(isTapped(s, find(s, 'Mind Stone', 'battlefield'))).toBe(true); // the mana came from the Mind Stone
    expect(s.zones.stack).toHaveLength(1);
  });

  it('the only mana source that a part would sacrifice is not offered for it', () => {
    const altar = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('{1}, Sacrifice an artifact: go.', { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 1 }] })] });
    const base = scenario(['Lotus Petal'], { p1: { battlefield: ['Test Altar', 'Lotus Petal'] }, defs: [altar] });
    let s = act(base, activate(base, 'Test Altar')); // Petal can't be both: the Altar is the only legal sacrifice
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Lotus Petal', 'Test Altar']);
  });
});

describe('CR 118.3: cost parts that need the same permanents are checked together', () => {
  it('two "Sacrifice a creature" parts need two creatures', () => {
    const twice = synth({ name: 'Test Twice', type: 'Artifact', abilities: [activated('Sacrifice a creature, Sacrifice a creature: go.', { other: [sacCreature, sacCreature] })] });
    let s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Test Twice', 'Llanowar Elves'] }, defs: [twice] });
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana)).toEqual([]);
    expect(reject(s, activate(s, 'Test Twice')).message).toMatch(/same permanents/);
    s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Test Twice', 'Llanowar Elves', 'Bear'] }, defs: [twice, creature('Bear')] });
    s = drive(s, activate(s, 'Test Twice'), 'two sacrifices');
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Bear', 'Llanowar Elves']);
  });

  it('"{T}, tap an untapped creature you control" can\'t tap the source twice', () => {
    const tapper = synth({ name: 'Test Tapper', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [activated('{T}, Tap an untapped creature you control: go.', { tap: true, other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] })] });
    let s = scenario([], { p1: { battlefield: ['Test Tapper'] }, defs: [tapper] });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
    expect(reject(s, activate(s, 'Test Tapper')).message).toMatch(/enough permanents/);
    s = scenario([], { p1: { battlefield: ['Test Tapper', 'Bear'] }, defs: [tapper, creature('Bear')] });
    s = act(s, activate(s, 'Test Tapper'));
    expect(isTapped(s, find(s, 'Test Tapper', 'battlefield')) && isTapped(s, find(s, 'Bear', 'battlefield'))).toBe(true);
  });

  it('a creature tapped as a cost can\'t also be tapped for mana: the only {G} source can\'t be the tapped creature', () => {
    const tapG = synth({ name: 'Test Tap', type: 'Artifact', abilities: [activated('{G}, Tap an untapped creature you control: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] })] });
    let s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Test Tap', 'Llanowar Elves'] }, defs: [tapG] });
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.label)).toEqual([]);
    s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Test Tap', 'Llanowar Elves', 'Bear'] }, defs: [tapG, creature('Bear')] });
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana)).toHaveLength(1);
    s = act(s, activate(s, 'Test Tap')); // only the Bear leaves a way to pay: no question is asked
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(isTapped(s, find(s, 'Bear', 'battlefield'))).toBe(true);
    expect(isTapped(s, find(s, 'Llanowar Elves', 'battlefield'))).toBe(true);
    expect(s.zones.stack).toHaveLength(1);
  });
});

/** Answer every decision with the first legal answer; every decision must be answerable and the action must settle. */
function drive(start: GameState, action: Parameters<typeof act>[1], label: string): GameState {
  let s = act(start, action);
  for (let i = 0; i < 30 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending;
    switch (d.kind) {
      case 'chooseObjects':
        expect(d.options.length, `${label}: ${d.prompt}`).toBeGreaterThanOrEqual(d.min);
        s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
        break;
      case 'chooseNumber': s = answer(s, { kind: 'chooseNumber', n: d.max }); break;
      case 'yesNo': s = answer(s, { kind: 'yesNo', yes: true }); break;
      case 'payCost':
        expect(d.autoPayable, `${label}: ${d.prompt}`).toBe(true);
        s = answer(s, { kind: 'payCost', auto: true });
        break;
      case 'chooseTargets': s = answer(s, { kind: 'chooseTargets', targets: [...d.objects.map((id) => ({ kind: 'object' as const, id })), ...d.players.map((id) => ({ kind: 'player' as const, id }))].slice(0, d.min) }); break;
      case 'chooseOption': s = answer(s, { kind: 'chooseOption', ids: d.options.filter((o) => !o.disabled).slice(0, d.min).map((o) => o.id) }); break;
      case 'manualResolve': s = answer(s, { kind: 'manualResolve', ops: [] }); break;
      default: throw new Error(`${label}: unexpected decision ${d.kind}`);
    }
  }
  expect(s.pending?.kind, label).toBe('priority');
  return s;
}

describe('docs/ARCHITECTURE.md: every listed cast or activation can be completed', () => {
  const altarG = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('{G}, Sacrifice a creature: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [sacCreature] })] });
  const altarArt = synth({ name: 'Test Altar2', type: 'Artifact', abilities: [activated('{1}, Sacrifice an artifact: go.', { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 1 }] })] });
  const twice = synth({ name: 'Test Twice', type: 'Artifact', abilities: [activated('Sacrifice a creature, Sacrifice a creature: go.', { other: [sacCreature, sacCreature] })] });
  const tapper = synth({ name: 'Test Tapper', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [activated('{T}, Tap an untapped creature you control: go.', { tap: true, other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] })] });
  const tapG = synth({ name: 'Test Tap', type: 'Artifact', abilities: [activated('{G}, Tap an untapped creature you control: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] })] });
  const pay = synth({ name: 'Test Pay', type: 'Artifact', abilities: [activated('{G}, Pay 2 life, Sacrifice a creature: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [{ kind: 'payLife', amount: 2 }, sacCreature] }, [targetPlayer])] });
  const defs = [altarG, altarArt, twice, tapper, tapG, pay, creature('Bear'), creature('Bear2')];
  const boards: string[][] = [
    ['Test Altar', 'Llanowar Elves'], ['Test Altar', 'Llanowar Elves', 'Bear'], ['Test Altar', 'Bear', 'Forest'],
    ['Test Altar2', 'Lotus Petal'], ['Test Altar2', 'Lotus Petal', 'Mind Stone'], ['Test Altar2', 'Mind Stone', 'Sol Ring'],
    ['Test Twice', 'Llanowar Elves'], ['Test Twice', 'Llanowar Elves', 'Bear'], ['Test Twice', 'Llanowar Elves', 'Bear', 'Bear2'],
    ['Test Tapper'], ['Test Tapper', 'Bear'], ['Test Tapper', 'Bear', 'Bear2'],
    ['Test Tap', 'Llanowar Elves'], ['Test Tap', 'Llanowar Elves', 'Bear'], ['Test Tap', 'Llanowar Elves', 'Birds of Paradise', 'Bear'],
    ['Test Pay', 'Llanowar Elves'], ['Test Pay', 'Llanowar Elves', 'Bear'],
  ];

  it('drives every listed non-mana activation on 17 boards to the end with the first legal answers', () => {
    let driven = 0;
    for (const board of boards) {
      const s = scenario(['Llanowar Elves', 'Birds of Paradise', 'Lotus Petal', 'Mind Stone', 'Sol Ring', 'Forest'], { p1: { battlefield: board }, defs });
      for (const la of legalActions(s, 'p1')) {
        if (la.kind === 'pass' || la.isMana) continue;
        drive(s, la.action, `${board.join(', ')} -> ${la.label}`);
        driven++;
      }
    }
    expect(driven).toBeGreaterThan(10);
  });
});

describe('auto-pay spends the source the player needs least (docs/ARCHITECTURE.md)', () => {
  const one = artifact('Test One', '{1}');
  const two = artifact('Test Two', '{2}');

  it('with the same flexibility, the color the player has more of is spent: [Forest, Island, Island] and [Island, Island, Forest]', () => {
    for (const order of [['Forest', 'Island', 'Island'], ['Island', 'Island', 'Forest']]) {
      const s = castAuto(scenario(['Forest', 'Island'], { p1: { hand: ['Test One'], battlefield: order }, defs: [one] }), 'Test One');
      expect(untapped(s).sort(), order.join()).toEqual(['Forest', 'Island']);
    }
  });

  it('CR 107.4h: a non-snow source pays before a snow one, so {S} can still be paid later', () => {
    for (const order of [['Snow-Covered Forest', 'Forest'], ['Forest', 'Snow-Covered Forest']]) {
      let s = scenario(['Snow-Covered Forest', 'Forest', 'Icehide Golem'], { p1: { hand: ['Test One', 'Icehide Golem'], battlefield: order }, defs: [one] });
      s = passBoth(castAuto(s, 'Test One'));
      expect(untapped(s).filter((n) => n !== 'Test One'), order.join()).toEqual(['Snow-Covered Forest']);
      expect(labels(s, 'p1')).toContain('Cast Icehide Golem');
    }
  });

  it('a source that makes several mana with one activation pays {2} alone (Sol Ring), but {1} is paid by a land', () => {
    const board = ['Forest', 'Forest', 'Sol Ring'];
    const twoCost = castAuto(scenario(['Forest', 'Sol Ring'], { p1: { hand: ['Test Two'], battlefield: board }, defs: [two] }), 'Test Two');
    expect(untapped(twoCost).sort()).toEqual(['Forest', 'Forest']);
    const oneCost = castAuto(scenario(['Forest', 'Sol Ring'], { p1: { hand: ['Test One'], battlefield: board }, defs: [one] }), 'Test One');
    expect(untapped(oneCost)).toContain('Sol Ring');
    expect(untapped(oneCost)).toHaveLength(2);
  });
});

describe('CR 601.2h: the player chooses which mana is spent', () => {
  const one = artifact('Test One', '{1}');
  const g = artifact('Test G', '{G}');
  const tap = (s: GameState, name: string, key: string, player = 'p1'): GameState => act(s, { type: 'activate', player, source: find(s, name, 'battlefield'), ability: key });

  it('spendPool names the floating units to spend; the rest stays in the pool', () => {
    let s = scenario(['Mountain', 'Forest'], { p1: { hand: ['Test One'], battlefield: ['Mountain', 'Forest'] }, defs: [one] });
    s = tap(tap(s, 'Mountain', 'r:basic:R'), 'Forest', 'r:basic:G');
    expect(s.players[0]!.manaPool.map((u) => u.type)).toEqual(['R', 'G']);
    const keepRed = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test One', 'hand') });
    expect(answer(keepRed, { kind: 'payCost', auto: false, activations: [], spendPool: [1] }).players[0]!.manaPool.map((u) => u.type)).toEqual(['R']);
    expect(answer(keepRed, { kind: 'payCost', auto: false, activations: [], spendPool: [0] }).players[0]!.manaPool.map((u) => u.type)).toEqual(['G']);
    const bad = reject(keepRed, { type: 'answer', player: 'p1', decisionId: keepRed.pending!.id, answer: { kind: 'payCost', auto: false, activations: [], spendPool: [5] } });
    expect(bad.message).toMatch(/no mana number 6/);
  });

  it('CR 107.4h: auto-pay spends plain floating mana before snow mana', () => {
    let s = scenario(['Snow-Covered Forest', 'Forest'], { p1: { hand: ['Test G'], battlefield: ['Snow-Covered Forest', 'Forest'] }, defs: [g] });
    s = tap(tap(s, 'Snow-Covered Forest', 'r:basic:G'), 'Forest', 'r:basic:G');
    expect(s.players[0]!.manaPool.map((u) => u.snow === true)).toEqual([true, false]);
    s = castAuto(s, 'Test G');
    expect(s.players[0]!.manaPool.map((u) => u.snow === true)).toEqual([true]);
    expect(pool(s, 'p1')).toBe('G');
    expect(s.players[0]!.manaPool[0]!.snow).toBe(true); // the snow unit is the one left, so a later {S} can still be paid
  });
});
