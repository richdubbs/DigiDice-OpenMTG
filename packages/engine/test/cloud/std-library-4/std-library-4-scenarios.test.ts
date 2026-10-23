/**
 * Lane std-library, round std-library-4: Ashiok, Wicked Manipulator's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 119.4, 614.1a,      "If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.":
 *   614.6                  a cost's life, an effect's payment and a Phyrexian symbol paid with life are exiled from the top of your library instead (your life total does
 *                          not change); with fewer cards in your library you pay the life; the replacement never lets you pay more life than your life total
 *                          (ruling 2023-09-01); an opponent's payment is not replaced
 *   CR 603.4, 406.1        "At the beginning of combat on your turn, if a card was put into exile this turn, put a +1/+1 counter on this creature.": only when a card
 *                          went to exile this turn
 *   CR 107.3, 202.3        "Target player exiles the top X cards of their library, where X is the total mana value of cards you own in exile."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][] }
/** Answer the decisions that come up until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const lib = (s: GameState, p: string): number => s.zones.library[p]!.length;
const exiled = (s: GameState): number => s.zones.exile.length;

const WARD = card('Test Ledger of Ash', 'Enchantment', 'If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.');
const TAP = card('Test Blood Lamp', 'Artifact', 'Pay 2 life: Draw a card.');
const IMP = card('Test Bargain Imp', 'Creature — Imp', 'When this creature enters, you may pay 3 life. If you do, draw two cards.', ['1', '1']);
const BOLT = card('Test Ichor Dart', 'Instant', 'Test Ichor Dart deals 1 damage to any target.', undefined, '{B/P}{B/P}');
const MOTE = card('Test Dust Mote', 'Artifact', '');
const defs = [WARD, TAP, IMP, BOLT, MOTE];
const motes = (n: number): string[] => Array(n).fill('Test Dust Mote') as string[];
/** Leave exactly `n` cards in the player's library (the scenario's deck fills it): the others go to their graveyard, so no exile is counted. */
function libraryOf(s: GameState, p: string, n: number): GameState {
  const libr = s.zones.library[p]!;
  const out = libr.splice(n);
  for (const id of out) {
    s.objects[id]!.zone = 'graveyard';
    s.zones.graveyard[p]!.push(id);
  }
  return s;
}

describe('CR 119.4, 614.1a, 614.6: "If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead."', () => {
  it('is automated: a replacement of the payment of life (verb payLife), while your library holds at least that many cards', () => {
    expect(full(WARD)).toBe(true);
    const j = JSON.stringify(WARD.faces);
    expect(j).toContain('"replaces":{"ev":"action","verb":"payLife","actor":"you"}');
    expect(j).toContain('"condition":{"cond":"compare","left":{"q":"zoneSize","zone":"library","of":{"ref":"you"}},"op":">=","right":{"q":"eventAmount"}}');
  });
  it('a cost: "Pay 2 life" exiles the top two cards of your library instead; your life total does not change and the ability resolves', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ledger of Ash', 'Test Blood Lamp'], library: motes(5) } });
    s = libraryOf(s, 'p1', 5);
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Blood Lamp', 'battlefield', 'p1'), ability: 'p:0:0' })));
    expect(life(s, 'p1')).toBe(20);
    expect(exiled(s)).toBe(2);
    expect(lib(s, 'p1')).toBe(5 - 2 - 1);
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
  });
  it('an effect\'s payment: "you may pay 3 life. If you do, draw two cards." exiles three cards instead, and counts as paid', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ledger of Ash'], hand: ['Test Bargain Imp'], library: motes(6) } });
    s = libraryOf(s, 'p1', 6);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bargain Imp', 'hand', 'p1') })));
    expect(life(s, 'p1')).toBe(20);
    expect(exiled(s)).toBe(3);
    expect(lib(s, 'p1')).toBe(6 - 3 - 2);
  });
  it('Phyrexian mana paid with life (CR 107.4f): each {B/P} paid with 2 life exiles two cards instead', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ledger of Ash'], hand: ['Test Ichor Dart'], library: motes(6) } });
    s = libraryOf(s, 'p1', 6);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ichor Dart', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(19);
    expect(exiled(s)).toBe(4);
  });
  it('the negative case: with fewer cards in your library than the life paid, you pay the life', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ledger of Ash', 'Test Blood Lamp'], library: motes(1) } });
    s = libraryOf(s, 'p1', 1);
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Blood Lamp', 'battlefield', 'p1'), ability: 'p:0:0' })));
    expect(life(s, 'p1')).toBe(18);
    expect(exiled(s)).toBe(0);
  });
  it('the replacement never lets you pay more life than your life total (CR 119.4; ruling 2023-09-01)', () => {
    const s = scenario([], { defs, life: 1, p1: { battlefield: ['Test Ledger of Ash', 'Test Blood Lamp'], library: motes(5) } });
    expect(() => drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Blood Lamp', 'battlefield', 'p1'), ability: 'p:0:0' }))).toThrow();
    expect(life(s, 'p1')).toBe(1);
    expect(exiled(s)).toBe(0);
  });
  it('an opponent\'s payment of life is not replaced ("you")', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ledger of Ash'], library: motes(5) }, p2: { battlefield: ['Test Blood Lamp'], library: motes(5) } });
    s = act(s, { type: 'pass', player: 'p1' });
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Blood Lamp', 'battlefield', 'p2'), ability: 'p:0:0' })));
    expect(life(s, 'p2')).toBe(18);
    expect(exiled(s)).toBe(0);
  });
});

describe('CR 603.4, 406.1: "At the beginning of combat on your turn, if a card was put into exile this turn, put a +1/+1 counter on this creature."', () => {
  const HAUNT = card('Test Dream Haunt', 'Creature — Nightmare', 'At the beginning of combat on your turn, if a card was put into exile this turn, put a +1/+1 counter on this creature.', ['1', '1']);
  const EXILER = card('Test Exile Rune', 'Sorcery', 'Exile target card from a graveyard.');
  const both = [HAUNT, EXILER, MOTE];
  /** Advance p1's turn 1 to the beginning of combat and resolve what triggers there. */
  const toCombat = (s0: GameState): GameState => {
    let s = advanceTo(s0, 1, 'beginCombat');
    for (let i = 0; i < 5 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    return s;
  };
  it('is automated, with the intervening "if" on this turn\'s exiles', () => {
    expect(full(HAUNT)).toBe(true);
    expect(JSON.stringify(HAUNT.faces)).toContain('"interveningIf":{"cond":"happened","event":{"ev":"zoneChange","subject":{"isCard":true},"to":"exile"},"scope":"turn"}');
  });
  it('a card exiled earlier this turn: the counter is put on it', () => {
    let s = scenario([], { defs: both, p1: { battlefield: ['Test Dream Haunt'], hand: ['Test Exile Rune'] }, p2: { graveyard: ['Test Dust Mote'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Exile Rune', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: find(s, 'Test Dust Mote', 'graveyard', 'p2') }]] }));
    expect(exiled(s)).toBe(1);
    s = toCombat(s);
    expect(s.objects[find(s, 'Test Dream Haunt', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(1);
  });
  it('the negative case: no card was exiled this turn, so no counter', () => {
    let s = scenario([], { defs: both, p1: { battlefield: ['Test Dream Haunt'] } });
    s = toCombat(s);
    expect(s.objects[find(s, 'Test Dream Haunt', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 107.3, 202.3: "Target player exiles the top X cards of their library, where X is the total mana value of cards you own in exile."', () => {
  const SIGIL = card('Test Hollow Sigil', 'Sorcery', 'Target player exiles the top X cards of their library, where X is the total mana value of cards you own in exile.');
  const ROCK = card('Test Gray Rock', 'Artifact', '', undefined, '{2}');
  const PEBBLE = card('Test Pebble', 'Artifact', '', undefined, '{1}');
  it('is automated; with cards of mana value 2 and 1 you own in exile (not the opponent\'s), the target exiles the top three cards', () => {
    expect(full(SIGIL)).toBe(true);
    let s = scenario([], { defs: [SIGIL, ROCK, PEBBLE, MOTE], p1: { hand: ['Test Hollow Sigil'], exile: ['Test Gray Rock', 'Test Pebble'] }, p2: { exile: ['Test Gray Rock'], library: motes(10) } });
    const before = lib(s, 'p2');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hollow Sigil', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lib(s, 'p2')).toBe(before - 3);
  });
});

