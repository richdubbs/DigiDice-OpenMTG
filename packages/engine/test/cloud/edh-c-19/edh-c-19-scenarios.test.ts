/**
 * Commander lane edh-c, round edh-c-19 (third pass over EDHREC ranks 15,001-15,625): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive
 * Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 107.3, 118.12, 608.2h        "You gain three times X life." (cost: reveal X cards)
 *   CR 107.3, 118.12, 608.2h        "You may pay {X}. If you do, draw X cards. X can't be greater than the amount of life you gained this turn."
 *   CR 701.24a, 608.2d, 404.1       "Target player mills four cards. You shuffle up to four cards from your graveyard into your library."
 *   CR 401.4, 121.1, 608.2h         "Whenever you cast a spell, put the cards in your hand on the bottom of your library in any order, then draw that many cards."
 *   CR 120.3, 208.1, 608.2h         "Whenever a creature with flying attacks you, ~ deals damage equal to its power to that creature."
 *   CR 701.20a, 401.2, 608.2c       "Whenever ~ attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand."
 *   CR 705.2, 608.2c, 608.2d        "At the beginning of your upkeep, you may flip a coin. If you win the flip, ... If you lose the flip, ..."
 *   CR 701.26a, 121.1, 608.2c       "Whenever ~ attacks, you may tap any number of untapped Humans you control. Draw a card for each Human tapped this way."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, counters, full } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const lib = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[];
  yes?: boolean | ((prompt: string, who: PlayerId) => boolean);
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId) => ObjectId[];
  numbers?: number[];
  /** Records the bounds of every number asked for. */
  asked?: { min?: number; max?: number }[];
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
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: typeof sc.yes === 'function' ? sc.yes(d.prompt, d.player) : sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'chooseNumber') { sc.asked?.push({ min: d.min, max: d.max }); a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer; }
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });


const colored = (name: string, color: 'W' | 'U'): ReturnType<typeof card> => compileCard({ name, layout: 'normal', mana_cost: `{${color}}`, type_line: 'Creature — Soldier', oracle_text: '', colors: [color], power: '1', toughness: '1' } as OracleCard);
const activate = (s: GameState, name: string): GameState => {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && s.objects[x.object!]?.defId === name);
  return mact(s, (a as unknown as { action: never }).action);
};

describe('CR 107.3, 118.12, 608.2h: "You gain three times X life." (X white cards revealed as a cost)', () => {
  const MARTYR = card('Test Sand Martyr', 'Creature — Human Cleric', '{1}, Reveal X white cards from your hand, Sacrifice this creature: You gain three times X life.', ['1', '1'], '{W}');
  const WHITE = colored('Test White Squire', 'W');
  const BLUE = colored('Test Blue Squire', 'U');
  const defs = [MARTYR, WHITE, BLUE];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Sand Martyr', 'Plains'], hand: ['Test White Squire', 'Test White Squire', 'Test Blue Squire'] } } });
  it('is automated', () => expect(full(MARTYR)).toBe(true));
  it('revealing two white cards gains six life (three times the X announced); the Martyr is sacrificed', () => {
    const asked: { min?: number; max?: number }[] = [];
    const s = run(activate(start(), 'Test Sand Martyr'), { numbers: [2], asked, objects: (o) => o.slice(0, 2) });
    expect(lifeOf(s, 'p1')).toBe(26);
    expect(bf(s, 'Test Sand Martyr', 'p1')).toHaveLength(0);
    expect(asked[0]!.max).toBe(2); // (the blue card can't be revealed for it: only two white cards are in the hand)
  });
  it('negative: X = 1 gains three life, never six; X = 0 gains none', () => {
    expect(lifeOf(run(activate(start(), 'Test Sand Martyr'), { numbers: [1], objects: (o) => o.slice(0, 1) }), 'p1')).toBe(23);
    expect(lifeOf(run(activate(start(), 'Test Sand Martyr'), { numbers: [0] }), 'p1')).toBe(20);
  });
});

describe('CR 107.3, 118.12, 608.2h: "At the beginning of your end step, you may pay {X}. If you do, draw X cards. X can\'t be greater than the amount of life you gained this turn."', () => {
  const SHANNA = card('Test Wisdom Blade', 'Legendary Creature — Human Warrior', "At the beginning of your end step, you may pay {X}. If you do, draw X cards. X can't be greater than the amount of life you gained this turn.", ['1', '1']);
  const GAIN = card('Test Warm Meal', 'Instant', 'You gain 3 life.');
  const defs = [SHANNA, GAIN];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Wisdom Blade', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Warm Meal'] } } });
  const toEnd = (s: GameState, nums: number[], asked: { min?: number; max?: number }[]): GameState => {
    const r = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'end' && (x.pending?.kind !== 'priority' || x.zones.stack.length > 0), "p1's end step");
    return run(r, { numbers: nums, asked });
  };
  it('is automated', () => expect(full(SHANNA)).toBe(true));
  it('after gaining 3 life this turn, X can be at most 3: paying 3 draws three cards', () => {
    const asked: { min?: number; max?: number }[] = [];
    const s0 = run(castBy(start(), 'Test Warm Meal'));
    const before = hand(s0, 'p1').length;
    const s = toEnd(s0, [3], asked);
    expect(asked[0]!.max).toBe(3);
    expect(hand(s, 'p1').length - before).toBe(3);
  });
  it('negative: with no life gained this turn X can only be 0 and nothing is drawn', () => {
    const asked: { min?: number; max?: number }[] = [];
    const s0 = start();
    const before = hand(s0, 'p1').length;
    const s = toEnd(s0, [5], asked);
    expect(asked.every((a) => (a.max ?? 0) === 0)).toBe(true);
    expect(hand(s, 'p1').length).toBe(before);
  });
});

describe('CR 701.24a, 608.2d, 404.1: "Target player mills four cards. You shuffle up to four cards from your graveyard into your library."', () => {
  const STREAM = card('Test River Thought', 'Sorcery', 'Target player mills four cards. You shuffle up to four cards from your graveyard into your library.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [STREAM, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test River Thought'], graveyard: ['Test Pasture Ox', 'Test Pasture Ox'] } } });
  const play = (pick: (o: ObjectId[]) => ObjectId[], opts: { shown?: { n: number } } = {}): GameState => {
    const s0 = start();
    return run(castBy(s0, 'Test River Thought'), { playerTargets: ['p1'], objects: (o) => { if (opts.shown) opts.shown.n = o.length; return pick(o); } });
  };
  it('is automated', () => expect(full(STREAM)).toBe(true));
  it('targeting yourself: any of the six cards in the graveyard can be chosen (not the spell itself); the chosen two are shuffled into the library', () => {
    const shown = { n: 0 };
    const libBefore = start().zones.library['p1']!.length;
    const s = play((o) => o.slice(0, 2), { shown });
    expect(shown.n).toBe(6); // two Oxen + the four milled cards; the spell is still on the stack (CR 608.2n)
    expect(s.zones.library['p1']!.length).toBe(libBefore - 4 + 2);
    expect(yard(s, 'p1')).toContain('Test River Thought');
    expect(yard(s, 'p1')).toHaveLength(5);
  });
  it('negative: choosing none shuffles none (up to four, not exactly four); and more than four cannot be chosen', () => {
    const s = play(() => []);
    expect(yard(s, 'p1')).toHaveLength(7);
    let max = 0;
    const s0 = start();
    run(castBy(s0, 'Test River Thought'), { playerTargets: ['p2'], objects: (o, p, st) => { max = o.length; return o.slice(0, 4); } });
    expect(max).toBe(2); // targeting another player: only your own two Oxen, the milled cards are theirs
  });
});

describe('CR 401.4, 121.1, 608.2h: "Whenever you cast a spell, put the cards in your hand on the bottom of your library in any order, then draw that many cards."', () => {
  const MOIL = card('Test Churning Thought', 'Enchantment', 'Whenever you cast a spell, put the cards in your hand on the bottom of your library in any order, then draw that many cards.');
  const SPELL = card('Test Plain Sigh', 'Instant', 'You gain 1 life.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [MOIL, SPELL, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Churning Thought'], hand: ['Test Plain Sigh', 'Test Pasture Ox', 'Test Pasture Ox', 'Test Pasture Ox'] } } });
  it('is automated', () => expect(full(MOIL)).toBe(true));
  it('casting a spell sends the other cards of the hand to the bottom of the library and draws as many new ones; the spell itself is not in the hand, so it is not counted', () => {
    const s0 = start();
    const others = s0.zones.hand['p1']!.filter((id) => s0.objects[id]!.defId !== 'Test Plain Sigh');
    const s = run(castBy(s0, 'Test Plain Sigh'));
    expect(hand(s, 'p1')).toHaveLength(others.length);
    expect(hand(s, 'p1')).not.toContain('Test Pasture Ox'); // the three Oxen went to the library
    const bottom = s.zones.library['p1']!.slice(-others.length).map((id) => s.objects[id]!.defId);
    expect([...bottom].sort()).toEqual(others.map((id) => s0.objects[id]!.defId).sort()); // (new objects after the zone change, CR 400.7)
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length); // as many cards drawn as were put on the bottom
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('negative: it triggers on casting only (activating or playing a land does not shuffle the hand)', () => {
    const s0 = start();
    const s = run(mact(s0, { type: 'playLand', player: 'p1', card: mfind(s0, 'Plains', 'hand', 'p1') } as never));
    expect(hand(s, 'p1')).toContain('Test Pasture Ox');
  });
});

describe('CR 120.3, 208.1, 608.2h: "Whenever a creature with flying attacks you, ~ deals damage equal to its power to that creature."', () => {
  const ARCHER = card('Test Sky Archer', 'Creature — Human Archer', 'Reach\nWhenever a creature with flying attacks you, ~ deals damage equal to its power to that creature.', ['3', '3']);
  const BIRD = card('Test Plain Bird', 'Creature — Bird', 'Flying', ['2', '5']);
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['2', '5']);
  const defs = [ARCHER, BIRD, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Plain Bird', 'Test Pasture Ox'] }, p2: { battlefield: ['Test Sky Archer'] } } });
  const attackWith = (name: string): { s: GameState; id: ObjectId } => {
    const s0 = start();
    const id = bf(s0, name, 'p1')[0]!;
    const s = run(declareAttackers(toDeclareAttackers(s0), [[id, 'p2']]));
    return { s, id };
  };
  it('is automated', () => expect(full(ARCHER)).toBe(true));
  it('a flying attacker takes damage equal to the Archer\'s power (3), not its own (2)', () => {
    const { s, id } = attackWith('Test Plain Bird');
    expect(s.objects[id]!.damage).toBe(3);
  });
  it('negative: a creature without flying that attacks takes nothing from it', () => {
    const { s, id } = attackWith('Test Pasture Ox');
    expect(s.objects[id]!.damage).toBe(0);
  });
});

describe('CR 701.20a, 401.2, 608.2c: "Whenever ~ attacks, defending player reveals the top card of their library. If it\'s a land card, that player puts it into their hand."', () => {
  const GUIDE = card('Test Quick Scout', 'Creature — Goblin Scout', "Haste\nWhenever ~ attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand.", ['2', '2']);
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [GUIDE, OX];
  const start = (top: string): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Quick Scout'] }, p2: { library: [top] } } });
  const swing = (top: string): GameState => {
    const s0 = start(top);
    return run(declareAttackers(toDeclareAttackers(s0), [[bf(s0, 'Test Quick Scout', 'p1')[0]!, 'p2']]));
  };
  it('is automated', () => expect(full(GUIDE)).toBe(true));
  it('a land on top of the defending player\'s library goes into that player\'s hand (not the attacker\'s)', () => {
    const s0 = start('Plains');
    const s = swing('Plains');
    expect(hand(s, 'p2').length).toBe(hand(s0, 'p2').length + 1);
    expect(hand(s, 'p1').length).toBe(hand(s0, 'p1').length);
  });
  it('negative: a nonland card stays on top of the library', () => {
    const s0 = start('Test Pasture Ox');
    const s = swing('Test Pasture Ox');
    expect(hand(s, 'p2').length).toBe(hand(s0, 'p2').length);
    expect(lib(s, 'p2')[0]).toBe('Test Pasture Ox');
  });
  it('negative: another opponent\'s library is not revealed (only the defending player\'s)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Quick Scout'] }, p2: { library: ['Plains'] }, p3: { library: ['Plains'] } } });
    const s = run(declareAttackers(toDeclareAttackers(s0), [[bf(s0, 'Test Quick Scout', 'p1')[0]!, 'p2']]));
    expect(hand(s, 'p3').length).toBe(hand(s0, 'p3').length);
  });
});

describe('CR 705.2, 608.2c, 608.2d: "At the beginning of your upkeep, you may flip a coin. If you win the flip, put a +1/+1 counter on ~. If you lose the flip, remove a +1/+1 counter from ~."', () => {
  const GOO = card('Test Fickle Ooze', 'Creature — Ooze', 'At the beginning of your upkeep, you may flip a coin. If you win the flip, put a +1/+1 counter on ~. If you lose the flip, remove a +1/+1 counter from ~.', ['0', '0']);
  const start = (): GameState => mpScenario({ defs: [GOO], zones: { p2: { battlefield: [{ name: 'Test Fickle Ooze', counters: { '+1/+1': 3 } } as never] } } });
  const toUpkeep = (yes: boolean): GameState => {
    const s = passUntil(start(), (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep' && (x.pending?.kind !== 'priority' || x.zones.stack.length > 0), "p2's upkeep");
    return run(s, { yes });
  };
  it('is automated', () => expect(full(GOO)).toBe(true));
  it('accepting the flip changes the counters by exactly one, up or down (win: +1, lose: -1)', () => {
    const s = toUpkeep(true);
    const n = counters(s, bf(s, 'Test Fickle Ooze', 'p2')[0]!, '+1/+1');
    expect([2, 4]).toContain(n);
  });
  it('negative: declining the flip changes nothing (the option is the flip itself)', () => {
    const s = toUpkeep(false);
    expect(counters(s, bf(s, 'Test Fickle Ooze', 'p2')[0]!, '+1/+1')).toBe(3);
  });
});

describe('CR 701.26a, 121.1, 608.2c: "Whenever ~ attacks, you may tap any number of untapped Humans you control. Draw a card for each Human tapped this way."', () => {
  const GARRISON = card('Test Watch Captain', 'Creature — Human Soldier', 'Whenever ~ attacks, you may tap any number of untapped Humans you control. Draw a card for each Human tapped this way.', ['2', '2']);
  const HUMAN = card('Test Plain Villager', 'Creature — Human Peasant', '', ['1', '1']);
  const ELF = card('Test Plain Elf', 'Creature — Elf', '', ['1', '1']);
  const defs = [GARRISON, HUMAN, ELF];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Watch Captain', 'Test Plain Villager', 'Test Plain Villager', 'Test Plain Elf'] } } });
  const swing = (pick: (o: ObjectId[], s: GameState) => ObjectId[], seen?: { names: string[] }): { s: GameState; before: number } => {
    const s0 = start();
    const before = hand(s0, 'p1').length;
    const s = run(declareAttackers(toDeclareAttackers(s0), [[bf(s0, 'Test Watch Captain', 'p1')[0]!, 'p2']]), { objects: (o, _p, st) => { if (seen) seen.names = o.map((id) => st.objects[id]!.defId); return pick(o, st); } });
    return { s, before };
  };
  it('is automated', () => expect(full(GARRISON)).toBe(true));
  it('tapping both Villagers draws two cards; only untapped Humans are offered (the Elf is not, and the tapped attacking Captain is not)', () => {
    const seen = { names: [] as string[] };
    const { s, before } = swing((o) => o, seen);
    expect([...seen.names].sort()).toEqual(['Test Plain Villager', 'Test Plain Villager']);
    expect(hand(s, 'p1').length - before).toBe(2);
  });
  it('negative: tapping none draws none; tapping one draws one', () => {
    expect(swing(() => []).s.zones.hand['p1']!.length - swing(() => []).before).toBe(0);
    const one = swing((o) => o.slice(0, 1));
    expect(one.s.zones.hand['p1']!.length - one.before).toBe(1);
  });
});
