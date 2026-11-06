/**
 * edh-next-123 (must-finish round: exile and cast, villainous choice): the round's readings played through applyAction in 3-player Free-for-All games (CR 806) with
 * synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins (CR cites
 * checked against the Comprehensive Rules of 2026-09-25) and the Scryfall rulings it plays.
 */
import { describe, expect, it } from 'vitest';
import { canSee } from '../../../src/core/view';
import { charsOfObject } from '../../../src/rules/characteristics';
import { applyAction, compileCard, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, automated, card, castable, exiled, find, mpScenario, nameOf, onBattlefield, passTo, resolveAll, toBottom } from './support';

const BEAR = card('Test Bear', 'Creature — Bear', 'Flash', ['2', '2'], '{G}', ['G']);
const SLOW_BEAR = card('Test Slow Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', undefined, '{0}');
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{0}');
const OGRE_C = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');

describe('Arvinox, the Mind Flail (CR 401.1, 406.3, 611.2b, 601.3, 609.4b, 400.7): "At the beginning of your end step, exile the bottom card of each opponent\'s library face down. For as long as those cards remain exiled, you may look at them, you may cast permanent spells from among them, and you may spend mana as though it were mana of any color to cast those spells."', () => {
  const FLAIL = card('Test Flail', 'Legendary Enchantment Creature — Horror', "This creature isn't a creature unless you control three or more permanents you don't own.\nAt the beginning of your end step, exile the bottom card of each opponent's library face down. For as long as those cards remain exiled, you may look at them, you may cast permanent spells from among them, and you may spend mana as though it were mana of any color to cast those spells.", ['9', '9']);
  const DEFS = [FLAIL, BEAR, SLOW_BEAR, SHOCK, ROCK];
  const endStep = (s: { turn: { step: string; number: number } }): boolean => s.turn.step === 'end' && s.turn.number === 1;
  const game = () => mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Flail', 'Plains'] }, p2: { library: ['Test Bear', 'Test Rock'] }, p3: { library: ['Test Shock'] } },
    setup: (s) => { toBottom(s, 'p2', 'Test Bear'); toBottom(s, 'p3', 'Test Shock'); } });
  it('is automated', () => { expect(automated(FLAIL)).toBe(true); });
  it("exiles the BOTTOM card of each opponent's library face down (not the top one); you can look at them, their owners can't", () => {
    let s = passTo(game(), (x) => endStep(x) && x.zones.stack.length === 0 && x.zones.exile.length === 2);
    const bear = exiled(s, 'Test Bear')[0]!;
    const shock = exiled(s, 'Test Shock')[0]!;
    expect(s.objects[bear]!.faceDown).toBe(true);
    expect(s.objects[shock]!.faceDown).toBe(true);
    expect(exiled(s, 'Test Rock')).toEqual([]); // the top card of Bob's library stays where it is
    expect(canSee(s, s.objects[bear]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[bear]!, 'p2')).toBe(false);
    expect(canSee(s, s.objects[shock]!, 'p3')).toBe(false);
    // a permanent spell (a creature with flash, so it can be cast now) is castable, green paid for with white mana; the instant is not (only permanent spells)
    expect(castable(s)).toContain(bear);
    expect(castable(s)).not.toContain(shock);
    expect(castable(s, 'p2')).not.toContain(bear); // its owner may not cast it: the permission is yours
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: bear }));
    const mine = onBattlefield(s, 'Test Bear')!;
    expect(s.objects[mine]!.controller).toBe('p1');
    expect(s.objects[mine]!.owner).toBe('p2');
  });
  it('the permission lasts while the card stays exiled: a non-flash permanent card can be cast in your next main phase', () => {
    let t = mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Flail', 'Plains'] }, p2: { library: ['Test Slow Bear'] }, p3: {} }, setup: (x) => toBottom(x, 'p2', 'Test Slow Bear') });
    t = passTo(t, (x) => x.turn.number === 4 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    const slow = exiled(t, 'Test Slow Bear')[0]!;
    expect(castable(t)).toContain(slow);
  });
  it("isn't a creature with fewer than three permanents you control but don't own; is one with three", () => {
    const types = (s: GameState): string[] => charsOfObject(s, s.objects[find(s, 'Test Flail', 'battlefield', 'p1') as ObjectId]!).types as string[];
    let s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Flail'] }, p2: { battlefield: ['Test Rock', 'Test Rock', 'Test Rock'] } },
      setup: (x) => { for (const id of x.zones.battlefield.filter((i) => nameOf(x, i) === 'Test Rock').slice(0, 2)) x.objects[id]!.controller = 'p1'; } });
    expect(types(s)).not.toContain('Creature');
    expect(types(s)).toContain('Enchantment');
    s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Flail', 'Test Rock', 'Test Rock'] }, p2: { battlefield: ['Test Rock', 'Test Rock', 'Test Rock'] } },
      setup: (x) => { for (const id of x.zones.battlefield.filter((i) => nameOf(x, i) === 'Test Rock' && x.objects[i]!.owner === 'p2').slice(0, 3)) x.objects[id]!.controller = 'p1'; } });
    expect(types(s)).toContain('Creature');
  });
});

describe('Ensnared by the Mara (CR 701.55a, 701.55b, 101.4, 601.2, 118.9, 202.3, 120.3; rulings 2023-10-13): "Each opponent faces a villainous choice — They exile cards from the top of their library until they exile a nonland card, then you may cast that card without paying its mana cost, or that player exiles the top four cards of their library and ~ deals damage equal to the total mana value of those exiled cards to that player."', () => {
  const SNARE = card('Test Snare', 'Sorcery', "Each opponent faces a villainous choice — They exile cards from the top of their library until they exile a nonland card, then you may cast that card without paying its mana cost, or that player exiles the top four cards of their library and Test Snare deals damage equal to the total mana value of those exiled cards to that player.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
  const DEFS = [SNARE, OGRE, SLOW_BEAR];
  const game = () => mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Snare'] }, p2: { library: ['Plains', 'Test Ogre'] }, p3: { library: ['Test Ogre', 'Test Slow Bear', 'Plains', 'Plains', 'Test Ogre'] } } });
  /** Cast the sorcery; `options[p]` is the option the opponent p takes (true: the first), `castIt` whether you cast the card the first option exiled. */
  const play = (options: Record<string, boolean>, castIt: boolean) => {
    const asked: [string, string][] = [];
    const s = resolveAll(act(game(), { type: 'cast', player: 'p1', card: find(game(), 'Test Snare', 'hand', 'p1') }), (t) => {
      const p = t.pending!;
      if (p.kind === 'yesNo' && p.player !== 'p1') return { kind: 'yesNo', yes: options[p.player]! };
      if (p.kind === 'yesNo' && p.player === 'p1') return { kind: 'yesNo', yes: castIt };
      return undefined;
    }, asked);
    return { s, asked };
  };
  it('is automated', () => { expect(automated(SNARE)).toBe(true); });
  it('each opponent chooses in turn order and that option is done before the next one chooses; the first option exiles until a nonland card and you cast it free; the second deals the total mana value of the top four', () => {
    const { s, asked } = play({ p2: true, p3: false }, true);
    // Bob chooses, then you decide to cast the card he exiled (the ruling: he does not choose whether you cast it), then Carol chooses
    expect(asked.filter(([, k]) => k === 'yesNo').map(([p]) => p)).toEqual(['p2', 'p1', 'p3']);
    const ogres = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Ogre');
    expect(ogres.length).toBe(1);
    expect(s.objects[ogres[0]!]!.controller).toBe('p1');
    expect(s.objects[ogres[0]!]!.owner).toBe('p2');
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2').map((id) => nameOf(s, id))).toEqual(['Plains']); // the land exiled on the way stays exiled
    // Carol: Ogre 3 + Slow Bear 1 + two Plains 0 = 4 damage; the fifth card (another Ogre) stays in her library
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(16);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p3').length).toBe(4);
    expect(nameOf(s, s.zones.library.p3![0]!)).toBe('Test Ogre');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
  });
  it('you may decline to cast the exiled card (it stays exiled); an opponent who takes the first option takes no damage', () => {
    const { s } = play({ p2: true, p3: true }, false);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Ogre')).toEqual([]);
    expect(exiled(s, 'Test Ogre').length).toBe(2);
    expect(s.players.filter((p) => p.id !== 'p1').map((p) => p.life)).toEqual([20, 20]);
  });
});

describe('Possibility Storm (CR 406.1, 608.2c, 608.2h, 400.7, 601.2, 118.9, 401.1, 400.3; rulings 2013-04-15): "Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order."', () => {
  const STORM = card('Test Storm', 'Enchantment', "Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.");
  const IMP = card('Test Flash Imp', 'Creature — Imp', 'Flash', ['1', '1'], '{0}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
  const DEFS = [STORM, IMP, OGRE, SHOCK, ROCK];
  const game = () => mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Storm'] }, p2: { hand: ['Test Flash Imp'], library: ['Plains', 'Test Shock', 'Test Ogre', 'Test Rock'] } } });
  /** Bob casts the Imp from his hand during Alice's main phase; `castIt`: whether he casts the card the trigger stopped at. */
  const play = (castIt: boolean) => {
    let s = game();
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Imp', 'hand', 'p2') });
    const asked: [string, string][] = [];
    s = resolveAll(s, (t) => (t.pending!.kind === 'yesNo' ? { kind: 'yesNo', yes: castIt } : undefined), asked);
    return { s, asked };
  };
  const bottom = (s: GameState, n: number): string[] => s.zones.library.p2!.slice(-n).map((id) => nameOf(s, id)).sort();
  it('is automated', () => { expect(automated(STORM)).toBe(true); });
  it('the spell is exiled (it never resolves), cards are exiled until one sharing a card type with it (a creature), that player casts it free; the rest and the spell go to the bottom', () => {
    const { s, asked } = play(true);
    expect(asked.filter(([, k]) => k === 'yesNo').map(([p]) => p)).toEqual(['p2']); // the caster decides, not the enchantment's controller
    expect(onBattlefield(s, 'Test Ogre')).toBeDefined();
    expect(s.objects[onBattlefield(s, 'Test Ogre')!]!.controller).toBe('p2');
    expect(onBattlefield(s, 'Test Flash Imp')).toBeUndefined();
    expect(s.zones.exile).toEqual([]);
    expect(bottom(s, 3)).toEqual(['Plains', 'Test Flash Imp', 'Test Shock']);
    expect(nameOf(s, s.zones.library.p2![0]!)).toBe('Test Rock'); // the card after the Ogre was never exiled
  });
  it('a card that is not cast goes to the bottom with the others (ruling 2013-04-15)', () => {
    const { s } = play(false);
    expect(onBattlefield(s, 'Test Ogre')).toBeUndefined();
    expect(s.zones.exile).toEqual([]);
    expect(bottom(s, 4)).toEqual(['Plains', 'Test Flash Imp', 'Test Ogre', 'Test Shock']);
  });
  it('ruling 2013-04-15: with two of them, the second does not exile the spell (the first did) but still exiles until a card that shares a card type with it, read as the spell last was', () => {
    let s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Storm', 'Test Storm'] }, p2: { hand: ['Test Flash Imp'], library: ['Plains', 'Test Ogre', 'Test Shock', 'Test Ogre', 'Test Rock'] } } });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Imp', 'hand', 'p2') });
    s = resolveAll(s, (t) => (t.pending!.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : t.pending!.kind === 'order' ? { kind: 'order', ids: (t.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) } : undefined));
    expect(s.zones.exile).toEqual([]);
    // the first trigger: Imp, Plains, Ogre to the bottom; the second (no spell left to exile): Shock, Ogre; the Rock stays on top
    expect(nameOf(s, s.zones.library.p2![0]!)).toBe('Test Rock');
    expect(s.zones.library.p2!.filter((id) => nameOf(s, id) === 'Test Ogre').length).toBe(2);
    expect(bottom(s, 2)).toEqual(['Test Ogre', 'Test Shock']);
  });
  it('a spell cast from somewhere other than a hand does not trigger it (the card cast by the trigger itself does not trigger it again)', () => {
    const { s } = play(true);
    // the Ogre was cast from exile: no second trigger exiled it
    expect(onBattlefield(s, 'Test Ogre')).toBeDefined();
    expect(s.zones.stack).toEqual([]);
  });
});

describe('Tasha, the Witch Queen (CR 601.2c, 115.1, 406.1, 122.1, 601.2, 118.9, 608.2g, 108.3; ruling 2022-06-10): "Whenever you cast a spell you don\'t own, create a 3/3 black Demon creature token." / "+1: Draw a card. For each opponent, exile up to one target instant or sorcery card from that player\'s graveyard and put a page counter on it." / "−3: You may cast a spell from among cards in exile with page counters on them without paying its mana cost."', () => {
  const WITCH = compileCard({ name: 'Test Witch', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Tasha', oracle_text: "Whenever you cast a spell you don't own, create a 3/3 black Demon creature token.\n+1: Draw a card. For each opponent, exile up to one target instant or sorcery card from that player's graveyard and put a page counter on it.\n−3: You may cast a spell from among cards in exile with page counters on them without paying its mana cost.", loyalty: '5', colors: [] } as OracleCard);
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target player.', undefined, '{2}{R}', ['R']);
  const DEFS = [WITCH, BOLT, OGRE_C, SHOCK];
  const game = () => mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: [{ name: 'Test Witch', counters: { loyalty: 5 } }] }, p2: { graveyard: ['Test Bolt', 'Test Ogre'] }, p3: { graveyard: ['Test Shock'] } } });
  const witch = (s: GameState) => find(s, 'Test Witch', 'battlefield', 'p1');
  const plus = (s0: GameState, targets: ObjectId[][]) => {
    const q = [...targets];
    let s = act(s0, { type: 'activate', player: 'p1', source: witch(s0), ability: 'p:0:1' });
    return resolveAll(s, (t) => (t.pending!.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) } : undefined));
  };
  it('is automated', () => { expect(automated(WITCH)).toBe(true); });
  it('+1: draws, then exiles one instant or sorcery card from each opponent\'s graveyard (a target for each), each with a page counter; a creature card cannot be a target', () => {
    const s0 = game();
    const bolt = find(s0, 'Test Bolt', 'graveyard', 'p2');
    const shock = find(s0, 'Test Shock', 'graveyard', 'p3');
    const hand = s0.zones.hand.p1!.length;
    const asking = act(s0, { type: 'activate', player: 'p1', source: witch(s0), ability: 'p:0:1' });
    expect(asking.pending?.kind).toBe('chooseTargets');
    expect(JSON.stringify(asking.pending)).not.toContain(`"${find(s0, 'Test Ogre', 'graveyard', 'p2')}"`); // a creature card is never offered
    const s = plus(s0, [[bolt, shock]]);
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
    const ex = s.zones.exile.map((id) => [nameOf(s, id), s.objects[id]!.counters?.['page'] ?? 0]);
    expect(ex.sort()).toEqual([['Test Bolt', 1], ['Test Shock', 1]]);
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id))).toEqual(['Test Ogre']);
  });
  it('−3: casts a card with a page counter, owned by an opponent, free during the resolution (not later: ruling 2022-06-10); casting a spell you don\'t own makes a Demon', () => {
    let s = plus(game(), [[find(game(), 'Test Bolt', 'graveyard', 'p2'), find(game(), 'Test Shock', 'graveyard', 'p3')]]);
    // next turn cycle back to Alice, so the loyalty ability can be activated again
    s = passTo(s, (x) => x.turn.number === 4 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    const bolt = exiled(s, 'Test Bolt')[0]!;
    s = act(s, { type: 'activate', player: 'p1', source: witch(s), ability: 'p:0:2' });
    s = resolveAll(s, (t) => {
      const p = t.pending as unknown as { kind: string; options?: ObjectId[] };
      if (p.kind === 'chooseObjects') { expect(p.options).toContain(bolt); return { kind: 'chooseObjects', ids: [bolt] }; }
      if (p.kind === 'chooseTargets') return { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] };
      return undefined;
    });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17); // the Bolt (owned by Bob) was cast free
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id))).toContain('Test Bolt'); // back to its owner's graveyard (CR 400.3)
    expect(s.zones.battlefield.filter((id) => /Demon/.test(nameOf(s, id))).length).toBe(1);
    // the Shock still has its page counter in exile: nothing lets you cast it later
    expect(castable(s)).not.toContain(exiled(s, 'Test Shock')[0]!);
  });
  it('−3 offers only cards in exile WITH a page counter (a card exiled another way is not among them); you may cast none', () => {
    let s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: [{ name: 'Test Witch', counters: { loyalty: 5 } }] }, p2: { exile: ['Test Bolt'] } } });
    s = act(s, { type: 'activate', player: 'p1', source: witch(s), ability: 'p:0:2' });
    let offered: ObjectId[] | undefined;
    s = resolveAll(s, (t) => { const p = t.pending as unknown as { kind: string; options?: ObjectId[] }; if (p.kind === 'chooseObjects') { offered = p.options; return { kind: 'chooseObjects', ids: [] }; } return undefined; });
    expect(offered ?? []).toEqual([]);
    expect(exiled(s, 'Test Bolt').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => /Demon/.test(nameOf(s, id))).length).toBe(0);
  });
});

describe('Guff Rewrites History (CR 115.1, 601.2c, 401.1, 400.3, 701.24a, 406.1, 608.2c, 608.2h, 101.4, 601.2, 118.9): "For each player, choose target nonenchantment, nonland permanent that player controls. Those permanents\' owners shuffle them into their libraries. Each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland card, then puts the rest on the bottom of their library in a random order. Each player may cast the nonland card they exiled without paying its mana cost."', () => {
  const REWRITE = card('Test Rewrite', 'Instant', "For each player, choose target nonenchantment, nonland permanent that player controls. Those permanents' owners shuffle them into their libraries. Each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland card, then puts the rest on the bottom of their library in a random order. Each player may cast the nonland card they exiled without paying its mana cost.");
  const AURA = card('Test Charm', 'Enchantment', '', undefined, '{0}');
  const DEFS = [REWRITE, OGRE_C, ROCK, AURA, SLOW_BEAR];
  type Z = Parameters<typeof mpScenario>[0];
  /** Alice casts it targeting `targets`, each player answering the free cast with `castIt[player]`. */
  const play = (zones: NonNullable<Z>['zones'], targets: (s: GameState) => ObjectId[], castIt: Record<string, boolean>, setup?: (s: GameState) => void) => {
    const s0 = mpScenario({ players: 3, defs: DEFS, zones: { ...zones, p1: { ...(zones?.p1 ?? {}), hand: ['Test Rewrite'] } }, ...(setup ? { setup } : {}) });
    const ids = targets(s0);
    const asked: [string, string][] = [];
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rewrite', 'hand', 'p1') }), (t) => {
      const p = t.pending!;
      if (p.kind === 'chooseTargets') return { kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) };
      if (p.kind === 'yesNo') return { kind: 'yesNo', yes: castIt[p.player] ?? false };
      return undefined;
    }, asked);
    return { s0, s, asked };
  };
  const libNames = (s: GameState, p: string): string[] => s.zones.library[p]!.map((id) => nameOf(s, id)).filter((n) => n !== 'Plains');
  it('is automated', () => { expect(automated(REWRITE)).toBe(true); });
  it('each targeted permanent is shuffled into its owner\'s library; each of those players exiles until a nonland card, the rest go to the bottom, then each may cast the card they exiled free, in turn order', () => {
    const { s, asked } = play({ p1: { battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Ogre'] }, p3: { battlefield: ['Test Slow Bear'] } },
      (x) => [find(x, 'Test Rock', 'battlefield', 'p1'), find(x, 'Test Ogre', 'battlefield', 'p2'), find(x, 'Test Slow Bear', 'battlefield', 'p3')], { p1: true, p2: true, p3: false });
    // every library held only Plains besides the shuffled card: each player's exile stops at the card they lost
    expect(asked.filter(([, k]) => k === 'yesNo').map(([p]) => p)).toEqual(['p1', 'p2', 'p3']);
    expect(s.objects[onBattlefield(s, 'Test Rock')!]!.controller).toBe('p1');
    expect(s.objects[onBattlefield(s, 'Test Ogre')!]!.controller).toBe('p2');
    expect(onBattlefield(s, 'Test Slow Bear')).toBeUndefined();
    expect(exiled(s, 'Test Slow Bear').length).toBe(1); // not cast: it stays exiled (only "the rest" went to the bottom)
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Plains')).toEqual([]);
    expect(s.zones.library.p2!.length).toBe(20);
  });
  it('CR 601.2c, 115.1 (no "up to"): one target for EACH player who has a candidate; choosing fewer is refused (the per-player count of edh-d-83, rules/targets.ts)', () => {
    const s0 = mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Rewrite'], battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Ogre'] }, p3: { battlefield: ['Test Slow Bear'] } } });
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rewrite', 'hand', 'p1') });
    const d = s.pending as unknown as { kind: string; id: string; min: number; max: number };
    expect(d.kind).toBe('chooseTargets');
    expect([d.min, d.max]).toEqual([3, 3]);
    const one = applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, 'Test Ogre', 'battlefield', 'p2') }] } });
    expect(one.error).toBeDefined();
  });
  it('an enchantment cannot be chosen; with a player who controls no candidate the spell cannot be cast at all (CR 601.2c; Vaevictis Asmadi ruling 2018-07-13, the same wording)', () => {
    const s0 = mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Rewrite'], battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Ogre', 'Test Charm'] }, p3: { battlefield: ['Test Charm'] } } });
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rewrite', 'hand', 'p1') })).toThrow(/no legal one/);
    const s1 = mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Rewrite'], battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Ogre', 'Test Charm'] }, p3: { battlefield: ['Test Slow Bear'] } } });
    const asking = act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Rewrite', 'hand', 'p1') });
    expect(JSON.stringify(asking.pending)).not.toContain(`"${find(s1, 'Test Charm', 'battlefield', 'p2')}"`);
  });
  it('the owner shuffles a stolen permanent into THEIR library, and the player who controlled it exiles from their own library (CR 400.3, 608.2h)', () => {
    const { s } = play({ p1: { library: ['Test Slow Bear', 'Test Slow Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Rock'] }, p3: { battlefield: ['Test Rock'] } }, (x) => [find(x, 'Test Ogre', 'battlefield', 'p2'), x.zones.battlefield.filter((id) => nameOf(x, id) === 'Test Rock').find((id) => x.objects[id]!.owner === 'p2')!, find(x, 'Test Rock', 'battlefield', 'p3')], { p1: true },
      (x) => { x.objects[x.zones.battlefield.find((id) => nameOf(x, id) === 'Test Ogre')!]!.controller = 'p1'; });
    expect(libNames(s, 'p2').filter((n) => n === 'Test Ogre')).toEqual(['Test Ogre']); // Bob owns it: into his library
    // (Alice drew the first Slow Bear on turn 1; the second is the top card of her library)
    expect(s.objects[onBattlefield(s, 'Test Slow Bear')!]!.controller).toBe('p1'); // Alice controlled it: she exiled from her library and cast what she found
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Rock', 'Test Rock']); // Bob and Carol each exiled their Rock and did not cast it
  });
});
