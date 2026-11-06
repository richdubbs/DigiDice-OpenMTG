/**
 * Round edh-next-147 (must-finish round, group "other", EDHREC 5,001-10,000): the behaviour it added, played through the engine with synthetic cards (invented names, the
 * printed wordings of the real cards), compiled by the game's default compiler, in four-player games.
 *
 *   CR 101.4, 102.2, 608.2d   Sadistic Shell Game: "Starting with the next opponent in turn order, each player chooses a creature you don't control. Destroy the chosen
 *                             creatures." (ruling 2024-09-20: each player knows what the players earlier in the turn order chose)
 *   CR 601.2b, 602.2b, 118.3, Crystal Shard: "{3}, {T} or {U}, {T}: Return target creature to its owner's hand unless its controller pays {1}." (ruling 2004-10-04: either of
 *   601.2f, 118.12a           the two costs, not both); a cost change applies to the cost chosen (CR 601.2f)
 *   CR 123.2a-c, 123.3,       _____ Goblin: "When this creature enters, you may put a name sticker on it. Add {R} for each unique vowel on that sticker." The sticker sheets of a
 *   123.3a-b, 123.5, 123.6,   player (three chosen at random of ten or more), a sticker on no object its owner owns, the place of its words in the name, the name kept in a
 *   123.6a-c, 123.6e          public zone and lost in a hidden one, the unique vowels (A, E, I, O, U, Y)
 *   CR 611.3a, 613.1f, 700.8, Multiclass Baldric: "Equipped creature has lifelink if you control a Cleric, deathtouch if you control a Rogue, haste if you control a Warrior,
 *   615.1                     and flying if you control a Wizard. As long as you have a full party, prevent all damage that would be dealt to equipped creature."
 *   CR 601.2d, 120.3, 608.2c, Aurelia's Fury: "~ deals X damage divided as you choose among any number of targets. Tap each creature dealt damage this way. Players dealt damage
 *   611.2a, 601.1             this way can't cast noncreature spells this turn." (rulings 2013-01-24: each target gets at least 1; illegal targets get none of it)
 *   CR 205.1b, 305.6, 302.6,  Life and Limb: "All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types." (rulings
 *   613.1d-e, 613.4b          2021-03-19: both types and subtypes, "{T}: Add {G}", summoning sickness, enters-the-battlefield triggers of both kinds)
 *   CR 700.8, 608.2d-e,       Stick Together: "Each player chooses a party from among creatures they control, then sacrifices the rest." (a party: up to one each of Cleric,
 *   701.21a, 101.4            Rogue, Warrior and Wizard; one creature fills one place)
 *   CR 118.12a, 118.3,        Phyrexian Dreadnought: "When this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater." (rulings:
 *   701.21a, 208.1            unable to sacrifice 12 power, it is sacrificed; the sacrifices are simultaneous; either option even once it has left)
 *   CR 601.2i, 603.2, 603.4,  Sentinel Tower: "Whenever an instant or sorcery spell is cast during your turn, this artifact deals damage to any target equal to 1 plus the number
 *   702.40a                   of instant and sorcery spells cast before that spell this turn." (rulings 2018-06-08: 1, then 2, ...; anyone's spells; counted before the triggering
 *                             spell, a spell cast in response is not; the trigger resolves first)
 */
import { describe, expect, it } from 'vitest';
import { createGame, getChars, type DecisionAnswer, type TargetChoice, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { mpConfig, passUntil } from '../../m12/rules/helpers';
import { stickeredName, uniqueVowels } from '../../../src/statics/stickers';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { activatedAbilities } from '../../../src/rules/abilities';

const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  yes?: (prompt: string, who: PlayerId) => boolean;
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId, max: number, min: number) => ObjectId[];
  option?: (options: { id: string; label: string }[], prompt: string) => string;
  until?: (state: GameState) => boolean;
  /** The whole answer of the first target announcement (several targets, players too). */
  choice?: TargetChoice[];
  /** The value of X, and the division of an amount among the targets. */
  number?: number;
  division?: number[];
  /** Every decision seen: who was asked, its kind and its options. */
  seen?: { who: PlayerId; kind: string; options: string[]; min?: number; max?: number }[];
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 400; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId; options?: unknown[] };
    if (p.kind !== 'priority') sc.seen?.push({ who: d.player, kind: p.kind, options: (d.options ?? []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))), ...(d.min !== undefined ? { min: d.min } : {}), ...(d.max !== undefined ? { max: d.max } : {}) });
    if (p.kind === 'chooseTargets' && sc.choice !== undefined) { a = { kind: 'chooseTargets', targets: sc.choice }; delete sc.choice; }
    else if (p.kind === 'chooseDivision') a = { kind: 'chooseDivision', amounts: sc.division ?? [] } as DecisionAnswer;
    else if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt, d.player) : true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player, d.max ?? o.length, d.min ?? 0) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      a = { kind: 'chooseOption', ids: [sc.option ? sc.option(o, d.prompt) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: sc.number ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}

describe('CR 101.4, 102.2, 608.2d: Sadistic Shell Game ("Starting with the next opponent in turn order, each player chooses a creature you don\'t control. Destroy the chosen creatures.")', () => {
  const GAME = card('Test Cruel Cups', 'Sorcery', "Starting with the next opponent in turn order, each player chooses a creature you don't control. Destroy the chosen creatures.");
  const BEAR = card('Test Cup Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [GAME, BEAR];
  const setup = (p1Bears = 1): GameState => mpScenario({
    defs,
    zones: { p1: { hand: ['Test Cruel Cups'], battlefield: Array(p1Bears).fill('Test Cup Bear') }, p2: { battlefield: ['Test Cup Bear', 'Test Cup Bear'] }, p3: { battlefield: ['Test Cup Bear'] }, p4: { battlefield: ['Test Cup Bear'] } },
  });
  const cast = (s: GameState, sc: Script): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Cruel Cups', 'hand', 'p1') }), sc);

  it('compiles full: each player in turn order from the next player, exactly one creature the caster does not control, then destroy them', () => {
    expect(full(GAME)).toBe(true);
    const steps = (GAME.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps.map((x) => x['op'])).toEqual(['chooseObjects', 'destroy']);
    expect(steps[0]).toMatchObject({ who: { ref: 'each', who: 'player' }, startingWith: { ref: 'seat', side: 'left' }, min: 1, max: 1 });
  });

  it('CR 101.4: p2, p3, p4 and then the caster choose, in that order; the caster\'s own creatures are never offered; each sees the earlier choices; the chosen are destroyed', () => {
    const s0 = setup();
    const mine = bf(s0, 'Test Cup Bear', 'p1');
    const p2s = bf(s0, 'Test Cup Bear', 'p2');
    const p3 = bf(s0, 'Test Cup Bear', 'p3')[0]!;
    const p4 = bf(s0, 'Test Cup Bear', 'p4')[0]!;
    const seen: NonNullable<Script['seen']> = [];
    // p2 picks p3's bear, p3 picks p4's, p4 picks p2's first, p1 picks p3's again (already chosen: destroyed once)
    const pick: Record<string, ObjectId> = { p2: p3, p3: p4, p4: p2s[0]!, p1: p3 };
    const s = cast(s0, { seen, objects: (o, _pr, _s, who) => { expect(o).toContain(pick[who]); return [pick[who]!]; } });
    const asked = seen.filter((x) => x.kind === 'chooseObjects');
    expect(asked.map((x) => x.who)).toEqual(['p2', 'p3', 'p4', 'p1']);
    for (const q of asked) { expect(q.options.some((id) => mine.includes(id))).toBe(false); expect(q).toMatchObject({ min: 1, max: 1 }); }
    expect(s.zones.battlefield).not.toContain(p3);
    expect(s.zones.battlefield).not.toContain(p4);
    expect(s.zones.battlefield).not.toContain(p2s[0]);
    expect(s.zones.battlefield).toContain(p2s[1]);
    expect(s.zones.battlefield).toContain(mine[0]);
  });

  it('CR 608.2d negative: a player must choose one when able (not zero); with only the caster\'s creatures on the battlefield nobody is asked and nothing is destroyed', () => {
    const only = mpScenario({ defs, zones: { p1: { hand: ['Test Cruel Cups'], battlefield: ['Test Cup Bear', 'Test Cup Bear'] } } });
    const seen: NonNullable<Script['seen']> = [];
    const s = run(mact(only, { type: 'cast', player: 'p1', card: mfind(only, 'Test Cruel Cups', 'hand', 'p1') }), { seen });
    expect(seen.filter((x) => x.kind === 'chooseObjects')).toEqual([]);
    expect(bf(s, 'Test Cup Bear', 'p1').length).toBe(2);
  });
});

describe('CR 601.2b, 602.2b, 118.3: Crystal Shard ("{3}, {T} or {U}, {T}: Return target creature to its owner\'s hand unless its controller pays {1}.")', () => {
  const SHARD = card('Test Lens Shard', 'Artifact', "{3}, {T} or {U}, {T}: Return target creature to its owner's hand unless its controller pays {1}.");
  const BEAR = card('Test Shard Bear', 'Creature — Bear', '', ['2', '2']);
  const TAX = card('Test Shard Tax', 'Artifact', "Activated abilities cost {2} more to activate unless they're mana abilities.");
  const defs = [SHARD, BEAR, TAX];
  const game = (lands: string[], extra: string[] = [], p2Lands: string[] = []): GameState => mpScenario({ defs, cards: ['Island', 'Plains'], zones: { p1: { battlefield: ['Test Lens Shard', ...lands, ...extra] }, p2: { battlefield: ['Test Shard Bear', ...p2Lands] } } });
  const activate = (s0: GameState, sc: Script): GameState => {
    const shard = bf(s0, 'Test Lens Shard')[0]!;
    return run(mact(s0, { type: 'activate', player: 'p1', source: shard, ability: activatedAbilities(s0, s0.objects[shard]!)[0]!.key } as never), { targets: [bf(s0, 'Test Shard Bear')[0]!], ...sc });
  };
  const untappedLands = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && /Island|Plains/.test(nameOf(s, id)) && !s.objects[id]!.tapped).length;
  const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;

  it('compiles full: one ability whose cost is a choice between two whole costs ({3} and {T}, or {U} and {T})', () => {
    expect(full(SHARD)).toBe(true);
    expect(full(TAX)).toBe(true);
    const ab = SHARD.faces[0]!.abilities[0] as unknown as { cost: { other: { kind: string; options: { mana: unknown[]; tap: boolean }[] }[] } };
    expect(SHARD.faces[0]!.abilities.length).toBe(1);
    expect(ab.cost.other.length).toBe(1);
    expect(ab.cost.other[0]!.kind).toBe('oneOf');
    expect(ab.cost.other[0]!.options.map((o) => [o.mana.length > 0, o.tap])).toEqual([[true, true], [true, true]]);
  });

  it('CR 601.2b: the controller chooses either cost; {U}, {T} taps one Island and the creature returns when its controller does not pay', () => {
    const s0 = game(['Island', 'Plains', 'Plains', 'Plains']);
    const seen: NonNullable<Script['seen']> = [];
    const s = activate(s0, { seen, option: (o) => o.find((x) => /\{U\}/.test(x.label))!.id, yes: () => false });
    expect(seen.some((x) => x.kind === 'chooseOption' && x.who === 'p1')).toBe(true);
    expect(s.objects[bf(s0, 'Test Lens Shard')[0]!]!.tapped).toBe(true);
    expect(untappedLands(s)).toBe(3);
    expect(bf(s, 'Test Shard Bear').length).toBe(0);
    expect((s.zones.hand['p2'] ?? []).some((id) => nameOf(s, id) === 'Test Shard Bear')).toBe(true);
  });

  it('CR 601.2b: {3}, {T} pays three mana (never both costs: four lands, three tapped)', () => {
    const s0 = game(['Island', 'Plains', 'Plains', 'Plains']);
    const s = activate(s0, { option: (o) => o.find((x) => /\{3\}/.test(x.label))!.id, yes: () => false });
    expect(untappedLands(s)).toBe(1);
    expect(bf(s, 'Test Shard Bear').length).toBe(0);
  });

  it('CR 118.3 negative: with no Island only {3}, {T} can be paid (no choice offered); with neither, the ability can\'t be activated', () => {
    const s0 = game(['Plains', 'Plains', 'Plains']);
    const seen: NonNullable<Script['seen']> = [];
    const s = activate(s0, { seen, yes: () => false });
    expect(seen.some((x) => x.kind === 'chooseOption')).toBe(false);
    expect(untappedLands(s)).toBe(0);
    expect(bf(s, 'Test Shard Bear').length).toBe(0);
    const poor = game(['Plains', 'Plains']);
    const shard = bf(poor, 'Test Lens Shard')[0]!;
    expect(() => mact(poor, { type: 'activate', player: 'p1', source: shard, ability: activatedAbilities(poor, poor.objects[shard]!)[0]!.key } as never)).toThrow();
  });

  it('CR 118.12a: the creature stays when its controller pays {1}', () => {
    const s0 = game(['Island'], [], ['Plains']);
    const s = activate(s0, { yes: () => true });
    expect(bf(s, 'Test Shard Bear').length).toBe(1);
  });

  it('CR 601.2f: a cost reduction applies to the cost chosen too: {3} less {1} is {2} (two Plains pay it, no Island needed)', () => {
    const CUT = card('Test Shard Cut', 'Artifact', 'Activated abilities of artifacts you control cost {1} less to activate.');
    expect(full(CUT)).toBe(true);
    const s0 = mpScenario({ defs: [...defs, CUT], cards: ['Plains'], zones: { p1: { battlefield: ['Test Lens Shard', 'Plains', 'Plains', 'Test Shard Cut'] }, p2: { battlefield: ['Test Shard Bear'] } } });
    const s = activate(s0, { yes: () => false });
    expect(untappedLands(s)).toBe(0);
    expect(bf(s, 'Test Shard Bear').length).toBe(0);
  });

  it('CR 601.2f: a cost increase applies to the cost chosen: {U}{2}, {T} with three lands (an Island and two Plains), {3}{2} unpayable then', () => {
    const s0 = game(['Island', 'Plains', 'Plains'], ['Test Shard Tax']);
    const seen: NonNullable<Script['seen']> = [];
    const s = activate(s0, { seen, yes: () => false });
    expect(seen.some((x) => x.kind === 'chooseOption')).toBe(false); // only {U}{2} can be paid
    expect(untappedLands(s)).toBe(0);
    expect(bf(s, 'Test Shard Bear').length).toBe(0);
    const short = game(['Island', 'Plains'], ['Test Shard Tax']);
    const shard = bf(short, 'Test Lens Shard')[0]!;
    expect(() => mact(short, { type: 'activate', player: 'p1', source: shard, ability: activatedAbilities(short, short.objects[shard]!)[0]!.key } as never)).toThrow();
  });
});

describe('CR 123.3, 123.6, 123.6e: _____ Goblin ("you may put a name sticker on it. Add {R} for each unique vowel on that sticker.")', () => {
  const GOB = card('_____ Test Imp', 'Creature — Goblin Guest', 'When this creature enters, you may put a name sticker on it. Add {R} for each unique vowel on that sticker.', ['2', '2']);
  const ROD = card('Test Sticker Rod', 'Artifact', '{T}: Put a name sticker on target creature.');
  const defs = [GOB, ROD];
  const STICKERS = [{ id: 's1', text: 'Hot Dog' }, { id: 's2', text: 'Ancestral' }, { id: 's3', text: 'Queueing' }];
  const game = (stickers = STICKERS, extra: Partial<Record<PlayerId, { battlefield?: string[]; hand?: string[] }>> = {}): GameState => mpScenario({
    defs, zones: { p1: { hand: ['_____ Test Imp', '_____ Test Imp'], battlefield: extra.p1?.battlefield ?? [] }, p2: { battlefield: extra.p2?.battlefield ?? [] } },
    setup: (x) => { if (stickers.length > 0) x.players[0]!.stickers = stickers.map((y) => ({ ...y })); },
  });
  const castImp = (s: GameState, sc: Script): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, '_____ Test Imp', 'hand', 'p1') }), sc);
  const red = (s: GameState): number => s.players[0]!.manaPool.filter((m) => m.type === 'R').length;
  const imps = (s: GameState): ObjectId[] => bf(s, '_____ Test Imp');

  it('compiles full: a "may" around putSticker on the creature itself, then {R} for each unique vowel; the rod targets', () => {
    expect(full(GOB)).toBe(true);
    expect(full(ROD)).toBe(true);
    const steps = (GOB.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'may', do: [{ op: 'putSticker', who: { ref: 'you' }, on: { ref: 'self' }, sticker: 'name' }] });
    expect(steps[1]).toMatchObject({ op: 'addMana', dynamic: { kind: 'ofType', type: 'R', count: { q: 'stickerVowels' } } });
  });

  it('CR 123.6a-e: unique vowels count A, E, I, O, U and Y once each, either case; a blank line is not a word', () => {
    expect(uniqueVowels('Hot Dog')).toBe(1);
    expect(uniqueVowels('Ancestral')).toBe(2);
    expect(uniqueVowels('Queueing')).toBe(3);
    expect(uniqueVowels('Rhythm')).toBe(1);
    expect(uniqueVowels('BOUNCY')).toBe(3);
    expect(stickeredName('_____ Goblin', 'Hot Dog', 0)).toBe('Hot Dog _____ Goblin');
    expect(stickeredName('_____ Goblin', 'Hot Dog', 1)).toBe('_____ Goblin Hot Dog');
    expect(stickeredName('Grizzly Bears', 'Ancestral', 1)).toBe('Grizzly Ancestral Bears');
    expect(stickeredName('Grizzly Bears', 'Ancestral', 5)).toBe('Grizzly Bears Ancestral'); // fewer words now: at the end (CR 123.6c)
    expect(stickeredName('', 'Ancestral', 0)).toBe('Ancestral'); // no name: the sticker's words (CR 123.6b)
  });

  it('CR 123.3, 123.6b, 123.6e: the controller picks a sticker and where it goes; the creature is renamed and {R}{R} is added for "Ancestral"', () => {
    const seen: NonNullable<Script['seen']> = [];
    const s = castImp(game(), { seen, option: (o, pr) => (/name sticker/.test(pr) ? o.find((x) => x.label.startsWith('Ancestral'))!.id : o.find((x) => x.label.startsWith('Ancestral'))!.id) });
    const opts = seen.filter((x) => x.kind === 'chooseOption');
    expect(opts.length).toBe(2); // the sticker, then the place in the name
    expect(opts[0]!.options.length).toBe(3);
    const imp = imps(s)[0]!;
    expect(getChars(s, imp).name).toBe('Ancestral _____ Test Imp');
    expect(s.objects[imp]!.nameStickers?.map((x) => x.id)).toEqual(['s2']);
    expect(red(s)).toBe(2);
  });

  it('CR 608.2d negative: declining puts no sticker and adds no mana; a player without stickers puts none and adds none', () => {
    const declined = castImp(game(), { yes: () => false });
    expect(declined.objects[imps(declined)[0]!]!.nameStickers).toBeUndefined();
    expect(getChars(declined, imps(declined)[0]!).name).toBe('_____ Test Imp');
    expect(red(declined)).toBe(0);
    const none = castImp(game([]), {});
    expect(none.objects[imps(none)[0]!]!.nameStickers).toBeUndefined();
    expect(red(none)).toBe(0);
  });

  it('CR 123.3: a sticker already on an object its player owns is not offered again; with one left it is put without a choice', () => {
    const two = [{ id: 's1', text: 'Hot Dog' }, { id: 's3', text: 'Queueing' }];
    let s = castImp(game(two), { option: (o) => o.find((x) => x.label.startsWith('Queueing'))?.id ?? o[0]!.id });
    expect(red(s)).toBe(3);
    s = { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, manaPool: [] } : p)) };
    const seen: NonNullable<Script['seen']> = [];
    s = castImp(s, { seen, option: (o) => o[0]!.id });
    const second = imps(s).find((id) => s.objects[id]!.nameStickers?.[0]?.id === 's1');
    expect(second).toBeDefined();
    expect(seen.filter((x) => x.kind === 'chooseOption' && x.options.some((o) => o.includes('Queueing'))).length).toBe(0);
    expect(red(s)).toBe(1); // "Hot Dog": O
  });

  it('CR 123.5: the sticker stays as the creature dies (its graveyard card keeps the name) and is gone once the card goes to a hand', () => {
    const KILL = card('Test Sticker Doom', 'Instant', 'Destroy target creature.');
    const BACK = card('Test Sticker Return', 'Instant', 'Return target creature card from your graveyard to your hand.');
    const s0 = mpScenario({ defs: [GOB, KILL, BACK], zones: { p1: { hand: ['_____ Test Imp', 'Test Sticker Doom', 'Test Sticker Return'] } }, setup: (x) => { x.players[0]!.stickers = [{ id: 's2', text: 'Ancestral' }]; } });
    let s = castImp(s0, { option: (o) => o[o.length - 1]!.id });
    const imp = imps(s)[0]!;
    expect(getChars(s, imp).name).toBe('_____ Test Imp Ancestral');
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Sticker Doom', 'hand', 'p1') }), { targets: [imp] });
    const dead = s.zones.graveyard['p1']!.find((id) => s.objects[id]!.defId === GOB.id)!;
    expect(getChars(s, dead).name).toBe('_____ Test Imp Ancestral');
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Sticker Return', 'hand', 'p1') }), { targets: [dead] });
    const back = s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === GOB.id)!;
    expect(s.objects[back]!.nameStickers).toBeUndefined();
    expect(getChars(s, back).name).toBe('_____ Test Imp');
  });

  it('CR 123.3b: a sticker can\'t be put on an object its player doesn\'t own (the rod on an opponent\'s creature does nothing)', () => {
    const s0 = mpScenario({ defs: [GOB, ROD], zones: { p1: { battlefield: ['Test Sticker Rod', '_____ Test Imp'] }, p2: { battlefield: ['_____ Test Imp'] } }, setup: (x) => { x.players[0]!.stickers = STICKERS.map((y) => ({ ...y })); } });
    const rod = bf(s0, 'Test Sticker Rod')[0]!;
    const theirs = bf(s0, '_____ Test Imp', 'p2')[0]!;
    const mine = bf(s0, '_____ Test Imp', 'p1')[0]!;
    const use = (t: ObjectId): GameState => run(mact(s0, { type: 'activate', player: 'p1', source: rod, ability: activatedAbilities(s0, s0.objects[rod]!)[0]!.key } as never), { targets: [t], option: (o) => o[0]!.id });
    const a = use(theirs);
    expect(a.objects[theirs]!.nameStickers).toBeUndefined();
    expect(a.log.some((l) => /don't own/.test(l.text))).toBe(true);
    const b = use(mine);
    expect(b.objects[mine]!.nameStickers?.length).toBe(1);
  });

  it('CR 123.2a-c: a player\'s sticker sheets: three of ten or more chosen at random as the game begins (the same seed, the same three), three or fewer all used', () => {
    const sheets = Array.from({ length: 10 }, (_, i) => ({ name: `Sheet ${i}`, nameStickers: [`Word${i}a`, `Word${i}b`, `Word${i}c`] }));
    const cfg = (seed: string, list: typeof sheets) => { const c = mpConfig({ defs, seed }); c.players[0] = { ...c.players[0]!, stickerSheets: list }; return c; };
    const a = createGame(cfg('stick-1', sheets)).players[0]!.stickers!;
    const b = createGame(cfg('stick-1', sheets)).players[0]!.stickers!;
    expect(a.length).toBe(9);
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.id)).size).toBe(9);
    const picked = new Set(a.map((x) => x.text.replace(/[abc]$/, '')));
    expect(picked.size).toBe(3);
    const seeds = new Set(Array.from({ length: 8 }, (_, i) => createGame(cfg(`stick-${i}`, sheets)).players[0]!.stickers!.map((x) => x.text).join()));
    expect(seeds.size).toBeGreaterThan(1); // random, not always the first three
    expect(createGame(cfg('stick-1', sheets.slice(0, 2))).players[0]!.stickers!.length).toBe(6);
    expect(createGame(cfg('stick-1', [])).players[0]!.stickers).toBeUndefined();
    expect(createGame(mpConfig({ defs, seed: 'stick-1' })).players[1]!.stickers).toBeUndefined();
  });
});

describe('CR 611.3a, 613.1f, 700.8: Multiclass Baldric (each grant under its own condition; a full party prevents all damage to the equipped creature)', () => {
  const BALDRIC = card('Test Party Sash', 'Artifact — Equipment', 'Equipped creature has lifelink if you control a Cleric, deathtouch if you control a Rogue, haste if you control a Warrior, and flying if you control a Wizard.\nAs long as you have a full party, prevent all damage that would be dealt to equipped creature.\nEquip {2}');
  const BEAR = card('Test Sash Bear', 'Creature — Bear', '', ['2', '2']);
  const CLERIC = card('Test Sash Cleric', 'Creature — Human Cleric', '', ['1', '1']);
  const ROGUE = card('Test Sash Rogue', 'Creature — Human Rogue', '', ['1', '1']);
  const WARRIOR = card('Test Sash Warrior', 'Creature — Human Warrior', '', ['1', '1']);
  const WIZARD = card('Test Sash Wizard', 'Creature — Human Wizard', '', ['1', '1']);
  const BOLT = card('Test Sash Bolt', 'Instant', 'Test Sash Bolt deals 3 damage to target creature.');
  const defs = [BALDRIC, BEAR, CLERIC, ROGUE, WARRIOR, WIZARD, BOLT];
  const game = (mine: string[], theirs: string[] = []): GameState => mpScenario({
    defs, zones: { p1: { battlefield: ['Test Party Sash', 'Test Sash Bear', ...mine], hand: ['Test Sash Bolt'] }, p2: { battlefield: theirs } },
    setup: (x) => { const sash = x.zones.battlefield.find((id) => x.objects[id]!.defId === BALDRIC.id)!; x.objects[sash]!.attachedTo = x.zones.battlefield.find((id) => x.objects[id]!.defId === BEAR.id)!; },
  });
  const bear = (s: GameState): ObjectId => bf(s, 'Test Sash Bear')[0]!;
  const kws = (s: GameState): boolean[] => ['lifelink', 'deathtouch', 'haste', 'flying'].map((k) => hasKeyword(getChars(s, bear(s)), k));

  it('compiles full: four continuous effects on the equipped creature, each with a condition of its own; the full-party prevention; equip', () => {
    expect(full(BALDRIC)).toBe(true);
    const eff = (BALDRIC.faces[0]!.abilities[0] as unknown as { effects: { affects: unknown; when: unknown }[]; condition?: unknown });
    expect(eff.condition).toBeUndefined();
    expect(eff.effects.length).toBe(4);
    for (const e of eff.effects) { expect(e.affects).toEqual({ ref: 'attachedTo' }); expect(e.when).toBeDefined(); }
  });

  it('CR 611.3a: each grant is on only while its own condition holds (a Cleric: lifelink alone; a Rogue and a Wizard: deathtouch and flying)', () => {
    expect(kws(game([]))).toEqual([false, false, false, false]);
    expect(kws(game(['Test Sash Cleric']))).toEqual([true, false, false, false]);
    expect(kws(game(['Test Sash Rogue', 'Test Sash Wizard']))).toEqual([false, true, false, true]);
    expect(kws(game(['Test Sash Cleric', 'Test Sash Rogue', 'Test Sash Warrior', 'Test Sash Wizard']))).toEqual([true, true, true, true]);
  });

  it('CR 611.3a negative: an opponent\'s Warrior and Wizard grant nothing ("if you control")', () => {
    expect(kws(game([], ['Test Sash Warrior', 'Test Sash Wizard']))).toEqual([false, false, false, false]);
  });

  it('CR 700.8, 615.1: with a full party all damage to the equipped creature is prevented; with three of the four it is dealt', () => {
    const cast = (s: GameState): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Sash Bolt', 'hand', 'p1') }), { targets: [bear(s)] });
    const fullParty = cast(game(['Test Sash Cleric', 'Test Sash Rogue', 'Test Sash Warrior', 'Test Sash Wizard']));
    expect(bf(fullParty, 'Test Sash Bear').length).toBe(1);
    expect(fullParty.objects[bear(fullParty)]!.damage).toBe(0);
    const three = cast(game(['Test Sash Cleric', 'Test Sash Rogue', 'Test Sash Warrior']));
    expect(bf(three, 'Test Sash Bear').length).toBe(0);
  });
});

describe('CR 601.2d, 120.3, 608.2c: Aurelia\'s Fury (tap the creatures dealt damage; the players dealt damage can\'t cast noncreature spells this turn)', () => {
  const FURY = card('Test Fury of Wings', 'Instant', "Test Fury of Wings deals X damage divided as you choose among any number of targets. Tap each creature dealt damage this way. Players dealt damage this way can't cast noncreature spells this turn.", undefined, '{X}{R}{W}');
  const BEAR = card('Test Fury Bear', 'Creature — Bear', '', ['3', '3']);
  const SHOCK = card('Test Fury Spark', 'Instant', 'Test Fury Spark deals 1 damage to any target.');
  const FLASHER = card('Test Fury Flash Cub', 'Creature — Bear', 'Flash', ['1', '1']);
  const WARD = card('Test Fury Ward', 'Enchantment', 'Prevent all damage that would be dealt to you.');
  const defs = [FURY, BEAR, SHOCK, FLASHER, WARD];
  const game = (): GameState => mpScenario({
    defs, cards: ['Mountain'],
    zones: {
      p1: { hand: ['Test Fury of Wings'], battlefield: ['Mountain', 'Plains', 'Mountain', 'Mountain', 'Mountain'] },
      p2: { hand: ['Test Fury Spark', 'Test Fury Flash Cub'], battlefield: ['Test Fury Bear', 'Mountain', 'Mountain'] },
      p3: { hand: ['Test Fury Spark'], battlefield: ['Test Fury Bear', 'Mountain'] },
    },
  });
  const P = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
  const O = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
  const canCast = (s: GameState, who: PlayerId, name: string): boolean => {
    try { mact(s, { type: 'cast', player: who, card: mfind(s, name, 'hand', who) }); return true; } catch { return false; }
  };
  /** Gives priority to `who` (the others pass) with the stack empty. */
  const priorityTo = (s0: GameState, who: PlayerId): GameState => { let s = s0; for (let i = 0; i < 8 && s.pending?.player !== who; i++) s = mpass(s); return s; };

  it('compiles full: the divided damage binds what it dealt damage to; the tap and the cast restriction read that binding', () => {
    expect(full(FURY)).toBe(true);
    const steps = (FURY.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps.map((x) => x['op'])).toEqual(['damage', 'tap', 'effect']);
    const as = steps[0]!['as'];
    expect(JSON.stringify(steps[2])).toContain(`"subject":{"ref":"bound","name":"${as}"}`);
    expect(JSON.stringify(steps[2])).toContain('"notTypes":["Creature"]');
  });

  it('CR 120.3, 608.2c: X=3 as 2 to a player and 1 to another player\'s creature: the creature is tapped; only the player dealt damage can\'t cast noncreature spells', () => {
    const s0 = game();
    const bear3 = bf(s0, 'Test Fury Bear', 'p3')[0]!;
    const bear2 = bf(s0, 'Test Fury Bear', 'p2')[0]!;
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Fury of Wings', 'hand', 'p1') }), { number: 3, choice: [P('p2'), O(bear3)], division: [2, 1] });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.objects[bear3]!.tapped).toBe(true);
    expect(s.objects[bear2]!.tapped).toBe(false);
    const p2 = priorityTo(s, 'p2');
    expect(canCast(p2, 'p2', 'Test Fury Spark')).toBe(false); // noncreature: refused
    expect(canCast(p2, 'p2', 'Test Fury Flash Cub')).toBe(true); // a creature spell is allowed
    const p3 = priorityTo(s, 'p3');
    expect(canCast(p3, 'p3', 'Test Fury Spark')).toBe(true); // p3 was not dealt damage (only its creature)
  });

  it('CR 611.2a: "this turn": the restriction ends with the turn', () => {
    const s0 = game();
    let s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Fury of Wings', 'hand', 'p1') }), { number: 1, choice: [P('p2')], division: [1] });
    expect(canCast(priorityTo(s, 'p2'), 'p2', 'Test Fury Spark')).toBe(false);
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1', 'turn 2');
    expect(canCast(priorityTo(s, 'p2'), 'p2', 'Test Fury Spark')).toBe(true);
  });

  it('CR 120.3 negative: a player whose damage was prevented was not dealt damage this way and may still cast noncreature spells', () => {
    expect(full(WARD)).toBe(true);
    const s0 = mpScenario({ defs, cards: ['Mountain'], zones: { p1: { hand: ['Test Fury of Wings'], battlefield: ['Plains', 'Mountain', 'Mountain', 'Mountain'] }, p2: { hand: ['Test Fury Spark'], battlefield: ['Mountain', 'Test Fury Ward'] }, p3: { hand: ['Test Fury Spark'], battlefield: ['Mountain'] } } });
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Fury of Wings', 'hand', 'p1') }), { number: 2, choice: [P('p2'), P('p3')], division: [1, 1] });
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(19);
    expect(canCast(priorityTo(s, 'p3'), 'p3', 'Test Fury Spark')).toBe(false);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
    expect(canCast(priorityTo(s, 'p2'), 'p2', 'Test Fury Spark')).toBe(true);
  });
});

describe('CR 205.1b, 305.6, 302.6: Life and Limb (all Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands)', () => {
  const LIMB = card('Test Spore Grove', 'Enchantment', 'All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types.');
  const SPORE = card('Test Grove Saproling', 'Creature — Saproling', '', ['0', '0']);
  const WATCH = card('Test Grove Watcher', 'Enchantment', 'Whenever a creature enters, you gain 1 life.\nWhenever a land enters, you gain 2 life.');
  const defs = [LIMB, SPORE, WATCH];
  const game = (): GameState => mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Spore Grove', 'Forest', 'Plains', 'Test Grove Saproling'], hand: ['Forest'] }, p2: { battlefield: ['Forest'] } } });
  const ofName = (s: GameState, name: string, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && getChars(s, id).name === name);

  it('compiles full: one continuous effect on Forests and Saprolings: Creature + Saproling, Land + Forest, green, base 1/1', () => {
    expect(full(LIMB)).toBe(true);
    expect(full(WATCH)).toBe(true);
  });

  it('CR 205.1b, 613.1d-e, 613.4b: a Forest (anyone\'s) and a Saproling are both 1/1 green land creatures with both subtypes; a Plains is not changed', () => {
    const s = game();
    for (const id of [ofName(s, 'Forest', 'p1')[0]!, ofName(s, 'Forest', 'p2')[0]!, bf(s, 'Test Grove Saproling')[0]!]) {
      const c = getChars(s, id);
      expect(c.types).toEqual(expect.arrayContaining(['Creature', 'Land']));
      expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Saproling']));
      expect(c.colors).toEqual(['G']);
      expect([c.power, c.toughness]).toEqual(['1', '1']);
    }
    const plains = getChars(s, ofName(s, 'Plains', 'p1')[0]!);
    expect(plains.types).not.toContain('Creature');
  });

  it('CR 305.6: the Saproling has "{T}: Add {G}" (a Forest); CR 302.6: a Forest that entered this turn can\'t pay {T} (summoning sick), one controlled since the turn began can', () => {
    const s0 = game();
    const spore = bf(s0, 'Test Grove Saproling')[0]!;
    expect(activatedAbilities(s0, s0.objects[spore]!).some((a) => a.def.isMana === true)).toBe(true);
    s0.objects[spore]!.controlledSinceTurn = 1;
    const old = ofName(s0, 'Forest', 'p1')[0]!;
    // the scenario's permanents are on the battlefield before turn 1 began: the Forest is not summoning sick
    const tapOld = mact(s0, { type: 'activate', player: 'p1', source: old, ability: activatedAbilities(s0, s0.objects[old]!).find((a) => a.def.isMana === true)!.key } as never);
    expect(tapOld.objects[old]!.tapped).toBe(true);
    let s = mact(s0, { type: 'playLand', player: 'p1', card: mfind(s0, 'Forest', 'hand', 'p1') });
    s = run(s);
    const fresh = ofName(s, 'Forest', 'p1').find((id) => id !== old)!;
    expect(getChars(s, fresh).types).toContain('Creature');
    expect(() => mact(s, { type: 'activate', player: 'p1', source: fresh, ability: activatedAbilities(s, s.objects[fresh]!).find((a) => a.def.isMana === true)!.key } as never)).toThrow();
  });

  it('rulings 2021-03-19: a Forest entering is a creature entering and a land entering (both triggers)', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Spore Grove', 'Test Grove Watcher'], hand: ['Forest'] } } });
    const s = run(mact(s0, { type: 'playLand', player: 'p1', card: mfind(s0, 'Forest', 'hand', 'p1') }));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(23);
  });
});

describe('CR 700.8, 608.2e, 701.21a: Stick Together (each player keeps a party, then sacrifices the rest)', () => {
  const STICK = card('Test Band Together', 'Sorcery', 'Each player chooses a party from among creatures they control, then sacrifices the rest.');
  const C = card('Test Band Cleric', 'Creature — Human Cleric', '', ['1', '1']);
  const R = card('Test Band Rogue', 'Creature — Human Rogue', '', ['1', '1']);
  const W = card('Test Band Warrior', 'Creature — Human Warrior', '', ['1', '1']);
  const CW = card('Test Band Cleric Wizard', 'Creature — Elf Cleric Wizard', '', ['1', '1']);
  const BEAR = card('Test Band Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [STICK, C, R, W, CW, BEAR];
  const game = (mine: string[], theirs: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Band Together'], battlefield: mine }, p2: { battlefield: theirs } } });
  const cast = (s: GameState, sc: Script): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Band Together', 'hand', 'p1') }), sc);
  const names = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
  const pick = (want: string[]) => (o: ObjectId[], _pr: string, s: GameState): ObjectId[] => { const hit = o.find((id) => want.includes(s.defs[s.objects[id]!.defId]!.name)); return hit === undefined ? [] : [hit]; };

  it('compiles full: one sacrifice choice keeping a party among the creatures each player controls', () => {
    expect(full(STICK)).toBe(true);
    const step = (STICK.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps[0]!;
    expect(step).toMatchObject({ op: 'sacrificeChoice', who: { ref: 'each', who: 'player' }, filter: { types: ['Creature'] }, mode: 'keepParty' });
  });

  it('CR 700.8, 101.4: each player in APNAP order keeps up to one of each of the four types and sacrifices the rest; a creature of none of them is never kept', () => {
    const seen: NonNullable<Script['seen']> = [];
    const s = cast(game(['Test Band Cleric', 'Test Band Rogue', 'Test Band Warrior', 'Test Band Cleric Wizard', 'Test Band Bear'], ['Test Band Rogue', 'Test Band Rogue', 'Test Band Bear']), {
      seen, objects: pick(['Test Band Cleric', 'Test Band Rogue', 'Test Band Warrior', 'Test Band Cleric Wizard']),
    });
    expect(names(s, 'p1')).toEqual(['Test Band Cleric', 'Test Band Cleric Wizard', 'Test Band Rogue', 'Test Band Warrior']);
    expect(names(s, 'p2')).toEqual(['Test Band Rogue']);
    const asked = seen.filter((x) => x.kind === 'chooseObjects').map((x) => x.who);
    expect(asked.slice(0, 4)).toEqual(['p1', 'p1', 'p1', 'p1']); // Cleric, Rogue, Warrior, Wizard
    expect(asked.slice(4)).toEqual(['p2']); // only a Rogue to choose
    for (const q of seen.filter((x) => x.kind === 'chooseObjects')) expect(q).toMatchObject({ min: 0, max: 1 });
  });

  it('CR 700.8 negative: a creature of two of the types fills one place only (a Cleric Wizard kept as the Cleric leaves no Wizard to keep)', () => {
    const s = cast(game(['Test Band Cleric', 'Test Band Cleric Wizard'], []), { objects: pick(['Test Band Cleric Wizard']) });
    expect(names(s, 'p1')).toEqual(['Test Band Cleric Wizard']);
  });

  it('CR 700.8 ("up to one each"): a player may keep a smaller party; with none of the four types every creature is sacrificed', () => {
    const s = cast(game(['Test Band Cleric', 'Test Band Rogue'], ['Test Band Bear', 'Test Band Bear']), { objects: () => [] });
    expect(names(s, 'p1')).toEqual([]);
    expect(names(s, 'p2')).toEqual([]);
  });
});

describe('CR 118.12a, 118.3, 701.21a: Phyrexian Dreadnought ("sacrifice it unless you sacrifice any number of creatures with total power 12 or greater")', () => {
  const DREAD = card('Test Iron Leviathan', 'Artifact Creature — Phyrexian Construct', 'Trample\nWhen this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.', ['12', '12'], '{1}');
  const FIVE = card('Test Leviathan Five', 'Creature — Ogre', '', ['5', '5']);
  const SIX = card('Test Leviathan Six', 'Creature — Ogre', '', ['6', '6']);
  const SEVEN = card('Test Leviathan Seven', 'Creature — Ogre', '', ['7', '7']);
  const defs = [DREAD, FIVE, SIX, SEVEN];
  const game = (mine: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Iron Leviathan'], battlefield: ['Plains', ...mine] }, p2: { battlefield: ['Test Leviathan Seven', 'Test Leviathan Seven'] } } });
  const cast = (s: GameState, sc: Script): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Iron Leviathan', 'hand', 'p1') }), sc);
  const names = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).filter((n) => n !== 'Plains').sort();
  const choose = (want: string[]) => (o: ObjectId[], _pr: string, s: GameState): ObjectId[] => { const out: ObjectId[] = []; for (const w of want) { const hit = o.find((id) => !out.includes(id) && s.defs[s.objects[id]!.defId]!.name === w); if (hit) out.push(hit); } return out; };

  it('compiles full: a payment of a threshold sacrifice (total power 12 or more), else sacrifice it', () => {
    expect(full(DREAD)).toBe(true);
    const steps = (DREAD.faces[0]!.abilities[1] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 'any', totalPower: 12 }] }, else: [{ op: 'sacrifice', what: { ref: 'self' } }] });
  });

  it('CR 118.12a, 701.21a: paying with a 5 and a 7 (12) sacrifices both at once and keeps it', () => {
    const s = cast(game(['Test Leviathan Five', 'Test Leviathan Seven', 'Test Leviathan Six']), { yes: () => true, objects: choose(['Test Leviathan Five', 'Test Leviathan Seven']) });
    expect(names(s, 'p1')).toEqual(['Test Iron Leviathan', 'Test Leviathan Six']);
    expect(names(s, 'p2')).toEqual(['Test Leviathan Seven', 'Test Leviathan Seven']); // only your own creatures pay
  });

  it('CR 118.12a: declining sacrifices it; ruling 2004-10-04: the creatures chosen (here every one, the creature itself among them) are sacrificed at the same time', () => {
    const declined = cast(game(['Test Leviathan Five', 'Test Leviathan Seven']), { yes: () => false });
    expect(names(declined, 'p1')).toEqual(['Test Leviathan Five', 'Test Leviathan Seven']);
    const all = cast(game(['Test Leviathan Five', 'Test Leviathan Six']), { yes: () => true, objects: (o) => o });
    expect(names(all, 'p1')).toEqual([]);
  });

  it('CR 118.3: a choice of creatures whose powers add up to less than 12 is refused', () => {
    const s0 = mact(game(['Test Leviathan Five', 'Test Leviathan Seven']), { type: 'cast', player: 'p1', card: mfind(game(['Test Leviathan Five', 'Test Leviathan Seven']), 'Test Iron Leviathan', 'hand', 'p1') });
    let s = s0;
    let refused = false;
    for (let i = 0; i < 40 && s.pending && !s.result; i++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') {
        const five = (p as unknown as { options: ObjectId[] }).options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Leviathan Five')!;
        try { manswer(s, { kind: 'chooseObjects', ids: [five] }); } catch { refused = true; }
        break;
      }
      s = p.kind === 'priority' ? mpass(s) : p.kind === 'yesNo' ? manswer(s, { kind: 'yesNo', yes: true }) : p.kind === 'payCost' ? manswer(s, { kind: 'payCost', auto: true }) : manswer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) } as DecisionAnswer);
    }
    expect(refused).toBe(true);
  });

  it('CR 701.21a, 208.1: the creature itself (power 12) may pay its own cost: it is sacrificed by the payment, the others stay', () => {
    const s = cast(game(['Test Leviathan Five']), { yes: () => true, objects: choose(['Test Iron Leviathan']) });
    expect(names(s, 'p1')).toEqual(['Test Leviathan Five']);
    expect((s.zones.graveyard['p1'] ?? []).some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Iron Leviathan')).toBe(true);
  });
});

describe('CR 601.2i, 603.2, 603.4: Sentinel Tower ("1 plus the number of instant and sorcery spells cast before that spell this turn")', () => {
  const TOWER = card('Test Watch Spire', 'Artifact', 'Whenever an instant or sorcery spell is cast during your turn, this artifact deals damage to any target equal to 1 plus the number of instant and sorcery spells cast before that spell this turn.');
  const ZAP = card('Test Spire Chime', 'Instant', 'You gain 1 life.');
  const RITE = card('Test Spire Rite', 'Sorcery', 'You gain 1 life.');
  const BEAST = card('Test Spire Beast', 'Creature — Beast', 'Flash', ['1', '1']);
  const defs = [TOWER, ZAP, RITE, BEAST];
  const game = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Watch Spire'], hand: ['Test Spire Chime', 'Test Spire Chime', 'Test Spire Rite', 'Test Spire Beast'] }, p2: { hand: ['Test Spire Chime', 'Test Spire Chime'] } } });
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const P3: TargetChoice = { kind: 'player', id: 'p3' };
  const castBy = (s: GameState, who: PlayerId, name: string, sc: Script = {}): GameState => run(mact(s, { type: 'cast', player: who, card: mfind(s, name, 'hand', who) }), { choice: [P3], ...sc });
  const priorityTo = (s0: GameState, who: PlayerId): GameState => { let s = s0; for (let i = 0; i < 8 && s.pending?.player !== who; i++) s = mpass(s); return s; };

  it('compiles full: a cast by any player of an instant or sorcery during your turn; 1 plus the casts of the turn before the triggering one', () => {
    expect(full(TOWER)).toBe(true);
    const a = TOWER.faces[0]!.abilities[0] as unknown as { trigger: Record<string, unknown>; effect: { steps: Record<string, unknown>[] } };
    expect(a.trigger).toEqual({ on: [{ ev: 'cast', player: 'any', spell: { types: ['Instant', 'Sorcery'] } }], while: { cond: 'turnOf', whose: 'you' } });
    expect(a.effect.steps[0]!['amount']).toEqual({ q: 'math', op: '+', args: [1, { q: 'happenedCount', event: { ev: 'cast', player: 'any', spell: { types: ['Instant', 'Sorcery'] } }, scope: 'turn', beforeEvent: true }] });
  });

  it('ruling 2018-06-08: the first instant or sorcery of the turn deals 1, the second 2, the third 3 (a creature spell neither triggers nor counts)', () => {
    let s = castBy(game(), 'p1', 'Test Spire Chime');
    expect(life(s, 'p3')).toBe(19);
    s = castBy(s, 'p1', 'Test Spire Beast');
    expect(life(s, 'p3')).toBe(19);
    s = castBy(s, 'p1', 'Test Spire Rite');
    expect(life(s, 'p3')).toBe(17);
    s = castBy(s, 'p1', 'Test Spire Chime');
    expect(life(s, 'p3')).toBe(14);
  });

  it('ruling 2018-06-08: an opponent\'s instant during your turn triggers it too (you choose the target) and counts for later spells', () => {
    let s = castBy(game(), 'p1', 'Test Spire Chime');
    s = priorityTo(s, 'p2');
    s = castBy(s, 'p2', 'Test Spire Chime');
    expect(life(s, 'p3')).toBe(17); // 1 + 2
  });

  it('CR 603.4, 702.40a: a spell cast in response is not counted for the earlier trigger (counted before the triggering spell, not as it resolves)', () => {
    const s0 = game();
    let s = mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Spire Chime', 'hand', 'p1') });
    // answer the trigger's target, keep priority, cast the second one in response
    for (let i = 0; i < 10 && s.pending?.kind !== 'priority'; i++) s = s.pending?.kind === 'chooseTargets' ? manswer(s, { kind: 'chooseTargets', targets: [P3] } as DecisionAnswer) : manswer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.length).toBe(2); // the first spell and its trigger
    s = castBy(s, 'p1', 'Test Spire Chime');
    expect(life(s, 'p3')).toBe(17); // the second trigger 2, the first 1 (read as it resolves it would be 2: 16)
  });

  it('CR 603.2 negative: during an opponent\'s turn nothing triggers', () => {
    let s = passUntil(game(), (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', 'p2 main');
    s = priorityTo(s, 'p2');
    s = castBy(s, 'p2', 'Test Spire Chime');
    expect(life(s, 'p3')).toBe(20);
  });
});
