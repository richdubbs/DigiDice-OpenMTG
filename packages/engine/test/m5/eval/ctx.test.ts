/**
 * WP4, effects/ctx.ts: the execution context and the ONE legality check over the targets of every chosen mode (CR 608.2b).
 * The CR's own examples (Sorin's Thirst, Plague Spores) and the design's (Swords to Plowshares with protection, Cryptic Command with one mode's target gone)
 * are built on synthetic states: the card's steps are not run here (that is WP10); what is checked is which targets are legal and what the context knows.
 */
import { describe, expect, it } from 'vitest';
import type { EffectProgram, TargetSpec } from '../../../src/index';
import { recheckAll } from '../../../src/effects/ctx';
import { synth, keyword, spellAbility, activated } from '../helpers';
import { chosenObject, chosenPlayer, ctxOn, find, moveTo, putOnStack, rebuild, scenario } from './helpers';

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const program = (targets: TargetSpec[]): EffectProgram => ({ targets, steps: [] });

describe('CR 608.2b: Sorin\'s Thirst (one target; if it is illegal the spell doesn\'t resolve)', () => {
  const setup = () => scenario(["Sorin's Thirst", 'Grizzly Bears', 'White Knight'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['White Knight'] } });
  const prog = program([creature]);

  it('a legal target: 1 of 1', () => {
    const s = setup();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const spell = putOnStack(s, { name: "Sorin's Thirst", targets: [[chosenObject(bears)]] });
    expect(recheckAll(ctxOn(s, spell, prog))).toEqual({ legal: 1, total: 1 });
  });
  it('the creature has protection from black (the spell is black, CR 702.16b): illegal, so nothing of the spell happens', () => {
    const s = setup();
    const knight = find(s, 'White Knight', 'battlefield', 'p2');
    const spell = putOnStack(s, { name: "Sorin's Thirst", targets: [[chosenObject(knight)]] });
    expect(recheckAll(ctxOn(s, spell, prog))).toEqual({ legal: 0, total: 1 });
  });
  it('the creature left the battlefield (it is a new object, CR 400.7): illegal', () => {
    const s = setup();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const spell = putOnStack(s, { name: "Sorin's Thirst", targets: [[chosenObject(bears)]] });
    const cx = ctxOn(s, spell, prog);
    moveTo(cx, bears, 'graveyard');
    const after = rebuild(cx); // the next resolution starts from the changed state
    expect(recheckAll(after)).toEqual({ legal: 0, total: 1 });
    expect(after.targets.get('t0')![0]).toMatchObject({ legal: false, handle: { id: bears, zone: 'battlefield' } }); // the stale handle remembers where it was
  });
  it('the creature stopped being a creature (a changed characteristic, CR 608.2b)', () => {
    const s = setup();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const spell = putOnStack(s, { name: "Sorin's Thirst", targets: [[chosenObject(bears)]] });
    const lands = program([{ ...creature, filter: { types: ['Land'] } }]); // the spec says land; the chosen object is a creature
    expect(recheckAll(ctxOn(s, spell, lands))).toEqual({ legal: 0, total: 1 });
  });
});

describe('CR 608.2b: Plague Spores ("Destroy target nonblack creature and target land"): each target is judged, the spell resolves if any is legal', () => {
  const nonblack: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'], notColors: ['B'] }, min: 1, max: 1, text: 'target nonblack creature' };
  const land: TargetSpec = { id: 't1', kind: 'object', filter: { types: ['Land'] }, min: 1, max: 1, text: 'target land' };
  const spores = synth({ name: 'Test Spores', cost: '{4}{B}', type: 'Sorcery', abilities: [spellAbility('Destroy target nonblack creature and target land.', [nonblack, land])] });
  const setup = () => scenario(['Grizzly Bears', 'Plains'], { p1: { battlefield: ['Grizzly Bears', 'Plains'] }, defs: [spores] });

  it('both legal: 2 of 2', () => {
    const s = setup();
    const spell = putOnStack(s, { name: 'Test Spores', targets: [[chosenObject(find(s, 'Grizzly Bears', 'battlefield'))], [chosenObject(find(s, 'Plains', 'battlefield'))]] });
    const cx = ctxOn(s, spell, program([nonblack, land]));
    expect(recheckAll(cx)).toEqual({ legal: 2, total: 2 });
  });
  it('the land is gone: 1 of 2, so the spell resolves and only the creature is affected; the dead target is excluded from references', async () => {
    const s = setup();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const plains = find(s, 'Plains', 'battlefield');
    const spell = putOnStack(s, { name: 'Test Spores', targets: [[chosenObject(bears)], [chosenObject(plains)]] });
    const cx = ctxOn(s, spell, program([nonblack, land]));
    moveTo(cx, plains, 'graveyard');
    const after = rebuild(cx);
    expect(recheckAll(after)).toEqual({ legal: 1, total: 2 });
    const { resolveObjs } = await import('../../../src/effects/refs');
    expect(resolveObjs(after, { ref: 'target', id: 't0' }).map((h) => h.id)).toEqual([bears]);
    expect(resolveObjs(after, { ref: 'target', id: 't1' })).toEqual([]);
  });
  it('both gone: 0 of 2, the spell doesn\'t resolve', () => {
    const s = setup();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const plains = find(s, 'Plains', 'battlefield');
    const spell = putOnStack(s, { name: 'Test Spores', targets: [[chosenObject(bears)], [chosenObject(plains)]] });
    const cx = ctxOn(s, spell, program([nonblack, land]));
    moveTo(cx, plains, 'graveyard');
    moveTo(cx, bears, 'graveyard');
    expect(recheckAll(rebuild(cx))).toEqual({ legal: 0, total: 2 });
  });
});

describe('Swords to Plowshares (design 13.1): protection from white makes the target illegal; the spell\'s source is the spell on the stack', () => {
  it('Black Knight (protection from white) is illegal, Hill Giant is legal; a creature the caster controls is legal (no "you don\'t control" in the spec)', () => {
    const s = scenario(['Swords to Plowshares', 'Black Knight', 'Hill Giant', 'Grizzly Bears'], { p1: { hand: [], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Black Knight', 'Hill Giant'] } });
    const knight = find(s, 'Black Knight', 'battlefield', 'p2');
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const prog = program([creature]);
    const verdict = (id: string) => recheckAll(ctxOn(s, putOnStack(s, { name: 'Swords to Plowshares', targets: [[chosenObject(id)]] }), prog));
    expect(verdict(knight)).toEqual({ legal: 0, total: 1 });
    expect(verdict(giant)).toEqual({ legal: 1, total: 1 });
    expect(verdict(bears)).toEqual({ legal: 1, total: 1 });
  });
});

describe('CR 608.2b, D1: Cryptic Command with one mode\'s target gone: ONE check over all chosen modes, target ids unique across modes', () => {
  const spellTarget: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
  const permanent: TargetSpec = { id: 't1', kind: 'object', filter: { types: ['Creature', 'Artifact', 'Land', 'Enchantment'] }, min: 1, max: 1, text: 'target permanent' };
  // The flattened program of "counter target spell" + "return target permanent to its owner's hand" (+ the ability's own steps).
  const flattened: EffectProgram = { targets: [spellTarget, permanent], steps: [] };
  const cryptic = synth({ name: 'Test Cryptic', cost: '{1}{U}{U}{U}', type: 'Instant', abilities: [spellAbility('Choose two --', [spellTarget, permanent])] });
  const setup = () => {
    const s = scenario(['Lightning Bolt', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [cryptic] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const bolt = putOnStack(s, { name: 'Lightning Bolt', owner: 'p2' });
    const spell = putOnStack(s, { name: 'Test Cryptic', targets: [[chosenObject(bolt)], [chosenObject(bears)]] });
    return { s, bears, bolt, spell };
  };

  it('both targets legal', () => {
    const { s, spell } = setup();
    expect(recheckAll(ctxOn(s, spell, flattened))).toEqual({ legal: 2, total: 2 });
  });
  it('the countered spell is gone but the permanent is legal: the ability still resolves (1 of 2), and only the permanent\'s part will happen', async () => {
    const { s, spell, bolt, bears } = setup();
    const cx = ctxOn(s, spell, flattened);
    moveTo(cx, bolt, 'graveyard');
    const after = rebuild(cx);
    expect(recheckAll(after)).toEqual({ legal: 1, total: 2 });
    const { resolveObjs } = await import('../../../src/effects/refs');
    expect(resolveObjs(after, { ref: 'target', id: 't0' })).toEqual([]);
    expect(resolveObjs(after, { ref: 'target', id: 't1' }).map((h) => h.id)).toEqual([bears]);
  });
  it('a mode without targets contributes none: with no target at all there is nothing to check (total 0) and the ability resolves', () => {
    const { s } = setup();
    const draw = putOnStack(s, { name: 'Test Cryptic', targets: [] });
    expect(recheckAll(ctxOn(s, draw, { targets: [], steps: [] }))).toEqual({ legal: 0, total: 0 });
  });
  it('target specs numbered across modes keep their own list: t1\'s list is the second list announced', () => {
    const { s, spell, bolt, bears } = setup();
    const cx = ctxOn(s, spell, flattened);
    expect(cx.targets.get('t0')![0]!.handle).toEqual({ id: bolt, zone: 'stack' });
    expect(cx.targets.get('t1')![0]!.handle).toEqual({ id: bears, zone: 'battlefield' });
  });
  it('legality is the answer at the moment resolution begins (CR 608.2b): recheckAll does not recompute it; a context built again judges the changed state', () => {
    const { s, spell, bolt } = setup();
    const cx = ctxOn(s, spell, flattened);
    moveTo(cx, bolt, 'exile');
    expect(cx.targets.get('t0')![0]!.legal).toBe(true); // the slot still says what it said when the context was built...
    expect(recheckAll(cx).legal).toBe(2); // ... and it still does: it was legal when resolution began
    expect(cx.targets.get('t0')![0]!.legal).toBe(true);
    const next = rebuild(cx); // ... the exiled spell is a new object now
    expect(recheckAll(next).legal).toBe(1);
    expect(next.targets.get('t0')![0]!.legal).toBe(false);
  });
});

describe('target kinds and their legality (CR 115, 608.2b)', () => {
  const hexproofCat = synth({ name: 'Test Hexcat', cost: '{1}{G}', type: 'Creature — Cat', pt: ['2', '2'], abilities: [keyword('hexproof')] });
  const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [])] });

  it('a player: legal while in the game; "target opponent" is illegal if it is the controller; a player who lost is illegal', () => {
    const s = scenario([], { defs: [poke] });
    const spec = (who: 'you' | 'opponent' | 'any'): TargetSpec => ({ id: 't0', kind: 'player', players: { who }, min: 1, max: 1, text: 'target player' });
    const check = (who: 'you' | 'opponent' | 'any', target: string) => recheckAll(ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[chosenPlayer(target)]] }), program([spec(who)]))).legal;
    expect([check('any', 'p2'), check('opponent', 'p2'), check('opponent', 'p1'), check('you', 'p1'), check('you', 'p2')]).toEqual([1, 1, 0, 1, 0]);
    s.players[1]!.hasLost = true;
    expect(check('any', 'p2')).toBe(0);
  });
  it('a player reference in the spec ("target player who ...") is resolved through the context', () => {
    const s = scenario([], { defs: [poke] });
    const spec: TargetSpec = { id: 't0', kind: 'player', players: { who: { ref: 'anOpponent' } }, min: 1, max: 1, text: 'target opponent' };
    const verdict = (target: string) => recheckAll(ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[chosenPlayer(target)]] }), program([spec]))).legal;
    expect([verdict('p2'), verdict('p1')]).toEqual([1, 0]);
  });
  it('anyTarget (CR 115.4): a creature, planeswalker, battle or player; not a land', () => {
    const s = scenario(['Grizzly Bears', 'Plains', 'Jace Beleren'], { p1: { battlefield: ['Grizzly Bears', 'Plains', { name: 'Jace Beleren', counters: { loyalty: 3 } }] }, defs: [poke] });
    const spec: TargetSpec = { id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' };
    const v = (c: ReturnType<typeof chosenObject>) => recheckAll(ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[c]] }), program([spec]))).legal;
    expect([v(chosenObject(find(s, 'Grizzly Bears', 'battlefield'))), v(chosenObject(find(s, 'Jace Beleren', 'battlefield'))), v(chosenObject(find(s, 'Plains', 'battlefield'))), v(chosenPlayer('p2'))]).toEqual([1, 1, 0, 1]);
  });
  it('objectOrPlayer takes either; a player in an object-only spec, or an object in a player-only spec, is illegal', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [poke] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const v = (kind: TargetSpec['kind'], c: ReturnType<typeof chosenObject>) =>
      recheckAll(ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[c]] }), program([{ id: 't0', kind, ...(kind === 'player' ? {} : { filter: { types: ['Creature'] } }), min: 1, max: 1, text: 'x' }]))).legal;
    expect([v('objectOrPlayer', chosenObject(bears)), v('objectOrPlayer', chosenPlayer('p2')), v('object', chosenPlayer('p2')), v('player', chosenObject(bears))]).toEqual([1, 1, 0, 0]);
  });
  it('hexproof (CR 702.11b): an opponent\'s spell can\'t target it, its controller\'s can; a spell never targets itself', () => {
    const s = scenario([], { p1: { battlefield: ['Test Hexcat'] }, defs: [hexproofCat, poke] });
    const cat = find(s, 'Test Hexcat', 'battlefield');
    const prog = program([creature]);
    const mine = putOnStack(s, { name: 'Test Poke', owner: 'p1', targets: [[chosenObject(cat)]] });
    const theirs = putOnStack(s, { name: 'Test Poke', owner: 'p2', targets: [[chosenObject(cat)]] });
    expect(recheckAll(ctxOn(s, mine, prog)).legal).toBe(1);
    expect(recheckAll(ctxOn(s, theirs, prog)).legal).toBe(0);
    const self = putOnStack(s, { name: 'Test Poke' });
    s.objects[self]!.stack!.targets = [[chosenObject(self)]];
    expect(recheckAll(ctxOn(s, self, program([{ id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' }]))).legal).toBe(0);
  });
  it('spell and ability targets must still be on the stack; "target activated or triggered ability" accepts abilities only', () => {
    const s = scenario(['Lightning Bolt', 'Llanowar Elves'], { p1: { battlefield: ['Llanowar Elves'] }, defs: [poke] });
    const bolt = putOnStack(s, { name: 'Lightning Bolt', owner: 'p2' });
    const ability = putOnStack(s, { name: 'Llanowar Elves', kind: 'activated' });
    const v = (kind: TargetSpec['kind'], target: string) => recheckAll(ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(target)]] }), program([{ id: 't0', kind, min: 1, max: 1, text: 'x' }]))).legal;
    expect([v('spell', bolt), v('spell', ability), v('ability', ability), v('ability', bolt), v('stackObject', bolt), v('stackObject', ability)]).toEqual([1, 0, 1, 0, 1, 1]);
  });
  it('an ability whose source has left the battlefield is still checked (its last known information is used, CR 608.2b)', () => {
    const pinger = synth({ name: 'Test Pinger', cost: '{2}', type: 'Creature — Human', pt: ['1', '1'], abilities: [activated('{T}: x', { tap: true }, [creature])] });
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Pinger', 'Grizzly Bears'] }, defs: [pinger] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const ab = putOnStack(s, { name: 'Test Pinger', kind: 'activated', targets: [[chosenObject(bears)]] });
    const cx = ctxOn(s, ab, program([creature]));
    const pingerId = find(s, 'Test Pinger', 'battlefield');
    moveTo(cx, pingerId, 'graveyard');
    const after = ctxOn(s, ab, program([creature]));
    expect(after.source).toEqual({ id: pingerId, zone: 'battlefield' }); // where it was when it left
    expect(after.controller).toBe('p1');
    expect(recheckAll(after)).toEqual({ legal: 1, total: 1 });
  });
});

describe('makeCtx: what the context holds', () => {
  it('a spell: its own id is the source and the stack id; the controller; the event is null; empty bindings, results and variables', () => {
    const s = scenario(['Lightning Bolt'], {});
    const spell = putOnStack(s, { name: 'Lightning Bolt', owner: 'p2' });
    const cx = ctxOn(s, spell);
    expect(cx.source).toEqual({ id: spell, zone: 'stack' });
    expect(cx.stackId).toBe(spell);
    expect(cx.controller).toBe('p2');
    expect(cx.event).toBeNull();
    expect([cx.bindings.size, cx.results.size, cx.vars.size, cx.targets.size]).toEqual([0, 0, 0, 0]);
    expect(cx.stack).toBe(s.objects[spell]!.stack);
  });
  it('an ability: the source is the object it came from (not the stack object); the event of a triggered ability is kept', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const event = { ev: 'zoneChange' as const, roles: { subject: { objects: [{ id: bears, zone: 'battlefield' as const }] } }, amount: 3, before: {} };
    const trig = putOnStack(s, { name: 'Grizzly Bears', kind: 'triggered', event });
    const cx = ctxOn(s, trig);
    expect(cx.source).toEqual({ id: bears, zone: 'battlefield' });
    expect(cx.stackId).toBe(trig);
    expect(cx.event).toBe(event);
  });
  it('a permanent without stack information gets a context with no stack and no targets (static abilities, cost modifiers)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const cx = ctxOn(s, bears);
    expect(cx).toMatchObject({ source: { id: bears, zone: 'battlefield' }, stackId: null, stack: null, controller: 'p1' });
    expect(recheckAll(cx)).toEqual({ legal: 0, total: 0 });
  });
  it('a spec with no announced list (a skipped onlyIf) has an empty slot list', () => {
    const s = scenario(['Lightning Bolt'], {});
    const spell = putOnStack(s, { name: 'Lightning Bolt', targets: [] });
    const cx = ctxOn(s, spell, program([creature]));
    expect(cx.targets.get('t0')).toEqual([]);
  });
});

describe('the legality check agrees with milestone 3\'s rules/targets.ts#recheckTargets on everything milestone 3 could express', () => {
  it('every chosen object or player against every kind and filter of milestone 3', async () => {
    const { recheckTargets } = await import('../../../src/rules/targets');
    const hexcat = synth({ name: 'Test Hexcat', cost: '{1}{G}', type: 'Creature — Cat', pt: ['2', '2'], abilities: [keyword('hexproof')] });
    const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [])] });
    const s = scenario(['Grizzly Bears', 'Serra Angel', 'Black Knight', 'White Knight', 'Plains', 'Bonesplitter', 'Lightning Bolt'], {
      p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Plains', 'Test Hexcat'], graveyard: ['Black Knight'] },
      p2: { battlefield: ['White Knight', 'Black Knight', 'Bonesplitter', 'Test Hexcat'] },
      defs: [hexcat, poke],
    });
    const bolt = putOnStack(s, { name: 'Lightning Bolt', owner: 'p2' });
    const specs: TargetSpec[] = [
      { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'creature' },
      { id: 't0', kind: 'object', filter: { types: ['Creature'], controller: 'opponent', notColors: ['B'] }, min: 1, max: 1, text: 'nonblack creature an opponent controls' },
      { id: 't0', kind: 'object', filter: { types: ['Land', 'Artifact'] }, min: 1, max: 1, text: 'land or artifact' },
      { id: 't0', kind: 'object', filter: { zone: 'graveyard', types: ['Creature'] }, min: 1, max: 1, text: 'creature card in a graveyard' },
      { id: 't0', kind: 'objectOrPlayer', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'creature or player' },
      { id: 't0', kind: 'player', players: { who: 'opponent' }, min: 1, max: 1, text: 'target opponent' },
      { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' },
    ];
    const everything = [...s.zones.battlefield, ...s.zones.graveyard['p1']!, bolt].map(chosenObject).concat([chosenPlayer('p1'), chosenPlayer('p2')]);
    let compared = 0;
    for (const caster of ['p1', 'p2']) {
      for (const spec of specs) {
        for (const target of everything) {
          const spell = putOnStack(s, { name: 'Test Poke', owner: caster, targets: [[target]] });
          const mine = recheckAll(ctxOn(s, spell, program([spec])));
          const m3 = recheckTargets(s, [spec], [[target]], caster, spell, spell);
          expect(mine, `${caster} casts ${spec.text} at ${JSON.stringify(target)}`).toEqual(m3);
          compared++;
        }
      }
    }
    expect(compared).toBe(2 * 7 * everything.length);
  });
});
