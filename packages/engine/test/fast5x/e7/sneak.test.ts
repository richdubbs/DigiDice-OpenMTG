/**
 * FAST5X E7: sneak (CR 702.190) and web-slinging (CR 702.188) on the game path, with real fixture cards. Both are alternative costs (CR 118.9, 601.2b,
 * 601.2f-h) with a part that returns a creature to its owner's hand:
 *   - "Sneak [cost]" means "Any time you could cast an instant during your declare blockers step, you may cast this spell by paying [cost] and returning an
 *     unblocked creature you control to its owner's hand rather than paying this spell's mana cost" (CR 702.190a); a permanent spell whose sneak cost was paid
 *     enters tapped and attacking the same player, planeswalker or battle as the returned creature (CR 702.190b, 508.4, 508.4a, 508.4d).
 *   - "Web-slinging [cost]" means "You may cast this spell by paying [cost] and returning a tapped creature you control to its owner's hand rather than paying
 *     its mana cost" (CR 702.188a); the spell's own timing still applies.
 *   - "if ~'s sneak cost was paid" / "if they were cast using web-slinging" read the cast record (CR 607.2i-j, 400.7d, 603.4).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, answer, drive, find, lands, pass, resolveTop, scenario, target } from '../../m6/dfc/support';
import { declareAttackers, declareBlockers, lifeOf, logHas, passUntil, toDeclareAttackers } from '../../m4/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const handNames = (s: GameState, p: PlayerId = 'p1'): string[] => (s.zones.hand[p] ?? []).map((id) => nameOf(s, id));
const fieldId = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
const tappedLands = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped && /Plains|Swamp|Island|Forest|Mountain/.test(nameOf(s, id))).length;
/** The labels of p1's legal cast actions for `name`. */
const castLabels = (s: GameState, name: string, p: PlayerId = 'p1'): string[] =>
  legalActions(s, p).filter((a) => a.kind === 'cast' && s.objects[a.object!] && nameOf(s, a.object!) === name).map((a) => a.label);
/** Cast `name` from p1's hand with `method`, paying automatically and choosing `pick` for a cost choice when one is asked. */
function castWith(s: GameState, name: string, method: string, pick?: ObjectId): GameState {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), method });
  for (let i = 0; i < 10 && t.pending && t.pending.kind !== 'priority'; i++) {
    if (t.pending.kind === 'chooseObjects' && pick !== undefined) t = answer(t, { kind: 'chooseObjects', ids: [pick] });
    else t = drive(t);
    if (t.pending?.kind === 'chooseObjects' && pick === undefined) break;
  }
  return t;
}

/** p1 attacks with the named creatures (at p2, or at the given defender); p2 blocks as listed; returns the state with p1's priority in the declare blockers step. */
function toBlockersStep(s: GameState, attackers: [string, ObjectId?][], blocks: [string, string][] = []): GameState {
  let t = toDeclareAttackers(s);
  t = declareAttackers(t, attackers.map(([n, d]) => [fieldId(t, n), d] as [ObjectId, ObjectId?]));
  t = passUntil(t, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'declareBlockers', 'the declare blockers step', 10);
  if (t.pending?.kind === 'declareBlockers') {
    const atk = (n: string): ObjectId => t.combat!.attackers.find((a) => nameOf(t, a.id) === n)!.id;
    const blk = (n: string): ObjectId => t.zones.battlefield.find((id) => nameOf(t, id) === n && t.objects[id]!.controller === 'p2')!;
    t = declareBlockers(t, blocks.map(([b, a]) => [blk(b), atk(a)]));
  }
  expect(t.turn.step).toBe('declareBlockers');
  expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  return t;
}

/** Jace Beleren with its printed loyalty (CR 306.5b: a planeswalker with no loyalty would be put into its owner's graveyard, CR 704.5i). */
const JACE = { name: 'Jace Beleren', counters: { loyalty: 3 } };

function board(opts: { hand: string[]; p1?: (string | { name: string; tapped?: boolean })[]; p2?: (string | { name: string; counters?: Record<string, number> })[]; p2hand?: string[] }): GameState {
  const p1 = opts.p1 ?? [];
  const p1names = p1.map((x) => (typeof x === 'string' ? x : x.name));
  return scenario([...opts.hand, ...p1names, ...(opts.p2 ?? []).map((x) => (typeof x === 'string' ? x : x.name)), ...(opts.p2hand ?? []), 'Plains', 'Swamp', 'Island', 'Forest', 'Mountain'], {
    p1: { hand: opts.hand, battlefield: p1 },
    p2: { hand: opts.p2hand ?? [], battlefield: opts.p2 ?? [] },
  });
}

describe('FAST5X E7: sneak and web-slinging are capabilities; the cards compile full', () => {
  it('keyword:sneak, keyword:web-slinging and their parts are registered (CR 702.190a-b, 702.188a)', () => {
    for (const c of ['keyword:sneak', 'keyword:web-slinging', 'feature:alternativeCost.instantSpeed', 'feature:alternativeCost.entersAttacking']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    for (const name of ['Foot Ninjas', 'Splinter, Hamato Yoshi', 'Leonardo, Leader in Blue', "Donatello's Technique", "Jennika's Technique", "The Last Ronin's Technique",
      'Spider-Man, Web-Slinger', 'Spiders-Man, Heroic Horde', 'Spider-UK']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});

describe('CR 702.190a: when sneak may be used', () => {
  const base = (): GameState => board({ hand: ['Foot Ninjas', "Donatello's Technique"], p1: ['Grizzly Bears', ...lands('Plains', 4), ...lands('Island', 2)], p2: ['Hill Giant'] });

  it('not in the main phase: a creature with sneak is cast for its mana cost only, and the sneak method is refused (CR 118.9, 702.190a)', () => {
    const s = base();
    expect(castLabels(s, 'Foot Ninjas').some((l) => /sneak/.test(l))).toBe(false);
    expect(castLabels(s, "Donatello's Technique")).toEqual(["Cast Donatello's Technique"]);
    const r = applyAction(s, { type: 'cast', player: 'p1', card: find(s, "Donatello's Technique", 'hand', 'p1'), method: 'sneak' });
    expect(r.error?.rules).toContain('CR 118.9');
  });

  it('during your declare blockers step with an unblocked attacker: a creature and a sorcery may be cast for their sneak cost at instant speed (CR 702.190a, 117.1a)', () => {
    const s = toBlockersStep(base(), [['Grizzly Bears']]);
    expect(castLabels(s, 'Foot Ninjas')).toEqual(['Cast Foot Ninjas (sneak)']); // not for its mana cost: a creature is cast at sorcery speed (CR 307.1)
    expect(castLabels(s, "Donatello's Technique")).toEqual(["Cast Donatello's Technique (sneak)"]);
  });

  it('a blocked attacker is not an unblocked creature: no sneak (CR 509.1h, 702.190a)', () => {
    const s = toBlockersStep(base(), [['Grizzly Bears']], [['Hill Giant', 'Grizzly Bears']]);
    expect(castLabels(s, 'Foot Ninjas')).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Foot Ninjas', 'hand', 'p1'), method: 'sneak' }).error).toBeDefined();
  });

  it('not in another step of combat (the combat damage step) (CR 702.190a)', () => {
    let s = toBlockersStep(base(), [['Grizzly Bears']]);
    s = passUntil(pass(s), (x) => x.turn.step === 'combatDamage' && x.pending?.kind === 'priority', 'combat damage', 10);
    expect(castLabels(s, 'Foot Ninjas')).toEqual([]);
  });
});

describe('CR 702.190a-b: casting for the sneak cost; the permanent enters tapped and attacking', () => {
  it('pays the sneak cost and returns the unblocked attacker; the creature enters tapped, attacking the same player, unblocked (CR 601.2h, 508.4, 508.4d)', () => {
    let s = toBlockersStep(board({ hand: ['Foot Ninjas'], p1: ['Grizzly Bears', ...lands('Plains', 4)] }), [['Grizzly Bears']]);
    const bears = fieldId(s, 'Grizzly Bears');
    s = castWith(s, 'Foot Ninjas', 'sneak');
    expect(tappedLands(s)).toBe(4); // {3}{W/B}, not {4}{W/B}{W/B}
    expect(handNames(s)).toEqual(['Grizzly Bears']); // returned to its owner's hand as part of the cost
    expect(s.combat!.attackers).toEqual([]); // CR 506.4: it left combat
    const spell = s.zones.stack[0]!;
    expect(s.objects[spell]!.stack!.costsPaid.alternative).toBe('sneak');
    expect(s.objects[spell]!.stack!.costsPaid.returned).toEqual([bears]);
    expect(s.objects[spell]!.stack!.entersAttacking).toEqual({ defender: 'p2', defendingPlayer: 'p2' });
    s = resolveTop(s);
    const ninjas = fieldId(s, 'Foot Ninjas');
    expect(s.objects[ninjas]!.tapped).toBe(true);
    expect(s.objects[ninjas]!.cast?.via).toBe('sneak');
    expect(s.combat!.attackers).toEqual([{ id: ninjas, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }]);
    expect(logHas(s, /Foot Ninjas enters tapped and attacking Bob/, 'CR 702.190b')).toBe(true);
    // its enters trigger ("you gain 3 life") still triggers: it entered the battlefield (CR 603.6a)
    s = resolveTop(s);
    expect(lifeOf(s, 'p1')).toBe(23);
    // it deals combat damage as an unblocked attacker (CR 510.1a)
    s = passUntil(s, (x) => x.turn.step === 'combatDamage' && x.pending?.kind === 'priority', 'combat damage', 10);
    expect(lifeOf(s, 'p2')).toBe(15);
  });

  it('attacking a planeswalker: the sneaked creature attacks that planeswalker (CR 702.190b, 508.5)', () => {
    let s = board({ hand: ['Splinter, Hamato Yoshi'], p1: ['Grizzly Bears', ...lands('Swamp', 1)], p2: [JACE] });
    const jace = fieldId(s, 'Jace Beleren');
    s = toBlockersStep(s, [['Grizzly Bears', jace]]);
    s = resolveTop(castWith(s, 'Splinter, Hamato Yoshi', 'sneak'));
    const splinter = fieldId(s, 'Splinter, Hamato Yoshi');
    expect(s.objects[splinter]!.tapped).toBe(true);
    expect(s.combat!.attackers).toEqual([{ id: splinter, defender: jace, defendingPlayer: 'p2', blockedBy: [], blocked: false }]);
  });

  it('CR 508.4a: when that planeswalker has left the battlefield, the creature enters tapped but is never attacking', () => {
    let s = board({ hand: ['Splinter, Hamato Yoshi', 'Lightning Bolt'], p1: ['Grizzly Bears', ...lands('Swamp', 1), ...lands('Mountain', 1)], p2: [JACE] });
    const jace = fieldId(s, 'Jace Beleren');
    s = toBlockersStep(s, [['Grizzly Bears', jace]]);
    s = castWith(s, 'Splinter, Hamato Yoshi', 'sneak');
    // in response, Lightning Bolt destroys Jace (3 loyalty, CR 704.5i)
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand', 'p1') }), [target(jace)]);
    s = resolveTop(s);
    expect(s.zones.battlefield).not.toContain(jace);
    s = resolveTop(s);
    const splinter = fieldId(s, 'Splinter, Hamato Yoshi');
    expect(s.objects[splinter]!.tapped).toBe(true);
    expect(s.combat!.attackers).toEqual([]);
  });

  it('a sneaked sorcery resolves as usual (Donatello\'s Technique: draw two cards) (CR 702.190a, 608.2)', () => {
    let s = toBlockersStep(board({ hand: ["Donatello's Technique"], p1: ['Grizzly Bears', ...lands('Island', 1)] }), [['Grizzly Bears']]);
    s = castWith(s, "Donatello's Technique", 'sneak');
    expect(tappedLands(s)).toBe(1);
    const before = s.zones.hand['p1']!.length;
    s = resolveTop(s);
    expect(s.zones.hand['p1']!.length).toBe(before + 2);
    expect(s.combat!.attackers).toEqual([]); // nothing enters attacking: the spell is not a permanent spell (CR 702.190b)
  });

  it('with two unblocked attackers, the caster chooses which one to return; the new creature attacks what that one attacked (CR 601.2h, 702.190b)', () => {
    let s = board({ hand: ['Splinter, Hamato Yoshi'], p1: ['Grizzly Bears', 'Hill Giant', ...lands('Swamp', 1)], p2: [JACE] });
    const jace = fieldId(s, 'Jace Beleren');
    s = toBlockersStep(s, [['Grizzly Bears', jace], ['Hill Giant']]);
    const giant = fieldId(s, 'Hill Giant');
    s = resolveTop(castWith(s, 'Splinter, Hamato Yoshi', 'sneak', giant));
    expect(handNames(s)).toEqual(['Hill Giant']);
    const splinter = fieldId(s, 'Splinter, Hamato Yoshi');
    expect(s.combat!.attackers.find((a) => a.id === splinter)).toMatchObject({ defender: 'p2', defendingPlayer: 'p2', blocked: false });
  });
});

describe('sneak conditions: "if his sneak cost was paid", "if ~\'s sneak cost was paid" (CR 607.2i, 603.4, 702.190b)', () => {
  it("Leonardo, Leader in Blue: sneaked, his enters trigger gives creatures you control +2/+0; cast normally it doesn't trigger", () => {
    let s = toBlockersStep(board({ hand: ['Leonardo, Leader in Blue'], p1: ['Grizzly Bears', 'Hill Giant', ...lands('Plains', 5)] }), [['Grizzly Bears'], ['Hill Giant']]);
    s = castWith(s, 'Leonardo, Leader in Blue', 'sneak', fieldId(s, 'Grizzly Bears'));
    s = resolveTop(s);
    expect(s.zones.stack).toHaveLength(1); // the enters trigger, its intervening "if" holds (CR 603.4)
    s = resolveTop(s);
    s = passUntil(s, (x) => x.turn.step === 'combatDamage' && x.pending?.kind === 'priority', 'combat damage', 10);
    expect(lifeOf(s, 'p2')).toBe(20 - (2 + 2) - (3 + 2)); // Leonardo 2/1 +2, Hill Giant 3/3 +2

    let n = board({ hand: ['Leonardo, Leader in Blue'], p1: lands('Plains', 1) });
    n = resolveTop(drive(act(n, { type: 'cast', player: 'p1', card: find(n, 'Leonardo, Leader in Blue', 'hand', 'p1') })));
    expect(n.zones.stack).toHaveLength(0);
    expect(n.objects[fieldId(n, 'Leonardo, Leader in Blue')]!.tapped).toBe(false);
  });

  it("The Last Ronin's Technique: sneaked, the three tokens enter tapped and attacking (CR 508.4, 508.4d); cast for its mana cost, they don't", () => {
    let s = toBlockersStep(board({ hand: ["The Last Ronin's Technique"], p1: ['Grizzly Bears', ...lands('Plains', 4)] }), [['Grizzly Bears']]);
    s = resolveTop(castWith(s, "The Last Ronin's Technique", 'sneak'));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(3);
    expect(tokens.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.combat!.attackers.map((a) => a.id).sort()).toEqual([...tokens].sort());
    expect(s.combat!.attackers.every((a) => !a.blocked && a.defendingPlayer === 'p2')).toBe(true);

    let n = board({ hand: ["The Last Ronin's Technique"], p1: lands('Plains', 4) });
    n = resolveTop(drive(act(n, { type: 'cast', player: 'p1', card: find(n, "The Last Ronin's Technique", 'hand', 'p1') })));
    const t2 = n.zones.battlefield.filter((id) => n.objects[id]!.kind === 'token');
    expect(t2).toHaveLength(3);
    expect(t2.some((id) => n.objects[id]!.tapped)).toBe(false);
  });
});

describe('CR 702.188a: web-slinging', () => {
  it('pays the web-slinging cost and returns a tapped creature you control; the spell keeps its own timing (CR 118.9, 601.2h, 307.1)', () => {
    let s = board({ hand: ['Spider-Man, Web-Slinger'], p1: [{ name: 'Grizzly Bears', tapped: true }, ...lands('Plains', 3)] });
    expect(castLabels(s, 'Spider-Man, Web-Slinger')).toEqual(['Cast Spider-Man, Web-Slinger', 'Cast Spider-Man, Web-Slinger (web-slinging)']);
    s = castWith(s, 'Spider-Man, Web-Slinger', 'web-slinging');
    expect(tappedLands(s)).toBe(1); // {W}
    expect(handNames(s)).toEqual(['Grizzly Bears']);
    s = resolveTop(s);
    const spidey = fieldId(s, 'Spider-Man, Web-Slinger');
    expect(s.objects[spidey]!.tapped).toBe(false); // nothing about entering tapped or attacking
    expect(s.objects[spidey]!.cast?.via).toBe('web-slinging');
  });

  it('an untapped creature is not a tapped creature: no web-slinging (CR 702.188a)', () => {
    const s = board({ hand: ['Spider-Man, Web-Slinger'], p1: ['Grizzly Bears', ...lands('Plains', 3)] });
    expect(castLabels(s, 'Spider-Man, Web-Slinger')).toEqual(['Cast Spider-Man, Web-Slinger']);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Spider-Man, Web-Slinger', 'hand', 'p1'), method: 'web-slinging' }).error).toBeDefined();
  });

  it('a creature with web-slinging is still cast at sorcery speed: not in combat (CR 307.1, 702.188a)', () => {
    const s = toBlockersStep(board({ hand: ['Spider-Man, Web-Slinger'], p1: ['Grizzly Bears', ...lands('Plains', 3)] }), [['Grizzly Bears']]);
    expect(castLabels(s, 'Spider-Man, Web-Slinger')).toEqual([]);
  });

  it('Spiders-Man, Heroic Horde: "if they were cast using web-slinging", the enters trigger gains 3 life and makes two Spiders; cast normally, nothing (CR 603.4)', () => {
    let s = board({ hand: ['Spiders-Man, Heroic Horde'], p1: [{ name: 'Grizzly Bears', tapped: true }, ...lands('Forest', 6)] });
    s = resolveTop(castWith(s, 'Spiders-Man, Heroic Horde', 'web-slinging'));
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => nameOf(s, id))).toEqual(['Spider Token', 'Spider Token']);

    let n = board({ hand: ['Spiders-Man, Heroic Horde'], p1: lands('Forest', 2) });
    n = resolveTop(drive(act(n, { type: 'cast', player: 'p1', card: find(n, 'Spiders-Man, Heroic Horde', 'hand', 'p1') })));
    expect(n.zones.stack).toHaveLength(0);
    expect(lifeOf(n, 'p1')).toBe(20);
  });
});
