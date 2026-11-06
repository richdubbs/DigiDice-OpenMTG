/**
 * Commander lane edh-c (EDHREC ranks 22,001 to 22,500, fourth pass; round edh-c-109, code edhv109): the round's readings played through the engine with synthetic cards
 * (invented names and wordings, design 6.10), compiled by the game's default compiler. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 607.2a, 400.7, 110.2   "Sacrifice this artifact: Return each creature card exiled with this artifact to the battlefield under your control" (only what its own abilities exiled, only creature cards)
 *   CR 607.2a, 400.7, 108.3   "When this artifact is put into a graveyard from the battlefield, return all cards exiled with it to the battlefield under their owners' control" (two exiling abilities)
 *   CR 122.1, 608.2d, 115.1   "Remove up to five counters from target artifact, creature, planeswalker, or opponent": counters of any kinds from the one target, a permanent or a player
 *   CR 611.2a, 613.4c, 608.2c "Until end of turn, target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1. Those creatures gain vigilance"
 *   CR 613.4b, 107.3, 608.2d  "you may have the base power and toughness of another target creature you control become X/X until end of turn, where X is this creature's power"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, pass, answer, scenario, battlefieldNames } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { advanceTo } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const toughness = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.toughness);
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);

interface Opts { yes?: boolean; targets?: string[][] }
/** Answer the decisions that come up until priority: each target decision takes the next list of targets; options in order; numbers at their maximum. */
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const activate = (s: GameState, source: ObjectId, ability: string, o: Opts = {}): GameState => resolveAll(act(s, { type: 'activate', player: 'p1', source, ability }), o);
const controllerOf = (s: GameState, id: ObjectId): string => s.objects[id]!.controller;
const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '');

describe('CR 607.2a, 400.7, 110.2: "Sacrifice this artifact: Return each creature card exiled with this artifact to the battlefield under your control."', () => {
  const VAULT = card('Test Vault', 'Artifact', '{0}: Exile target permanent.\nSacrifice this artifact: Return each creature card exiled with this artifact to the battlefield under your control.');
  const defs = [VAULT, BEAR, TRINKET];
  const setup = (): GameState => scenario([], { p1: { battlefield: ['Test Vault'] }, p2: { battlefield: ['Test Plain Bear', 'Test Trinket'] }, defs });
  it('is parsed and automated', () => expect(automated(VAULT)).toBe(true));
  it('returns only the creature cards it exiled, under your control (the owner is the opponent)', () => {
    const s0 = setup();
    const vault = find(s0, 'Test Vault', 'battlefield', 'p1');
    let s1 = activate(s0, vault, 'p:0:0', { targets: [[find(s0, 'Test Plain Bear', 'battlefield', 'p2')]] });
    s1 = activate(s1, vault, 'p:0:0', { targets: [[find(s0, 'Test Trinket', 'battlefield', 'p2')]] });
    expect(inExile(s1, 'Test Plain Bear').length).toBe(1);
    expect(inExile(s1, 'Test Trinket').length).toBe(1);
    const s2 = activate(s1, vault, 'p:0:1');
    const bear = find(s2, 'Test Plain Bear', 'battlefield', 'p2');
    expect(controllerOf(s2, bear)).toBe('p1');
    expect(s2.objects[bear]!.owner).toBe('p2');
    expect(inExile(s2, 'Test Trinket').length).toBe(1); // not a creature card: it stays exiled
    expect(s2.zones.battlefield.includes(vault)).toBe(false);
  });
  it('negative: a creature card another effect exiled is not "exiled with" this artifact and stays in exile', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Vault'] }, p2: { exile: ['Test Plain Bear'] }, defs });
    const vault = find(s0, 'Test Vault', 'battlefield', 'p1');
    const s1 = activate(s0, vault, 'p:0:1');
    expect(inExile(s1, 'Test Plain Bear').length).toBe(1);
    expect(battlefieldNames(s1, 'p1')).not.toContain('Test Plain Bear');
  });
});

describe('CR 607.2a, 400.7, 108.3: "When this artifact is put into a graveyard from the battlefield, return all cards exiled with it to the battlefield under their owners\' control." (two abilities exile)', () => {
  const RELIQUARY = card('Test Reliquary', 'Artifact', "{0}: Exile target creature you control.\n{0}: Exile target creature you don't control.\n{0}, Sacrifice this artifact: Draw a card.\nWhen this artifact is put into a graveyard from the battlefield, return all cards exiled with it to the battlefield under their owners' control.");
  const defs = [RELIQUARY, BEAR];
  it('is parsed and automated', () => expect(automated(RELIQUARY)).toBe(true));
  it('both exiling abilities are linked: the cards of both come back, each under its owner\'s control', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Reliquary', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const rel = find(s0, 'Test Reliquary', 'battlefield', 'p1');
    const mine = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    let s1 = activate(s0, rel, 'p:0:0', { targets: [[mine]] });
    s1 = activate(s1, rel, 'p:0:1', { targets: [[theirs]] });
    expect(inExile(s1, 'Test Plain Bear').length).toBe(2);
    const s2 = activate(s1, rel, 'p:0:2');
    const back = s2.zones.battlefield.filter((id) => s2.objects[id]!.defId === 'Test Plain Bear');
    expect(back.length).toBe(2);
    expect(back.map((id) => `${s2.objects[id]!.owner}:${controllerOf(s2, id)}`).sort()).toEqual(['p1:p1', 'p2:p2']);
  });
  it('negative: it does nothing while it is still on the battlefield, and a card exiled by something else stays exiled', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Reliquary'] }, p2: { exile: ['Test Plain Bear'] }, defs });
    const rel = find(s0, 'Test Reliquary', 'battlefield', 'p1');
    const s1 = activate(s0, rel, 'p:0:2');
    expect(inExile(s1, 'Test Plain Bear').length).toBe(1);
  });
});

describe('CR 122.1, 608.2d, 115.1: "Remove up to five counters from target artifact, creature, planeswalker, or opponent."', () => {
  const PRICE = card('Test Toll', 'Sorcery', 'Remove up to five counters from target artifact, creature, planeswalker, or opponent.');
  const defs = [PRICE, BEAR, TRINKET];
  it('is parsed and automated', () => expect(automated(PRICE)).toBe(true));
  it('removes counters of several kinds from one creature, at most five', () => {
    const s0 = scenario([], { p1: { hand: ['Test Toll'] }, p2: { battlefield: [{ name: 'Test Plain Bear', counters: { '+1/+1': 4, charge: 3 } }] }, defs });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Toll', 'hand', 'p1') }), { targets: [[bear]] });
    const left = Object.values(s1.objects[bear]!.counters).reduce((a, b) => a + b, 0);
    expect(left).toBe(2);
  });
  it('an opponent can be the target: their counters are removed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Toll'] }, defs });
    s0.players.find((x) => x.id === 'p2')!.counters = { energy: 3 };
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Toll', 'hand', 'p1') }), { targets: [['p2']] });
    expect(Object.values(s1.players.find((x) => x.id === 'p2')!.counters).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('negative: fewer counters than five removes what is there, and an artifact is a legal target', () => {
    const s0 = scenario([], { p1: { hand: ['Test Toll'] }, p2: { battlefield: [{ name: 'Test Trinket', counters: { charge: 2 } }] }, defs });
    const trinket = find(s0, 'Test Trinket', 'battlefield', 'p2');
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Toll', 'hand', 'p1') }), { targets: [[trinket]] });
    expect(Object.values(s1.objects[trinket]!.counters).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('CR 611.2a, 613.4c, 608.2c: "Until end of turn, target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1. Those creatures gain vigilance until end of turn."', () => {
  const RALLY = card('Test Rally', 'Instant', 'Until end of turn, target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1. Those creatures gain vigilance until end of turn.');
  const defs = [RALLY, BEAR];
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Rally'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
  it('is parsed and automated', () => expect(automated(RALLY)).toBe(true));
  it('three different creatures get +3/+3, +2/+2 and +1/+1 and all three gain vigilance; the fourth does not', () => {
    const s0 = setup();
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1');
    const c = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rally', 'hand', 'p1') }), { targets: [[a!], [b!], [c]] });
    expect([power(s1, a!), power(s1, b!), power(s1, c)]).toEqual([5, 4, 3]);
    expect([toughness(s1, a!), toughness(s1, b!), toughness(s1, c)]).toEqual([5, 4, 3]);
    for (const id of [a!, b!, c]) expect(keywords(s1, id)).toContain('vigilance');
  });
  it('negative: with only the first target chosen, only it is pumped and gains vigilance', () => {
    const s0 = setup();
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1');
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rally', 'hand', 'p1') }), { targets: [[a!], [], []] });
    expect(power(s1, a!)).toBe(5);
    expect(keywords(s1, a!)).toContain('vigilance');
    expect(power(s1, b!)).toBe(2);
    expect(keywords(s1, b!)).not.toContain('vigilance');
  });
});

describe('CR 613.4b, 107.3, 608.2d: "Whenever this creature attacks, you may have the base power and toughness of another target creature you control become X/X until end of turn, where X is this creature\'s power."', () => {
  const KRASIS = card('Test Krasis', 'Creature — Beast', "Whenever this creature attacks, you may have the base power and toughness of another target creature you control become X/X until end of turn, where X is this creature's power.", ['4', '4']);
  const defs = [KRASIS, BEAR];
  const attack = (yes: boolean): { s: GameState; bear: ObjectId; krasis: ObjectId } => {
    const s0 = advanceTo(scenario([], { p1: { battlefield: ['Test Krasis', 'Test Plain Bear'] }, defs }), 3, 'main1');
    const krasis = find(s0, 'Test Krasis', 'battlefield', 'p1');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[krasis]]);
    s = drive(s, { targets: [[bear]], yes });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(pass(s), { targets: [[bear]], yes });
    return { s, bear, krasis };
  };
  it('is parsed and automated', () => expect(automated(KRASIS)).toBe(true));
  it('the other creature becomes 4/4 (the Krasis\'s power as it resolves)', () => {
    const { s, bear } = attack(true);
    expect([power(s, bear), toughness(s, bear)]).toEqual([4, 4]);
  });
  it('X is read once, as the ability resolves: a later change to the Krasis\'s power does not change the other creature (ruling of 2024-02-02)', () => {
    const { s, bear, krasis } = attack(true);
    const t = JSON.parse(JSON.stringify(s)) as GameState;
    t.objects[krasis]!.counters = { '+1/+1': 3 };
    expect(power(t, krasis)).toBe(7);
    expect([power(t, bear), toughness(t, bear)]).toEqual([4, 4]);
  });
  it('negative: declining leaves the creature as it was', () => {
    const { s, bear } = attack(false);
    expect([power(s, bear), toughness(s, bear)]).toEqual([2, 2]);
  });
});
