/**
 * edh-zones-10 (Commander effort, lane edh-zones), played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler. CR cites from memory, unverified unless the file says so.
 *
 *   CR 701.23a, 701.24a, 401.2   "Search your library for a F card with mana value N or greater, reveal it, then shuffle and put that card on top."
 *   CR 701.20a, 701.24a, 107.3   "When you cast this spell, reveal the top X cards ... may put a nonland permanent card with mana value X or less ... Then shuffle the rest into your library."
 *   CR 701.23a, 202.3, 608.2d    "Search your library for any number of creature cards with total mana value N or less, put them onto the battlefield, then shuffle."
 *   CR 701.23a, 701.23d, 400.7   "Search your library for two cards. Put one into your hand and the other into your graveyard. Then shuffle."
 *   CR 608.2c, 108.1, 603.2      "If it's a nonland card, you may cast it without paying its mana cost." (after another player's exile)
 *   CR 110.4, 608.2c             "Return another permanent you control that shares a permanent type with it to its owner's hand."
 *   CR 108.3, 400.3, 110.2       "target opponent exiles ... you may put any number of land cards that player owns from exile onto the battlefield under your control"
 *   CR 608.2c, 201.2             "Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, zone: 'hand' | 'library' | 'graveyard', who: 'p1' | 'p2'): string[] => s.zones[zone][who]!.map((id) => nameOf(s, id));
const onBf = (s: GameState, who: 'p1' | 'p2', name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === who && nameOf(s, id) === name).length;
const inExile = (s: GameState, name: string): number => s.zones.exile.filter((id) => nameOf(s, id) === name).length;

interface Script {
  yes?: boolean[];                                   // answers of yes/no decisions in order (default true)
  pick?: (s: GameState, options: readonly ObjectId[], min: number, max: number) => ObjectId[];
  x?: number;
  targets?: ObjectId[][];
  asked?: { yesNo: number; chooseObjects: number };  // filled in
}

/** Answer the decisions that come up until priority with an empty stack (payments automatic). */
function drive(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const yes = [...(sc.yes ?? [])];
  const q = [...(sc.targets ?? [])];
  for (let guard = 0; guard < 200 && s.pending; guard++) {
    const p = s.pending;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
      continue;
    }
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => (/^p\d+$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: sc.x ?? p.min });
    else if (p.kind === 'yesNo') { if (sc.asked) sc.asked.yesNo++; s = answer(s, { kind: 'yesNo', yes: yes.length > 0 ? yes.shift()! : true }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseObjects') {
      if (sc.asked) sc.asked.chooseObjects++;
      const ids = sc.pick ? sc.pick(s, p.options, p.min, p.max) : p.options.slice(0, p.max);
      s = answer(s, { kind: 'chooseObjects', ids } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const cast = (s: GameState, name: string, sc: Script = {}, who: 'p1' | 'p2' = 'p1'): GameState =>
  drive(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who), ...(sc.x !== undefined ? { x: sc.x } : {}) } as never), sc);
const byName = (...wanted: string[]) => (s: GameState, options: readonly ObjectId[]): ObjectId[] => wanted.map((w) => options.find((id) => nameOf(s, id) === w)!).filter((x) => x !== undefined);

const SMALL = card('Test Pup', 'Creature — Beast', '', { pt: ['1', '1'], cost: '{1}{G}' });
const MID = card('Test Stag', 'Creature — Beast', '', { pt: ['3', '3'], cost: '{3}{G}' });
const BIG = card('Test Bull', 'Creature — Beast', '', { pt: ['5', '5'], cost: '{4}{G}' });
const HUGE = card('Test Mammoth', 'Creature — Beast', '', { pt: ['7', '7'], cost: '{6}{G}' });
const ROCK = card('Test Rock', 'Artifact', '', { cost: '{4}' });
const GEM = card('Test Gem', 'Artifact', '', { cost: '{1}' });
const SHRINE = card('Test Shrine', 'Enchantment', '', { cost: '{2}{W}' });
const FOREST = card('Test Glade', 'Basic Land — Forest', '');
const TUTOR = card('Test Tutor Top', 'Sorcery', 'Search your library for a creature card with mana value 4 or greater, reveal it, then shuffle and put that card on top.');

describe('CR 701.23a, 701.24a, 401.2: "Search your library for a creature card with mana value 4 or greater, reveal it, then shuffle and put that card on top."', () => {
  const board = (): GameState => scenario([], { defs: [TUTOR, SMALL, MID, BIG, HUGE], p1: { hand: ['Test Tutor Top'], library: ['Test Pup', 'Test Stag', 'Test Bull', 'Test Mammoth'] } });
  it('is understood', () => expect(noManual(TUTOR)).toBe(true));
  it('only creature cards with mana value 4 or greater are offered; the card found is the top card of the library after the shuffle', () => {
    let offered: string[] = [];
    const s = cast(board(), 'Test Tutor Top', { pick: (st, options) => { offered = options.map((id) => nameOf(st, id)).sort(); return byName('Test Mammoth')(st, options); } });
    expect(offered).toEqual(['Test Bull', 'Test Mammoth', 'Test Stag']); // the Pup (mana value 2) is not offered; the Stag has mana value 4: "or greater" includes it
    expect(names(s, 'library', 'p1')[0]).toBe('Test Mammoth');
    expect(names(s, 'library', 'p1').filter((n) => n === 'Test Mammoth').length).toBe(1);
  });
  it('negative: nothing in the library fits, so the library keeps its cards and nothing is put on top', () => {
    const s0 = scenario([], { defs: [TUTOR, SMALL], p1: { hand: ['Test Tutor Top'], library: ['Test Pup'] } });
    const before = names(s0, 'library', 'p1').length;
    const s = cast(s0, 'Test Tutor Top');
    expect(names(s, 'library', 'p1').length).toBe(before);
  });
});

const HYDRA = card('Test Hydra', 'Creature — Hydra', 'When you cast this spell, reveal the top X cards of your library. You may put a nonland permanent card with mana value X or less from among them onto the battlefield. Then shuffle the rest into your library.\nThis creature enters with X +1/+1 counters on it.', { pt: ['0', '0'], cost: '{X}' });

describe('CR 107.3, 701.20a, 701.24a: "When you cast this spell, reveal the top X cards of your library. You may put a nonland permanent card with mana value X or less from among them onto the battlefield. Then shuffle the rest into your library."', () => {
  const board = (): GameState => scenario([], { defs: [HYDRA, SMALL, ROCK, GEM, FOREST], p1: { hand: ['Test Hydra'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Rock', 'Test Pup', 'Test Glade', 'Test Gem'] } });
  it('is understood', () => expect(noManual(HYDRA)).toBe(true));
  it('X is 2: the top two cards are revealed; the Pup (mana value 2) comes onto the battlefield; the rock (4) and the unrevealed gem are not offered; the rest are shuffled into the library', () => {
    let offered: string[] = [];
    const s = cast(board(), 'Test Hydra', { x: 2, pick: (st, options) => { offered = options.map((id) => nameOf(st, id)); return options.slice(0, 1); } });
    expect(offered).toEqual(['Test Pup']);
    expect(onBf(s, 'p1', 'Test Pup')).toBe(1);
    expect(onBf(s, 'p1', 'Test Hydra')).toBe(1);
    expect(names(s, 'library', 'p1')).toContain('Test Rock'); // the rest went (back) into the library
    expect(names(s, 'library', 'p1')).toContain('Test Gem');
  });
  it('negative: X is 1 and the only card revealed is the rock (mana value 4): nothing comes onto the battlefield', () => {
    const s = cast(board(), 'Test Hydra', { x: 1 });
    expect(onBf(s, 'p1', 'Test Pup')).toBe(0);
    expect(onBf(s, 'p1', 'Test Rock')).toBe(0);
    expect(onBf(s, 'p1', 'Test Hydra')).toBe(1);
  });
  it('negative: the player may decline', () => {
    const s = cast(board(), 'Test Hydra', { x: 2, pick: () => [] });
    expect(onBf(s, 'p1', 'Test Pup')).toBe(0);
    expect(names(s, 'library', 'p1')).toContain('Test Pup'); // declined: the revealed card stays among the rest, shuffled into the library
  });
});

const HULK = card('Test Hulk', 'Creature — Elemental', 'When this creature dies, search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle.', { pt: ['6', '6'], cost: '{5}{G}' });
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');

describe('CR 701.23a, 202.3, 608.2d: "search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle"', () => {
  const board = (): GameState => scenario([], { defs: [HULK, SMITE, SMALL, MID, BIG], p1: { hand: ['Test Smite'], battlefield: ['Test Hulk'], library: ['Test Pup', 'Test Stag', 'Test Bull'] } });
  const kill = (s0: GameState, pick: (s: GameState, o: readonly ObjectId[]) => ObjectId[]): GameState => cast(s0, 'Test Smite', { targets: [[find(s0, 'Test Hulk', 'battlefield')]], pick });
  it('is understood', () => expect(noManual(HULK)).toBe(true));
  it('mana values 2 + 4 = 6: both come onto the battlefield; the Bull (5) was a candidate too', () => {
    const s = kill(board(), byName('Test Pup', 'Test Stag'));
    expect(onBf(s, 'p1', 'Test Pup')).toBe(1);
    expect(onBf(s, 'p1', 'Test Stag')).toBe(1);
    expect(onBf(s, 'p1', 'Test Bull')).toBe(0);
  });
  it('negative: mana values 4 + 5 = 9 is over the limit and the engine refuses that answer; fewer cards, or none, are legal', () => {
    const s0 = board();
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smite', 'hand', 'p1') } as never);
    for (let g = 0; g < 20 && t.pending?.kind !== 'chooseObjects'; g++) {
      const p = t.pending!;
      if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, 'Test Hulk', 'battlefield') }] });
      else if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else if (p.kind === 'priority') t = pass(t);
      else throw new Error(`unexpected ${p.kind}`);
    }
    expect(t.pending?.kind).toBe('chooseObjects');
    const opts = (t.pending as { options: ObjectId[] }).options;
    const stag = opts.find((id) => nameOf(t, id) === 'Test Stag')!;
    const bull = opts.find((id) => nameOf(t, id) === 'Test Bull')!;
    expect(() => answer(t, { kind: 'chooseObjects', ids: [stag, bull] } as DecisionAnswer)).toThrow(); // 4 + 5 = 9 > 6
    const done = answer(t, { kind: 'chooseObjects', ids: [] } as DecisionAnswer); // none is allowed
    expect(onBf(drive(done), 'p1', 'Test Stag')).toBe(0);
  });
});

const PARTING = card('Test Parting', 'Sorcery', 'Search your library for two cards. Put one into your hand and the other into your graveyard. Then shuffle.');

describe('CR 701.23a, 701.23d, 400.7: "Search your library for two cards. Put one into your hand and the other into your graveyard. Then shuffle."', () => {
  const board = (): GameState => scenario([], { defs: [PARTING, SMALL, MID, BIG], p1: { hand: ['Test Parting'], library: ['Test Pup', 'Test Stag', 'Test Bull'] } });
  it('is understood', () => expect(noManual(PARTING)).toBe(true));
  it('two cards are found (no quality: both must be); the one kept goes to the hand, the other to the graveyard', () => {
    const s = cast(board(), 'Test Parting', { pick: (st, options, min, max) => {
      if (max === 2) { expect(min).toBe(2); return byName('Test Pup', 'Test Bull')(st, options); } // the search: exactly two
      return byName('Test Bull')(st, options); // the choice of the one to keep
    } });
    expect(names(s, 'hand', 'p1')).toContain('Test Bull');
    expect(names(s, 'graveyard', 'p1')).toContain('Test Pup');
    expect(names(s, 'hand', 'p1')).not.toContain('Test Pup');
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Bull');
  });
  it('negative: finding one card is not an answer (two are asked for), and the card not found stays in the library', () => {
    const s0 = board();
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Parting', 'hand', 'p1') } as never);
    for (let g = 0; g < 10 && t.pending?.kind !== 'chooseObjects'; g++) t = t.pending!.kind === 'payCost' ? answer(t, { kind: 'payCost', auto: true }) : pass(t);
    expect(t.pending?.kind).toBe('chooseObjects');
    const one = (t.pending as { options: ObjectId[] }).options.slice(0, 1);
    expect(() => answer(t, { kind: 'chooseObjects', ids: one } as DecisionAnswer)).toThrow();
    const s = drive(t, { pick: (st, options, min, max) => (max === 2 ? byName('Test Pup', 'Test Bull')(st, options) : byName('Test Pup')(st, options)) });
    expect(names(s, 'library', 'p1')).toContain('Test Stag');
  });
});

const DILATION = card('Test Dilation', 'Enchantment', "Whenever an opponent casts their first spell each turn, that player exiles the top card of their library. If it's a nonland card, you may cast it without paying its mana cost.");
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');

describe('CR 608.2c, 108.1, 603.2: "Whenever an opponent casts their first spell each turn, that player exiles the top card of their library. If it\'s a nonland card, you may cast it without paying its mana cost."', () => {
  const board = (library: string[]): GameState => scenario([], { defs: [DILATION, ZAP, SMALL, FOREST], p1: { battlefield: ['Test Dilation'] }, p2: { hand: ['Test Zap', 'Test Zap'], library } });
  /** Player 1 passes priority, the opponent casts the instant, and everything resolves (the owner of the enchantment says what `sc` says to the free cast). */
  const play = (s0: GameState, sc: Script = {}): GameState => drive(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Zap', 'hand', 'p2') } as never), sc);
  it('is understood', () => expect(noManual(DILATION)).toBe(true));
  it('the opponent\'s top card is exiled; a nonland card may be cast by you without paying, and it comes under your control', () => {
    const s = play(board(['Test Pup', 'Test Glade']));
    expect(inExile(s, 'Test Pup')).toBe(0);
    expect(onBf(s, 'p1', 'Test Pup')).toBe(1);
    expect(onBf(s, 'p2', 'Test Pup')).toBe(0);
  });
  it('negative: a land card stays in exile (nothing is offered)', () => {
    const land = play(board(['Test Glade', 'Test Pup']), { yes: [] });
    expect(inExile(land, 'Test Glade')).toBe(1);
    expect(onBf(land, 'p1', 'Test Glade')).toBe(0);
    expect(onBf(land, 'p1', 'Test Pup')).toBe(0);
  });
  it('negative: declining leaves the nonland card in exile', () => {
    const no = play(board(['Test Pup', 'Test Glade']), { yes: [false] });
    expect(inExile(no, 'Test Pup')).toBe(1);
    expect(onBf(no, 'p1', 'Test Pup')).toBe(0);
  });
  it('negative: only the first spell each turn triggers it (the second one exiles nothing)', () => {
    let s = play(board(['Test Pup', 'Test Pup', 'Test Glade']), { yes: [false] });
    expect(inExile(s, 'Test Pup')).toBe(1);
    s = drive(act(pass(s), { type: 'cast', player: 'p2', card: find(s, 'Test Zap', 'hand', 'p2') } as never), { yes: [false] });
    expect(inExile(s, 'Test Pup')).toBe(1);
    expect(names(s, 'library', 'p2')).toContain('Test Pup');
  });
});

const CUB = card('Test Cub', 'Creature — Beast', '', { pt: ['1', '1'] });
const ALTAR = card('Test Altar', 'Enchantment', '');
const TRINKET = card('Test Trinket', 'Artifact', '');
const CURIO = card('Test Curio', 'Artifact', "Whenever a nonartifact permanent you control enters, you may return another permanent you control that shares a permanent type with it to its owner's hand.", { cost: '{2}' });

describe('CR 110.4, 608.2c: "Whenever a nonartifact permanent you control enters, you may return another permanent you control that shares a permanent type with it to its owner\'s hand."', () => {
  const board = (hand: string): GameState => scenario([], { defs: [CURIO, CUB, MID, GEM, TRINKET, ALTAR], p1: { hand: [hand], battlefield: ['Test Curio', 'Test Stag', 'Test Stag', 'Test Gem'] } });
  it('is understood', () => expect(noManual(CURIO)).toBe(true));
  it('a creature enters: only the other creatures share a permanent type with it; the entering creature itself, the artifact and the Curio are not offered', () => {
    let offered: string[] = [];
    const s = cast(board('Test Cub'), 'Test Cub', { pick: (st, options) => { offered = options.map((id) => nameOf(st, id)); return options.slice(0, 1); } });
    expect(offered).toEqual(['Test Stag', 'Test Stag']);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Stag']);
    expect(onBf(s, 'p1', 'Test Cub')).toBe(1);
    expect(onBf(s, 'p1', 'Test Gem')).toBe(1);
  });
  it('negative: an enchantment enters and no other permanent you control is an enchantment: nothing can be returned (and the enchantment itself is not another one)', () => {
    const asked = { yesNo: 0, chooseObjects: 0 };
    const s = cast(board('Test Altar'), 'Test Altar', { asked, pick: (_s, options) => options.slice(0, 1) });
    expect(onBf(s, 'p1', 'Test Altar')).toBe(1);
    expect(names(s, 'hand', 'p1')).not.toContain('Test Altar');
    expect(names(s, 'hand', 'p1')).not.toContain('Test Stag');
    expect(asked.chooseObjects).toBe(0);
  });
  it('negative: an artifact entering does not trigger it (nonartifact)', () => {
    const s = cast(board('Test Trinket'), 'Test Trinket', { pick: (_s, options) => options.slice(0, 1) });
    expect(names(s, 'hand', 'p1')).not.toContain('Test Stag');
  });
});

const SOWER = card('Test Sower', 'Creature — Eldrazi', 'When you cast this spell, target opponent exiles the top four cards of their library, then you may put any number of land cards that player owns from exile onto the battlefield under your control.', { pt: ['4', '4'] });

describe('CR 108.3, 400.3, 110.2: "target opponent exiles the top four cards of their library, then you may put any number of land cards that player owns from exile onto the battlefield under your control"', () => {
  const board = (): GameState => scenario([], { defs: [SOWER, SMALL, MID, FOREST], p1: { hand: ['Test Sower'], exile: ['Test Glade'] }, p2: { library: ['Test Pup', 'Test Glade', 'Test Glade', 'Test Stag'], exile: ['Test Glade'] } });
  it('is understood', () => expect(noManual(SOWER)).toBe(true));
  it('every land card the opponent owns in exile is offered, the ones exiled before too; you get all of them under your control, the nonland cards stay in exile, your own exiled land is not offered', () => {
    let offered: string[] = [];
    const s = cast(board(), 'Test Sower', { targets: [['p2']], pick: (st, options) => { offered = options.map((id) => nameOf(st, id)); return [...options]; } });
    expect(offered).toEqual(['Test Glade', 'Test Glade', 'Test Glade']);
    expect(onBf(s, 'p1', 'Test Glade')).toBe(3);
    expect(inExile(s, 'Test Pup')).toBe(1);
    expect(inExile(s, 'Test Stag')).toBe(1);
    expect(inExile(s, 'Test Glade')).toBe(1); // player 1's own exiled land stays
  });
  it('negative: any number includes none, and the lands are then left in exile', () => {
    const s = cast(board(), 'Test Sower', { targets: [['p2']], pick: () => [] });
    expect(onBf(s, 'p1', 'Test Glade')).toBe(0);
    expect(inExile(s, 'Test Glade')).toBe(4);
  });
});

const PACT = card('Test Pact', 'Instant', 'Exile the top card of your library. You may put that card into your hand unless it has the same name as another card exiled this way. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first.');
const ALPHA = card('Test Alpha', 'Creature — Beast', '', { pt: ['1', '1'] });
const BETA = card('Test Beta', 'Creature — Beast', '', { pt: ['1', '1'] });
const GAMMA = card('Test Gamma', 'Creature — Beast', '', { pt: ['1', '1'] });

describe('CR 608.2c, 201.2: "Exile the top card of your library. You may put that card into your hand unless it has the same name as another card exiled this way. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first."', () => {
  const board = (library: string[]): GameState => scenario([], { defs: [PACT, ALPHA, BETA, GAMMA], p1: { hand: ['Test Pact'], library } });
  const run = (library: string[], yes: boolean[]): { s: GameState; asked: number } => {
    const asked = { yesNo: 0, chooseObjects: 0 };
    const s = cast(board(library), 'Test Pact', { yes, asked });
    return { s, asked: asked.yesNo };
  };
  it('is understood, and one repeat step with the group of cards exiled this way', () => {
    expect(noManual(PACT)).toBe(true);
    const j = JSON.stringify(PACT.faces);
    expect(j).toContain('"op":"repeat"');
    expect(j).toContain('"gather":{"as":"exiledThisWay"');
  });
  it('the first card is put into the hand: one card exiled, one question asked, and the process ends', () => {
    const { s, asked } = run(['Test Alpha', 'Test Beta', 'Test Alpha'], [true]);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Alpha']);
    expect(inExile(s, 'Test Alpha')).toBe(0); // the card put into the hand is no longer exiled
    expect(asked).toBe(1);
    expect(names(s, 'library', 'p1').slice(0, 2)).toEqual(['Test Beta', 'Test Alpha']);
  });
  it('the first card is declined and the second put into the hand: both are exiled, the third is never touched', () => {
    const { s, asked } = run(['Test Alpha', 'Test Beta', 'Test Gamma'], [false, true]);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Beta']);
    expect(inExile(s, 'Test Alpha')).toBe(1);
    expect(inExile(s, 'Test Beta')).toBe(0);
    expect(asked).toBe(2);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Gamma');
  });
  it('negative: a card with the name of one exiled earlier cannot be put into the hand and ends the process: no question is asked for it, nothing is in the hand', () => {
    const { s, asked } = run(['Test Alpha', 'Test Beta', 'Test Alpha', 'Test Gamma'], [false, false, true]);
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(inExile(s, 'Test Alpha')).toBe(2);
    expect(inExile(s, 'Test Beta')).toBe(1);
    expect(asked).toBe(2); // Alpha and Beta were offered, the second Alpha was not
    expect(names(s, 'library', 'p1')[0]).toBe('Test Gamma'); // the fourth card stays
  });
  it('declining every card goes on until two cards have the same name (the library\'s plains): the process is not endless', () => {
    const { s, asked } = run(['Test Alpha', 'Test Beta', 'Test Gamma'], [false, false, false, false, false]);
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(inExile(s, 'Plains')).toBe(2);
    expect(inExile(s, 'Test Gamma')).toBe(1);
    expect(asked).toBe(4); // Alpha, Beta, Gamma, the first Plains; the second Plains has a name already exiled
  });
});
