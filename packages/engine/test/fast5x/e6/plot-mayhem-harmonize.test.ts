/**
 * FAST5X E6: plot (CR 702.170, 116.2k), mayhem (CR 702.187) and harmonize (CR 702.180) on the game path, with real fixture cards: cards cast later from exile
 * or from a graveyard.
 *   - Plot: "Any time you have priority during your main phase while the stack is empty, you may exile this card from your hand and pay [cost]. It becomes a
 *     plotted card." (702.170a), a special action (702.170b, 116.2k); its owner may cast it from exile without paying its mana cost during their main phase
 *     while the stack is empty during any turn after the turn in which it became plotted (702.170d; alternative cost, 118.9, 601.2b, 601.2f-h).
 *   - Mayhem: "As long as you discarded this card this turn, you may cast it from your graveyard by paying [cost] rather than paying its mana cost." (702.187b)
 *   - Harmonize: cast from the graveyard for [cost] and tapping up to one untapped creature you control; the total cost is reduced by generic mana equal to its
 *     power; exiled instead of going anywhere else when it leaves the stack (702.180a-b).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type Action, type GameState } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, answer, cast, drive, find, lands, next, onField, pick, resolveTop, scenario, target } from '../../m6/dfc/support';
import { logHas } from '../../m4/helpers';

const SHOWOFF = 'Slickshot Show-Off'; // {1}{R} 1/2 flying, haste; Plot {1}{R}
const DJINN = "Djinn of Fool's Fall"; // {4}{U} 4/3 flying; Plot {3}{U}
const BOLT = "Electro's Bolt"; // {2}{R} sorcery: 4 damage to target creature; Mayhem {1}{R}
const SWARM = 'Swarm, Being of Bees'; // {2}{B} flash, flying 3/3; Mayhem {B}
const RIDE = 'Wild Ride'; // {R} sorcery: target creature gets +3/+0 and haste; Harmonize {4}{R}
const WHISPER = 'Unending Whisper'; // {U} sorcery: draw a card; Harmonize {5}{U}

const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
const labels = (s: GameState, player: 'p1' | 'p2' = 'p1'): string[] => legalActions(s, player).map((a) => a.label);
const special = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'special' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name)?.action;
const castVia = (s: GameState, name: string, method: string): Action | undefined =>
  legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name && (a.action as { method?: string }).method === method)?.action;

function until(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t); i++) {
    if (t.pending?.kind === 'chooseObjects') throw new Error('until: unexpected chooseObjects');
    t = next(t);
  }
  if (!done(t)) throw new Error('until: not reached');
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => until(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const upkeepOf = (s: GameState, player: 'p1' | 'p2'): GameState => until(s, (t) => t.turn.activePlayer === player && t.turn.step === 'upkeep' && t.pending?.kind === 'priority');

describe('FAST5X E6: plot, mayhem and harmonize are capabilities; their cards compile full', () => {
  it('the keywords and the alternative-cost features are registered (CR 702.170, 702.187, 702.180)', () => {
    for (const c of ['keyword:plot', 'keyword:mayhem', 'keyword:harmonize', 'feature:alternativeCost.discardedThisTurn', 'feature:alternativeCost.tapReduces', 'feature:alternativeCost.exileOnLeave']) {
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    }
    for (const name of [SHOWOFF, DJINN, 'Stingerback Terror', BOLT, SWARM, 'Raging Goblinoids', RIDE, WHISPER, "Ureni's Rebuff", "Nature's Rhythm"]) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });

  // Cloud r3-mech: mayhem without a cost (CR 702.187c, play a land from the graveyard) is automated since then (statics/play-permits.ts#isDiscardedSelfPlayPermit,
  // played in test/cloud/r3-mech/r3-mech-scenarios.test.ts)
  it('mayhem without a cost (CR 702.187c, play a land from the graveyard) is automated (cloud r3-mech)', () => {
    const def = compileCard(getCard('Oscorp Industries'));
    expect(def.automation.level).toBe('full');
  });
});

describe('CR 702.170a-b, 116.2k: plotting is a special action in your own main phase with an empty stack', () => {
  const board = (): GameState => scenario([SHOWOFF, DJINN, 'Mountain', 'Island', 'Grizzly Bears'], {
    p1: { hand: [SHOWOFF, DJINN], battlefield: lands('Mountain', 2) },
    p2: { hand: [SHOWOFF], battlefield: lands('Mountain', 2) },
  });

  it('is listed for a card with plot whose cost can be paid, and not for one whose cost cannot', () => {
    const s = board();
    expect(labels(s)).toContain(`Plot ${SHOWOFF} ({1}{R})`);
    expect(special(s, DJINN)).toBeUndefined(); // {3}{U}: no Island
    expect(special(s, SHOWOFF, 'p2')).toBeUndefined(); // not p2's turn (CR 116.2k)
  });

  it('pays the plot cost, exiles the card from the hand and makes it plotted (CR 702.170a); it uses no stack (CR 702.170b)', () => {
    let s = board();
    const card = find(s, SHOWOFF, 'hand', 'p1');
    s = drive(act(s, special(s, SHOWOFF)!));
    expect(tapped(s)).toBe(2);
    expect(s.zones.stack).toEqual([]);
    expect(s.zones.hand['p1']).not.toContain(card);
    const exiled = find(s, SHOWOFF, 'exile', 'p1');
    expect(s.objects[exiled]!.chosen?.['plotted']).toBe(s.turn.number);
    expect(s.pending?.kind).toBe('priority');
    expect(s.pending?.player).toBe('p1'); // a special action: the player gets priority again (CR 116.3)
    expect(logHas(s, /plots Slickshot Show-Off/, 'CR 702.170a')).toBe(true);
  });

  it('is not available with a nonempty stack, outside a main phase, or on an opponent\'s turn (CR 116.2k, 702.170a)', () => {
    let s = scenario([SHOWOFF, SWARM, 'Mountain', 'Swamp'], { p1: { hand: [SHOWOFF, SWARM], battlefield: [...lands('Mountain', 2), ...lands('Swamp', 3)] } });
    s = cast(s, SWARM); // flash creature on the stack
    expect(special(s, SHOWOFF)).toBeUndefined();
    const card = find(s, SHOWOFF, 'hand', 'p1');
    expect(applyAction(s, { type: 'special', player: 'p1', kind: 'plot', object: card }).error?.rules).toContain('CR 116.2k');
    s = resolveTop(s);
    s = upkeepOf(s, 'p2');
    expect(special(s, SHOWOFF)).toBeUndefined();
    s = upkeepOf(s, 'p1');
    expect(special(s, SHOWOFF)).toBeUndefined(); // upkeep: not a main phase
    s = mainOf(s, 'p1');
    expect(special(s, SHOWOFF)).toBeDefined();
  });
});

describe('CR 702.170d: a plotted card is cast from exile without paying its mana cost on a later turn, as a sorcery', () => {
  it('not on the turn it became plotted; on a later turn of its owner, in a main phase with an empty stack, for nothing', () => {
    let s = scenario([SHOWOFF, 'Mountain'], { p1: { hand: [SHOWOFF], battlefield: lands('Mountain', 2) } });
    s = drive(act(s, special(s, SHOWOFF)!));
    const card = find(s, SHOWOFF, 'exile', 'p1');
    expect(castVia(s, SHOWOFF, 'plot')).toBeUndefined(); // the same turn
    expect(applyAction(s, { type: 'cast', player: 'p1', card, method: 'plot' }).error).toBeDefined();
    expect(applyAction(s, { type: 'cast', player: 'p1', card }).error).toBeDefined(); // not otherwise castable from exile (CR 601.3)
    s = mainOf(s, 'p2');
    expect(applyAction(s, { type: 'cast', player: 'p1', card, method: 'plot' }).error).toBeDefined(); // not p1's turn
    s = upkeepOf(s, 'p1');
    expect(applyAction(s, { type: 'cast', player: 'p1', card, method: 'plot' }).error).toBeDefined(); // not a main phase
    s = mainOf(s, 'p1');
    expect(labels(s)).toContain(`Cast ${SHOWOFF} (plot)`);
    const before = tapped(s);
    s = drive(act(s, castVia(s, SHOWOFF, 'plot')!));
    expect(tapped(s)).toBe(before); // without paying its mana cost (CR 118.9)
    s = resolveTop(s);
    const m = onField(s, SHOWOFF);
    expect(s.objects[m]!.cast?.via).toBe('plot');
    expect(s.objects[m]!.cast?.from).toBe('exile');
    expect(s.objects[m]!.cast?.costsPaid.manaSpent ?? []).toEqual([]);
  });

  it('only the plotted object: a card that leaves exile and comes back is a new object, not plotted (CR 400.7); another exiled card is not plotted', () => {
    let s = scenario([SHOWOFF, DJINN, 'Mountain'], { p1: { hand: [SHOWOFF], exile: [DJINN], battlefield: lands('Mountain', 2) } });
    s = drive(act(s, special(s, SHOWOFF)!));
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(castVia(s, SHOWOFF, 'plot')).toBeDefined();
    expect(castVia(s, DJINN, 'plot')).toBeUndefined();
    // a copy of the state in which the plotted card is a new object in exile (its designation gone, as a zone change makes it)
    const t = structuredClone(s);
    const id = find(t, SHOWOFF, 'exile', 'p1');
    delete t.objects[id]!.chosen;
    expect(castVia(t, SHOWOFF, 'plot')).toBeUndefined();
  });
});

describe('CR 702.187b: mayhem casts a card discarded this turn from the graveyard for its mayhem cost', () => {
  const board = (): GameState => scenario(['Faithless Looting', BOLT, 'Mountain', 'Grizzly Bears'], {
    p1: { hand: ['Faithless Looting', BOLT], battlefield: lands('Mountain', 3) },
    p2: { battlefield: ['Grizzly Bears'] },
  });
  /** p1 casts Faithless Looting and discards Electro's Bolt and one drawn card (CR 701.9). */
  function loot(s0: GameState): GameState {
    let s = resolveTop(cast(s0, 'Faithless Looting'));
    expect(s.pending?.kind).toBe('chooseObjects');
    const bolt = find(s, BOLT, 'hand', 'p1');
    const other = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!; // a drawn card
    s = drive(answer(s, pick(bolt, other)));
    return s;
  }

  it('not for a card that was put into the graveyard without being discarded', () => {
    const s = scenario([BOLT, 'Mountain', 'Grizzly Bears'], { p1: { graveyard: [BOLT], battlefield: lands('Mountain', 3) }, p2: { battlefield: ['Grizzly Bears'] } });
    expect(castVia(s, BOLT, 'mayhem')).toBeUndefined();
    const card = find(s, BOLT, 'graveyard', 'p1');
    expect(applyAction(s, { type: 'cast', player: 'p1', card, method: 'mayhem' }).error?.rules).toContain('CR 702.187b');
  });

  it('after a discard this turn: cast for {1}{R} from the graveyard; it goes back to the graveyard after resolving (no exile)', () => {
    let s = loot(board());
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === BOLT)).toBe(true);
    expect(labels(s)).toContain(`Cast ${BOLT} (mayhem)`);
    const before = tapped(s);
    const bears = onField(s, 'Grizzly Bears', 'p2');
    s = drive(act(s, castVia(s, BOLT, 'mayhem')!), [target(bears)]);
    expect(tapped(s) - before).toBe(2); // {1}{R}, not {2}{R}
    s = resolveTop(s);
    expect(s.zones.battlefield).not.toContain(bears);
    expect(find(s, BOLT, 'graveyard', 'p1')).toBeDefined();
    expect(s.history.some((e) => e.ev === 'cast' && e.facts['via'] === 'mayhem' && e.facts['from'] === 'graveyard')).toBe(true);
  });

  it('only during the turn it was discarded (CR 702.187b)', () => {
    let s = loot(board());
    expect(castVia(s, BOLT, 'mayhem')).toBeDefined();
    s = mainOf(s, 'p2');
    s = mainOf(s, 'p1');
    expect(castVia(s, BOLT, 'mayhem')).toBeUndefined();
  });

  it('timing rules still apply: a sorcery with mayhem is not cast while a spell is on the stack', () => {
    let s = scenario(['Faithless Looting', BOLT, SWARM, 'Mountain', 'Swamp', 'Grizzly Bears'], {
      p1: { hand: ['Faithless Looting', BOLT, SWARM], battlefield: [...lands('Mountain', 3), ...lands('Swamp', 3)] },
      p2: { battlefield: ['Grizzly Bears'] },
    });
    s = loot(s);
    s = cast(s, SWARM);
    expect(castVia(s, BOLT, 'mayhem')).toBeUndefined();
  });
});

describe('CR 702.180a-b: harmonize casts from the graveyard, tapping up to one creature to reduce the cost by its power, then exiles the card', () => {
  const board = (mountains: number, creatures: string[] = ['Grizzly Bears']): GameState => scenario([RIDE, 'Mountain', 'Grizzly Bears', 'Hill Giant', 'Counterspell', 'Island'], {
    p1: { graveyard: [RIDE], battlefield: [...lands('Mountain', mountains), ...creatures] },
    p2: { hand: ['Counterspell'], battlefield: lands('Island', 2) },
  });

  it('tapping a 2-power creature reduces {4}{R} to {2}{R}; the creature is tapped; the card is exiled after it resolves (CR 702.180a)', () => {
    let s = board(5);
    expect(labels(s)).toContain(`Cast ${RIDE} (harmonize)`);
    const bears = onField(s, 'Grizzly Bears');
    s = act(s, castVia(s, RIDE, 'harmonize')!);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending && 'min' in s.pending ? s.pending.min : undefined).toBe(0); // "up to one": payable without one
    s = drive(s, [pick(bears), target(bears)]);
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(tapped(s)).toBe(4); // three Mountains ({2}{R}) and the Bears
    expect(logHas(s, /chooses to tap Grizzly Bears for the harmonize cost/, 'CR 702.180b')).toBe(true);
    s = resolveTop(s);
    expect(find(s, RIDE, 'exile', 'p1')).toBeDefined();
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === RIDE)).toBe(false);
  });

  it('without tapping a creature it costs the full {4}{R}', () => {
    let s = board(5);
    const bears = onField(s, 'Grizzly Bears');
    s = drive(act(s, castVia(s, RIDE, 'harmonize')!), [pick(), target(bears)]);
    expect(s.objects[bears]!.tapped).toBe(false);
    expect(tapped(s)).toBe(5);
  });

  it('a summoning-sick creature may be tapped (the cost is not a {T} ability, CR 302.6); one whose tap does not make the cost payable is not offered', () => {
    let s = scenario([RIDE, 'Mountain', 'Grizzly Bears', 'Hill Giant'], {
      p1: { graveyard: [RIDE], battlefield: [...lands('Mountain', 2), { name: 'Grizzly Bears', since: 1 }, { name: 'Hill Giant', since: 1 }] },
    });
    // {4}{R} with two Mountains: only the Hill Giant (power 3) leaves {1}{R}; the Bears (power 2) would leave {2}{R}
    const giant = onField(s, 'Hill Giant');
    s = act(s, castVia(s, RIDE, 'harmonize')!);
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as { options: string[]; min: number };
    expect(p.options).toEqual([giant]);
    expect(p.min).toBe(1);
    s = drive(s, [pick(giant), target(giant)]);
    expect(s.objects[giant]!.tapped).toBe(true);
    expect(tapped(s)).toBe(3);
  });

  it('is not offered when no creature makes the cost payable', () => {
    const s = board(2, []);
    expect(castVia(s, RIDE, 'harmonize')).toBeUndefined();
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, RIDE, 'graveyard', 'p1'), method: 'harmonize' }).error).toBeDefined();
  });

  it('countered, the spell is exiled instead of going to the graveyard (CR 702.180a: any time it would leave the stack)', () => {
    let s = board(5);
    const bears = onField(s, 'Grizzly Bears');
    s = drive(act(s, castVia(s, RIDE, 'harmonize')!), [pick(bears), target(bears)]);
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Counterspell', 'hand', 'p2') }), [target(spell)]);
    s = resolveTop(s);
    expect(find(s, RIDE, 'exile', 'p1')).toBeDefined();
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === RIDE)).toBe(false);
  });

  it('cast normally from the hand, the card goes to the graveyard as usual (the exile is only for the harmonize cost)', () => {
    let s = scenario([WHISPER, 'Island'], { p1: { hand: [WHISPER], battlefield: lands('Island', 1) } });
    s = resolveTop(cast(s, WHISPER));
    expect(find(s, WHISPER, 'graveyard', 'p1')).toBeDefined();
    expect(labels(s).some((l) => l.includes('harmonize'))).toBe(false); // {5}{U}: one Island and no creature
  });
});

describe('CR 702.170a, 603.2, 113.6k: "When this card becomes plotted" triggers from exile', () => {
  const LONGHORN = 'Longhorn Sharpshooter'; // {2}{R} 3/3 reach; "When this card becomes plotted, it deals 2 damage to any target."; Plot {3}{R}

  it('the cards compile full, the ability functions in exile', () => {
    for (const name of [LONGHORN, 'Aloe Alchemist']) {
      const def = compileCard(getCard(name));
      expect(def.automation.level, name).toBe('full');
      const trig = def.faces[0]!.abilities.find((a) => a.kind === 'triggered');
      expect(trig && trig.kind === 'triggered' ? trig.zone : undefined, name).toEqual(['exile']);
    }
  });

  it('plotting it puts the trigger on the stack; the card in exile deals the damage', () => {
    let s = scenario([LONGHORN, 'Mountain', 'Grizzly Bears'], { p1: { hand: [LONGHORN], battlefield: lands('Mountain', 4) }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = onField(s, 'Grizzly Bears', 'p2');
    s = drive(act(s, special(s, LONGHORN)!), [target(bears)]);
    expect(s.zones.stack).toHaveLength(1);
    const card = find(s, LONGHORN, 'exile', 'p1');
    expect(s.objects[s.zones.stack[0]!]!.stack?.targets).toEqual([[{ kind: 'object', id: bears }]]);
    s = resolveTop(s);
    expect(s.zones.battlefield).not.toContain(bears); // 2 damage to a 2/2 (CR 704.5g)
    expect(s.zones.exile).toContain(card); // still plotted
    expect(s.objects[card]!.chosen?.['plotted']).toBe(s.turn.number);
  });

  it('casting it from exile later does not trigger it again (it is not becoming plotted)', () => {
    let s = scenario([LONGHORN, 'Mountain'], { p1: { hand: [LONGHORN], battlefield: lands('Mountain', 4) } });
    s = drive(act(s, special(s, LONGHORN)!), [target('p2')]);
    s = resolveTop(s);
    s = mainOf(mainOf(s, 'p2'), 'p1');
    s = drive(act(s, castVia(s, LONGHORN, 'plot')!));
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(s.zones.stack).toHaveLength(0);
    expect(onField(s, LONGHORN)).toBeDefined();
  });
});
