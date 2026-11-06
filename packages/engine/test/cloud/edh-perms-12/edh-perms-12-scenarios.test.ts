/**
 * Commander lane edh-perms, round edh-perms-12: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout), except where a ruling is named.
 *
 *   CR 603.7c, 400.7, 608.2c   "exile up to one other target nonland permanent. At the beginning of the next end step, return that card ... If it entered under your control, put a +1/+1 counter on ~"
 *   CR 122.1, 608.2c           "they lose 1 life and you put a -1/-1 counter on up to one target creature they control"
 *   CR 614.1c, 614.12, 701.20a "As ~ enters, you may reveal a Dragon card from your hand. ~ enters tapped unless you revealed a Dragon card this way or you control a Dragon."
 *   CR 702.181a, 107.3         "Equipped creature has menace and mobilize X, where X is its power."
 *   CR 701.21a, 608.2d, 701.8a "{T}, Sacrifice ~ and a legendary artifact: Choose up to two creatures, then destroy the rest."
 *   CR 101.4, 608.2d, 608.2c   "starting with you, each player may choose an artifact or enchantment you don't control. Destroy each permanent chosen this way."
 *   CR 608.2c, 109.2, 701.21a  "Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another permanent card from your graveyard to the battlefield."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; supertypes?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const named = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'hand', p?: PlayerId): ObjectId[] => (zone === 'battlefield' ? findAll(s, name, 'battlefield', p) : findAll(s, name, zone, p ?? 'p1'));
const plusCounters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;
const minusCounters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['-1/-1'] ?? 0;

interface Driver { yes?: boolean; pick?: (options: ObjectId[], s: GameState, who: PlayerId) => ObjectId[]; targets?: (ObjectId | PlayerId)[][]; seen?: { who: PlayerId; options: ObjectId[]; names: string[] }[]; yesNos?: string[] }
/** Answer every decision: yes/no by `yes`, objects by `pick` (default: the first allowed), targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Driver = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') { o.yesNos?.push(p.prompt); s = answer(s, { kind: 'yesNo', yes: o.yes ?? true }); }
    else if (p.kind === 'chooseObjects') { o.seen?.push({ who: p.player, options: [...p.options], names: p.options.map((id) => chars(s, id).name) }); s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s, p.player) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) }); }
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Driver = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const BRUTE = card('Test Brute', 'Creature — Giant', '', { pt: ['3', '3'] });
const IMP = card('Test Imp', 'Creature — Imp', '', { pt: ['1', '1'] });
const RELIC = card('Test Relic', 'Artifact', '');
const IDOL = card('Test Idol', 'Enchantment', '');
const FIELD = card('Test Field', 'Land', '');

// ---- Phelia ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.7c, 400.7, 608.2c: "Whenever this creature attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner\'s control. If it entered under your control, put a +1/+1 counter on this creature."', () => {
  const SHEPHERD = card('Test Shepherd', 'Creature — Dog', "Whenever this creature attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on this creature.", { pt: ['2', '2'] });
  const defs = [SHEPHERD, BEAR, RELIC];
  const attackAndEnd = (s0: GameState, targets: (ObjectId | PlayerId)[][]): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Shepherd', 'battlefield', 'p1')]]);
    s = resolveAll(s, { targets });
    return toStep(s, 'end');
  };
  const start = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Shepherd', 'Test Bear'] }, p2: { battlefield: ['Test Relic'] } });
  it('is fully automated', () => expect(full(SHEPHERD)).toBe(true));
  it('your own permanent exiled by it comes back at the end step under your control and the Shepherd gets a +1/+1 counter', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Shepherd', 'battlefield', 'p1')]]);
    s = resolveAll(s, { targets: [[bear]] });
    expect(named(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0); // exiled now
    expect(s.zones.exile.some((id) => chars(s, id).name === 'Test Bear')).toBe(true);
    s = toStep(s, 'end');
    s = resolveAll(s);
    expect(named(s, 'Test Bear', 'battlefield', 'p1').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Shepherd', 'battlefield', 'p1'))).toBe(1);
  });
  it('the negative case: an opponent\'s permanent exiled by it comes back under its owner\'s control and the Shepherd gets no counter', () => {
    const s0 = start();
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    let s = attackAndEnd(s0, [[relic]]);
    s = resolveAll(s);
    expect(named(s, 'Test Relic', 'battlefield', 'p2').length).toBe(1);
    expect(named(s, 'Test Relic', 'battlefield', 'p1').length).toBe(0);
    expect(plusCounters(s, find(s, 'Test Shepherd', 'battlefield', 'p1'))).toBe(0);
  });
  it('"up to one": with no target nothing is exiled and no counter is put', () => {
    const s0 = start();
    let s = attackAndEnd(s0, [[]]);
    s = resolveAll(s);
    expect(named(s, 'Test Bear', 'battlefield', 'p1').length).toBe(1);
    expect(named(s, 'Test Relic', 'battlefield', 'p2').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Shepherd', 'battlefield', 'p1'))).toBe(0);
  });
  it('the counter is put when the card returns (at the end step), not when it is exiled', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Shepherd', 'battlefield', 'p1')]]);
    s = resolveAll(s, { targets: [[bear]] });
    expect(plusCounters(s, find(s, 'Test Shepherd', 'battlefield', 'p1'))).toBe(0);
  });
});

// ---- Persistent Constrictor ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 122.1, 608.2c: "At the beginning of each opponent\'s upkeep, they lose 1 life and you put a -1/-1 counter on up to one target creature they control."', () => {
  const SNAKE = card('Test Snake', 'Creature — Snake', "At the beginning of each opponent's upkeep, they lose 1 life and you put a -1/-1 counter on up to one target creature they control.", { pt: ['3', '3'] });
  const defs = [SNAKE, BEAR, BRUTE];
  const upkeepOf = (s0: GameState, turn: number): GameState => advanceTo(s0, turn, 'upkeep');
  it('is fully automated', () => expect(full(SNAKE)).toBe(true));
  it('on the opponent\'s upkeep they lose 1 life and a creature they control gets a -1/-1 counter', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Snake', 'Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const life = s0.players.find((p) => p.id === 'p2')!.life;
    const s = resolveAll(upkeepOf(s0, 2), { targets: [[brute]] });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life - 1);
    expect(minusCounters(s, brute)).toBe(1);
  });
  it('the negative case: your own creature is not a legal target (they control), and "up to one" lets you choose none', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Snake', 'Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const s1 = upkeepOf(s0, 2);
    // the engine's own target choice offers only creatures the opponent controls
    expect(s1.pending?.kind).toBe('chooseTargets');
    const options = JSON.stringify(s1.pending);
    expect(options.includes(bear)).toBe(false);
    expect(options.includes(brute)).toBe(true);
    const s = resolveAll(s1, { targets: [[]] });
    expect(minusCounters(s, brute)).toBe(0);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBeLessThan(40);
  });
  it('it does not happen on your own upkeep', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Snake', 'Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    const life = s0.players.find((p) => p.id === 'p1')!.life;
    const s = upkeepOf(resolveAll(upkeepOf(s0, 2), { targets: [[]] }), 3); // (the opponent's upkeep on turn 2 first)
    expect(s.pending?.kind).toBe('priority'); // nothing to target on your own upkeep: no ability was put on the stack
    expect(s.zones.stack.length).toBe(0);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life);
    expect(minusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
});

// ---- Temple of the Dragon Queen -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 614.1c, 614.12, 701.20a: "As this land enters, you may reveal a Dragon card from your hand. This land enters tapped unless you revealed a Dragon card this way or you control a Dragon."', () => {
  const HAVEN = card('Test Haven', 'Land', 'As this land enters, you may reveal a Dragon card from your hand. This land enters tapped unless you revealed a Dragon card this way or you control a Dragon.');
  const WYRM = card('Test Wyrm', 'Creature — Dragon', '', { pt: ['4', '4'], cost: '{4}' });
  const defs = [HAVEN, WYRM, BEAR];
  const play = (s0: GameState, o: Driver = {}): GameState => resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Haven', 'hand', 'p1') }), o);
  const tappedHaven = (s: GameState): boolean => s.objects[find(s, 'Test Haven', 'battlefield', 'p1')]!.tapped;
  it('is fully automated', () => expect(full(HAVEN)).toBe(true));
  it('revealing a Dragon card from your hand: the land enters untapped (and the Dragon stays in your hand)', () => {
    const s = play(scenario([], { defs, p1: { hand: ['Test Haven', 'Test Wyrm'] } }));
    expect(tappedHaven(s)).toBe(false);
    expect(named(s, 'Test Wyrm', 'hand', 'p1').length).toBe(1);
  });
  it('declining to reveal: the land enters tapped even with a Dragon card in your hand', () => {
    const s = play(scenario([], { defs, p1: { hand: ['Test Haven', 'Test Wyrm'] } }), { yes: false });
    expect(tappedHaven(s)).toBe(true);
  });
  it('the negative case: no Dragon card in your hand and no Dragon you control: tapped (nothing is offered)', () => {
    const asked: string[] = [];
    const s = play(scenario([], { defs, p1: { hand: ['Test Haven', 'Test Bear'], battlefield: ['Test Bear'] } }), { yesNos: asked });
    expect(tappedHaven(s)).toBe(true);
    expect(asked).toEqual([]);
  });
  it('a Dragon you control: untapped without revealing (a Dragon of an opponent does not count)', () => {
    const asked: string[] = [];
    const s = play(scenario([], { defs, p1: { hand: ['Test Haven'], battlefield: ['Test Wyrm'] } }), { yesNos: asked });
    expect(tappedHaven(s)).toBe(false);
    expect(asked).toEqual([]);
    const theirs = play(scenario([], { defs, p1: { hand: ['Test Haven'] }, p2: { battlefield: ['Test Wyrm'] } }));
    expect(tappedHaven(theirs)).toBe(true);
  });
});

// ---- Infantry Shield -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.181a, 107.3, 208.1: "Equipped creature has menace and mobilize X, where X is its power."', () => {
  const SHIELD = card('Test Shield', 'Artifact — Equipment', 'Equipped creature has menace and mobilize X, where X is its power.\nEquip {2}');
  const defs = [SHIELD, BEAR, BRUTE, IMP];
  const attach = (s: GameState, to: ObjectId): void => { s.objects[find(s, 'Test Shield', 'battlefield', 'p1')]!.attachedTo = to; };
  const warriors = (s: GameState): number => named(s, 'Warrior Token', 'battlefield', 'p1').length || s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && chars(s, id).subtypes.includes('Warrior')).length;
  const attackWith = (s0: GameState, ids: ObjectId[]): GameState => resolveAll(declareAttackers(toDeclareAttackers(s0), ids.map((id) => [id] as [ObjectId])));
  it('is fully automated', () => expect(full(SHIELD)).toBe(true));
  it('a 3/3 equipped creature that attacks creates three tapped and attacking Warriors', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Shield', 'Test Brute'] } });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    attach(s0, brute);
    const s = attackWith(s0, [brute]);
    expect(warriors(s)).toBe(3);
    const tokens = s.zones.battlefield.filter((id) => chars(s, id).subtypes.includes('Warrior'));
    expect(tokens.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('the amount is the power of the creature that has it: the 1/1 makes one, the unequipped 2/2 none', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Shield', 'Test Imp', 'Test Bear'] } });
    attach(s0, find(s0, 'Test Imp', 'battlefield', 'p1'));
    const s = attackWith(s0, [find(s0, 'Test Imp', 'battlefield', 'p1'), find(s0, 'Test Bear', 'battlefield', 'p1')]);
    expect(warriors(s)).toBe(1);
  });
  it('the negative case: an unequipped creature gets no Warriors', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Shield', 'Test Brute'] } });
    const s = attackWith(s0, [find(s0, 'Test Brute', 'battlefield', 'p1')]);
    expect(warriors(s)).toBe(0);
  });
});

// ---- Mount Doom ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a, 608.2d, 701.8a: "{T}, Sacrifice ~ and a legendary artifact: Choose up to two creatures, then destroy the rest. Activate only as a sorcery."', () => {
  const PEAK = card('Test Peak', 'Legendary Land', '{T}, Sacrifice ~ and a legendary artifact: Choose up to two creatures, then destroy the rest. Activate only as a sorcery.');
  const CROWN = card('Test Crown', 'Legendary Artifact', '');
  const defs = [PEAK, CROWN, RELIC, BEAR, BRUTE, IMP];
  const field = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Peak', 'Test Crown', 'Test Relic', 'Test Brute', 'Test Imp'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
  /** The ability of the Peak: the engine's own list of legal actions says its id. */
  const activate = (s0: GameState, keep: (name: string) => boolean): GameState => {
    const peak = find(s0, 'Test Peak', 'battlefield', 'p1');
    const la = legal(s0, 'p1', 'activate').find((l) => l.object === peak);
    expect(la, 'the Peak has an activated ability to activate').toBeDefined();
    const s1 = act(s0, la!.action);
    return resolveAll(s1, { pick: (opts, st) => { const creatures = opts.filter((x) => chars(st, x).types.includes('Creature')); return creatures.length === 0 ? opts.slice(0, 1) : creatures.filter((x) => keep(chars(st, x).name)).slice(0, 2); } });
  };
  it('is fully automated', () => expect(full(PEAK)).toBe(true));
  it('you choose two creatures (any controller) to keep and every other creature is destroyed; the Peak and the legendary artifact are sacrificed as the cost', () => {
    const s = activate(field(), (n) => n === 'Test Brute');
    expect(named(s, 'Test Brute', 'battlefield', 'p1').length).toBe(1);
    expect(named(s, 'Test Imp', 'battlefield', 'p1').length).toBe(0);
    expect(named(s, 'Test Bear', 'battlefield', 'p2').length).toBe(0); // both of the opponent's Bears are destroyed (only the Brute was chosen)
    expect(named(s, 'Test Peak', 'battlefield', 'p1').length).toBe(0);
    expect(named(s, 'Test Crown', 'battlefield', 'p1').length).toBe(0);
    expect(named(s, 'Test Relic', 'battlefield', 'p1').length).toBe(1); // only creatures are destroyed
  });
  it('at most two are kept: the choice may include an opponent\'s creature and a creature of yours', () => {
    const s = activate(field(), (n) => n === 'Test Bear' || n === 'Test Imp');
    expect(named(s, 'Test Bear', 'battlefield', 'p2').length).toBe(1);
    expect(named(s, 'Test Imp', 'battlefield', 'p1').length).toBe(1);
    expect(named(s, 'Test Brute', 'battlefield', 'p1').length).toBe(0);
  });
  it('"up to": choosing none destroys every creature', () => {
    const s = activate(field(), () => false);
    expect(s.zones.battlefield.filter((id) => chars(s, id).types.includes('Creature')).length).toBe(0);
  });
  it('the negative case: without a legendary artifact the ability cannot be paid', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Peak', 'Test Relic', 'Test Brute'] } });
    const peak = find(s0, 'Test Peak', 'battlefield', 'p1');
    const can = legal(s0, 'p1', 'activate').some((l) => l.object === peak);
    expect(can).toBe(false);
  });
});

// ---- Druid of Purification --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 608.2d, 608.2c: "When this creature enters, starting with you, each player may choose an artifact or enchantment you don\'t control. Destroy each permanent chosen this way."', () => {
  const DRUID = card('Test Purifier', 'Creature — Druid', "When this creature enters, starting with you, each player may choose an artifact or enchantment you don't control. Destroy each permanent chosen this way.", { pt: ['2', '2'] });
  const defs = [DRUID, RELIC, IDOL, BEAR];
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Purifier'], battlefield: ['Test Relic', 'Test Idol'] }, p2: { battlefield: ['Test Relic', 'Test Idol', 'Test Bear'] } });
  const cast = (s0: GameState, o: Driver): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Purifier', 'hand', 'p1') }), o);
  const pickNamed = (who: PlayerId, name: string) => (opts: ObjectId[], st: GameState, by: PlayerId): ObjectId[] => (by === who ? opts.filter((id) => chars(st, id).name === name).slice(0, 1) : []);
  it('is fully automated', () => expect(full(DRUID)).toBe(true));
  it('you choose first, then the opponent: every permanent chosen (by either player) is destroyed, and only permanents you do not control are offered', () => {
    const seen: { who: PlayerId; options: ObjectId[]; names: string[] }[] = [];
    const s0 = start();
    const s = cast(s0, { seen, pick: (opts, st, by) => (by === 'p1' ? opts.filter((id) => chars(st, id).name === 'Test Relic').slice(0, 1) : opts.filter((id) => chars(st, id).name === 'Test Idol').slice(0, 1)) });
    expect(seen.map((x) => x.who)).toEqual(['p1', 'p2']); // starting with you
    for (const x of seen) for (const id of x.options) expect(s0.objects[id]!.controller).toBe('p2'); // "you don't control": none of your own
    expect(named(s, 'Test Relic', 'battlefield', 'p2').length).toBe(0);
    expect(named(s, 'Test Idol', 'battlefield', 'p2').length).toBe(0);
    expect(named(s, 'Test Relic', 'battlefield', 'p1').length).toBe(1); // yours are safe
    expect(named(s, 'Test Idol', 'battlefield', 'p1').length).toBe(1);
    expect(named(s, 'Test Bear', 'battlefield', 'p2').length).toBe(1); // only artifacts and enchantments
  });
  it('"may": a player who chooses nothing destroys nothing; only the other player\'s choice is destroyed', () => {
    const s = cast(start(), { pick: pickNamed('p1', 'Test Relic') });
    expect(named(s, 'Test Relic', 'battlefield', 'p2').length).toBe(0);
    expect(named(s, 'Test Idol', 'battlefield', 'p2').length).toBe(1);
  });
  it('the negative case: nobody chooses: nothing is destroyed', () => {
    const s = cast(start(), { pick: () => [] });
    expect(named(s, 'Test Relic', 'battlefield', 'p2').length).toBe(1);
    expect(named(s, 'Test Idol', 'battlefield', 'p2').length).toBe(1);
  });
  it('the same permanent chosen by both players is destroyed once and the other stays', () => {
    const s = cast(start(), { pick: (opts, st) => opts.filter((id) => chars(st, id).name === 'Test Relic').slice(0, 1) });
    expect(named(s, 'Test Relic', 'battlefield', 'p2').length).toBe(0);
    expect(named(s, 'Test Idol', 'battlefield', 'p2').length).toBe(1);
  });
});

// ---- Rise of the Witch-king --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 109.2, 701.21a: "Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another permanent card from your graveyard to the battlefield."', () => {
  const RISE = card('Test Rise', 'Sorcery', 'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another permanent card from your graveyard to the battlefield.');
  const defs = [RISE, BEAR, BRUTE, RELIC, IDOL];
  const cast = (s0: GameState, o: Driver = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rise', 'hand', 'p1') }), o);
  it('is fully automated', () => expect(full(RISE)).toBe(true));
  it('the creature you sacrificed is not "another" card: you may return a different permanent card, and the one you sacrificed is never offered', () => {
    const seen: { who: PlayerId; options: ObjectId[]; names: string[] }[] = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Rise'], battlefield: ['Test Bear'], graveyard: ['Test Relic', 'Test Idol'] }, p2: { battlefield: ['Test Brute'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, { seen, pick: (opts, st) => opts.filter((id) => chars(st, id).name === 'Test Relic').slice(0, 1).concat(opts.length === 1 ? opts : []).slice(0, 1) });
    const offered = seen.filter((x) => x.who === 'p1').flatMap((x) => x.names);
    expect(offered).toContain('Test Relic');
    expect(offered).toContain('Test Idol');
    expect(offered).not.toContain('Test Bear'); // the sacrificed Bear is in the graveyard too, and is not another card
    void bear;
    expect(named(s, 'Test Relic', 'battlefield', 'p1').length).toBe(1);
    expect(named(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0);
    expect(named(s, 'Test Brute', 'battlefield', 'p2').length).toBe(0); // each player sacrifices
  });
  it('"may": declining returns nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Rise'], battlefield: ['Test Bear'], graveyard: ['Test Relic'] }, p2: { battlefield: ['Test Brute'] } });
    const s = cast(s0, { yes: false });
    expect(named(s, 'Test Relic', 'battlefield', 'p1').length).toBe(0);
  });
  it('the negative case: if you sacrificed no creature (you control none), you return nothing even if the opponent sacrificed one', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Rise'], graveyard: ['Test Relic'] }, p2: { battlefield: ['Test Brute'] } });
    const s = cast(s0);
    expect(named(s, 'Test Relic', 'battlefield', 'p1').length).toBe(0);
    expect(named(s, 'Test Brute', 'battlefield', 'p2').length).toBe(0);
  });
});
