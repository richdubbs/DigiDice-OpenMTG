/**
 * FAST5 T52 (delirium-style "N or more card types among cards in your graveyard", CR 205.2a): the templates of parser/templates/zz-fast5/t52.json and the
 * renderer and lowering support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 205.2a, 611.3a, 613.4c, 613.1f  "As long as there are four or more card types among cards in your graveyard, Insects and Spiders you control get +1/+1
 *                                      and have deathtouch": a static ability that turns on and off with the graveyard
 *   CR 402.2, 514.1, 604.1             "each opponent's maximum hand size is equal to seven minus the number of those card types"
 *   CR 121.1, 107.3, 608.2h            "Then draw X cards, where X is the number of card types among cards in your graveyard" (counted as the draw happens)
 *   CR 700.2, 601.2b                   "Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead."
 *   CR 701.10e, 122.1, 608.2c          "Then if there are six or more card types ..., double the number of +1/+1 counters on those creatures"
 *   CR 701.13a, 107.3                  "Exile the top X cards of your library, where X is the number of card types among other nonland permanents you control"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { maxHandSize } from '../../../src/statics/hooks';
import { act, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** Nothing is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const librarySize = (s: GameState, p: string): number => s.zones.library[p]!.length;

/** Answer the decisions that come up (payments automatic, `targets` when asked, the first `options` entry for a choice); stop at priority. */
interface Script { targets?: TargetChoice[][]; options?: string[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], options: [...(script.options ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), script);
  return s;
}
function activate(s: GameState, name: string): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana)[0];
  if (!la) throw new Error(`no activated ability of ${name}`);
  return resolveAll(drive(act(s, la.action)));
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const INSECT = card('Test Beetle', 'Creature — Insect', '', ['1', '1']);
const SPIDER = card('Test Weaver', 'Creature — Spider', '', ['2', '2']);
const SORCERY = card('Test Sorcery', 'Sorcery', 'Draw a card.');
const INSTANT = card('Test Instant', 'Instant', 'Draw a card.');
const TRINKET = card('Test Trinket', 'Artifact', '');
const SHRINE = card('Test Shrine', 'Enchantment', '');
const WALKER = card('Test Walker', 'Planeswalker — Test', '');
/** A graveyard with exactly `n` card types (Land, Creature, Sorcery, Artifact, Instant, Enchantment, in this order). */
const GRAVE = ['Forest', 'Test Bear', 'Test Sorcery', 'Test Trinket', 'Test Instant', 'Test Shrine'];
const grave = (n: number): string[] => GRAVE.slice(0, n);
const ALL = [BEAR, INSECT, SPIDER, SORCERY, INSTANT, TRINKET, SHRINE, WALKER];

describe('CR 205.2a, 611.3a, 613.4c: "As long as there are four or more card types among cards in your graveyard, Insects and Spiders you control get +1/+1 and have deathtouch."', () => {
  const HIVE = card('Test Hive', 'Artifact', 'As long as there are four or more card types among cards in your graveyard, Insects and Spiders you control get +1/+1 and have deathtouch.');

  it('is understood: the hive is a full card', () => {
    expect(full(HIVE)).toBe(true);
  });

  it('CR 205.2a: three card types in the graveyard do nothing; the fourth turns it on for Insects and Spiders you control, and only for them', () => {
    const board = { battlefield: ['Test Hive', 'Test Beetle', 'Test Weaver', 'Test Bear'], graveyard: grave(3) };
    const off = scenario(['Forest'], { defs: [HIVE, ...ALL], p1: board, p2: { battlefield: ['Test Beetle'] } });
    const beetle = find(off, 'Test Beetle', 'battlefield', 'p1');
    const weaver = find(off, 'Test Weaver', 'battlefield', 'p1');
    const bear = find(off, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(off, 'Test Beetle', 'battlefield', 'p2');
    expect([pt(off, beetle), pt(off, weaver), pt(off, bear)]).toEqual(['1/1', '2/2', '2/2']);
    expect(hasKeyword(getChars(off, beetle)!, 'deathtouch')).toBe(false);
    const on = tweak(off, (t) => { put(t, 'p1', 'graveyard', 'Test Trinket'); });
    expect([pt(on, beetle), pt(on, weaver), pt(on, bear), pt(on, theirs)]).toEqual(['2/2', '3/3', '2/2', '1/1']);
    expect(hasKeyword(getChars(on, beetle)!, 'deathtouch')).toBe(true);
    expect(hasKeyword(getChars(on, weaver)!, 'deathtouch')).toBe(true);
    expect(hasKeyword(getChars(on, bear)!, 'deathtouch')).toBe(false);
    expect(hasKeyword(getChars(on, theirs)!, 'deathtouch')).toBe(false);
  });

  it('CR 205.2a: only the types count, not the cards: ten lands are one card type', () => {
    const s = scenario(['Forest'], { defs: [HIVE, ...ALL], p1: { battlefield: ['Test Hive', 'Test Beetle'], graveyard: Array(10).fill('Forest') as string[] } });
    expect(pt(s, find(s, 'Test Beetle', 'battlefield'))).toBe('1/1');
  });

  it("CR 205.2a: the opponent's graveyard is not \"your graveyard\"", () => {
    const s = scenario(['Forest'], { defs: [HIVE, ...ALL], p1: { battlefield: ['Test Hive', 'Test Beetle'] }, p2: { graveyard: grave(5) } });
    expect(pt(s, find(s, 'Test Beetle', 'battlefield'))).toBe('1/1');
  });
});

describe('CR 402.2, 514.1: "each opponent\'s maximum hand size is equal to seven minus the number of those card types"', () => {
  const GUIDE = card('Test Guide', 'Creature — Human', "As long as there are four or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven minus the number of those card types.", ['1', '1']);

  it('is understood: the guide is a full card', () => {
    expect(full(GUIDE)).toBe(true);
  });

  it('CR 402.2: seven with fewer than four types; with four, three; with five, two; with six, one; only the opponents', () => {
    const sizes = [0, 3, 4, 5, 6].map((n) => {
      const s = scenario(['Forest'], { defs: [GUIDE, ...ALL], p1: { battlefield: ['Test Guide'], graveyard: grave(n) } });
      return [maxHandSize(s, 'p1'), maxHandSize(s, 'p2')];
    });
    expect(sizes).toEqual([[7, 7], [7, 7], [7, 3], [7, 2], [7, 1]]);
  });

  it('CR 402.2: the controller\'s own graveyard is the one counted, whoever the player is; without the guide it is seven again', () => {
    const withGuide = scenario(['Forest'], { defs: [GUIDE, ...ALL], p1: { battlefield: ['Test Guide'] }, p2: { graveyard: grave(6) } });
    expect(maxHandSize(withGuide, 'p2')).toBe(7);
    const gone = scenario(['Forest'], { defs: [GUIDE, ...ALL], p1: { graveyard: grave(6) } });
    expect(maxHandSize(gone, 'p2')).toBe(7);
  });
});

describe('CR 121.1, 107.3, 608.2h: "Discard your hand. Then draw X cards, where X is the number of card types among cards in your graveyard."', () => {
  const VEIL = card('Test Veil', 'Instant', 'Discard your hand. Then draw X cards, where X is the number of card types among cards in your graveyard.');

  it('is understood: the spell is a full card', () => {
    expect(full(VEIL)).toBe(true);
  });

  it('CR 608.2h: X is counted as the draw happens, after the hand went to the graveyard: a land and a creature in hand are two more types', () => {
    const s0 = scenario(['Forest'], { defs: [VEIL, ...ALL], p1: { hand: ['Test Veil', 'Forest', 'Test Bear'], graveyard: ['Test Sorcery'] } });
    const s1 = resolveAll(cast(s0, 'Test Veil'));
    // graveyard: Test Veil is on the stack until it finishes, so: Sorcery + Land + Creature = 3 types, then the Instant itself arrives after resolution
    expect(handSize(s1, 'p1')).toBe(3);
    expect(librarySize(s1, 'p1')).toBe(librarySize(s0, 'p1') - 3);
  });

  it('CR 205.2a: the same card type twice counts once; an empty graveyard and an empty hand draw nothing', () => {
    const lands = scenario(['Forest'], { defs: [VEIL, ...ALL], p1: { hand: ['Test Veil', 'Forest', 'Forest'], graveyard: ['Forest'] } });
    expect(handSize(resolveAll(cast(lands, 'Test Veil')), 'p1')).toBe(1);
    const bare = scenario([], { defs: [VEIL, ...ALL], p1: { hand: ['Test Veil'] } });
    expect(handSize(resolveAll(cast(bare, 'Test Veil')), 'p1')).toBe(0);
  });
});

describe('CR 700.2, 601.2b: "Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead."', () => {
  const GAMBIT = card('Test Gambit', 'Sorcery', 'Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead.\n• You gain 3 life.\n• Each opponent loses 2 life.\n• Draw a card.');

  it('is understood: the gambit is a full card with a count that changes (ModeSpec.override)', () => {
    expect(full(GAMBIT)).toBe(true);
    expect(GAMBIT.faces[0]!.abilities.find((a) => a.kind === 'spell')).toMatchObject({
      effect: { modes: { min: 1, max: 1, override: { min: 1, max: 3, when: { cond: 'compare', op: '>=', right: 4, left: { q: 'distinct', what: 'cardTypes' } } } } },
    });
  });

  function modeChoice(types: number): { min: number; max: number } {
    const s0 = scenario(['Forest'], { defs: [GAMBIT, ...ALL], p1: { hand: ['Test Gambit'], graveyard: grave(types) } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gambit', 'hand', 'p1') });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'chooseOption'; i++) s = answer(s, { kind: 'payCost', auto: true });
    const p = s.pending;
    if (!p || p.kind !== 'chooseOption') throw new Error(`no mode choice: ${p?.kind}`);
    return { min: p.min, max: p.max };
  }

  it('CR 700.2: with three card types exactly one mode is chosen; with four, one or more (up to all three)', () => {
    expect(modeChoice(3)).toEqual({ min: 1, max: 1 });
    expect(modeChoice(4)).toEqual({ min: 1, max: 3 });
    expect(modeChoice(6)).toEqual({ min: 1, max: 3 });
  });

  it('CR 700.2d, 608.2c: with four types the chosen modes are all done, in printed order', () => {
    const s0 = scenario(['Forest'], { defs: [GAMBIT, ...ALL], p1: { hand: ['Test Gambit'], graveyard: grave(5) } });
    const life0 = s0.players.find((p) => p.id === 'p1')!.life;
    const opp0 = s0.players.find((p) => p.id === 'p2')!.life;
    const h0 = handSize(s0, 'p1');
    const s1 = resolveAll(cast(s0, 'Test Gambit', { options: [['0', '1', '2']] }));
    expect(s1.players.find((p) => p.id === 'p1')!.life).toBe(life0 + 3);
    expect(s1.players.find((p) => p.id === 'p2')!.life).toBe(opp0 - 2);
    expect(handSize(s1, 'p1')).toBe(h0 - 1 + 1);
  });
});

describe('CR 701.10e, 122.1, 608.2c: "Then if there are six or more card types among cards in your graveyard, double the number of +1/+1 counters on that creature."', () => {
  const BOON = card('Test Boon', 'Sorcery', 'Put two +1/+1 counters on target creature you control. Then if there are six or more card types among cards in your graveyard, double the number of +1/+1 counters on that creature.');

  it('is understood: the spell is a full card', () => {
    expect(full(BOON)).toBe(true);
  });

  it('CR 608.2c: five types leave the two counters; six types double them to four', () => {
    for (const [n, counters] of [[5, 2], [6, 4]] as const) {
      const s0 = scenario(['Forest'], { defs: [BOON, ...ALL], p1: { hand: ['Test Boon'], battlefield: ['Test Bear'], graveyard: [...grave(n === 6 ? 6 : 5)] } });
      const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
      const s1 = resolveAll(cast(s0, 'Test Boon', { targets: [[obj(bear)]] }));
      expect(s1.objects[bear]!.counters['+1/+1'], `${n} types`).toBe(counters);
    }
  });

  it('CR 205.2a: Planeswalker is the seventh type; a seventh and eighth type do not matter more than six', () => {
    const s0 = scenario(['Forest'], { defs: [BOON, ...ALL], p1: { hand: ['Test Boon'], battlefield: ['Test Bear'], graveyard: [...grave(6), 'Test Walker'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(resolveAll(cast(s0, 'Test Boon', { targets: [[obj(bear)]] })).objects[bear]!.counters['+1/+1']).toBe(4);
  });
});

describe('CR 701.13a, 107.3, 205.2a: "Exile the top X cards of your library, where X is the number of card types among other nonland permanents you control."', () => {
  const LOOTER = card('Test Looter', 'Creature — Beast', '{0}: Exile the top X cards of your library, where X is the number of card types among other nonland permanents you control.', ['2', '2']);
  const DREDGER = card('Test Dredger', 'Creature — Beast', '{0}: Exile the top X cards of your library, where X is the number of card types among cards in your graveyard.', ['2', '2']);

  it('is understood: nothing is manual, and the cards are full now that the template is stable (FAST5 T70 promoted it with the review of Loot, the Key to Everything)', () => {
    for (const d of [LOOTER, DREDGER]) {
      expect(noManual(d), d.name).toBe(true);
      expect(d.automation.level, d.name).toBe('full');
    }
  });

  it('CR 109.2, 205.2a: other nonland permanents: the source itself and lands do not count; a creature, an artifact and an enchantment are three types', () => {
    const s0 = scenario(['Forest'], { defs: [LOOTER, ...ALL], p1: { battlefield: ['Test Looter', 'Test Bear', 'Test Trinket', 'Test Shrine', 'Forest'] } });
    const lib = librarySize(s0, 'p1');
    const s1 = activate(s0, 'Test Looter');
    expect(librarySize(s1, 'p1')).toBe(lib - 3);
    expect(s1.zones.exile.length).toBe(3);
  });

  it('CR 107.3: X is zero (nothing else but a land and the source): nothing is exiled', () => {
    const s0 = scenario(['Forest'], { defs: [LOOTER, ...ALL], p1: { battlefield: ['Test Looter', 'Forest'] } });
    const s1 = activate(s0, 'Test Looter');
    expect(librarySize(s1, 'p1')).toBe(librarySize(s0, 'p1'));
    expect(s1.zones.exile.length).toBe(0);
  });

  it('CR 205.2a: the graveyard form counts the types of the graveyard', () => {
    const s0 = scenario(['Forest'], { defs: [DREDGER, ...ALL], p1: { battlefield: ['Test Dredger'], graveyard: grave(4) } });
    const s1 = activate(s0, 'Test Dredger');
    expect(librarySize(s1, 'p1')).toBe(librarySize(s0, 'p1') - 4);
    expect(findAll(s1, 'Plains', 'exile').length).toBe(4);
  });
});
