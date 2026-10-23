import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type GameState } from '../../src/index';
import { act, advanceTo, answer, battlefieldNames, castAuto, find, labels, legal, life, pass, passBoth, reject, scenario, zoneNames } from './scenario';
import { charm, freeSpell, keyword, poke, smite, synth, spellAbility, targetCreature } from './synthetic';

const castAction = (s: GameState, name: string, extra: object = {}, player = 'p1') => ({ type: 'cast' as const, player, card: find(s, name, 'hand', player), ...extra });
const stackNames = (s: GameState): string[] => s.zones.stack.map((id) => s.objects[id]!.defId);

describe('permission to cast (CR 601.3, 117.1a)', () => {
  it('CR 117.1a: a creature spell can be cast in your own main phase with an empty stack', () => {
    const s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    expect(labels(s, 'p1')).toContain('Cast Grizzly Bears');
    expect(castAuto(s, 'Grizzly Bears').zones.stack).toHaveLength(1);
  });

  it('CR 117.1a: a creature spell cannot be cast during the opponent\'s turn', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = advanceTo(s, 2, 'main1');
    s = pass(s); // p2 passes; p1 receives priority in p2's main phase
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const err = reject(s, castAction(s, 'Grizzly Bears'));
    expect(err.message).toMatch(/own turn/);
    expect(err.rules).toContain('CR 117.1a');
    expect(labels(s, 'p1')).not.toContain('Cast Grizzly Bears');
  });

  it('CR 117.1a: a creature spell cannot be cast outside a main phase', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = advanceTo(s, 1, 'beginCombat');
    expect(reject(s, castAction(s, 'Grizzly Bears')).message).toMatch(/main phase/);
  });

  it('CR 117.1a: nothing but instants and flash can be cast while the stack is not empty', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant', 'Forest', 'Mountain'], { p1: { hand: ['Grizzly Bears', 'Hill Giant'], battlefield: ['Forest', 'Forest', 'Mountain', 'Mountain', 'Mountain'] } });
    s = castAuto(s, 'Grizzly Bears');
    const err = reject(s, castAction(s, 'Hill Giant'));
    expect(err.message).toMatch(/stack is empty/);
  });

  it('CR 307.1: a sorcery is cast at sorcery speed only', () => {
    let s = scenario(['Day of Judgment', 'Plains'], { p1: { hand: ['Day of Judgment'], battlefield: Array(4).fill('Plains') } });
    s = advanceTo(s, 2, 'main1');
    s = pass(s);
    const err = reject(s, castAction(s, 'Day of Judgment'));
    expect(err.rules).toContain('CR 307.1');
  });

  it('CR 304.1: an instant can be cast at any time you have priority - on the opponent\'s turn, in combat, in response', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] } });
    s = advanceTo(s, 1, 'beginCombat');
    expect(labels(s, 'p1')).toContain('Cast Lightning Bolt');
    s = advanceTo(s, 2, 'upkeep');
    s = pass(s);
    expect(s.pending!.player).toBe('p1');
    s = castAuto(s, 'Lightning Bolt');
    expect(stackNames(s)).toEqual(['Lightning Bolt']);
  });

  it('CR 702.8a: a creature with flash can be cast at instant speed', () => {
    let s = scenario(['Ambush Viper', 'Forest'], { p1: { hand: ['Ambush Viper'], battlefield: ['Forest', 'Forest'] } });
    s = advanceTo(s, 1, 'beginCombat');
    s = castAuto(s, 'Ambush Viper');
    expect(stackNames(s)).toEqual(['Ambush Viper']);
  });

  it('CR 117.1: only the player with priority can act', () => {
    const s = scenario(['Lightning Bolt', 'Mountain'], { p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] } });
    const err = reject(s, castAction(s, 'Lightning Bolt', {}, 'p2'));
    expect(err.message).toMatch(/Alice has priority, not Bob/);
  });

  it('CR 601.3: a card must be cast from where it is allowed: not from the battlefield, graveyard (without flashback) or library', () => {
    const s = scenario(['Grizzly Bears', 'Forest'], { p1: { graveyard: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    const card = find(s, 'Grizzly Bears', 'graveyard');
    expect(reject(s, { type: 'cast', player: 'p1', card }).message).toMatch(/from your hand/);
  });

  it('CR 601.3: you cannot cast cards from another player\'s hand', () => {
    const s = scenario(['Grizzly Bears', 'Forest'], { p2: { hand: ['Grizzly Bears'] }, p1: { battlefield: ['Forest', 'Forest'] } });
    const err = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'hand', 'p2') });
    expect(err.message).toBe("You can't cast that card."); // M1/m3 (audit 2026-10-12, CR 400.2): the same answer for any card the player can't see
  });

  it('CR 305.1: a land is played, never cast', () => {
    const s = scenario(['Forest'], { p1: { hand: ['Forest'] } });
    const err = reject(s, castAction(s, 'Forest'));
    expect(err.rules).toContain('CR 305.1');
  });

  it('CR 202.1b, 118.6: a card with no mana cost cannot be cast', () => {
    const s = scenario([], { p1: { hand: ['Test Free'] }, defs: [freeSpell()] });
    const err = reject(s, castAction(s, 'Test Free'));
    expect(err.message).toMatch(/no mana cost/);
    expect(err.rules).toContain('CR 118.6');
  });

  it('CR 601.2h, 118.3: with not enough mana the cast is rejected with an explanation and nothing changes', () => {
    const s = scenario(['Lightning Bolt', 'Forest'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Forest'] } });
    const err = reject(s, castAction(s, 'Lightning Bolt'));
    expect(err.message).toMatch(/can't pay \{R\}/);
    expect(labels(s, 'p1')).not.toContain('Cast Lightning Bolt');
  });

  it('CR 601.2c, 115.1: a spell that needs a target cannot be cast when there is no legal target', () => {
    const s = scenario(['Mountain'], { p1: { hand: ['Test Poke'], battlefield: ['Mountain'] }, defs: [poke()] });
    const err = reject(s, castAction(s, 'Test Poke'));
    expect(err.message).toMatch(/needs a target/);
  });

  it('CR 712.8c: the back face of a transforming double-faced card cannot be cast', () => {
    const name = 'Delver of Secrets // Insectile Aberration';
    const s = scenario([name, 'Island'], { p1: { hand: [name], battlefield: ['Island'] } });
    expect(reject(s, castAction(s, name, { face: 1 })).message).toMatch(/can't be cast/);
    expect(labels(s, 'p1')).toEqual(['Pass priority', 'Cast Delver of Secrets', 'Island: {T}: Add {U}.']);
  });
});

describe('the stack and priority (CR 117.3, 117.4, 405)', () => {
  it('CR 117.3c: after casting a spell the caster receives priority again, and the opponent only after they pass', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = castAuto(s, 'Grizzly Bears');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(stackNames(s)).toEqual(['Grizzly Bears']); // not resolved yet
  });

  it('CR 117.4: the top object resolves only when all players pass in succession', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = castAuto(s, 'Grizzly Bears');
    s = passBoth(s);
    expect(stackNames(s)).toEqual([]);
    expect(battlefieldNames(s, 'p1')).toContain('Grizzly Bears');
  });

  it('CR 117.3b: the active player receives priority after a spell resolves', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = castAuto(s, 'Grizzly Bears');
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.turn.step).toBe('main1');
  });

  it('CR 117.4: casting a spell after the opponent passed resets the passes (the opponent must pass again)', () => {
    let s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Forest', 'Mountain'], { p1: { hand: ['Grizzly Bears', 'Lightning Bolt'], battlefield: ['Forest', 'Forest', 'Mountain'] }, manual: ['Lightning Bolt'] });
    s = castAuto(s, 'Grizzly Bears');
    s = pass(s); // p1 passes, p2 has priority
    s = pass(s); // p2 passes -> Bears resolve, p1 gets priority
    expect(stackNames(s)).toEqual([]);
    s = castAuto(s, 'Lightning Bolt');
    s = pass(s); // p1 passes
    expect(s.pending!.player).toBe('p2'); // p2 must also pass before Bolt resolves
    expect(stackNames(s)).toEqual(['Lightning Bolt']);
  });

  it('CR 405.2, 608: the stack is last in, first out - a response resolves first', () => {
    let s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Forest', 'Mountain'], { p1: { hand: ['Grizzly Bears', 'Lightning Bolt'], battlefield: ['Forest', 'Forest', 'Mountain'] }, manual: ['Lightning Bolt'] });
    s = castAuto(s, 'Grizzly Bears');
    s = castAuto(s, 'Lightning Bolt'); // in response
    expect(stackNames(s)).toEqual(['Grizzly Bears', 'Lightning Bolt']);
    s = passBoth(s);
    // Lightning Bolt has rules text the engine can't run yet: its controller resolves it by hand.
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Lightning Bolt' });
    s = answer(s, { kind: 'manualResolve', ops: [] });
    expect(stackNames(s)).toEqual(['Grizzly Bears']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Lightning Bolt']); // CR 608.2n
    s = passBoth(s);
    expect(battlefieldNames(s, 'p1')).toContain('Grizzly Bears');
  });

  it('CR 117.1a: the opponent can respond with an instant of their own; their spell resolves first', () => {
    let s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Forest', 'Mountain'], {
      p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] },
      p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] },
      manual: ['Lightning Bolt'],
    });
    s = castAuto(s, 'Grizzly Bears');
    s = pass(s);
    s = castAuto(s, 'Lightning Bolt', { player: 'p2' });
    expect(stackNames(s)).toEqual(['Grizzly Bears', 'Lightning Bolt']);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' }); // p2 keeps priority after casting
    s = pass(s);
    s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p2' });
  });
});

describe('resolution (CR 608)', () => {
  it('CR 608.3a: a permanent spell enters the battlefield under its controller\'s control and is summoning sick', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = passBoth(castAuto(s, 'Grizzly Bears'));
    const bears = s.objects[find(s, 'Grizzly Bears', 'battlefield')]!;
    expect(bears).toMatchObject({ controller: 'p1', owner: 'p1', zone: 'battlefield', tapped: false, controlledSinceTurn: 1 });
    expect(s.log.some((l) => l.rules?.includes('CR 608.3'))).toBe(true);
  });

  it('CR 400.7: the spell is a new object each time it changes zones', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    const inHand = find(s, 'Grizzly Bears', 'hand');
    s = castAuto(s, 'Grizzly Bears');
    const onStack = s.zones.stack[0]!;
    s = passBoth(s);
    const onBattlefield = find(s, 'Grizzly Bears', 'battlefield');
    expect(new Set([inHand, onStack, onBattlefield]).size).toBe(3);
    expect(s.lki[inHand]!.newId).toBe(onStack);
    expect(s.objects[onBattlefield]!.cardId).toBe(s.lki[inHand]!.object.cardId);
  });

  it('CR 608.2n: an instant or sorcery with no effect goes to its owner\'s graveyard when it resolves', () => {
    let s = scenarioWithTarget();
    s = castAuto(s, 'Test Poke', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Dummy', 'battlefield') }] }] });
    s = passBoth(s);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Poke']);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('manual resolution: an instant whose effect the engine cannot run is resolved by hand and every adjustment is logged', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    s = passBoth(castAuto(s, 'Lightning Bolt'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', text: 'Lightning Bolt deals 3 damage to any target.' });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'damage', target: 'p2', amount: 3 }] });
    expect(life(s, 'p2')).toBe(17);
    expect(s.pending!.kind).toBe('priority');
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Lightning Bolt']);
  });

  it('a permanent with rules text the engine cannot automate yet enters with a visible warning in the log', () => {
    // FAST5X E28: Kitchen Finks (persist) is automated now; std-ry8: so is Hexbane Tortoise's enlist (CR 702.154); Aven Warhawk's amplify (CR 702.38) is not
    let s = scenario(['Aven Warhawk', 'Plains'], { p1: { hand: ['Aven Warhawk'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    s = passBoth(castAuto(s, 'Aven Warhawk'));
    const warn = s.log.filter((l) => l.level === 'manual');
    expect(warn.length).toBeGreaterThan(0);
    expect(warn[0]!.text).toMatch(/Aven Warhawk has rules text the engine cannot automate yet/);
  });

  it('CR 608.2b: a spell whose only target became illegal does not resolve (it is removed from the stack)', () => {
    let s = scenarioWithTarget();
    const giant = find(s, 'Dummy', 'battlefield');
    s = castAuto(s, 'Test Poke', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] }] });
    s = castAuto(s, 'Test Smite', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] }] });
    s = passBoth(s); // Test Smite resolves first: by hand it destroys the creature
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: giant, to: 'graveyard' }] });
    expect(stackNames(s)).toEqual(['Test Poke']);
    s = passBoth(s);
    expect(stackNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Poke', 'Test Smite']);
    expect(s.log.some((l) => l.rules?.includes('CR 608.2b') && /fizzles/.test(l.text))).toBe(true);
  });
});

describe('modes, targets and optional costs (CR 601.2b-c)', () => {
  it('CR 601.2b, 700.2: modes are chosen first, then a target for each chosen mode', () => {
    let s = scenarioWithTarget({ extra: [charm()], hand: ['Test Charm'], lands: ['Island', 'Island'] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 2 });
    s = answer(s, { kind: 'chooseOption', ids: ['0', '1'] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target player', players: ['p1', 'p2'] });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target creature' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Dummy', 'battlefield') }] });
    s = answer(s, { kind: 'payCost', auto: true });
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.stack!.modes).toEqual([0, 1]);
    expect(spell.stack!.targets).toEqual([[{ kind: 'player', id: 'p2' }], [{ kind: 'object', id: find(s, 'Dummy', 'battlefield') }]]);
  });

  it('CR 601.2c: a mode with no legal target is disabled and cannot be chosen', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Charm'], battlefield: ['Island', 'Island'] }, defs: [charm()] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand') });
    if (s.pending?.kind !== 'chooseOption') throw new Error('expected a mode choice');
    expect(s.pending.options.find((o) => o.id === '1')!.disabled).toMatch(/no legal targets/);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending.id, answer: { kind: 'chooseOption', ids: ['1'] } });
    expect(err.message).toMatch(/can't be chosen/);
  });

  it('CR 115.1, 601.2c: only legal targets are accepted', () => {
    let s = scenarioWithTarget();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Poke', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 1, max: 1 });
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } });
    expect(err.rules).toContain('CR 115.1');
  });

  it('CR 733.1: cancelling at the target choice puts the card back in hand', () => {
    let s = scenarioWithTarget();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Poke', 'hand') });
    expect(stackNames(s)).toEqual(['Test Poke']);
    s = act(s, { type: 'cancel', player: 'p1' });
    expect(stackNames(s)).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Poke', 'Test Smite']);
  });

  it('CR 702.33a, 601.2b: kicker is announced as the spell is cast and its cost is added', () => {
    const kicker = synth({ name: 'Test Kicker', cost: '{G}', type: 'Creature', pt: ['1', '1'], abilities: [keyword('kicker', { mana: [{ kind: 'generic', amount: 2 }] })] });
    let s = scenario(['Forest'], { p1: { hand: ['Test Kicker'], battlefield: Array(3).fill('Forest') }, defs: [kicker] });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kicker', 'hand') });
    expect(t.pending).toMatchObject({ kind: 'yesNo', cancellable: true });
    t = answer(t, { kind: 'yesNo', yes: true });
    expect(t.pending).toMatchObject({ kind: 'payCost', costText: '{2}{G}' }); // CMDF: canonical order (CR 107.4, 202.1)
    t = answer(t, { kind: 'payCost', auto: true });
    expect(t.objects[t.zones.stack[0]!]!.stack!.costsPaid.kicked).toBe(1);
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.tapped)).toHaveLength(3);
    // Not kicked: only {G}.
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kicker', 'hand') });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{G}' });
  });

  it('CR 702.34a: flashback casts an instant or sorcery from the graveyard for its flashback cost and exiles it afterwards', () => {
    const fb = synth({ name: 'Test Flash', cost: '{R}', type: 'Instant', abilities: [spellAbility('Nothing.'), keyword('flashback', { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'R' }] })] });
    let s = scenario(['Mountain'], { p1: { graveyard: ['Test Flash'], battlefield: Array(3).fill('Mountain') }, defs: [fb] });
    expect(labels(s, 'p1')).toContain('Cast Test Flash with flashback');
    s = castAuto(s, 'Test Flash', { method: 'flashback' });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(3);
    s = passBoth(s);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Flash']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
  });
});

describe('multi-faced cards (CR 709, 712, 715)', () => {
  it('CR 709.3: the player chooses which half of a split card to cast; each half is evaluated alone', () => {
    let s = scenario(['Fire // Ice', 'Island', 'Mountain'], { p1: { hand: ['Fire // Ice'], battlefield: ['Island', 'Island'] } });
    // Only Ice ({1}{U}) is castable with two Islands; Fire ({1}{R}) is not.
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Ice']);
    reject(s, castAction(s, 'Fire // Ice', { face: 0 }));
    s = castAuto(s, 'Fire // Ice', { face: 1 });
    expect(getChars(s, s.zones.stack[0]!).name).toBe('Ice');
    expect(s.objects[s.zones.stack[0]!]!.stack!.face).toBe(1);
  });

  it('CR 709.4: a split card in hand is one card; after an instant half resolves it goes to the graveyard as one card', () => {
    // W3b: Ice ("Tap target permanent. Draw a card.") is understood since the template set is wired into the default compiler: it announces its
    // target (CR 601.2c) and resolves by itself (CR 608.2), no manual prompt.
    let s = scenario(['Fire // Ice', 'Island', 'Mountain'], { p1: { hand: ['Fire // Ice'], battlefield: ['Island', 'Island'] }, p2: { battlefield: ['Mountain'] } });
    const mountain = find(s, 'Mountain', 'battlefield', 'p2');
    s = castAuto(s, 'Fire // Ice', { face: 1, answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: mountain }] }] });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.objects[mountain]!.tapped).toBe(true);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Fire // Ice']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Plains']); // drew a card (the scenario library is Plains)
  });

  it('CR 715.3: an adventurer card can be cast as its Adventure; CR 715.3d it is then exiled and may be cast as a creature later', () => {
    const name = 'Bonecrusher Giant // Stomp';
    let s = scenario([name, 'Mountain'], { p1: { hand: [name], battlefield: Array(5).fill('Mountain') }, manual: [name] });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Bonecrusher Giant', 'Cast Stomp']);
    s = passBoth(castAuto(s, name, { face: 1 }));
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    s = answer(s, { kind: 'manualResolve', ops: [] });
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual([name]);
    expect(s.objects[s.zones.exile[0]!]!.chosen).toEqual({ onAdventure: true });
    expect(labels(s, 'p1')).toContain('Cast Bonecrusher Giant from exile');
    // Cast the creature from exile.
    const card = s.zones.exile[0]!;
    s = act(s, { type: 'cast', player: 'p1', card });
    s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(battlefieldNames(s, 'p1')).toContain(name);
    expect(s.zones.exile).toEqual([]);
  });

  it('CR 715.3d: a card on an adventure cannot be cast as the Adventure again', () => {
    const name = 'Bonecrusher Giant // Stomp';
    const s = scenario([name, 'Mountain'], { p1: { exile: [{ name, onAdventure: true }], battlefield: Array(3).fill('Mountain') } });
    const err = reject(s, { type: 'cast', player: 'p1', card: s.zones.exile[0]!, face: 1 });
    expect(err.rules).toContain('CR 715.3d');
  });

  it('CR 712.11b: a modal double-faced card is cast as the front face; CR 712.12: it can be played as a land with the back face', () => {
    const name = 'Agadeem\'s Awakening // Agadeem, the Undercrypt';
    const s = scenario([name, 'Swamp'], { p1: { hand: [name], battlefield: Array(3).fill('Swamp') } });
    const l = labels(s, 'p1');
    expect(l).toContain('Play Agadeem, the Undercrypt');
    expect(l).toContain('Cast Agadeem\'s Awakening');
    // W3b: the back face asks "pay 3 life or enter tapped" as it enters (CR 614.12a), now that its text is understood
    const played = answer(act(s, { type: 'playLand', player: 'p1', card: find(s, name, 'hand'), face: 1 }), { kind: 'yesNo', yes: true });
    expect(life(played, 'p1')).toBe(17);
    expect(getChars(played, find(played, name, 'battlefield'))).toMatchObject({ name: 'Agadeem, the Undercrypt', types: ['Land'] });
    expect(played.objects[find(played, name, 'battlefield')]!.face).toBe(1);
  });
});

describe('legalActions never lists what would be rejected (spot checks; the soak test covers the rest)', () => {
  it('every listed action is accepted', () => {
    const s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Forest', 'Mountain', 'Llanowar Elves', 'Fire // Ice', 'Kitchen Finks'], {
      p1: { hand: ['Grizzly Bears', 'Lightning Bolt', 'Forest', 'Fire // Ice', 'Kitchen Finks'], battlefield: ['Forest', 'Mountain', 'Mountain', 'Llanowar Elves'] },
    });
    const list = legalActions(s, 'p1');
    expect(list.length).toBeGreaterThan(5);
    for (const a of list) expect(() => act(s, a.action), a.label).not.toThrow();
    expect(legal(s, 'p2')).toEqual([]); // p2 does not have priority
  });
});

function scenarioWithTarget(opts: { extra?: ReturnType<typeof poke>[]; hand?: string[]; lands?: string[] } = {}): GameState {
  const dummy = synth({ name: 'Dummy', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });
  const lands = opts.lands ?? ['Mountain', 'Swamp'];
  return scenario(['Mountain', 'Swamp', 'Island'], {
    p1: { hand: opts.hand ?? ['Test Poke', 'Test Smite'], battlefield: lands },
    p2: { battlefield: ['Dummy'] },
    defs: [poke(), smite(), dummy, ...(opts.extra ?? [])],
  });
}
