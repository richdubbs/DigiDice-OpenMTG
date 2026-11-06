/**
 * Commander lane edh-top, round edh-top-8: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 305.1, 601.3, 611.2b, 609.4b   "exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. ..."
 *   CR 608.2g, 305.2a, 118.9          "Discard X cards: Exile the top X cards of target opponent's library. You may play lands and cast spells from among cards exiled this way without paying their mana costs."
 *   CR 608.2c, 608.2d, 603.2          "its controller may pay 1 life. If they do, they draw a card."
 *   CR 406.1, 608.2d, 118.9           "each player exiles cards ... until they exile a nonland card. An opponent chooses a nonland card exiled this way. You may cast up to two spells from among the other cards ..."
 *   CR 607.2a, 611.3a, 305.1          "During your turn, as long as you've sacrificed a nontoken permanent this turn, you may play cards exiled with ~."
 *   CR 700.3, 608.2d, 701.21a         "Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice."
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const inZone = (s: GameState, zone: 'battlefield' | 'exile', p: PlayerId, defId: string): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.owner === p && s.objects[id]!.defId === defId);
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const exiledNames = (s: GameState, p?: PlayerId): string[] => s.zones.exile.filter((id) => p === undefined || s.objects[id]!.owner === p).map((id) => s.objects[id]!.defId);

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[];
  yes?: boolean;
  objects?: (options: ObjectId[], prompt: string, state: GameState) => ObjectId[];
  option?: (options: { id: string; label: string }[], prompt: string) => string | null;
  numbers?: number[];
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty. */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.playerTargets ?? [])];
  const numbers = [...(sc.numbers ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { options?: never; min?: number; max?: number; prompt: string };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      // the scripted targets first; else the first legal one(s) (a decision that must have a target, such as new targets for a spell)
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    }
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s) : o.slice(0, d.max ?? 1) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      const pick = sc.option !== undefined ? sc.option(o, d.prompt) : o[0]!.id;
      a = { kind: 'chooseOption', ids: pick === null ? [] : [pick] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}

describe('CR 305.1, 601.3, 611.2b, 609.4b: "exile all cards from that player\'s hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it."', () => {
  const BRAIN = card('Test Mindflayer', 'Creature — Horror', "Whenever this creature attacks a player, exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.", ['2', '2']);
  const BEAR = card('Test Blue Bear', 'Creature — Bear', '', ['2', '2'], '{1}{U}');
  const PLAIN = card('Test Plain Bear', 'Creature — Bear', '', ['1', '1'], '{W}');
  const defs = [BRAIN, BEAR, PLAIN];
  const start = (): GameState => mpScenario({
    defs,
    zones: { p1: { battlefield: ['Test Mindflayer', 'Plains', 'Plains'] }, p2: { hand: ['Test Blue Bear', 'Plains'] }, p3: { hand: ['Test Plain Bear'] } },
  });
  const afterAttack = (): GameState => {
    let s = start();
    s = declareAttackers(toDeclareAttackers(s), [[mfind(s, 'Test Mindflayer', 'battlefield', 'p1'), 'p2']]);
    s = run(s);
    return passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
  };
  it('is automated', () => expect(full(BRAIN)).toBe(true));
  it('CR 701.9, 121.1: the attacked player\'s hand is exiled and they draw that many cards (two Plains from the library); the other players\' hands are untouched', () => {
    const s = afterAttack();
    expect(exiledNames(s, 'p2').sort()).toEqual(['Plains', 'Test Blue Bear']);
    expect(hand(s, 'p2')).toEqual(['Plains', 'Plains']);
    expect(hand(s, 'p3')).toEqual(['Test Plain Bear']);
  });
  it('CR 305.1, 601.3: its controller may play the exiled land and cast the exiled spell (from exile); the cards that player drew are no part of it', () => {
    const s = afterAttack();
    const acts = legalActions(s, 'p1');
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Blue Bear')!;
    const land = s.zones.exile.find((id) => s.objects[id]!.defId === 'Plains')!;
    expect(acts.some((a) => a.kind === 'cast' && a.object === bear)).toBe(true);
    expect(acts.some((a) => a.kind === 'playLand' && a.object === land)).toBe(true);
    // p3's card was never exiled
    expect(acts.some((a) => (a.kind === 'cast' || a.kind === 'playLand') && s.objects[a.object!]?.defId === 'Test Plain Bear')).toBe(false);
  });
  it('CR 609.4b: mana of any color pays the exiled {1}{U} spell (p1 has only Plains)', () => {
    let s = afterAttack();
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Blue Bear')!;
    s = run(mact(s, { type: 'cast', player: 'p1', card: bear }));
    expect(inZone(s, 'battlefield', 'p2', 'Test Blue Bear')).toHaveLength(1);
  });
  it('negative: only the controller of the attacker has the permission: p2 (who owns the cards) cannot cast or play them from exile', () => {
    const s = afterAttack();
    const mine = legalActions(s, 'p2');
    expect(mine.some((a) => (a.kind === 'cast' || a.kind === 'playLand') && s.objects[a.object!]?.zone === 'exile')).toBe(false);
  });
});

describe('CR 608.2g, 305.2a, 118.9: "{1}, Discard X cards: Exile the top X cards of target opponent\'s library. You may play lands and cast spells from among cards exiled this way without paying their mana costs."', () => {
  const DEVICE = card('Test Looter Device', 'Artifact', "{1}, Discard X cards: Exile the top X cards of target opponent's library. You may play lands and cast spells from among cards exiled this way without paying their mana costs.");
  const BEAR = card('Test Blue Bear', 'Creature — Bear', '', ['2', '2'], '{4}{U}{U}');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3'], '{R}');
  const FODDER = card('Test Fodder', 'Creature — Bear', '', ['1', '1'], '{9}');
  const defs = [DEVICE, BEAR, OX, FODDER];
  const start = (hand = ['Test Fodder', 'Test Fodder']) => mpScenario({
    defs,
    zones: { p1: { battlefield: ['Test Looter Device', 'Plains', 'Plains'], hand }, p2: { library: ['Test Blue Bear', 'Plains', 'Test Pasture Ox', 'Plains'] } },
  });
  const activate = (s: GameState, sc: Script): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && s.objects[x.object!]?.defId === 'Test Looter Device');
    if (a === undefined) throw new Error('no activation');
    return run(mact(s, a.action), sc);
  };
  it('is automated', () => expect(full(DEVICE)).toBe(true));
  it('CR 608.2g: X = 2 discards two cards, exiles the top two cards of the opponent\'s library, and p1 casts the 6-mana spell for free and plays the land from exile as it resolves', () => {
    let s = start();
    s = activate(s, { numbers: [2], playerTargets: ['p2'] });
    // the two top cards were played: the bear is on the battlefield under p1's control and the Plains is p1's land play
    expect(inZone(s, 'battlefield', 'p2', 'Test Blue Bear').filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(1);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.owner === 'p2' && s.objects[id]!.controller === 'p1')).toBe(true);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Fodder', 'Test Fodder']);
    // the third card is still on top of that library (X = 2)
    expect(s.objects[s.zones.library['p2']![0]!]!.defId).toBe('Test Pasture Ox');
  });
  it('negative: the cards cannot be played later: what was not played during the resolution stays exiled for good', () => {
    let s = start();
    s = activate(s, { numbers: [2], playerTargets: ['p2'], yes: false, option: () => null });
    expect(exiledNames(s, 'p2').sort()).toEqual(['Plains', 'Test Blue Bear']);
    expect(inZone(s, 'battlefield', 'p2', 'Test Blue Bear')).toHaveLength(0);
    for (const a of legalActions(s, 'p1')) if (a.kind === 'cast' || a.kind === 'playLand') expect(s.objects[a.object!]?.zone).not.toBe('exile');
  });
});

describe('CR 608.2c, 608.2d, 603.2: "Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card."', () => {
  const GIX = card('Test Praetor', 'Legendary Creature — Phyrexian', 'Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card.', ['2', '3']);
  const RAIDER = card('Test Raider', 'Creature — Goblin', '', ['1', '1']);
  const defs = [GIX, RAIDER];
  const attackTurn = (who: PlayerId, mine: ObjectId[]): GameState => {
    let s = mpScenario({ defs, zones: who === 'p1' ? { p1: { battlefield: ['Test Praetor', 'Test Raider'] } } : { p1: { battlefield: ['Test Praetor'] }, [who]: { battlefield: ['Test Raider'] } } });
    if (who !== 'p1') s = passUntil(s, (x) => x.turn.activePlayer === who && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${who}'s turn`);
    const raider = mfind(s, 'Test Raider', 'battlefield', who);
    mine.push(raider);
    s = declareAttackers(toDeclareAttackers(s), [[raider, 'p2']]);
    return s;
  };
  const damageDealt = (s: GameState): GameState => {
    let t = s;
    for (let i = 0; i < 30 && t.turn.step !== 'combatDamage' && t.turn.step !== 'endCombat'; i++) t = t.pending?.kind === 'declareBlockers' ? manswer(t, { kind: 'declareBlockers', blocks: [] }) : mpass(t);
    return t;
  };
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  it('is automated', () => expect(full(GIX)).toBe(true));
  it('CR 608.2d: its controller (p1) pays 1 life and draws a card; the opponent that was dealt damage (p2) draws nothing', () => {
    const before = attackTurn('p1', []);
    const h1 = handSize(before, 'p1');
    const h2 = handSize(before, 'p2');
    const s = run(damageDealt(before), { yes: true });
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(handSize(s, 'p1')).toBe(h1 + 1);
    expect(handSize(s, 'p2')).toBe(h2);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('negative: declining the payment draws no card and loses no life', () => {
    const before = attackTurn('p1', []);
    const h1 = handSize(before, 'p1');
    const s = run(damageDealt(before), { yes: false });
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(h1);
  });
  it('CR 603.2, 608.2c: a creature of another player (p3) that hurts p2 on p3\'s turn: p3 is "its controller" (pays and draws), Praetor\'s controller draws nothing', () => {
    const before = attackTurn('p3', []);
    const h1 = handSize(before, 'p1');
    const h3 = handSize(before, 'p3');
    const s = run(damageDealt(before), { yes: true });
    expect(lifeOf(s, 'p3')).toBe(19);
    expect(handSize(s, 'p3')).toBe(h3 + 1);
    expect(handSize(s, 'p1')).toBe(h1);
  });
});

describe('CR 406.1, 608.2d, 118.9: "Each player exiles cards from the top of their library until they exile a nonland card. An opponent chooses a nonland card exiled this way. You may cast up to two spells from among the other cards exiled this way without paying their mana costs."', () => {
  const WIZ = card('Test Duo Spell', 'Sorcery', 'Each player exiles cards from the top of their library until they exile a nonland card. An opponent chooses a nonland card exiled this way. You may cast up to two spells from among the other cards exiled this way without paying their mana costs.');
  const A = card('Test Spell A', 'Creature — Bear', '', ['1', '1'], '{5}');
  const B = card('Test Spell B', 'Creature — Bear', '', ['2', '2'], '{5}');
  const C = card('Test Spell C', 'Creature — Bear', '', ['3', '3'], '{5}');
  const D = card('Test Spell D', 'Creature — Bear', '', ['4', '4'], '{5}');
  const defs = [WIZ, A, B, C, D];
  const start = (): GameState => mpScenario({
    defs,
    zones: {
      p1: { hand: ['Test Duo Spell'], library: ['Plains', 'Test Spell A', 'Plains'] },
      p2: { library: ['Test Spell B', 'Plains'] },
      p3: { library: ['Plains', 'Plains', 'Test Spell C', 'Plains'] },
      p4: { library: ['Test Spell D', 'Plains'] },
    },
  });
  const mine = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => s.objects[id]!.defId);
  const play = (picksFrom: (st: GameState, opts: ObjectId[]) => string[]): GameState => run(mact(start(), { type: 'cast', player: 'p1', card: mfind(start(), 'Test Duo Spell', 'hand', 'p1') }), {
    objects: (opts, _prompt, st) => opts.filter((id) => picksFrom(st, opts).includes(st.objects[id]!.defId)).slice(0, 4),
  });
  it('is automated', () => expect(full(WIZ)).toBe(true));
  it('CR 406.1, 608.2d: every player exiles down to a nonland card; the opponent chosen picks C; p1 casts two of the others (A and D) for free; B and C stay exiled, with the lands', () => {
    const s = play((_st, opts) => (opts.length === 4 ? ['Test Spell C'] : ['Test Spell A', 'Test Spell D']));
    expect(mine(s).filter((n) => n.startsWith('Test Spell')).sort()).toEqual(['Test Spell A', 'Test Spell D']);
    expect(exiledNames(s).filter((n) => n.startsWith('Test Spell')).sort()).toEqual(['Test Spell B', 'Test Spell C']);
    expect(exiledNames(s).filter((n) => n === 'Plains').length).toBeGreaterThanOrEqual(2);
  });
  it('negative: the card the opponent chose cannot be one of the two cast: with C chosen, asking for C, A and D casts only A and D (C is not offered)', () => {
    let offered: string[] = [];
    const s = play((st, opts) => {
      if (opts.length === 4) return ['Test Spell C'];
      offered = opts.map((id) => st.objects[id]!.defId);
      return ['Test Spell A', 'Test Spell C', 'Test Spell D'];
    });
    expect(offered.sort()).toEqual(['Test Spell A', 'Test Spell B', 'Test Spell D']);
    expect(mine(s).filter((n) => n === 'Test Spell C')).toHaveLength(0);
  });
  it('negative: up to two, not three: choosing three of the three others is refused by the engine ("Choose between 0 and 2")', () => {
    expect(() => play((_st, opts) => (opts.length === 4 ? ['Test Spell C'] : ['Test Spell A', 'Test Spell B', 'Test Spell D']))).toThrow(/Choose between 0 and 2/);
  });
});

describe('edh-top-9 (fix: edh-top-8 finding 1), CR 406.1, 608.2c: "a nonland card exiled this way" and "the other cards exiled this way" are EVERY card the exile-until exiled, whatever its stop filter', () => {
  const WIZ = card('Test Creature Duo', 'Sorcery', 'Each player exiles cards from the top of their library until they exile a creature card. An opponent chooses a nonland card exiled this way. You may cast up to two spells from among the other cards exiled this way without paying their mana costs.');
  const A = card('Test Spell A', 'Creature — Bear', '', ['1', '1'], '{5}');
  const B = card('Test Spell B', 'Creature — Bear', '', ['2', '2'], '{5}');
  const ODD = card('Test Odd Sorcery', 'Sorcery', '', undefined, '{5}');
  const defs = [WIZ, A, B, ODD];
  const start = (): GameState => mpScenario({
    defs,
    zones: {
      p1: { hand: ['Test Creature Duo'], library: ['Plains', 'Test Spell A', 'Plains'] },
      p2: { library: ['Plains', 'Test Odd Sorcery', 'Test Spell B', 'Plains'] },
      p3: { library: ['Plains', 'Plains'] },
      p4: { library: ['Plains', 'Plains'] },
    },
  });
  const mine = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => s.objects[id]!.defId);
  it('is automated', () => expect(full(WIZ)).toBe(true));
  it('the opponent picks among every nonland card exiled (the noncreature sorcery p2 passed over too), not only among the creature cards each player stopped at; the others are cast from what is left', () => {
    let first: string[] = [];
    let second: string[] = [];
    const s0 = start();
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Creature Duo', 'hand', 'p1') }), {
      objects: (opts, _prompt, st) => {
        const names = opts.map((id) => st.objects[id]!.defId);
        if (first.length === 0) { first = names; return opts.filter((id) => st.objects[id]!.defId === 'Test Odd Sorcery'); }
        second = names;
        return opts.slice(0, 2);
      },
    });
    expect(first.sort()).toEqual(['Test Odd Sorcery', 'Test Spell A', 'Test Spell B']);
    expect(second.sort()).toEqual(['Test Spell A', 'Test Spell B']);
    expect(mine(s).filter((n) => n.startsWith('Test Spell')).sort()).toEqual(['Test Spell A', 'Test Spell B']);
    expect(exiledNames(s).filter((n) => n === 'Test Odd Sorcery')).toHaveLength(1);
  });
  it('negative: lands are not "nonland cards", though they were exiled this way too', () => {
    let first: string[] = [];
    const s0 = start();
    run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Creature Duo', 'hand', 'p1') }), {
      objects: (opts, _prompt, st) => { if (first.length === 0) first = opts.map((id) => st.objects[id]!.defId); return opts.slice(0, 1); },
    });
    expect(first).not.toContain('Plains');
  });
});

describe('CR 607.2a, 611.3a, 305.1, 603.2: "During your turn, as long as you\'ve sacrificed a nontoken permanent this turn, you may play cards exiled with ~."', () => {
  const CUTTER = card('Test Brushcutter', 'Creature — Goblin', "Whenever you sacrifice a nontoken permanent, exile the top card of your library.\nDuring your turn, as long as you've sacrificed a nontoken permanent this turn, you may play cards exiled with this creature.\n{T}, Sacrifice a land: Add {R}{R}.", ['2', '2']);
  const CHEAP = card('Test Cheap Bear', 'Creature — Bear', '', ['1', '1'], '{R}{R}');
  const defs = [CUTTER, CHEAP];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Brushcutter', 'Plains', 'Plains'], library: ['Plains', 'Test Cheap Bear', 'Plains', 'Plains'] /* (the first card is drawn for the turn) */ } } });
  const castable = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.objects[a.object!]?.defId === 'Test Cheap Bear' && s.objects[a.object!]?.zone === 'exile');
  const sacLand = (s: GameState): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && s.objects[x.object!]?.defId === 'Test Brushcutter');
    if (a === undefined) throw new Error('no mana ability offered');
    return run(mact(s, a.action));
  };
  it('is automated', () => expect(full(CUTTER)).toBe(true));
  it('negative: nothing is exiled and nothing sacrificed yet: no card is playable from exile', () => {
    expect(castable(start())).toBe(false);
  });
  it('CR 611.3a: after p1 sacrifices a nontoken permanent (a land) the top card was exiled with it, and p1 may cast it this turn', () => {
    const s = sacLand(start());
    expect(exiledNames(s, 'p1')).toEqual(['Test Cheap Bear']);
    expect(castable(s)).toBe(true);
  });
  it('negative: on the next turn of p1, with no sacrifice that turn, the exiled card cannot be played', () => {
    let s = sacLand(start());
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's next turn", 400);
    expect(exiledNames(s, 'p1')).toContain('Test Cheap Bear');
    expect(castable(s)).toBe(false);
  });
});

describe('CR 700.3, 608.2d, 701.21a: "Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice."', () => {
  const SPLIT = card('Test Splitter', 'Sorcery', 'Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [SPLIT, OX];
  const start = (): GameState => mpScenario({
    defs,
    zones: { p1: { hand: ['Test Splitter'] }, p2: { battlefield: ['Test Pasture Ox', 'Test Pasture Ox', 'Plains'] }, p3: { battlefield: ['Test Pasture Ox'] } },
  });
  const p2Names = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').map((id) => s.objects[id]!.defId).sort();
  const go = (firstPile: (names: string[]) => boolean, choose: 'pile1' | 'pile2'): GameState => {
    const s = start();
    return run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Splitter', 'hand', 'p1') }), {
      playerTargets: ['p2'],
      objects: (opts, _p, st) => opts.filter((id) => firstPile([st.objects[id]!.defId])),
      option: (o) => (o.find((x) => x.id === choose) ?? o[0]!).id,
    });
  };
  it('is automated', () => expect(full(SPLIT)).toBe(true));
  it('CR 700.3: p1 makes the first pile the two oxen and the second the Plains; p2 picks the oxen and sacrifices both; the Plains stays; p3\'s ox is untouched', () => {
    const s = go((n) => n[0] === 'Test Pasture Ox', 'pile1');
    expect(p2Names(s)).toEqual(['Plains']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p3')).toHaveLength(1);
  });
  it('CR 608.2d: p2 picks the other pile (the Plains): only the Plains is sacrificed', () => {
    const s = go((n) => n[0] === 'Test Pasture Ox', 'pile2');
    expect(p2Names(s)).toEqual(['Test Pasture Ox', 'Test Pasture Ox']);
  });
  it('CR 700.3d: a pile may be empty: with every permanent in the first pile and the second chosen, nothing is sacrificed', () => {
    const s = go(() => true, 'pile2');
    expect(p2Names(s)).toEqual(['Plains', 'Test Pasture Ox', 'Test Pasture Ox']);
  });
});

describe('CR 601.3, 609.4b, 400.7, 603.7: "Exile all opponents\' graveyards. You may cast spells from among those cards this turn, and mana of any type can be spent to cast them. At the beginning of the next end step, if any of those cards remain exiled, return them to their owners\' graveyards. Exile ~."', () => {
  const BETRAYAL = card('Test Betrayal', 'Sorcery', "Exile all opponents' graveyards. You may cast spells from among those cards this turn, and mana of any type can be spent to cast them. At the beginning of the next end step, if any of those cards remain exiled, return them to their owners' graveyards.\nExile Test Betrayal.");
  const BEAR = card('Test Cheap Bear', 'Creature — Bear', '', ['2', '2'], '{1}{R}');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3'], '{G}');
  const THIRD = card('Test Third Wheel', 'Creature — Bear', '', ['1', '1'], '{B}');
  const defs = [BETRAYAL, BEAR, OX, THIRD];
  const start = (): GameState => mpScenario({
    defs,
    zones: { p1: { hand: ['Test Betrayal'], battlefield: ['Plains', 'Plains'], graveyard: ['Test Pasture Ox'] }, p2: { graveyard: ['Test Cheap Bear', 'Test Pasture Ox'] }, p3: { graveyard: ['Test Third Wheel'] } },
  });
  const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId).sort();
  const cast = (): GameState => run(mact(start(), { type: 'cast', player: 'p1', card: mfind(start(), 'Test Betrayal', 'hand', 'p1') }));
  it('is automated', () => expect(full(BETRAYAL)).toBe(true));
  it('CR 406.1: the opponents\' graveyards are exiled (p1\'s own graveyard is not) and the spell itself is exiled, not put into a graveyard', () => {
    const s = cast();
    expect(yard(s, 'p2')).toEqual([]);
    expect(yard(s, 'p3')).toEqual([]);
    expect(yard(s, 'p1')).toEqual(['Test Pasture Ox']);
    expect(exiledNames(s).sort()).toEqual(['Test Betrayal', 'Test Cheap Bear', 'Test Pasture Ox', 'Test Third Wheel']);
  });
  it('CR 601.3, 609.4b: p1 may cast p2\'s exiled bear, paying {1}{R} with two Plains (mana of any type), and p1 controls it afterwards', () => {
    let s = cast();
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Cheap Bear')!;
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === bear)).toBe(true);
    s = run(mact(s, { type: 'cast', player: 'p1', card: bear }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Cheap Bear' && s.objects[id]!.controller === 'p1')).toBe(true);
  });
  it('CR 400.7, 603.7: at the beginning of the next end step, the cards still exiled go back to their owners\' graveyards; the one that was cast stays on the battlefield', () => {
    let s = cast();
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Cheap Bear')!;
    s = run(mact(s, { type: 'cast', player: 'p1', card: bear }));
    s = passUntil(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority' && x.zones.stack.length === 0 || x.turn.number > 1, 'the end step', 200);
    s = run(s);
    expect(yard(s, 'p2')).toEqual(['Test Pasture Ox']);
    expect(yard(s, 'p3')).toEqual(['Test Third Wheel']);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Cheap Bear' && s.objects[id]!.controller === 'p1')).toBe(true);
    // the spell itself stays exiled
    expect(exiledNames(s)).toEqual(['Test Betrayal']);
  });
  it('negative: only this turn: on the next turn the exiled cards are gone from exile and cannot be cast', () => {
    let s = cast();
    s = passUntil(s, (x) => x.turn.number > 1 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the next turn', 400);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'exile')).toBe(false);
  });
});

describe('CR 705.1, 115.7, 608.2c: "Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell."', () => {
  const POLARITY = card('Test Polarity', 'Instant', 'Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [POLARITY, BOLT, OX];
  const start = (seed: string): GameState => mpScenario({ defs, seed, zones: { p1: { hand: ['Test Bolt'] }, p2: { hand: ['Test Polarity'], battlefield: ['Test Pasture Ox'] }, p3: { battlefield: ['Test Pasture Ox'] } } });
  /** p1 casts the bolt at p2's ox; p2 answers with the Polarity (the spell as its target). */
  const play = (seed: string, newTarget?: ObjectId): GameState => {
    let s = start(seed);
    const ox2 = mfind(s, 'Test Pasture Ox', 'battlefield', 'p2');
    s = manswer(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Bolt', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [{ kind: 'object', id: ox2 }] });
    s = mpass(s);
    const bolt = s.zones.stack[s.zones.stack.length - 1]!;
    s = manswer(mact(s, { type: 'cast', player: 'p2', card: mfind(s, 'Test Polarity', 'hand', 'p2') }), { kind: 'chooseTargets', targets: [{ kind: 'object', id: bolt }] });
    return run(s, { targets: newTarget !== undefined ? [newTarget] : [], objects: (o) => (newTarget !== undefined && o.includes(newTarget) ? [newTarget] : o.slice(0, 1)) });
  };
  const seeds = Array.from({ length: 40 }, (_, i) => `inv${i}`);
  const outcome = (s: GameState): 'won' | 'lost' => (s.log.some((l) => /wins the flip|win the flip|wins the coin|won the flip/i.test(l.text)) ? 'won' : 'lost');
  const lost = (s: GameState): boolean => s.log.some((l) => /counter/i.test(l.text) && /Test Bolt/.test(l.text));
  it('is automated', () => expect(full(POLARITY)).toBe(true));
  it('CR 705.1, 701.6a: when the flip is lost the spell is countered: p2\'s ox survives', () => {
    const seed = seeds.find((x) => lost(play(x)));
    expect(seed).toBeDefined();
    const s = play(seed!);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pasture Ox')).toHaveLength(2);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Bolt');
  });
  it('CR 705.1, 115.7, 613.1b: when the flip is won p2 controls the bolt and may choose a new target (p3\'s ox): the bolt then resolves under p2\'s control against it', () => {
    const seed = seeds.find((x) => !lost(play(x)));
    expect(seed).toBeDefined();
    const s0 = start(seed!);
    const ox3 = mfind(s0, 'Test Pasture Ox', 'battlefield', 'p3');
    const s = play(seed!, ox3);
    // p3's ox took 3 damage (toughness 3): it died; p2's ox is untouched
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pasture Ox' && s.objects[id]!.controller === 'p2')).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pasture Ox' && s.objects[id]!.controller === 'p3')).toHaveLength(0);
    void outcome;
  });
});
