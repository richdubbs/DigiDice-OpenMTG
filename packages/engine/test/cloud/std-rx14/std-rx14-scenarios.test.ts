/**
 * Card wave 2, slice s13 (std-rx14): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.185a, 400.7d   "If that creature was cast for its warp cost, it also gains ...": the target's cast record (a warped creature yes, one cast for its mana
 *                         cost or put onto the battlefield no)
 *   CR 607.2d, 608.2c     "If it's a card of the chosen type, you may reveal it and put it into your hand": the type chosen as the permanent entered; a card of
 *                         another type stays on top
 *   CR 122.1, 608.2c-d    "you may remove a charge counter from each of any number of artifacts you control. ... for each charge counter removed this way": the
 *                         counters actually removed (a chosen artifact without one gives none; declining removes none)
 *   CR 603.6a, 400.7      "for each other Elf that entered the battlefield under your control this turn": the turn's other Elves, never the one of the event, and
 *                         no non-Elf
 *   CR 406.3, 400.7       "exile target artifact and up to one creature you control, then return those cards to the battlefield under their owner's control":
 *                         both return as new objects; choosing none returns the target alone
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, passBoth, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; option?: string }
/** Answer the decisions that come up (yes/no, targets, chosen objects in order, an option by its label; costs paid automatically) until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') {
      const want = p.options.find((o) => script.option !== undefined && (o.label === script.option || o.id === script.option));
      s = answer(s, { kind: 'chooseOption', ids: want ? [want.id] : p.options.slice(0, p.min).map((o) => o.id) });
    } else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: script.option ?? p.options?.[0] ?? '' });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, method?: string): GameState =>
  drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), ...(method ? { method } : {}) }), script);
const resolveAll = (s0: GameState, script?: Script): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

// ---- Cond '<that object> was cast for its warp cost' (parser/holes/cond.ts#castForAltCost) -----------------------------------------------------------------------

const RUNNER = card('Test Rift Runner', 'Creature — Goblin', 'Warp {R}', ['2', '2'], '{2}{R}');
const SURGE = card('Test Ion Surge', 'Instant', 'Target creature you control gets +2/+1 until end of turn. If that creature was cast for its warp cost, it also gains trample and haste until end of turn.');
const WARP = [RUNNER, SURGE];

describe('CR 702.185a, 400.7d: "If that creature was cast for its warp cost, it also gains trample and haste until end of turn"', () => {
  const pumped = (method?: string, onBattlefield = false): { s: GameState; id: ObjectId } => {
    let s = scenario([], { p1: { hand: onBattlefield ? ['Test Ion Surge'] : ['Test Rift Runner', 'Test Ion Surge'], battlefield: onBattlefield ? ['Test Rift Runner'] : [] }, defs: WARP });
    if (!onBattlefield) {
      mana(s, 'R', 'C', 'C');
      s = resolveAll(cast(s, 'Test Rift Runner', {}, method));
    }
    const id = named(s, 'Test Rift Runner')[0]!;
    s = resolveAll(cast(s, 'Test Ion Surge', { targets: [[obj(id)]] }));
    return { s, id };
  };
  it('is automated', () => expect(full(SURGE)).toBe(true));
  it('a creature cast for its warp cost gets +2/+1 and gains trample and haste', () => {
    const { s, id } = pumped('warp');
    const c = getChars(s, id);
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 3]);
    expect(c.keywords.map((k) => k.keyword).filter((k) => k !== 'warp').sort()).toEqual(['haste', 'trample']);
  });
  it('the negative case: cast for its mana cost, or put onto the battlefield, it only gets +2/+1', () => {
    for (const r of [pumped(undefined), pumped(undefined, true)]) {
      const c = getChars(r.s, r.id);
      expect([Number(c.power), Number(c.toughness)]).toEqual([4, 3]);
      expect(c.keywords.map((k) => k.keyword).filter((k) => k !== 'warp')).toEqual([]);
    }
  });
});

// ---- render/cond.ts: "If it's a card of the chosen type" ------------------------------------------------------------------------------------------------------

const STONE = card('Test Kin Lodestone', 'Artifact', "As this artifact enters, choose a creature type.\nWhen this artifact enters and at the beginning of your upkeep, look at the top card of your library. If it's a card of the chosen type, you may reveal it and put it into your hand.", undefined, '{0}');
const ELF = card('Test Glade Elf', 'Creature — Elf', '', ['1', '1'], '{G}');
const BEAR = card('Test Moss Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');

describe('CR 607.2d, 608.2c: "look at the top card of your library. If it\'s a card of the chosen type, you may reveal it and put it into your hand."', () => {
  const run = (top: string, yes: boolean): GameState => {
    const s = scenario([], { p1: { hand: ['Test Kin Lodestone'], library: [top] }, defs: [STONE, ELF, BEAR] });
    return resolveAll(cast(s, 'Test Kin Lodestone', { option: 'Elf' }), { yes: [yes], option: 'Elf' });
  };
  it('is automated', () => expect(full(STONE)).toBe(true));
  it('a card of the chosen type goes to your hand if you choose to', () => {
    expect(zoneNames(run('Test Glade Elf', true), 'hand', 'p1')).toEqual(['Test Glade Elf']);
    expect(zoneNames(run('Test Glade Elf', false), 'library', 'p1')[0]).toBe('Test Glade Elf');
  });
  it('the negative case: a card of another type stays on top of the library', () => {
    const s = run('Test Moss Bear', true);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'library', 'p1')[0]).toBe('Test Moss Bear');
  });
});

// ---- 'remove a <kind> counter from each of any number of <permanents>' + 'for each <kind> counter removed this way' --------------------------------------------

const DRAIN = card('Test Charge Siphon', 'Artifact', 'When this artifact enters, you may remove a charge counter from each of any number of artifacts you control. You gain 2 life for each charge counter removed this way.');
const CELL = card('Test Power Cell', 'Artifact', '');

describe('CR 122.1, 608.2c-d: "you may remove a charge counter from each of any number of artifacts you control. You gain 2 life for each charge counter removed this way."', () => {
  const run = (yes: boolean, pick: (s: GameState) => ObjectId[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Charge Siphon'], battlefield: [{ name: 'Test Power Cell', counters: { charge: 3 } }, { name: 'Test Power Cell', counters: { charge: 1 } }, 'Test Power Cell'] }, defs: [DRAIN, CELL] });
    s = cast(s, 'Test Charge Siphon');
    s = drive(passBoth(s));
    return resolveAll(s, { yes: [yes], objects: [pick(s)] });
  };
  const cells = (s: GameState): ObjectId[] => named(s, 'Test Power Cell');
  it('is automated', () => expect(full(DRAIN)).toBe(true));
  it('one counter is removed from each chosen artifact, and the life is 2 per counter actually removed (the empty one gives none)', () => {
    const s = run(true, cells);
    expect(life(s, 'p1')).toBe(24);
    expect(cells(s).map((id) => s.objects[id]!.counters['charge'] ?? 0)).toEqual([2, 0, 0]);
  });
  it('the negative cases: choosing none, or declining, removes nothing and gains nothing', () => {
    expect(life(run(true, () => []), 'p1')).toBe(20);
    const s = run(false, cells);
    expect(life(s, 'p1')).toBe(20);
    expect(cells(s).map((id) => s.objects[id]!.counters['charge'] ?? 0)).toEqual([3, 1, 0]);
  });
});

// ---- 'for each other <filter> that entered the battlefield under your control this turn' (other than the object of the event) -----------------------------------

const ELDER = card('Test Grove Elder', 'Creature — Human Druid', 'Whenever an Elf you control enters, put a +1/+1 counter on it for each other Elf that entered the battlefield under your control this turn.', ['2', '2'], '{1}{G}');

describe('CR 603.6a, 400.7: "put a +1/+1 counter on it for each other Elf that entered the battlefield under your control this turn"', () => {
  it('is automated', () => expect(full(ELDER)).toBe(true));
  it('the first Elf gets none, the second gets one; a non-Elf neither counts nor gets counters', () => {
    let s = scenario([], { p1: { hand: ['Test Glade Elf', 'Test Glade Elf', 'Test Moss Bear'], battlefield: ['Test Grove Elder'] }, defs: [ELDER, ELF, BEAR] });
    mana(s, 'G', 'G', 'G', 'G', 'G', 'C', 'C');
    s = resolveAll(cast(s, 'Test Glade Elf'));
    s = resolveAll(cast(s, 'Test Moss Bear'));
    s = resolveAll(cast(s, 'Test Glade Elf'));
    const elves = named(s, 'Test Glade Elf');
    expect(elves.map((id) => s.objects[id]!.counters['+1/+1'] ?? 0).sort()).toEqual([0, 1]);
    expect(s.objects[named(s, 'Test Moss Bear')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ---- 'exile <obj> and up to one <filter>, then return those cards to the battlefield under their owner's control' -------------------------------------------------

const BLINK = card('Test Phase Warden', 'Creature — Human Wizard', "When this creature enters, exile target artifact and up to one creature you control, then return those cards to the battlefield under their owner's control.", ['1', '1']);

describe('CR 406.3, 400.7: "exile target artifact and up to one creature you control, then return those cards to the battlefield under their owner\'s control"', () => {
  const run = (choose: boolean): { before: { cell: ObjectId; bear: ObjectId }; s: GameState } => {
    let s = scenario([], { p1: { hand: ['Test Phase Warden'], battlefield: ['Test Power Cell', 'Test Moss Bear'] }, defs: [BLINK, CELL, BEAR] });
    const before = { cell: named(s, 'Test Power Cell')[0]!, bear: named(s, 'Test Moss Bear')[0]! };
    s = cast(s, 'Test Phase Warden');
    s = drive(passBoth(s), { targets: [[obj(before.cell)]] });
    return { before, s: resolveAll(s, { objects: [choose ? [before.bear] : []] }) };
  };
  it('is automated', () => expect(full(BLINK)).toBe(true));
  it('the target and the chosen creature both return as new objects', () => {
    const { before, s } = run(true);
    expect(named(s, 'Test Power Cell')).toHaveLength(1);
    expect(named(s, 'Test Power Cell')[0]).not.toBe(before.cell);
    expect(named(s, 'Test Moss Bear')).toHaveLength(1);
    expect(named(s, 'Test Moss Bear')[0]).not.toBe(before.bear);
    expect(s.zones.exile).toEqual([]);
  });
  it('the negative case: choosing no creature returns the target alone; the creature stays the same object', () => {
    const { before, s } = run(false);
    expect(named(s, 'Test Power Cell')[0]).not.toBe(before.cell);
    expect(named(s, 'Test Moss Bear')).toEqual([before.bear]);
  });
});
