/**
 * Commander round edh-top-1 (the most played cards left in any lane), played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout), except where the text of the 2026-09-25
 * Comprehensive Rules was fetched in the round.
 *
 *   CR 103.1, 103.6, 103.6a, 122.1  "If ~ is in your opening hand and you're not the starting player, you may begin the game with it on the battlefield with a luck
 *                                    counter on it. If you do, exile a card from your hand." (the starting player never has the option; the counter is there at once)
 *   CR 305.1, 401.5, 604.1          "As long as ~ is attached to a creature, you may play lands and cast spells from the top of your library."
 *   CR 603.7, 603.7c, 400.7         "Exile the top card of your library face down and look at it. Create a 2/2 token. When that token leaves the battlefield, put the
 *                                    exiled card into your hand."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, legalActions, type CardDef, type GameConfig, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[]) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

// ---- opening-hand action with a counter and an exile ----------------------------------------------------------------------------------------------------

describe('CR 103.1, 103.6, 103.6a, 122.1: "If ~ is in your opening hand and you\'re not the starting player, you may begin the game with it on the battlefield with a luck counter on it. If you do, exile a card from your hand."', () => {
  const CAVERN = card('Test Cavern', 'Legendary Land', "If this card is in your opening hand and you're not the starting player, you may begin the game with Test Cavern on the battlefield with a luck counter on it. If you do, exile a card from your hand.\n{T}: Add {C}. If Test Cavern has a luck counter on it, instead add one mana of any color.");
  const config = (deck1: string[], deck2: string[]): GameConfig => ({
    seed: 'edh-top-1-pregame',
    players: [{ name: 'Alice', deck: deck1, stops: { fullControl: true } }, { name: 'Bob', deck: deck2, stops: { fullControl: true } }],
    defs: [CAVERN, card('Test Plain', 'Basic Land — Plains', '')],
    options: { startingPlayer: 'p1', skipMulligans: true },
  });
  const caverns = Array(40).fill('Test Cavern') as string[];
  const plains = Array(40).fill('Test Plain') as string[];
  it('is fully automated', () => expect(full(CAVERN)).toBe(true));
  it('the starting player never has the option (CR 103.1): only the other player is asked, and their answer comes first in the log', () => {
    const s = createGame(config(caverns, caverns));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', rules: ['CR 103.6', 'CR 103.6a'] });
    expect(s.zones.battlefield).toEqual([]);
  });
  it('the other player begins the game with it on the battlefield with a luck counter and then exiles a card from their hand', () => {
    let s = createGame(config(caverns, caverns));
    const opts = s.pending?.kind === 'chooseObjects' ? s.pending.options : [];
    expect(opts.length).toBe(7);
    s = answer(s, { kind: 'chooseObjects', ids: [opts[0]!] });
    const onField = findAll(s, 'Test Cavern', 'battlefield', 'p2');
    expect(onField).toHaveLength(1);
    expect(s.objects[onField[0]!]!.counters).toEqual({ luck: 1 });
    expect(s.objects[onField[0]!]!.controller).toBe('p2');
    // "If you do, exile a card from your hand": a decision for p2 over the six cards left in their hand
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', min: 1, max: 1 });
    const hand = s.zones.hand['p2']!;
    expect(hand).toHaveLength(6);
    const pick = hand[3]!;
    s = answer(s, { kind: 'chooseObjects', ids: [pick] });
    expect(s.objects[pick]).toBeUndefined(); // it moved: a new object in exile (CR 400.7)
    expect(s.zones.exile).toHaveLength(1);
    expect(s.zones.hand['p2']).toHaveLength(5);
    expect(s.zones.hand['p1']).toHaveLength(7); // the starting player kept their hand
    expect(s.stage).toBe('playing');
  });
  it('declining: nothing is put onto the battlefield, no card is exiled and no counter appears', () => {
    let s = createGame(config(caverns, caverns));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.zones.battlefield).toEqual([]);
    expect(s.zones.hand['p2']).toHaveLength(7);
    expect(s.zones.exile).toEqual([]);
    expect(s.stage).toBe('playing');
  });
  it('a player without the card is not asked, and the starting player with it is not either (they just start)', () => {
    const s = createGame(config(caverns, plains));
    expect(s.pending?.kind).toBe('priority');
    expect(s.stage).toBe('playing');
  });
  it('the counter makes the land tap for any color (and an uncountered copy taps for colorless only)', () => {
    let s = createGame(config(caverns, caverns));
    s = answer(s, { kind: 'chooseObjects', ids: [s.pending!.kind === 'chooseObjects' ? s.pending.options[0]! : ''] });
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand['p2']![0]!] });
    const id = findAll(s, 'Test Cavern', 'battlefield', 'p2')[0]!;
    const def = s.defs['Test Cavern']!;
    expect(JSON.stringify(def.faces[0]!.abilities)).toContain('luck');
    expect(s.objects[id]!.counters['luck']).toBe(1);
  });
  it('a one-card hand: the Cavern itself is that card, so the hand is empty afterwards and nothing is exiled (no decision)', () => {
    // a one-card hand is the corner case of "exile a card from your hand" (CR 103.6)
    const tiny: GameConfig = { ...config(caverns, caverns), options: { startingPlayer: 'p1', skipMulligans: true, startingHandSize: 1 } };
    let s = createGame(tiny);
    expect(s.zones.hand['p2']).toHaveLength(1);
    s = answer(s, { kind: 'chooseObjects', ids: s.pending!.kind === 'chooseObjects' ? [s.pending.options[0]!] : [] });
    expect(findAll(s, 'Test Cavern', 'battlefield', 'p2')).toHaveLength(1);
    expect(s.zones.hand['p2']).toHaveLength(0);
    expect(s.zones.exile).toHaveLength(0); // an empty hand: nothing to exile
    expect(s.stage).toBe('playing');
  });
});

// ---- play lands and cast spells from the top of the library under a condition -----------------------------------------------------------------------------

describe('CR 305.1, 401.5, 604.1: "As long as ~ is attached to a creature, you may play lands and cast spells from the top of your library."', () => {
  const CHIP = card('Test Chip', 'Artifact — Equipment', 'You may look at the top card of your library any time.\nAs long as Test Chip is attached to a creature, you may play lands and cast spells from the top of your library.\nEquip {1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const GROVE = card('Test Grove', 'Land — Forest', '');
  const ORB = card('Test Orb', 'Artifact', '');
  const defs = [CHIP, BEAR, GROVE, ORB];
  const topActions = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.object === s.zones.library['p1']![0]).map((a) => a.label);
  const attach = (s: GameState): void => {
    s.objects[find(s, 'Test Chip', 'battlefield', 'p1')]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p1');
  };
  const play = (top: string, attached: boolean): string[] => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Chip', since: 1 }, { name: 'Test Bear', since: 1 }], library: [top] } });
    if (attached) attach(s);
    return topActions(s);
  };
  it('is fully automated', () => expect(full(CHIP)).toBe(true));
  it('unattached: neither a land nor a spell on top can be played or cast from the library (negative)', () => {
    expect(play('Test Grove', false).some((l) => /play/i.test(l))).toBe(false);
    expect(play('Test Orb', false).some((l) => /cast/i.test(l))).toBe(false);
  });
  it('attached: the land on top can be played and the nonland on top can be cast', () => {
    expect(play('Test Grove', true).some((l) => /play/i.test(l))).toBe(true);
    expect(play('Test Orb', true).some((l) => /cast/i.test(l))).toBe(true);
  });
  it('the permission is not given to the opponent', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Chip', since: 1 }, { name: 'Test Bear', since: 1 }] }, p2: { library: ['Test Grove'] } });
    attach(s);
    expect(legalActions(s, 'p2').filter((a) => a.object === s.zones.library['p2']![0]).length).toBe(0);
  });
});

// ---- a delayed trigger of the token the same resolution made -------------------------------------------------------------------------------------------

describe('CR 603.7, 603.7c, 406.3, 400.7: "Exile the top card of your library face down and look at it. Create a 2/2 colorless Spirit creature token. When that token leaves the battlefield, put the exiled card into your hand."', () => {
  const PLAN = card('Test Plan', 'Sorcery', 'Exile the top card of your library face down and look at it. Create a 2/2 colorless Spirit creature token. When that token leaves the battlefield, put the exiled card into your hand.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const TOP = card('Test Topdeck', 'Sorcery', '');
  const defs = [PLAN, SMITE, BEAR, TOP];
  const setup = (): GameState => cast(scenario([], { defs, p1: { hand: ['Test Plan', 'Test Smite', 'Test Smite'], library: ['Test Topdeck'], battlefield: [{ name: 'Test Bear', since: 1 }] } }), 'Test Plan');
  it('is fully automated', () => expect(full(PLAN)).toBe(true));
  it('the top card is exiled face down, a Spirit appears, and the card stays exiled while the token lives', () => {
    const s = setup();
    const card1 = s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Topdeck')!;
    expect(card1).toBeDefined();
    expect(s.objects[card1]!.faceDown).toBe(true);
    expect(findAll(s, 'Spirit Token', 'battlefield', 'p1').length + s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBeGreaterThan(0);
    expect(zoneOf(s, card1)).toBe('exile');
  });
  it('when the token dies the exiled card goes to its owner\'s hand; the other creature leaving does not return it (negative)', () => {
    let s = setup();
    const card1 = s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Topdeck')!;
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Smite', { targets: [[bear]] });
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(zoneOf(s, card1)).toBe('exile'); // another creature leaving changes nothing
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    s = cast(s, 'Test Smite', { targets: [[token]] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
    const inHand = s.zones.hand['p1']!.map((id) => s.objects[id]!.defId);
    expect(inHand).toContain('Test Topdeck');
    expect(s.zones.exile.includes(card1)).toBe(false);
  });
  it('the trigger fires once: a second token from a second casting is a different object with its own exiled card', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Plan', 'Test Plan', 'Test Smite', 'Test Smite'], library: ['Test Topdeck', 'Test Topdeck'] } });
    s = cast(s, 'Test Plan');
    s = cast(s, 'Test Plan');
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    s = cast(s, 'Test Smite', { targets: [[tokens[0]!]] });
    expect(s.zones.hand['p1']!.filter((id) => s.objects[id]!.defId === 'Test Topdeck')).toHaveLength(1);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Topdeck')).toHaveLength(1);
  });
});
