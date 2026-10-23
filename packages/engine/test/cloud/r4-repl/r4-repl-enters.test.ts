/**
 * Cloud r4-repl (Standard round 4: replacement and prevention effects): entering replacements, replacements a cast trigger creates for the spell it names, and the
 * replacement a spell cast during a resolution gets, played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * numbers and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 614.1c, 122.6            "~ enters with a +1/+1 counter on it plus an additional +1/+1 counter on it for each other creature you control."
 *   CR 614.1c, 700.4, 603.10a   "~ enters with a +1/+1 counter on it for each creature that died under your control this turn."
 *   CR 614.1c, 614.12           "Each other Elf you control enters with an additional +1/+1 counter on it for each Elf you already control."
 *   CR 614.12a, 607.2a          "As ~ enters, choose a creature type. ~ enters with a charge counter on it for each creature you control of the chosen type."
 *   CR 614.12, 611.2c           "Whenever you cast a creature spell, that creature enters with ..." (a replacement of that spell's entering, fixed as it is created)
 *   CR 603.7a, 614.12           "When you next cast a creature spell this turn, that creature enters with an additional +1/+1 counter on it."
 *   CR 614.1a, 608.2n           "Whenever you cast an instant spell, exile that spell instead of putting it into your graveyard as it resolves."
 *   CR 614.1a, 400.7            "... you may cast target instant card from a graveyard. If that spell would be put into a graveyard, exile it instead."
 *   CR 611.2a, 614.1a           "you may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it instead"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters?.[kind] ?? 0;

function drive(s0: GameState, targets: TargetChoice[][] = [], yes: boolean[] = [], option?: string): GameState {
  let s = s0;
  const t = [...targets];
  const y = [...yes];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: y.shift() ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') {
      const want = option !== undefined ? p.options.filter((x) => x.label === option || x.id === option).slice(0, 1) : [];
      s = answer(s, { kind: 'chooseOption', ids: want.length > 0 ? want.map((x) => x.id) : p.options.slice(0, Math.max(1, p.min)).map((x) => x.id) });
    } else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: option ?? 'Bear' });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, yes: boolean[] = [], option?: string): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), [], yes, option);
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], option?: string): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, [], option), [], option);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('Cloud r4-repl: "~ enters with a +1/+1 counter on it plus an additional +1/+1 counter on it for each other creature you control." (CR 614.1c, 122.6)', () => {
  const SHERIFF = card('Test Sheriff', 'Creature — Human Knight', 'This creature enters with a +1/+1 counter on it plus an additional +1/+1 counter on it for each other creature you control.', { pt: ['0', '0'] });
  it('is automated', () => expect(full(SHERIFF)).toBe(true));
  it('CR 614.1c: with two other creatures, three counters; with none, one', () => {
    let s = scenario([], { defs: [SHERIFF, BEAR], p1: { hand: ['Test Sheriff'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Sheriff');
    expect(counters(s, find(s, 'Test Sheriff', 'battlefield'))).toBe(3);
    let t = scenario([], { defs: [SHERIFF], p1: { hand: ['Test Sheriff'] } });
    t = cast(t, 'Test Sheriff');
    expect(counters(t, find(t, 'Test Sheriff', 'battlefield'))).toBe(1);
  });
});

describe('Cloud r4-repl: "~ enters with a +1/+1 counter on it for each creature that died under your control this turn." (CR 614.1c, 700.4, 603.10a)', () => {
  const SWORD = card('Test Sellsword', 'Creature — Human Soldier', 'This creature enters with a +1/+1 counter on it for each creature that died under your control this turn.', { pt: ['1', '1'] });
  it('the entering ability is automated', () => expect(full(SWORD)).toBe(true));
  it('CR 700.4, 603.10a: one of your creatures and one of an opponent\'s died this turn: one counter', () => {
    let s = scenario([], { defs: [SWORD, BEAR, KILL], p1: { hand: ['Test Sellsword', 'Test Kill', 'Test Kill'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]]);
    s = cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]);
    s = cast(s, 'Test Sellsword');
    expect(counters(s, find(s, 'Test Sellsword', 'battlefield'))).toBe(1);
  });
});

describe('Cloud r4-repl: "Each other Elf you control enters with an additional +1/+1 counter on it for each Elf you already control." (CR 614.1c, 614.12)', () => {
  const GIADA = card('Test Matron', 'Creature — Elf', 'Each other Elf you control enters with an additional +1/+1 counter on it for each Elf you already control.', { pt: ['2', '2'] });
  it('is automated', () => expect(full(GIADA)).toBe(true));
  it('CR 614.12: with the Matron and one other Elf on the battlefield, a new Elf enters with two counters (the entering one is not counted)', () => {
    let s = scenario([], { defs: [GIADA, ELF], p1: { hand: ['Test Elf'], battlefield: ['Test Matron', 'Test Elf'] } });
    const before = findAll(s, 'Test Elf', 'battlefield', 'p1');
    s = cast(s, 'Test Elf');
    const fresh = findAll(s, 'Test Elf', 'battlefield', 'p1').find((id) => !before.includes(id))!;
    expect(counters(s, fresh)).toBe(2);
  });
});

describe('Cloud r4-repl: "As ~ enters, choose a creature type. ~ enters with a charge counter on it for each creature you control of the chosen type." (CR 614.12a, 607.2a)', () => {
  const BANNER = card('Test Banner', 'Artifact', 'As this artifact enters, choose a creature type. This artifact enters with a charge counter on it for each creature you control of the chosen type.');
  it('is automated', () => expect(full(BANNER)).toBe(true));
  it('CR 614.12a: the type is chosen first, then the counters are counted: Elf chosen, two Elves, two counters', () => {
    let s = scenario([], { defs: [BANNER, ELF, BEAR], p1: { hand: ['Test Banner'], battlefield: ['Test Elf', 'Test Elf', 'Test Bear'] } });
    s = cast(s, 'Test Banner', [], 'Elf');
    expect(counters(s, find(s, 'Test Banner', 'battlefield'), 'charge')).toBe(2);
  });
});

describe('Cloud r4-repl: "Whenever you cast a creature spell, that creature enters with an additional +1/+1 counter on it for each Elf you control." (CR 614.12, 611.2c)', () => {
  const HOUND = card('Test Hound', 'Creature — Wolf', 'Whenever you cast a creature spell, that creature enters with an additional +1/+1 counter on it for each Elf you control.', { pt: ['3', '3'] });
  const COUNTER = card('Test Denial', 'Instant', 'Counter target spell.');
  it('is automated', () => expect(full(HOUND)).toBe(true));
  it('CR 614.12, 611.2c: the cast creature enters with one counter per Elf you control as the trigger resolves; another creature does not', () => {
    let s = scenario([], { defs: [HOUND, BEAR, ELF], p1: { hand: ['Test Bear'], battlefield: ['Test Hound', 'Test Elf', 'Test Elf'] } });
    s = cast(s, 'Test Bear');
    expect(counters(s, find(s, 'Test Bear', 'battlefield'))).toBe(2);
    expect(counters(s, find(s, 'Test Hound', 'battlefield'))).toBe(0);
  });
  it('CR 400.7: a countered creature spell enters nowhere, and a later creature card put onto the battlefield is another object (no counters)', () => {
    let s = scenario([], { defs: [HOUND, BEAR, ELF, COUNTER], p1: { hand: ['Test Bear', 'Test Denial'], battlefield: ['Test Hound', 'Test Elf'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    s = drive(pass(pass(s))); // the trigger resolves; the Bear is still on the stack
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Denial', 'hand', 'p1') }), [[obj(spell)]]));
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('Cloud r4-repl: "Whenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the number of colors of mana spent to cast it." (CR 601.2h)', () => {
  const ARCHAIC = card('Test Archaic', 'Creature — Avatar', 'Whenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the number of colors of mana spent to cast it.', { pt: ['2', '2'] });
  const DUO = card('Test Duo', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{W}{U}' });
  it('is automated', () => expect(full(ARCHAIC)).toBe(true));
  it('CR 601.2h: white and blue mana spent, two counters', () => {
    let s = scenario(['Island'], { defs: [ARCHAIC, DUO], p1: { hand: ['Test Duo'], battlefield: ['Test Archaic', 'Plains', 'Island'] } });
    s = cast(s, 'Test Duo');
    expect(counters(s, find(s, 'Test Duo', 'battlefield'))).toBe(2);
  });
});

describe('Cloud r4-repl: "When you next cast a creature spell this turn, that creature enters with an additional +1/+1 counter on it." (CR 603.7a, 614.12)', () => {
  const HOWL = card('Test Howl', 'Sorcery', 'When you next cast a creature spell this turn, that creature enters with an additional +1/+1 counter on it.');
  it('is automated', () => expect(full(HOWL)).toBe(true));
  it('CR 603.7a: the next creature spell gets the counter, the one after it does not', () => {
    let s = scenario([], { defs: [HOWL, BEAR, ELF], p1: { hand: ['Test Howl', 'Test Bear', 'Test Elf'] } });
    s = cast(s, 'Test Howl');
    s = cast(s, 'Test Bear');
    s = cast(s, 'Test Elf');
    expect([counters(s, find(s, 'Test Bear', 'battlefield')), counters(s, find(s, 'Test Elf', 'battlefield'))]).toEqual([1, 0]);
  });
});

describe('Cloud r4-repl: "Whenever you cast an instant spell, exile that spell instead of putting it into your graveyard as it resolves." (CR 614.1a, 608.2n)', () => {
  const SLICK = card('Test Slickshot', 'Creature — Human Rogue', 'Whenever you cast an instant spell, exile that spell instead of putting it into your graveyard as it resolves.', { pt: ['2', '2'] });
  const DRAW = card('Test Cantrip', 'Instant', 'Draw a card.');
  const COUNTER = card('Test Denial', 'Sorcery', 'Counter target spell.');
  it('is automated', () => expect(full(SLICK)).toBe(true));
  it('CR 608.2n: the instant is exiled as it resolves', () => {
    let s = scenario([], { defs: [SLICK, DRAW], p1: { hand: ['Test Cantrip'], battlefield: ['Test Slickshot'] } });
    s = cast(s, 'Test Cantrip');
    expect(findAll(s, 'Test Cantrip', 'exile')).toHaveLength(1);
    expect(findAll(s, 'Test Cantrip', 'graveyard', 'p1')).toHaveLength(0);
  });
});

describe('Cloud r4-repl: "When ~ enters, you may cast target instant card from a graveyard. If that spell would be put into a graveyard, exile it instead." (CR 614.1a, 400.7)', () => {
  const QUISTIS = card('Test Quistis', 'Creature — Human Wizard', 'When this creature enters, you may cast target instant card from a graveyard. If that spell would be put into a graveyard, exile it instead.', { pt: ['2', '2'] });
  const DRAW = card('Test Cantrip', 'Instant', 'Draw a card.');
  it('is automated', () => expect(full(QUISTIS)).toBe(true));
  it('CR 614.1a: the instant cast from the opponent\'s graveyard is exiled after it resolves, not put into its owner\'s graveyard', () => {
    let s = scenario([], { defs: [QUISTIS, DRAW], p1: { hand: ['Test Quistis'] }, p2: { graveyard: ['Test Cantrip'] } });
    const target = find(s, 'Test Cantrip', 'graveyard', 'p2');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quistis', 'hand', 'p1') }));
    s = resolveAll(drive(pass(pass(s)), [[obj(target)]]));
    expect(findAll(s, 'Test Cantrip', 'exile')).toHaveLength(1);
    expect(findAll(s, 'Test Cantrip', 'graveyard', 'p2')).toHaveLength(0);
    expect(s.zones.hand.p1).toHaveLength(1);
  });
});

describe('Cloud r4-repl: "you may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it instead" (CR 611.2a, 614.1a)', () => {
  const CELLAR = card('Test Cellar', 'Sorcery', 'You may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it instead.');
  const DRAW = card('Test Cantrip', 'Instant', 'Draw a card.');
  it('is automated', () => expect(full(CELLAR)).toBe(true));
  it('CR 611.2a, 614.1a: an instant is cast from the graveyard and then exiled; the sorcery itself is exiled too', () => {
    let s = scenario([], { defs: [CELLAR, DRAW], p1: { hand: ['Test Cellar'], graveyard: ['Test Cantrip'] } });
    s = cast(s, 'Test Cellar');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cantrip', 'graveyard', 'p1') })));
    expect(findAll(s, 'Test Cantrip', 'exile')).toHaveLength(1);
    expect(s.zones.graveyard.p1).toHaveLength(0);
  });
});
