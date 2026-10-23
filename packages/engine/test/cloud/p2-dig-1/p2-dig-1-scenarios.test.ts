/**
 * Phase 2 lane p2-dig, round p2-dig-1: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 401.2, 401.5        "Play with the top card of your library revealed.": every player sees the top card of your library, not the card below it, and not without
 *                          the permission; "Players play with ... their libraries revealed": each player's own top card
 *   CR 401.4, 701.20e      "Look at the top three cards of target player's library, then put them back in any order.": YOU arrange them (the player who looked), not
 *                          their owner; they end on top in the order you chose
 *   CR 608.2d, 701.24a     "You may have that player shuffle.": that player's library is shuffled when you choose to; not when you don't
 *   CR 701.9a, 701.17a     "Each opponent discards two cards, then mills two cards."; "Target player mills twice X cards."
 */
import { describe, expect, it } from 'vitest';
import { canSee, compileCard, type CardDef, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; x?: number; yes?: boolean; order?: (ids: string[]) => string[] }
/** Answer the decisions that come up until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.x ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (script.order ?? ((x) => x))(p.items.map((i) => i.id)) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const top = (s: GameState, p: string, n = 0): string => s.zones.library[p]![n]!;

const SPY = card('Test Lantern Imp', 'Creature — Imp', 'Play with the top card of your library revealed.', ['1', '1']);
const DREAMS = card('Test Open Dream', 'Enchantment', 'Players play with the top card of their libraries revealed.');
const MOTE = card('Test Dust Mote', 'Artifact', '');

describe('CR 401.2, 401.5: "Play with the top card of your library revealed."', () => {
  it('is automated, a permit revealTop of you', () => {
    expect(full(SPY)).toBe(true);
    expect(JSON.stringify(SPY.faces)).toContain('"effects":[{"s":"permit","who":{"ref":"you"},"action":"revealTop"}]');
  });
  it('the opponent sees the top card of your library; not the second card, and not the top of their own library to you', () => {
    const s = scenario([], { defs: [SPY, MOTE], p1: { battlefield: ['Test Lantern Imp'] } });
    expect(canSee(s, s.objects[top(s, 'p1')]!, 'p2')).toBe(true);
    expect(canSee(s, s.objects[top(s, 'p1')]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[top(s, 'p1', 1)]!, 'p2')).toBe(false);
    expect(canSee(s, s.objects[top(s, 'p2')]!, 'p1')).toBe(false);
  });
  it('the negative case: without the permission nobody sees it', () => {
    const s = scenario([], { defs: [SPY, MOTE] });
    expect(canSee(s, s.objects[top(s, 'p1')]!, 'p2')).toBe(false);
    expect(canSee(s, s.objects[top(s, 'p1')]!, 'p1')).toBe(false);
  });
});

describe('CR 401.2: "Players play with the top card of their libraries revealed."', () => {
  it('is automated; each player\'s top card is seen by every player, the second card by nobody', () => {
    expect(full(DREAMS)).toBe(true);
    const s = scenario([], { defs: [DREAMS], p2: { battlefield: ['Test Open Dream'] } });
    for (const p of ['p1', 'p2']) {
      expect(canSee(s, s.objects[top(s, p)]!, 'p1'), p).toBe(true);
      expect(canSee(s, s.objects[top(s, p)]!, 'p2'), p).toBe(true);
      expect(canSee(s, s.objects[top(s, p, 1)]!, p === 'p1' ? 'p2' : 'p1'), p).toBe(false);
    }
  });
});

describe('CR 401.4, 701.20e, 608.2d: "Look at the top three cards of target player\'s library, then put them back in any order. You may have that player shuffle."', () => {
  const GLIMPSE = card('Test Far Glimpse', 'Sorcery', "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.");
  it('is automated: you arrange the cards (arrangedBy you); the shuffle is your option', () => {
    expect(full(GLIMPSE)).toBe(true);
    const j = JSON.stringify(GLIMPSE.faces);
    expect(j).toContain('"to":{"zone":"library","position":"top","order":"chosen","arrangedBy":{"ref":"you"}}');
    expect(j).toContain('{"op":"may","who":{"ref":"you"},"do":[{"op":"shuffle","who":{"ref":"target","id":"t0"}}]}');
  });
  it('you, not the owner, arrange the three cards; they end on top in your order; declining the shuffle keeps them there', () => {
    const names = ['Test Card Alpha', 'Test Card Beta', 'Test Card Gamma'];
    const defs = [GLIMPSE, MOTE, ...names.map((n) => card(n, 'Artifact', ''))];
    let s = scenario([], { defs, p1: { hand: ['Test Far Glimpse'] }, p2: { library: names } });
    expect([0, 1, 2].map((n) => s.objects[top(s, 'p2', n)]!.defId)).toEqual(names);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Far Glimpse', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    let orderedBy: string | undefined;
    for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'order') {
        orderedBy = p.player;
        const byName = (n: string): string => p.items.find((i) => s.objects[i.id]?.defId === n)!.id;
        s = answer(s, { kind: 'order', ids: [byName('Test Card Gamma'), byName('Test Card Alpha'), byName('Test Card Beta')] });
      } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
      else s = drive(s);
    }
    expect(orderedBy).toBe('p1');
    expect([0, 1, 2].map((n) => s.objects[top(s, 'p2', n)]!.defId)).toEqual(['Test Card Gamma', 'Test Card Alpha', 'Test Card Beta']);
    expect(s.log.some((l) => /Bob shuffles/.test(l.text))).toBe(false);
  });
  it('choosing the option: that player shuffles', () => {
    let s = scenario([], { defs: [GLIMPSE, MOTE], p1: { hand: ['Test Far Glimpse'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Far Glimpse', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] }), { yes: true });
    expect(s.log.some((l) => /Bob shuffles/.test(l.text))).toBe(true);
  });
});

describe('CR 701.9a, 701.17a: "Each opponent discards two cards, then mills two cards."', () => {
  const RITE = card('Test Thinning Rite', 'Sorcery', 'Each opponent discards two cards, then mills two cards.');
  it('is automated; the opponent discards two cards and then two more go from their library to their graveyard; you do neither', () => {
    expect(full(RITE)).toBe(true);
    let s = scenario([], { defs: [RITE, MOTE], p1: { hand: ['Test Thinning Rite'] }, p2: { hand: ['Test Dust Mote', 'Test Dust Mote', 'Test Dust Mote'] } });
    const hand2 = s.zones.hand.p2!.length;
    const lib2 = s.zones.library.p2!.length;
    const lib1 = s.zones.library.p1!.length;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Thinning Rite', 'hand', 'p1') })));
    expect(s.zones.hand.p2!.length).toBe(hand2 - 2);
    expect(s.zones.library.p2!.length).toBe(lib2 - 2);
    expect(s.zones.graveyard.p2!.length).toBe(4);
    expect(s.zones.library.p1!.length).toBe(lib1);
  });
});

describe('CR 701.17a, 107.3: "Target player mills twice X cards."', () => {
  const FLOOD = card('Test Memory Flood', 'Sorcery', 'Target player mills twice X cards.', undefined, '{X}');
  it('is automated; with X = 2 the target mills four cards', () => {
    expect(full(FLOOD)).toBe(true);
    let s = scenario([], { defs: [FLOOD, MOTE], p1: { hand: ['Test Memory Flood'] } });
    s.players.find((p) => p.id === 'p1')!.manaPool.push({ type: 'C' } as never, { type: 'C' } as never);
    const lib2 = s.zones.library.p2!.length;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Memory Flood', 'hand', 'p1') }), { x: 2, targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.zones.library.p2!.length).toBe(lib2 - 4);
  });
});
