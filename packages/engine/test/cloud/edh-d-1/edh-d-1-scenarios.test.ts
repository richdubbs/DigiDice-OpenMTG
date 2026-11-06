/**
 * Commander coordinator D, round edh-d-1 (EDHREC ranks 10,001 to 11,250): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player. Each test is named after the rule it checks, with its negative case. CR cites are listed as
 * checked or unverified in the round's record.
 *
 *   CR 601.2, 118.9, 608.2g    "that player casts it without paying its mana cost if able" (Omen Machine, Wild Evocation)
 *   CR 111.1, 508.4            "create a ... token that's tapped and attacking for each creature card in your graveyard" (Kessig Cagebreakers)
 *   CR 702.33d, 702.33e        "create a ... token for each time it was kicked" (Wolfbriar Elemental)
 *   CR 602.2, 603.2            "Whenever an opponent activates an ability of an artifact they control, ~ deals 1 damage to that player" (Avalanche of Sector 7)
 *   CR 608.2d, 700.2           "Choose a creature card at random from target opponent's graveyard" (Tariel); "Choose a creature at random, then destroy the rest" (Last One Standing)
 *   CR 701.30, 608.2c          "You lose 2 life and draw two cards, then clash with an opponent. If you win, repeat this process." (Hoarder's Greed)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, find, findAll, pass, scenario } from '../../m3/scenario';
import { answer, passUntil } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers, toStep, tweak } from '../../m4/helpers';
import { counters, full, resolveAll, settle, tokens, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
function mk(name: string, type: string, text: string, p?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(p ? { power: p[0], toughness: p[1] } : {}) } as OracleCard);
}
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const idsOn = (s: GameState, name: string, owner?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (owner === undefined || s.objects[id]!.controller === owner));
const activate = (s: GameState, name: string, owner = 'p1', ability = 'p:0:0'): GameState => act(s, { type: 'activate', player: owner, source: find(s, name, 'battlefield', owner), ability } as never);

const MACHINE = mk('Test Machine', 'Artifact', '{T}: Target player exiles the top card of their library. If it\'s a land card, that player puts it onto the battlefield. Otherwise, that player casts it without paying its mana cost if able.');
const EVOKER = mk('Test Evoker', 'Artifact', '{T}: Target player reveals a card at random from their hand. If it\'s a land card, that player puts it onto the battlefield. Otherwise, that player casts it without paying its mana cost if able.');
const BRUTE = mk('Test Brute', 'Creature — Ogre', '', ['3', '3'], '{2}{G}');
const BEAR = mk('Test Bear', 'Creature — Bear', '', ['2', '2']);
const FIELD = mk('Test Field', 'Land', '');
const BINDING = mk('Test Binding', 'Enchantment — Aura', 'Enchant creature', undefined, '{0}');
const GRAVEBITER = mk('Test Gravebiter', 'Creature — Zombie', 'Whenever this creature attacks, create a 2/2 green Wolf creature token that\'s tapped and attacking for each creature card in your graveyard.', ['1', '1']);
const PACK = mk('Test Pack', 'Creature — Elf', 'Multikicker {G}\nWhen this creature enters, create a 2/2 green Wolf creature token for each time it was kicked.', ['1', '1'], '{G}');
const SCRAPPER = mk('Test Scrapper', 'Creature — Goblin', 'Whenever an opponent activates an ability of an artifact they control, this creature deals 1 damage to that player.', ['2', '2']);
const GADGET = mk('Test Gadget', 'Artifact', '{T}: Scry 1.');
const CHARM = mk('Test Charm', 'Artifact', '{T}: Add {C}.');
const REAVER = mk('Test Reaver', 'Artifact Creature — Construct', '{T}: Choose a creature card at random from target opponent\'s graveyard. Put that card onto the battlefield under your control.', ['1', '1']);
const CULL = mk('Test Cull', 'Sorcery', 'Choose a creature at random, then destroy the rest.');
const GREED = mk('Test Greed', 'Sorcery', 'You lose 2 life and draw two cards, then clash with an opponent. If you win, repeat this process.');
const DEFS: CardDef[] = [MACHINE, EVOKER, BRUTE, BEAR, FIELD, BINDING, GRAVEBITER, PACK, SCRAPPER, GADGET, CHARM, REAVER, CULL, GREED];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.2, 118.9, 608.2g: "that player casts it without paying its mana cost if able"', () => {
  const board = (top: string[], hand: string[] = []): GameState =>
    scenario([], { p1: { battlefield: ['Test Machine'], library: ['Test Field'] }, p2: { library: top, hand }, defs: DEFS });
  it('a nonland card on top of the target player\'s library is exiled and cast by THAT player for free, under their control', () => {
    let s = board(['Test Brute', 'Test Field']);
    s = resolveAll(settle(activate(s, 'Test Machine'), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(idsOn(s, 'Test Brute', 'p2').length).toBe(1);
    expect(idsOn(s, 'Test Brute', 'p1').length).toBe(0);
  });
  it('a land card is put onto the battlefield under the target player\'s control, not cast', () => {
    let s = board(['Test Field', 'Test Bear']);
    s = resolveAll(settle(activate(s, 'Test Machine'), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(idsOn(s, 'Test Field', 'p2').length).toBe(1);
    expect(idsOn(s, 'Test Bear').length).toBe(0);
  });
  it('a card that cannot be cast now (an Aura with nothing to enchant) stays in exile (negative: "if able")', () => {
    let s = board(['Test Binding', 'Test Field']);
    s = resolveAll(settle(activate(s, 'Test Machine'), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(Object.values(s.objects).filter((o) => o.defId === 'Test Binding').map((o) => o.zone)).toEqual(['exile']);
    expect(idsOn(s, 'Test Binding').length).toBe(0);
  });
  it('Wild Evocation shape: the card revealed at random from the hand is cast for free by its owner', () => {
    let s = scenario([], { p1: { battlefield: ['Test Evoker'], library: ['Test Field'] }, p2: { hand: ['Test Brute'], library: ['Test Field'] }, defs: DEFS });
    s = resolveAll(settle(activate(s, 'Test Evoker'), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(idsOn(s, 'Test Brute', 'p2').length).toBe(1);
  });
});

describe('CR 111.1, 508.4: "create a 2/2 green Wolf creature token that\'s tapped and attacking for each creature card in your graveyard"', () => {
  const attack = (graveyard: string[]): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Gravebiter'], graveyard }, p2: {}, defs: DEFS });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Gravebiter', 'battlefield', 'p1')]]);
    return resolveAll(s);
  };
  it('two creature cards in the graveyard and a land card: two Wolves, tapped and attacking (the land is not counted)', () => {
    const s = attack(['Test Bear', 'Test Brute', 'Test Field']);
    const wolves = tokens(s, 'p1');
    expect(wolves.length).toBe(2);
    for (const w of wolves) { expect(s.objects[w]!.tapped).toBe(true); expect(s.combat?.attackers?.some((a) => a.id === w)).toBe(true); }
  });
  it('an empty graveyard (negative): no Wolf', () => {
    expect(tokens(attack([]), 'p1').length).toBe(0);
  });
});

describe('CR 702.33d, 702.33e: "create a 2/2 green Wolf creature token for each time it was kicked"', () => {
  function play(kicks: number): GameState {
    let s = scenario(['Forest'], { p1: { hand: ['Test Pack'], battlefield: ['Forest', 'Forest', 'Forest'] }, p2: {}, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pack', 'hand') });
    for (let g = 0; g < 12 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: kicks });
      else s = settle(s);
    }
    return resolveAll(s);
  }
  it('kicked twice: two Wolves', () => { expect(tokens(play(2), 'p1').length).toBe(2); });
  it('not kicked (negative): no Wolf', () => { expect(tokens(play(0), 'p1').length).toBe(0); });
});

describe('CR 602.2, 603.2: "Whenever an opponent activates an ability of an artifact they control, ~ deals 1 damage to that player."', () => {
  const board = (): GameState => scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Scrapper', 'Test Gadget'] }, p2: { battlefield: ['Test Gadget', 'Test Charm'] }, defs: DEFS });
  /** p1 casts a free creature spell, passes, and p2 (holding priority with it on the stack) activates `name` of their own. */
  const respond = (name: string): GameState => {
    let s = settle(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Bear', 'hand', 'p1') }));
    s = pass(s);
    return resolveAll(activate(s, name, 'p2'));
  };
  it('an opponent activates an ability of their artifact: that player takes 1 damage', () => {
    const s = respond('Test Gadget');
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
  it('an opponent activates a mana ability of their artifact: that player takes 1 damage too (mana abilities are abilities, CR 605.1a)', () => {
    expect(life(respond('Test Charm'), 'p2')).toBe(19);
  });
  it('its controller activates their own artifact (negative): no damage', () => {
    const s = resolveAll(activate(board(), 'Test Gadget', 'p1'));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 608.2d, 700.2: "Choose a creature card at random from target opponent\'s graveyard. Put that card onto the battlefield under your control."', () => {
  it('a creature card is picked from the graveyard (a land card is never picked) and comes under your control', () => {
    let s = scenario([], { p1: { battlefield: ['Test Reaver'] }, p2: { graveyard: ['Test Brute', 'Test Field'] }, defs: DEFS });
    s = resolveAll(settle(activate(s, 'Test Reaver'), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(idsOn(s, 'Test Brute', 'p1').length).toBe(1);
    expect(idsOn(s, 'Test Field').length).toBe(0);
  });
  it('no creature card in the graveyard (negative): nothing happens', () => {
    let s = scenario([], { p1: { battlefield: ['Test Reaver'] }, p2: { graveyard: ['Test Field'] }, defs: DEFS });
    s = resolveAll(settle(activate(s, 'Test Reaver'), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(idsOn(s, 'Test Field').length).toBe(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1);
  });
});

describe('CR 608.2d, 700.2: "Choose a creature at random, then destroy the rest."', () => {
  it('exactly one creature of all the creatures survives; the other permanents are untouched', () => {
    let s = scenario([], { p1: { hand: ['Test Cull'], battlefield: ['Test Bear', 'Test Brute', 'Test Machine'] }, p2: { battlefield: ['Test Bear', 'Test Brute'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cull', 'hand') })));
    const creatures = s.zones.battlefield.filter((id) => getChars(s, id)!.types.includes('Creature'));
    expect(creatures.length).toBe(1);
    expect(idsOn(s, 'Test Machine').length).toBe(1);
  });
  it('the survivor is not always the same creature (the game picks at random)', () => {
    const survivors = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      let s = scenario([], { seed, p1: { hand: ['Test Cull'], battlefield: ['Test Bear', 'Test Brute'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
      s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cull', 'hand') })));
      survivors.add(s.zones.battlefield.map((id) => `${s.objects[id]!.controller}:${s.objects[id]!.defId}`).join());
    }
    expect(survivors.size).toBeGreaterThan(1);
  });
});

describe('CR 701.30, 608.2c: "You lose 2 life and draw two cards, then clash with an opponent. If you win, repeat this process."', () => {
  const run = (mine: string[], theirs: string[]): { lost: number; drawn: number } => {
    let s = scenario([], { p1: { hand: ['Test Greed'], library: mine }, p2: { library: theirs }, defs: DEFS });
    const before = (s.zones.hand['p1'] ?? []).length - 1;
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Greed', 'hand') })));
    return { lost: 20 - life(s, 'p1'), drawn: (s.zones.hand['p1'] ?? []).length - before };
  };
  it('a clash that is not won ends it after one run: 2 life lost, 2 cards drawn', () => {
    const r = run(['Test Field', 'Test Field', 'Test Field', 'Test Field'], ['Test Brute', 'Test Brute', 'Test Brute']);
    expect(r).toEqual({ lost: 2, drawn: 2 });
  });
  it('a clash that is won repeats the whole process (lose 2 life, draw 2 cards, clash again) until a clash is not won', () => {
    const r = run(['Test Field', 'Test Field', 'Test Brute', 'Test Brute', 'Test Brute', 'Test Field', 'Test Field', 'Test Field', 'Test Field', 'Test Field'], ['Test Field', 'Test Field', 'Test Field', 'Test Field']);
    expect(r.lost).toBeGreaterThanOrEqual(4);
    expect(r.drawn).toBe(r.lost);
  });
});
