/**
 * ui/arena: the board's animation choreography, tested without a browser.
 * - The screen shake scales with damage: 1 damage barely moves the table, 20 or more is a big jolt, and every shake is quick.
 * - The planner turns a change's events into what the board shows: combat swings, spell effects with their look, deaths, exiles, sacrifices, draws.
 */
import type { GameEvent, GameView } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { classifyMove, planBatch, planIsEmpty, spellStyle } from '../../src/board/fx/plan';
import { recoilFor, shakeFor, shakeKeyframes } from '../../src/board/fx/shake';

describe('screen shake (1 damage barely shakes, 20+ is a huge jolt, always quick)', () => {
  it('grows with the damage from a barely visible nudge at 1 to a big jolt at 20, and stays there above 20', () => {
    const amps = [1, 2, 3, 5, 8, 12, 16, 20].map((n) => shakeFor(n).amplitude);
    for (let i = 1; i < amps.length; i++) expect(amps[i]!).toBeGreaterThan(amps[i - 1]!);
    expect(shakeFor(1).amplitude).toBeLessThanOrEqual(2);
    expect(shakeFor(20).amplitude).toBeGreaterThanOrEqual(25);
    expect(shakeFor(35)).toEqual(shakeFor(20));
    expect(shakeFor(0).amplitude).toBe(0);
  });

  it('is quick at every size (well under half a second), and a bigger hit also turns and punches the view', () => {
    for (const n of [1, 5, 10, 20, 50]) expect(shakeFor(n).duration).toBeLessThan(450);
    expect(shakeFor(1).rotation).toBe(0);
    expect(shakeFor(20).rotation).toBeGreaterThan(1);
    expect(shakeFor(20).zoom).toBeGreaterThan(shakeFor(5).zoom);
    expect(recoilFor(20)).toBeGreaterThan(recoilFor(1));
  });

  it('starts and ends at rest, with its hardest kick first', () => {
    const k = shakeKeyframes(shakeFor(12), 3);
    expect(k[0]!.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
    expect(k[k.length - 1]!.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
    const size = (t: string) => Math.hypot(...(t.match(/-?[\d.]+px/g) ?? []).map((v) => parseFloat(v)));
    expect(size(k[1]!.transform as string)).toBeGreaterThan(size(k[k.length - 2]!.transform as string));
  });
});

// ---- the planner, on a small hand-made view ---------------------------------------------------------------------------------

function def(id: string, name: string, colors: string[], type = 'Creature') {
  return { id, name, layout: 'normal', faces: [{ name, colors, typeLine: type, manaCost: '', oracleText: '', abilities: [] }], automation: { level: 'full' } };
}

function viewOf(objects: Record<string, { defId: string; zone: string; controller?: string; kind?: string; stack?: object }>, stack: string[] = []): GameView {
  const defs = {
    bolt: def('bolt', 'Lightning Bolt', ['R'], 'Instant'),
    axe: def('axe', 'Lava Axe', ['R'], 'Sorcery'),
    pump: def('pump', 'Giant Growth', ['G'], 'Instant'),
    drain: def('drain', 'Sign in Blood', ['B'], 'Sorcery'),
    bears: def('bears', 'Grizzly Bears', ['G']),
    angel: def('angel', 'Serra Angel', ['W']),
    izzet: def('izzet', 'Izzet Charm', ['U', 'R'], 'Instant'),
    golem: def('golem', 'Stone Golem', [], 'Artifact Creature'),
  };
  const objs = Object.fromEntries(
    Object.entries(objects).map(([id, o]) => [id, { id, kind: o.kind ?? 'card', owner: o.controller ?? 'p1', controller: o.controller ?? 'p1', zone: o.zone, defId: o.defId, counters: {}, damage: 0, tapped: false, face: 0, ...(o.stack ? { stack: o.stack } : {}) }]),
  );
  return {
    viewer: 'p1', players: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }], objects: objs, defs, lki: {},
    zones: { stack, battlefield: Object.keys(objects).filter((k) => objects[k]!.zone === 'battlefield'), hand: {}, library: {}, graveyard: {}, exile: [], command: [] },
  } as unknown as GameView;
}

describe('animation planner (plan.ts)', () => {
  it('spell looks: lightning and fire by name, then by colour (blue arcane, black shadow, green nature, white radiant, blue-red storm, colourless force)', () => {
    const v = viewOf({ s1: { defId: 'bolt', zone: 'stack' }, s2: { defId: 'axe', zone: 'stack' }, s3: { defId: 'pump', zone: 'stack' }, s4: { defId: 'drain', zone: 'stack' }, s5: { defId: 'angel', zone: 'battlefield' }, s6: { defId: 'izzet', zone: 'stack' }, s7: { defId: 'golem', zone: 'battlefield' } });
    expect(spellStyle([v], 's1')).toBe('lightning');
    expect(spellStyle([v], 's2')).toBe('fire');
    expect(spellStyle([v], 's3')).toBe('nature');
    expect(spellStyle([v], 's4')).toBe('shadow');
    expect(spellStyle([v], 's5')).toBe('radiant');
    expect(spellStyle([v], 's6')).toBe('lightning');
    expect(spellStyle([v], 's7')).toBe('force');
    expect(spellStyle([v], 'missing')).toBe('force');
  });

  it('CR 510.2: combat damage is one step where every source swings at once; the life loss it caused is not shown twice', () => {
    const v = viewOf({ a: { defId: 'bears', zone: 'battlefield' }, b: { defId: 'angel', zone: 'battlefield', controller: 'p2' } });
    const events: GameEvent[] = [
      { type: 'damageDealt', source: 'a', target: 'p2', amount: 2, combat: true },
      { type: 'damageDealt', source: 'b', target: 'a', amount: 4, combat: true },
      { type: 'lifeChanged', player: 'p2', delta: -2, life: 18 },
    ];
    const p = planBatch(events, v, v);
    expect(p.a).toHaveLength(1);
    const step = p.a[0]!;
    expect(step.kind).toBe('combat');
    if (step.kind !== 'combat') return;
    expect(step.hits).toEqual([{ source: 'a', target: 'p2', amount: 2 }, { source: 'b', target: 'a', amount: 4 }]);
    expect(step.life).toEqual([{ player: 'p2', delta: -2, byDamage: true }]);
  });

  it('F9: the same change (events array, from, to) gets the same plan; other views or another events array are planned anew', () => {
    const v = viewOf({ a: { defId: 'bears', zone: 'battlefield' } });
    const w = viewOf({ a: { defId: 'bears', zone: 'battlefield' } });
    const events: GameEvent[] = [{ type: 'damageDealt', source: 'a', target: 'p2', amount: 2, combat: true }];
    const p = planBatch(events, v, v);
    expect(planBatch(events, v, v)).toBe(p);
    const q = planBatch(events, v, w);
    expect(q).not.toBe(p);
    expect(q).toEqual(p);
    expect(planBatch([...events], v, w)).not.toBe(q);
  });

  it('CR 120.3a: the engine reports the life lost to damage before the damage itself; it is still shown once, by the hit (no life-only step)', () => {
    const before = viewOf({ s: { defId: 'bolt', zone: 'stack', stack: { targets: [[{ kind: 'player', id: 'p2' }]] } } }, ['s']);
    const p = planBatch(
      [
        { type: 'lifeChanged', player: 'p2', delta: -3, life: 17, cause: 'damage from Lightning Bolt' },
        { type: 'damageDealt', source: 's', target: 'p2', amount: 3, combat: false },
        { type: 'resolved', objectId: 's' },
      ],
      before,
      viewOf({}),
    );
    expect(p.a.map((x) => x.kind)).toEqual(['resolve']);
    const r = p.a[0]!;
    if (r.kind !== 'resolve') return;
    expect(r.hits).toEqual([{ source: 's', target: 'p2', amount: 3 }]);
    expect(r.life).toEqual([{ player: 'p2', delta: -3, byDamage: true }]);
    // Combat in the engine's order: each player's loss comes just before its damage.
    const v = viewOf({ a: { defId: 'bears', zone: 'battlefield' } });
    const c = planBatch(
      [
        { type: 'lifeChanged', player: 'p2', delta: -2, life: 18 },
        { type: 'damageDealt', source: 'a', target: 'p2', amount: 2, combat: true },
      ],
      v,
      v,
    );
    expect(c.a.map((x) => x.kind)).toEqual(['combat']);
    const k = c.a[0]!;
    if (k.kind !== 'combat') return;
    expect(k.life).toEqual([{ player: 'p2', delta: -2, byDamage: true }]);
    // Life lost without damage (Sign in Blood, a drain) is its own effect.
    const d = planBatch([{ type: 'lifeChanged', player: 'p2', delta: -2, life: 18 }], v, v);
    expect(d.a).toEqual([{ kind: 'life', life: [{ player: 'p2', delta: -2, byDamage: false }] }]);
  });

  it('CR 608.2: a resolving spell carries its damage, with the spell\'s look; the creature it killed is destroyed afterwards', () => {
    const before = viewOf({ s: { defId: 'bolt', zone: 'stack' }, c: { defId: 'bears', zone: 'battlefield', controller: 'p2' } }, ['s']);
    const after = viewOf({});
    const events: GameEvent[] = [
      { type: 'resolved', objectId: 's' },
      { type: 'damageDealt', source: 's', target: 'c', amount: 3, combat: false },
      { type: 'zoneChanged', oldId: 's', newId: 'g1', from: 'stack', to: 'graveyard', owner: 'p1', controller: 'p1', name: 'Lightning Bolt' },
      { type: 'zoneChanged', oldId: 'c', newId: 'g2', from: 'battlefield', to: 'graveyard', owner: 'p2', controller: 'p2', name: 'Grizzly Bears' },
    ];
    const p = planBatch(events, before, after);
    expect(p.a.map((s) => s.kind)).toEqual(['resolve']);
    const r = p.a[0]!;
    if (r.kind !== 'resolve') return;
    expect(r.spell).toBe(true);
    expect(r.style).toBe('lightning');
    expect(r.hits).toEqual([{ source: 's', target: 'c', amount: 3 }]);
    expect(p.b.moves.map((m) => m.kind)).toEqual(['toGraveyard', 'die']);
  });

  it('CR 608.2: the engine reports the effects first and `resolved` last; they are one resolution, out of the spell, with its targets', () => {
    const before = viewOf({ s: { defId: 'bolt', zone: 'stack', stack: { targets: [[{ kind: 'object', id: 'c' }]] } }, c: { defId: 'bears', zone: 'battlefield', controller: 'p2' } }, ['s']);
    const p = planBatch(
      [
        { type: 'damageDealt', source: 's', target: 'c', amount: 3, combat: false },
        { type: 'zoneChanged', oldId: 'c', newId: 'g2', from: 'battlefield', to: 'graveyard', owner: 'p2', controller: 'p2', name: 'Grizzly Bears' },
        { type: 'resolved', objectId: 's' },
        { type: 'zoneChanged', oldId: 's', newId: 'g1', from: 'stack', to: 'graveyard', owner: 'p1', controller: 'p1', name: 'Lightning Bolt' },
      ],
      before,
      viewOf({}),
    );
    // One step for the resolution (no separate bolt from the stack before it), carrying the damage and what it targeted.
    expect(p.a.map((s) => s.kind)).toEqual(['resolve']);
    const r = p.a[0]!;
    if (r.kind !== 'resolve') return;
    expect(r.stackId).toBe('s');
    expect(r.hits).toEqual([{ source: 's', target: 'c', amount: 3 }]);
    expect(r.targets).toEqual(['c']);
  });

  it('exits: destroyed, sacrificed (CR 701.21), exiled (CR 406), returned to hand, put into a library; tokens are marked (CR 111.7)', () => {
    const v = viewOf({ c: { defId: 'bears', zone: 'battlefield' }, t: { defId: 'bears', zone: 'battlefield', kind: 'token' } });
    const z = (over: Partial<Extract<GameEvent, { type: 'zoneChanged' }>>) => classifyMove({ type: 'zoneChanged', oldId: 'c', newId: null, from: 'battlefield', to: 'graveyard', owner: 'p1', controller: 'p1', name: '', ...over }, v);
    expect(z({}).kind).toBe('die');
    expect(z({ cause: 'sacrifice' }).kind).toBe('sacrifice');
    expect(z({ to: 'exile' }).kind).toBe('exile');
    expect(z({ to: 'hand' }).kind).toBe('bounce');
    expect(z({ to: 'library' }).kind).toBe('toLibrary');
    expect(z({ from: 'hand', to: 'stack' }).kind).toBe('toStack');
    expect(z({ from: 'stack', to: 'battlefield' }).kind).toBe('toBattlefield');
    expect(z({ oldId: 't' }).token).toBe(true);
  });

  it('CR 121.1: a draw arrives in the hand from the library; a countered spell (CR 701.6) is shown breaking on the stack, not again as it leaves', () => {
    const v = viewOf({ s: { defId: 'bolt', zone: 'stack' } }, ['s']);
    const p = planBatch(
      [
        { type: 'drew', player: 'p1', objectId: 'h9' },
        { type: 'countered', objectId: 's' },
        { type: 'zoneChanged', oldId: 's', newId: 'g', from: 'stack', to: 'graveyard', owner: 'p1', controller: 'p1', name: 'Lightning Bolt' },
      ],
      v,
      viewOf({}),
    );
    expect(p.b.moves[0]).toMatchObject({ newId: 'h9', from: 'library', to: 'hand', kind: 'toHand' });
    expect(p.a.map((s) => s.kind)).toEqual(['countered']);
    expect(p.b.moves[1]).toMatchObject({ oldId: 's', shownInA: true });
  });

  it('CMDF, CR 903.9b: a commander drawn into the command zone instead moves once (its zoneChanged), never also into the hand', () => {
    const p = planBatch(
      [
        { type: 'zoneChanged', oldId: 'l1', newId: 'c1', from: 'library', to: 'command', owner: 'p1', controller: 'p1', name: 'Test Titania', cause: 'commander' },
        { type: 'drew', player: 'p1', objectId: 'c1', commandZone: true },
      ],
      viewOf({}),
      viewOf({}),
    );
    expect(p.b.moves.filter((m) => m.newId === 'c1')).toHaveLength(1);
    expect(p.b.moves.some((m) => m.to === 'hand')).toBe(false);
  });

  it('a change with nothing to show (a priority pass) plans nothing; a new turn plans its banner', () => {
    const v = viewOf({});
    expect(planIsEmpty(planBatch([{ type: 'priorityGiven', player: 'p1' }], v, v))).toBe(true);
    const t = planBatch([{ type: 'turnBegan', turn: 3, activePlayer: 'p2' }], v, v);
    expect(planIsEmpty(t)).toBe(false);
    expect(t.b.turn).toEqual({ number: 3, player: 'p2' });
  });

  it('NETFIX2 (CR 400.2): another player\'s draw, land and cast that name no card fly a card back of that hand (one new after, one gone before)', () => {
    /** p2's hand of card backs (aliases, m4) next to `objects`. */
    const withHand = (backs: string[], objects: Parameters<typeof viewOf>[0] = {}, stack: string[] = []): GameView => {
      const v = viewOf({ ...objects, ...Object.fromEntries(backs.map((id) => [id, { defId: '__hidden__', zone: 'hand', controller: 'p2' }])) }, stack);
      v.zones.hand = { p1: [], p2: backs };
      return v;
    };
    // A draw: every alias changed (the hand changed); the drawn card arrives as one of the new backs.
    const draw = planBatch([{ type: 'drew', player: 'p2', objectId: '' }], withHand(['ha', 'hb']), withHand(['hc', 'hd', 'he']));
    expect(draw.b.moves).toHaveLength(1);
    expect(draw.b.moves[0]).toMatchObject({ oldId: '', from: 'library', to: 'hand', owner: 'p2', kind: 'toHand' });
    expect(['hc', 'hd', 'he']).toContain(draw.b.moves[0]!.newId);
    // A land played: it leaves from one of the backs of the hand before.
    const land = planBatch(
      [{ type: 'zoneChanged', oldId: '', newId: 'm', from: 'hand', to: 'battlefield', owner: 'p2', controller: 'p2', name: 'Mountain', cause: 'play land' }],
      withHand(['ha', 'hb']),
      withHand(['hc'], { m: { defId: 'bears', zone: 'battlefield', controller: 'p2' } }),
    );
    expect(land.b.moves[0]).toMatchObject({ newId: 'm', from: 'hand', to: 'battlefield', kind: 'toBattlefield' });
    expect(['ha', 'hb']).toContain(land.b.moves[0]!.oldId);
    // A spell cast and gone inside the change flies from a back of the hand before; two cards leaving take two different backs.
    const cast = planBatch(
      [
        { type: 'zoneChanged', oldId: '', newId: 's', from: 'hand', to: 'stack', owner: 'p2', controller: 'p2', name: 'Lightning Bolt', cause: 'cast' },
        { type: 'spellCast', player: 'p2', objectId: 's' },
        { type: 'zoneChanged', oldId: '', newId: null, from: 'hand', to: 'graveyard', owner: 'p2', controller: 'p2', name: 'Plains', cause: 'discard' },
      ],
      withHand(['ha', 'hb']),
      withHand([]),
    );
    const origins = cast.b.moves.map((m) => m.oldId);
    expect(new Set(origins).size).toBe(2);
    expect(origins.every((id) => id === 'ha' || id === 'hb')).toBe(true);
    expect(cast.a.find((s) => s.kind === 'cast')).toMatchObject({ kind: 'cast', stackId: 's', origin: origins[0] });
    // The viewer's own draw keeps its id; with no back to give, the move keeps no id (the hand box is its origin, Animator).
    expect(planBatch([{ type: 'drew', player: 'p1', objectId: 'h9' }], withHand([]), withHand([])).b.moves[0]!.newId).toBe('h9');
    expect(planBatch([{ type: 'drew', player: 'p2', objectId: '' }], withHand(['ha']), withHand(['ha'])).b.moves[0]!.newId).toBe('');
  });
});
