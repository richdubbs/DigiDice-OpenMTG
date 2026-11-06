/**
 * edh-cast-6 scenarios (Commander lane edh-cast): each new reading played through the engine with synthetic cards (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25):
 *   CR 601.3b, 702.8a, 109.5     "Creature cards you own that aren't on the battlefield have flash" (Teferi, Mage of Zhalfir)
 *   CR 601.2f, 118.7, 611.2a     "Noncreature spells your opponents cast cost {2} more to cast until your next turn" (Elspeth Conquers Death)
 *   CR 122.1, 608.2d             "Put a +1/+1 counter or a loyalty counter on it" (the controller chooses as it resolves)
 *   CR 601.2f, 101.2, 701.6a     "Spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered" (Thryx, the Sudden Storm)
 *   CR 602.2b, 605.1a, 118.7     "Abilities you activate that aren't mana abilities cost {2} less to activate" (Zirda, the Dawnwaker)
 *   CR 701.6a, 603.2             "Whenever a spell or ability you control counters a spell" (Baral, Chief of Compliance)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { abilityCostModsFor } from '../../../src/statics/costmods';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? (type.includes('Land') ? '' : '{0}'), type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const give = (s: GameState, player: 'p1' | 'p2', mana: string): void => { for (const t of mana) s.players[player === 'p1' ? 0 : 1]!.manaPool.push({ type: t } as never); };
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const canCast = (s: GameState, id: ObjectId, player = 'p1'): boolean => {
  try { return settle(act(s, { type: 'cast', player, card: id })).zones.stack.length > 0; } catch { return false; }
};
function castTargeting(s0: GameState, name: string, targets: (ObjectId | TargetChoice | null)[], player: 'p1' | 'p2' = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  const rest = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'chooseTargets') { const t = rest.shift(); s = answer(s, { kind: 'chooseTargets', targets: t == null ? [] : [typeof t === 'string' ? obj(t) : t] }); }
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  return s;
}
const inHand = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.hand[player]!.some((id) => s.objects[id]!.defId === name);
const inYard = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.graveyard[player]!.some((id) => s.objects[id]!.defId === name);
const onField = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ROCK = card('Test Rock', 'Artifact', '');

describe('CR 601.3b, 702.8a, 109.5: "Creature cards you own that aren\'t on the battlefield have flash" (Teferi, Mage of Zhalfir)', () => {
  const MAGE = card('Test Flash Mage', 'Creature — Wizard', "Creature cards you own that aren't on the battlefield have flash.", { pt: ['3', '4'] });
  const defs = [MAGE, BEAR, ROCK];
  // a spell on the stack: a creature spell can only be cast then with flash (CR 307.1, 601.3b)
  const withStack = (mage: boolean, p2Hand: string[] = []): GameState => {
    let s = scenario([], { p1: { battlefield: mage ? ['Test Flash Mage'] : [], hand: ['Test Bear', 'Test Rock'] }, p2: { hand: p2Hand }, defs });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rock', 'hand', 'p1') }));
    return s;
  };
  it('is automated', () => { expect(MAGE.automation.level).toBe('full'); });
  it('with the static ability a creature card in its owner\'s hand is cast while a spell is on the stack', () => {
    expect(canCast(withStack(true), find(withStack(true), 'Test Bear', 'hand', 'p1'))).toBe(true);
  });
  it('without it the creature card can only be cast at sorcery timing', () => {
    expect(canCast(withStack(false), find(withStack(false), 'Test Bear', 'hand', 'p1'))).toBe(false);
  });
  it('a card of another type gets no flash (an artifact card while a spell is on the stack)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Flash Mage'], hand: ['Test Rock', 'Test Rock'] }, defs });
    const [first, second] = s.zones.hand.p1!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: first! }));
    expect(canCast(s, second!)).toBe(false);
  });
  it('a creature card with suspend can be suspended at instant timing (ruling 2021-03-19: suspending needs a time the card could be cast)', () => {
    const SUSPENDER = card('Test Suspender', 'Creature — Wizard', 'Suspend 2—{0}', { pt: ['2', '2'] });
    const suspendable = (mage: boolean): boolean => {
      let s = scenario([], { p1: { battlefield: mage ? ['Test Flash Mage'] : [], hand: ['Test Suspender', 'Test Rock'] }, defs: [...defs, SUSPENDER] });
      s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rock', 'hand', 'p1') }));
      return legalActions(s, 'p1').some((l) => l.kind === 'special');
    };
    expect(suspendable(true)).toBe(true);
    expect(suspendable(false)).toBe(false);
  });
  it('the creature cards of an opponent get no flash from it (they are not cards you own)', () => {
    let s = withStack(true, ['Test Bear']);
    s = pass(s); // p2 holds priority with the artifact spell on the stack
    expect(canCast(s, find(s, 'Test Bear', 'hand', 'p2'), 'p2')).toBe(false);
  });
});

describe('CR 601.2f, 118.7, 611.2a: costs changed "until your next turn"', () => {
  const TAX = card('Test Tax', 'Sorcery', 'Noncreature spells your opponents cast cost {2} more to cast until your next turn.');
  const GEM = card('Test Gem', 'Artifact', 'Flash', { cost: '{1}' });
  const BOLT = card('Test Bolt', 'Instant', 'You gain 1 life.', { cost: '{1}' });
  const defs = [TAX, GEM, BOLT, BEAR, ROCK];
  it('is automated', () => { expect(TAX.automation.level).toBe('full'); });
  it("an opponent's noncreature spell costs {2} more until the caster's next turn; with only {1} they can't cast it, with {3} they can", () => {
    const run = (mana: string): boolean => {
      let s = scenario([], { p1: { hand: ['Test Tax'] }, p2: { hand: ['Test Gem'] }, defs });
      s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tax', 'hand', 'p1') })));
      give(s, 'p2', mana);
      s = pass(s);
      return canCast(s, find(s, 'Test Gem', 'hand', 'p2'), 'p2');
    };
    expect(run('G')).toBe(false);
    expect(run('GGG')).toBe(true);
  });
  it("a creature spell of the opponent and the caster's own spells are not taxed", () => {
    const FLASHBEAR = card('Test Flashbear', 'Creature — Bear', 'Flash', { pt: ['2', '2'], cost: '{1}' });
    let s = scenario([], { p1: { hand: ['Test Tax', 'Test Gem'] }, p2: { hand: ['Test Flashbear'] }, defs: [...defs, FLASHBEAR] });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tax', 'hand', 'p1') })));
    give(s, 'p1', 'G');
    expect(canCast(s, find(s, 'Test Gem', 'hand', 'p1'))).toBe(true); // {1}, not {3}
    const t = pass(s);
    give(t, 'p2', 'G');
    expect(canCast(t, find(t, 'Test Flashbear', 'hand', 'p2'), 'p2')).toBe(true); // a creature spell: still {1}
  });
  it('the increase ends when the caster\'s next turn begins', () => {
    let s = scenario([], { p1: { hand: ['Test Tax'] }, p2: { hand: ['Test Gem'] }, defs });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tax', 'hand', 'p1') })));
    give(s, 'p2', 'G');
    expect(canCast(pass(s), find(pass(s), 'Test Gem', 'hand', 'p2'), 'p2')).toBe(false); // taxed now: {3}
    // pass priority until p1's second turn begins (turn 3)
    for (let guard = 0; s.turn.number < 3 && guard < 200; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.turn.number).toBe(3);
    // p2 gets priority during p1's turn: the {1} flash artifact costs its printed {1} again
    while (s.pending?.player !== 'p2' && s.turn.number === 3) s = act(s, { type: 'pass', player: s.pending!.player });
    give(s, 'p2', 'G'); // (mana empties as steps end)
    expect(canCast(s, find(s, 'Test Gem', 'hand', 'p2'), 'p2')).toBe(true);
  });
});

describe('CR 122.1, 608.2d: "Put a +1/+1 counter or a loyalty counter on it" is the controller\'s choice', () => {
  const REVIVE = card('Test Revive', 'Sorcery', 'Return target creature card from your graveyard to the battlefield. Put a +1/+1 counter or a loyalty counter on it.');
  const defs = [REVIVE, BEAR];
  const run = (option: string): { counters: Record<string, number>; onField: boolean } => {
    let s = scenario([], { p1: { hand: ['Test Revive'], graveyard: ['Test Bear'] }, defs });
    s = castTargeting(s, 'Test Revive', [find(s, 'Test Bear', 'graveyard', 'p1')]);
    s = resolveAll(s, { option });  // the option ids are the positions in the text: 0 = +1/+1, 1 = loyalty
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear');
    return { counters: bear === undefined ? {} : { ...s.objects[bear]!.counters }, onField: bear !== undefined };
  };
  it('is automated', () => { expect(REVIVE.automation.level).toBe('full'); });
  it('choosing +1/+1 puts a +1/+1 counter on the returned card and no loyalty counter', () => {
    const r = run('0');
    expect(r.onField).toBe(true);
    expect(r.counters['+1/+1']).toBe(1);
    expect(r.counters['loyalty'] ?? 0).toBe(0);
  });
  it('choosing loyalty puts a loyalty counter and no +1/+1 counter', () => {
    const r = run('1');
    expect(r.counters['loyalty']).toBe(1);
    expect(r.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 601.2f, 101.2, 202.3: "Spells you cast with mana value 5 or greater cost {1} less to cast and can\'t be countered" (Thryx, the Sudden Storm)', () => {
  const THRYX = card('Test Storm', 'Creature — Wizard', "Spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered.", { pt: ['3', '3'] });
  const BIG = card('Test Big', 'Artifact', '', { cost: '{5}' });
  const MID = card('Test Mid', 'Artifact', '', { cost: '{4}' });
  const NOPE = card('Test Nope', 'Instant', 'Counter target spell.');
  const defs = [THRYX, BIG, MID, NOPE];
  const setup = (p1Hand: string[]): GameState => scenario([], { p1: { battlefield: ['Test Storm'], hand: p1Hand }, p2: { hand: ['Test Nope', 'Test Big'] }, defs });
  it('is automated', () => { expect(THRYX.automation.level).toBe('full'); });
  it('a spell with mana value 5 costs {4}; one with mana value 4 keeps its {4} and one with mana value 5 can\'t be cast for {3}', () => {
    const s = setup(['Test Big', 'Test Mid']);
    give(s, 'p1', 'GGG');
    expect(canCast(s, find(s, 'Test Big', 'hand', 'p1'))).toBe(false);
    expect(canCast(s, find(s, 'Test Mid', 'hand', 'p1'))).toBe(false);
    give(s, 'p1', 'G');
    expect(canCast(s, find(s, 'Test Big', 'hand', 'p1'))).toBe(true);
  });
  it('its spell with mana value 5 can\'t be countered; one with mana value 4 can', () => {
    for (const [name, countered] of [['Test Big', false], ['Test Mid', true]] as const) {
      let s = setup([name]);
      give(s, 'p1', 'GGGGG');
      s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }));
      const spell = s.zones.stack[0]!;
      s = pass(s);
      s = resolveAll(castTargeting(s, 'Test Nope', [spell], 'p2'));
      expect(inYard(s, 'p1', name), name).toBe(countered);
      expect(onField(s, name), name).toBe(!countered);
    }
  });
  it('a spell with {X} in its mana cost counts X for its mana value (ruling 2020-01-24): X = 4 on {X}{G} is mana value 5 and costs {1} less; X = 3 is mana value 4 and does not', () => {
    const XSPELL = card('Test Xspell', 'Artifact', '', { cost: '{X}{G}' });
    // the mana left in the pool after casting the spell with X = x and 5 mana available (the spell is on the stack)
    const left = (storm: boolean, x: number): number => {
      let s = scenario([], { p1: { battlefield: storm ? ['Test Storm'] : [], hand: ['Test Xspell'] }, defs: [...defs, XSPELL] });
      give(s, 'p1', 'GGGGG');
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Xspell', 'hand', 'p1') });
      for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) {
        s = s.pending.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: x }) : answer(s, { kind: 'payCost', auto: true });
      }
      expect(s.zones.stack.length).toBe(1);
      return s.players[0]!.manaPool.length;
    };
    expect(left(true, 4)).toBe(1); // {4}{G} less {1}: pays 4 of the 5
    expect(left(false, 4)).toBe(0); // the control: no reduction without Test Storm
    expect(left(true, 3)).toBe(1); // {3}{G} = 4 mana, mana value 4: no reduction (1 left of 5)
    expect(left(false, 3)).toBe(1);
  });
  it("an opponent's spell with mana value 5 is not reduced and can be countered", () => {
    const FLASHBIG = card('Test Flashbig', 'Artifact', 'Flash', { cost: '{5}' });
    const COUNTER = card('Test Counter', 'Instant', 'Counter target spell.');
    const d2 = [...defs, FLASHBIG, COUNTER];
    const s0 = scenario([], { p1: { battlefield: ['Test Storm'], hand: ['Test Counter'] }, p2: { hand: ['Test Flashbig'] }, defs: d2 });
    let s = pass(s0);
    give(s, 'p2', 'GGGG');
    expect(canCast(s, find(s, 'Test Flashbig', 'hand', 'p2'), 'p2')).toBe(false); // 4 mana: no discount for the opponent
    give(s, 'p2', 'G');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flashbig', 'hand', 'p2') }));
    const spell = s.zones.stack[0]!;
    s = resolveAll(castTargeting(pass(s), 'Test Counter', [spell]));
    expect(inYard(s, 'p2', 'Test Flashbig')).toBe(true); // countered
  });
  it('a copy of your spell with mana value 5 is not a spell you cast: it can be countered while the original cannot', () => {
    const COPY = card('Test Copy', 'Instant', 'Copy target spell you control.');
    const GAIN = card('Test Gain', 'Instant', 'You gain 1 life.', { cost: '{5}' });
    const COUNTER = card('Test Counter', 'Instant', 'Counter target spell.');
    let s = scenario([], { p1: { battlefield: ['Test Storm'], hand: ['Test Gain', 'Test Copy', 'Test Counter'] }, defs: [...defs, COPY, GAIN, COUNTER] });
    give(s, 'p1', 'GGGG');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain', 'hand', 'p1') }));
    const orig = s.zones.stack[0]!;
    s = castTargeting(s, 'Test Copy', [orig]);
    const copySpell = s.zones.stack[1]!;
    for (let guard = 0; s.zones.stack.includes(copySpell) && guard < 6; guard++) s = settle(act(s, { type: 'pass', player: s.pending!.player })); // the Copy spell resolves: a copy goes on the stack
    expect(s.zones.stack.length).toBe(2); // original and copy
    const copy = s.zones.stack[s.zones.stack.length - 1]!;
    expect(copy).not.toBe(orig);
    give(s, 'p1', '');
    s = resolveAll(castTargeting(s, 'Test Counter', [copy]));
    expect(s.players[0]!.life).toBe(21); // only the original resolved: the copy was countered
  });
});

describe('CR 602.2b, 605.1a, 118.7: "Abilities you activate that aren\'t mana abilities cost {2} less to activate" (Zirda, the Dawnwaker)', () => {
  const ZIRDA = card('Test Zirda', 'Creature — Dwarf', "Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.", { pt: ['3', '3'] });
  const PUMP = card('Test Pump', 'Artifact', '{3}: You gain 1 life.');
  const CHEAP = card('Test Cheap', 'Artifact', '{1}: You gain 1 life.');
  const SOURCE = card('Test Source', 'Artifact', '{1}, {T}: Add {C}{C}.');
  const defs = [ZIRDA, PUMP, CHEAP, SOURCE];
  const hits = (name: string, kindIsMana: boolean): number => {
    const s = scenario([], { p1: { battlefield: ['Test Zirda', name] }, defs });
    const src = s.objects[find(s, name, 'battlefield', 'p1')]!;
    const ab = s.defs[src.defId]!.faces[0]!.abilities.find((a) => a.kind === 'activated')!;
    return abilityCostModsFor(s, 'p1', src, ab as never).length + (kindIsMana ? 0 : 0);
  };
  it('is automated', () => { expect(ZIRDA.automation.level).toBe('full'); });
  it('an activated ability applies the modifier (its {3} costs {1}); the floor keeps a cost of {1} at {1}', () => {
    expect(hits('Test Pump', false)).toBe(1);
    expect(hits('Test Cheap', false)).toBe(1);
    const afford = (name: string, mana: string): boolean => {
      const s = scenario([], { p1: { battlefield: ['Test Zirda', name] }, defs });
      give(s, 'p1', mana);
      return legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.object === find(s, name, 'battlefield', 'p1'));
    };
    expect(afford('Test Pump', 'G')).toBe(true);
    expect(afford('Test Pump', '')).toBe(false);
    expect(afford('Test Cheap', 'G')).toBe(true);
    expect(afford('Test Cheap', '')).toBe(false); // never below one mana
  });
  it('the ruling 2020-04-17: {2} becomes {1}, and {1}{G} becomes {G} (only the generic mana is reduced, never below one mana)', () => {
    const TWO = card('Test Two', 'Artifact', '{2}: You gain 1 life.');
    const COLORED = card('Test Colored', 'Artifact', '{1}{G}: You gain 1 life.');
    const afford = (name: string, mana: string): boolean => {
      const s = scenario([], { p1: { battlefield: ['Test Zirda', name] }, defs: [...defs, TWO, COLORED] });
      give(s, 'p1', mana);
      return legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.object === find(s, name, 'battlefield', 'p1'));
    };
    expect(afford('Test Two', 'G')).toBe(true);
    expect(afford('Test Colored', 'G')).toBe(true);
    expect(afford('Test Colored', 'R')).toBe(false);
  });
  it('a mana ability is not changed by it', () => {
    expect(hits('Test Source', true)).toBe(0);
  });
  it("an opponent's abilities are not changed", () => {
    const s = scenario([], { p1: { battlefield: ['Test Zirda'] }, p2: { battlefield: ['Test Pump'] }, defs });
    give(s, 'p2', 'G');
    const t = pass(s);
    expect(legalActions(t, 'p2').some((l) => l.kind === 'activate')).toBe(false);
  });
});

describe('CR 701.6a, 603.2: "Whenever a spell or ability you control counters a spell" (Baral, Chief of Compliance)', () => {
  const BARAL = card('Test Counterkeeper', 'Creature — Wizard', 'Whenever a spell or ability you control counters a spell, you gain 2 life.', { pt: ['1', '3'] });
  const NOPE = card('Test Nope', 'Instant', 'Counter target spell.');
  const STIFLE = card('Test Stifle', 'Instant', 'Counter target activated ability.');
  const CHARM = card('Test Charm', 'Artifact', '{0}: You gain 1 life.');
  const FLASHROCK = card('Test Flashrock', 'Artifact', 'Flash');
  const defs = [BARAL, NOPE, STIFLE, BEAR, ROCK, CHARM, FLASHROCK];
  const life = (s: GameState, p: 'p1' | 'p2'): number => s.players[p === 'p1' ? 0 : 1]!.life;
  it('is automated', () => { expect(BARAL.automation.level).toBe('full'); });
  it("your counterspell of the opponent's spell triggers it: you gain 2 life", () => {
    let s = scenario([], { p1: { battlefield: ['Test Counterkeeper'], hand: ['Test Nope'] }, p2: { hand: ['Test Flashrock'] }, defs });
    s = pass(s); // p2 gets priority in the first main phase and casts a spell with flash
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flashrock', 'hand', 'p2') }));
    const rock = s.zones.stack[0]!;
    s = pass(s);
    s = resolveAll(castTargeting(s, 'Test Nope', [rock]));
    expect(inYard(s, 'p2', 'Test Flashrock')).toBe(true); // it was countered
    expect(life(s, 'p1')).toBe(22);
  });
  it("an opponent's counterspell of your spell does not trigger it", () => {
    let s = scenario([], { p1: { battlefield: ['Test Counterkeeper'], hand: ['Test Rock'] }, p2: { hand: ['Test Nope'] }, defs });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rock', 'hand', 'p1') }));
    const rock = s.zones.stack[0]!;
    s = pass(s);
    s = resolveAll(castTargeting(s, 'Test Nope', [rock], 'p2'));
    expect(inYard(s, 'p1', 'Test Rock')).toBe(true); // it was countered
    expect(life(s, 'p1')).toBe(20); // and the ability did not trigger
  });
  it("a counterspell of yours that counters your own spell triggers it too (a spell you control counters a spell)", () => {
    let s = scenario([], { p1: { battlefield: ['Test Counterkeeper'], hand: ['Test Rock', 'Test Nope'] }, defs });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rock', 'hand', 'p1') }));
    const rock = s.zones.stack[0]!;
    s = resolveAll(castTargeting(s, 'Test Nope', [rock]));
    expect(inYard(s, 'p1', 'Test Rock')).toBe(true);
    expect(life(s, 'p1')).toBe(22);
  });
  it('countering an ability does not trigger it (it counters a spell only)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Counterkeeper', 'Test Charm'], hand: ['Test Stifle'] }, defs });
    const charm = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === find(s, 'Test Charm', 'battlefield', 'p1'))!;
    s = settle(act(s, charm.action));
    const ability = s.zones.stack[0]!;
    s = resolveAll(castTargeting(s, 'Test Stifle', [ability]));
    expect(life(s, 'p1')).toBe(20); // the Charm's life gain never happened, and neither did the trigger
  });
});
