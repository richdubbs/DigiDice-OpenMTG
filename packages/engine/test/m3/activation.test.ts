import { describe, expect, it } from 'vitest';
import { legalActions, type CardDef, type GameState } from '../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, isTapped, labels, legal, life, pass, passBoth, pool, reject, scenario, zoneNames } from './scenario';
import { activated, spellAbility, synth, targetCreature, targetPlayer } from './synthetic';

const stackKinds = (s: GameState): string[] => s.zones.stack.map((id) => `${s.objects[id]!.kind}:${s.objects[id]!.stack?.sourceName ?? s.objects[id]!.defId}`);
const activate = (s: GameState, name: string, ability = 'p:0:0', player = 'p1') => ({ type: 'activate' as const, player, source: find(s, name, 'battlefield', player), ability });

const pinger = (): CardDef => synth({ name: 'Test Pinger', cost: '{1}{R}', type: 'Creature — Wizard', pt: ['1', '1'], abilities: [activated('{T}: Ping target player.', { tap: true }, [targetPlayer])] });

describe('activating abilities (CR 602)', () => {
  it('CR 602.2a, 602.2b: a non-mana ability goes on the stack as an object that is not a card; its cost is paid; it resolves later', () => {
    let s = scenario([], { p1: { battlefield: ['Test Pinger'] }, defs: [pinger()] });
    s = act(s, activate(s, 'Test Pinger'));
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target player' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(stackKinds(s)).toEqual(['ability:Test Pinger']);
    const ab = s.objects[s.zones.stack[0]!]!;
    expect(ab).toMatchObject({ kind: 'ability', controller: 'p1', zone: 'stack' });
    expect(ab.stack).toMatchObject({ kind: 'activated', sourceName: 'Test Pinger', targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(isTapped(s, find(s, 'Test Pinger', 'battlefield'))).toBe(true); // CR 602.2b: {T} paid
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // CR 117.3c
    s = passBoth(s);
    expect(stackKinds(s)).toEqual([]);
    expect(s.log.some((l) => /ability of Test Pinger resolves/.test(l.text))).toBe(true);
  });

  it('CR 117.1b: an activated ability can be activated any time you have priority, including the opponent\'s turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Pinger'] }, defs: [pinger()] });
    s = advanceTo(s, 2, 'upkeep');
    s = pass(s);
    expect(s.pending!.player).toBe('p1');
    expect(labels(s, 'p1')).toContain('Test Pinger: {T}: Ping target player.');
  });

  it('CR 602.5a: a summoning-sick creature cannot activate a {T} ability', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Pinger', since: 1 }] }, defs: [pinger()] });
    expect(reject(s, activate(s, 'Test Pinger')).rules).toContain('CR 602.5a');
    expect(legal(s, 'p1', 'activate')).toEqual([]);
  });

  it('CR 118.3: a tapped permanent cannot pay a {T} cost', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Pinger', tapped: true }] }, defs: [pinger()] });
    expect(reject(s, activate(s, 'Test Pinger')).message).toMatch(/already tapped/);
  });

  it('CR 602.2: you cannot activate an ability of a permanent you do not control', () => {
    let s = scenario([], { p2: { battlefield: ['Test Pinger'] }, defs: [pinger()] });
    expect(reject(s, activate(s, 'Test Pinger', 'p:0:0', 'p2')).message).toMatch(/priority, not Bob/);
    s = pass(s);
    expect(s.pending!.player).toBe('p2');
    const other = scenario([], { p1: { battlefield: ['Test Pinger'] }, defs: [pinger()] });
    const p1ping = find(other, 'Test Pinger', 'battlefield');
    const t = pass(other);
    expect(reject(t, { type: 'activate', player: 'p2', source: p1ping, ability: 'p:0:0' }).message).toMatch(/control/);
  });

  it('CR 602.5b: "activate only once each turn" is tracked per object and resets each turn', () => {
    const once = synth({ name: 'Test Once', type: 'Artifact', abilities: [activated('Once each turn.', {}, [], { oncePerTurn: true })] });
    let s = scenario([], { p1: { battlefield: ['Test Once'] }, defs: [once] });
    s = act(s, activate(s, 'Test Once'));
    expect(reject(s, activate(s, 'Test Once')).rules).toContain('CR 602.5b');
    expect(legal(s, 'p1', 'activate')).toEqual([]);
    s = advanceTo(s, 3, 'main1');
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
  });

  it('CR 602.5d: "activate only as a sorcery" follows sorcery timing', () => {
    const sorc = synth({ name: 'Test Sorcery Ability', type: 'Artifact', abilities: [activated('Sorcery speed.', {}, [], { sorcerySpeed: true })] });
    let s = scenario([], { p1: { battlefield: ['Test Sorcery Ability'] }, defs: [sorc] });
    s = advanceTo(s, 1, 'beginCombat');
    expect(reject(s, activate(s, 'Test Sorcery Ability')).rules).toContain('CR 602.5d');
  });

  it('CR 608.2b: an ability whose only target became illegal does not resolve', () => {
    const kill = synth({ name: 'Test Targeter', type: 'Artifact', abilities: [activated('Target creature.', {}, [targetCreature])] });
    const dummy = synth({ name: 'Dummy', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });
    let s = scenario([], { p1: { battlefield: ['Test Targeter'] }, p2: { battlefield: ['Dummy'] }, defs: [kill, dummy] });
    const d = find(s, 'Dummy', 'battlefield');
    s = act(s, activate(s, 'Test Targeter'));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: d }] });
    // Move the creature away by editing the state (a stand-in for a removal spell) and resolve.
    const t = structuredClone(s);
    t.zones.battlefield = t.zones.battlefield.filter((id) => id !== d);
    delete t.objects[d];
    const r = passBoth(t);
    expect(r.log.some((l) => /fizzles/.test(l.text) && l.rules?.includes('CR 608.2b'))).toBe(true);
    expect(r.zones.stack).toEqual([]);
  });

  it('CR 602.2a: the ability exists independently of its source: it still resolves after the source was sacrificed as a cost', () => {
    const bomb = synth({ name: 'Test Bomb', cost: '{1}', type: 'Artifact', abilities: [activated('Sacrifice: ping.', { other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, [targetPlayer])] });
    let s = scenario([], { p1: { battlefield: ['Test Bomb'] }, defs: [bomb] });
    s = act(s, activate(s, 'Test Bomb'));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(battlefieldNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Bomb']);
    expect(stackKinds(s)).toEqual(['ability:Test Bomb']);
    s = passBoth(s);
    expect(s.zones.stack).toEqual([]);
  });

  it('keys that do not exist or are not activated abilities are rejected', () => {
    const s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Llanowar Elves'] } });
    expect(reject(s, activate(s, 'Llanowar Elves', 'p:0:9')).message).toMatch(/does not exist/);
    expect(reject(s, activate(s, 'Llanowar Elves', 'r:basic:G')).message).toMatch(/does not exist/);
    const viper = scenario(['Birds of Paradise'], { p1: { battlefield: ['Birds of Paradise'] } });
    expect(reject(viper, activate(viper, 'Birds of Paradise', 'p:0:0')).message).toMatch(/not an activated ability/); // Flying: a keyword ability (printed first, WP18 line order)
  });

  it('CR 116: there are no special actions yet', () => {
    const s = scenario([], {});
    expect(reject(s, { type: 'special', player: 'p1', kind: 'turnFaceUp' }).rules).toContain('CR 116.1');
  });
});

describe('activation costs (CR 118, 602.2b)', () => {
  const costly = (cost: object, extra: Partial<Parameters<typeof activated>[3]> = {}): CardDef =>
    synth({ name: 'Test Engine', type: 'Artifact', abilities: [activated('Pay the cost.', cost, [], extra)] });

  it('a mana cost is paid through the payCost decision, and the source\'s own {T} is not available for mana', () => {
    const engine = synth({
      name: 'Test Engine', type: 'Artifact',
      abilities: [
        { kind: 'activated', text: '{T}: Add {C}.', isMana: true, cost: { tap: true }, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['C']] }] } },
        activated('{C}, {T}: Do it.', { mana: [{ kind: 'colorless' }], tap: true }),
      ],
    });
    // The engine is the only source of {C} and needs its own {T} for the cost: it can't pay for itself.
    let s = scenario([], { p1: { battlefield: ['Test Engine'] }, defs: [engine] });
    expect(legal(s, 'p1', 'activate').map((a) => (a.action as { ability: string }).ability)).toEqual(['p:0:0']); // only the mana ability
    expect(reject(s, activate(s, 'Test Engine', 'p:0:1')).message).toMatch(/can't pay \{C\}/);
    // With a Wastes it can.
    s = scenario(['Wastes'], { p1: { battlefield: ['Test Engine', 'Wastes'] }, defs: [engine] });
    s = act(s, activate(s, 'Test Engine', 'p:0:1'));
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{C}' });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(isTapped(s, find(s, 'Wastes', 'battlefield'))).toBe(true);
    expect(isTapped(s, find(s, 'Test Engine', 'battlefield'))).toBe(true);
  });

  it('CR 701.21: "sacrifice a creature" asks which one; cancelling restores everything', () => {
    const sac = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('Sacrifice a creature: go.', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })] });
    const a = synth({ name: 'Dummy A', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });
    const b = synth({ name: 'Dummy B', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });
    let s = scenario([], { p1: { battlefield: ['Test Altar', 'Dummy A', 'Dummy B'] }, defs: [sac, a, b] });
    const before = s;
    s = act(s, activate(s, 'Test Altar'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 1, max: 1, cancellable: true });
    expect((s.pending as { options: string[] }).options).toEqual([find(before, 'Dummy A', 'battlefield'), find(before, 'Dummy B', 'battlefield')]);
    const cancelled = act(s, { type: 'cancel', player: 'p1' });
    expect(battlefieldNames(cancelled)).toEqual(['Test Altar', 'Dummy A', 'Dummy B']);
    s = answer(s, { kind: 'chooseObjects', ids: [find(before, 'Dummy B', 'battlefield')] });
    expect(battlefieldNames(s)).toEqual(['Test Altar', 'Dummy A']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Dummy B']);
    expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.costObjects).toHaveLength(1);
  });

  it('CR 118.3: a cost without the resources is not offered and is rejected (nothing to sacrifice)', () => {
    const sac = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('Sacrifice a creature: go.', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })] });
    const s = scenario([], { p1: { battlefield: ['Test Altar'] }, defs: [sac] });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
    expect(reject(s, activate(s, 'Test Altar')).message).toMatch(/enough permanents or cards/);
  });

  it('CR 119.4: paying life requires at least that much life', () => {
    const l = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('Pay 3 life: go.', { other: [{ kind: 'payLife', amount: 3 }] })] });
    let s = scenario([], { p1: { battlefield: ['Test Altar'] }, defs: [l], life: 2 });
    expect(reject(s, activate(s, 'Test Altar')).rules).toContain('CR 119.4');
    s = scenario([], { p1: { battlefield: ['Test Altar'] }, defs: [l] });
    s = act(s, activate(s, 'Test Altar'));
    expect(life(s, 'p1')).toBe(17);
  });

  it('discard, exile from graveyard, tap an untapped permanent and remove counters are costs the player pays with choices', () => {
    const kit = synth({
      name: 'Test Kit', type: 'Artifact',
      abilities: [activated('Everything.', {
        other: [
          { kind: 'discard', count: 1 },
          { kind: 'exileFrom', zone: 'graveyard', count: 1 },
          { kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 },
          { kind: 'removeCounters', counter: 'charge', count: 2 },
        ],
      })],
    });
    const dummy = synth({ name: 'Dummy', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });
    let s = scenario(['Forest'], { p1: { battlefield: [{ name: 'Test Kit', counters: { charge: 3 } }, 'Dummy'], hand: ['Forest', 'Forest'], graveyard: ['Forest'] }, defs: [kit, dummy] });
    s = act(s, activate(s, 'Test Kit'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', options: s.zones.hand.p1 }); // discard
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p1![0]!] });
    // The discarded Forest is already in the graveyard, so exiling needs a choice (the tap had only one candidate).
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', options: s.zones.graveyard.p1 });
    expect(s.zones.graveyard.p1).toHaveLength(2);
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.graveyard.p1![0]!] });
    expect(s.pending!.kind).toBe('priority');
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Forest']);
    expect(s.zones.exile).toHaveLength(1);
    expect(isTapped(s, find(s, 'Dummy', 'battlefield'))).toBe(true);
    expect(s.objects[find(s, 'Test Kit', 'battlefield')]!.counters.charge).toBe(1);
  });

  it('CR 107.3, 602.2b: X in an activation cost is announced and paid', () => {
    const xa = synth({ name: 'Test X', type: 'Artifact', abilities: [activated('{X}: go.', { mana: [{ kind: 'variable', name: 'X' }] })] });
    let s = scenario(['Forest'], { p1: { battlefield: ['Test X', 'Forest', 'Forest'] }, defs: [xa] });
    s = act(s, activate(s, 'Test X'));
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 2 });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(2);
    expect(s.objects[s.zones.stack[0]!]!.stack!.x).toBe(2);
  });

  it('CR 601.2g-h: mana abilities are activated before the other costs are paid, so the only mana creature can be tapped and then sacrificed', () => {
    const sac = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('{G}, Sacrifice a creature: go.', { mana: [{ kind: 'colored', color: 'G' }], other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })] });
    let s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Test Altar', 'Llanowar Elves'] }, defs: [sac] });
    s = act(s, activate(s, 'Test Altar')); // the only creature is the only {G} source: it is tapped for mana first, then sacrificed
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(battlefieldNames(s)).toEqual(['Test Altar']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Llanowar Elves']);
    expect(s.zones.stack).toHaveLength(1);
  });
});

describe('loyalty abilities (CR 606)', () => {
  const walker = (): CardDef =>
    synth({
      name: 'Test Walker', cost: '{3}', type: 'Planeswalker — Test',
      abilities: [
        activated('+1: Do a thing.', { loyalty: 1 }, [], { isLoyalty: true }),
        activated('-2: Do another thing.', { loyalty: -2 }, [], { isLoyalty: true }),
      ],
    });

  it('CR 606.4: the cost puts or removes loyalty counters', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: [walker()] });
    s = act(s, activate(s, 'Test Walker', 'p:0:1'));
    expect(s.objects[find(s, 'Test Walker', 'battlefield')]!.counters.loyalty).toBe(1);
  });

  it('CR 606.3: only one loyalty ability per planeswalker each turn, at sorcery speed', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: [walker()] });
    s = act(s, activate(s, 'Test Walker', 'p:0:0'));
    expect(s.objects[find(s, 'Test Walker', 'battlefield')]!.counters.loyalty).toBe(4);
    expect(s.zones.stack).toHaveLength(1);
    expect(reject(s, activate(s, 'Test Walker', 'p:0:1')).rules).toContain('CR 606.3'); // stack not empty / already used
    s = passBoth(s);
    expect(reject(s, activate(s, 'Test Walker', 'p:0:1')).message).toMatch(/Only one loyalty ability/);
  });

  it('CR 606.4, 118.3: a minus ability needs enough counters', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 1 } }] }, defs: [walker()] });
    expect(reject(s, activate(s, 'Test Walker', 'p:0:1')).message).toMatch(/loyalty counters/);
    expect(legal(s, 'p1', 'activate').map((a) => (a.action as { ability: string }).ability)).toEqual(['p:0:0']);
  });
});

describe('abilities that function from other zones (CR 113.6)', () => {
  it('an ability that works from the graveyard is only offered there', () => {
    const gy = synth({ name: 'Test Graveborn', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [activated('{0}: from the graveyard.', {}, [], { zone: 'graveyard' })] });
    let s = scenario([], { p1: { graveyard: ['Test Graveborn'] }, defs: [gy] });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    const onField = scenario([], { p1: { battlefield: ['Test Graveborn'] }, defs: [gy] });
    expect(legal(onField, 'p1', 'activate')).toHaveLength(0);
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Graveborn', 'graveyard'), ability: 'p:0:0' });
    expect(s.zones.stack).toHaveLength(1);
  });
});

void [spellAbility, findAll, pool, legalActions];
