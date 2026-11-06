/**
 * edh-zones-7 (Commander effort, lane edh-zones): an exile replacement that puts a counter on the card ("instead exile it with a husk counter on it"), a choice among
 * exiled cards an opponent owns with a counter, and a free play "this turn", played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler.
 *
 *   CR 614.1a, 400.3   an opponent's card going to its owner's graveyard from anywhere is exiled instead; a card of yours, or a token, is not
 *   CR 122.1, 614.12   the exiled card gets the counter once it is in exile
 *   CR 608.2d, 700.2   "choose" is no target: the card is picked as the ability resolves, among the exiled cards an opponent owns that have the counter
 *   CR 118.9, 305.2    the permission lets the controller play the chosen card this turn without paying its mana cost
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { activate, cast, target } from '../../m5/cr-examples/helpers';
import { lifeOf } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);
const inExile = (s: GameState, owner: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === owner).map((id) => s.objects[id]!.defId);

/** Resolve everything with default answers until the stack is empty and p1 has priority; `pick` answers a choice of objects. */
function settle(s0: GameState, pick?: (options: readonly string[]) => string[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(d.options) : d.options.slice(0, d.min) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}

const WALKER = card('Test Husk Walker', 'Creature — Rogue',
  "Shadow\nIf a card would be put into an opponent's graveyard from anywhere, instead exile it with a husk counter on it.\n{T}, Sacrifice ~: Choose an exiled card an opponent owns with a husk counter on it. You may play it this turn without paying its mana cost.", ['1', '2']);
const SWEEP = card('Test Sweep', 'Sorcery', 'Destroy all creatures.');
const SNIPE = card('Test Snipe', 'Sorcery', 'Destroy target creature.');
const TOSS = card('Test Mutual Toss', 'Sorcery', 'Each player discards a card.');
const SIFT = card('Test Deep Sift', 'Sorcery', 'Target player mills three cards.');
const BEAR = card('Test Costly Bear', 'Creature — Bear', 'Vigilance', ['2', '2'], '{2}{G}');
const OTHER = card('Test Plain Ogre', 'Creature — Ogre', 'Trample', ['3', '3'], '{3}{R}');
const SURVEY = card('Test Verdant Survey', 'Instant', "Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.", undefined, '{0}');
const RECYCLER = card('Test Recycling Hulk', 'Creature — Construct', '{0}, Discard this card: You gain 1 life. Shuffle this card into your library from your graveyard, then draw a card.', ['3', '3'], '{4}');
const DEFS = [RECYCLER, SURVEY, WALKER, SWEEP, SNIPE, TOSS, SIFT, BEAR, OTHER];

describe('CR 614.1a, 122.1: "If a card would be put into an opponent\'s graveyard from anywhere, instead exile it with a husk counter on it."', () => {
  it('is parsed and automated, all three abilities', () => {
    expect(automated(WALKER)).toBe(true);
    const json = JSON.stringify(WALKER.faces[0]!.abilities);
    expect(json).toContain('"kind":"husk"');
    expect(json).toContain('"counters":{"kind":"husk"}');
  });
  it("an opponent's creature that dies is exiled with one husk counter and is not in the graveyard", () => {
    let s = scenario([], { p1: { hand: ['Test Snipe'], battlefield: ['Test Husk Walker'] }, p2: { battlefield: ['Test Costly Bear'] }, defs: DEFS });
    s = cast(s, 'Test Snipe', [target(find(s, 'Test Costly Bear', 'battlefield', 'p2'))]);
    s = settle(s);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
    const ex = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!;
    expect(ex).toBeDefined();
    expect(s.objects[ex]!.counters['husk']).toBe(1);
  });
  it("a card of yours (the replacement's controller) goes to your graveyard with no counter", () => {
    let s = scenario([], { p1: { hand: ['Test Sweep'], battlefield: ['Test Husk Walker', 'Test Costly Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
    s = settle(s);
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Test Costly Bear', 'Test Husk Walker', 'Test Sweep']);
    expect(inExile(s, 'p1')).toEqual([]);
  });
  it("a card an opponent discards is exiled with a counter, wherever it comes from; the spell's own caster discards to the graveyard", () => {
    let s = scenario([], { p1: { hand: ['Test Mutual Toss', 'Test Plain Ogre'], battlefield: ['Test Husk Walker'] }, p2: { hand: ['Test Costly Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mutual Toss', 'hand', 'p1') });
    s = settle(s);
    expect(inExile(s, 'p2')).toEqual(['Test Costly Bear']);
    expect(s.objects[s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!]!.counters['husk']).toBe(1);
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Test Mutual Toss', 'Test Plain Ogre']);
  });
  it('a card milled from an opponent library is exiled with a counter too', () => {
    let s = scenario([], { p1: { hand: ['Test Deep Sift'], battlefield: ['Test Husk Walker'] }, p2: { library: ['Test Costly Bear', 'Test Plain Ogre', 'Test Costly Bear'] }, defs: DEFS });
    s = cast(s, 'Test Deep Sift', [target('p2')]);
    s = settle(s);
    expect(s.zones.graveyard['p2']).toEqual([]);
    expect(inExile(s, 'p2').length).toBe(3);
  });
  it('without the Walker nothing is exiled: the discarded card goes to the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Mutual Toss', 'Test Plain Ogre'] }, p2: { hand: ['Test Costly Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mutual Toss', 'hand', 'p1') });
    s = settle(s);
    expect(inExile(s, 'p2')).toEqual([]);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual(['Test Costly Bear']);
  });
});

describe('CR 608.2d, 118.9: "Choose an exiled card an opponent owns with a husk counter on it. You may play it this turn without paying its mana cost."', () => {
  it('chooses among the exiled cards an opponent owns that have the counter only, then plays the chosen one free this turn', () => {
    let s = scenario([], {
      p1: { battlefield: [{ name: 'Test Husk Walker', since: 0 }], exile: [{ name: 'Test Plain Ogre', counters: { husk: 1 } }] },
      p2: { exile: [{ name: 'Test Costly Bear', counters: { husk: 1 } }, { name: 'Test Plain Ogre', counters: { husk: 1 } }, 'Test Plain Ogre'] },
      defs: DEFS,
    });
    const walker = find(s, 'Test Husk Walker', 'battlefield', 'p1');
    const offered: string[][] = [];
    s = activate(s, walker);
    s = settle(s, (o) => { offered.push([...o]); return [o.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!]; });
    expect(offered.length).toBe(1);
    expect(offered[0]!.length).toBe(2); // the two counted cards p2 owns: not p1's own counted card, not p2's card without a counter
    expect(offered[0]!.every((id) => s.objects[id]!.owner === 'p2' && s.objects[id]!.counters['husk'] === 1)).toBe(true);
    // the Walker was sacrificed as a cost: it went to its owner's graveyard (nothing replaces your own cards)
    expect(names(s, s.zones.graveyard['p1']!)).toEqual(['Test Husk Walker']);
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!;
    expect(() => act(s, { type: 'cast', player: 'p1', card: bear })).toThrow(/without paying/); // not for its mana cost: the permission is for no cost
    const opts = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === bear);
    expect(opts.length).toBe(1);
    s = act(s, opts[0]!.action);
    s = settle(s);
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1'))).toContain('Test Costly Bear'); // {2}{G} paid by nothing: it was free
  });
  it('the permission is for the chosen card only: the other counted card is not offered', () => {
    let s = scenario([], {
      p1: { battlefield: [{ name: 'Test Husk Walker', since: 0 }] },
      p2: { exile: [{ name: 'Test Costly Bear', counters: { husk: 1 } }, { name: 'Test Plain Ogre', counters: { husk: 1 } }] },
      defs: DEFS,
    });
    s = activate(s, find(s, 'Test Husk Walker', 'battlefield', 'p1'));
    s = settle(s, (o) => [o.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!]);
    const ogre = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Plain Ogre')!;
    const castable = (id: string): number => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === id).length;
    expect(castable(ogre)).toBe(0);
    expect(castable(s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!)).toBe(1);
  });
  it('with no exiled card an opponent owns that has the counter, nothing is chosen and nothing can be played', () => {
    let s = scenario([], {
      p1: { battlefield: [{ name: 'Test Husk Walker', since: 0 }] },
      p2: { exile: ['Test Costly Bear'] },
      defs: DEFS,
    });
    s = activate(s, find(s, 'Test Husk Walker', 'battlefield', 'p1'));
    s = settle(s);
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Bear')!;
    expect(() => act(s, { type: 'cast', player: 'p1', card: bear })).toThrow();
    expect(s.objects[bear]!.zone).toBe('exile');
  });
});

describe('CR 608.2c-d, 701.20e: "You may put a land card from among them onto the battlefield tapped. If you don\'t, put a card from among them into your hand. Put the rest on the bottom of your library in a random order."', () => {
  const lib = (s: GameState): string[] => names(s, s.zones.library['p1']!);
  const setup = (top: string[]): GameState => scenario([], { p1: { hand: ['Test Verdant Survey'], library: top }, defs: DEFS });
  /** The answers of the survey's two choices, by the options they are offered: the land choice (min 0) first, then the hand choice (min 1). */
  const run = (s0: GameState, land: boolean, hand: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Verdant Survey', 'hand', 'p1') });
    for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseObjects') {
        const want = d.min === 0 ? (land ? d.options.filter((id) => s.objects[id]!.defId === 'Plains').slice(0, 1) : []) : d.options.filter((id) => s.objects[id]!.defId === hand).slice(0, 1);
        s = answer(s, { kind: 'chooseObjects', ids: want });
      } else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
    }
    return s;
  };
  it('is parsed and automated', () => expect(automated(SURVEY)).toBe(true));
  it('a land put onto the battlefield tapped means nothing goes to the hand; the other three are on the bottom of the library', () => {
    const s = run(setup(['Plains', 'Test Costly Bear', 'Test Plain Ogre', 'Test Costly Bear']), true, 'Test Costly Bear');
    const lands = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId === 'Plains');
    expect(lands.length).toBe(1);
    expect(s.objects[lands[0]!]!.tapped).toBe(true);
    expect(names(s, s.zones.hand['p1']!)).toEqual([]);
    expect(lib(s).length).toBe(23);
    expect(lib(s).slice(-3).sort()).toEqual(['Test Costly Bear', 'Test Costly Bear', 'Test Plain Ogre']);
  });
  it("declining the land: a card from among them goes to the hand, the land and the others to the bottom", () => {
    const s = run(setup(['Plains', 'Test Costly Bear', 'Test Plain Ogre', 'Test Costly Bear']), false, 'Test Plain Ogre');
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Plain Ogre']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId === 'Plains')).toEqual([]);
    expect(lib(s).length).toBe(23);
    expect(lib(s).slice(-3).sort()).toEqual(['Plains', 'Test Costly Bear', 'Test Costly Bear']);
  });
  it('no land among the four: a card goes to the hand and the other three to the bottom', () => {
    const s = run(setup(['Test Costly Bear', 'Test Plain Ogre', 'Test Costly Bear', 'Test Plain Ogre']), false, 'Test Costly Bear');
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Costly Bear']);
    expect(lib(s).length).toBe(23);
    expect(lib(s).slice(-3).sort()).toEqual(['Test Costly Bear', 'Test Plain Ogre', 'Test Plain Ogre']);
  });
});

describe('CR 701.24a, 400.7, 113.6m: "Shuffle this card into your library from your graveyard, then draw a card." after a "Discard this card" cost', () => {
  it('is parsed and automated', () => expect(automated(RECYCLER)).toBe(true));
  it('the discarded card goes from the graveyard into the library, the library is shuffled and its owner draws', () => {
    let s = scenario([], { p1: { hand: ['Test Recycling Hulk'], library: ['Test Costly Bear'] }, defs: DEFS });
    const hulk = find(s, 'Test Recycling Hulk', 'hand', 'p1');
    s = activate(s, hulk);
    s = settle(s);
    expect(names(s, s.zones.graveyard['p1']!)).toEqual([]);
    expect(names(s, s.zones.library['p1']!)).toContain('Test Recycling Hulk');
    expect(s.zones.hand['p1']!.length).toBe(1); // the one card drawn
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('a card that is no longer in the graveyard is not shuffled in (it was exiled in response)', () => {
    let s = scenario([], { p1: { hand: ['Test Recycling Hulk'] }, p2: { hand: [] }, defs: DEFS });
    const hulk = find(s, 'Test Recycling Hulk', 'hand', 'p1');
    s = activate(s, hulk);
    // the card is in the graveyard while the ability waits on the stack: move it to exile by hand
    const gy = s.zones.graveyard['p1']!.find((id) => s.objects[id]!.defId === 'Test Recycling Hulk')!;
    s.zones.graveyard['p1'] = s.zones.graveyard['p1']!.filter((id) => id !== gy);
    s.zones.exile.push(gy);
    s.objects[gy]!.zone = 'exile';
    s = settle(s);
    expect(names(s, s.zones.library['p1']!)).not.toContain('Test Recycling Hulk');
    expect(s.objects[gy]!.zone).toBe('exile');
  });
});

describe('CR 608.2d, 508.1: "Whenever this creature attacks, defending player exiles two permanents they control."', () => {
  const BANE = card('Test Hollow Titan', 'Creature — Eldrazi', 'Whenever this creature attacks, defending player exiles two permanents they control.', ['4', '4']);
  const setup = (p2: string[]): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Hollow Titan', since: 0 }, 'Test Costly Bear'] }, p2: { battlefield: p2 }, defs: [BANE, ...DEFS] });
  const attack = (s0: GameState): GameState => {
    const titan = find(s0, 'Test Hollow Titan', 'battlefield', 'p1');
    return declareAttackers(toDeclareAttackers(s0), [[titan]]);
  };
  it('is parsed and automated', () => expect(automated(BANE)).toBe(true));
  it('the defending player picks two of their own permanents (not the attacker\'s) and exiles them', () => {
    let s = attack(setup(['Test Costly Bear', 'Test Plain Ogre', 'Plains']));
    const seen: string[][] = [];
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.turn.step !== 'declareAttackers'); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseObjects') {
        seen.push(names(s, d.options));
        expect(d.player).toBe('p2');
        s = answer(s, { kind: 'chooseObjects', ids: d.options.filter((id) => s.objects[id]!.defId !== 'Plains').slice(0, 2) });
      } else if (d.kind === 'priority') s = pass(s);
      else break;
    }
    expect(seen.length).toBe(1);
    expect(seen[0]!.sort()).toEqual(['Plains', 'Test Costly Bear', 'Test Plain Ogre']); // only the defending player's permanents
    expect(inExile(s, 'p2').sort()).toEqual(['Test Costly Bear', 'Test Plain Ogre']);
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1'))).toContain('Test Costly Bear'); // the attacker's own permanents stay
  });
  it('a defending player with a single permanent exiles it (fewer than two to choose)', () => {
    let s = attack(setup(['Plains']));
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.turn.step !== 'declareAttackers'); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options });
      else if (d.kind === 'priority') s = pass(s);
      else break;
    }
    expect(inExile(s, 'p2')).toEqual(['Plains']);
  });
});

describe('review fixes: simultaneous destruction (CR 614.1a, 616.1) and a discard cost that a replacement sent to exile (CR 614.6, 400.7)', () => {
  it('"Destroy all creatures" with the Walker (the older permanent) and an opponent\'s creatures: they are exiled with a counter, in either board order', () => {
    for (const order of [0, 1]) {
      let s = scenario([], { p1: { hand: ['Test Sweep'], battlefield: order === 0 ? ['Test Husk Walker'] : [] }, p2: { battlefield: ['Test Costly Bear', 'Test Plain Ogre'] }, defs: DEFS });
      if (order === 1) { put(s, 'p1', 'battlefield', 'Test Husk Walker'); }
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
      s = settle(s);
      expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
      expect(inExile(s, 'p2').sort()).toEqual(['Test Costly Bear', 'Test Plain Ogre']);
      expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Husk Walker');
    }
  });
  it('Kogla-like card whose discard cost went to exile (an opponent\'s Walker) stays in exile: it is not shuffled in "from your graveyard"; the draw still happens', () => {
    let s = scenario([], { p1: { hand: ['Test Recycling Hulk'], library: ['Test Costly Bear'] }, p2: { battlefield: ['Test Husk Walker'] }, defs: DEFS });
    s = activate(s, find(s, 'Test Recycling Hulk', 'hand', 'p1'));
    s = settle(s);
    expect(inExile(s, 'p1')).toEqual(['Test Recycling Hulk']);
    expect(names(s, s.zones.library['p1']!)).not.toContain('Test Recycling Hulk');
    expect(s.zones.hand['p1']!.length).toBe(1);
  });
});

describe('CR 614.1a, 616.1, 603.10a: a replacement effect of a permanent that leaves in the same event as the cards it would replace still applies (Dauthi Voidwalker rulings)', () => {
  const DMG = card('Test Scorch Wave', 'Sorcery', 'Test Scorch Wave deals 5 damage to each creature.');
  const SHRINK = card('Test Dread Fog', 'Sorcery', 'All creatures get -9/-9 until end of turn.');
  const EDICT = card('Test Grim Edict', 'Sorcery', 'Each player sacrifices a creature.');
  const LEY = card('Test Void Layer', 'Creature — Rogue', "If a card would be put into an opponent's graveyard from anywhere, exile it instead.", ['1', '1']);
  const ALL = [...DEFS, DMG, SHRINK, EDICT, LEY];
  const wipe = (spell: string, p1: string[], p2: string[]): GameState => {
    let s = scenario([], { p1: { hand: [spell], battlefield: p1 }, p2: { battlefield: p2 }, defs: ALL });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') });
    return settle(s);
  };
  const counted = (s: GameState, p: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === p && s.objects[id]!.counters['husk'] === 1).map((id) => s.objects[id]!.defId);
  it('a damage wipe: the Walker dies with the opponent\'s creatures, which are exiled with counters', () => {
    const s = wipe('Test Scorch Wave', ['Test Husk Walker'], ['Test Costly Bear', 'Test Plain Ogre']);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
    expect(counted(s, 'p2').sort()).toEqual(['Test Costly Bear', 'Test Plain Ogre']);
  });
  it('a -X/-X wipe (state-based deaths): same', () => {
    const s = wipe('Test Dread Fog', ['Test Husk Walker'], ['Test Costly Bear', 'Test Plain Ogre']);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
    expect(counted(s, 'p2').sort()).toEqual(['Test Costly Bear', 'Test Plain Ogre']);
  });
  it('an edict (a sacrifice batch): the opponent\'s sacrificed creature is exiled with a counter, your own Walker goes to your graveyard', () => {
    const s = wipe('Test Grim Edict', ['Test Husk Walker'], ['Test Costly Bear']);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
    expect(counted(s, 'p2')).toEqual(['Test Costly Bear']);
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Husk Walker');
  });
  it('two Walkers dying together: each replaces the other\'s card (the opponent\'s Walker is exiled with a counter by yours, yours by theirs)', () => {
    const s = wipe('Test Scorch Wave', ['Test Husk Walker'], ['Test Husk Walker']);
    expect(names(s, s.zones.graveyard['p1']!)).not.toContain('Test Husk Walker');
    expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
    expect(counted(s, 'p2')).toEqual(['Test Husk Walker']);
    expect(counted(s, 'p1').sort()).toEqual(['Test Husk Walker', 'Test Scorch Wave']); // (the spell itself is put into the graveyard at the end of its resolution, CR 608.2n, while the opponent's Walker is still there)
  });
  it('the Leyline-like replacement is the same: a wipe exiles the opponent\'s creature, and the creature of the carrier\'s controller goes to the graveyard', () => {
    const s = wipe('Test Scorch Wave', ['Test Void Layer', 'Test Costly Bear'], ['Test Plain Ogre']);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual([]);
    expect(inExile(s, 'p2')).toEqual(['Test Plain Ogre']);
    expect(names(s, s.zones.graveyard['p1']!)).toEqual(expect.arrayContaining(['Test Void Layer', 'Test Costly Bear']));
  });
  it('no carrier on the board: nothing changes (the opponent\'s creature goes to the graveyard)', () => {
    const s = wipe('Test Scorch Wave', ['Test Costly Bear'], ['Test Plain Ogre']);
    expect(names(s, s.zones.graveyard['p2']!)).toEqual(['Test Plain Ogre']);
  });
});
