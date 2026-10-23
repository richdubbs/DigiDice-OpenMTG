/**
 * CLOUD C6 (per-player instructions and their results), played through the engine in 3-player Free-for-All games (CR 806) with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10). Alice (p1) is the active player, so APNAP order is Alice, Bob, Carol (CR 101.4).
 *
 *   CR 101.3          the part of an instruction that is impossible is ignored; "each opponent who can't" says what happens instead
 *   CR 101.4, 608.2e  several players: the choices are made in APNAP order, then the actions happen at the same time
 *   CR 608.2c         a later instruction reads the results of an earlier one ("chosen this way")
 *   CR 109.4          "controls the most": the permanents a player controls; every player tied for it
 *   CR 701.21a        sacrifice: only a permanent its controller controls
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, lifeOf, mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manualOf = (d: CardDef): string[] => [...d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text), ...(JSON.stringify(d.faces).includes('"op":"manual"') ? ['a manual step'] : [])];

// shape 1: "each opponent who can't"
const BREAK = card('Test Break', 'Sorcery', "Each opponent sacrifices a creature of their choice. Each opponent who can't discards a card.");
const SQUEEZE = card('Test Squeeze', 'Sorcery', "Each opponent discards a card. For each opponent who can't, you draw a card.");
const DRAIN = card('Test Drain', 'Sorcery', "Each opponent discards a card. Each opponent who can't loses 3 life.");
const TOLL = card('Test Toll', 'Sorcery', "Each player sacrifices an artifact of their choice. Each player who can't loses 2 life.");
// shape 2: the choosing player of a group in the filter
const CRUSH = card('Test Crush', 'Sorcery', 'Each opponent sacrifices a creature with the greatest power among creatures they control.');
// shape 3: "each player who controls the most / the fewest"
const CENSUS = card('Test Census', 'Sorcery', 'Each player who controls the most creatures investigates.');
const RELIEF = card('Test Relief', 'Sorcery', 'Each player who controls the fewest lands gains 3 life.');
// shape 4: a choice for each player and what it chose
const SPARE = card('Test Spare', 'Sorcery', 'For each player, choose a creature with power 2 or less that player controls. Then destroy all creatures except creatures chosen this way.');
const HUNT = card('Test Hunt', 'Sorcery', 'For each opponent, choose a creature with the greatest power among creatures that player controls. Destroy those creatures.');
const KEEP = card('Test Keep', 'Sorcery', 'For each player, choose an artifact that player controls. Each player sacrifices all artifacts they control not chosen this way.');

const ONE = card('Test One', 'Creature — Bear', '', { pt: ['1', '1'] });
const TWO = card('Test Two', 'Creature — Bear', '', { pt: ['2', '2'] });
const THREE = card('Test Three', 'Creature — Giant', '', { pt: ['3', '3'] });
const FIVE = card('Test Five', 'Creature — Giant', '', { pt: ['5', '5'] });
const ROD = card('Test Rod', 'Artifact', '');
const CUP = card('Test Cup', 'Artifact', '');
const SPELLS = [BREAK, SQUEEZE, DRAIN, TOLL, CRUSH, CENSUS, RELIEF, SPARE, HUNT, KEEP];
const DEFS = [...SPELLS, ONE, TWO, THREE, FIVE, ROD, CUP];

type Z = Partial<Record<'hand' | 'battlefield' | 'graveyard', string[]>>;
const game = (spell: string, zones: Partial<Record<PlayerId, Z>>): GameState =>
  mpScenario({ players: 3, defs: DEFS, zones: { ...zones, p1: { ...(zones.p1 ?? {}), hand: [spell, ...(zones.p1?.hand ?? [])] } } });

/** Alice casts `name`; every decision is answered by `pick` (or the first options) and recorded as [player, kind]. */
function cast(s0: GameState, name: string, pick: (s: GameState) => DecisionAnswer | undefined = () => undefined): { s: GameState; asked: [string, string][] } {
  const asked: [string, string][] = [];
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 400 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
    if (t.pending?.kind === 'priority') { t = act(t, { type: 'pass', player: t.pending.player }); continue; }
    const p = t.pending!;
    if (p.kind === 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
    asked.push([p.player, p.kind]);
    const a = pick(t) ?? (p.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: p.options.slice(0, p.min) } : undefined);
    if (a === undefined) throw new Error(`no answer for ${p.kind}: ${p.prompt}`);
    t = answer(t, a);
  }
  return { s: resolveStack(t), asked };
}

const names = (s: GameState, p: PlayerId, zone: 'battlefield' | 'graveyard' | 'hand'): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p) : s.zones[zone][p]!).map((id) => s.defs[s.objects[id]!.defId]!.name).filter((n) => n !== 'Plains').sort();
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const clues = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && /Clue/.test(JSON.stringify(s.objects[id]!))).length;

describe('design 6.9: the C6 test cards compile to data, nothing manual', () => {
  it('no manual ability or step', () => {
    for (const d of SPELLS) expect(manualOf(d), d.name).toEqual([]);
  });
});

describe('CR 101.3, 608.2e: "Each opponent sacrifices a creature of their choice. Each opponent who can\'t discards a card."', () => {
  it('Bob sacrifices; Carol controls no creature, so she discards; Alice (not an opponent) does neither', () => {
    const s0 = game('Test Break', { p1: { battlefield: ['Test One'], hand: ['Test Rod'] }, p2: { battlefield: ['Test Two'], hand: ['Test Cup'] }, p3: { hand: ['Test Rod'] } });
    const { s } = cast(s0, 'Test Break');
    expect(names(s, 'p2', 'graveyard')).toEqual(['Test Two']);
    expect(handSize(s, 'p2')).toBe(1);
    expect(names(s, 'p3', 'graveyard')).toEqual(['Test Rod']);
    expect(handSize(s, 'p3')).toBe(0);
    expect(names(s, 'p1', 'battlefield')).toEqual(['Test One']);
  });
  it('APNAP (CR 101.4): Bob chooses his creature before Carol chooses hers; both sacrifice and nobody discards', () => {
    const s0 = game('Test Break', { p2: { battlefield: ['Test One', 'Test Two'], hand: ['Test Cup'] }, p3: { battlefield: ['Test Three', 'Test Five'], hand: ['Test Rod'] } });
    const { s, asked } = cast(s0, 'Test Break');
    expect(asked).toEqual([['p2', 'chooseObjects'], ['p3', 'chooseObjects']]);
    expect(names(s, 'p2', 'battlefield')).toHaveLength(1);
    expect(names(s, 'p3', 'battlefield')).toHaveLength(1);
    expect(handSize(s, 'p2') + handSize(s, 'p3')).toBe(2);
  });
});

describe('CR 101.3: "Each opponent discards a card. For each opponent who can\'t, you draw a card."', () => {
  it('Bob discards; Carol has no card in hand, so Alice draws one card', () => {
    const s0 = game('Test Squeeze', { p2: { hand: ['Test Cup'] } });
    const before = handSize(s0, 'p1');
    const { s } = cast(s0, 'Test Squeeze');
    expect(names(s, 'p2', 'graveyard')).toEqual(['Test Cup']);
    expect(handSize(s, 'p1')).toBe(before - 1 + 1); // the spell left the hand, one card drawn
  });
  it('neither opponent can discard: Alice draws two cards', () => {
    const s0 = game('Test Squeeze', {});
    const before = handSize(s0, 'p1');
    const { s } = cast(s0, 'Test Squeeze');
    expect(handSize(s, 'p1')).toBe(before - 1 + 2);
  });
});

describe('CR 101.3: "Each opponent discards a card. Each opponent who can\'t loses 3 life."', () => {
  it('only the opponent with an empty hand loses life', () => {
    const s0 = game('Test Drain', { p3: { hand: ['Test Cup'] } });
    const { s } = cast(s0, 'Test Drain');
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe('CR 101.3, 701.21a: "Each player sacrifices an artifact of their choice. Each player who can\'t loses 2 life."', () => {
  it('each player without an artifact loses 2 life, the caster included', () => {
    const s0 = game('Test Toll', { p2: { battlefield: ['Test Rod'] } });
    const { s } = cast(s0, 'Test Toll');
    expect(names(s, 'p2', 'graveyard')).toEqual(['Test Rod']);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([lifeOf(s0, 'p1') - 2, lifeOf(s0, 'p2'), lifeOf(s0, 'p3') - 2]);
  });
});

describe('CR 608.2e, 101.4: "Each opponent sacrifices a creature with the greatest power among creatures they control."', () => {
  it('each opponent sacrifices their own greatest-power creature; Alice\'s bigger creature is no part of either set', () => {
    const s0 = game('Test Crush', { p1: { battlefield: ['Test Five'] }, p2: { battlefield: ['Test One', 'Test Three'] }, p3: { battlefield: ['Test Two', 'Test One'] } });
    const { s, asked } = cast(s0, 'Test Crush');
    expect(asked).toEqual([]); // one greatest creature each: no choice to make (CR 608.2d)
    expect(names(s, 'p2', 'battlefield')).toEqual(['Test One']);
    expect(names(s, 'p3', 'battlefield')).toEqual(['Test One']);
    expect(names(s, 'p1', 'battlefield')).toEqual(['Test Five']);
  });
  it('ties: Bob chooses between his two tied creatures, then Carol between hers (APNAP)', () => {
    const s0 = game('Test Crush', { p2: { battlefield: ['Test Three', 'Test Three', 'Test One'] }, p3: { battlefield: ['Test Two', 'Test Two'] } });
    const { s, asked } = cast(s0, 'Test Crush');
    expect(asked).toEqual([['p2', 'chooseObjects'], ['p3', 'chooseObjects']]);
    expect(names(s, 'p2', 'battlefield')).toEqual(['Test One', 'Test Three']);
    expect(names(s, 'p3', 'battlefield')).toEqual(['Test Two']);
  });
});

describe('CR 109.4: "each player who controls the most creatures" / "the fewest lands"', () => {
  it('every player tied for the most creatures investigates, the others do not', () => {
    const s0 = game('Test Census', { p1: { battlefield: ['Test One', 'Test Two'] }, p2: { battlefield: ['Test One', 'Test Three'] }, p3: { battlefield: ['Test Five'] } });
    const { s } = cast(s0, 'Test Census');
    expect([clues(s, 'p1'), clues(s, 'p2'), clues(s, 'p3')]).toEqual([1, 1, 0]);
  });
  it('the fewest lands: only that player gains life (lands counted per controller, CR 109.4)', () => {
    const s0 = game('Test Relief', { p1: { battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains'] }, p3: { battlefield: ['Plains', 'Plains'] } });
    const { s } = cast(s0, 'Test Relief');
    expect([lifeOf(s, 'p1') - lifeOf(s0, 'p1'), lifeOf(s, 'p2') - lifeOf(s0, 'p2'), lifeOf(s, 'p3') - lifeOf(s0, 'p3')]).toEqual([0, 3, 0]);
  });
  it('nobody controls a creature: every player is tied for the most, so each investigates', () => {
    const s0 = game('Test Census', {});
    const { s } = cast(s0, 'Test Census');
    expect([clues(s, 'p1'), clues(s, 'p2'), clues(s, 'p3')]).toEqual([1, 1, 1]);
  });
});

describe('CR 608.2c, 101.4: "For each player, choose a creature with power 2 or less that player controls. Then destroy all creatures except creatures chosen this way."', () => {
  it('Alice chooses for Alice, Bob and Carol in APNAP order; only the chosen creatures survive', () => {
    const s0 = game('Test Spare', { p1: { battlefield: ['Test Two', 'Test Five'] }, p2: { battlefield: ['Test One', 'Test Two', 'Test Three'] }, p3: { battlefield: ['Test Three'] } });
    const bobsOne = find(s0, 'Test One', 'battlefield', 'p2');
    const { s, asked } = cast(s0, 'Test Spare', (t) => (t.pending?.kind === 'chooseObjects' && t.pending.options.includes(bobsOne) ? { kind: 'chooseObjects', ids: [bobsOne] } : undefined));
    // Alice has one creature with power 2 or less (no choice), Bob two (Alice chooses), Carol none
    expect(asked).toEqual([['p1', 'chooseObjects']]);
    expect(names(s, 'p1', 'battlefield')).toEqual(['Test Two']);
    expect(names(s, 'p2', 'battlefield')).toEqual(['Test One']);
    expect(names(s, 'p3', 'battlefield')).toEqual([]);
  });
});

describe('CR 608.2c: "For each opponent, choose a creature with the greatest power among creatures that player controls. Destroy those creatures."', () => {
  it('each opponent\'s greatest creature is destroyed; Alice\'s creatures are not chosen', () => {
    const s0 = game('Test Hunt', { p1: { battlefield: ['Test Five'] }, p2: { battlefield: ['Test One', 'Test Three'] }, p3: { battlefield: ['Test Two'] } });
    const { s } = cast(s0, 'Test Hunt');
    expect(names(s, 'p1', 'battlefield')).toEqual(['Test Five']);
    expect(names(s, 'p2', 'battlefield')).toEqual(['Test One']);
    expect(names(s, 'p3', 'battlefield')).toEqual([]);
  });
});

describe('CR 608.2c, 701.21a: "For each player, choose an artifact that player controls. Each player sacrifices all artifacts they control not chosen this way."', () => {
  it('each player keeps the one artifact chosen for them', () => {
    const s0 = game('Test Keep', { p1: { battlefield: ['Test Rod', 'Test Cup'] }, p2: { battlefield: ['Test Rod'] }, p3: { battlefield: ['Test Cup', 'Test Cup'] } });
    const rod = find(s0, 'Test Rod', 'battlefield', 'p1');
    const carols = findAll(s0, 'Test Cup', 'battlefield', 'p3');
    const { s, asked } = cast(s0, 'Test Keep', (t) => {
      if (t.pending?.kind !== 'chooseObjects') return undefined;
      return { kind: 'chooseObjects', ids: [t.pending.options.includes(rod) ? rod : carols[1]!] };
    });
    expect(asked).toEqual([['p1', 'chooseObjects'], ['p1', 'chooseObjects']]); // Alice chooses for herself, then for Carol (Bob has one artifact)
    expect(names(s, 'p1', 'battlefield')).toEqual(['Test Rod']);
    expect(names(s, 'p2', 'battlefield')).toEqual(['Test Rod']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p3')).toEqual([carols[1]]);
  });
});
