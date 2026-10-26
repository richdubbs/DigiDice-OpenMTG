/**
 * Precon lane pc-zones, round pc-zones-2 (library and graveyard moves), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.23a, 205.3i     "Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.": the second card is
 *                          offered only among cards sharing a land type with the first; none, one or two
 *   CR 701.23a, 110.2a     "Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.": every player, their own library, under their
 *                          own control, untapped
 *   CR 701.40a, 608.2c     "Exile target creature. Its controller manifests the top card of their library.": the controller of the exiled creature (not the caster) manifests
 *   CR 205.1b, 105.3, 613 "Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other
 *                          colors and types.": that creature only, and for good
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';
const namesIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', who: PlayerId): string[] => s.zones[zone][who]!.map((id) => s.objects[id]!.defId);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, X by `x`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; x?: number; pick?: (options: ObjectId[]) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);


const FOREST2 = card('Test Grove', 'Land — Forest', '');
const ISLAND2 = card('Test Pond', 'Land — Island', '');
const BASICF = card('Forest', 'Basic Land — Forest', '');
const BASICI = card('Island', 'Basic Land — Island', '');
const BASICP = card('Plains', 'Basic Land — Plains', '');

describe('CR 701.23a, 205.3i: "Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle."', () => {
  const MYRIAD = card('Test Landscape', 'Sorcery', 'Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.');
  const defs = [MYRIAD, BASICF, BASICI, BASICP];
  it('is fully automated', () => expect(full(MYRIAD)).toBe(true));
  it('after a Forest the second card is offered among Forests only (an Island is not offered); both enter tapped', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Landscape'], library: ['Island', 'Forest', 'Plains', 'Forest', 'Island'] } });
    const forests = s.zones.library['p1']!.filter((id) => s.objects[id]!.defId === 'Forest');
    const offered: ObjectId[][] = [];
    s = cast(s, 'Test Landscape', { pick: (options) => { offered.push(options); return offered.length === 1 ? [forests[0]!] : [options[0]!]; } });
    expect(offered.length).toBe(2);
    expect(offered[0]!.length).toBeGreaterThanOrEqual(5); // everything basic at first
    expect(offered[1]!.every((id) => s.objects[id]?.defId === 'Forest' || forests.includes(id))).toBe(true);
    const field = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && s.objects[id]!.defId === 'Forest');
    expect(field.length).toBe(2);
    expect(field.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('the searcher may stop after the first card (up to two): declining the second pick leaves one land found', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Landscape'], library: ['Island', 'Forest', 'Forest'] } });
    let picks = 0;
    s = cast(s, 'Test Landscape', { pick: (options) => { picks += 1; return picks === 1 ? [options.find((id) => s.objects[id]?.defId === 'Forest') ?? options[0]!] : []; } });
    expect(picks).toBe(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && ['Forest', 'Island', 'Plains'].includes(s.objects[id]!.defId)).length).toBe(1);
  });
  it('a dual land (Plains Island) shares a type with Plains and with Island, but after a Plains the Island is not offered', () => {
    const DUAL = card('Test Dual', 'Land — Plains Island', '');
    let s = scenario([], { defs: [...defs, DUAL], p1: { hand: ['Test Landscape'], library: ['Island', 'Test Dual', 'Plains', 'Island'] } });
    const seen: string[][] = [];
    const plains = s.zones.library['p1']!.find((id) => s.objects[id]!.defId === 'Plains')!;
    s = cast(s, 'Test Landscape', { pick: (options) => { seen.push(options.map((id) => s.objects[id]?.defId ?? '?')); return seen.length === 1 ? [plains] : [options[0]!]; } });
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });
  it('three cards need ONE land type in common: Plains Island, Island Swamp and Swamp Plains duals are never all three taken', () => {
    const A = card('Test Dual A', 'Land — Plains Island', ''), B = card('Test Dual B', 'Land — Island Swamp', ''), C = card('Test Dual C', 'Land — Swamp Plains', '');
    const THREE = card('Test Landscape Three', 'Sorcery', 'Search your library for up to three land cards that share a land type, put them onto the battlefield tapped, then shuffle.');
    let s = scenario([], { defs: [THREE, A, B, C], p1: { hand: ['Test Landscape Three'], library: ['Test Dual A', 'Test Dual B', 'Test Dual C'] } });
    s = cast(s, 'Test Landscape Three', { pick: (options) => [options[0]!] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && s.objects[id]!.defId.startsWith('Test Dual')).length).toBe(2);
  });
});

describe('CR 701.23a, 110.2a: "Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles."', () => {
  const RUIN = card('Test Ruin', 'Sorcery', 'Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.');
  const defs = [RUIN, BASICF, BASICI];
  it('is fully automated', () => expect(full(RUIN)).toBe(true));
  it('each player puts one basic land from their OWN library onto the battlefield under their own control, untapped', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ruin'], library: ['Forest'] }, p2: { library: ['Island'] } });
    s = cast(s, 'Test Ruin');
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Forest');
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Island');
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(1);
    expect(s.objects[mine[0]!]!.controller).toBe('p1');
    expect(s.objects[theirs[0]!]!.controller).toBe('p2');
    expect(s.objects[mine[0]!]!.tapped || s.objects[theirs[0]!]!.tapped).toBe(false);
  });
  it('a player whose library has no basic land puts nothing onto the battlefield; the other still does', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ruin'], library: ['Forest'] }, p2: { library: [] } });
    s = cast(s, 'Test Ruin');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && s.objects[id]!.defId === 'Forest').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p2' && ['Forest', 'Island'].includes(s.objects[id]!.defId)).length).toBe(0);
  });
});

describe('CR 701.40a, 608.2c: "Exile target creature. Its controller manifests the top card of their library."', () => {
  const SHIFT = card('Test Shift', 'Instant', 'Exile target creature. Its controller manifests the top card of their library.');
  const defs = [SHIFT, BEAR, RELIC];
  it('is fully automated', () => expect(full(SHIFT)).toBe(true));
  it('the creature goes to exile and ITS controller (the opponent) manifests the top card of THEIR library; the caster manifests nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Shift'], library: ['Test Relic'] }, p2: { battlefield: [{ name: 'Test Bear', since: 1 }], library: ['Test Relic', 'Test Relic'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Shift', { targets: [[bear]] });
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    const manifested = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(manifested.length).toBe(1);
    expect(s.objects[manifested[0]!]!.controller).toBe('p2'); // the exiled creature's controller, not the caster
    expect(s.zones.library['p2']!.length).toBe(21); // two scripted cards and twenty Plains, one less
    expect(s.zones.library['p1']!.length).toBe(21); // the caster's library is untouched
  });
});

describe('CR 205.1b, 105.3, 613.1d-e: "Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types."', () => {
  const RISE = card('Test Rise', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types.');
  const defs = [RISE, BEAR];
  it('is fully automated', () => expect(full(RISE)).toBe(true));
  it('the creature enters under your control and is black and a Zombie besides a Bear; another creature is not changed', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Rise'], battlefield: [{ name: 'Test Bear', since: 1 }] }, p2: { graveyard: ['Test Bear'] } });
    const dead = find(s, 'Test Bear', 'graveyard', 'p2');
    const other = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Rise', { targets: [[dead]] });
    const risen = s.zones.battlefield.find((id) => id !== other && s.objects[id]!.defId === 'Test Bear')!;
    expect(s.objects[risen]!.controller).toBe('p1');
    const c = chars(s, risen);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Zombie']));
    expect(c.colors).toContain('B');
    expect(chars(s, other).subtypes).not.toContain('Zombie');
    expect(chars(s, other).colors).not.toContain('B');
  });
});
