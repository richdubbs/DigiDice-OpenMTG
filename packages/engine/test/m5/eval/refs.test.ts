/**
 * WP4, effects/refs.ts: references, handles and last known information (design 3.1; CR 400.7, 608.2b, 608.2h, 400.7j).
 */
import { describe, expect, it } from 'vitest';
import { EngineBug, NeedDecision } from '../../../src/core/errors';
import { currentObjs, isCurrent, readInfo, rebase, REF_RESOLVERS, resolveObjs, resolvePlayers, resolveRecipients } from '../../../src/effects/refs';
import type { EffectProgram, TargetSpec } from '../../../src/index';
import { synth, spellAbility } from '../helpers';
import { bind, chosenObject, chosenPlayer, ctxOn, find, handle, moveTo, putOnStack, scenario } from './helpers';

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [creature])] });
const prog: EffectProgram = { targets: [creature], steps: [] };

function board() {
  const s = scenario(['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Bonesplitter', 'Hill Giant', 'Pacifism'], {
    p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Bonesplitter'], library: ['Hill Giant', 'Grizzly Bears', 'Serra Angel'] },
    p2: { battlefield: ['Hill Giant'], library: ['Llanowar Elves', 'Serra Angel'] },
    defs: [poke],
  });
  const bears = find(s, 'Grizzly Bears', 'battlefield');
  const angel = find(s, 'Serra Angel', 'battlefield');
  const elves = find(s, 'Llanowar Elves', 'battlefield');
  const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
  const spell = putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(giant)]] });
  return { s, bears, angel, elves, giant, spell, cx: ctxOn(s, spell, prog) };
}

describe('capability table (design 5.2)', () => {
  it('every reference name of ObjRef and PlayerRef has a resolver', () => {
    expect(Object.keys(REF_RESOLVERS).sort()).toEqual([
      'active', 'anOpponent', 'attachedTo', 'bound', 'controllerOf', 'controlsMost' /* C6 */, 'costBeheld' /* std-rx28 */, 'costChosen' /* FAST5X E1 */, 'costChosenObject' /* std-costs-2 */, 'costDiscarded' /* CLOUD C8 */, 'costExiled' /* FAST5X E13 */, 'costReturned' /* std-rx28 */, 'costRevealed' /* p2-refs-1 */, 'costSacrificed' /* FAST3 T18 */, 'costTapped' /* T35 */, 'defending', 'each', 'eachWho' /* std-combat-1 */, 'enchantedPlayer' /* std-rr */, 'event', 'fixed', 'grantor' /* r4-static */, 'iterating', 'linked', 'otherOf' /* std-rx30 */, 'otherOpponents' /* M6-12 */, 'ownerOf', 'seat' /* M12-1 */, 'self', 'subject', 'target', 'topCards', 'union', 'voters' /* M12F */, 'you',
    ]);
  });
});

describe('resolveObjs: self, target, bound, event', () => {
  it('self is the source; once the source has left it is a stale handle (reads use last known information, CR 608.2h)', () => {
    const { cx, spell } = board();
    expect(resolveObjs(cx, { ref: 'self' })).toEqual([{ id: spell, zone: 'stack' }]);
    moveTo(cx, spell, 'graveyard');
    expect(resolveObjs(cx, { ref: 'self' })).toEqual([{ id: spell, zone: 'stack' }]);
    expect(isCurrent(cx, cx.source)).toBe(false);
    expect(readInfo(cx, cx.source)?.object.id).toBe(spell);
  });

  it('target: only legal targets (CR 608.2b); an unknown spec id is empty', () => {
    const { cx, giant } = board();
    expect(resolveObjs(cx, { ref: 'target', id: 't0' })).toEqual([{ id: giant, zone: 'battlefield' }]);
    expect(resolveObjs(cx, { ref: 'target', id: 'nope' })).toEqual([]);
    cx.targets.get('t0')![0]!.legal = false;
    expect(resolveObjs(cx, { ref: 'target', id: 't0' })).toEqual([]);
  });

  it('bound: the objects a step named; an EMPTY binding is legal and gives nothing (CR 609.3); a name never bound is a program error', () => {
    const { cx, s, bears } = board();
    bind(cx, 'it', [handle(s, bears)]);
    bind(cx, 'nothing', []);
    expect(resolveObjs(cx, { ref: 'bound', name: 'it' })).toEqual([{ id: bears, zone: 'battlefield' }]);
    expect(resolveObjs(cx, { ref: 'bound', name: 'nothing' })).toEqual([]);
    expect(() => resolveObjs(cx, { ref: 'bound', name: 'never' })).toThrow(EngineBug);
    expect(() => resolveObjs(cx, { ref: 'bound', name: 'never' })).toThrow('never bound');
  });

  it('event: the objects a role of the trigger event exposes; a role of players, or a missing role, gives no objects', () => {
    const { s, bears, angel } = board();
    const event = { ev: 'attacks' as const, roles: { attacker: { objects: [{ id: bears, zone: 'battlefield' as const }] }, player: { players: ['p1'] } }, before: {} };
    const trig = putOnStack(s, { name: 'Grizzly Bears', kind: 'triggered', event });
    const cx = ctxOn(s, trig);
    expect(resolveObjs(cx, { ref: 'event', role: 'attacker' })).toEqual([{ id: bears, zone: 'battlefield' }]);
    expect(resolveObjs(cx, { ref: 'event', role: 'player' })).toEqual([]);
    expect(resolveObjs(cx, { ref: 'event', role: 'blocker' })).toEqual([]);
    expect(resolvePlayers(cx, { ref: 'event', role: 'player' })).toEqual(['p1']);
    expect(resolvePlayers(cx, { ref: 'event', role: 'attacker' })).toEqual([]);
    expect(angel).toBeTruthy();
  });
});

describe('resolveObjs: attachedTo, linked, each, subject, topCards, union, fixed', () => {
  it('attachedTo: what the source is attached to; a player ("Enchant player") is not an object; last known information once the source left', () => {
    const { s, bears } = board();
    const equip = find(s, 'Bonesplitter', 'battlefield');
    s.objects[equip]!.attachedTo = bears;
    const cx = ctxOn(s, equip);
    expect(resolveObjs(cx, { ref: 'attachedTo' })).toEqual([{ id: bears, zone: 'battlefield' }]);
    moveTo(cx, equip, 'graveyard'); // it fell off, but last known information says what it was attached to
    expect(resolveObjs(cx, { ref: 'attachedTo' })).toEqual([{ id: bears, zone: 'battlefield' }]);
    s.objects[bears]!.attachedTo = 'p2';
    expect(resolveObjs(ctxOn(s, bears), { ref: 'attachedTo' })).toEqual([]);
    expect(resolveObjs(ctxOn(s, find(s, 'Serra Angel', 'battlefield')), { ref: 'attachedTo' })).toEqual([]);
  });

  it('linked: what the linked ability of THIS source remembers (CR 607.2a); nothing for another link or before it ran', () => {
    const { s, cx: cx0, bears: onBattlefield, angel } = board();
    const bears = moveTo(cx0, onBattlefield, 'exile')!; // the linked ability exiled it (CR 607.2a: the link names a card in exile)
    const src = find(s, 'Bonesplitter', 'battlefield');
    s.objects[src]!.links = { exiled: { objects: [{ id: bears, zone: 'exile' }], players: ['p2'] } };
    const cx = ctxOn(s, src);
    expect(resolveObjs(cx, { ref: 'linked', link: 'exiled' })).toEqual([{ id: bears, zone: 'exile' }]);
    expect(resolvePlayers(cx, { ref: 'linked', link: 'exiled' })).toEqual(['p2']);
    expect(resolveObjs(cx, { ref: 'linked', link: 'other' })).toEqual([]);
    expect(resolveObjs(ctxOn(s, angel), { ref: 'linked', link: 'exiled' })).toEqual([]);
    moveTo(cx, src, 'graveyard'); // a leaves-the-battlefield ability reads the link store from last known information (design 3.9)
    expect(resolveObjs(cx, { ref: 'linked', link: 'exiled' })).toEqual([{ id: bears, zone: 'exile' }]);
    // FAST5X E25 (CR 607.2a, 400.7): a card that left exile is a new object; the link no longer refers to it, not even through last known information
    moveTo(cx, bears, 'hand');
    expect(resolveObjs(cx, { ref: 'linked', link: 'exiled' })).toEqual([]);
    expect(resolvePlayers(cx, { ref: 'ownerOf', object: { ref: 'linked', link: 'exiled' } })).toEqual([]);
  });

  it('each: every object a filter selects NOW, in zone order, "you" being the controller; default zone battlefield; the source can be excluded', () => {
    const { cx, bears, angel, elves, giant } = board();
    const ids = (f: Parameters<typeof resolveObjs>[1]) => resolveObjs(cx, f).map((h) => h.id);
    expect(ids({ ref: 'each', filter: { types: ['Creature'], controller: 'you' } })).toEqual([bears, angel, elves]);
    expect(ids({ ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } })).toEqual([giant]);
    expect(ids({ ref: 'each', filter: { types: ['Creature'] } })).toEqual([bears, angel, elves, giant]);
    expect(ids({ ref: 'each', filter: { zone: 'library', controller: 'you' } })).toEqual(cx.g.s.zones.library['p1']); // an explicit zone is honored, in library order
    expect(ids({ ref: 'each', filter: { types: ['Creature'], colors: ['W'] } })).toEqual([angel]);
    const own = ctxOn(cx.g.s, bears);
    expect(resolveObjs(own, { ref: 'each', filter: { types: ['Creature'], controller: 'you', other: true } }).map((h) => h.id)).toEqual([angel, elves]);
    // a filter that mentions a quantity or a reference resolves it through the context
    cx.vars.set('n', 3);
    expect(ids({ ref: 'each', filter: { types: ['Creature'], power: { op: '>=', value: { q: 'var', name: 'n' } } } })).toEqual([angel, giant]); // power 4 and 3
  });

  it('subject: the object being modified inside a continuous effect; none outside one', () => {
    const { cx, s, bears } = board();
    expect(resolveObjs(cx, { ref: 'subject' })).toEqual([]);
    cx.subject = handle(s, bears);
    expect(resolveObjs(cx, { ref: 'subject' })).toEqual([{ id: bears, zone: 'battlefield' }]);
  });

  it('topCards: the top N of a library, top first (CR 401.5); N may be a quantity; one that fails to determine gives nothing', () => {
    const { cx, s } = board();
    const lib = s.zones.library['p1']!;
    const top = (count: Parameters<typeof resolveObjs>[1] extends infer R ? R : never) => resolveObjs(cx, count as never).map((h) => h.id);
    expect(top({ ref: 'topCards', player: { ref: 'you' }, count: 2 })).toEqual(lib.slice(0, 2));
    expect(resolveObjs(cx, { ref: 'topCards', player: { ref: 'you' }, count: 2 }).every((h) => h.zone === 'library')).toBe(true);
    expect(top({ ref: 'topCards', player: { ref: 'you' }, count: 99 })).toEqual(lib);
    expect(top({ ref: 'topCards', player: { ref: 'you' }, count: 0 })).toEqual([]);
    expect(top({ ref: 'topCards', player: { ref: 'you' }, count: { q: 'math', op: '+', args: [1, 1] } })).toEqual(lib.slice(0, 2));
    expect(top({ ref: 'topCards', player: { ref: 'anOpponent' }, count: 1 })).toEqual(s.zones.library['p2']!.slice(0, 1));
    expect(top({ ref: 'topCards', player: { ref: 'you' }, count: { q: 'stat', stat: 'power', of: { ref: 'target', id: 'gone' } } })).toEqual([]);
  });

  it('union: the objects of every part, once each', () => {
    const { cx, s, bears, angel } = board();
    bind(cx, 'a', [handle(s, bears), handle(s, angel)]);
    bind(cx, 'b', [handle(s, angel)]);
    const u = resolveObjs(cx, { ref: 'union', of: [{ ref: 'bound', name: 'a' }, { ref: 'bound', name: 'b' }, { ref: 'self' }] });
    expect(u.map((h) => h.id)).toEqual([bears, angel, cx.source.id]);
  });

  it('fixed (CR 611.2c): the objects fixed when the effect was created, skipping any that is a new object now (CR 400.7)', () => {
    const { cx, bears, angel } = board();
    const fixed = { ref: 'fixed' as const, objects: [{ id: bears, zone: 'battlefield' as const }, { id: angel, zone: 'battlefield' as const }] };
    moveTo(cx, bears, 'graveyard');
    expect(resolveObjs(cx, fixed).map((h) => h.id)).toEqual([angel]);
  });
  it('fixed, r3-fx (CR 603.7c, 608.2b, 608.2h): checked once per resolution; one an instruction of the same resolution moved stays a stale handle (read as it last existed, acted on by nothing)', () => {
    const { cx, bears, angel } = board();
    const fixed = { ref: 'fixed' as const, objects: [{ id: bears, zone: 'battlefield' as const }, { id: angel, zone: 'battlefield' as const }] };
    expect(resolveObjs(cx, fixed).map((h) => h.id)).toEqual([bears, angel]);
    moveTo(cx, bears, 'graveyard');
    const hs = resolveObjs(cx, fixed);
    expect(hs.map((h) => h.id)).toEqual([bears, angel]);
    expect(currentObjs(cx, hs).map((h) => h.id)).toEqual([angel]);
    expect(readInfo(cx, hs[0]!)?.object.defId).toBe('Grizzly Bears');
    const { cx: next } = board(); // another resolution (a new context) checks again
    moveTo(next, find(next.g.s, 'Grizzly Bears', 'battlefield'), 'graveyard');
    expect(resolveObjs(next, { ref: 'fixed', objects: [{ id: find(next.g.s, 'Serra Angel', 'battlefield'), zone: 'battlefield' }] })).toHaveLength(1);
  });
});

describe('resolvePlayers', () => {
  it('you, active, target players (legal ones only)', () => {
    const { s } = board();
    const spec: TargetSpec = { id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' };
    const cast = putOnStack(s, { name: 'Test Poke', owner: 'p2', targets: [[chosenPlayer('p1')]] });
    const cx = ctxOn(s, cast, { targets: [spec], steps: [] });
    expect(resolvePlayers(cx, { ref: 'you' })).toEqual(['p2']);
    expect(resolvePlayers(cx, { ref: 'active' })).toEqual([s.turn.activePlayer]);
    expect(resolvePlayers(cx, { ref: 'target', id: 't0' })).toEqual(['p1']);
    cx.targets.get('t0')![0]!.legal = false;
    expect(resolvePlayers(cx, { ref: 'target', id: 't0' })).toEqual([]);
  });

  it('controllerOf / ownerOf use last known information once the object left (Swords to Plowshares: "its controller gains life", CR 608.2h)', () => {
    const { cx, s, giant } = board();
    s.objects[giant]!.controller = 'p2';
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'target', id: 't0' } })).toEqual(['p2']);
    moveTo(cx, giant, 'exile'); // the target is a stale handle now
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'target', id: 't0' } })).toEqual(['p2']);
    expect(resolvePlayers(cx, { ref: 'ownerOf', object: { ref: 'target', id: 't0' } })).toEqual(['p2']);
    bind(cx, 'x', []);
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'bound', name: 'x' } })).toEqual([]); // nothing bound: nobody
  });

  it('controllerOf: a stolen creature has a different controller and owner', () => {
    const { cx, s, bears } = board();
    s.objects[bears]!.controller = 'p2';
    bind(cx, 'it', [handle(s, bears)]);
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'bound', name: 'it' } })).toEqual(['p2']);
    expect(resolvePlayers(cx, { ref: 'ownerOf', object: { ref: 'bound', name: 'it' } })).toEqual(['p1']);
  });

  it('each player / opponent / otherPlayer in APNAP order, active player first (CR 101.4, 608.2e); a player who lost is not part of it', () => {
    const { s } = board();
    s.turn.activePlayer = 'p2';
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(resolvePlayers(cx, { ref: 'each', who: 'player' })).toEqual(['p2', 'p1']);
    expect(resolvePlayers(cx, { ref: 'each', who: 'opponent' })).toEqual(['p2']);
    expect(resolvePlayers(cx, { ref: 'each', who: 'otherPlayer' })).toEqual(['p2']);
    s.players[1]!.hasLost = true;
    expect(resolvePlayers(cx, { ref: 'each', who: 'player' })).toEqual(['p1']);
    expect(resolvePlayers(cx, { ref: 'each', who: 'opponent' })).toEqual([]);
  });

  it('anOpponent: the only opponent in a two-player game; with several the controller chooses once (CR 601.7a)', () => {
    const { cx, s } = board();
    expect(resolvePlayers(cx, { ref: 'anOpponent' })).toEqual(['p2']);
    const three = board();
    three.s.players.push({ ...structuredClone(three.s.players[1]!), id: 'p3', name: 'Carol' });
    three.s.zones.library['p3'] = [];
    const c3 = ctxOn(three.s, find(three.s, 'Grizzly Bears', 'battlefield'));
    try {
      resolvePlayers(c3, { ref: 'anOpponent' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NeedDecision);
      expect((e as NeedDecision).decision).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    }
    expect(s).toBeTruthy();
  });

  it('bound players, defending (CR 506.2) and iterating', () => {
    const { s, bears } = board();
    s.combat = { number: 1, attacked: true, damageSteps: 0, extraDamageStep: false, firstStrikers: [], attackers: [{ id: bears, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }], blockers: [] };
    const cx = ctxOn(s, bears);
    bind(cx, 'who', [], ['p2']);
    expect(resolvePlayers(cx, { ref: 'bound', name: 'who' })).toEqual(['p2']);
    expect(resolvePlayers(cx, { ref: 'defending' })).toEqual(['p2']); // the source attacks p2
    expect(resolvePlayers(ctxOn(s, find(s, 'Serra Angel', 'battlefield')), { ref: 'defending' })).toEqual(['p2']); // two players: the opponent of the active player
    s.combat = null;
    expect(resolvePlayers(ctxOn(s, find(s, 'Serra Angel', 'battlefield')), { ref: 'defending' })).toEqual([]);
    expect(resolvePlayers(cx, { ref: 'iterating' })).toEqual([]);
    cx.iterating = 'p1';
    expect(resolvePlayers(cx, { ref: 'iterating' })).toEqual(['p1']);
    cx.iterating = { id: bears, zone: 'battlefield' };
    expect(resolvePlayers(cx, { ref: 'iterating' })).toEqual([]);
  });

  it('fixed players (milestone 4 player restrictions migrate to this)', () => {
    const { cx } = board();
    expect(resolvePlayers(cx, { ref: 'fixed', players: ['p2'] })).toEqual(['p2']);
  });
});

describe('resolveRecipients: the shared names stand for both objects and players', () => {
  it('target, bound, event and linked give both; each follows its field; object refs give objects, player refs players', () => {
    const { s, bears, angel, giant } = board();
    const spec: TargetSpec = { id: 'tp', kind: 'player', min: 1, max: 1, text: 'target player' };
    const cast = putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(giant)], [chosenPlayer('p2')]] });
    const cx = ctxOn(s, cast, { targets: [creature, spec], steps: [] });
    expect(resolveRecipients(cx, { ref: 'target', id: 't0' })).toEqual({ objects: [{ id: giant, zone: 'battlefield' }], players: [] });
    expect(resolveRecipients(cx, { ref: 'target', id: 'tp' })).toEqual({ objects: [], players: ['p2'] });
    bind(cx, 'both', [handle(s, bears)], ['p1']);
    expect(resolveRecipients(cx, { ref: 'bound', name: 'both' })).toEqual({ objects: [{ id: bears, zone: 'battlefield' }], players: ['p1'] });
    expect(resolveRecipients(cx, { ref: 'you' })).toEqual({ objects: [], players: ['p1'] });
    expect(resolveRecipients(cx, { ref: 'each', who: 'opponent' })).toEqual({ objects: [], players: ['p2'] });
    expect(resolveRecipients(cx, { ref: 'each', filter: { colors: ['W'], types: ['Creature'] } })).toEqual({ objects: [{ id: angel, zone: 'battlefield' }], players: [] });
    expect(resolveRecipients(cx, { ref: 'self' })).toEqual({ objects: [cx.source], players: [] });
    expect(resolveRecipients(cx, { ref: 'fixed', players: ['p1'] })).toEqual({ objects: [], players: ['p1'] });
    expect(resolveRecipients(cx, { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] })).toEqual({ objects: [{ id: bears, zone: 'battlefield' }], players: [] });
  });
});

describe('handles (design 3.1 rules 1, 3, 5): acting needs the object where it was; reading uses last known information', () => {
  it('isCurrent / currentObjs: the object is still in the zone of the handle; a moved object is a new object (CR 400.7)', () => {
    const { cx, s, bears, angel } = board();
    const hs = [handle(s, bears), handle(s, angel)];
    expect(currentObjs(cx, hs)).toEqual(hs);
    const newId = moveTo(cx, bears, 'hand')!;
    expect(currentObjs(cx, hs)).toEqual([hs[1]]);
    expect(isCurrent(cx, { id: newId, zone: 'hand' })).toBe(true);
    expect(isCurrent(cx, { id: bears, zone: 'hand' })).toBe(false);
  });

  it('readInfo: the object itself while current (its characteristics now)', () => {
    const { cx, s, bears } = board();
    s.objects[bears]!.damage = 1;
    const info = readInfo(cx, handle(s, bears))!;
    expect(info.object).toBe(s.objects[bears]);
    expect(info.chars?.name).toBe('Grizzly Bears');
  });

  it('readInfo: after it left, last known information as it last existed (Swords to Plowshares: its power / controller are the battlefield values)', () => {
    const { cx, s, giant } = board();
    s.objects[giant]!.counters = { '+1/+1': 1 };
    const stale = handle(s, giant);
    moveTo(cx, giant, 'exile');
    const info = readInfo(cx, stale)!;
    expect(info.leftZone).toBe('battlefield');
    expect(info.object.zone).toBe('battlefield');
    expect(info.object.controller).toBe('p2');
    expect(info.chars?.power).toBe('4'); // 3/3 with a +1/+1 counter, as it was on the battlefield
  });

  it('readInfo: a snapshot taken when a name was bound is the last resort; nothing known gives undefined (the part of the effect fails to determine, CR 608.2b)', () => {
    const { cx, s, bears } = board();
    const h = handle(s, bears);
    const snapshot = { object: structuredClone(s.objects[bears]!), chars: null, leftZone: 'battlefield' as const };
    cx.bindings.set('it', { objects: [h], players: [], snapshots: { [bears]: snapshot } });
    delete s.objects[bears]; // gone without last known information (should not happen, but the snapshot still answers)
    expect(readInfo(cx, h)).toBe(snapshot);
    expect(readInfo(cx, { id: 'o9999', zone: 'battlefield' })).toBeUndefined();
  });
});

describe('rebase (CR 400.7j; design 3.1 rule 2 and D7): bindings follow an object to a PUBLIC zone only', () => {
  it('exile (public): the binding now points to the new object; the old object stays in the snapshots', () => {
    const { cx, s, bears, angel } = board();
    bind(cx, 'them', [handle(s, bears), handle(s, angel)]);
    const exiled = moveTo(cx, bears, 'exile')!;
    rebase(cx, bears, { id: exiled, zone: 'exile' });
    expect(cx.bindings.get('them')!.objects).toEqual([{ id: exiled, zone: 'exile' }, { id: angel, zone: 'battlefield' }]);
    expect(cx.bindings.get('them')!.snapshots[bears]).toBeDefined();
    expect(currentObjs(cx, resolveObjs(cx, { ref: 'bound', name: 'them' })).map((h) => h.id)).toEqual([exiled, angel]);
  });

  it('every public zone re-bases: battlefield, graveyard, stack, exile, command', () => {
    for (const zone of ['battlefield', 'graveyard', 'stack', 'exile', 'command'] as const) {
      const { cx, s, bears } = board();
      bind(cx, 'it', [handle(s, bears)]);
      rebase(cx, bears, { id: 'new', zone });
      expect(cx.bindings.get('it')!.objects, zone).toEqual([{ id: 'new', zone }]);
    }
  });

  it('hand and library (hidden): NOTHING is re-based; those are new hidden objects the rest of the effect cannot find', () => {
    for (const zone of ['hand', 'library'] as const) {
      const { cx, s, bears } = board();
      bind(cx, 'it', [handle(s, bears)]);
      const moved = moveTo(cx, bears, zone)!;
      rebase(cx, bears, { id: moved, zone });
      expect(cx.bindings.get('it')!.objects, zone).toEqual([{ id: bears, zone: 'battlefield' }]);
      expect(currentObjs(cx, resolveObjs(cx, { ref: 'bound', name: 'it' })), zone).toEqual([]); // acting on it does nothing
      expect(readInfo(cx, { id: bears, zone: 'battlefield' })?.object.zone).toBe('battlefield'); // reading it uses last known information
    }
  });

  it('a token that ceased to exist (to = null) drops out of every binding', () => {
    const { cx, s, bears, angel } = board();
    bind(cx, 'a', [handle(s, bears), handle(s, angel)]);
    bind(cx, 'b', [handle(s, bears)]);
    rebase(cx, bears, null);
    expect(cx.bindings.get('a')!.objects).toEqual([{ id: angel, zone: 'battlefield' }]);
    expect(cx.bindings.get('b')!.objects).toEqual([]);
  });

  it('target handles never re-base (design 3.1 rule 4): reads go through the snapshot, acting does nothing', () => {
    const { cx, giant } = board();
    const exiled = moveTo(cx, giant, 'exile')!;
    rebase(cx, giant, { id: exiled, zone: 'exile' });
    const t = resolveObjs(cx, { ref: 'target', id: 't0' });
    expect(t).toEqual([{ id: giant, zone: 'battlefield' }]);
    expect(currentObjs(cx, t)).toEqual([]);
    expect(readInfo(cx, t[0]!)?.leftZone).toBe('battlefield');
  });

  it('an object that is in no binding changes nothing; a name bound twice to the new object appears once', () => {
    const { cx, s, bears, angel } = board();
    bind(cx, 'a', [handle(s, angel)]);
    rebase(cx, bears, { id: 'x', zone: 'exile' });
    expect(cx.bindings.get('a')!.objects).toEqual([{ id: angel, zone: 'battlefield' }]);
    bind(cx, 'b', [handle(s, bears), { id: 'x', zone: 'exile' }]);
    rebase(cx, bears, { id: 'x', zone: 'exile' });
    expect(cx.bindings.get('b')!.objects).toEqual([{ id: 'x', zone: 'exile' }]);
  });
});
