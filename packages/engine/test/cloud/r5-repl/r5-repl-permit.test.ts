/**
 * Cloud r5-repl (Standard round 5: replacement and prevention effects): the "instead of a graveyard" rider of a cast permission, played through the engine with
 * synthetic cards compiled by the game's default compiler (invented names, numbers and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 614.1a, 400.7          "You may cast it this turn ... If that spell would be put into a graveyard, exile it instead." (PermissionDef.graveyardInstead)
 *   CR 608.2n, 701.6a         it applies as the spell resolves and when it is countered
 *   CR 707.10                 a copy of the spell was not cast with the permission
 *   CR 404.1                  "into your graveyard": only a card the permission's player owns
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

function drive(s0: GameState, targets: TargetChoice[][] = [], yes: boolean[] = []): GameState {
  let s = s0;
  const t = [...targets];
  const y = [...yes];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: y.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
const castFrom = (s: GameState, id: ObjectId, targets: TargetChoice[][] = [], player: PlayerId = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: id }), targets);
const activate = (s: GameState, source: ObjectId, targets: TargetChoice[][] = []): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source, ability: 'p:0:0' }), targets));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

const PING = card('Test Ping', 'Sorcery', '~ deals 2 damage to any target.');
const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.');
const FORUM = card('Test Forum', 'Creature — Human Advisor', '{1}: Exile target sorcery card from an opponent\'s graveyard. You may cast it this turn, and mana of any type can be spent to cast that spell. If that spell would be put into a graveyard, exile it instead.', { pt: ['2', '2'] });
const SAGE = card('Test Sage', 'Creature — Merfolk Wizard', '{1}, Sacrifice ~: You may cast target sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead.', { pt: ['1', '3'] });

/** Where the cards with this name are, as zone:owner (each move makes a new object, CR 400.7). */
function zonesNamed(s: GameState, name: string): string[] {
  const out: string[] = [];
  for (const z of ['battlefield', 'exile', 'graveyard', 'hand', 'library'] as const) for (const id of findAll(s, name, z)) out.push(`${z}:${s.objects[id]!.owner}`);
  return out;
}

describe('Cloud r5-repl: "You may cast it this turn ... If that spell would be put into a graveyard, exile it instead." (CR 614.1a, 400.7)', () => {
  it('is automated', () => {
    expect(full(FORUM)).toBe(true);
    expect(full(SAGE)).toBe(true);
  });
  it('CR 614.1a, 608.2n: the spell cast with the permission is exiled instead of going to its owner\'s graveyard as it resolves', () => {
    let s = scenario([], { defs: [FORUM, PING], p1: { battlefield: ['Test Forum', 'Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Ping'] } });
    s = activate(s, find(s, 'Test Forum', 'battlefield'), [[obj(find(s, 'Test Ping', 'graveyard', 'p2'))]]);
    s = resolveAll(castFrom(s, find(s, 'Test Ping', 'exile', 'p2'), [[player('p2')]]));
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.graveyard.p2).toHaveLength(0);
    expect(zonesNamed(s, 'Test Ping')).toEqual(['exile:p2']);
  });
  it('CR 701.6a, 614.1a: a countered spell cast with the permission is exiled too', () => {
    let s = scenario([], { defs: [FORUM, PING, NEGATE], p1: { hand: ['Test Negate'], battlefield: ['Test Forum', 'Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Ping'] } });
    s = activate(s, find(s, 'Test Forum', 'battlefield'), [[obj(find(s, 'Test Ping', 'graveyard', 'p2'))]]);
    s = castFrom(s, find(s, 'Test Ping', 'exile', 'p2'), [[player('p2')]]);
    const spell = s.zones.stack[0]!;
    s = resolveAll(castFrom(s, find(s, 'Test Negate', 'hand'), [[obj(spell)]]));
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.graveyard.p2).toHaveLength(0);
    expect(zonesNamed(s, 'Test Ping')).toEqual(['exile:p2']);
    expect(zonesNamed(s, 'Test Negate')).toEqual(['graveyard:p1']);
  });
  it('CR 614.1a, 400.7: the rider applies to the spell even after the permission\'s source has left the battlefield', () => {
    let s = scenario([], { defs: [SAGE, PING], p1: { battlefield: ['Test Sage', 'Plains', 'Plains'], graveyard: ['Test Ping'] } });
    s = activate(s, find(s, 'Test Sage', 'battlefield'), [[obj(find(s, 'Test Ping', 'graveyard'))]]);
    expect(zonesNamed(s, 'Test Sage')).toEqual(['graveyard:p1']);
    s = resolveAll(castFrom(s, find(s, 'Test Ping', 'graveyard'), [[player('p2')]]));
    expect(life(s, 'p2')).toBe(18);
    expect(zonesNamed(s, 'Test Ping')).toEqual(['exile:p1']);
  });
  it('CR 614.1a: a card cast without the permission (from the hand) goes to the graveyard as usual', () => {
    let s = scenario([], { defs: [FORUM, PING], p1: { hand: ['Test Ping'], battlefield: ['Test Forum', 'Plains'] }, p2: { graveyard: ['Test Ping'] } });
    s = activate(s, find(s, 'Test Forum', 'battlefield'), [[obj(find(s, 'Test Ping', 'graveyard', 'p2'))]]);
    s = resolveAll(castFrom(s, find(s, 'Test Ping', 'hand'), [[player('p2')]]));
    expect(zonesNamed(s, 'Test Ping').sort()).toEqual(['exile:p2', 'graveyard:p1']);
  });
  it('CR 611.2a: the permission is a resolved effect that carries its rider', () => {
    let s = scenario([], { defs: [FORUM, PING], p1: { battlefield: ['Test Forum', 'Plains'] }, p2: { graveyard: ['Test Ping'] } });
    s = activate(s, find(s, 'Test Forum', 'battlefield'), [[obj(find(s, 'Test Ping', 'graveyard', 'p2'))]]);
    expect(s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.graveyardInstead !== undefined)).toBe(true);
  });
});
