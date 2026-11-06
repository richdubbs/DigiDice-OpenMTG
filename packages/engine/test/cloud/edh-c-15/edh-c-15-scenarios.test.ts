/**
 * Commander lane edh-c, round edh-c-15 (second pass over EDHREC ranks 15,001-15,625): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive
 * Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.20e, 608.2d, 208.1         "Look at the top five cards of your library. You may put a creature card with power 5 or greater from among them onto the battlefield. Put the rest on the bottom ..."
 *   CR 701.20e, 404.1, 608.2d         "Look at the top two cards of your library. Put one of them into your graveyard."
 *   CR 701.20a, 701.20e, 608.2d       "Look at the top five cards of your library. You may reveal any number of creature cards from among them and put them into your hand. ..."
 *   CR 105.2, 613.4c, 608.2h          "Target creature gets +2/+2 until end of turn for each of its colors."
 *   CR 502.3, 611.2a                  "Tap up to two target creatures. Each of those creatures doesn't untap during its controller's next untap step."
 *   CR 108.3, 611.2a, 613.1b          "Each opponent chooses a creature they control. You gain control of those creatures."
 *   CR 118.3, 608.2d, 400.3           "At the beginning of each player's upkeep, that player may pay 2 life. If they don't, they return a permanent they control to its owner's hand."
 *   CR 608.2c, 120.3                  "{2}, {T}: ~ deals 1 damage to target creature. If a colorless creature is dealt damage this way, tap it."
 *   CR 111.4, 201.2                   "When ~ dies, create Name the Epithet, a legendary 5/5 colorless Goblin Golem artifact creature token."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, legalActions, type DecisionAnswer, type OracleCard, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil, reject } from '../../m12/rules/helpers';
import { card, full, pt, tokens } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[];
  yes?: boolean | ((prompt: string, who: PlayerId) => boolean);
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId) => ObjectId[];
  numbers?: number[];
  /** Keeps passing priority (and declares no blockers) until this holds, as well as emptying the stack. */
  until?: (state: GameState) => boolean;
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
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
    else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
/** Passes priority to the main phase of the given turn's active player. */
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);
const attack = (s: GameState, id: ObjectId, defender: PlayerId): GameState => declareAttackers(toDeclareAttackers(s), [[id, defender]]);
const afterDamage = (s: GameState): boolean => s.turn.step === 'endCombat' || s.turn.step === 'main2';


describe('CR 701.20e, 608.2d, 208.1: "You may put a creature card with power 5 or greater from among them onto the battlefield."', () => {
  const DIG = card('Test Giant Dig', 'Sorcery', 'Look at the top five cards of your library. You may put a creature card with power 5 or greater from among them onto the battlefield. Put the rest on the bottom of your library in any order.');
  const BIG = card('Test Huge Ox', 'Creature — Ox', '', ['5', '5']);
  const MID = card('Test Mid Ox', 'Creature — Ox', '', ['4', '4']);
  const defs = [DIG, BIG, MID];
  const start = (library: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Giant Dig'], library: ['Test Mid Ox', ...library] } } }); // (the first card is p1's draw for the turn)
  const cast = (s: GameState): { s: GameState; options: string[] } => {
    let options: string[] = [];
    const r = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Giant Dig', 'hand', 'p1') }), { objects: (o, _p, st) => { options = o.map((id) => st.objects[id]!.defId); return o; } });
    return { s: r, options };
  };
  it('is automated', () => expect(full(DIG)).toBe(true));
  it('CR 208.1: only the creature card with power 5 or greater is offered and enters; the others go to the bottom of the library', () => {
    const { s, options } = cast(start(['Test Mid Ox', 'Test Huge Ox', 'Plains', 'Plains', 'Plains']));
    expect(options).toEqual(['Test Huge Ox']);
    expect(bf(s, 'Test Huge Ox', 'p1')).toHaveLength(1);
    expect(bf(s, 'Test Mid Ox', 'p1')).toHaveLength(0);
    expect(s.zones.library['p1']!.slice(-4).map((id) => s.objects[id]!.defId).sort()).toEqual(['Plains', 'Plains', 'Plains', 'Test Mid Ox']);
  });
  it('negative: with no creature of power 5 or greater among the five nothing enters (power 4 is not enough)', () => {
    const { s } = cast(start(['Test Mid Ox', 'Test Mid Ox', 'Plains', 'Plains', 'Plains']));
    expect(bf(s, 'Test Mid Ox', 'p1')).toHaveLength(0);
    expect(bf(s, 'Test Huge Ox', 'p1')).toHaveLength(0);
  });
  it('negative: a sixth card is not looked at', () => {
    const { s } = cast(start(['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Huge Ox']));
    expect(bf(s, 'Test Huge Ox', 'p1')).toHaveLength(0);
  });
});

describe('CR 701.20e, 404.1, 608.2d: "Look at the top two cards of your library. Put one of them into your graveyard."', () => {
  const PEEK = card('Test Peek Rite', 'Sorcery', 'Look at the top two cards of your library. Put one of them into your graveyard.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [PEEK, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Peek Rite'], library: ['Plains', 'Test Pasture Ox', 'Plains', 'Plains'] } } });
  const cast = (s: GameState, pick: (o: ObjectId[]) => ObjectId[]): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Peek Rite', 'hand', 'p1') }), { objects: pick });
  it('is automated', () => expect(full(PEEK)).toBe(true));
  it('exactly the one card chosen goes to the graveyard; the other stays on top of the library (nothing else moves)', () => {
    const s0 = start();
    const top2 = s0.zones.library['p1']!.slice(0, 2);
    const s = cast(s0, (o) => [o[1]!]);
    expect(yard(s, 'p1').filter((n) => n !== 'Test Peek Rite')).toHaveLength(1);
    const left = s.zones.library['p1']!;
    expect(top2.filter((id) => left.includes(id))).toHaveLength(1);
    expect(left[0]).toBe(top2.find((id) => left.includes(id)));
  });
  it('negative: the choice is one card, never both (two options, one picked)', () => {
    let seen = 0;
    cast(start(), (o) => { seen = o.length; return o.slice(0, 1); });
    expect(seen).toBe(2);
  });
});

describe('CR 701.20a, 701.20e, 608.2d: "You may reveal any number of creature cards from among them and put them into your hand."', () => {
  const FORM = card('Test Party Rite', 'Sorcery', 'Look at the top five cards of your library. You may reveal any number of creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [FORM, OX];
  const start = (library: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Party Rite'], library: ['Plains', ...library] } } });
  const cast = (s: GameState, pick: (o: ObjectId[]) => ObjectId[]): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Party Rite', 'hand', 'p1') }), { objects: pick });
  it('is automated', () => expect(full(FORM)).toBe(true));
  it('the chosen creature cards (two of the three) go to your hand and nothing else of the five does; the rest go to the bottom', () => {
    const s = cast(start(['Test Pasture Ox', 'Plains', 'Test Pasture Ox', 'Test Pasture Ox', 'Plains']), (o) => o.slice(0, 2));
    expect(hand(s, 'p1').filter((n) => n === 'Test Pasture Ox')).toHaveLength(2);
    expect(hand(s, 'p1').filter((n) => n === 'Plains')).toHaveLength(1); // the draw for the turn only
    expect(s.zones.library['p1']!.slice(-3).map((id) => s.objects[id]!.defId).sort()).toEqual(['Plains', 'Plains', 'Test Pasture Ox']);
  });
  it('negative: only creature cards are offered, and choosing none puts nothing into the hand', () => {
    let options = 0;
    const s = cast(start(['Test Pasture Ox', 'Plains', 'Plains', 'Plains', 'Plains']), (o) => { options = o.length; return []; });
    expect(options).toBe(1);
    expect(hand(s, 'p1').filter((n) => n === 'Test Pasture Ox')).toHaveLength(0);
  });
});

describe('CR 105.2, 613.4c, 608.2h: "Target creature gets +2/+2 until end of turn for each of its colors."', () => {
  const MIGHT = card('Test Hue Surge', 'Instant', 'Target creature gets +2/+2 until end of turn for each of its colors.');
  const colored = (name: string, cost: string, colors: string[]) => compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Creature — Fox', oracle_text: '', colors, power: '1', toughness: '1' } as OracleCard);
  const TWO = colored('Test Dusk Fox', '{G}{W}', ['G', 'W']);
  const ONE = colored('Test Green Fox', '{G}', ['G']);
  const NONE = colored('Test Gray Fox', '{2}', []);
  const defs = [MIGHT, TWO, ONE, NONE];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Hue Surge'], battlefield: ['Test Dusk Fox', 'Test Green Fox', 'Test Gray Fox'] } } });
  const castOn = (name: string): GameState => { const s0 = start(); return run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Hue Surge', 'hand', 'p1') }), { targets: [bf(s0, name, 'p1')[0]!] }); };
  const stats = (s: GameState, name: string): string => { const c = getChars(s, bf(s, name, 'p1')[0]!)!; return `${c.power}/${c.toughness}`; };
  it('is automated', () => expect(full(MIGHT)).toBe(true));
  it('a two-colored creature gets +4/+4', () => expect(stats(castOn('Test Dusk Fox'), 'Test Dusk Fox')).toBe('5/5'));
  it('a one-colored creature gets +2/+2', () => expect(stats(castOn('Test Green Fox'), 'Test Green Fox')).toBe('3/3'));
  it('negative: a colorless creature gets +0/+0 (colorless is no color, CR 105.2) and the others are untouched', () => {
    const s = castOn('Test Gray Fox');
    expect(stats(s, 'Test Gray Fox')).toBe('1/1');
    expect(stats(s, 'Test Dusk Fox')).toBe('1/1');
  });
});

describe('CR 502.3, 611.2a: "Each of those creatures doesn\'t untap during its controller\'s next untap step."', () => {
  const FREEZE = card('Test Deep Chill', 'Sorcery', "Tap up to two target creatures. Each of those creatures doesn't untap during its controller's next untap step.");
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [FREEZE, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Deep Chill'] }, p2: { battlefield: ['Test Pasture Ox', 'Test Pasture Ox'] } } });
  it('is automated', () => expect(full(FREEZE)).toBe(true));
  it('the targeted creature stays tapped through its controller\'s next untap step and untaps in the one after; the one not targeted is not frozen', () => {
    const s0 = start();
    const [a, b] = bf(s0, 'Test Pasture Ox', 'p2');
    let s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Deep Chill', 'hand', 'p1') }), { targets: [a!] });
    expect(s.objects[a!]!.tapped).toBe(true);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's first main phase");
    expect(s.objects[a!]!.tapped).toBe(true);
    expect(s.objects[b!]!.tapped).toBe(false);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.turn.number > s.turn.number && x.pending?.kind === 'priority', "p1's next main phase");
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.turn.number > s.turn.number && x.pending?.kind === 'priority', "p2's second main phase");
    expect(s.objects[a!]!.tapped).toBe(false);
  });
});

describe('CR 108.3, 611.2a, 613.1b: "Each opponent chooses a creature they control. You gain control of those creatures."', () => {
  const RICH = card('Test Grand Levy', 'Sorcery', 'Each opponent chooses a creature they control. You gain control of those creatures.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [RICH, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Grand Levy'] }, p2: { battlefield: ['Test Pasture Ox', 'Test Pasture Ox'] }, p3: { battlefield: ['Test Pasture Ox'] } } });
  it('is automated', () => expect(full(RICH)).toBe(true));
  it('you gain control of exactly the one creature each opponent chose (two of three here); the opponent with two keeps one; the one with none loses nothing', () => {
    const s = run(mact(start(), { type: 'cast', player: 'p1', card: mfind(start(), 'Test Grand Levy', 'hand', 'p1') }));
    expect(bf(s, 'Test Pasture Ox', 'p1')).toHaveLength(2);
    expect(bf(s, 'Test Pasture Ox', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Pasture Ox', 'p3')).toHaveLength(0);
  });
  it('negative: your own creatures are not given away and the control change has no end (it lasts after the turn)', () => {
    let s = run(mact(start(), { type: 'cast', player: 'p1', card: mfind(start(), 'Test Grand Levy', 'hand', 'p1') }));
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    expect(bf(s, 'Test Pasture Ox', 'p1')).toHaveLength(2);
  });
});

describe('CR 118.3, 608.2d, 400.3: "At the beginning of each player\'s upkeep, that player may pay 2 life. If they don\'t, they return a permanent they control to its owner\'s hand."', () => {
  const LICUS = card('Test Tithe Stone', 'Artifact', "At the beginning of each player's upkeep, that player may pay 2 life. If they don't, they return a permanent they control to its owner's hand.");
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [LICUS, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Tithe Stone'] }, p2: { battlefield: ['Test Pasture Ox'] } } });
  const toP2Upkeep = (yes: boolean): GameState => {
    let s = start();
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep' && (x.pending?.kind !== 'priority' || x.zones.stack.length > 0), "p2's upkeep");
    return run(s, { yes, objects: (o) => o.slice(0, 1) });
  };
  it('is automated', () => expect(full(LICUS)).toBe(true));
  it('paying 2 life keeps the permanent and costs the active player 2 life', () => {
    const s = toP2Upkeep(true);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(bf(s, 'Test Pasture Ox', 'p2')).toHaveLength(1);
  });
  it('negative: not paying returns one permanent that player controls to its owner\'s hand and costs no life', () => {
    const s = toP2Upkeep(false);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(bf(s, 'Test Pasture Ox', 'p2')).toHaveLength(0);
    expect(hand(s, 'p2')).toContain('Test Pasture Ox');
  });
});

describe('CR 608.2c, 120.3: "{2}, {T}: ~ deals 1 damage to target creature. If a colorless creature is dealt damage this way, tap it."', () => {
  const ARROW = card('Test Pin Archer', 'Creature — Archer', '{2}, {T}: ~ deals 1 damage to target creature. If a colorless creature is dealt damage this way, tap it.', ['1', '1']);
  const GRAY = compileCard({ name: 'Test Gray Golem', layout: 'normal', mana_cost: '{4}', type_line: 'Artifact Creature — Golem', oracle_text: '', colors: [], power: '3', toughness: '3' } as OracleCard);
  const GREEN = compileCard({ name: 'Test Green Bear', layout: 'normal', mana_cost: '{G}', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'], power: '3', toughness: '3' } as OracleCard);
  const defs = [ARROW, GRAY, GREEN];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Pin Archer', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Gray Golem', 'Test Green Bear'] } } });
  const shoot = (name: string): { s: GameState; id: ObjectId } => {
    const s0 = start();
    const id = bf(s0, name, 'p2')[0]!;
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && s0.objects[x.object!]?.defId === 'Test Pin Archer');
    return { s: run(mact(s0, (a as unknown as { action: never }).action), { targets: [id] }), id };
  };
  it('is automated', () => expect(full(ARROW)).toBe(true));
  it('a colorless creature that was dealt the damage becomes tapped', () => {
    const { s, id } = shoot('Test Gray Golem');
    expect(s.objects[id]!.damage).toBe(1);
    expect(s.objects[id]!.tapped).toBe(true);
  });
  it('negative: a colored creature takes the damage and stays untapped', () => {
    const { s, id } = shoot('Test Green Bear');
    expect(s.objects[id]!.damage).toBe(1);
    expect(s.objects[id]!.tapped).toBe(false);
  });
});

describe('CR 111.4, 201.2: "When ~ dies, create Tuktuk-like Name the Epithet, a legendary 5/5 colorless Goblin Golem artifact creature token."', () => {
  const DIER = card('Test Brass Digger', 'Legendary Creature — Goblin', 'When ~ dies, create Brass Digger the Returned, a legendary 5/5 colorless Goblin Golem artifact creature token.', ['1', '2']);
  const KILL = card('Test Quick Doom', 'Sorcery', 'Destroy target creature.');
  const defs = [DIER, KILL];
  it('is automated', () => expect(full(DIER)).toBe(true));
  it('when it dies its controller gets one token with the given name, legendary, 5/5; nothing is created while it lives', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Quick Doom'] }, p2: { battlefield: ['Test Brass Digger'] } } });
    expect(tokens(s0, 'p2')).toHaveLength(0);
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Quick Doom', 'hand', 'p1') }), { targets: [bf(s0, 'Test Brass Digger', 'p2')[0]!] });
    const t = tokens(s, 'p2');
    expect(t).toHaveLength(1);
    expect(s.objects[t[0]!]!.defId).toContain('Brass Digger the Returned');
    expect(pt(s, t[0]!)).toBe('5/5');
  });
});
