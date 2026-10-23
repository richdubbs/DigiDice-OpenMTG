/**
 * M12-3 (m12 design D14, 3, 4.3): goad (CR 701.15), the native keyword action (effects/handlers/goad.ts) and its two combat requirements
 * (statics/requirements.ts#goadHits, CR 508.1d), played with the acceptance cards Disrupt Decorum and Vengeful Ancestor in 4-player games (Free-for-All,
 * CR 806), and in a two-player game (m12 design D16: a card that newly plays fully there plays as written).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, concede, drive, find, lifeOf, logHas, mpScenario, pass, resolveStack } from '../rules/helpers';
import { scenario } from '../../m3/scenario';

const RED4 = ['Mountain', 'Mountain', 'Mountain', 'Mountain'];

/** Alice casts the sorcery or creature `name` from her hand (targets in `answers`) and everyone passes until it and its triggers resolved. */
function aliceCasts(s: GameState, name: string, answers: Parameters<typeof drive>[1] = []): GameState {
  const t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), answers);
  return resolveStack(t, answers);
}

/** Pass priority until `player` is asked to declare attackers (no other decision on the way). */
function toAttacks(s: GameState, player: PlayerId): GameState {
  let t = s;
  for (let i = 0; i < 400; i++) {
    if (t.pending?.kind === 'declareAttackers' && t.pending.player === player) return t;
    if (t.pending?.kind === 'declareAttackers') { t = answer(t, { kind: 'declareAttackers', attacks: [] }); continue; }
    if (t.pending?.kind === 'declareBlockers') { t = answer(t, { kind: 'declareBlockers', blocks: [] }); continue; }
    if (t.pending?.kind !== 'priority') throw new Error(`unexpected ${t.pending?.kind}: ${t.pending?.prompt}`);
    t = pass(t);
  }
  throw new Error(`${player} never declared attackers`);
}

const declare = (s: GameState, attacks: { attacker: ObjectId; defender: string }[]) =>
  applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } });

describe('CR 701.15: goad in a 4-player game (Disrupt Decorum)', () => {
  const setup = (extra: Partial<Record<PlayerId, (string | { name: string; counters: Record<string, number> })[]>> = {}) => mpScenario({
    cards: ['Disrupt Decorum', 'Mountain', 'Grizzly Bears', 'Jace Beleren'],
    zones: { p1: { hand: ['Disrupt Decorum'], battlefield: RED4 }, p2: { battlefield: ['Grizzly Bears', ...(extra.p2 ?? [])] }, p3: { battlefield: extra.p3 ?? [] }, p4: { battlefield: extra.p4 ?? [] } },
  });

  it('CR 701.15a: "goad all creatures you don\'t control" goads each of them for Alice (the controller of the spell), and not her own', () => {
    let s = setup();
    s = aliceCasts(s, 'Disrupt Decorum');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p1' }]);
    expect(logHas(s, /Alice goads Grizzly Bears/, 'CR 701.15a')).toBe(true);
  });

  it('CR 701.15b, 508.1d: the goaded creature must attack, and must attack a player other than the goader if able', () => {
    let s = aliceCasts(setup(), 'Disrupt Decorum');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = toAttacks(s, 'p2');
    expect(s.pending).toMatchObject({ kind: 'declareAttackers', mustObey: 2 });
    // no attack: obeys neither requirement
    expect(declare(s, []).error?.rules).toContain('CR 508.1d');
    // the goader: obeys only "attacks each combat if able"
    expect(declare(s, [{ attacker: bears, defender: 'p1' }]).error?.message).toMatch(/attacks a player other than Alice/);
    // Carol or Dan: both obeyed
    expect(declare(s, [{ attacker: bears, defender: 'p3' }]).error).toBeUndefined();
    expect(declare(s, [{ attacker: bears, defender: 'p4' }]).error).toBeUndefined();
  });

  it('CR 701.15b: attacking a planeswalker of another player is not attacking a player other than the goader', () => {
    let s = aliceCasts(setup({ p3: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] }), 'Disrupt Decorum');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = toAttacks(s, 'p2');
    expect(declare(s, [{ attacker: bears, defender: find(s, 'Jace Beleren', 'battlefield', 'p3') }]).error?.rules).toContain('CR 508.1d');
    expect(declare(s, [{ attacker: bears, defender: 'p3' }]).error).toBeUndefined();
  });

  it('CR 701.15c: goaded by Alice and Carol, it must attack Dan; once Dan left, it attacks Alice or Carol (any one obeys three of the four requirements)', () => {
    let s = aliceCasts(setup(), 'Disrupt Decorum');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s.objects[bears]!.goaded = [{ by: 'p1' }, { by: 'p3' }]; // Carol's goad too (as her own Disrupt Decorum would)
    let t = toAttacks(s, 'p2');
    expect(t.pending).toMatchObject({ mustObey: 4 });
    expect(declare(t, [{ attacker: bears, defender: 'p1' }]).error?.rules).toContain('CR 508.1d');
    expect(declare(t, [{ attacker: bears, defender: 'p3' }]).error?.rules).toContain('CR 508.1d');
    expect(declare(t, [{ attacker: bears, defender: 'p4' }]).error).toBeUndefined();
    t = toAttacks(concede(s, 'p4').state, 'p2');
    expect(t.pending).toMatchObject({ mustObey: 3 });
    expect(declare(t, [])).toMatchObject({ error: { rules: expect.arrayContaining(['CR 508.1d']) } });
    expect(declare(t, [{ attacker: bears, defender: 'p1' }]).error).toBeUndefined();
    expect(declare(t, [{ attacker: bears, defender: 'p3' }]).error).toBeUndefined();
  });

  it('CR 701.15d: goading it again by the same player has no effect (one entry, no event)', () => {
    let s = mpScenario({
      cards: ['Disrupt Decorum', 'Mountain', 'Grizzly Bears'],
      zones: { p1: { hand: ['Disrupt Decorum', 'Disrupt Decorum'], battlefield: [...RED4, ...RED4] }, p2: { battlefield: ['Grizzly Bears'] } },
    });
    s = aliceCasts(s, 'Disrupt Decorum');
    const from = s.log.length;
    s = aliceCasts(s, 'Disrupt Decorum');
    expect(s.objects[find(s, 'Grizzly Bears', 'battlefield', 'p2')]!.goaded).toEqual([{ by: 'p1' }]);
    expect(s.log.slice(from).some((l) => /already goaded by Alice/.test(l.text) && l.rules?.includes('CR 701.15d'))).toBe(true);
  });

  it('CR 701.15a: the goad ends as the goader\'s next turn begins; CR 400.7: a goaded creature that leaves and returns is a new object, not goaded', () => {
    let s = aliceCasts(setup(), 'Disrupt Decorum');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = toAttacks(s, 'p2');
    s = act(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bears, defender: 'p3' }] } });
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p1' }]);
    for (let i = 0; i < 400 && !(s.turn.activePlayer === 'p1' && s.turn.number === 5); i++) {
      if (s.pending?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      if (s.pending?.kind === 'declareBlockers') { s = answer(s, { kind: 'declareBlockers', blocks: [] }); continue; }
      s = pass(s);
    }
    expect(Object.hasOwn(s.objects[bears]!, 'goaded')).toBe(false);
  });
});

describe('Vengeful Ancestor (m12 design 3): "goad target creature"; "whenever a goaded creature attacks, it deals 1 damage to its controller"', () => {
  it('CR 701.15a-b, 603.2: the goaded creature attacks another player and deals 1 damage to its own controller', () => {
    let s = mpScenario({
      cards: ['Vengeful Ancestor', 'Mountain', 'Grizzly Bears'],
      zones: { p1: { hand: ['Vengeful Ancestor'], battlefield: [...RED4, 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = aliceCasts(s, 'Vengeful Ancestor', [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }]);
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p1' }]);
    s = toAttacks(s, 'p2');
    s = act(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bears, defender: 'p4' }] } });
    s = resolveStack(s);
    expect(lifeOf(s, 'p2')).toBe(19); // the Bears dealt 1 damage to Bob, its controller
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('m12 design D16: goad in a two-player game plays as written', () => {
  it('CR 701.15b, 508.1d: with only the goader to attack, "a player other than the goader" can\'t be obeyed; the goaded creature still attacks (the goader)', () => {
    let s = scenario(['Disrupt Decorum', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Disrupt Decorum'], battlefield: RED4 }, p2: { battlefield: ['Grizzly Bears'] } });
    s = resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Disrupt Decorum', 'hand', 'p1') })));
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p1' }]);
    s = toAttacks(s, 'p2');
    expect(s.pending).toMatchObject({ mustObey: 1 });
    expect(declare(s, []).error?.rules).toContain('CR 508.1d');
    expect(declare(s, [{ attacker: bears, defender: 'p1' }]).error).toBeUndefined();
  });
});
