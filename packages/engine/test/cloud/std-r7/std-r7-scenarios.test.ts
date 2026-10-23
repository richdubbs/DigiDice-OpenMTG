/**
 * Standard round 7 (hole readings): the readings of the round played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 701.21a, 608.2h        "Put X +1/+1 counters on target creature, where X is the number of permanents you've sacrificed this turn." (parser/holes/qty.ts)
 *   CR 400.1, 205.2a, 205.3   "Return target Vehicle or creature card from your graveyard to your hand." (parser/holes/filter.ts: a zone after a subtype-first list)
 *   CR 603.4, 608.2c          "If you control an Elf or if you control a Goblin, draw two cards." (parser/holes/cond.ts: "A or if B")
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const plusOnes = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

/** Answer the decisions that come up until priority (payments automatic; targets in order; other choices the first allowed). */
function drive(s0: GameState, targets: ObjectId[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: ObjectId[][]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets);
  return s;
}
const cast = (s: GameState, name: string, targets?: ObjectId[][]): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);
/** Activate the non-mana ability of `source` and let it resolve. */
function activate(s0: GameState, source: ObjectId): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && x.action.source === source && !x.isMana);
  expect(a, `an activation of ${source}`).toBeDefined();
  return resolveAll(drive(act(s0, a!.action)));
}

describe('CR 701.21a, 608.2h: "where X is the number of permanents you\'ve sacrificed this turn" (one per permanent you sacrificed, counted as the spell resolves)', () => {
  const FEAST = card('Test Grim Feast', 'Sorcery', "Put X +1/+1 counters on target creature, where X is the number of permanents you've sacrificed this turn.");
  const SNACKS = card('Test Snack Rite', 'Sorcery', "Put X +1/+1 counters on target creature, where X is the number of Foods you've sacrificed this turn.");
  const OFFERING = card('Test Offering', 'Artifact', 'Sacrifice this artifact: You gain 1 life.');
  const PIE = card('Test Pie', 'Artifact — Food', 'Sacrifice this artifact: You gain 1 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is understood', () => {
    expect(noManual(FEAST)).toBe(true);
    expect(noManual(SNACKS)).toBe(true);
  });
  it('two permanents sacrificed this turn: two counters', () => {
    let s = scenario([], { defs: [FEAST, OFFERING, BEAR], p1: { hand: ['Test Grim Feast'], battlefield: ['Test Bear'] } });
    const a = put(s, 'p1', 'battlefield', 'Test Offering');
    const b = put(s, 'p1', 'battlefield', 'Test Offering');
    s = activate(activate(s, a), b);
    expect(findAll(s, 'Test Offering', 'battlefield')).toHaveLength(0);
    const bear = find(s, 'Test Bear', 'battlefield');
    s = cast(s, 'Test Grim Feast', [[bear]]);
    expect(plusOnes(s, bear)).toBe(2);
  });
  it('nothing sacrificed this turn: no counter', () => {
    const s0 = scenario([], { defs: [FEAST, BEAR], p1: { hand: ['Test Grim Feast'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(plusOnes(cast(s0, 'Test Grim Feast', [[bear]]), bear)).toBe(0);
  });
  it('"Foods you\'ve sacrificed": only the sacrificed permanent that was a Food counts (the other artifact does not)', () => {
    let s = scenario([], { defs: [SNACKS, OFFERING, PIE, BEAR], p1: { hand: ['Test Snack Rite'], battlefield: ['Test Bear'] } });
    const a = put(s, 'p1', 'battlefield', 'Test Offering');
    const p = put(s, 'p1', 'battlefield', 'Test Pie');
    s = activate(activate(s, a), p);
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(plusOnes(cast(s, 'Test Snack Rite', [[bear]]), bear)).toBe(1);
  });
});

describe('CR 400.1, 205.2a, 205.3: "Return target Vehicle or creature card from your graveyard to your hand." (the zone belongs to both nouns of the list)', () => {
  const SALVAGE = card('Test Salvage Call', 'Sorcery', 'Return target Vehicle or creature card from your graveyard to your hand.');
  const WAGON = card('Test Wagon', 'Artifact — Vehicle', 'Crew 1', { pt: ['3', '3'] });
  const TROLL = card('Test Troll', 'Creature — Troll', '', { pt: ['2', '2'] });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  it('is understood', () => expect(noManual(SALVAGE)).toBe(true));
  it('a Vehicle card and a creature card in your graveyard can be chosen; an artifact card that is no Vehicle, and an opponent\'s creature card, cannot', () => {
    const s0 = scenario([], { defs: [SALVAGE, WAGON, TROLL, TRINKET], p1: { hand: ['Test Salvage Call'] } });
    const wagon = put(s0, 'p1', 'graveyard', 'Test Wagon');
    const troll = put(s0, 'p1', 'graveyard', 'Test Troll');
    const trinket = put(s0, 'p1', 'graveyard', 'Test Trinket');
    const theirs = put(s0, 'p2', 'graveyard', 'Test Troll');
    // the first decision is the target (no payment: the spell costs {0})
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Salvage Call', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = s.pending?.kind === 'chooseTargets' ? s.pending.objects : [];
    expect(options).toContain(wagon);
    expect(options).toContain(troll);
    expect(options).not.toContain(trinket);
    expect(options).not.toContain(theirs);
  });
  it('the chosen Vehicle card returns to your hand', () => {
    const s0 = scenario([], { defs: [SALVAGE, WAGON], p1: { hand: ['Test Salvage Call'] } });
    const wagon = put(s0, 'p1', 'graveyard', 'Test Wagon');
    const h0 = hand(s0, 'p1');
    const s = cast(s0, 'Test Salvage Call', [[wagon]]);
    expect(findAll(s, 'Test Wagon', 'hand', 'p1')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h0); // the spell left the hand, the Vehicle came back
  });
});

describe('CR 603.4, 608.2c: "If you control an Elf or if you control a Goblin, draw two cards." (either condition is enough)', () => {
  const HUNCH = card('Test Kin Hunch', 'Sorcery', 'Draw a card. If you control an Elf or if you control a Goblin, draw two cards.');
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  it('is understood', () => expect(noManual(HUNCH)).toBe(true));
  it('the second condition alone holds (a Goblin, no Elf): three cards', () => {
    const s0 = scenario([], { defs: [HUNCH, GOBLIN], p1: { hand: ['Test Kin Hunch'], battlefield: ['Test Goblin'] } });
    const h0 = hand(s0, 'p1');
    expect(hand(cast(s0, 'Test Kin Hunch'), 'p1')).toBe(h0 - 1 + 3);
  });
  it('neither holds (an Ogre only; an opponent\'s Goblin is not yours): one card', () => {
    const s0 = scenario([], { defs: [HUNCH, GOBLIN, OGRE], p1: { hand: ['Test Kin Hunch'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Goblin'] } });
    const h0 = hand(s0, 'p1');
    expect(hand(cast(s0, 'Test Kin Hunch'), 'p1')).toBe(h0 - 1 + 1);
  });
});
