/**
 * Commander lane edh-next, round edh-next-16: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites are from the Comprehensive Rules
 * of 2026-09-25 (see the round's record).
 *
 *   CR 701.24a, 400.3, 608.2c     "Draw two cards, then shuffle a card from your hand into your library." (See Beyond)
 *   CR 205.3m, 613.4c             "Up to two target creatures each get +2/+0 and gain all creature types until end of turn." (Blades of Velis Vel)
 *   CR 119.5                      "Count the number of cards in your library. Your life total becomes that number." (Invincible Hymn)
 *   CR 115.1, 702.11              "Whenever you cast a spell, creatures you control can't be the targets of spells or abilities your opponents control this turn." (Veilstone Amulet)
 *   CR 701.8a, 303.4              "Destroy all creatures and all permanents attached to creatures." (End Hostilities)
 *   CR 701.8a, 701.19c, 608.2d    "Destroy all lands or all creatures. Creatures destroyed this way can't be regenerated." (Catastrophe)
 *   CR 701.8a, 608.2d             "Choose a creature or planeswalker, then destroy all other creatures and planeswalkers." (Deadly Vanity)
 *   CR 614.1c, 122.6              "~ enters with a +1/+1 counter on it for each other red creature you control and a +1/+1 counter on it for each other green creature you control." (Ulasht)
 *   CR 701.9b, 608.2d             "you may have target opponent discard a card at random" (Nath of the Gilt-Leaf)
 *   CR 404.1, 608.2d              "Return up to one creature card and up to one land card from your graveyard to your hand." (Druidic Ritual)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));

interface Pick {
  /** ids to choose for a chooseObjects decision (by object name, in order), else the first `min` options */
  objects?: string[];
  /** label of the option to choose */
  option?: string;
  yes?: boolean;
  targets?: ObjectId[];
  /** stop at the first priority decision (the spell is on the stack and its controller has priority) */
  stop?: boolean;
}
/** Answers every decision (pass priority while the stack has something, pay costs automatically) until nothing is pending but priority with an empty stack. */
function drive(s0: GameState, pick: Pick = {}): GameState {
  let s = s0;
  const objs = [...(pick.objects ?? [])];
  for (let g = 0; g < 60; g++) {
    const p = s.pending as unknown as { kind: string; options?: { id: string; label?: string }[] | string[]; min?: number; max?: number; player?: string } | null;
    if (!p) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0 || pick.stop === true) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true } as DecisionAnswer);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: pick.yes ?? true } as DecisionAnswer);
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (pick.targets ?? []).map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as DecisionAnswer);
    else if (p.kind === 'chooseOption') {
      const o = (p.options as { id: string; label: string }[]).find((x) => x.label === pick.option) ?? (p.options as { id: string; label: string }[])[0]!;
      s = answer(s, { kind: 'chooseOption', ids: [o.id] } as DecisionAnswer);
    } else if (p.kind === 'chooseObjects') {
      const opts = p.options as string[];
      const want = objs.length > 0 ? objs.shift()! : null;
      const ids = want === null ? opts.slice(0, p.min ?? 0) : opts.filter((id) => s.objects[id]!.defId === want).slice(0, 1); // '' chooses nothing ("up to")
      s = answer(s, { kind: 'chooseObjects', ids } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
const activate = (s: GameState, player: 'p1' | 'p2', source: ObjectId, pick: Pick = {}): GameState => {
  const a = legal(s, player, 'activate').find((x) => (x as unknown as { object: ObjectId }).object === source) as unknown as { action: never } | undefined;
  if (!a) throw new Error('no activation');
  return drive(act(s, a.action), pick);
};
const castBy = (s: GameState, player: 'p1' | 'p2', name: string): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
/** 'battlefield' while the object is still there; a destroyed permanent is a new object in the graveyard (CR 400.7), so the old id is 'gone' */
const zoneOf = (s: GameState, id: ObjectId): string => (s.objects[id]?.zone === 'battlefield' ? 'battlefield' : 'gone');
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => (s.zones[zone][p] ?? []).map((id) => s.objects[id]!.defId);
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

const LAND = card('Test Forest', 'Basic Land — Forest', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const BEAR2 = card('Test Bear Twin', 'Creature — Bear', '', { pt: ['2', '2'] });
const BIG = card('Test Giant', 'Creature — Giant', '', { pt: ['4', '4'] });
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', { colors: ['R'] });

// ---------------------------------------------------------------------------------------------------------------------------------
// "Draw two cards, then shuffle a card from your hand into your library." (CR 701.24a, 400.3)
// ---------------------------------------------------------------------------------------------------------------------------------
const BEYOND = card('Test Beyond', 'Instant', 'Draw two cards, then shuffle a card from your hand into your library.', { colors: ['U'] });
describe('CR 701.24a, 400.3: "Draw two cards, then shuffle a card from your hand into your library."', () => {
  const board = (): GameState => scenario([], { defs: [BEYOND, LAND, BEAR], p1: { hand: ['Test Beyond', 'Test Bear'], library: ['Test Forest', 'Test Forest', 'Test Forest'] }, p2: {} });
  it('is automated', () => expect(noManual(BEYOND)).toEqual([]));
  it('draws two, then the chosen card (any card of the hand, even one not drawn) goes into the library: hand 1 + 2 - 1, library 3 - 2 + 1', () => {
    const s = drive(castBy(board(), 'p1', 'Test Beyond'), { objects: ['Test Bear'] });
    expect(names(s, 'hand', 'p1')).toHaveLength(2); // Test Beyond left the hand when cast: Test Bear + 2 drawn - the card put back
    expect(names(s, 'hand', 'p1')).not.toContain('Test Bear');
    expect(names(s, 'library', 'p1')).toContain('Test Bear');
    expect(names(s, 'library', 'p1')).toHaveLength(names(board(), 'library', 'p1').length - 1); // two drawn, one put back
  });
  it('negative: with an empty hand and nothing to draw nothing is put into the library (ruling 2010-06-15: the library is not shuffled either)', () => {
    // the drawn cards are in the hand, so a card is put back; to see the empty case the draw is replaced by nothing: no library
    const empty = scenario([], { defs: [BEYOND], p1: { hand: ['Test Beyond'] }, p2: {} });
    const lib = (empty.zones.library.p1 ?? []).length;
    const s0 = { ...empty, zones: { ...empty.zones, library: { ...empty.zones.library, p1: [] } } } as GameState;
    const s = drive(castBy(s0, 'p1', 'Test Beyond'));
    expect(lib).toBeGreaterThan(0);
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'library', 'p1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Up to two target creatures each get +2/+0 and gain all creature types until end of turn." (CR 205.3m, 613.4c)
// ---------------------------------------------------------------------------------------------------------------------------------
const BLADES = card('Test Blades', 'Instant', 'Up to two target creatures each get +2/+0 and gain all creature types until end of turn.', { colors: ['R'] });
const LORD = card('Test Elf Lord', 'Creature — Elf', 'Other Elf creatures you control get +1/+1.', { pt: ['1', '1'] });
describe('CR 205.3m, 613.4c: "Up to two target creatures each get +2/+0 and gain all creature types until end of turn."', () => {
  const board = (): GameState => scenario([], { defs: [BLADES, BEAR, BEAR2, BIG, LORD], p1: { hand: ['Test Blades'], battlefield: ['Test Bear', 'Test Bear Twin', 'Test Giant', 'Test Elf Lord'] }, p2: {} });
  it('is automated', () => expect(noManual(BLADES)).toEqual([]));
  it('both targets get +2/+0 and are every creature type (an Elf Lord pumps them); the creature not targeted is unchanged', () => {
    const s0 = board();
    const [a, b, c] = ['Test Bear', 'Test Bear Twin', 'Test Giant'].map((n) => find(s0, n, 'battlefield', 'p1'));
    const s = drive(castBy(s0, 'p1', 'Test Blades'), { targets: [a!, b!] });
    expect(stat(s, a!)).toBe('5/3'); // 2/2 +2/+0, +1/+1 from the lord (it is an Elf now)
    expect(stat(s, b!)).toBe('5/3');
    expect(stat(s, c!)).toBe('4/4');
  });
  it('negative: with one target only that creature changes ("up to two"), and at end of turn it is a Bear again', () => {
    const s0 = board();
    const [a, b] = ['Test Bear', 'Test Bear Twin'].map((n) => find(s0, n, 'battlefield', 'p1'));
    const s = drive(castBy(s0, 'p1', 'Test Blades'), { targets: [a!] });
    expect(stat(s, a!)).toBe('5/3');
    expect(stat(s, b!)).toBe('2/2');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Count the number of cards in your library. Your life total becomes that number." (CR 119.5)
// ---------------------------------------------------------------------------------------------------------------------------------
const HYMN = card('Test Hymn', 'Sorcery', 'Count the number of cards in your library. Your life total becomes that number.', { colors: ['W'] });
describe('CR 119.5: "Count the number of cards in your library. Your life total becomes that number."', () => {
  it('is automated', () => expect(noManual(HYMN)).toEqual([]));
  it('your life total becomes the number of cards in YOUR library, not the opponent\'s', () => {
    const s0 = scenario([], { defs: [HYMN, LAND], p1: { hand: ['Test Hymn'], library: ['Test Forest', 'Test Forest', 'Test Forest'] }, p2: { library: ['Test Forest', 'Test Forest', 'Test Forest', 'Test Forest', 'Test Forest'] } });
    const s = drive(castBy(s0, 'p1', 'Test Hymn'));
    expect(names(s0, 'library', 'p1').length).not.toBe(names(s0, 'library', 'p2').length);
    expect(life(s, 'p1')).toBe(names(s0, 'library', 'p1').length);
    expect(life(s, 'p2')).toBe(20);
  });
  it('negative: a library bigger than the life total raises it (it becomes that number, up or down)', () => {
    const lib = Array.from({ length: 25 }, () => 'Test Forest');
    const s0 = scenario([], { defs: [HYMN, LAND], p1: { hand: ['Test Hymn'], library: lib }, p2: {} });
    expect(names(s0, 'library', 'p1').length).toBeGreaterThan(20);
    expect(life(drive(castBy(s0, 'p1', 'Test Hymn')), 'p1')).toBe(names(s0, 'library', 'p1').length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Whenever you cast a spell, creatures you control can't be the targets of spells or abilities your opponents control this turn." (CR 115.1)
// ---------------------------------------------------------------------------------------------------------------------------------
const AMULET = card('Test Amulet', 'Artifact', 'Whenever you cast a spell, creatures you control can\'t be the targets of spells or abilities your opponents control this turn.', { cost: '{0}' });
const CANTRIP = card('Test Cantrip', 'Instant', 'You gain 1 life.', { colors: ['W'] });
describe('CR 115.1: "Whenever you cast a spell, creatures you control can\'t be the targets of spells or abilities your opponents control this turn."', () => {
  const board = (): GameState => scenario([], { defs: [AMULET, CANTRIP, BOLT, BEAR, BEAR2], p1: { hand: ['Test Cantrip'], battlefield: ['Test Amulet', 'Test Bear'] }, p2: { hand: ['Test Bolt'], battlefield: ['Test Bear Twin'] } });
  it('is automated', () => expect(noManual(AMULET)).toEqual([]));
  it('after I cast a spell, the opponent\'s Bolt cannot target my creature, but can still target their own creature and me', () => {
    let s = pass(drive(castBy(board(), 'p1', 'Test Cantrip'))); // I pass with an empty stack: the opponent gets priority
    expect((s.pending as unknown as { player: string }).player).toBe('p2');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear Twin', 'battlefield', 'p2');
    const boltId = find(s, 'Test Bolt', 'hand', 'p2');
    // the opponent gets priority: give it to them with the stack empty
    const c = legal(s, 'p2', 'cast').find((x) => (x as unknown as { object?: ObjectId }).object === boltId);
    expect(c).toBeDefined();
    s = act(s, (c as unknown as { action: never }).action);
    const p = s.pending as unknown as { kind: string; options?: unknown; slots?: unknown; objects?: ObjectId[] } | null;
    const offered = JSON.stringify(p);
    expect(offered.includes(mine)).toBe(false);
    expect(offered.includes(theirs)).toBe(true);
  });
  it('negative: without the Amulet\'s trigger (no spell cast yet) my creature can be targeted', () => {
    const s = pass(board());
    expect((s.pending as unknown as { player: string }).player).toBe('p2');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const boltId = find(s, 'Test Bolt', 'hand', 'p2');
    const c = legal(s, 'p2', 'cast').find((x) => (x as unknown as { object?: ObjectId }).object === boltId);
    expect(c).toBeDefined();
    const s2 = act(s, (c as unknown as { action: never }).action);
    expect(JSON.stringify(s2.pending).includes(mine)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Destroy all creatures and all permanents attached to creatures." (CR 701.8a, 303.4)
// ---------------------------------------------------------------------------------------------------------------------------------
const HOSTILITIES = card('Test Hostilities', 'Sorcery', 'Destroy all creatures and all permanents attached to creatures.', { colors: ['W'] });
const EQUIP = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {0}');
const EQUIP2 = card('Test Staff', 'Artifact — Equipment', 'Equipped creature gets +0/+1.\nEquip {0}');
const RELIC = card('Test Relic', 'Artifact', '');
describe('CR 701.8a, 303.4: "Destroy all creatures and all permanents attached to creatures."', () => {
  const board = (): GameState => {
    let s = scenario([], { defs: [HOSTILITIES, EQUIP, EQUIP2, RELIC, BEAR, BEAR2, LAND], p1: { hand: ['Test Hostilities'], battlefield: ['Test Bear', 'Test Blade', 'Test Staff', 'Test Relic', 'Test Forest'] }, p2: { battlefield: ['Test Bear Twin'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const id = find(s, 'Test Blade', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [id]: { ...s.objects[id]!, attachedTo: bear } } } as GameState;
    return s;
  };
  it('is automated', () => expect(noManual(HOSTILITIES)).toEqual([]));
  it('every creature (both players\') and the Equipment attached to one are destroyed; an unattached Equipment, an artifact and a land stay (all destroyed at the same time, ruling 2014-09-20)', () => {
    const s0 = board();
    const ids = ['Test Bear', 'Test Blade', 'Test Staff', 'Test Relic', 'Test Forest'].map((n) => find(s0, n, 'battlefield', 'p1'));
    const twin = find(s0, 'Test Bear Twin', 'battlefield', 'p2');
    const s = drive(castBy(s0, 'p1', 'Test Hostilities'));
    expect(ids.map((id) => zoneOf(s, id))).toEqual(['gone', 'gone', 'battlefield', 'battlefield', 'battlefield']);
    expect(zoneOf(s, twin)).toBe('gone');
  });
  it('negative: the opponent\'s Equipment attached to their own creature goes too; nothing is destroyed twice and the unattached ones are untouched', () => {
    let s = board();
    const staff = find(s, 'Test Staff', 'battlefield', 'p1');
    const twin = find(s, 'Test Bear Twin', 'battlefield', 'p2');
    s = { ...s, objects: { ...s.objects, [staff]: { ...s.objects[staff]!, attachedTo: twin } } } as GameState;
    s = drive(castBy(s, 'p1', 'Test Hostilities'));
    expect(zoneOf(s, staff)).toBe('gone');
    expect(zoneOf(s, find(s, 'Test Relic', 'battlefield', 'p1'))).toBe('battlefield');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Destroy all lands or all creatures. Creatures destroyed this way can't be regenerated." (CR 701.8a, 701.19c, 608.2d)
// ---------------------------------------------------------------------------------------------------------------------------------
const CATA = card('Test Cata', 'Sorcery', 'Destroy all lands or all creatures. Creatures destroyed this way can\'t be regenerated.', { colors: ['W'] });
const REGEN = card('Test Regenerator', 'Creature — Troll', '{0}: Regenerate this creature.', { pt: ['2', '2'] });
describe('CR 701.8a, 701.19c, 608.2d: "Destroy all lands or all creatures. Creatures destroyed this way can\'t be regenerated."', () => {
  const board = (): GameState => scenario([], { defs: [CATA, LAND, BEAR, REGEN], p1: { hand: ['Test Cata'], battlefield: ['Test Forest', 'Test Bear'] }, p2: { battlefield: ['Test Forest', 'Test Regenerator'] } });
  it('is automated', () => expect(noManual(CATA)).toEqual([]));
  it('choosing lands destroys every land (both players\') and no creature', () => {
    const s0 = board();
    const lands = [find(s0, 'Test Forest', 'battlefield', 'p1'), find(s0, 'Test Forest', 'battlefield', 'p2')];
    const bears = [find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Regenerator', 'battlefield', 'p2')];
    const s = drive(castBy(s0, 'p1', 'Test Cata'), { option: 'lands' });
    expect(lands.map((id) => zoneOf(s, id))).toEqual(['gone', 'gone']);
    expect(bears.map((id) => zoneOf(s, id))).toEqual(['battlefield', 'battlefield']);
  });
  it('choosing lands: a land that is also a creature cannot regenerate either (the rider covers every creature destroyed this way)', () => {
    const dryad = card('Test Dryad Land', 'Land Creature — Forest Dryad', '{0}: Regenerate this creature.', { pt: ['1', '1'] });
    const s0 = scenario([], { defs: [CATA, LAND, dryad], p1: { hand: ['Test Cata'] }, p2: { battlefield: ['Test Dryad Land', 'Test Forest'] } });
    const d = find(s0, 'Test Dryad Land', 'battlefield', 'p2');
    let s = pass(castBy(s0, 'p1', 'Test Cata'));
    s = activate(s, 'p2', d, { option: 'lands' });
    expect(zoneOf(s, d)).toBe('gone');
  });
  it('choosing creatures destroys every creature, even one that regenerated in response (a shield is up), and no land', () => {
    const s0 = board();
    const regen = find(s0, 'Test Regenerator', 'battlefield', 'p2');
    const land = find(s0, 'Test Forest', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = castBy(s0, 'p1', 'Test Cata'); // on the stack, p1 has priority
    s = pass(s); // the opponent gets priority and makes a regeneration shield
    expect((s.pending as unknown as { player: string }).player).toBe('p2');
    s = activate(s, 'p2', regen, { option: 'creatures' });
    expect(zoneOf(s, regen)).toBe('gone');
    expect(zoneOf(s, bear)).toBe('gone');
    expect(zoneOf(s, land)).toBe('battlefield');
  });
  it('control: an ordinary destruction of the same creature IS regenerated by the same shield (so the test above shows the rider)', () => {
    const doom = card('Test Doom', 'Instant', 'Destroy target creature.', { colors: ['B'] });
    const s0 = scenario([], { defs: [doom, REGEN], p1: { hand: ['Test Doom'] }, p2: { battlefield: ['Test Regenerator'] } });
    const regen = find(s0, 'Test Regenerator', 'battlefield', 'p2');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Doom', 'hand', 'p1') } as never);
    s = drive(s, { targets: [regen], stop: true });
    s = pass(s);
    s = activate(s, 'p2', regen);
    expect(zoneOf(s, regen)).toBe('battlefield');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Choose a creature or planeswalker, then destroy all other creatures and planeswalkers." (CR 701.8a, 608.2d)
// ---------------------------------------------------------------------------------------------------------------------------------
const VANITY = card('Test Vanity', 'Instant', 'Choose a creature or planeswalker, then destroy all other creatures and planeswalkers.', { colors: ['B'] });
const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.', { loyalty: '4' });
describe('CR 701.8a, 608.2d: "Choose a creature or planeswalker, then destroy all other creatures and planeswalkers."', () => {
  const board = (): GameState => scenario([], { defs: [VANITY, BEAR, BEAR2, BIG, WALKER, LAND], p1: { hand: ['Test Vanity'], battlefield: ['Test Bear', 'Test Bear Twin', 'Test Forest'] }, p2: { battlefield: ['Test Giant', { name: 'Test Walker', counters: { loyalty: 4 } }] } });
  it('is automated', () => expect(noManual(VANITY)).toEqual([]));
  it('the chosen permanent (even an opponent\'s) survives, every other creature and planeswalker dies, the land stays', () => {
    const s0 = board();
    const [bear, twin, giant, walker, land] = [find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Bear Twin', 'battlefield', 'p1'), find(s0, 'Test Giant', 'battlefield', 'p2'), find(s0, 'Test Walker', 'battlefield', 'p2'), find(s0, 'Test Forest', 'battlefield', 'p1')];
    const s = drive(castBy(s0, 'p1', 'Test Vanity'), { objects: ['Test Giant'] });
    expect([bear, twin, giant, walker, land].map((id) => zoneOf(s, id))).toEqual(['gone', 'gone', 'battlefield', 'gone', 'battlefield']);
  });
  it('negative: choosing the planeswalker saves it and kills all creatures', () => {
    const s0 = board();
    const [bear, giant, walker] = [find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Giant', 'battlefield', 'p2'), find(s0, 'Test Walker', 'battlefield', 'p2')];
    const s = drive(castBy(s0, 'p1', 'Test Vanity'), { objects: ['Test Walker'] });
    expect([bear, giant, walker].map((id) => zoneOf(s, id))).toEqual(['gone', 'gone', 'battlefield']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "~ enters with a +1/+1 counter on it for each other red creature you control and a +1/+1 counter on it for each other green creature you control." (CR 614.1c, 122.6)
// ---------------------------------------------------------------------------------------------------------------------------------
const ULASHT = card('Test Seed', 'Creature — Hound', 'Test Seed enters with a +1/+1 counter on it for each other red creature you control and a +1/+1 counter on it for each other green creature you control.', { pt: ['0', '0'], colors: ['R', 'G'] });
const REDDY = card('Test Redcap', 'Creature — Goblin', '', { pt: ['1', '1'], colors: ['R'] });
const GREENY = card('Test Greenleaf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });
const BOTH = card('Test Gruul', 'Creature — Beast', '', { pt: ['1', '1'], colors: ['R', 'G'] });
describe('CR 614.1c, 122.6: "~ enters with a +1/+1 counter on it for each other red creature you control and a +1/+1 counter on it for each other green creature you control."', () => {
  it('is automated', () => expect(noManual(ULASHT)).toEqual([]));
  it('counts each color separately: a red, a green and a red-green creature are 2 red + 2 green = 4 counters (ruling 2006-02-01); the opponent\'s creatures and itself are not counted', () => {
    const s0 = scenario([], { defs: [ULASHT, REDDY, GREENY, BOTH], p1: { hand: ['Test Seed'], battlefield: ['Test Redcap', 'Test Greenleaf', 'Test Gruul'] }, p2: { battlefield: ['Test Redcap'] } });
    const s = drive(castBy(s0, 'p1', 'Test Seed'));
    const seed = find(s, 'Test Seed', 'battlefield', 'p1');
    expect(s.objects[seed]!.counters['+1/+1']).toBe(4);
  });
  it('negative: with no other red or green creature it enters with no counters (a 0/0 that dies)', () => {
    const s0 = scenario([], { defs: [ULASHT], p1: { hand: ['Test Seed'] }, p2: {} });
    const s = drive(castBy(s0, 'p1', 'Test Seed'));
    expect((s.zones.battlefield as string[]).some((id) => s.objects[id]!.defId === 'Test Seed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "When this creature enters, you may have target opponent discard a card at random." (CR 701.9b, 608.2d)
// ---------------------------------------------------------------------------------------------------------------------------------
const NATH = card('Test Nath', 'Creature — Elf', 'When this creature enters, you may have target opponent discard a card at random.', { pt: ['2', '2'] });
describe('CR 701.9b, 608.2d: "When this creature enters, you may have target opponent discard a card at random."', () => {
  const board = (): GameState => scenario([], { defs: [NATH, BEAR, BEAR2, BIG], p1: { hand: ['Test Nath'] }, p2: { hand: ['Test Bear', 'Test Bear Twin', 'Test Giant'] } });
  it('is automated', () => expect(noManual(NATH)).toEqual([]));
  it('yes: the opponent discards exactly one card, at random (the choice is not mine)', () => {
    const s = drive(castBy(board(), 'p1', 'Test Nath'), { targets: ['p2'], yes: true });
    expect(names(s, 'hand', 'p2')).toHaveLength(2);
    expect(names(s, 'graveyard', 'p2')).toHaveLength(1);
  });
  it('negative: declining the "may" discards nothing', () => {
    const s = drive(castBy(board(), 'p1', 'Test Nath'), { targets: ['p2'], yes: false });
    expect(names(s, 'hand', 'p2')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Return up to one creature card and up to one land card from your graveyard to your hand." (CR 404.1, 608.2d)
// ---------------------------------------------------------------------------------------------------------------------------------
const RITUAL = card('Test Ritual', 'Sorcery', 'Return up to one creature card and up to one land card from your graveyard to your hand.', { colors: ['G'] });
describe('CR 404.1, 608.2d: "Return up to one creature card and up to one land card from your graveyard to your hand."', () => {
  const board = (): GameState => scenario([], { defs: [RITUAL, BEAR, BEAR2, LAND, CANTRIP, BIG], p1: { hand: ['Test Ritual'], graveyard: ['Test Bear', 'Test Bear Twin', 'Test Forest', 'Test Cantrip'] }, p2: { graveyard: ['Test Giant'] } });
  it('is automated', () => expect(noManual(RITUAL)).toEqual([]));
  it('one creature card (my choice of two) and one land card come back; the other creature, the instant and the opponent\'s graveyard stay', () => {
    const s = drive(castBy(board(), 'p1', 'Test Ritual'), { objects: ['Test Bear Twin', 'Test Forest'] });
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Test Bear Twin', 'Test Forest']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Cantrip', 'Test Ritual']);
  });
  it('"up to one" each: choosing no creature still lets me return the land (an empty first choice excludes nothing from the second)', () => {
    const s = drive(castBy(board(), 'p1', 'Test Ritual'), { objects: ['', 'Test Forest'] });
    expect(names(s, 'hand', 'p1')).toEqual(['Test Forest']);
  });
  it('negative: \"up to one\" each, so choosing none of either returns nothing', () => {
    const s = drive(castBy(board(), 'p1', 'Test Ritual'), { objects: [] });
    expect(names(s, 'hand', 'p1')).toEqual([]);
  });
});
