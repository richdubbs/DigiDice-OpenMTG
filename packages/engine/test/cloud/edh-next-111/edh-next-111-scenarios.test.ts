/**
 * Concept lane combat-r2 edh-next-111 (code edhn111): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design 6.10).
 * Each test is named after the rule it checks, with its negative case. CR cites are from memory (no rules text in a cloud session): unverified.
 *
 *   CR 701.17a, 608.2c            "You may put an artifact creature card or Vehicle card from among the cards milled this way into your hand." (Szarekh, the Silent King)
 *   CR 508.4, 603.6a              "Whenever a creature you control attacks or enters attacking, ..." (Arni Metalbrow)
 *   CR 202.3, 118.9, 601.2        "You may cast it without paying its mana cost if its mana value is odd. If you don't cast it, draw a card." (Yennett, Cryptic Sovereign)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const hand = (s: GameState, p: string): string[] => (s.zones.hand[p] ?? []).map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains'); // (not the Plains drawn for the turn)
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const bf = (s: GameState, p: string): string[] => (s.zones.battlefield ?? []).filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId);

interface Opts { picks?: string[][]; yes?: boolean; seen?: string[][] }
/** Answer what comes up (payment automatic, object choices from `picks` or the minimum, may questions with `yes`), until priority with the stack as given. */
function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const picks = (o.picks ??= []); // (one queue for the whole test: each question takes the next entry)
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') {
      o.seen?.push(p.options.map((id) => s.objects[id]!.defId));
      const want = picks.length > 0 ? picks.shift()! : [];
      const taken: ObjectId[] = [];
      for (const n of want) { const id = p.options.find((x) => s.objects[x]!.defId === n && !taken.includes(x)); if (id !== undefined) taken.push(id); }
      const ids = want.length > 0 ? taken : p.options.slice(0, p.min);
      s = answer(s, { kind: 'chooseObjects', ids });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [String((p.options![0] as { id: string }).id)] } as DecisionAnswer); // (the defender of a creature put in attacking, CR 508.4)
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'declareAttackers' || p.kind === 'declareBlockers') break;
    else break;
  }
  return s;
}
function drain(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 60; guard++) s = settle(pass(s), o);
  return s;
}
/** Pass until p1 declares attackers, declare them, and settle what the attack triggers did (stopping before blockers). */
function attack(s0: GameState, attackers: ObjectId[], o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  return drain(settle(s, o), o);
}
// ---- Szarekh, the Silent King ---------------------------------------------------------------------------------------------------------------------------
describe('CR 701.17a, 608.2c: "mill three cards. You may put an artifact creature card or Vehicle card from among the cards milled this way into your hand."', () => {
  const TOMB = card('Test Tombking', 'Creature — Skeleton', 'Whenever this creature attacks, mill three cards. You may put an artifact creature card or Vehicle card from among the cards milled this way into your hand.', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
  const SKIFF = card('Test Skiff', 'Artifact — Vehicle', 'Crew 1', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const RING = card('Test Ring', 'Artifact', '');
  const defs = [TOMB, GOLEM, SKIFF, BEAR, RING];
  const game = (top: string[]) => mpScenario({ defs, zones: { p1: { battlefield: ['Test Tombking'], library: ['Plains', ...top] } } }); // (the first card is the draw of the turn)
  it('is full', () => expect(full(TOMB)).toBe(true));
  it('puts the chosen artifact creature or Vehicle card milled this way into the hand; the other milled cards stay in the graveyard', () => {
    const s0 = game(['Test Golem', 'Test Skiff', 'Test Bear']);
    const seen: string[][] = [];
    const king = find(s0, 'Test Tombking', 'battlefield', 'p1');
    const s = attack(s0, [king], { picks: [['Test Golem']], seen });
    expect(hand(s, 'p1')).toEqual(['Test Golem']);
    expect([...seen[0]!].sort()).toEqual(['Test Golem', 'Test Skiff']); // the Bear (not an artifact) and nothing from the library below
    expect((s.zones.graveyard.p1 ?? []).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Skiff']);
  });
  it('negative: an artifact that is neither a creature nor a Vehicle, and a plain creature, are not offered (no choice at all)', () => {
    const s0 = game(['Test Ring', 'Test Bear', 'Test Bear']);
    const king = find(s0, 'Test Tombking', 'battlefield', 'p1');
    const s = attack(s0, [king], {});
    expect(hand(s, 'p1')).toEqual([]);
  });
});

// ---- Arni Metalbrow ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 508.4, 603.6a: "Whenever a creature you control attacks or enters attacking, ..."', () => {
  const ARNI = card('Test Warlord', 'Legendary Creature — Human Berserker', 'Whenever a creature you control attacks or enters attacking, you may pay {1}{R}. If you do, you may put a creature card with mana value less than that creature\'s mana value from your hand onto the battlefield tapped and attacking.', ['2', '2'], '{2}{R}');
  const TWO = card('Test Two', 'Creature — Goblin', '', ['2', '2'], '{1}{R}');
  const ONE = card('Test One', 'Creature — Goblin', '', ['1', '1'], '{R}');
  const MOUNTAIN = card('Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)');
  const defs = [ARNI, TWO, ONE, MOUNTAIN];
  const lands = ['Mountain', 'Mountain', 'Mountain', 'Mountain'];
  it('is full', () => expect(full(ARNI)).toBe(true));
  it('the creature put in attacking triggers it again: a 3-drop puts the 2-drop in, which puts the 1-drop in', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Warlord', ...lands], hand: ['Test Two', 'Test One'] } } });
    const seen: string[][] = [];
    const s = attack(s0, [find(s0, 'Test Warlord', 'battlefield', 'p1')], { picks: [['Test Two'], ['Test One']], seen });
    expect(bf(s, 'p1').filter((n) => n !== 'Mountain').sort()).toEqual(['Test One', 'Test Two', 'Test Warlord']);
    expect(hand(s, 'p1')).toEqual([]);
    for (const n of ['Test Two', 'Test One']) expect(s.objects[find(s, n, 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('negative: declining the payment puts nothing in', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Warlord', ...lands], hand: ['Test Two', 'Test One'] } } });
    const s = attack(s0, [find(s0, 'Test Warlord', 'battlefield', 'p1')], { yes: false, picks: [['Test Two']] });
    expect(hand(s, 'p1').sort()).toEqual(['Test One', 'Test Two']);
  });
  it('negative: a creature that merely enters (cast in a main phase, not attacking) does not trigger it', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Warlord', ...lands], hand: ['Test Two', 'Test One'] } } });
    const s = drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test One', 'hand', 'p1') } as never)));
    expect(bf(s, 'p1')).toContain('Test One');
    expect(s.log.some((l) => /Test Warlord triggers/.test(l.text))).toBe(false);
  });
});

// ---- Yennett, Cryptic Sovereign ---------------------------------------------------------------------------------------------------------------------------
describe('CR 202.3, 118.9, 601.2: "You may cast it without paying its mana cost if its mana value is odd. If you don\'t cast it, draw a card."', () => {
  const YEN = card('Test Sovereign', 'Legendary Creature — Human', 'Whenever this creature attacks, reveal the top card of your library. You may cast it without paying its mana cost if its mana value is odd. If you don\'t cast it, draw a card.', ['2', '2']);
  const ODD = card('Test Odd', 'Creature — Goblin', '', ['3', '3'], '{2}{R}');
  const EVEN = card('Test Even', 'Creature — Goblin', '', ['2', '2'], '{1}{R}');
  const defs = [YEN, ODD, EVEN];
  const game = (top: string) => mpScenario({ defs, zones: { p1: { battlefield: ['Test Sovereign'], library: ['Plains', top, 'Plains', 'Plains'] } } });
  const run = (top: string, o: Opts = {}) => { const s0 = game(top); return { s0, s: attack(s0, [find(s0, 'Test Sovereign', 'battlefield', 'p1')], o) }; };
  it('is full', () => expect(full(YEN)).toBe(true));
  it('odd mana value: it may be cast free (and nothing is drawn)', () => {
    const { s0, s } = run('Test Odd');
    expect(bf(s, 'p1')).toContain('Test Odd');
    expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length);
  });
  it('odd mana value, the cast declined: the card is drawn instead', () => {
    const { s } = run('Test Odd', { yes: false });
    expect(bf(s, 'p1')).not.toContain('Test Odd');
    expect(hand(s, 'p1')).toContain('Test Odd');
  });
  it('negative: even mana value: it cannot be cast free, so you draw it', () => {
    const { s } = run('Test Even');
    expect(bf(s, 'p1')).not.toContain('Test Even');
    expect(hand(s, 'p1')).toContain('Test Even');
  });
});
