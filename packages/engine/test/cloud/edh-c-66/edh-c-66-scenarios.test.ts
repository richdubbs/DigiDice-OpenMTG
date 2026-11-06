/**
 * Commander lane edh-c, round edh-c-66: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.23a, 701.23b, 406.3   "Search target player's library for up to X cards, where X is ..., and exile them. Then that player shuffles."
 *   CR 701.20a, 701.24a          "Reveal cards ... until you reveal a land card. Put that card onto the battlefield and shuffle the rest into your library." / "... into your graveyard."
 *   CR 608.2c                    "Draw a card, then discard a card unless <condition>."
 *   CR 202.3, 601.2i, 603.2      "Whenever you cast a spell, destroy all permanents with that spell's mana value."
 *   CR 120.3, 608.2c             "~ deals 3 damage to target creature. ~ also deals 2 damage to that creature's controller if <condition>."
 *   CR 603.4, 303.4, 608.2c      "When ~ enters, if enchanted permanent is tapped, untap it."
 *   CR 402.3                     "Players play with their hands revealed."
 *   CR 402.2                     "The chosen player's maximum hand size is four."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { canSee } from '../../../src/core/view';
import { maxHandSize } from '../../../src/statics/hooks';
import { act, answer, find, pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
type Zone = 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile';
const names = (s: GameState, name: string, zone: Zone = 'battlefield'): ObjectId[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && s.defs[o.defId]?.name === name).map((o) => o.id);
const byName = (s: GameState, name: string, zone: Zone = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SWAMP = card('Test Swamp', 'Basic Land — Swamp', '');
const ISLAND = card('Test Island', 'Basic Land — Island', '');
const INCURSION = card('Test Incursion', 'Sorcery', "Search target player's library for up to X cards, where X is the number of Swamps you control, and exile them. Then that player shuffles.");
const WIND = card('Test Wind', 'Instant', "Search target player's library for up to seven cards and exile them. Then that player shuffles.");
const DIG_BF = card('Test Dig Battlefield', 'Sorcery', 'Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield and shuffle the rest into your library.');
const DIG_GY = card('Test Dig Graveyard', 'Sorcery', 'You may reveal cards from the top of your library until you reveal a land card. If you do, put that card onto the battlefield and put all other cards revealed this way into your graveyard.');
const LOOTER = card('Test Looter', 'Creature — Wizard', 'When ~ enters, draw a card, then discard a card unless you control another Wizard.', ['1', '1']);
const WIZARD = card('Test Wizard', 'Creature — Wizard', '', ['1', '1']);
const KIRIN = card('Test Kirin', 'Creature — Spirit', "Whenever you cast a Spirit or Arcane spell, destroy all permanents with that spell's mana value.", ['2', '2'], '{5}');
const ARCANE_FREE = card('Test Free Arcane', 'Instant — Arcane', 'You gain 1 life.');
const PILOT = card('Test Pilot', 'Creature — Bear', 'As an additional cost to cast ~, you may pay 2 life.\nWhen ~ enters, draw a card, then discard a card unless ~\'s additional cost was paid.', ['1', '1']);
const SPIRIT_FREE = card('Test Free Spirit', 'Creature — Spirit', '', ['1', '1']);
const FLARE = card('Test Flare', 'Instant', "~ deals 3 damage to target creature or planeswalker. ~ also deals 2 damage to that permanent's controller if you control a modified creature.");
const REINS = card('Test Reins', 'Enchantment — Aura', 'Enchant permanent\nWhen ~ enters, if enchanted permanent is tapped, untap it.\nYou control enchanted permanent.');
const REVEAL = card('Test Revelation', 'Enchantment', 'Players play with their hands revealed.');
const RACK = card('Test Rack', 'Artifact', "As ~ enters, choose an opponent.\nThe chosen player's maximum hand size is four.");

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [INCURSION, WIND, DIG_BF, DIG_GY, LOOTER, PILOT, KIRIN, FLARE, REINS, REVEAL, RACK, ARCANE_FREE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.23a, 701.23b, 406.3: "Search target player\'s library for up to X cards, where X is the number of Swamps you control, and exile them."', () => {
  const game = () => mpScenario({ players: 3, defs: [INCURSION, SWAMP, BEAR], zones: { p1: { hand: ['Test Incursion'], battlefield: ['Test Swamp', 'Test Swamp'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
  it('you may exile up to as many cards of the target\'s library as you control Swamps (two here), and no other library changes', () => {
    const s0 = game();
    const bears = names(s0, 'Test Bear', 'library');
    const s = cast(s0, 'Test Incursion', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: bears.slice(0, 2) }] });
    expect(names(s, 'Test Bear', 'exile').length).toBe(2);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length - 2);
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length);
  });
  it('more cards than Swamps is refused, and fewer (even none) is allowed: a search is not required to find cards', () => {
    const s0 = game();
    expect(() => cast(s0, 'Test Incursion', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: names(s0, 'Test Bear', 'library').slice(0, 3) }] })).toThrow();
    const s = cast(game(), 'Test Incursion', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [] }] });
    expect(names(s, 'Test Bear', 'exile').length).toBe(0);
  });
});

describe('CR 701.23b: "Search target player\'s library for up to seven cards and exile them."', () => {
  it('exiles the cards you find (here three), face up, from that library', () => {
    const s0 = mpScenario({ players: 3, defs: [WIND, BEAR], zones: { p1: { hand: ['Test Wind'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
    const s = cast(s0, 'Test Wind', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: names(s0, 'Test Bear', 'library') }] });
    expect(names(s, 'Test Bear', 'exile').length).toBe(3);
    expect(names(s, 'Test Bear', 'library').length).toBe(0);
  });
});

describe('CR 701.20a, 701.24a: "Reveal cards ... until you reveal a land card. Put that card onto the battlefield and shuffle the rest into your library."', () => {
  it('the first land revealed goes onto the battlefield; the other revealed cards stay in the library (shuffled); the land is not found twice', () => {
    const base = mpScenario({ players: 3, defs: [DIG_BF, BEAR, SWAMP], zones: { p1: { hand: ['Test Dig Battlefield'], library: ['Plains', 'Test Bear', 'Test Bear', 'Test Swamp', 'Test Swamp'] } } });
    const s0 = base; // (the first card is drawn in the draw step)
    const s = cast(s0, 'Test Dig Battlefield');
    expect(names(s, 'Test Swamp').length).toBe(1);
    expect(names(s, 'Test Swamp', 'library').length).toBe(1);
    expect(names(s, 'Test Bear', 'library').length).toBe(2);
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length - 1);
  });
});

describe('CR 701.20a, 608.2c: "... put that card onto the battlefield and put all other cards revealed this way into your graveyard."', () => {
  const game = () => mpScenario({ players: 3, defs: [DIG_GY, BEAR, SWAMP], zones: { p1: { hand: ['Test Dig Graveyard'], library: ['Plains', 'Test Bear', 'Test Bear', 'Test Swamp', 'Test Bear'] } } });
  it('the land goes onto the battlefield and the other revealed cards (two creatures) go to the graveyard; the card below the land stays in the library', () => {
    const s = cast(game(), 'Test Dig Graveyard', { answers: [{ kind: 'yesNo', yes: true }] });
    expect(names(s, 'Test Swamp').length).toBe(1);
    expect(names(s, 'Test Bear', 'graveyard').length).toBe(2);
    expect(names(s, 'Test Bear', 'library').length).toBe(1);
  });
  it('declining the "may" reveals nothing: no card moves', () => {
    const s = cast(game(), 'Test Dig Graveyard', { answers: [{ kind: 'yesNo', yes: false }] });
    expect(names(s, 'Test Swamp').length).toBe(0);
    expect(names(s, 'Test Bear', 'graveyard').length).toBe(0);
  });
});

describe('CR 608.2c: "When ~ enters, draw a card, then discard a card unless you control another Wizard."', () => {
  it('without another Wizard you draw and then discard (hand size unchanged by the trigger)', () => {
    const s0 = mpScenario({ players: 3, defs: [LOOTER, ISLAND], zones: { p1: { hand: ['Test Looter'], library: ['Plains', 'Test Island'] } } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Looter', 'hand', 'p1') } as never), {});
    s = drain(s, { answers: [] });
    const ask = s.pending as { kind: string; options: ObjectId[] };
    expect(ask.kind).toBe('chooseObjects');
    s = drain(answer(s, { kind: 'chooseObjects', ids: [ask.options.find((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Island')!] }), {});
    expect(s.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length - 1);
    expect(names(s, 'Test Island', 'graveyard').length).toBe(1);
  });
  it('with another Wizard you draw and keep the card (negative: nothing is discarded)', () => {
    const s0 = mpScenario({ players: 3, defs: [LOOTER, WIZARD, ISLAND], zones: { p1: { hand: ['Test Looter'], battlefield: ['Test Wizard'], library: ['Plains', 'Test Island'] } } });
    const s = cast(s0, 'Test Looter');
    expect(s.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length); // cast -1, draw +1
    expect(names(s, 'Test Island', 'hand').length).toBe(1);
  });
});

describe('CR 202.3, 601.2i, 603.2: "Whenever you cast a Spirit or Arcane spell, destroy all permanents with that spell\'s mana value."', () => {
  const game = () => mpScenario({ players: 3, defs: [KIRIN, SPIRIT_FREE, BEAR, SWAMP], zones: { p1: { battlefield: ['Test Kirin', 'Test Bear', 'Test Swamp'], hand: ['Test Free Spirit'] }, p2: { battlefield: ['Test Swamp'] } } });
  it('a mana value 0 spell destroys every permanent with mana value 0 (any controller), keeps the Kirin (mana value 5)', () => {
    const s = cast(game(), 'Test Free Spirit');
    expect(names(s, 'Test Swamp').length).toBe(0);
    expect(names(s, 'Test Kirin').length).toBe(1);
    expect(names(s, 'Test Bear').length).toBe(0); // a {0} creature too: same mana value as the spell
  });
  it('a spell that is neither a Spirit nor an Arcane spell does not trigger it', () => {
    const s0 = mpScenario({ players: 3, defs: [KIRIN, BEAR, SWAMP], zones: { p1: { battlefield: ['Test Kirin', 'Test Swamp'], hand: ['Test Bear'] } } });
    const s = cast(s0, 'Test Bear');
    expect(names(s, 'Test Swamp').length).toBe(1);
  });
});

describe('CR 608.2c, 118.8, 601.2b: "When ~ enters, draw a card, then discard a card unless ~\'s additional cost was paid." (optional additional cost)', () => {
  const game = () => mpScenario({ players: 3, defs: [PILOT, ISLAND], zones: { p1: { hand: ['Test Pilot'], library: ['Plains', 'Test Island'] } } });
  it('with the additional cost paid (2 life) nothing is discarded; without it the drawn card must be discarded', () => {
    const s0 = game();
    const paid = cast(s0, 'Test Pilot', { answers: [{ kind: 'yesNo', yes: true }] });
    expect(lifeOf(paid, 'p1')).toBe(lifeOf(s0, 'p1') - 2);
    expect(paid.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length); // cast -1, draw +1
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pilot', 'hand', 'p1') } as never), { answers: [{ kind: 'yesNo', yes: false }] });
    s = drain(s, { answers: [] });
    const ask = s.pending as { kind: string; options: ObjectId[] };
    expect(ask.kind).toBe('chooseObjects');
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe('CR 205.3m, 202.3: "Whenever you cast a Spirit or Arcane spell": an Arcane spell that is not a Spirit also triggers', () => {
  it('an Arcane instant destroys the mana value 0 permanents', () => {
    const s0 = mpScenario({ players: 3, defs: [KIRIN, ARCANE_FREE, SWAMP], zones: { p1: { battlefield: ['Test Kirin', 'Test Swamp'], hand: ['Test Free Arcane'] } } });
    const s = cast(s0, 'Test Free Arcane');
    expect(names(s, 'Test Swamp').length).toBe(0);
  });
});

describe('CR 120.3, 608.2c: "~ deals 3 damage to target creature or planeswalker. ~ also deals 2 damage to that permanent\'s controller if you control a modified creature."', () => {
  const game = (counter: boolean) => mpScenario({ players: 3, defs: [FLARE, BEAR], zones: { p1: { hand: ['Test Flare'], battlefield: [counter ? { name: 'Test Bear', counters: { '+1/+1': 1 } } : 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('with a creature that has a counter (modified) the destroyed creature\'s controller also takes 2', () => {
    const s0 = game(true);
    const target = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Flare', { targets: [[obj(target)]] });
    expect(names(s, 'Test Bear').length).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 2);
  });
  it('without a modified creature the controller takes nothing (negative)', () => {
    const s0 = game(false);
    const s = cast(s0, 'Test Flare', { targets: [[obj(byName(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
  });
});

describe('CR 603.4, 303.4, 608.2c: "When ~ enters, if enchanted permanent is tapped, untap it."', () => {
  const game = (tapped: boolean) => mpScenario({ players: 3, defs: [REINS, BEAR], zones: { p1: { hand: ['Test Reins'], battlefield: [{ name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Bear', tapped }] } } });
  it('a tapped enchanted permanent is untapped (and you control it); your own tapped creature stays tapped: "it" is the enchanted permanent, not the Aura or another creature', () => {
    const s0 = game(true);
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const mine = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Reins', { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]!.tapped).toBe(false);
    expect(s.objects[mine]!.tapped).toBe(true);
  });
  it('an untapped enchanted permanent stays untapped (negative: the intervening if is false)', () => {
    const s0 = game(false);
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Reins', { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]!.tapped).toBe(false);
  });
});

describe('CR 402.3, 604.1: "Players play with their hands revealed."', () => {
  it('every player\'s hand is seen by every player while it is on the battlefield; without it hands are hidden', () => {
    const s = mpScenario({ players: 3, defs: [REVEAL, BEAR], zones: { p1: { battlefield: ['Test Revelation'], hand: ['Test Bear'] }, p2: { hand: ['Test Bear'] } } });
    const mine = s.objects[find(s, 'Test Bear', 'hand', 'p1')]!;
    const theirs = s.objects[find(s, 'Test Bear', 'hand', 'p2')]!;
    for (const viewer of ['p1', 'p2', 'p3']) { expect(canSee(s, mine, viewer), viewer).toBe(true); expect(canSee(s, theirs, viewer), viewer).toBe(true); }
    const none = mpScenario({ players: 3, defs: [BEAR], zones: { p1: { hand: ['Test Bear'] } } });
    expect(canSee(none, none.objects[find(none, 'Test Bear', 'hand', 'p1')]!, 'p2')).toBe(false);
  });
});

describe('CR 402.2, 614.12: "As ~ enters, choose an opponent. The chosen player\'s maximum hand size is four."', () => {
  it('only the chosen opponent has the smaller maximum hand size', () => {
    const s0 = mpScenario({ players: 3, defs: [RACK], zones: { p1: { hand: ['Test Rack'] } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rack', 'hand', 'p1') } as never);
    for (let i = 0; i < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0 || s.pending.player !== 'p1' || !names(s, 'Test Rack').length); i++) {
      const p = s.pending!;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'priority') s = pass(s);
      else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['p2'] } as never);
      else break;
    }
    expect(names(s, 'Test Rack').length).toBe(1);
    expect(maxHandSize(s, 'p2')).toBe(4);
    expect(maxHandSize(s, 'p3')).toBe(7);
    expect(maxHandSize(s, 'p1')).toBe(7);
  });
});
