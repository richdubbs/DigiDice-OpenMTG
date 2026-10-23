/**
 * CLOUD std-fra (the Standard backlog of one set, tuning half; docs/CARD_WORK.md): the shapes of parser/templates/zz-cloud/std-fra.json and the small engine and parser
 * support they needed, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 115.1, 601.2c, 608.2f   "for each opponent, tap / destroy / return up to one target creature that player controls": one target for each opponent
 *   CR 122.1d, 122.6           "put a stun counter on each of those creatures": the creatures that opponent target set named
 *   CR 608.2c                  "Then ...": the instructions of a spell or ability are followed in order
 *   CR 608.2d, 611.2a          "gains your choice of trample, hexproof, or haste until end of turn": the choice is made as the effect resolves
 *   CR 608.2h, 400.7, 202.3    "if that permanent's mana value was 3 or less": last known information of an object that was exiled
 *   CR 602.5b                  "Activate only if you've scried or surveilled this turn": read from this turn's history as the ability is announced
 *   CR 701.21a, 120.3, 608.2h  "sacrifice ~, it deals 2 damage to each opponent, and you gain 2 life": the damage source is read as it last existed
 */
import { describe, expect, it } from 'vitest';
import { compileCard, charsOfObject, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const defName = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => defName(s, id)).sort();
const onBattlefield = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const inHand = (s: GameState, p: string): string[] => names(s, s.zones.hand[p]!);

/** Answer the decisions that come up: costs automatically, each target choice from the queue in order, option choices by `option`, yes/no with `yes`; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], option: (labels: string[]) => number = () => 0, yes = true): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [d.options[option(d.options.map((o) => o.label))]!.id] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty; decisions on the way are answered by `settle`. */
function resolveAll(s0: GameState, targets: TargetChoice[][] = [], option?: (labels: string[]) => number, yes = true): GameState {
  let s = settle(s0, targets, option, yes);
  const queue = [...targets];
  for (let guard = 0; guard < 60; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, queue, option, yes);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)} ${s.zones.stack.length} ${s.log.slice(-4).map((l) => l.text).join(' / ')}`);
}
/** Cast the first card of that name from p1's hand (targets in order) and let everything resolve. */
const castFirst = (s0: GameState, name: string, targets: TargetChoice[][] = [], option?: (labels: string[]) => number, yes = true): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.slice(0, 1), option, yes), targets.slice(1), option, yes);

const BEAR = 'Grizzly Bears';

describe('CR 115.1, 601.2c, 608.2f, 701.26a, 122.1d: "When ~ enters, for each opponent, tap up to one target creature that player controls. Put a stun counter on each of those creatures."', () => {
  const WARDEN = card('Test Warden', 'Creature — Wizard', 'When ~ enters, for each opponent, tap up to one target creature that player controls. Put a stun counter on each of those creatures.', '{0}', ['1', '1']);
  it('is automated (no manual part)', () => expect(manualParts(WARDEN)).toEqual([]));
  it('only a creature an opponent controls can be the target (at most one); it is tapped and gets a stun counter, and the opponent\'s other creatures do not', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Warden'], battlefield: [BEAR] }, p2: { battlefield: [BEAR, BEAR] }, defs: [WARDEN] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Warden', 'hand', 'p1') }));
    for (let guard = 0; guard < 6 && s.pending?.kind === 'priority'; guard++) s = pass(s); // the creature spell resolves; its trigger asks for the target
    const d = s.pending!;
    if (d.kind !== 'chooseTargets') throw new Error(`expected targets, got ${d.kind}`);
    expect(d.objects.every((id) => s.objects[id]!.controller === 'p2')).toBe(true); // none of p1's own creatures
    expect(d.max).toBe(1);
    const [first, second] = findAll(s, BEAR, 'battlefield', 'p2');
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(first!)] }));
    expect(s.objects[first!]!.tapped).toBe(true);
    expect(s.objects[first!]!.counters['stun']).toBe(1);
    expect(s.objects[second!]!.tapped).toBe(false);
    expect(s.objects[second!]!.counters['stun'] ?? 0).toBe(0);
    expect(s.objects[find(s, BEAR, 'battlefield', 'p1')]!.counters['stun'] ?? 0).toBe(0);
  });
  it('"up to one": it may target nothing, and then nothing is tapped or gets a counter', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Warden'] }, p2: { battlefield: [BEAR] }, defs: [WARDEN] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Warden', 'hand', 'p1') }));
    s = resolveAll(s, [[]]);
    const bear = find(s, BEAR, 'battlefield', 'p2');
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(s.objects[bear]!.counters['stun'] ?? 0).toBe(0);
  });
});

describe('CR 115.1, 601.2c, 608.2f, 701.8a: "When ~ enters, you may pay {1}. When you do, for each opponent, destroy up to one target creature that player controls."', () => {
  const DOOM = card('Test Doom', 'Artifact', 'When ~ enters, for each opponent, destroy up to one target creature that player controls.');
  it('is automated (no manual part)', () => expect(manualParts(DOOM)).toEqual([]));
  it('destroys the creature an opponent controls that was chosen; the other creatures stay, and so does everything p1 controls', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Doom'], battlefield: [BEAR] }, p2: { battlefield: [BEAR, BEAR] }, defs: [DOOM] });
    const [victim] = findAll(s0, BEAR, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Doom', [[], [obj(victim!)]]);
    expect(onBattlefield(s, 'p2')).toHaveLength(1);
    expect(s.objects[victim!]?.zone).not.toBe('battlefield');
    expect(onBattlefield(s, 'p1')).toHaveLength(2); // the Bears and the artifact
  });
});

describe('CR 115.1, 601.2c, 608.2f, 400.3: "For each opponent, return up to one target artifact or creature that player controls to its owner\'s hand."', () => {
  const GUST = card('Test Gust', 'Sorcery', 'For each opponent, return up to one target artifact or creature that player controls to its owner\'s hand.');
  const RELIC = card('Test Relic', 'Artifact', '');
  it('is automated (no manual part)', () => expect(manualParts(GUST)).toEqual([]));
  it('returns the chosen artifact or creature to its owner\'s hand, and only that one', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Gust'] }, p2: { battlefield: [BEAR, 'Test Relic'] }, defs: [GUST, RELIC] });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Gust', [[obj(relic)]]);
    expect(inHand(s, 'p2')).toContain('Test Relic');
    expect(names(s, onBattlefield(s, 'p2'))).toEqual([BEAR]);
  });
});

describe('CR 608.2c, 107.3: "Create a Treasure token. Then target creature gets +X/+0 until end of turn, where X is the number of artifacts you control."', () => {
  const FORGE = card('Test Forge', 'Instant', 'Create a Treasure token. Then target creature you control gets +X/+0 until end of turn, where X is the number of artifacts you control.');
  it('is automated (no manual part)', () => expect(manualParts(FORGE)).toEqual([]));
  it('the token is made first, so the count includes it', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Forge'], battlefield: [BEAR] }, defs: [FORGE] });
    const bear = find(s0, BEAR, 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Forge', [[obj(bear)]]);
    expect(Number(charsOfObject(s, s.objects[bear]!).power)).toBe(2 + 1); // 2/2 Bears plus one Treasure
  });
});

describe('CR 608.2d, 611.2a, 702.19: "Target creature gains your choice of trample, hexproof, or haste until end of turn."', () => {
  const BOON = card('Test Boon', 'Instant', 'Target creature gains your choice of trample, hexproof, or haste until end of turn.');
  it('is automated (no manual part)', () => expect(manualParts(BOON)).toEqual([]));
  for (const [i, kw] of ['trample', 'hexproof', 'haste'].entries()) {
    it(`choosing ${kw}: the creature has that keyword and neither of the others`, () => {
      const s0 = scenario([BEAR], { p1: { hand: ['Test Boon'], battlefield: [BEAR] }, defs: [BOON] });
      const bear = find(s0, BEAR, 'battlefield', 'p1');
      let offered: string[] = [];
      const s = castFirst(s0, 'Test Boon', [[obj(bear)]], (labels) => { offered = labels; return labels.findIndex((l) => l.toLowerCase().includes(kw)); });
      expect(offered.map((l) => l.toLowerCase()).join()).toContain('trample');
      const has = (k: string): boolean => hasKeyword(charsOfObject(s, s.objects[bear]!), k as never);
      expect(has(kw), kw).toBe(true);
      for (const other of ['trample', 'hexproof', 'haste'].filter((k) => k !== kw)) expect(has(other), `${kw} chosen, ${other}`).toBe(false);
      expect(i).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('CR 608.2h, 400.7, 202.3: "Exile target creature. If that creature\'s mana value was 3 or less, return it to the battlefield tapped under your control. Exile it at the beginning of the next end step."', () => {
  const TRIUMPH = card('Test Triumph', 'Instant', "Exile target creature. If that creature's mana value was 3 or less, return it to the battlefield tapped under your control. Exile it at the beginning of the next end step.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{4}{R}', ['4', '4']);
  it('is automated (no manual part)', () => expect(manualParts(TRIUMPH)).toEqual([]));
  it('mana value 3 or less: it comes back tapped under your control, and is exiled again at the beginning of the next end step', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Triumph'] }, p2: { battlefield: [BEAR] }, defs: [TRIUMPH] });
    const bear = find(s0, BEAR, 'battlefield', 'p2');
    let s = castFirst(s0, 'Test Triumph', [[obj(bear)]]);
    const back = onBattlefield(s, 'p1').filter((id) => defName(s, id) === BEAR);
    expect(back).toHaveLength(1);
    expect(s.objects[back[0]!]!.tapped).toBe(true);
    expect(onBattlefield(s, 'p2')).toHaveLength(0);
    for (let guard = 0; guard < 20 && s.turn.step !== 'end'; guard++) s = pass(s);
    for (let guard = 0; guard < 20 && s.zones.battlefield.some((id) => defName(s, id) === BEAR); guard++) s = pass(s);
    expect(s.zones.battlefield.some((id) => defName(s, id) === BEAR)).toBe(false);
  });
  it('mana value 4 or more: it stays exiled and nothing comes back', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Triumph'] }, p2: { battlefield: ['Test Ogre'] }, defs: [TRIUMPH, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    let s = castFirst(s0, 'Test Triumph', [[obj(ogre)]]);
    expect(s.zones.battlefield.some((id) => defName(s, id) === 'Test Ogre')).toBe(false);
    for (let guard = 0; guard < 20 && s.turn.step !== 'end'; guard++) s = pass(s);
    expect(s.zones.battlefield.some((id) => defName(s, id) === 'Test Ogre')).toBe(false);
    expect(s.zones.exile.some((id) => defName(s, id) === 'Test Ogre')).toBe(true);
  });
});

describe('CR 602.5b, 701.22d, 701.25d: "{0}: Return ~ from your graveyard to the battlefield. Activate only if you\'ve scried or surveilled this turn."', () => {
  const REVENANT = card('Test Revenant', 'Creature — Spirit', "{0}: Return ~ from your graveyard to the battlefield. Activate only if you've scried or surveilled this turn.", '{1}', ['1', '1']);
  const PEEK = card('Test Peek', 'Instant', 'Surveil 1.');
  const CAST = card('Test Pinch', 'Instant', 'You gain 1 life.');
  it('is automated (no manual part)', () => expect(manualParts(REVENANT)).toEqual([]));
  const activations = (s: GameState): number => legal(s, 'p1', 'activate').length;
  it('cannot be activated before the player has scried or surveilled this turn; can be after, and then returns it', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Peek', 'Test Pinch'], graveyard: ['Test Revenant'] }, defs: [REVENANT, PEEK, CAST] });
    expect(activations(s)).toBe(0);
    s = castFirst(s, 'Test Pinch'); // a spell cast, not a scry or a surveil
    expect(activations(s)).toBe(0);
    s = castFirst(s, 'Test Peek');
    expect(activations(s)).toBe(1);
    const a = legal(s, 'p1', 'activate')[0]!;
    s = resolveAll(act(s, a.action as never));
    expect(names(s, onBattlefield(s, 'p1'))).toContain('Test Revenant');
  });
});

describe('CR 602.5b, 601.2i (merge of lines C and D): "Activate only if you\'ve cast a creature spell this turn" is read from the turn\'s history', () => {
  // std-blb's one reader of this turn's history at announcement (model/forms.ts#turnHistoryAtAnnouncement) reads a filtered history too: the cast entry keeps
  // the spell's characteristics (rules/history.ts#historyMatches)
  const SEER = card('Test Seer', 'Creature — Elf', "{0}: You gain 1 life. Activate only if you've cast a creature spell this turn.", '{1}', ['1', '1']);
  const CUB = card('Test Cub', 'Creature — Cat', '', '{0}', ['1', '1']);
  const CAST = card('Test Pinch', 'Instant', 'You gain 1 life.');
  it('is automated (no manual part)', () => expect(manualParts(SEER)).toEqual([]));
  it('not after a noncreature spell; after a creature spell it can be activated', () => {
    const seer = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => a.label.includes('Test Seer')).length;
    let s = scenario([BEAR], { p1: { hand: ['Test Pinch', 'Test Cub'], battlefield: ['Test Seer'] }, defs: [SEER, CUB, CAST] });
    expect(seer(s)).toBe(0);
    s = castFirst(s, 'Test Pinch');
    expect(seer(s)).toBe(0);
    s = castFirst(s, 'Test Cub');
    expect(seer(s)).toBe(1);
  });
});

describe('CR 701.21a, 120.3, 608.2h, 119.3: "{0}: Draw a card. Then if you control four or more lands, sacrifice ~, it deals 3 damage to each opponent, and you gain 3 life."', () => {
  const EYE = card('Test Eye', 'Artifact', '{0}: Draw a card. Then if you control four or more lands, sacrifice ~, it deals 3 damage to each opponent, and you gain 3 life.');
  it('is automated (no manual part)', () => expect(manualParts(EYE)).toEqual([]));
  it('with four lands: sacrifices itself, deals the damage to the opponent and gains the life', () => {
    const s0 = scenario(['Forest'], { p1: { battlefield: ['Test Eye', 'Forest', 'Forest', 'Forest', 'Forest'] }, defs: [EYE] });
    const a = legal(s0, 'p1', 'activate')[0]!;
    const s = resolveAll(act(s0, a.action as never));
    expect(names(s, onBattlefield(s, 'p1'))).not.toContain('Test Eye');
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 3);
  });
  it('with fewer lands: nothing happens (it is not sacrificed)', () => {
    const s0 = scenario(['Forest'], { p1: { battlefield: ['Test Eye', 'Forest', 'Forest'] }, defs: [EYE] });
    const a = legal(s0, 'p1', 'activate')[0]!;
    const s = resolveAll(act(s0, a.action as never));
    expect(names(s, onBattlefield(s, 'p1'))).toContain('Test Eye');
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
  });
});
