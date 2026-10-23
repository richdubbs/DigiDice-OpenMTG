/**
 * p2-cost-parts-1 (lane p2-cost-parts, account B): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 118.3, 701.26b, 602.2b  "Untap two tapped creatures you control": tapped creatures you control untap as the cost is paid; with too few it can't be activated;
 *                              never the source of the {T} / {Q} cost, never an opponent's creature
 *   CR 118.3, 602.2b           "Remove three quest counters from ~ and sacrifice it": both parts on ~; with fewer counters it can't be activated
 *   CR 601.2b, 118.8           "As an additional cost to cast this spell, sacrifice a creature, discard a card, or pay 3 life": one of the three, the player's choice
 *   CR 303.4, 602.5b           "Tap enchanted creature: ... Activate only if enchanted creature is untapped.": the creature the Aura is attached to is tapped
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, find, reject, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const ids = (s: GameState, name: string, zone = 'battlefield', player = 'p1'): ObjectId[] =>
  Object.values(s.objects).filter((o) => o.defId === name && o.owner === player && o.zone === zone).map((o) => o.id);
const activate = (s: GameState, source: ObjectId, ability = 'p:0:0'): GameState => act(s, { type: 'activate', player: 'p1', source, ability });

// ---- untap tapped creatures as a cost -------------------------------------------------------------------------------------------------------------------------

const FONT = card('Test Waking Font', 'Artifact', '{T}, Untap two tapped creatures you control: Draw a card.');
/** A blue creature (the cmd3 helper's cards are colorless). */
const blue = (name: string, type: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{U}', type_line: type, oracle_text: text, colors: ['U'], power: '1', toughness: '1' } as OracleCard);
const SPRITE = blue('Test Rouse Sprite', 'Creature — Faerie', '{Q}, Untap a tapped blue creature you control: You gain 2 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BLUE_BEAR = blue('Test Blue Bear', 'Creature — Bear', '');

describe('p2-cost-parts-1: "Untap two tapped creatures you control" (CR 118.3, 701.26b)', () => {
  const board = (tapped: number, untapped: number, opponentTapped = 0): GameState => {
    const s = scenario([], { defs: [FONT, BEAR], p1: { battlefield: ['Test Waking Font', ...Array(tapped + untapped).fill('Test Bear')], library: ['Plains', 'Plains'] }, p2: { battlefield: Array(opponentTapped).fill('Test Bear') } });
    return tweak(s, (x) => {
      ids(x, 'Test Bear').slice(0, tapped).forEach((id) => { x.objects[id]!.tapped = true; });
      ids(x, 'Test Bear', 'battlefield', 'p2').forEach((id) => { x.objects[id]!.tapped = true; });
    });
  };

  it('the card is automated', () => expect(full(FONT), JSON.stringify(FONT.automation)).toBe(true));

  it('CR 701.26b: two tapped creatures untap, the font taps, a card is drawn', () => {
    const s0 = board(2, 1);
    const hand = handOf(s0);
    const s = resolveAll(activate(s0, find(s0, 'Test Waking Font', 'battlefield')));
    expect(ids(s, 'Test Bear').map((id) => s.objects[id]!.tapped)).toEqual([false, false, false]);
    expect(s.objects[find(s, 'Test Waking Font', 'battlefield')]!.tapped).toBe(true);
    expect(handOf(s)).toBe(hand + 1);
  });

  it('CR 118.3: one tapped creature is too few (an untapped one does not count, nor an opponent\'s tapped one)', () => {
    const s0 = board(1, 2, 2);
    expect(reject(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Waking Font', 'battlefield'), ability: 'p:0:0' }).message).toBeTruthy();
  });

  it('CR 118.3, 602.2b: the source of the {Q} cost is not also one of the creatures untapped ("a tapped blue creature" needs another)', () => {
    expect(full(SPRITE), JSON.stringify(SPRITE.automation)).toBe(true);
    const tapAll = (s: GameState): GameState => tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.tapped = true; });
    const alone = tapAll(scenario([], { defs: [SPRITE, BLUE_BEAR], p1: { battlefield: ['Test Rouse Sprite'] } }));
    expect(reject(alone, { type: 'activate', player: 'p1', source: find(alone, 'Test Rouse Sprite', 'battlefield'), ability: 'p:0:0' }).message).toBeTruthy();
    const two = tapAll(scenario([], { defs: [SPRITE, BLUE_BEAR], p1: { battlefield: ['Test Rouse Sprite', 'Test Blue Bear'] } }));
    const s = resolveAll(activate(two, find(two, 'Test Rouse Sprite', 'battlefield')));
    expect(s.objects[find(s, 'Test Blue Bear', 'battlefield')]!.tapped).toBe(false);
    expect(s.objects[find(s, 'Test Rouse Sprite', 'battlefield')]!.tapped).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

// ---- remove counters from ~ and sacrifice it ------------------------------------------------------------------------------------------------------------------

const QUEST = card('Test Long Quest', 'Enchantment', 'Remove three quest counters from this enchantment and sacrifice it: You gain 5 life.');
const HOURGLASS = card('Test Sand Glass', 'Artifact', 'Remove two time counters from this artifact and exile it: Draw a card.');

describe('p2-cost-parts-1: "Remove three quest counters from ~ and sacrifice it" (CR 118.3, 602.2b)', () => {
  const board = (def: typeof QUEST, name: string, kind: string, n: number): GameState =>
    tweak(scenario([], { defs: [def], p1: { battlefield: [name], library: ['Plains'] } }), (x) => { x.objects[find(x, name, 'battlefield')]!.counters[kind] = n; });

  it('the cards are automated', () => {
    for (const d of [QUEST, HOURGLASS]) expect(full(d), JSON.stringify(d.automation)).toBe(true);
  });

  it('CR 602.2b: with three counters: the counters go, ~ is sacrificed, the effect happens', () => {
    const s = resolveAll(activate(board(QUEST, 'Test Long Quest', 'quest', 3), find(board(QUEST, 'Test Long Quest', 'quest', 3), 'Test Long Quest', 'battlefield')));
    expect(ids(s, 'Test Long Quest', 'graveyard')).toHaveLength(1);
    expect(lifeOf(s, 'p1')).toBe(25);
  });

  it('CR 118.3: with two counters it can\'t be activated (and stays on the battlefield)', () => {
    const s0 = board(QUEST, 'Test Long Quest', 'quest', 2);
    expect(reject(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Long Quest', 'battlefield'), ability: 'p:0:0' }).message).toBeTruthy();
  });

  it('"and exile it": ~ goes to exile, not the graveyard', () => {
    const s0 = board(HOURGLASS, 'Test Sand Glass', 'time', 2);
    const s = resolveAll(activate(s0, find(s0, 'Test Sand Glass', 'battlefield')));
    expect(ids(s, 'Test Sand Glass', 'exile')).toHaveLength(1);
    expect(ids(s, 'Test Sand Glass', 'graveyard')).toHaveLength(0);
  });
});

// ---- a choice of three additional costs -----------------------------------------------------------------------------------------------------------------------

const MAULER = card('Test Dusk Maw', 'Sorcery', 'As an additional cost to cast this spell, sacrifice a creature, discard a card, or pay 3 life.\nDraw two cards.');

describe('p2-cost-parts-1: "sacrifice a creature, discard a card, or pay 3 life" (CR 601.2b, 118.8)', () => {
  const board = (): GameState => scenario([], { defs: [MAULER, BEAR], p1: { hand: ['Test Dusk Maw', 'Plains'], battlefield: ['Test Bear'], library: ['Plains', 'Plains', 'Plains'] } });

  it('the card is automated', () => expect(full(MAULER), JSON.stringify(MAULER.automation)).toBe(true));

  it('CR 601.2b: three options are offered; paying life keeps the creature and the card', () => {
    const s0 = board();
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dusk Maw', 'hand') });
    expect(s1.pending?.kind).toBe('chooseOption');
    if (s1.pending?.kind === 'chooseOption') expect(s1.pending.options).toHaveLength(3);
    const s = resolveAll(settle(s1, { option: '2' }));
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(ids(s, 'Test Bear')).toHaveLength(1);
    expect(handOf(s)).toBe(3); // the Plains kept, two drawn
  });

  it('CR 601.2b: sacrificing pays no life', () => {
    const s = resolveAll(settle(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Dusk Maw', 'hand') }), { option: '0' }));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(ids(s, 'Test Bear', 'graveyard')).toHaveLength(1);
  });
});

// ---- tap enchanted creature -----------------------------------------------------------------------------------------------------------------------------------

const PLAGUE = card('Test Fevered Charm', 'Enchantment — Aura', 'Enchant creature you control\nTap enchanted creature: You gain 1 life. Activate only if enchanted creature is untapped.');

describe('p2-cost-parts-1: "Tap enchanted creature" (CR 303.4, 602.5b)', () => {
  /** The Aura cast onto the first Test Bear (an Aura can't sit unattached on the battlefield, CR 704.5m). */
  const board = (tapped: boolean): GameState => {
    const s0 = scenario([], { defs: [PLAGUE, BEAR], p1: { hand: ['Test Fevered Charm'], battlefield: ['Test Bear', 'Test Bear'] } });
    const [bear] = ids(s0, 'Test Bear');
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fevered Charm', 'hand') }), { targets: [{ kind: 'object', id: bear! }] });
    expect(s.objects[find(s, 'Test Fevered Charm', 'battlefield')]!.attachedTo).toBe(bear);
    return tweak(s, (x) => { x.objects[bear!]!.tapped = tapped; });
  };

  it('the card is automated', () => expect(full(PLAGUE), JSON.stringify(PLAGUE.automation)).toBe(true));

  it('CR 303.4: the enchanted creature taps (not the other creature) and the effect happens', () => {
    const s0 = board(false);
    const [bear, other] = ids(s0, 'Test Bear');
    const s = resolveAll(activate(s0, find(s0, 'Test Fevered Charm', 'battlefield'), 'p:0:1'));
    expect(s.objects[bear!]!.tapped).toBe(true);
    expect(s.objects[other!]!.tapped).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(21);
  });

  it('CR 602.5b, 118.3: with the enchanted creature tapped it can\'t be activated, though another creature is untapped', () => {
    const s0 = board(true);
    expect(reject(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Fevered Charm', 'battlefield'), ability: 'p:0:1' }).message).toBeTruthy();
  });
});
