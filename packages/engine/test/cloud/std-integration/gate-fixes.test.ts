/**
 * Standard merge, release-gate fixes on the integration line (synthetic cards compiled by the game's default compiler; wordings follow the real cards,
 * design 6.10):
 *
 *   CR 608.2c, 603.7c  "for each Aura and Equipment attached to ~, create a 3/1 ... token ... Exile those tokens at the beginning of the next end step."
 *                      (Valduk, Keeper of the Flame): "those tokens" are the tokens that step created, possibly none; with none the delayed trigger
 *                      exiles nothing (a create of no token binds its name to no token, design 3.1 rule 6)
 *   CR 614.1a, 701.44  explore while a manual "If a creature you control would explore, instead ..." is in play (after Twists and Turns) is resolved by hand,
 *                      and the prompt names the action ("explore"), which the replacing card's own manual text contains
 *   CR 608.2c, 107.3   "If you do, you lose X life and create X Clue tokens, where X is that card's mana value." (Nyla, Shirshu Sleuth): X of both
 *                      instructions is the exiled card's mana value (eff.stdspm.if.compound.whereX.and wins over the reading that leaves the life's X free)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { answer, find, findAll, put, scenario } from '../../m3/scenario';
import { passUntil, toDeclareAttackers } from '../../m4/helpers';
import { cast, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const tokensNamed = (s: GameState, subtype: string): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && (s.defs[s.objects[id]!.defId]?.faces[0]?.subtypes ?? []).includes(subtype));

describe('CR 608.2c, 603.7c: "create a token for each Aura and Equipment attached to ~ ... Exile those tokens at the beginning of the next end step"', () => {
  const KEEPER = card('Test Keeper', 'Legendary Creature — Human Shaman',
    'At the beginning of combat on your turn, for each Aura and Equipment attached to ~, create a 3/1 red Elemental creature token with trample and haste. Exile those tokens at the beginning of the next end step.', ['3', '2']);
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equip {1}');
  const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature');
  /** The Keeper and an Equipment; with `attached`, the Equipment and an Aura are attached to the Keeper (an Aura attached to nothing would not stay, CR 704.5m). */
  function board(attached: boolean): GameState {
    const s = scenario([], { p1: { battlefield: ['Test Keeper', 'Test Sword'] }, defs: [KEEPER, SWORD, CHARM] });
    if (!attached) return s;
    const keeper = find(s, 'Test Keeper', 'battlefield', 'p1');
    for (const id of [find(s, 'Test Sword', 'battlefield', 'p1'), put(s, 'p1', 'battlefield', 'Test Charm')]) s.objects[id]!.attachedTo = keeper;
    return s;
  }
  /** Through combat (no attack) and the end step, until the next turn's first priority. */
  const toNextTurn = (s: GameState): GameState => passUntil(answer(s, { kind: 'declareAttackers', attacks: [] }), (x) => x.turn.number === 2 && x.pending?.kind === 'priority', 'the next turn');
  it('is automated', () => {
    expect(KEEPER.automation.level).toBe('full');
  });
  it('two attachments: two tokens at the beginning of combat, both exiled at the next end step', () => {
    let s = toDeclareAttackers(board(true));
    expect(tokensNamed(s, 'Elemental')).toHaveLength(2);
    s = toNextTurn(s);
    expect(tokensNamed(s, 'Elemental')).toHaveLength(0);
  });
  it('no attachment: no token, and the delayed trigger exiles nothing (no unbound name, CR 608.2c)', () => {
    let s = toDeclareAttackers(board(false));
    expect(tokensNamed(s, 'Elemental')).toHaveLength(0);
    s = toNextTurn(s);
    expect(tokensNamed(s, 'Elemental')).toHaveLength(0);
    expect(findAll(s, 'Test Keeper', 'battlefield')).toHaveLength(1);
  });
});

describe('CR 614.1a, 701.44: explore replaced by a manual "would explore" ability of the same card', () => {
  const TWISTS = card('Test Twists', 'Enchantment',
    // r4-repl: "instead you scry 1, then that creature explores" (Twists and Turns) is automated now (rep.r4repl.explore.scryFirst); a mill first is still manual
    'If a creature you control would explore, instead you mill a card, then that creature explores.\nWhen this enchantment enters, target creature you control explores.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('the explore is asked by hand, and the prompt is part of the card\'s own manual text', () => {
    let s = scenario([], { p1: { hand: ['Test Twists'], battlefield: ['Test Bear'] }, defs: [TWISTS, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Twists'), [target(bear)]);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    const d = s.pending as unknown as { text: string; reason: string };
    expect(d.text).toBe('explore');
    expect(d.reason).toMatch(/would explore/);
    const manual = TWISTS.faces[0]!.abilities.find((a) => a.kind === 'manual')!;
    expect(manual.kind === 'manual' && manual.text.toLowerCase().includes(d.text)).toBe(true);
    expect(s.objects[bear]!.counters).toEqual({});
  });
});

describe('CR 608.2c, 107.3: "If you do, you lose X life and create X Clue tokens, where X is that card\'s mana value."', () => {
  const SLEUTH = card('Test Sleuth', 'Legendary Creature — Mole Beast',
    "When ~ enters, exile up to one target creature card from your graveyard. If you do, you lose X life and create X Clue tokens, where X is that card's mana value.", ['2', '5']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['3', '3'], '{2}{R}');
  it('X of both instructions is the exiled card\'s mana value', () => {
    const ab = SLEUTH.faces[0]!.abilities[0]!;
    expect(ab.kind).toBe('triggered');
    const json = JSON.stringify(ab);
    expect(json).not.toContain('"q":"X"');
    expect(json.match(/"stat":"manaValue"/g)).toHaveLength(2);
    let s = scenario([], { p1: { hand: ['Test Sleuth'], graveyard: ['Test Giant'] }, defs: [SLEUTH, GIANT] });
    const giant = find(s, 'Test Giant', 'graveyard', 'p1');
    s = resolveAll(cast(s, 'Test Sleuth'), [target(giant)]);
    expect(findAll(s, 'Test Giant', 'exile')).toHaveLength(1);
    expect(s.players[0]!.life).toBe(17);
    expect(tokensNamed(s, 'Clue')).toHaveLength(3);
  });
});
