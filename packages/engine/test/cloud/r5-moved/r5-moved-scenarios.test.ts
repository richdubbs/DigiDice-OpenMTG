/**
 * Standard round 5, slice r5-moved: "this way" results and linked exiles round 4 left, played with invented cards (design 6.10: committed tests never carry Wizards text).
 *
 *   CR 701.17a, 701.17c, 611.2c  "Mill three cards. Put each creature card milled this way onto the battlefield. They gain haste. At the beginning of the next end step, ..."
 *   CR 607.2a, 400.7             "When ~ dies, you may put the exiled card into its owner's hand." / "... return the exiled cards to their owners' hands."
 *   CR 608.2c, 120.3, 701.8a     "If a Goblin is dealt damage this way, destroy it." / "If a player is dealt damage this way, they discard a card."
 *   CR 701.23a, 603.12           "Search your library ... then shuffle. When you search your library this way, ..." (also when nothing is found)
 *   CR 701.25a, 608.2c           "Surveil 1. If you put a land card into your graveyard this way, put that card into your hand."
 *   CR 608.2f, 608.2h            "Return all creatures to their owners' hands. For each opponent who controlled a creature returned this way, ..."
 *   CR 608.2c, 611.2a            "Exile all the cards from your hand, then draw that many cards. Until the end of your next turn, you may play cards exiled this way."
 *   CR 608.2c, 400.7, 110.2a     "Then each player returns all creature cards from their graveyard that weren't put there this way to the battlefield."
 *   CR 700.4, 608.2h             "... exile the top X cards of your library, where X is the number of artifacts that were put into graveyards from the battlefield this turn."
 *   CR 608.2c                    "If you put no cards into your hand this way, ..."
 *   design 6.4 (fail closed)     a surveil of two cards, a linked reader with no exile to link to, a search after a draw
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const json = (d: CardDef): string => JSON.stringify(d.faces);
const zone = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[z][p]!.map((id) => s.objects[id]!.defId);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const hasHaste = (s: GameState, id: ObjectId): boolean => getChars(s, id).keywords.some((k) => k.keyword === 'haste');

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
type Pick = (options: ObjectId[], min: number, max: number, st: GameState) => ObjectId[];
/** Pick the first option that is a card named `name` (read in the state of the decision). */
const named = (name: string): Pick => (options, _min, _max, st) => options.filter((id) => st.objects[id]!.defId === name).slice(0, 1);
const none: Pick = () => [];
/** Answer the decisions until priority: payments automatic, the targets in order, `pick` for object choices (default: the first allowed), `yes` to "may". */
function drive(s0: GameState, targets: Target[][] = [], pick?: Pick, yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options, p.min, p.max, s) : p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: Math.min(p.max, 3) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], pick?: Pick, yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, pick, yes);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = [], pick?: Pick, yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, pick, yes), targets, pick, yes);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const BIG_BEAR = card('Test Big Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
const BIG_GOBLIN = card('Test Big Goblin', 'Creature — Goblin', '', { pt: ['4', '4'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const IDOL = card('Test Idol', 'Artifact', '', { cost: '{1}' });
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.', { cost: '{2}{B}' });
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 701.17a, 701.17c, 611.2c, 603.7: "Put each creature card milled this way onto the battlefield. They gain haste. At the beginning of the next end step, return those creatures ..."', () => {
  const ENCOUNTER = card('Test Encounter', 'Sorcery', "Mill three cards. Put each creature card milled this way onto the battlefield. They gain haste. At the beginning of the next end step, return those creatures to their owner's hand.");
  it('is understood: the milled creature cards, wherever they are (`zone: any`, CR 701.17c), enter under your control', () => {
    expect(noManual(ENCOUNTER)).toBe(true);
    expect(json(ENCOUNTER)).toContain('"zone":"any"');
  });
  it('two creature cards among three milled enter with haste (a land stays in the graveyard) and go back to the hand at the end step', () => {
    let s = scenario([], { defs: [ENCOUNTER, BEAR, ELF], p1: { hand: ['Test Encounter'], library: ['Test Bear', 'Plains', 'Test Elf'] } });
    s = cast(s, 'Test Encounter');
    const bear = onField(s, 'Test Bear');
    const elf = onField(s, 'Test Elf');
    expect(bear).toHaveLength(1);
    expect(elf).toHaveLength(1);
    expect(hasHaste(s, bear[0]!)).toBe(true);
    expect(hasHaste(s, elf[0]!)).toBe(true);
    expect(zone(s, 'graveyard', 'p1')).toContain('Plains');
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(zone(s, 'hand', 'p1')).toEqual(expect.arrayContaining(['Test Bear', 'Test Elf']));
  });
  it('no creature card milled: nothing enters', () => {
    let s = scenario([], { defs: [ENCOUNTER, RITE], p1: { hand: ['Test Encounter'], library: ['Test Rite', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Encounter');
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Rite');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Rite')).toEqual([]);
  });
  it('design 6.4: "milled this way" with no mill before it stays manual', () => {
    const NO = card('Test No Mill', 'Sorcery', 'Draw a card. Put each creature card milled this way onto the battlefield.');
    expect(noManual(NO)).toBe(false);
  });
});

describe('CR 607.2a, 400.7: "the exiled card(s)" in another ability is what the linked ability exiled', () => {
  const HOARDER = card('Test Hoarder', 'Creature — Dragon', "When this creature enters, exile target artifact an opponent controls.\nWhen this creature dies, you may put the exiled card into its owner's hand.", { pt: ['2', '2'] });
  const PORTAL = card('Test Portal', 'Creature — Wizard', "When this creature enters, exile up to two target nonland permanents.\nWhen this creature dies, return the exiled cards to their owners' hands.", { pt: ['2', '2'] });
  it('is understood: the exile records the cards under the link "exiled", the dies trigger reads the link', () => {
    for (const d of [HOARDER, PORTAL]) {
      expect(noManual(d)).toBe(true);
      expect(json(d)).toContain('"link":"exiled"');
      expect(json(d)).toContain('{"ref":"linked","link":"exiled"}');
    }
  });
  it('the singular: the exiled artifact goes to its owner\'s hand when the creature dies', () => {
    let s = scenario([], { defs: [HOARDER, IDOL, KILL], p1: { hand: ['Test Hoarder', 'Test Kill'] }, p2: { battlefield: ['Test Idol'] } });
    const idol = find(s, 'Test Idol', 'battlefield', 'p2');
    s = cast(s, 'Test Hoarder', [[{ kind: 'object', id: idol }]]);
    expect(exiled(s, 'Test Idol')).toHaveLength(1);
    const hoarder = find(s, 'Test Hoarder', 'battlefield', 'p1');
    s = cast(s, 'Test Kill', [[{ kind: 'object', id: hoarder }]]);
    expect(zone(s, 'hand', 'p2')).toContain('Test Idol');
    expect(exiled(s, 'Test Idol')).toEqual([]);
  });
  it('the plural: both exiled permanents go to their owners\' hands', () => {
    let s = scenario([], { defs: [PORTAL, IDOL, BEAR, KILL], p1: { hand: ['Test Portal', 'Test Kill'], battlefield: ['Test Idol'] }, p2: { battlefield: ['Test Bear'] } });
    const idol = find(s, 'Test Idol', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Portal', [[{ kind: 'object', id: idol }, { kind: 'object', id: bear }]]);
    expect(s.zones.exile).toHaveLength(2);
    const portal = find(s, 'Test Portal', 'battlefield', 'p1');
    s = cast(s, 'Test Kill', [[{ kind: 'object', id: portal }]]);
    expect(zone(s, 'hand', 'p1')).toContain('Test Idol');
    expect(zone(s, 'hand', 'p2')).toContain('Test Bear');
  });
  it('design 6.4 (guard G10): with no exiling ability to link to, the reader keeps the reading it had before (its trigger automated, the sentence manual)', () => {
    const LONE = card('Test Lone Reader', 'Creature — Wizard', "Flying\nWhen this creature dies, return the exiled cards to their owners' hands.", { pt: ['2', '2'] });
    expect(json(LONE)).not.toContain('"ref":"linked"');
    expect(LONE.faces[0]!.abilities.some((a) => a.kind === 'triggered')).toBe(true);
    expect(noManual(LONE)).toBe(false);
  });
});

describe('CR 608.2c, 120.3, 701.8a, 701.9a: "If a <permanent> / a player is dealt damage this way, ..." reads what the damage step dealt damage to', () => {
  const ARROW = card('Test Arrow', 'Artifact', 'When this artifact enters, it deals 1 damage to any target. If a Goblin is dealt damage this way, destroy it.');
  const SHRIEK = card('Test Shriek', 'Creature — Dragon', 'When this creature enters, it deals 2 damage to any target and you gain 2 life. If a player is dealt damage this way, they discard a card.', { pt: ['2', '2'] });
  it('is understood: the objects of the description among those the damage step bound', () => {
    expect(noManual(ARROW)).toBe(true);
    expect(noManual(SHRIEK)).toBe(true);
    expect(json(SHRIEK)).toContain('"op":"discard","who":{"ref":"bound"');
  });
  it('a Goblin dealt damage is destroyed; a Bear is not', () => {
    let s = scenario([], { defs: [ARROW, BIG_GOBLIN, BIG_BEAR], p1: { hand: ['Test Arrow', 'Test Arrow'] }, p2: { battlefield: ['Test Big Goblin', 'Test Big Bear'] } });
    const goblin = find(s, 'Test Big Goblin', 'battlefield', 'p2');
    const bear = find(s, 'Test Big Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Arrow', [[{ kind: 'object', id: bear }]]);
    expect(onField(s, 'Test Big Bear')).toHaveLength(1);
    s = cast(s, 'Test Arrow', [[{ kind: 'object', id: goblin }]]);
    expect(onField(s, 'Test Big Goblin')).toEqual([]);
    expect(zone(s, 'graveyard', 'p2')).toContain('Test Big Goblin');
  });
  it('a player dealt damage discards a card; a creature dealt damage makes nobody discard', () => {
    let s = scenario([], { defs: [SHRIEK, BIG_BEAR, RITE], p1: { hand: ['Test Shriek', 'Test Shriek'] }, p2: { hand: ['Test Rite', 'Test Rite'], battlefield: ['Test Big Bear'] } });
    s = cast(s, 'Test Shriek', [[{ kind: 'player', id: 'p2' }]]);
    expect(zone(s, 'hand', 'p2')).toHaveLength(1);
    const bear = find(s, 'Test Big Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Shriek', [[{ kind: 'object', id: bear }]]);
    expect(zone(s, 'hand', 'p2')).toHaveLength(1);
    expect(zone(s, 'hand', 'p1')).toHaveLength(0);
  });
});

describe('CR 701.23a, 603.12: "When you search your library this way, ..." (a reflexive trigger of the search, whatever it found)', () => {
  const WANDER = card('Test Wander', 'Instant', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. When you search your library this way, put a +1/+1 counter on target creature you control.');
  it('is understood: the reflexive trigger waits for the search', () => {
    expect(noManual(WANDER)).toBe(true);
    expect(json(WANDER)).toContain('"op":"reflexive"');
  });
  it('a land found: it enters tapped and the creature gets a counter', () => {
    let s = scenario([], { defs: [WANDER, BEAR], p1: { hand: ['Test Wander'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const lands = onField(s, 'Plains').length;
    s = cast(s, 'Test Wander', [[{ kind: 'object', id: bear }]]);
    expect(onField(s, 'Plains').length).toBe(lands + 1);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
  });
  it('CR 701.23b: nothing found (a hidden zone searched for a stated quality), the library was still searched: the counter is put', () => {
    let s = scenario([], { defs: [WANDER, BEAR], p1: { hand: ['Test Wander'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const lands = onField(s, 'Plains').length;
    s = cast(s, 'Test Wander', [[{ kind: 'object', id: bear }]], none);
    expect(onField(s, 'Plains').length).toBe(lands);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
  });
  it('design 6.4: with no search before it, "when you search your library this way" stays manual', () => {
    const NO = card('Test No Search', 'Instant', 'Draw a card. When you search your library this way, put a +1/+1 counter on target creature you control.');
    expect(noManual(NO)).toBe(false);
  });
});

describe('CR 701.25a, 608.2c, 400.7: "Surveil 1. If you put a land card into your graveyard this way, put that card into your hand."', () => {
  const CONFIDANT = card('Test Confidant', 'Creature — Cleric', 'When this creature enters, surveil 1. If you put a land card into your graveyard this way, put that card into your hand.', { pt: ['1', '1'] });
  it('is understood: the card the surveil put into your graveyard', () => expect(noManual(CONFIDANT)).toBe(true));
  it('a land put into the graveyard comes back to the hand', () => {
    let s = scenario([], { defs: [CONFIDANT], p1: { hand: ['Test Confidant'] } });
    const hand = zone(s, 'hand', 'p1').length;
    s = cast(s, 'Test Confidant', [], (options) => options.slice(0, 1));
    expect(zone(s, 'hand', 'p1').length).toBe(hand); // the creature left the hand, the Plains came back
    expect(zone(s, 'hand', 'p1')).toContain('Plains');
    expect(zone(s, 'graveyard', 'p1')).not.toContain('Plains');
  });
  it('the land left on top: nothing comes back; a nonland card put into the graveyard stays there', () => {
    let s = scenario([], { defs: [CONFIDANT, RITE], p1: { hand: ['Test Confidant', 'Test Confidant'], library: ['Test Rite'] } });
    s = cast(s, 'Test Confidant', [], (options) => options.slice(0, 1));
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Rite');
    expect(zone(s, 'hand', 'p1')).not.toContain('Test Rite');
    const hand = zone(s, 'hand', 'p1').length;
    s = cast(s, 'Test Confidant', [], none);
    expect(zone(s, 'hand', 'p1').length).toBe(hand - 1);
  });
  it('design 6.4: after a surveil of two cards, "that card" names no one card and stays manual', () => {
    const TWO = card('Test Two Confidant', 'Creature — Cleric', 'When this creature enters, surveil 2. If you put a land card into your graveyard this way, put that card into your hand.', { pt: ['1', '1'] });
    expect(noManual(TWO)).toBe(false);
  });
});

describe('CR 608.2c, 608.2f, 608.2h: "For each opponent who controlled a creature returned this way, ..." (the controller as it last existed on the battlefield)', () => {
  const PARTY = card('Test Party', 'Sorcery', "Return all creatures to their owners' hands. For each opponent who controlled a creature returned this way, you draw a card.");
  it('is understood', () => expect(noManual(PARTY)).toBe(true));
  it('the opponent controlled a returned creature: you draw one card; your own creature counts for nobody', () => {
    let s = scenario([], { defs: [PARTY, BEAR, ELF], p1: { hand: ['Test Party'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    const hand = zone(s, 'hand', 'p1').length;
    s = cast(s, 'Test Party');
    expect(zone(s, 'hand', 'p2')).toEqual(['Test Bear', 'Test Bear']);
    expect(zone(s, 'hand', 'p1').length).toBe(hand - 1 + 1 + 1); // the sorcery left, the Elf came back, one card drawn
  });
  it('the opponent controlled no creature: no card is drawn', () => {
    let s = scenario([], { defs: [PARTY, ELF], p1: { hand: ['Test Party'], battlefield: ['Test Elf'] } });
    const hand = zone(s, 'hand', 'p1').length;
    s = cast(s, 'Test Party');
    expect(zone(s, 'hand', 'p1').length).toBe(hand - 1 + 1);
  });
});

describe('CR 608.2c, 611.2a, 400.7: "Exile all the cards from your hand, then draw that many cards. Until the end of your next turn, you may play cards exiled this way."', () => {
  const HEX = card('Test Hex', 'Sorcery', 'Exile all the cards from your hand, then draw that many cards. Until the end of your next turn, you may play cards exiled this way.');
  it('is understood: the group the exile made, read again', () => expect(noManual(HEX)).toBe(true));
  it('two cards exiled, two drawn; the exiled land may be played', () => {
    let s = scenario([], { defs: [HEX, RITE], p1: { hand: ['Test Hex', 'Plains', 'Test Rite'] } });
    s = cast(s, 'Test Hex');
    expect(s.zones.exile).toHaveLength(2);
    expect(zone(s, 'hand', 'p1')).toHaveLength(2);
    const land = exiled(s, 'Plains')[0]!;
    expect(legal(s, 'p1', 'playLand').some((a) => a.object === land)).toBe(true);
  });
});

describe('CR 608.2c, 400.7, 110.2a, 701.21a: "Then each player returns all creature cards from their graveyard that weren\'t put there this way to the battlefield."', () => {
  const GIFT = card('Test Gift', 'Creature — Demon', "When this creature enters, each player sacrifices all other creatures they control. Then each player returns all creature cards from their graveyard that weren't put there this way to the battlefield.", { pt: ['6', '6'] });
  it('is understood', () => expect(noManual(GIFT)).toBe(true));
  it('the sacrificed creatures stay in the graveyards; the others return under their owners\' control', () => {
    let s = scenario([], { defs: [GIFT, BEAR, ELF, BIG_GOBLIN], p1: { hand: ['Test Gift'], battlefield: ['Test Bear'], graveyard: ['Test Big Goblin'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Elf'] } });
    s = cast(s, 'Test Gift');
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(zone(s, 'graveyard', 'p1')).toEqual(['Test Bear']);
    expect(zone(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
    const goblin = onField(s, 'Test Big Goblin');
    const elf = onField(s, 'Test Elf');
    expect(goblin).toHaveLength(1);
    expect(elf).toHaveLength(1);
    expect(s.objects[goblin[0]!]!.controller).toBe('p1');
    expect(s.objects[elf[0]!]!.controller).toBe('p2');
    expect(onField(s, 'Test Gift')).toHaveLength(1);
  });
});

describe('CR 700.4, 608.2h, 406.1: "... then exile the top X cards of your library, where X is the number of artifacts that were put into graveyards from the battlefield this turn."', () => {
  const RAMPAGE = card('Test Rampage', 'Sorcery', "Destroy all artifacts you don't control, then exile the top X cards of your library, where X is the number of artifacts that were put into graveyards from the battlefield this turn.");
  it('is understood: X counts the turn\'s history when the exile is performed', () => expect(noManual(RAMPAGE)).toBe(true));
  it('the two artifacts the first instruction destroyed count: two cards are exiled', () => {
    let s = scenario([], { defs: [RAMPAGE, IDOL], p1: { hand: ['Test Rampage'], battlefield: ['Test Idol'] }, p2: { battlefield: ['Test Idol', 'Test Idol'] } });
    s = cast(s, 'Test Rampage');
    expect(zone(s, 'graveyard', 'p2')).toEqual(['Test Idol', 'Test Idol']);
    expect(onField(s, 'Test Idol')).toHaveLength(1);
    expect(s.zones.exile).toHaveLength(2);
  });
});

describe('CR 608.2c: "If you put no cards into your hand this way, ..." is "If you don\'t put a card into your hand this way"', () => {
  const NASHI = card('Test Searcher', 'Creature — Rat', 'When this creature enters, mill three cards. You may put a creature card from among them into your hand. If you put no cards into your hand this way, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(NASHI)).toBe(true));
  it('a creature card taken: no counter; none milled: a counter', () => {
    let s = scenario([], { defs: [NASHI, BEAR], p1: { hand: ['Test Searcher', 'Test Searcher'], library: ['Test Bear', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Searcher', [], named('Test Bear'));
    expect(zone(s, 'hand', 'p1')).toContain('Test Bear');
    const first = find(s, 'Test Searcher', 'battlefield', 'p1');
    expect(s.objects[first]!.counters['+1/+1'] ?? 0).toBe(0);
    s = cast(s, 'Test Searcher');
    const second = onField(s, 'Test Searcher').find((id) => id !== first)!;
    expect(s.objects[second]!.counters['+1/+1']).toBe(1);
  });
});
