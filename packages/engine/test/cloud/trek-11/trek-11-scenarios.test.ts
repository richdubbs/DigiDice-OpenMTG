/**
 * Lane trek, round trek-11 (Star Trek: The Holodeck, playing a card from outside the game), played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 400.11, 400.11a-b, 601.3  "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard." (the
 *                                `alsoOutside` permission, the `playOutside` special action): a nonland permanent card the player owns outside the game
 *                                (`GameState.outside`, their sideboard) is cast with its mana cost, as a card coming from no zone
 *   CR 305.1, 305.2              a land card from outside the game is played as the land drop: it counts as the land played this turn, and no second land is
 *   CR 400.11b, 601.3, 305.1     ONE use a turn for both places: a card played from outside the game spends the use of graveyard casts and land plays, and the
 *                                other way round; the next turn it is back
 *   CR 611.3a, 500.1             only during the turns of its controller
 *   CR 110.4, 400.11a            a nonpermanent card from outside the game, a card the player does not own (it is not in their sideboard), and a card whose
 *                                front face is no permanent card are not played; no permission once the Holodeck has left the battlefield
 *   CR 733.1                     cancelling the play puts the card back: it is still outside the game and the use is unspent
 *   CR 601.2a, 400.11            the spell is cast from no zone: "from your hand" does not match it, and "from anywhere other than your hand" does
 *   CR 404.1, 305.1, 601.3       the graveyard half: the same permission casts permanent cards and plays lands from the graveyard, never an instant
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, listLegalActions, type Action, type CardDef, type GameEvent, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { hasPriorityActions, hasPublicPriorityActions } from '../../../src/core/legal';
import { landCheck } from '../../../src/actions/land';
import { act, advanceTo, answer, find, findAll, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer every decision: payments automatically, targets in order from `targets`. */
function drive(s0: GameState, o: { targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Run `action`, pay, and let everything on the stack resolve. */
function play(s0: GameState, action: Action, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(act(s0, action), o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}

const HOLODECK = card('Test Holo Deck', 'Legendary Artifact', 'Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard.', { cost: '{7}' });
const BEAR = card('Test Outside Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}' });
const OTTER = card('Test Outside Otter', 'Creature — Otter', '', { pt: ['1', '1'], cost: '{1}' });
const ROCK = card('Test Outside Rock', 'Artifact', '', { cost: '{1}' });
const LAND = card('Test Outside Land', 'Land', '', { cost: '' });
const LAND2 = card('Test Outside Hills', 'Land', '', { cost: '' });
const BOLT = card('Test Outside Bolt', 'Instant', 'Test Outside Bolt deals 2 damage to any target.', { cost: '{1}' });
const GY_BEAR = card('Test Grave Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}' });
const GY_LAND = card('Test Grave Land', 'Land', '', { cost: '' });
const GY_BOLT = card('Test Grave Bolt', 'Instant', 'Test Grave Bolt deals 2 damage to any target.', { cost: '{1}' });
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.', { cost: '{0}' });
const FAN = card('Test Hand Fan', 'Creature — Bird', 'Whenever you cast a spell from your hand, you gain 1 life.', { pt: ['1', '1'] });
const WATCH = card('Test Odd Watch', 'Creature — Bird', 'Whenever you cast a spell from anywhere other than your hand, you gain 3 life.', { pt: ['1', '1'] });
const FLASHER = card('Test Flash Bat', 'Creature — Bat', 'Flash', { pt: ['1', '1'], cost: '{1}' });
const MAGISTRATE = card('Test Hand Warden', 'Creature — Human', "Your opponents can't cast spells from anywhere other than their hands.", { pt: ['1', '1'] });
const VOIDRULE = card('Test Grave Seal', 'Enchantment', "Players can't cast spells from graveyards or libraries.");
const DEFS = [HOLODECK, BEAR, OTTER, ROCK, LAND, LAND2, BOLT, GY_BEAR, GY_LAND, GY_BOLT, SHATTER, FAN, WATCH, FLASHER, MAGISTRATE, VOIDRULE];

/** Test Outside Dual: a modal double-faced card whose front face is a creature and whose back face is a land (CR 712.8a: outside the game it has its front face only). */
const MDFC = compileCard({
  name: 'Test Dual Bear // Test Dual Cave', layout: 'modal_dfc', mana_cost: '{1}', type_line: 'Creature — Bear // Land', oracle_text: '', colors: [], power: '2', toughness: '2',
  card_faces: [
    { name: 'Test Dual Bear', mana_cost: '{1}', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
    { name: 'Test Dual Cave', mana_cost: '', type_line: 'Land', oracle_text: '' },
  ],
} as unknown as OracleCard);

/** A game at turn 1's first main phase with the Holodeck and two Plains on p1's battlefield, `outside` as the cards each player owns outside the game. */
function game(o: { outside?: Partial<Record<PlayerId, string[]>>; p1?: Parameters<typeof scenario>[1] extends infer X ? (X extends { p1?: infer P } ? P : never) : never; p2?: object; extra?: CardDef[] } = {}): GameState {
  const s = scenario([], {
    defs: [...DEFS, MDFC, ...(o.extra ?? [])],
    p1: { ...(o.p1 ?? {}), battlefield: ['Test Holo Deck', 'Plains', 'Plains', ...(o.p1?.battlefield ?? [])] },
    ...(o.p2 ? { p2: o.p2 } : {}),
  });
  s.outside = { p1: o.outside?.p1 ?? [], p2: o.outside?.p2 ?? [] };
  return s;
}
const offers = (s: GameState, who: PlayerId = 'p1') => listLegalActions(s, who).filter((a) => a.action.type === 'special' && a.action.kind === 'playOutside');
const labels = (s: GameState, who: PlayerId = 'p1'): string[] => offers(s, who).map((a) => a.label).sort();
const play1 = (s: GameState, name: string): GameState => play(s, offers(s).find((a) => a.label.endsWith(`${name} from outside the game`))!.action);
const outsideOf = (s: GameState, who: PlayerId = 'p1'): string[] => [...(s.outside?.[who] ?? [])];
const gyCastActions = (s: GameState, name: string) => listLegalActions(s, 'p1').filter((a) => a.action.type === 'cast' && a.object === find(s, name, 'graveyard', 'p1'));
const lifeOf = (s: GameState, p: PlayerId = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const used = (s: GameState): number => Object.entries(s.turnActivations).filter(([k]) => k.includes('|gy:')).reduce((n, [, v]) => n + v, 0);

describe('the Holodeck card and the synthetic cards are fully automated', () => {
  it('the permission is a full static ability', () => expect(full(HOLODECK)).toBe(true));
  it('the other synthetic cards are full', () => {
    for (const d of [BEAR, OTTER, ROCK, LAND, BOLT, FAN, WATCH, SHATTER]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 400.11b, 601.3: a permanent card from outside the game is cast with the permission', () => {
  it('is offered by name, cast for its mana cost as a card from no zone, and the card leaves "outside the game" for the battlefield', () => {
    let s = game({ outside: { p1: ['Test Outside Bear', 'Test Outside Rock'] } });
    expect(labels(s)).toEqual(['Cast Test Outside Bear from outside the game', 'Cast Test Outside Rock from outside the game']);
    const action = offers(s).find((a) => a.label.includes('Bear'))!.action as Extract<Action, { type: 'special' }>;
    expect(action).toMatchObject({ type: 'special', kind: 'playOutside', player: 'p1', outside: 'Test Outside Bear' });
    expect(action.object).toBeUndefined();
    const r = applyAction(s, action); // the cast pauses for the payment: the spell is on the stack, from no zone
    expect(r.error).toBeUndefined();
    const move = r.events.find((e): e is Extract<GameEvent, { type: 'zoneChanged' }> => e.type === 'zoneChanged' && e.to === 'stack');
    expect(move?.from).toBeNull(); // CR 400.11b: it came from no zone
    expect(r.state.zones.stack).toHaveLength(1);
    expect(r.state.objects[r.state.zones.stack[0]!]!.stack?.castFrom).toBe('outside');
    s = play(s, action);
    const bear = find(s, 'Test Outside Bear', 'battlefield', 'p1');
    expect(s.objects[bear]!.cast?.from).toBe('outside');
    expect(outsideOf(s)).toEqual(['Test Outside Rock']); // only that card left the sideboard
    expect(s.zones.hand.p1!.length).toBe(0); // it never went through the hand
    expect(used(s)).toBe(1); // the permission's use
    // the mana cost was paid: one of the two Plains is tapped
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(1);
  });
  it('the same card name twice outside the game: one copy is played, the other stays', () => {
    let s = game({ outside: { p1: ['Test Outside Bear', 'Test Outside Bear'] } });
    expect(labels(s)).toEqual(['Cast Test Outside Bear from outside the game']); // one offer for the two copies
    s = play1(s, 'Test Outside Bear');
    expect(outsideOf(s)).toEqual(['Test Outside Bear']);
  });
  it('the cost is checked: with no mana for it the card is not offered (the negative case)', () => {
    const s = game({ outside: { p1: ['Test Outside Bear'] } });
    for (const id of s.zones.battlefield) if (s.objects[id]!.defId === 'Plains') s.objects[id]!.tapped = true;
    expect(offers(s)).toEqual([]);
  });
  it('CR 601.3: the sorcery timing of a permanent spell applies: not with a spell on the stack, not in combat', () => {
    let s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { hand: ['Test Outside Rock'] } as never });
    expect(offers(s)).toHaveLength(1); // the control: with the stack empty it is offered
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Outside Rock', 'hand', 'p1') });
    s = drive(s);
    expect(s.zones.stack).toHaveLength(1);
    expect(offers(s)).toEqual([]); // the stack is not empty (CR 307.1)
  });
  it('CR 702.8a: a card with flash from outside the game is a spell like any other, cast at the speed of its type (offered with the stack empty on the player\'s own turn)', () => {
    const s = game({ outside: { p1: ['Test Flash Bat'] } });
    expect(labels(s)).toEqual(['Cast Test Flash Bat from outside the game']);
  });
});

describe('CR 305.1, 305.2: a land card from outside the game is played as the land drop', () => {
  it('is played as a land (no spell, no stack), counts as the land played this turn, and the play is a land play of the permission', () => {
    let s = game({ outside: { p1: ['Test Outside Land', 'Test Outside Hills'] } });
    expect(labels(s)).toEqual(['Play Test Outside Hills from outside the game', 'Play Test Outside Land from outside the game']);
    const action = offers(s).find((a) => a.label.includes('Land'))!.action;
    const r = applyAction(s, action);
    expect(r.error).toBeUndefined();
    expect(r.state.pending?.kind).toBe('priority'); // a special action: no stack, no decision, the player keeps priority (CR 116.2a)
    expect(r.state.zones.stack).toHaveLength(0);
    expect(r.events.find((e) => e.type === 'landPlayed')).toBeDefined();
    const landed = r.events.find((e): e is Extract<GameEvent, { type: 'landPlayed' }> => e.type === 'landPlayed')!;
    expect(landed.from).toBe('outside'); // from no zone: not "from exile", not "from your hand"
    s = r.state;
    expect(s.objects[find(s, 'Test Outside Land', 'battlefield', 'p1')]!.zone).toBe('battlefield');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(outsideOf(s)).toEqual(['Test Outside Hills']);
    expect(offers(s)).toEqual([]); // the land drop and the permission's use are both spent
    expect(used(s)).toBe(1);
  });
  it('the land drop of the turn counts: after a land from the hand, no land from outside the game (the negative case)', () => {
    let s = game({ outside: { p1: ['Test Outside Land'] }, p1: { hand: ['Plains'] } as never });
    expect(labels(s)).toEqual(['Play Test Outside Land from outside the game']); // the control: before the land drop is used it is offered
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') });
    expect(offers(s)).toEqual([]);
    const e = reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Land' });
    expect(e.message).toMatch(/land/i);
  });
  it('a land from outside the game and a spell: the permission is used once, so the spell is not offered after the land (and the other way round)', () => {
    let s = game({ outside: { p1: ['Test Outside Land', 'Test Outside Bear'] } });
    s = play1(s, 'Test Outside Land');
    expect(offers(s)).toEqual([]);
    let t = game({ outside: { p1: ['Test Outside Land', 'Test Outside Bear'] } });
    t = play1(t, 'Test Outside Bear');
    expect(offers(t)).toEqual([]); // the permission is spent (the land drop is still free)
    expect(t.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(0);
  });
  it('an MDFC whose front face is a creature and whose back face is a land: cast as the creature, never played as the land (outside the game it has its front face only, CR 712.8a)', () => {
    let s = game({ outside: { p1: ['Test Dual Bear // Test Dual Cave'] } });
    expect(labels(s)).toEqual(['Cast Test Dual Bear from outside the game']);
    s = play1(s, 'Test Dual Bear');
    expect(findAll(s, 'Test Dual Bear // Test Dual Cave', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 400.11b, 601.3: one use each turn for the graveyard and outside the game together', () => {
  it('a card played from outside the game spends the use: the graveyard card and another outside card are not offered; the next turn it is back', () => {
    let s = game({ outside: { p1: ['Test Outside Bear', 'Test Outside Otter'] }, p1: { graveyard: ['Test Grave Bear', 'Test Grave Land'] } as never });
    expect(labels(s)).toHaveLength(2);
    expect(gyCastActions(s, 'Test Grave Bear')).toHaveLength(1);
    s = play1(s, 'Test Outside Bear');
    expect(offers(s)).toEqual([]);
    expect(gyCastActions(s, 'Test Grave Bear')).toEqual([]);
    expect(listLegalActions(s, 'p1').filter((a) => a.kind === 'playLand')).toEqual([]); // the graveyard land too
    s = advanceTo(s, 3, 'main1');
    expect(labels(s)).toEqual(['Cast Test Outside Otter from outside the game']);
    expect(gyCastActions(s, 'Test Grave Bear')).toHaveLength(1);
  });
  it('a card cast from the graveyard spends it the other way round: nothing is offered from outside the game afterwards', () => {
    let s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { graveyard: ['Test Grave Bear'] } as never });
    s = play(s, gyCastActions(s, 'Test Grave Bear')[0]!.action);
    expect(findAll(s, 'Test Grave Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(offers(s)).toEqual([]);
    expect(() => reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear' })).not.toThrow();
  });
  it('a land played from the graveyard spends it too (CR 305.2)', () => {
    let s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { graveyard: ['Test Grave Land'] } as never });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Grave Land', 'graveyard', 'p1') });
    expect(offers(s)).toEqual([]);
  });
  it('the graveyard half casts a permanent card and plays a land, and never an instant (CR 110.4)', () => {
    const s = game({ p1: { graveyard: ['Test Grave Bear', 'Test Grave Land', 'Test Grave Bolt'] } as never });
    expect(gyCastActions(s, 'Test Grave Bear')).toHaveLength(1);
    expect(gyCastActions(s, 'Test Grave Bolt')).toEqual([]);
    expect(listLegalActions(s, 'p1').filter((a) => a.kind === 'playLand').map((a) => a.object)).toEqual([find(s, 'Test Grave Land', 'graveyard', 'p1')]);
  });
});

describe('CR 611.3a, 500.1: only during the turns of the Holodeck\'s controller', () => {
  it('nothing is offered from outside the game on an opponent\'s turn, even a card with flash (the negative case); on the controller\'s own turn it is', () => {
    let s = game({ outside: { p1: ['Test Flash Bat', 'Test Outside Land'] }, p1: { graveyard: ['Test Grave Bear'] } as never });
    expect(labels(s)).toHaveLength(2);
    s = advanceTo(s, 2, 'main1');
    expect(offers(s)).toEqual([]);
    expect(gyCastActions(s, 'Test Grave Bear')).toEqual([]);
    expect(() => act(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Flash Bat' })).toThrow();
    s = advanceTo(s, 3, 'main1');
    expect(labels(s)).toHaveLength(2);
  });
});

describe('CR 110.4, 400.11a: what may not be played from outside the game', () => {
  it('a nonpermanent card (an instant) is not offered and a direct action is refused', () => {
    const s = game({ outside: { p1: ['Test Outside Bolt', 'Test Outside Bear'] } });
    expect(labels(s)).toEqual(['Cast Test Outside Bear from outside the game']); // the permanent card is offered, the instant is not
    const e = reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bolt' });
    expect(e.message).toMatch(/permanent card/);
  });
  it('a card the player does not own: the opponent\'s sideboard is not theirs to play from, and naming a card the player has not is refused', () => {
    const s = game({ outside: { p1: ['Test Outside Otter'], p2: ['Test Outside Bear'] } });
    expect(labels(s, 'p1')).toEqual(['Cast Test Outside Otter from outside the game']); // the control: p1's own card is offered, p2's is not
    const e = reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear' });
    expect(e.message).toMatch(/own no such card/);
    expect(s.outside!.p2).toEqual(['Test Outside Bear']); // untouched
  });
  it('a card in the opponent\'s graveyard is not covered either (a card you own, from your graveyard)', () => {
    const s = game({ p2: { graveyard: ['Test Grave Bear'] } });
    expect(listLegalActions(s, 'p1').filter((a) => a.action.type === 'cast' && a.object === find(s, 'Test Grave Bear', 'graveyard', 'p2'))).toEqual([]);
  });
  it('an action with an object, or with no card named, is refused (a card outside the game is in no zone)', () => {
    const s = game({ outside: { p1: ['Test Outside Bear'] } });
    reject(s, { type: 'special', player: 'p1', kind: 'playOutside' });
    reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear', object: find(s, 'Test Holo Deck', 'battlefield', 'p1') });
  });
  it('a player with no Holodeck has nothing offered, and a refused action leaves the very same state (the card is still outside the game)', () => {
    const s = scenario([], { defs: [...DEFS], p1: { battlefield: ['Plains', 'Plains'] } });
    s.outside = { p1: ['Test Outside Bear'], p2: [] };
    expect(offers(s)).toEqual([]);
    const e = reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear' });
    expect(e.message).toMatch(/No effect lets you cast/);
    expect(outsideOf(s)).toEqual(['Test Outside Bear']);
  });
  it('no permission after the Holodeck leaves the battlefield', () => {
    let s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { hand: ['Test Shatter'] } as never });
    expect(offers(s)).toHaveLength(1);
    s = play(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shatter', 'hand', 'p1') }, { targets: [[find(s, 'Test Holo Deck', 'battlefield', 'p1')]] });
    expect(findAll(s, 'Test Holo Deck', 'battlefield', 'p1')).toEqual([]);
    expect(offers(s)).toEqual([]);
    reject(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear' });
  });
});

describe('CR 733.1: cancelling the play puts the card back', () => {
  it('the card is still outside the game, the permission\'s use is unspent and the very same offers come back', () => {
    const s0 = game({ outside: { p1: ['Test Outside Bear'] } });
    const action = offers(s0)[0]!.action;
    let s = act(s0, action);
    expect(s.pending?.kind).toBe('payCost');
    expect(s.zones.stack).toHaveLength(1);
    s = act(s, { type: 'cancel', player: 'p1' });
    expect(outsideOf(s)).toEqual(['Test Outside Bear']);
    expect(s.zones.stack).toHaveLength(0);
    expect(used(s)).toBe(0);
    expect(labels(s)).toEqual(['Cast Test Outside Bear from outside the game']);
    expect(s.zones.hand.p1).toEqual([]); // no staging card is left anywhere
  });
});

describe('CR 400.11b, 601.3, 608.3: every kind of permanent card comes through the cast intact (targets, counters, enters triggers, "if you cast it")', () => {
  const ANVIL = card('Test Anvil Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const AURA = card('Test Outside Halo', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', { cost: '{1}' });
  const SAGA = card('Test Outside Saga', 'Enchantment — Saga', 'I — You gain 2 life.\nII — You gain 3 life.\nIII — You gain 4 life.', { cost: '{1}' });
  const WALKER = compileCard({ name: 'Test Outside Walker', layout: 'normal', mana_cost: '{1}', type_line: 'Legendary Planeswalker — Test', oracle_text: '+1: You gain 1 life.', colors: [], loyalty: '3' } as unknown as OracleCard);
  const PROUD = card('Test Outside Proud', 'Creature — Bear', 'When ~ enters, if you cast it, you gain 5 life.', { pt: ['1', '1'], cost: '{1}' });
  const CALM = card('Test Outside Calm', 'Creature — Bear', 'When ~ enters, you gain 3 life.', { pt: ['1', '1'], cost: '{1}' });
  const extra = [ANVIL, AURA, SAGA, WALKER, PROUD, CALM];
  const fresh = (name: string) => game({ outside: { p1: [name] }, p1: { battlefield: ['Test Anvil Bear'] } as never, extra });
  it('an Aura asks for its target on the way, enters attached, and is the opponent-visible spell cast from no zone', () => {
    let s = fresh('Test Outside Halo');
    const anvil = find(s, 'Test Anvil Bear', 'battlefield', 'p1');
    s = play(s, offers(s)[0]!.action, { targets: [[anvil]] });
    const halo = find(s, 'Test Outside Halo', 'battlefield', 'p1');
    expect(s.objects[halo]!.attachedTo).toBe(anvil);
  });
  it('a Saga enters with a lore counter and its first chapter happens (CR 714.3a)', () => {
    let s = fresh('Test Outside Saga');
    const before = lifeOf(s);
    s = play(s, offers(s)[0]!.action);
    const saga = find(s, 'Test Outside Saga', 'battlefield', 'p1');
    expect(s.objects[saga]!.counters['lore']).toBe(1);
    expect(lifeOf(s)).toBe(before + 2);
  });
  it('a planeswalker enters with its loyalty (CR 306.5b)', () => {
    let s = fresh('Test Outside Walker');
    s = play(s, offers(s)[0]!.action);
    expect(s.objects[find(s, 'Test Outside Walker', 'battlefield', 'p1')]!.counters['loyalty']).toBe(3);
  });
  it('"When ~ enters, if you cast it" is true for it: it WAS cast (by its owner, from outside the game); an ordinary enters trigger happens too', () => {
    let s = fresh('Test Outside Proud');
    const before = lifeOf(s);
    s = play(s, offers(s)[0]!.action);
    expect(lifeOf(s)).toBe(before + 5);
    let t = fresh('Test Outside Calm');
    const b2 = lifeOf(t);
    t = play(t, offers(t)[0]!.action);
    expect(lifeOf(t)).toBe(b2 + 3);
  });
});

describe('determinism: a game is its configuration and its action log (the replay model)', () => {
  it('the same action on the same state gives the same state and events, before and after the payment decision; a cancelled play and a new one reach the same state', () => {
    const s0 = game({ outside: { p1: ['Test Outside Bear', 'Test Outside Otter'] } });
    const bear = offers(s0).find((a) => a.label.includes('Bear'))!.action;
    const a = applyAction(s0, bear);
    const b = applyAction(s0, bear);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    const paid1 = answer(a.state, { kind: 'payCost', auto: true });
    const paid2 = answer(b.state, { kind: 'payCost', auto: true });
    expect(JSON.stringify(paid2)).toBe(JSON.stringify(paid1));
    // cancel, then play the other card: the cancelled attempt left nothing behind (not even a card id counter or an object)
    const cancelled = act(a.state, { type: 'cancel', player: 'p1' });
    const otter = offers(cancelled).find((x) => x.label.includes('Otter'))!.action;
    const direct = applyAction(s0, otter);
    const viaCancel = applyAction(cancelled, otter);
    expect(Object.keys(viaCancel.state.objects).length).toBe(Object.keys(direct.state.objects).length);
    expect(viaCancel.state.counters.object - cancelled.counters.object).toBe(direct.state.counters.object - s0.counters.object);
  });
});

describe('CR 601.2a, 400.11: a card played from outside the game is cast from no zone', () => {
  it('"Whenever you cast a spell from your hand" does not trigger for it, and does for a card from the hand (the negative case)', () => {
    expect(full(FAN)).toBe(true);
    let s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { battlefield: ['Test Hand Fan'], hand: ['Test Outside Rock'] } as never });
    const before = lifeOf(s);
    s = play1(s, 'Test Outside Bear');
    expect(lifeOf(s)).toBe(before);
    // the Holodeck's use is spent, but the hand card is an ordinary cast
    s = play(s, { type: 'cast', player: 'p1', card: find(s, 'Test Outside Rock', 'hand', 'p1') });
    expect(lifeOf(s)).toBe(before + 1);
  });
  it('"Whenever you cast a spell from anywhere other than your hand" does trigger for it: plainly it was not cast from the hand (a judgement, Star Trek\'s rules text is not out yet)', () => {
    expect(full(WATCH)).toBe(true);
    let s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { battlefield: ['Test Odd Watch'], hand: ['Test Outside Rock'] } as never });
    const before = lifeOf(s);
    s = play1(s, 'Test Outside Bear');
    expect(lifeOf(s)).toBe(before + 3);
    // the negative case: a cast from the hand is not "from anywhere other than your hand"
    s = play(s, { type: 'cast', player: 'p1', card: find(s, 'Test Outside Rock', 'hand', 'p1') });
    expect(lifeOf(s)).toBe(before + 3);
  });
  it('"Whenever you play a land from anywhere other than your hand" sees a land from outside the game; "from exile" does not (the zone it came from is "outside")', () => {
    const s = game({ outside: { p1: ['Test Outside Land'] } });
    const r = applyAction(s, offers(s)[0]!.action);
    const landed = r.events.find((e): e is Extract<GameEvent, { type: 'landPlayed' }> => e.type === 'landPlayed')!;
    expect(landed.from).toBe('outside');
    expect(landed.from).not.toBe('hand');
    expect(landed.from).not.toBe('exile');
  });
});

describe('CR 601.3, 101.2: the rules that look at where a spell is cast from see a card from outside the game as cast from no zone', () => {
  it('"Your opponents can\'t cast spells from anywhere other than their hands" stops it (it is not cast from a hand); a card cast from the hand is unaffected', () => {
    expect(full(MAGISTRATE)).toBe(true);
    const s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { hand: ['Test Outside Rock'] } as never });
    expect(offers(s)).toHaveLength(1); // the control: without the Warden the card is offered
    const t = scenario([], { defs: [...DEFS, MDFC], p1: { battlefield: ['Test Holo Deck', 'Plains', 'Plains'], hand: ['Test Outside Rock'] }, p2: { battlefield: ['Test Hand Warden'] } });
    t.outside = { p1: ['Test Outside Bear'], p2: [] };
    expect(offers(t)).toEqual([]);
    reject(t, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear' });
    expect(listLegalActions(t, 'p1').some((a) => a.action.type === 'cast' && a.object === find(t, 'Test Outside Rock', 'hand', 'p1'))).toBe(true);
  });
  it('"Players can\'t cast spells from graveyards or libraries" stops the graveyard half and not the card from outside the game (it names two zones, and outside the game is none)', () => {
    expect(full(VOIDRULE)).toBe(true);
    const s = game({ outside: { p1: ['Test Outside Bear'] }, p1: { graveyard: ['Test Grave Bear'], battlefield: ['Test Grave Seal'] } as never });
    expect(gyCastActions(s, 'Test Grave Bear')).toEqual([]);
    expect(labels(s)).toEqual(['Cast Test Outside Bear from outside the game']);
  });
});

describe('information and the other players', () => {
  it('the cards outside the game are a hidden place: a public question leaves the action out, the owner\'s own question has it', () => {
    const s = game({ outside: { p1: ['Test Outside Bear'] } });
    const g = new Game(s);
    expect(hasPriorityActions(g, 'p1')).toBe(true);
    expect(hasPublicPriorityActions(g, 'p1')).toBe(false); // nothing else to do: Holodeck, two Plains (mana abilities don't count)
  });
  it('a land play check on the card staged from outside the game refuses without the permission (the staging object is not a hand card)', () => {
    const s = scenario([], { defs: [...DEFS], p1: { battlefield: ['Plains'] } });
    s.outside = { p1: ['Test Outside Land'], p2: [] };
    const r = applyAction(s, { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Land' });
    expect(r.error?.message).toMatch(/No effect lets you play/);
    expect(landCheck).toBeTypeOf('function');
  });
});

describe('another once-each-turn graveyard permission next to the Holodeck (review finding)', () => {
  const WALKER = card('Test Yard Walker', 'Creature — Elf', 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.', { pt: ['1', '1'] });
  for (const order of [['Test Holo Deck', 'Test Yard Walker'], ['Test Yard Walker', 'Test Holo Deck']]) {
    it(`a graveyard land play spends the permission that cannot reach outside the game, whatever the order (${order.join(' then ')})`, () => {
      const s0 = scenario([], { defs: [...DEFS, WALKER], p1: { battlefield: [...order, 'Plains', 'Plains'], graveyard: ['Test Grave Land'] } });
      s0.outside = { p1: ['Test Outside Bear'], p2: [] };
      const s1 = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Grave Land', 'graveyard', 'p1') });
      expect(labels(s1)).toEqual(['Cast Test Outside Bear from outside the game']);
    });
    it(`a plain graveyard cast does the same (${order.join(' then ')})`, () => {
      const s0 = scenario([], { defs: [...DEFS, WALKER], p1: { battlefield: [...order, 'Plains', 'Plains'], graveyard: ['Test Grave Bear'] } });
      s0.outside = { p1: ['Test Outside Rock'], p2: [] };
      const s1 = play(s0, gyCastActions(s0, 'Test Grave Bear').find((a) => (a.action as { method?: string }).method === undefined)!.action);
      expect(labels(s1)).toEqual(['Cast Test Outside Rock from outside the game']);
    });
  }
});
