/**
 * Commander lane instead, second round, round edh-next-71: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each test is named after the rule it checks, with its negative case. CR cites are from memory and unverified unless the record says so.
 *
 *   CR 614.1a, 614.6, 121.1, 406.1   "If you would draw a card, exile the top two cards of your library instead. You may play those cards this turn." (Eruth, Tormented Prophet)
 *   CR 614.1a, 614.6, 121.1, 701.20a "If you would draw a card, look at the top three cards of your library instead. Put one of those cards into your hand and the rest on the bottom ..." (Tomorrow)
 *   CR 614.1a, 614.6, 614.5, 121.1   "If you would draw a card, reveal the top card of your library instead. If it's a creature card, put it into your graveyard. Otherwise, draw a card." (Enduring Renewal)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean; x?: number; players?: PlayerId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      // (the targets are chosen one requirement at a time)
      const d = p as unknown as { players: PlayerId[]; objects: ObjectId[]; min: number };
      const pl = (o.players ?? []).find((x) => d.players.includes(x));
      const ob = targets.find((x) => d.objects.includes(x));
      if (pl !== undefined) { (o.players ?? []).splice((o.players ?? []).indexOf(pl), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: pl }] }); }
      else if (ob !== undefined) { targets.splice(targets.indexOf(ob), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ob }] }); }
      else s = answer(s, { kind: 'chooseTargets', targets: d.min === 0 ? [] : d.players.length > 0 ? [{ kind: 'player', id: d.players[0]! }] : [{ kind: 'object', id: d.objects[0]! }] });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: p.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? p.amount : 0 })) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const lib = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const gy = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;
const byName = (s: GameState, name: string, p?: PlayerId): ObjectId[] => (p ? findAll(s, name, 'battlefield', p) : s.zones.battlefield.filter((id) => chars(s, id).name === name));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;


const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const ISLAND = card('Test Island', 'Basic Land — Island', '{T}: Add {U}.');
const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
const cast = (s: GameState, name: string, from: 'hand' | 'graveyard' = 'hand', p: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player: p, card: find(s, name, from, p) });
/** Permanents of that name CONTROLLED by the player (an object may be owned by another player). */
const nBf = (s: GameState, name: string): ((p: PlayerId) => number) => (p) => s.zones.battlefield.filter((id) => chars(s, id).name === name && s.objects[id]!.controller === p).length;


const DRAW = card('Test Draw', 'Sorcery', 'You draw a card.');
const FILL = (n: string, type: string): CardDef => card(n, type, '', type.includes('Creature') ? { pt: ['1', '1'] } : {});

// ---- Eruth ----------------------------------------------------------------------------------------------------------------------------------------------------------
const ERUTH = card('Test Eruth', 'Enchantment', 'If you would draw a card, exile the top two cards of your library instead. You may play those cards this turn.');
describe('CR 614.1a, 614.6, 121.1, 406.1: "If you would draw a card, exile the top two cards of your library instead. You may play those cards this turn."', () => {
  it('is fully automated', () => { expect(noManual(ERUTH) && ERUTH.automation.level === 'full').toBe(true); });
  it('the draw does not happen: two cards leave the library for exile, and the hand grows by none', () => {
    const s0 = scenario([], { defs: [ERUTH, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: ['Test Eruth'], library: ['Test Plain Bear', 'Test Island', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'));
    expect(hand(s, 'p1')).toBe(0);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1') - 2);
    expect(s.zones.exile.length).toBe(2);
  });
  it('the exiled cards may be played this turn (a land can be played from exile)', () => {
    const s0 = scenario([], { defs: [ERUTH, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: ['Test Eruth'], library: ['Test Island', 'Test Plain Bear', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'));
    const island = s.zones.exile.find((id) => chars(s, id).name === 'Test Island')!;
    expect(legal(s, 'p1', 'playLand').map((a) => a.object)).toContain(island);
  });
  it('negative: an opponent drawing is not replaced (Eruth says "you")', () => {
    const OPP = card('Test Opp Draw', 'Sorcery', 'Target opponent draws a card.');
    const s0 = scenario([], { defs: [ERUTH, OPP, BEAR, ISLAND], p1: { hand: ['Test Opp Draw'], battlefield: ['Test Eruth'] }, p2: { library: ['Test Plain Bear', 'Test Island'] } });
    const s = resolveAll(cast(s0, 'Test Opp Draw'), { players: ['p2'] });
    expect(hand(s, 'p2')).toBe(hand(s0, 'p2') + 1);
    expect(s.zones.exile.length).toBe(0);
  });
});

// ---- Tomorrow -------------------------------------------------------------------------------------------------------------------------------------------------------
const TOMORROW = card('Test Tomorrow', 'Creature — Spirit', 'If you would draw a card, look at the top three cards of your library instead. Put one of those cards into your hand and the rest on the bottom of your library in any order.', { pt: ['2', '2'] });
describe('CR 614.1a, 614.6, 121.1, 701.20a: "If you would draw a card, look at the top three cards of your library instead. Put one of those cards into your hand ..."', () => {
  it('is fully automated', () => { expect(noManual(TOMORROW) && TOMORROW.automation.level === 'full').toBe(true); });
  it('one of the top three goes to the hand, the other two to the bottom: the hand has one card, the library keeps its size less one', () => {
    const s0 = scenario([], { defs: [TOMORROW, DRAW, BEAR, ISLAND, FOREST], p1: { hand: ['Test Draw'], battlefield: ['Test Tomorrow'], library: ['Test Plain Bear', 'Test Island', 'Test Forest', 'Test Plain Bear', 'Test Island'] } });
    const s = resolveAll(cast(s0, 'Test Draw'));
    expect(hand(s, 'p1')).toBe(1);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1') - 1);
  });
});

// ---- Enduring Renewal -----------------------------------------------------------------------------------------------------------------------------------------------
const RENEWAL = card('Test Renewal', 'Enchantment', "If you would draw a card, reveal the top card of your library instead. If it's a creature card, put it into your graveyard. Otherwise, draw a card.");
describe('CR 614.1a, 614.5: "If you would draw a card, reveal the top card of your library instead. If it\'s a creature card, put it into your graveyard. Otherwise, draw a card."', () => {
  it('is fully automated', () => { expect(noManual(RENEWAL) && RENEWAL.automation.level === 'full').toBe(true); });
  it('a creature on top goes to the graveyard and nothing is drawn', () => {
    const s0 = scenario([], { defs: [RENEWAL, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: ['Test Renewal'], library: ['Test Plain Bear', 'Test Island'] } });
    const s = resolveAll(cast(s0, 'Test Draw'));
    expect(hand(s, 'p1')).toBe(0);
    expect(gy(s, 'p1')).toBe(2); // the spell and the creature
  });
  it('a non-creature on top is drawn, once (the draw is not replaced again, CR 614.5)', () => {
    const s0 = scenario([], { defs: [RENEWAL, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: ['Test Renewal'], library: ['Test Island', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'));
    expect(hand(s, 'p1')).toBe(1);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1') - 1);
  });
});

// ---- review additions (negative cases) ---------------------------------------------------------------------------------------------------------------------------------
describe('review: negative and edge cases', () => {
  it('Eruth: a card that was already in exile is not made playable, only the two exiled by the replacement', () => {
    const s0 = scenario([], { defs: [ERUTH, DRAW, BEAR, ISLAND, FOREST], p1: { hand: ['Test Draw'], battlefield: ['Test Eruth'], exile: ['Test Forest'], library: ['Test Island', 'Test Plain Bear', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'));
    const forest = s.zones.exile.find((id) => chars(s, id).name === 'Test Forest')!;
    expect(legal(s, 'p1', 'playLand').map((a) => a.object)).not.toContain(forest);
  });
  it('Tomorrow: with two cards in the library one of the two goes to the hand and the other stays in the library', () => {
    const s0 = scenario([], { defs: [TOMORROW, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: ['Test Tomorrow'], library: ['Test Plain Bear', 'Test Island'] } });
    for (const id of [...s0.zones.library.p1!].slice(2)) { s0.zones.library.p1!.splice(s0.zones.library.p1!.indexOf(id), 1); }
    const s = resolveAll(cast(s0, 'Test Draw'));
    expect(hand(s, 'p1')).toBe(1);
    expect(lib(s, 'p1')).toBe(1);
  });
});
