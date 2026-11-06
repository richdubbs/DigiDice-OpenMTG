/**
 * Commander effort, coordinator B, round edh-b-10 (EDHREC ranks 9,001 to 10,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games, with their negative cases. CR cites from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 108.3, 700.4, 603.2     "Whenever a permanent owned by another player is put into a graveyard from the battlefield, ..." / "a creature owned by an opponent dies"
 *   CR 120.2b, 603.2c          "Whenever ~ is dealt noncombat damage, create that many Treasure tokens."
 *   CR 120.3, 614.1a, 611.2a   "If a source would deal damage to a player or battle this turn, it deals that much damage plus 2 instead."
 */
import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, GameState, ObjectId, PlayerId } from '../../../src/index';
import { answer as manswer, act as mact, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const treasures = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p && s.objects[id]!.defId.includes('Treasure')).length;

/** Answers whatever is asked (first legal target, auto payment, yes) and passes priority until the stack is empty. */
function run(s0: GameState, until?: (s: GameState) => boolean): GameState {
  let s = s0;
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; options?: ObjectId[]; objects?: ObjectId[] };
    if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: (d.objects ?? []).slice(0, Math.max(d.min ?? 1, 1)).map((id) => ({ kind: 'object', id })) } as DecisionAnswer;
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: (d.options ?? []).slice(0, d.min ?? 0) };
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (until === undefined || until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}`);
    s = manswer(s, a);
  }
  return s;
}
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);
const castIt = (s: GameState, player: PlayerId, name: string): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });

describe('CR 108.3, 603.2: "a permanent owned by another player is put into a graveyard from the battlefield" (owned by an opponent / another player)', () => {
  const HOARD = card('Test Grave Hoarder', 'Creature — Horror', 'Whenever a permanent owned by another player is put into a graveyard from the battlefield, you draw a card and you lose 1 life.', ['2', '2']);
  const SEER = card('Test Grave Seer', 'Creature — Wizard', 'Whenever a creature owned by an opponent dies, you draw a card.', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['1', '1']);
  const CHARM = card('Test Doom Charm', 'Sorcery', 'Destroy target creature.');
  const LIB = card('Test Filler', 'Sorcery', '');
  const defs = [HOARD, SEER, BEAR, CHARM, LIB];
  const zones = (): NonNullable<Parameters<typeof mpScenario>[0]>['zones'] => ({ p1: { battlefield: ['Test Grave Hoarder', 'Test Grave Seer', 'Test Plain Bear'], hand: ['Test Doom Charm'] }, p2: { battlefield: ['Test Plain Bear'] } });
  it('are automated', () => { for (const d of [HOARD, SEER]) expect(full(d)).toBe(true); });
  it('a creature of another player destroyed: the controller of the Hoarder draws a card and loses 1 life; the Seer draws too', () => {
    let s = toMain(mpScenario({ defs, zones: zones() }), 'p1');
    const before = handSize(s, 'p1');
    s = castIt(s, 'p1', 'Test Doom Charm');
    s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: mfind(s, 'Test Plain Bear', 'battlefield', 'p2') }] } as DecisionAnswer);
    s = run(s);
    expect(bf(s, 'Test Plain Bear', 'p2')).toHaveLength(0);
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(handSize(s, 'p1')).toBe(before - 1 + 2); // the Charm left the hand, two cards drawn
  });
  it('negative: a creature the Hoarder\'s own controller owns dying never triggers', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Grave Hoarder', 'Test Grave Seer'], hand: ['Test Doom Charm'] } } }), 'p1');
    const before = handSize(s, 'p1');
    s = castIt(s, 'p1', 'Test Doom Charm');
    s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: mfind(s, 'Test Grave Seer', 'battlefield', 'p1') }] } as DecisionAnswer);
    s = run(s);
    expect(bf(s, 'Test Grave Seer', 'p1')).toHaveLength(0);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(before - 1);
  });
});

describe('CR 120.2b, 603.2c: "Whenever ~ is dealt noncombat damage, create that many Treasure tokens."', () => {
  const DRAGON = card('Test Hoard Wyrm', 'Creature — Dragon', 'Whenever ~ is dealt noncombat damage, create that many Treasure tokens.', ['2', '5']);
  const BOLT = card('Test Spark Bolt', 'Instant', '~ deals 2 damage to target creature.');
  const GNAW = card('Test Gnaw Bear', 'Creature — Bear', '', ['3', '3']);
  const defs = [DRAGON, BOLT, GNAW];
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  it('noncombat damage: dealt 2 by a spell makes two Treasure tokens', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Hoard Wyrm'], hand: ['Test Spark Bolt'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Spark Bolt'));
    expect(treasures(s, 'p1')).toBe(2);
  });
  it('negative: combat damage dealt to it makes no Treasure', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Hoard Wyrm'] }, p2: { battlefield: ['Test Gnaw Bear'] } } }), 'p2');
    const bear = mfind(s, 'Test Gnaw Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bear, 'p1']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    const wyrm = bf(s, 'Test Hoard Wyrm', 'p1')[0]!;
    s = manswer(s, { kind: 'declareBlockers', blocks: [{ blocker: wyrm, attacker: bear }] } as DecisionAnswer);
    s = run(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2');
    expect(treasures(s, 'p1')).toBe(0);
  });
});

describe('CR 120.3, 614.1a, 611.2a: "If a source would deal damage to a player or battle this turn, it deals that much damage plus 2 instead."', () => {
  const RITE = card('Test Fury Rite', 'Sorcery', 'If a source would deal damage to a player or battle this turn, it deals that much damage plus 2 instead.');
  const BOLT = card('Test Spark Bolt', 'Instant', '~ deals 1 damage to any target.');
  const GNAW = card('Test Gnaw Bear', 'Creature — Bear', '', ['3', '3']);
  const defs = [RITE, BOLT, GNAW];
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('a player is dealt 1 +2 = 3 this turn', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Fury Rite', 'Test Spark Bolt'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Fury Rite'));
    s = castIt(s, 'p1', 'Test Spark Bolt');
    // the Bolt's target: a player (run picks object targets only), so choose p2 by hand
    let guard = 0;
    while (s.pending?.kind === 'chooseTargets' && guard++ < 3) s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    s = run(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative: damage to a creature is not increased', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Fury Rite', 'Test Spark Bolt'] }, p2: { battlefield: ['Test Gnaw Bear'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Fury Rite'));
    s = castIt(s, 'p1', 'Test Spark Bolt');
    const bear = mfind(s, 'Test Gnaw Bear', 'battlefield', 'p2');
    let guard = 0;
    while (s.pending?.kind === 'chooseTargets' && guard++ < 3) s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as DecisionAnswer);
    s = run(s);
    expect(bf(s, 'Test Gnaw Bear', 'p2')).toHaveLength(1); // 1 damage on a 3/3 (a +2 would have killed it)
  });
});

describe('fail closed: the readings of this round do not stretch', () => {
  it('"owned by you" and "owned by a player" are not read; "is dealt noncombat damage by" and a replacement without "this turn" stay manual', () => {
    expect(full(card('Test A', 'Creature — Horror', 'Whenever a creature owned by you dies, draw a card.', ['1', '1']))).toBe(false);
    expect(full(card('Test B', 'Creature — Horror', 'Whenever a creature owned by a player dies, draw a card.', ['1', '1']))).toBe(false);
    expect(full(card('Test C', 'Creature — Horror', 'Whenever ~ is dealt noncombat damage by a red source, draw a card.', ['1', '1']))).toBe(false);
    expect(full(card('Test D', 'Sorcery', 'If a source would deal damage to a player or planeswalker or battle this turn, it deals that much damage plus 2 instead.'))).toBe(false);
  });
});
