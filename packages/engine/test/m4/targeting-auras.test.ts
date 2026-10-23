/**
 * Protection, hexproof and shroud as they affect targeting (CR 702.16b, 702.11b, 702.18a), casting Auras (CR 303.4a, 303.4f) and the
 * combat-aware object filters (attacking / blocking).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type GameState, type OracleCard } from '../../src/index';
import { findObjects, NO_ENV } from '../../src/rules/filter';
import { castAuto } from '../m3/scenario';
import { act, answer, declareAttackers, find, inGraveyard, logHas, onBattlefield, pass, scenario, toDeclareAttackers } from './helpers';

const castTargets = (s: GameState, name: string, player = 'p1') => {
  const t = act(s, { type: 'cast', player, card: find(s, name, 'hand', player) });
  return t.pending?.kind === 'chooseTargets' ? { objects: t.pending.objects, players: t.pending.players, state: t } : { objects: [], players: [], state: t };
};

describe('CR 303.4a: Aura spells target', () => {
  it('CR 303.4a: casting Pacifism asks for a target creature (any creature on the battlefield)', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Hill Giant', 'Grizzly Bears'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const { objects, players, state } = castTargets(s0, 'Pacifism');
    expect(objects.sort()).toEqual([find(s0, 'Hill Giant', 'battlefield'), find(s0, 'Grizzly Bears', 'battlefield')].sort());
    expect(players).toEqual([]); // Enchant creature: no players, no lands
    expect(state.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'creature' });
  });

  it('CR 303.4f: an Aura spell that resolves enters the battlefield attached to the object it targeted', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Hill Giant'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castAuto(s0, 'Pacifism', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] }] });
    s = pass(pass(s));
    expect(onBattlefield(s, 'Pacifism', 'p1')).toBe(true);
    expect(s.objects[find(s, 'Pacifism', 'battlefield')]!.attachedTo).toBe(giant);
    expect(logHas(s, /Pacifism is attached to Hill Giant/, 'CR 303.4f')).toBe(true);
    // And it stays: it is attached to a legal object (CR 704.5m).
    s = pass(pass(s));
    expect(onBattlefield(s, 'Pacifism', 'p1')).toBe(true);
  });

  it('CR 608.2b: if the creature is gone when an Aura spell would resolve, the Aura does not resolve (it goes to the graveyard)', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Hill Giant', 'Lightning Bolt', 'Mountain'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Hill Giant', 'Mountain'], hand: ['Lightning Bolt'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castAuto(s0, 'Pacifism', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] }] });
    s = pass(s); // Bob responds with Lightning Bolt on his own Giant (WP18: automated, CR 120.3 and 704.5g)
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] });
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    s = pass(pass(s));
    expect(onBattlefield(s, 'Pacifism', 'p1')).toBe(false);
    expect(inGraveyard(s, 'Pacifism', 'p1')).toBe(true);
    expect(logHas(s, /Pacifism fizzles/, 'CR 608.2b')).toBe(true);
  });

  it('CR 601.2c: an Aura can not be cast when there is nothing it could enchant', () => {
    const s = scenario(['Pacifism', 'Plains'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains'] } });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast')).toBe(false);
  });

  it('CR 702.5a: "Enchant player" auras target players and attach to them (a synthetic curse)', () => {
    const curse = compileCard({ name: 'Test Curse', layout: 'normal', type_line: 'Enchantment — Aura Curse', mana_cost: '{1}', oracle_text: 'Enchant player', colors: [] } as OracleCard);
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Curse'], battlefield: ['Plains'] }, defs: [curse] });
    const { players, objects, state } = castTargets(s0, 'Test Curse');
    expect(players.sort()).toEqual(['p1', 'p2']);
    expect(objects).toEqual([]);
    let s = answer(state, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    expect(s.objects[find(s, 'Test Curse', 'battlefield')]!.attachedTo).toBe('p2');
    s = pass(pass(s));
    expect(onBattlefield(s, 'Test Curse', 'p1')).toBe(true); // legal attachment to a player (CR 704.5m)
  });
});

describe('CR 702.16b, 702.11b, 702.18a: what protection, hexproof and shroud stop', () => {
  it('CR 702.16b: a creature with protection from white can\'t be the target of a white Aura (Black Knight, Pacifism)', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Black Knight', 'Hill Giant'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Black Knight', 'Hill Giant'] } });
    expect(castTargets(s0, 'Pacifism').objects).toEqual([find(s0, 'Hill Giant', 'battlefield')]);
    // Alone, the Black Knight can't be targeted, so Pacifism can't be cast at all.
    const alone = scenario(['Pacifism', 'Plains', 'Black Knight'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Black Knight'] } });
    expect(legalActions(alone, 'p1').some((a) => a.kind === 'cast')).toBe(false);
  });

  it('CR 702.11b: hexproof stops spells and abilities the creature\'s controller\'s opponents control, not its controller\'s own (Gladecover Scout)', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Gladecover Scout', 'Hill Giant'], {
      p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains', 'Gladecover Scout'] },
      p2: { battlefield: ['Hill Giant', 'Gladecover Scout'] },
    });
    const mine = find(s0, 'Gladecover Scout', 'battlefield', 'p1');
    const theirs = find(s0, 'Gladecover Scout', 'battlefield', 'p2');
    const opts = castTargets(s0, 'Pacifism').objects;
    expect(opts).toContain(mine); // my own hexproof creature
    expect(opts).not.toContain(theirs); // the opponent's
    expect(opts).toContain(find(s0, 'Hill Giant', 'battlefield'));
  });

  it('CR 702.18a: shroud stops every spell and ability, even its controller\'s (Elvish Lookout)', () => {
    const s0 = scenario(['Pacifism', 'Plains', 'Elvish Lookout', 'Hill Giant'], { p1: { hand: ['Pacifism'], battlefield: ['Plains', 'Plains', 'Elvish Lookout'] }, p2: { battlefield: ['Hill Giant'] } });
    expect(castTargets(s0, 'Pacifism').objects).toEqual([find(s0, 'Hill Giant', 'battlefield')]);
  });

});

describe('combat-aware filters (CR 506.4, 508.1k, 509.1g)', () => {
  it('"attacking" and "blocking" filters see the combat state', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = declareAttackers(toDeclareAttackers(s0), [[giant]]);
    const attacking = findObjects(s, { types: ['Creature'], attacking: true }, { you: 'p1', env: NO_ENV }).map((o) => o.id);
    expect(attacking).toEqual([giant]);
    const notAttacking = findObjects(s, { types: ['Creature'], attacking: false, controller: 'you' }, { you: 'p1', env: NO_ENV }).map((o) => s.defs[o.defId]!.name);
    expect(notAttacking).toEqual(['Grizzly Bears']);
    expect(findObjects(s, { types: ['Creature'], blocking: true }, { you: 'p1', env: NO_ENV })).toEqual([]);
  });
});
