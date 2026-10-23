/**
 * Second review of milestone 4, state-based actions and game end: paying life under "can't lose life" (CR 119.8), permanents that enter with
 * counters (CR 614.1c, 306.5b), tokens with the same name (CR 111.4), deathtouch on a creature with a star toughness (CR 704.5h), Equipment
 * that is a creature (CR 301.5c, 704.5p), Auras put onto the battlefield by hand (CR 303.4f), poison counters and tokens by hand,
 * conceding (CR 104.3a), winning against a player who can't lose (CR 104.2b), counter names (CR 122.1) and face-down names in logs.
 */
import { describe, expect, it } from 'vitest';
import { addPlayerRestriction, applyAction, charsOfObject, cloneState, compileCard, createToken, legalActions, winGame, type GameState, type OracleCard } from '../../src/index';
import { Game } from '../../src/core/game';
import { getTokens } from '../fixtures';
import { reject } from '../m3/scenario';
import { synth, activated } from '../m3/synthetic';
import { act, answer, creature, find, inGraveyard, lifeOf, logHas, onBattlefield, pass, poisonOf, scenario, tweak } from './helpers';

/** Run engine code on a copy of the state, the way an effect would, and return the resulting state. */
function run(s: GameState, f: (g: Game) => void): GameState {
  const g = new Game(cloneState(s));
  f(g);
  return g.s;
}

/** Cast a card from p1's hand and pay automatically; answers X when asked. */
function castIt(s: GameState, name: string, x?: number): GameState {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  if (t.pending?.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: x ?? 0 });
  while (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  return t;
}

/** Both players pass so the top of the stack resolves. */
const resolveTop = (s: GameState): GameState => pass(pass(s));

describe('CR 119.8: a player who can\'t lose life can\'t pay life', () => {
  const altar = () => synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('Pay 3 life: go.', { other: [{ kind: 'payLife', amount: 3 }] })] });
  const noLoss = (s: GameState): GameState => run(s, (g) => addPlayerRestriction(g, 'p1', 'cantLoseLife', 'permanent'));

  it('CR 119.8, 118.3: an activated ability with "Pay 3 life" is not offered and is rejected', () => {
    const s = noLoss(scenario([], { p1: { battlefield: ['Test Altar'] }, defs: [altar()] }));
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'activate')).toEqual([]);
    const err = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Altar', 'battlefield'), ability: 'p:0:0' });
    expect(err.rules).toContain('CR 119.8');
    expect(lifeOf(s, 'p1')).toBe(20);
  });

  it('CR 107.4f, 119.8: Phyrexian mana can\'t be paid with life, so Gitaxian Probe without blue mana is not castable', () => {
    const s = noLoss(scenario(['Gitaxian Probe'], { p1: { hand: ['Gitaxian Probe'] } }));
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'cast')).toEqual([]);
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Gitaxian Probe', 'hand') });
    expect(lifeOf(s, 'p1')).toBe(20);
  });

  it('CR 107.4f, 119.8: with a blue source the Phyrexian symbol is paid with mana and no life is paid', () => {
    const s0 = noLoss(scenario(['Gitaxian Probe', 'Island'], { p1: { hand: ['Gitaxian Probe'], battlefield: ['Island'] } }));
    const s = castIt(s0, 'Gitaxian Probe');
    expect(s.zones.stack).toHaveLength(1);
    expect(lifeOf(s, 'p1')).toBe(20);
  });

  it('CR 119.4b: a cost of 0 life can always be paid, even by a player who can\'t lose life', () => {
    const free = synth({ name: 'Test Free', type: 'Artifact', abilities: [activated('Pay 0 life: go.', { other: [{ kind: 'payLife', amount: 0 }] })] });
    const s = noLoss(scenario([], { p1: { battlefield: ['Test Free'] }, defs: [free] }));
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Free', 'battlefield'), ability: 'p:0:0' });
    expect(lifeOf(t, 'p1')).toBe(20);
  });
});

describe('CR 614.1c, 306.5b: permanents that enter with counters get them before state-based actions', () => {
  it('CR 614.1c, 704.5f: Endless One cast with X = 2 enters with two +1/+1 counters and stays on the battlefield', () => {
    let s = scenario(['Endless One', 'Mountain'], { p1: { hand: ['Endless One'], battlefield: ['Mountain', 'Mountain'] } });
    s = resolveTop(castIt(s, 'Endless One', 2));
    expect(onBattlefield(s, 'Endless One', 'p1')).toBe(true);
    const id = find(s, 'Endless One', 'battlefield');
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
    expect(charsOfObject(s, s.objects[id]!)).toMatchObject({ power: '2', toughness: '2' });
    expect(logHas(s, /Endless One enters with 2 \+1\/\+1 counters/, 'CR 614.1c')).toBe(true);
    expect(inGraveyard(s, 'Endless One', 'p1')).toBe(false);
  });

  it('CR 107.3, 614.1c: with X = 0 it enters with no counters and dies at once (CR 704.5f)', () => {
    let s = scenario(['Endless One'], { p1: { hand: ['Endless One'] } });
    s = resolveTop(castIt(s, 'Endless One'));
    expect(inGraveyard(s, 'Endless One', 'p1')).toBe(true);
  });

  it('CR 614.1c: a fixed number of counters is applied the same way ("enters with three +1/+1 counters")', () => {
    const hydra = creature('Test Brute', ['0', '0'], 'This creature enters with three +1/+1 counters on it.', '{0}');
    let s = scenario([], { p1: { hand: ['Test Brute'] }, defs: [hydra] });
    s = resolveTop(castIt(s, 'Test Brute'));
    expect(s.objects[find(s, 'Test Brute', 'battlefield')]!.counters['+1/+1']).toBe(3);
  });

  it('CR 614.1c: counters text the engine can\'t evaluate is asked from the controller before state-based actions, not skipped', () => {
    const odd = creature('Test Growler', ['0', '0'], 'This creature enters with a number of +1/+1 counters on it equal to the number of glorbs you scrunched this game.', '{0}');
    let s = scenario([], { p1: { hand: ['Test Growler'] }, defs: [odd] });
    s = resolveTop(castIt(s, 'Test Growler'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    const subject = (s.pending as { subjectId?: string }).subjectId!;
    expect(s.objects[subject]).toBeDefined();
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'counters', object: subject, counter: '+1/+1', delta: 2 }] });
    expect(onBattlefield(s, 'Test Growler', 'p1')).toBe(true);
    expect(s.objects[find(s, 'Test Growler', 'battlefield')]!.counters['+1/+1']).toBe(2);
  });

  it('CR 306.5b, 704.5i: a planeswalker with a variable printed loyalty is asked for its loyalty counters, not put into the graveyard', () => {
    const walker = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', loyalty: 'X', oracle_text: '', colors: [] } as OracleCard);
    let s = scenario([], { p1: { hand: ['Test Walker'] }, defs: [walker] });
    s = resolveTop(castIt(s, 'Test Walker'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    const subject = (s.pending as { subjectId?: string }).subjectId!;
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'counters', object: subject, counter: 'loyalty', delta: 3 }] });
    expect(s.objects[find(s, 'Test Walker', 'battlefield')]!.counters.loyalty).toBe(3);
  });
});

describe('CR 306.5b, 704.5i: a planeswalker whose printed loyalty is 0', () => {
  it('CR 306.5b, 704.5i: enters with no loyalty counters and is put into the graveyard (correct as it stands, no hand adjustment is asked)', () => {
    const walker = compileCard({ name: 'Test Zero', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', loyalty: '0', oracle_text: '', colors: [] } as OracleCard);
    let s = scenario([], { p1: { hand: ['Test Zero'] }, defs: [walker] });
    s = resolveTop(castIt(s, 'Test Zero'));
    expect(s.pending?.kind).toBe('priority');
    expect(inGraveyard(s, 'Test Zero', 'p1')).toBe(true);
    expect(logHas(s, /loyalty 0/, 'CR 704.5i')).toBe(true);
  });
});

describe('CR 111.4: tokens that share a name keep their own characteristics', () => {
  it('CR 111.4: a 2/2 red and white Spirit and a 1/1 white flying Spirit are two different tokens', () => {
    const variants = getTokens('Spirit');
    const big = variants.find((t) => t.power === '2' && t.toughness === '2')!;
    const small = variants.find((t) => t.power === '1' && t.toughness === '1' && (t.oracle_text ?? '').includes('Flying'))!;
    const s = run(scenario([], {}), (g) => {
      const a = createToken(g, compileCard(big), 'p1')!;
      const b = createToken(g, compileCard(small), 'p1')!;
      const c = createToken(g, compileCard(small), 'p1')!;
      const ca = charsOfObject(g.s, g.obj(a));
      const cb = charsOfObject(g.s, g.obj(b));
      expect([ca.power, ca.toughness]).toEqual(['2', '2']);
      expect([cb.power, cb.toughness]).toEqual(['1', '1']);
      expect(cb.keywords.map((k) => k.keyword)).toContain('flying');
      expect(ca.keywords.map((k) => k.keyword)).not.toContain('flying');
      expect(g.obj(c).defId).toBe(g.obj(b).defId); // the same token twice shares one definition
      expect(g.obj(a).defId).not.toBe(g.obj(b).defId);
    });
    expect(s.zones.battlefield).toHaveLength(3);
  });
});

describe('CR 704.5h: deathtouch damage is lethal whatever the toughness is', () => {
  it('CR 704.5h: a creature with toughness "1+*" that was dealt deathtouch damage is destroyed', () => {
    const goyf = creature('Test Goyf', ['*', '1+*'], '');
    const s0 = scenario([], { p2: { battlefield: ['Test Goyf'] }, defs: [goyf] });
    const id = find(s0, 'Test Goyf', 'battlefield');
    const s = pass(tweak(s0, (t) => { t.objects[id]!.damage = 1; t.objects[id]!.deathtouchDamaged = true; }));
    expect(inGraveyard(s, 'Test Goyf', 'p2')).toBe(true);
    expect(logHas(s, /destroyed \(damage from a source with deathtouch\)/, 'CR 704.5h')).toBe(true);
  });

  it('CR 704.5g: a "*" toughness creature is still not judged by lethal damage (the engine can\'t evaluate it yet)', () => {
    const goyf = creature('Test Goyf', ['*', '1+*'], '');
    const s0 = scenario([], { p2: { battlefield: ['Test Goyf'] }, defs: [goyf] });
    const id = find(s0, 'Test Goyf', 'battlefield');
    const s = pass(tweak(s0, (t) => { t.objects[id]!.damage = 5; }));
    expect(onBattlefield(s, 'Test Goyf', 'p2')).toBe(true);
  });
});

describe('CR 301.5c, 704.5p: an Equipment that is a creature can\'t be attached to a creature', () => {
  it('CR 704.5p: an Artifact Creature - Equipment attached to a creature becomes unattached', () => {
    const bot = creature('Test Equipment Bot', ['1', '1'], '', '{1}', 'Artifact Creature — Equipment');
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Test Equipment Bot', 'Hill Giant'] }, defs: [bot] });
    const botId = find(s0, 'Test Equipment Bot', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = pass(tweak(s0, (t) => { t.objects[botId]!.attachedTo = giant; }));
    expect(s.objects[botId]!.attachedTo).toBeUndefined();
    expect(logHas(s, /becomes unattached/, 'CR 704.5p')).toBe(true);
  });
});

describe('CR 303.4f: an Aura put onto the battlefield by hand can be attached in the same step', () => {
  const boltOnto = (s0: GameState, ops: (s: GameState) => unknown[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = answer(s, { kind: 'payCost', auto: true });
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    return answer(s, { kind: 'manualResolve', ops: ops(s) as never });
  };

  it('CR 303.4f, 704.5m: a move operation with attachTo puts Pacifism onto the battlefield attached to a creature, and it stays there', () => {
    const s0 = scenario(['Pacifism', 'Lightning Bolt', 'Mountain', 'Hill Giant'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain', 'Hill Giant'], graveyard: ['Pacifism'] }, manual: ['Lightning Bolt'] });
    const pac = find(s0, 'Pacifism', 'graveyard');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = boltOnto(s0, () => [{ op: 'move', object: pac, to: 'battlefield', attachTo: giant }]);
    expect(onBattlefield(s, 'Pacifism', 'p1')).toBe(true);
    expect(s.objects[find(s, 'Pacifism', 'battlefield')]!.attachedTo).toBe(giant);
    expect(inGraveyard(s, 'Pacifism', 'p1')).toBe(false);
  });

  it('CR 303.4f: attachTo needs a real object or player and only goes with a move to the battlefield', () => {
    const s0 = scenario(['Pacifism', 'Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'], graveyard: ['Pacifism'] }, manual: ['Lightning Bolt'] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = resolveTop(answer(s, { kind: 'payCost', auto: true }));
    const pac = find(s, 'Pacifism', 'graveyard');
    for (const op of [{ op: 'move', object: pac, to: 'battlefield', attachTo: 'nothing' }, { op: 'move', object: pac, to: 'hand', attachTo: 'p2' }]) {
      reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [op] } as never });
    }
  });
});

describe('CR 104.3d, 122.1f, 111: poison counters and tokens can be given by hand', () => {
  const resolveByHand = (s0: GameState, card: string, ops: (s: GameState) => unknown[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, card, 'hand') });
    s = resolveTop(answer(s, { kind: 'payCost', auto: true }));
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    return answer(s, { kind: 'manualResolve', ops: ops(s) as never });
  };

  it('CR 122.1f: a counters operation on a player gives poison counters; ten make the player lose (CR 704.5c)', () => {
    const s0 = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    const s = resolveByHand(s0, 'Lightning Bolt', () => [{ op: 'counters', object: 'p2', counter: 'poison', delta: 3 }]);
    expect(poisonOf(s, 'p2')).toBe(3);
    const t = resolveByHand(s0, 'Lightning Bolt', () => [{ op: 'counters', object: 'p2', counter: 'poison', delta: 10 }]);
    expect(t.result).toMatchObject({ winner: 'p1' });
  });

  it('CR 122.1: counters other than poison on a player are rejected with an explanation (the engine tracks no other player counters yet)', () => {
    const s0 = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = resolveTop(answer(s, { kind: 'payCost', auto: true }));
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'counters', object: 'p2', counter: 'banana', delta: 1 }] } });
  });

  it('CR 111.1, 111.4: a token operation creates tokens with the stated characteristics (Raise the Alarm)', () => {
    // W3b: the default compiler creates the tokens itself now; the token OPERATION is the subject here, so the text is kept manual
    const s0 = scenario(['Raise the Alarm', 'Plains'], { p1: { hand: ['Raise the Alarm'], battlefield: ['Plains', 'Plains'] }, manual: ['Raise the Alarm'] });
    const soldier = { op: 'token', player: 'p1', name: 'Soldier', typeLine: 'Token Creature — Soldier', power: '1', toughness: '1', colors: ['W'] };
    const s = resolveByHand(s0, 'Raise the Alarm', () => [soldier, soldier]);
    const soldiers = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(soldiers).toHaveLength(2);
    const c = charsOfObject(s, s.objects[soldiers[0]!]!);
    expect([c.name, c.power, c.toughness, c.colors, c.types, c.subtypes]).toEqual(['Soldier', '1', '1', ['W'], ['Creature'], ['Soldier']]);
    expect(s.objects[soldiers[0]!]!.controller).toBe('p1');
  });

  it('CR 111: a token operation with bad characteristics is rejected, not a crash', () => {
    const s0 = scenario(['Raise the Alarm', 'Plains'], { p1: { hand: ['Raise the Alarm'], battlefield: ['Plains', 'Plains'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Raise the Alarm', 'hand') });
    s = resolveTop(answer(s, { kind: 'payCost', auto: true }));
    for (const op of [{ op: 'token', player: 'p9', name: 'X', typeLine: 'Token Creature' }, { op: 'token', player: 'p1', name: '', typeLine: 'Token Creature' }, { op: 'token', player: 'p1', name: 'X', typeLine: 'Token Creature', colors: ['Q'] }]) {
      reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [op] } as never });
    }
  });
});

describe('CR 104.3a, 104.2b: conceding and winning', () => {
  it('CR 104.3a: a player who concedes is marked as having conceded, and nobody has priority once the game is over', () => {
    const s = act(scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }), { type: 'concede', player: 'p2' });
    expect(s.players[1]).toMatchObject({ hasLost: true, conceded: true, lostReason: 'conceded' });
    expect(s.players[0]!.conceded).toBe(false);
    expect(s.priority.player).toBeNull();
    expect(s.stage).toBe('over');
  });

  it('CR 104.2b, 104.3b: an effect that makes a player win does not claim a win when an opponent can\'t lose the game', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const s = run(s0, (g) => {
      addPlayerRestriction(g, 'p2', 'cantLoseGame', 'permanent');
      winGame(g, 'p1', 'Test Win');
    });
    expect(s.result).toBeNull();
    expect(s.log.some((l) => /wins the game/.test(l.text))).toBe(false);
    expect(logHas(s, /Bob can't lose the game/)).toBe(true);
  });

  it('CR 104.2b: when every opponent loses, the win is announced', () => {
    const s = run(scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }), (g) => winGame(g, 'p1', 'Test Win'));
    expect(s.result).toMatchObject({ winner: 'p1' });
    expect(logHas(s, /Alice wins the game: Test Win/, 'CR 104.2b')).toBe(true);
  });
});

describe('CR 122.1: counter names are plain names, never object members', () => {
  const withBolt = () => scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] }, manual: ['Lightning Bolt'] });
  const bolt = (s0: GameState, ops: unknown[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = resolveTop(answer(s, { kind: 'payCost', auto: true }));
    return answer(s, { kind: 'manualResolve', ops: ops as never });
  };

  it('CR 122.1: counters named after Object.prototype members count from zero and survive a JSON round trip', () => {
    const s0 = withBolt();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const s = bolt(s0, [{ op: 'counters', object: bears, counter: name, delta: 2 }]);
      expect(Object.getOwnPropertyDescriptor(s.objects[bears]!.counters, name)?.value, name).toBe(2);
      expect(JSON.parse(JSON.stringify(s.objects[bears]!.counters))[name], name).toBe(2);
      const t = bolt(s0, [{ op: 'counters', object: bears, counter: name, delta: 2 }, { op: 'counters', object: bears, counter: name, delta: -2 }]);
      expect(Object.keys(t.objects[bears]!.counters)).not.toContain(name);
    }
  });

  it('CR 122.1: the name "__proto__" is rejected with an explanation', () => {
    const s0 = withBolt();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = resolveTop(answer(s, { kind: 'payCost', auto: true }));
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'counters', object: bears, counter: '__proto__', delta: 2 }] } });
    expect(err.message).toMatch(/counter/i);
    void applyAction;
  });
});

describe('CR 708.2a: other log lines name a face-down creature "a face-down card"', () => {
  it('CR 704.5q: +1/+1 and -1/-1 counters annihilate on a face-down creature without printing an empty name', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = pass(tweak(s0, (t) => { const o = t.objects[bears]!; o.faceDown = true; o.counters['+1/+1'] = 1; o.counters['-1/-1'] = 1; }));
    expect(logHas(s, /a face-down card loses 1 \+1\/\+1 and 1 -1\/-1 counters/, 'CR 704.5q')).toBe(true);
    expect(s.log.some((l) => /^ /.test(l.text))).toBe(false);
  });
});
