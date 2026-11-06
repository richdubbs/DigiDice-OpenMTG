/**
 * Commander lane edh-top, round edh-top-10: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 106.6, 614.1c, 611.2a, 400.7a  "{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1 counter on it and gains hexproof until your next turn."
 *   CR 701.26b, 608.2d, 614.15        "At the beginning of each opponent's upkeep, untap a creature you control. If you've completed a dungeon, untap all creatures you control instead."
 *   CR 122.1, 608.2c, 701.34a         "... that player gets two rad counters if they don't have any rad counters. Otherwise, proliferate."
 *   CR 122.1, 608.2c, 104.3           "... put a point counter on ~. Then if it has ten or more point counters on it, remove them all and that player loses the game."
 *   CR 701.54c-d, 603.4               "... the Ring tempts you. Then if ~ is your Ring-bearer and the Ring has tempted you two or more times this game, draw a card."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

interface Script { yes?: boolean; objects?: (options: ObjectId[], prompt: string, state: GameState) => ObjectId[] }
/** Answers whatever is asked, from the script, and passes priority until the stack is empty. */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string };
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s) : o.slice(0, d.max ?? 1) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}

describe('CR 106.6, 614.1c, 611.2a, 400.7a: "{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1 counter on it and gains hexproof until your next turn."', () => {
  const ORB = card('Test Verdant Orb', 'Artifact', '{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1 counter on it and gains hexproof until your next turn.');
  const WHELP = card('Test Moss Whelp', 'Creature — Dragon', '', ['1', '1'], '{G}');
  const WYRM = card('Test Moss Wyrm', 'Creature — Dragon', '', ['2', '2'], '{G}{G}');
  const GOAT = card('Test Moss Goat', 'Creature — Goat', '', ['1', '1'], '{G}');
  const ROCK = card('Test Green Stone', 'Artifact', '{T}: Add {G}.');
  const DEFS = [ORB, WHELP, WYRM, GOAT, ROCK];
  const setup = (hand: string[], battlefield: string[]): GameState => scenario([], { p1: { hand, battlefield }, defs: DEFS });
  const tap = (s: GameState, source: ObjectId): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === source);
    if (!a) throw new Error('no mana ability');
    return act(s, a.action);
  };
  const castAndResolve = (s0: GameState, name: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
      if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${s.pending.kind}`);
    }
    return s;
  };
  it('is automated, the rider (counter, keyword, until the next turn) on the addMana step', () => {
    expect(full(ORB)).toBe(true);
    expect(JSON.stringify(ORB.faces[0]!.abilities)).toContain('"untilNextTurn":true');
  });
  it('CR 614.1c, 611.2a: a Dragon creature spell paid with that mana enters with a +1/+1 counter and hexproof', () => {
    let s = setup(['Test Moss Whelp'], ['Test Verdant Orb']);
    s = tap(s, find(s, 'Test Verdant Orb', 'battlefield', 'p1'));
    s = castAndResolve(s, 'Test Moss Whelp');
    const whelp = find(s, 'Test Moss Whelp', 'battlefield', 'p1');
    expect(s.objects[whelp]!.counters['+1/+1']).toBe(1);
    expect(hasKeyword(getChars(s, whelp)!, 'hexproof')).toBe(true);
  });
  it('the hexproof lasts until the controller\'s next turn (through the opponent\'s turn), then it is gone; the counter stays', () => {
    let s = setup(['Test Moss Whelp'], ['Test Verdant Orb']);
    s = tap(s, find(s, 'Test Verdant Orb', 'battlefield', 'p1'));
    s = castAndResolve(s, 'Test Moss Whelp');
    const whelp = find(s, 'Test Moss Whelp', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    expect(hasKeyword(getChars(s, whelp)!, 'hexproof')).toBe(true);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.turn.number > 2 && x.pending?.kind === 'priority', "p1's next turn");
    expect(hasKeyword(getChars(s, whelp)!, 'hexproof')).toBe(false);
    expect(s.objects[whelp]!.counters['+1/+1']).toBe(1);
  });
  it('CR 106.6 (the Jade Orb ruling): each mana of that kind spent on the spell counts: two orbs give two counters', () => {
    let s = setup(['Test Moss Wyrm'], ['Test Verdant Orb', 'Test Verdant Orb']);
    for (const orb of s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Verdant Orb')) s = tap(s, orb);
    s = castAndResolve(s, 'Test Moss Wyrm');
    expect(s.objects[find(s, 'Test Moss Wyrm', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(2);
  });
  it('negative: a creature spell that is not a Dragon paid with that mana gets neither the counter nor hexproof', () => {
    let s = setup(['Test Moss Goat'], ['Test Verdant Orb']);
    s = tap(s, find(s, 'Test Verdant Orb', 'battlefield', 'p1'));
    s = castAndResolve(s, 'Test Moss Goat');
    const goat = find(s, 'Test Moss Goat', 'battlefield', 'p1');
    expect(s.objects[goat]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(hasKeyword(getChars(s, goat)!, 'hexproof')).toBe(false);
  });
  it('negative: the same Dragon paid with mana of another source gets nothing', () => {
    let s = setup(['Test Moss Whelp'], ['Test Green Stone', 'Test Verdant Orb']);
    s = tap(s, find(s, 'Test Green Stone', 'battlefield', 'p1'));
    s = castAndResolve(s, 'Test Moss Whelp');
    const whelp = find(s, 'Test Moss Whelp', 'battlefield', 'p1');
    expect(s.objects[whelp]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(hasKeyword(getChars(s, whelp)!, 'hexproof')).toBe(false);
  });
});

describe('CR 701.26b, 608.2d, 614.15: "At the beginning of each opponent\'s upkeep, untap a creature you control. If you\'ve completed a dungeon, untap all creatures you control instead."', () => {
  const PLUME = card('Test Plume Scout', 'Creature — Orc', "At the beginning of each opponent's upkeep, untap a creature you control. If you've completed a dungeon, untap all creatures you control instead.", ['1', '1']);
  const BEAR = card('Test Plume Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [PLUME, BEAR];
  const start = (completed: boolean): GameState => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Plume Scout', { name: 'Test Plume Bear', tapped: true }, { name: 'Test Plume Bear', tapped: true }, { name: 'Test Plume Bear', tapped: true }] } } });
    return completed ? tweak(s, (x) => { x.designations.completedDungeons = { p1: ['Lost Mine of Phandelver'] }; }) : s;
  };
  const tappedBears = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Plume Bear' && s.objects[id]!.tapped).length;
  /** The creature chosen is a tapped Bear (the Scout is untapped already). */
  const tappedBear = (o: ObjectId[], _prompt: string, st: GameState): ObjectId[] => [o.find((id) => st.objects[id]!.defId === 'Test Plume Bear' && st.objects[id]!.tapped) ?? o[0]!];
  const upkeepOf = (s: GameState, p: PlayerId): GameState => run(passUntil(s, (x) => x.turn.activePlayer === p && x.turn.step === 'upkeep' && (x.pending?.kind !== 'priority' || x.zones.stack.length > 0), `${p}'s upkeep trigger`), { objects: tappedBear });
  const toP2Upkeep = (s: GameState): GameState => upkeepOf(s, 'p2');
  it('is automated', () => expect(full(PLUME)).toBe(true));
  it('CR 701.26b: at an opponent\'s upkeep you choose and untap ONE creature you control (two of the three tapped Bears stay tapped)', () => {
    const s = toP2Upkeep(start(false));
    expect(tappedBears(s)).toBe(2);
  });
  it('the ability triggers at each opponent\'s upkeep: p3\'s upkeep untaps one more Bear', () => {
    const s = upkeepOf(toP2Upkeep(start(false)), 'p3');
    expect(tappedBears(s)).toBe(1);
  });
  it('CR 614.15: with a completed dungeon all creatures you control untap instead', () => {
    const s = toP2Upkeep(start(true));
    expect(tappedBears(s)).toBe(0);
  });
  it('negative: another player\'s completed dungeon does not count', () => {
    const base = start(false);
    const s = toP2Upkeep(tweak(base, (x) => { x.designations.completedDungeons = { p2: ['Lost Mine of Phandelver'] }; }));
    expect(tappedBears(s)).toBe(2);
  });
});

describe('CR 122.1, 608.2c, 701.34a: "Whenever this creature deals combat damage to a player, that player gets two rad counters if they don\'t have any rad counters. Otherwise, proliferate."', () => {
  const GULL = card('Test Rad Gull', 'Creature — Bird', "Whenever this creature deals combat damage to a player, that player gets two rad counters if they don't have any rad counters. Otherwise, proliferate.", ['1', '1']);
  const defs = [GULL];
  const rad = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['rad'] ?? 0;
  const attack = (setup?: (s: GameState) => void): GameState => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Rad Gull'] } }, ...(setup ? { setup } : {}) });
    s = declareAttackers(toDeclareAttackers(s), [[mfind(s, 'Test Rad Gull', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 30 && s.turn.step !== 'combatDamage' && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'declareBlockers' ? manswer(s, { kind: 'declareBlockers', blocks: [] }) : mpass(s);
    return run(s, { objects: (o) => o });
  };
  it('is automated', () => expect(full(GULL)).toBe(true));
  it('CR 122.1: a player with no rad counters gets two', () => {
    const s = attack();
    expect(rad(s, 'p2')).toBe(2);
    expect(rad(s, 'p1')).toBe(0);
  });
  it('negative / Otherwise: a player that already has rad counters gets none from the first sentence; proliferate adds one to each kind it has (here 3 + 1)', () => {
    const s = attack((x) => { x.players.find((p) => p.id === 'p2')!.counters['rad'] = 3; });
    expect(rad(s, 'p2')).toBe(4);
  });
  it('the condition is about the damaged player alone: p3\'s rad counters do not stop p2 from getting them', () => {
    const s = attack((x) => { x.players.find((p) => p.id === 'p3')!.counters['rad'] = 5; });
    expect(rad(s, 'p2')).toBe(2);
  });
});

describe('CR 122.1, 608.2c, 104.3: "Whenever a creature you control deals combat damage to an opponent, put a point counter on ~. Then if it has ten or more point counters on it, remove them all and that player loses the game."', () => {
  const STADIUM = card('Test Point Stadium', 'Artifact', 'Whenever a creature you control deals combat damage to an opponent, put a point counter on ~. Then if it has ten or more point counters on it, remove them all and that player loses the game.');
  const RUNNER = card('Test Point Runner', 'Creature — Human', '', ['1', '1']);
  const defs = [STADIUM, RUNNER];
  const attack = (points: number): GameState => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Point Stadium', counters: points > 0 ? { point: points } : {} }, 'Test Point Runner'] } } });
    s = declareAttackers(toDeclareAttackers(s), [[mfind(s, 'Test Point Runner', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 30 && s.turn.step !== 'combatDamage' && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'declareBlockers' ? manswer(s, { kind: 'declareBlockers', blocks: [] }) : mpass(s);
    return run(s);
  };
  const stadiumPoints = (s: GameState): number => s.objects[mfind(s, 'Test Point Stadium', 'battlefield', 'p1')]!.counters['point'] ?? 0;
  it('is automated', () => expect(full(STADIUM)).toBe(true));
  it('CR 104.3: at ten point counters the damaged opponent loses the game and the counters are removed; the other opponents stay in', () => {
    const s = attack(9);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    expect(s.players.find((p) => p.id === 'p3')!.hasLost).toBe(false);
    expect(stadiumPoints(s)).toBe(0);
  });
  it('negative: below ten the counter is only added (8 + 1 = 9) and nobody loses', () => {
    const s = attack(8);
    expect(stadiumPoints(s)).toBe(9);
    expect(s.players.some((p) => p.hasLost)).toBe(false);
  });
});

describe('CR 701.54c-d, 603.4: "Whenever this creature attacks, the Ring tempts you. Then if this creature is your Ring-bearer and the Ring has tempted you two or more times this game, draw a card."', () => {
  const HOBBIT = card('Test Ring Hobbit', 'Creature — Halfling', 'Whenever this creature attacks, the Ring tempts you. Then if this creature is your Ring-bearer and the Ring has tempted you two or more times this game, draw a card.', ['1', '1']);
  const PONY = card('Test Ring Pony', 'Creature — Horse', '', ['1', '1']);
  const defs = [HOBBIT, PONY];
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;
  /** p1 attacks with the Hobbit on its turn `n` (turn numbers 1, 5, 9 in a 4-player game); the Ring-bearer is chosen with `pick`. */
  const attackOnce = (s0: GameState, pick: (o: ObjectId[], st: GameState) => ObjectId): { s: GameState; drew: number } => {
    let s = passUntil(s0, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's turn");
    const before = hand(s);
    s = declareAttackers(toDeclareAttackers(s), [[mfind(s, 'Test Ring Hobbit', 'battlefield', 'p1'), 'p2']]);
    s = run(s, { objects: (o, _p, st) => [pick(o, st)] });
    return { s, drew: hand(s) - before };
  };
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Ring Hobbit', 'Test Ring Pony'] } } });
  const finishTurn = (s: GameState): GameState => passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "the end of p1's turn", 120);
  const hobbit = (o: ObjectId[], st: GameState): ObjectId => o.find((id) => st.objects[id]!.defId === 'Test Ring Hobbit') ?? o[0]!;
  const pony = (o: ObjectId[], st: GameState): ObjectId => o.find((id) => st.objects[id]!.defId === 'Test Ring Pony') ?? o[0]!;
  it('is automated', () => expect(full(HOBBIT)).toBe(true));
  it('CR 701.54c: the first temptation does not draw (the Ring has tempted you once); the second does, when the Hobbit is the Ring-bearer', () => {
    const first = attackOnce(start(), hobbit);
    expect(first.drew).toBe(0);
    expect(first.s.designations.ring?.['p1']?.tempted).toBe(1);
    const second = attackOnce(finishTurn(passUntil(first.s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'main2', 40)), hobbit);
    expect(second.s.designations.ring?.['p1']?.tempted).toBe(2);
    expect(second.drew).toBe(1); // the draw of the ability (counted from the main phase, after the turn's draw step)
  });
  it('negative: with another creature chosen as the Ring-bearer the second temptation draws no card for the ability', () => {
    const first = attackOnce(start(), pony);
    const second = attackOnce(finishTurn(passUntil(first.s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'main2', 40)), pony);
    expect(second.s.designations.ring?.['p1']?.tempted).toBe(2);
    expect(second.drew).toBe(0);
  });
});
