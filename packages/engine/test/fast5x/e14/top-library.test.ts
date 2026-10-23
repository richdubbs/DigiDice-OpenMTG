/**
 * FAST5X E14: the top of your library, on the game path with real fixture cards.
 *  - "You may look at the top card of your library any time" (CR 401.5): that player, and only that player, sees the card on top of their own library, as the
 *    top card changes; the opponent's view never holds it (CR 400.2, 401.2). While that player casts a spell, the new top card can't be looked at until the
 *    spell becomes cast (CR 401.5, 601.2i).
 *  - "You may cast creature spells from the top of your library", "You may play lands from the top of your library", "You may play lands and cast spells with
 *    mana value 4 or greater ..." (CR 601.3, 305.1): permission for whichever card is on top now (CR 611.3a); the qualities are those of the spell it would be
 *    (CR 601.3e: an adventurer card's halves); timing, costs and the land plays per turn are unchanged (CR 305.2, 601.2a-i).
 *  - "Once each turn, you may cast an instant or sorcery spell from the top of your library" (CR 601.3): one spell each turn.
 *  - A resolved effect: "Until end of turn, you may look at the top card ... and you may play lands and cast spells from the top of your library" (CR 611.2a).
 *  - A granted ability: Glowcap Lantern's equipped creature has "You may look at the top card of your library any time" (CR 613.1f, 401.5).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, canSee, compileCard, ENGINE_CAPABILITIES, HIDDEN_DEF, legalActions, viewFor, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, drive, find, lands, resolveTop, scenario, target } from '../../m6/dfc/support';
import { advanceTo } from '../../m5/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const top = (s: GameState, p: PlayerId = 'p1'): ObjectId => s.zones.library[p]![0]!;
const fieldId = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
/** May `viewer` see the object `id` (core/view.ts#canSee)? */
const sees = (s: GameState, id: ObjectId, viewer: PlayerId | null): boolean => canSee(s, s.objects[id]!, viewer);
/** p1's legal actions about the card on top of `p`'s library. */
const topActions = (s: GameState, p: PlayerId = 'p1'): string[] => legalActions(s, 'p1').filter((a) => a.object === top(s, p)).map((a) => a.label);

/** A synthetic artifact whose ability is the E14 effect template (eff.e14.top.eot.look.lands.cast), compiled from its text like any card. */
const SEER: OracleCard = {
  name: 'Test Lantern Seer', layout: 'normal', mana_cost: '{1}', type_line: 'Artifact', colors: [], keywords: [],
  oracle_text: '{T}: Until end of turn, you may look at the top card of your library any time, and you may play lands and cast spells from the top of your library.',
} as unknown as OracleCard;

describe('FAST5X E14: the capabilities are registered and the cards compile', () => {
  it('permit:lookAt, permit:cast.top, permit:play.top and feature:permit.cast.oncePerTurn (CR 401.5, 601.3, 305.1)', () => {
    for (const c of ['permit:lookAt', 'permit:cast.top', 'permit:play.top', 'feature:permit.cast.oncePerTurn']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    // a play permission once each turn, or a permission from the top of a library for another action, is a form nothing registers (fail closed)
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.oncePerTurn')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('feature:permit.haveFlash.fromTop')).toBe(false);
  });
  it('the cards whose blockers were these permissions compile full', () => {
    for (const name of ['Iron Lad, Diverging Destiny', 'Glowcap Lantern', 'Hakoda, Selfless Commander', 'Glarb, Calamity\'s Augur',
      'Madame Web, Clairvoyant', 'Traveling Chocobo', 'Johann, Apprentice Sorcerer', 'Assemble the Players', 'Case of the Locked Hothouse', 'The Belligerent',
      'The Lunar Whale' /* FAST5X E28: "as long as ~ attacked this turn" (sfilter:attackedThisTurn) */,
      'Mikey & Don, Party Planners' /* std-rx27: "If you cast a creature spell this way, that creature enters with ..." (feature:permit.cast.top.entersWith, CR 614.1c) */]) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('the cards whose other blocker is read now are full (Gwenom: std-exile-play-1-1 reads its life cost)', () => {
    // Mikey & Don: "If you cast a creature spell this way, ..."; Gwenom: "If you cast a spell this way, pay life ..." (FAST5X E28: The Lunar Whale is full, static
    // abilities read "attacked this turn"; CLOUD std-fdn: Vizier of the Menagerie is full, "You can spend mana of any type to cast creature spells" is read, CR 609.4b;
    // std-exile-play-1-1: Gwenom is full, the top-card permission's life cost is read, CR 118.9)
    for (const name of ['Gwenom, Remorseless']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});

describe('CR 401.5, 400.2: "You may look at the top card of your library any time"', () => {
  const board = (field: string[]): GameState => scenario(['Iron Lad, Diverging Destiny', 'Grizzly Bears', 'Llanowar Elves', 'Hill Giant'], {
    p1: { battlefield: field, library: ['Grizzly Bears', 'Llanowar Elves'] },
    p2: { library: ['Hill Giant'] },
  });

  it('its controller sees the top card of their own library, nobody else does, and no other card of it', () => {
    const s = board(['Iron Lad, Diverging Destiny']);
    const t = top(s);
    expect(sees(s, t, 'p1')).toBe(true);
    expect(sees(s, t, 'p2')).toBe(false);
    expect(sees(s, t, null)).toBe(false);
    expect(sees(s, s.zones.library.p1![1]!, 'p1')).toBe(false); // the second card (CR 401.2)
    expect(sees(s, top(s, 'p2'), 'p1')).toBe(false); // the opponent's library is not "your library"
    expect(viewFor(s, 'p1').objects[t]!.defId).toBe('Grizzly Bears');
    expect(viewFor(s, 'p2').objects[t]!.defId).toBe(HIDDEN_DEF); // the opponent's view does not leak it
    expect(viewFor(s, null).objects[t]!.defId).toBe(HIDDEN_DEF);
  });

  it('without the permission the top card is hidden like the rest of the library (CR 401.2)', () => {
    const s = board([]);
    expect(sees(s, top(s), 'p1')).toBe(false);
    expect(viewFor(s, 'p1').objects[top(s)]!.defId).toBe(HIDDEN_DEF);
  });

  it('the permission follows the top card: after a draw the new top card is the one that may be looked at (CR 611.3a)', () => {
    let s = board(['Iron Lad, Diverging Destiny']);
    const first = top(s);
    s = advanceTo(s, 3, 'main1'); // p1 drew the Grizzly Bears on turn 3
    expect(s.objects[first]).toBeUndefined();
    expect(nameOf(s, top(s))).toBe('Llanowar Elves');
    expect(sees(s, top(s), 'p1')).toBe(true);
    expect(sees(s, top(s), 'p2')).toBe(false);
  });

  it('a granted ability: Glowcap Lantern\'s equipped creature has it, for the creature\'s controller (CR 613.1f, 401.5)', () => {
    const s = scenario(['Glowcap Lantern', 'Grizzly Bears'], { p1: { battlefield: ['Glowcap Lantern', 'Grizzly Bears'], library: ['Grizzly Bears'] } });
    expect(sees(s, top(s), 'p1')).toBe(false); // not equipped yet
    const lantern = fieldId(s, 'Glowcap Lantern');
    const bears = fieldId(s, 'Grizzly Bears');
    const t = { ...s, objects: { ...s.objects, [lantern]: { ...s.objects[lantern]!, attachedTo: bears } } }; // test setup: attached (CR 301.5)
    expect(sees(t, top(t), 'p1')).toBe(true);
    expect(sees(t, top(t), 'p2')).toBe(false);
  });
});

describe('CR 601.3, 601.3e: "You may cast creature spells from the top of your library" (Hakoda: Ally spells; Vizier: creature spells)', () => {
  const board = (libTop: string[], extra: string[] = []): GameState => scenario(['Vizier of the Menagerie', ...libTop, ...extra, 'Forest', 'Mountain'], {
    p1: { battlefield: ['Vizier of the Menagerie', ...lands('Forest', 3), ...lands('Mountain', 2), ...extra], library: libTop },
  });

  it('the creature card on top may be cast, for its mana cost, at sorcery speed; then the next card is on top (CR 601.2a, 307.1)', () => {
    let s = board(['Grizzly Bears', 'Llanowar Elves']);
    expect(topActions(s)).toEqual(['Cast Grizzly Bears from library']);
    s = drive(act(s, { type: 'cast', player: 'p1', card: top(s) }));
    expect(s.zones.stack.map((id) => nameOf(s, id))).toEqual(['Grizzly Bears']);
    expect(s.objects[s.zones.stack[0]!]!.stack!.castFrom).toBe('library');
    // the card is public on the stack (CR 400.2); the next card is the top card now, and may be cast too (CR 611.3a)
    expect(viewFor(s, 'p2').objects[s.zones.stack[0]!]!.defId).toBe('Grizzly Bears');
    expect(nameOf(s, top(s))).toBe('Llanowar Elves');
    expect(sees(s, top(s), 'p1')).toBe(true);
    expect(topActions(s)).toEqual([]); // not while a spell is on the stack: sorcery timing (CR 307.1)
    s = resolveTop(s);
    expect(fieldId(s, 'Grizzly Bears')).toBeDefined();
    expect(topActions(s)).toEqual(['Cast Llanowar Elves from library']);
  });

  it('a card the permission does not cover is not offered and its cast is refused (CR 601.3)', () => {
    const s = board(['Lightning Bolt']);
    expect(sees(s, top(s), 'p1')).toBe(true);
    expect(topActions(s)).toEqual([]);
    const r = applyAction(s, { type: 'cast', player: 'p1', card: top(s) });
    expect(r.error?.rules).toContain('CR 601.3');
    // nor is a land played from there: a permission to cast is none to play (CR 305.1, 305.9)
    const land = board(['Forest']);
    expect(topActions(land)).toEqual([]);
    expect(applyAction(land, { type: 'playLand', player: 'p1', card: top(land) }).error?.rules).toContain('CR 305.1');
  });

  it('the opponent may not cast it, and p1 may not cast the top card of the opponent\'s library ("your library")', () => {
    const s = scenario(['Vizier of the Menagerie', 'Grizzly Bears', 'Forest'], {
      p1: { battlefield: ['Vizier of the Menagerie', ...lands('Forest', 2)], library: ['Grizzly Bears'] },
      p2: { battlefield: lands('Forest', 2), library: ['Grizzly Bears'] },
    });
    expect(applyAction(s, { type: 'cast', player: 'p1', card: top(s, 'p2') }).error).toBeDefined();
    expect(legalActions(s, 'p2').some((a) => a.object === top(s))).toBe(false);
  });

  it('CR 601.3e: an adventurer card on top is cast as the half the permission covers (Vizier: the creature, not the instant Adventure)', () => {
    const s = board(['Bonecrusher Giant // Stomp']);
    expect(topActions(s)).toEqual(['Cast Bonecrusher Giant from library']);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: top(s), face: 1 }).error?.rules).toContain('CR 601.3e');
  });

  it('CR 401.5: while the top card is being cast, the new top card can\'t be looked at until the spell becomes cast', () => {
    let s = board(['Grizzly Bears', 'Llanowar Elves']);
    s = act(s, { type: 'cast', player: 'p1', card: top(s) });
    expect(s.pending?.kind).toBe('payCost'); // the cast is not finished (CR 601.2g-h)
    const elves = top(s);
    expect(nameOf(s, elves)).toBe('Llanowar Elves');
    expect(sees(s, elves, 'p1')).toBe(false);
    expect(viewFor(s, 'p1').objects[elves]!.defId).toBe(HIDDEN_DEF);
    s = drive(s);
    expect(s.zones.stack.length).toBe(1); // cast (CR 601.2i)
    expect(sees(s, elves, 'p1')).toBe(true);
  });
});

describe('CR 305.1-305.2: "You may play lands from the top of your library" (Ka-Zar)', () => {
  const board = (hand: string[] = []): GameState => scenario(['Ka-Zar of the Savage Land', 'Forest', 'Mountain'], {
    p1: { battlefield: ['Ka-Zar of the Savage Land'], hand, library: ['Forest', 'Mountain'] },
  });

  it('the land on top may be played; it is the land play of the turn, so the next one may not (CR 305.2, 305.2b)', () => {
    let s = board();
    expect(topActions(s)).toEqual(['Play Forest from library']);
    s = act(s, { type: 'playLand', player: 'p1', card: top(s) });
    expect(fieldId(s, 'Forest')).toBeDefined();
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(nameOf(s, top(s))).toBe('Mountain');
    expect(sees(s, top(s), 'p1')).toBe(true);
    expect(topActions(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: top(s) }).error?.rules).toContain('CR 305.2');
  });

  it('a land played from the hand first uses the land play (CR 305.2a)', () => {
    let s = board(['Mountain']);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'hand', 'p1') });
    expect(topActions(s)).toEqual([]);
  });

  it('a land is never cast (CR 305.9), and a nonland card on top is not covered (CR 601.3)', () => {
    const s = scenario(['Ka-Zar of the Savage Land', 'Grizzly Bears', 'Forest'], { p1: { battlefield: ['Ka-Zar of the Savage Land', ...lands('Forest', 2)], library: ['Grizzly Bears'] } });
    expect(topActions(s)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: top(s) }).error?.rules).toContain('CR 601.3');
  });
});

describe('Glarb: "You may play lands and cast spells with mana value 4 or greater from the top of your library" (CR 601.3, 305.1)', () => {
  const board = (lib: string[]): GameState => scenario(['Glarb, Calamity\'s Augur', ...lib, 'Forest', 'Mountain'], {
    p1: { battlefield: ['Glarb, Calamity\'s Augur', ...lands('Forest', 2), ...lands('Mountain', 3)], library: lib },
  });
  it('a land: played; a spell with mana value 4 or more: cast; one with less: neither', () => {
    expect(topActions(board(['Forest']))).toEqual(['Play Forest from library']);
    expect(topActions(board(['Hill Giant']))).toEqual(['Cast Hill Giant from library']);
    const small = board(['Grizzly Bears']);
    expect(topActions(small)).toEqual([]);
    expect(applyAction(small, { type: 'cast', player: 'p1', card: top(small) }).error?.rules).toContain('CR 601.3');
  });
});

describe('Madame Web: "You may cast Spider spells and noncreature spells from the top of your library" (CR 601.3)', () => {
  it('a noncreature spell is covered, a non-Spider creature spell is not', () => {
    const board = (lib: string[]): GameState => scenario(['Madame Web, Clairvoyant', ...lib, 'Mountain'], {
      p1: { battlefield: ['Madame Web, Clairvoyant', ...lands('Mountain', 3)], library: lib },
    });
    expect(topActions(board(['Lightning Bolt']))).toEqual(['Cast Lightning Bolt from library']);
    expect(topActions(board(['Grizzly Bears']))).toEqual([]);
  });
});

describe('Errant and Giada: "You may cast spells with flash or flying from the top of your library" (CR 601.3, 601.3e)', () => {
  it("the spell's own keywords decide: a creature with flash (at instant speed too) or with flying is covered, one with neither is not", () => {
    const board = (lib: string[]): GameState => scenario(['Errant and Giada', ...lib, 'Forest', 'Island'], {
      p1: { battlefield: ['Errant and Giada', ...lands('Forest', 2), ...lands('Island', 5)], library: lib },
    });
    expect(topActions(board(['Ambush Viper']))).toEqual(['Cast Ambush Viper from library']);
    expect(topActions(board(['Air Elemental']))).toEqual(['Cast Air Elemental from library']);
    expect(topActions(board(['Grizzly Bears']))).toEqual([]);
  });
});

describe('CR 601.3: "Once each turn, you may cast an instant or sorcery spell from the top of your library" (Johann)', () => {
  const board = (lib: string[]): GameState => scenario(['Johann, Apprentice Sorcerer', ...lib, 'Mountain'], {
    p1: { battlefield: ['Johann, Apprentice Sorcerer', ...lands('Mountain', 4)], library: lib },
  });

  it('one spell each turn: after one is cast this way, the next instant on top is not castable this turn, and is again next turn', () => {
    let s = board(['Lightning Bolt', 'Shock', 'Shock', 'Lightning Bolt']);
    expect(topActions(s)).toEqual(['Cast Lightning Bolt from library']);
    s = drive(act(s, { type: 'cast', player: 'p1', card: top(s) }), [target('p2')]);
    s = resolveTop(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17);
    expect(nameOf(s, top(s))).toBe('Shock');
    expect(sees(s, top(s), 'p1')).toBe(true); // looking is not limited
    expect(topActions(s)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: top(s) }).error?.rules).toContain('CR 601.3');
    // p1's next turn: the draw takes the Shock, the second one is on top and the permission is back
    s = advanceTo(s, 3, 'main1');
    expect(nameOf(s, top(s))).toBe('Shock');
    expect(topActions(s)).toEqual(['Cast Shock from library']);
  });

  it('CR 601.3e: an adventurer card on top: the instant Adventure is covered, the creature is not', () => {
    const s = board(['Bonecrusher Giant // Stomp']);
    expect(topActions(s)).toEqual(['Cast Stomp from library']);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: top(s), face: 0 }).error?.rules).toContain('CR 601.3e');
  });

  it('a creature spell is not covered; casting from the hand never uses the once-each-turn permission', () => {
    let s = board(['Grizzly Bears']);
    expect(topActions(s)).toEqual([]);
    s = scenario(['Johann, Apprentice Sorcerer', 'Lightning Bolt', 'Shock', 'Mountain'], {
      p1: { battlefield: ['Johann, Apprentice Sorcerer', ...lands('Mountain', 3)], hand: ['Shock'], library: ['Lightning Bolt'] },
    });
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') }), [target('p2')]));
    expect(topActions(s)).toEqual(['Cast Lightning Bolt from library']);
  });
});

describe('CR 611.2a: a resolved "until end of turn" permission (eff.e14.top.eot.look.lands.cast)', () => {
  it('after the ability resolves, the top card may be looked at and played or cast this turn only', () => {
    const seer = compileCard(SEER);
    let s = scenario(['Grizzly Bears', 'Forest'], {
      p1: { battlefield: ['Test Lantern Seer', ...lands('Forest', 2)], library: ['Grizzly Bears', 'Forest', 'Grizzly Bears', 'Grizzly Bears'] }, defs: [seer],
    });
    expect(sees(s, top(s), 'p1')).toBe(false);
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === fieldId(s, 'Test Lantern Seer'))!;
    s = resolveTop(drive(act(s, la.action)));
    expect(sees(s, top(s), 'p1')).toBe(true);
    expect(sees(s, top(s), 'p2')).toBe(false);
    expect(topActions(s)).toEqual(['Cast Grizzly Bears from library']);
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: top(s) })));
    expect(topActions(s)).toEqual(['Play Forest from library']);
    // the effect ends at the cleanup step (CR 514.2): on p1's next turn the top card is hidden again
    s = advanceTo(s, 3, 'main1');
    expect(sees(s, top(s), 'p1')).toBe(false);
    expect(topActions(s)).toEqual([]);
  });
});
