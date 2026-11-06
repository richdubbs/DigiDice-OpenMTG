/**
 * Commander lane `rest`, round edh-next-69: the engine behavior of the round, played through the engine with synthetic cards (design 6.10). CR cites are from memory
 * (no rules/cr in a cloud session) and named in the record as unverified.
 *
 *   CR 702.47a-c   Splice onto Arcane {cost}: a card with splice in the hand is revealed as an Arcane spell is cast and its splice cost paid; its text is added to the
 *                  spell (after the spell's own); the card stays in the hand
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', colors: string[] = [], extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...extra } as OracleCard);
}
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const inHand = (s: GameState, name: string): boolean => s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]?.name === name);

/** Answer decisions until the stack is empty and nothing but priority is pending; `splice` answers the yes/no of a splice offer. */
function settle(s0: GameState, splice = true): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const d = s.pending!;
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: splice });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: splice ? [(d as unknown as { options: string[] }).options[0]!] : [] });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const castAndResolve = (s0: GameState, name: string, splice = true): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), splice);

describe('CR 702.47a-c: splice onto Arcane', () => {
  const ARCANE = card('Test Arcane Gain', 'Instant — Arcane', 'You gain 2 life.', '{0}');
  const PLAIN = card('Test Plain Gain', 'Instant', 'You gain 1 life.', '{0}');
  const SPLICE = card('Test Splice Gain', 'Instant — Arcane', 'You gain 5 life.\nSplice onto Arcane {1}', '{1}');
  const DUO = card('Test Splice Loss', 'Instant — Arcane', 'Each opponent loses 3 life.\nSplice onto Arcane {1}', '{1}');
  const defs = [ARCANE, PLAIN, SPLICE, DUO];
  it('is parsed and automated', () => {
    expect(SPLICE.automation.level).toBe('full');
    expect(SPLICE.faces[0]!.abilities.some((a) => a.kind === 'keyword' && a.keyword === 'splice')).toBe(true);
  });
  it('an Arcane spell cast with the card revealed: the spliced text is added after the spell\'s own, the cost is paid, the card stays in the hand', () => {
    const s = castAndResolve(scenario(['Island'], { p1: { hand: ['Test Arcane Gain', 'Test Splice Gain'], battlefield: ['Island'] }, defs }), 'Test Arcane Gain');
    expect(life(s, 'p1')).toBe(20 + 2 + 5);
    expect(inHand(s, 'Test Splice Gain')).toBe(true);
    expect(inHand(s, 'Test Arcane Gain')).toBe(false);
    expect(s.objects[find(s, 'Island', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(s.zones.stack.length).toBe(0);
  });
  it('declined: nothing is added and no cost is paid (the negative case)', () => {
    const s = castAndResolve(scenario(['Island'], { p1: { hand: ['Test Arcane Gain', 'Test Splice Gain'], battlefield: ['Island'] }, defs }), 'Test Arcane Gain', false);
    expect(life(s, 'p1')).toBe(22);
    expect(s.objects[find(s, 'Island', 'battlefield', 'p1')]!.tapped).toBeFalsy();
  });
  it('a spell that is not Arcane is offered no splice (the negative case)', () => {
    const s = castAndResolve(scenario(['Island'], { p1: { hand: ['Test Plain Gain', 'Test Splice Gain'], battlefield: ['Island'] }, defs }), 'Test Plain Gain');
    expect(life(s, 'p1')).toBe(21);
  });
  it('the splice cost cannot be paid: the spell is cast without it (the negative case)', () => {
    const s = castAndResolve(scenario([], { p1: { hand: ['Test Arcane Gain', 'Test Splice Gain'], battlefield: [] }, defs }), 'Test Arcane Gain');
    expect(life(s, 'p1')).toBe(22);
  });
  it('the spliced card is not cast: it triggers nothing and a spell without it in hand adds nothing', () => {
    const s = castAndResolve(scenario(['Island'], { p1: { hand: ['Test Arcane Gain'], battlefield: ['Island'] }, defs }), 'Test Arcane Gain');
    expect(life(s, 'p1')).toBe(22);
  });

  // A splice whose text has a target: the target is chosen as the spell is cast (CR 601.2c), after the spell's own, and the spell is lost if it can't be (CR 702.47b)
  const HOST = card('Test Arcane Drain', 'Instant — Arcane', 'Target player loses 1 life.', '{0}');
  const ZAP = card('Test Splice Zap', 'Instant — Arcane', 'Test Splice Zap deals 2 damage to target creature.\nSplice onto Arcane {R}', '{R}', ['R']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['G'], { power: '2', toughness: '3' });
  const TARGETS = [HOST, ZAP, BEAR];
  const castWithTargets = (s0: GameState, name: string, picks: { kind: 'object' | 'player'; id: string }[], splice = true): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let guard = 0; guard < 30 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [picks.shift()!] as never });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: splice });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: splice ? [(d as unknown as { options: string[] }).options[0]!] : [] });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return settle(s, splice);
  };
  it('the spliced text takes its target as the spell is cast, and both parts play (the spell\'s own first)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Arcane Drain', 'Test Splice Zap'], battlefield: ['Mountain'] }, p2: { battlefield: ['Test Bear'] }, defs: TARGETS });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = castWithTargets(s0, 'Test Arcane Drain', [{ kind: 'player', id: 'p2' }, { kind: 'object', id: bear }]);
    expect(life(s, 'p2')).toBe(19);
    expect(s.objects[bear]!.damage).toBe(2);
    expect(inHand(s, 'Test Splice Zap')).toBe(true);
  });
  it('declined: only the spell\'s own target is chosen and the creature is untouched (the negative case)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Arcane Drain', 'Test Splice Zap'], battlefield: ['Mountain'] }, p2: { battlefield: ['Test Bear'] }, defs: TARGETS });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = castWithTargets(s0, 'Test Arcane Drain', [{ kind: 'player', id: 'p2' }], false);
    expect(life(s, 'p2')).toBe(19);
    expect(s.objects[bear]!.damage ?? 0).toBe(0);
  });
  it('no creature to target: the spliced text can\'t be chosen, so it is not offered and the spell is cast without it (the negative case)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Arcane Drain', 'Test Splice Zap'], battlefield: ['Mountain'] }, defs: TARGETS });
    const s = castWithTargets(s0, 'Test Arcane Drain', [{ kind: 'player', id: 'p2' }]);
    expect(life(s, 'p2')).toBe(19);
    expect(s.objects[find(s, 'Mountain', 'battlefield', 'p1')]!.tapped).toBeFalsy();
  });
  // CR 702.47a: any number of cards may be spliced, each paying its own cost
  it('two cards spliced onto one spell: both costs are paid and both texts are added', () => {
    const s = castAndResolve(scenario(['Island', 'Island'], { p1: { hand: ['Test Arcane Gain', 'Test Splice Gain', 'Test Splice Loss'], battlefield: ['Island', 'Island'] }, defs }), 'Test Arcane Gain');
    expect(life(s, 'p1')).toBe(27);
    expect(life(s, 'p2')).toBe(17);
    expect(inHand(s, 'Test Splice Gain') && inHand(s, 'Test Splice Loss')).toBe(true);
  });
  it('two cards in hand, mana for one: only one can be spliced (the cost of the second must be payable too)', () => {
    const s = castAndResolve(scenario(['Island'], { p1: { hand: ['Test Arcane Gain', 'Test Splice Gain', 'Test Splice Loss'], battlefield: ['Island'] }, defs }), 'Test Arcane Gain');
    expect(life(s, 'p1') + (20 - life(s, 'p2'))).toBeLessThanOrEqual(20 + 2 + 5 + 3);
    expect([life(s, 'p1') === 27, life(s, 'p2') === 17].filter(Boolean).length).toBe(1);
  });

  // a splice cost that is not mana (Veil of Secrecy): "Splice onto Arcane--Return a blue creature you control to its owner's hand."
  const VEIL = card('Test Splice Veil', 'Instant — Arcane', 'You gain 4 life.\nSplice onto Arcane—Return a blue creature you control to its owner\'s hand.', '{U}', ['U']);
  const SEA_BEAR = card('Test Sea Bear', 'Creature — Bear', '', '{1}{U}', ['U'], { power: '2', toughness: '2' });
  it('a splice cost that returns a blue creature to its owner\'s hand: the creature returns and the text is added', () => {
    const s = castAndResolve(scenario([], { p1: { hand: ['Test Arcane Gain', 'Test Splice Veil'], battlefield: ['Test Sea Bear'] }, defs: [...defs, VEIL, SEA_BEAR] }), 'Test Arcane Gain');
    expect(life(s, 'p1')).toBe(26);
    expect(inHand(s, 'Test Sea Bear')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Sea Bear')).toBe(false);
  });
  it('no blue creature to return: the splice is not offered (the negative case)', () => {
    const s = castAndResolve(scenario([], { p1: { hand: ['Test Arcane Gain', 'Test Splice Veil'], battlefield: [] }, defs: [...defs, VEIL, SEA_BEAR] }), 'Test Arcane Gain');
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 701.21a, 101.2, 109.5: "Spells and abilities your opponents control can\'t cause you to sacrifice permanents" (sta.edhn69.cantCauseSacrifice.opponents)', () => {
  const WARDEN = card('Test Sacrifice Warden', 'Creature — Angel', 'Spells and abilities your opponents control can\'t cause you to sacrifice permanents.', '{0}', ['W'], { power: '1', toughness: '1' });
  const SWEEP = card('Test Each Sacrifices', 'Sorcery', 'Each player sacrifices a creature.', '{0}');
  const BEAR2 = card('Test Grizzly', 'Creature — Bear', '', '{0}', ['G'], { power: '2', toughness: '2' });
  const defs = [WARDEN, SWEEP, BEAR2];
  const onBf = (s: GameState, name: string, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]?.name === name).length;
  const play = (s0: GameState): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Each Sacrifices', 'hand', 'p1') });
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as unknown as { options: string[] }).options.slice(0, 1) });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('is parsed and automated', () => { expect(WARDEN.automation.level).toBe('full'); });
  it('an opponent\'s spell makes the protected player sacrifice nothing, while its caster sacrifices (the opponent has the creature to lose)', () => {
    const s = play(scenario([], { p1: { hand: ['Test Each Sacrifices'], battlefield: ['Test Grizzly'] }, p2: { battlefield: ['Test Sacrifice Warden'] }, defs }));
    expect(onBf(s, 'Test Sacrifice Warden', 'p2')).toBe(1);
    expect(onBf(s, 'Test Grizzly', 'p1')).toBe(0);
  });
  it('the protected player\'s own spell makes them sacrifice (the negative case: only opponents\' spells and abilities are stopped)', () => {
    const s = play(scenario([], { p1: { hand: ['Test Each Sacrifices'], battlefield: ['Test Sacrifice Warden'] }, p2: { battlefield: ['Test Grizzly'] }, defs }));
    expect(onBf(s, 'Test Sacrifice Warden', 'p1')).toBe(0);
    expect(onBf(s, 'Test Grizzly', 'p2')).toBe(0);
  });
  it('another player without the permanent sacrifices as usual (the negative case)', () => {
    const s = play(scenario([], { p1: { hand: ['Test Each Sacrifices'], battlefield: ['Test Grizzly'] }, p2: { battlefield: ['Test Grizzly'] }, defs }));
    expect(onBf(s, 'Test Grizzly', 'p2')).toBe(0);
  });
});

describe('CR 603.7, 603.7c: "you may A at the beginning of the next end step" and "If you do, return it ... at the beginning of your next upkeep. It gains haste." (chart cuts mayAroundDelayTail, delayTailAroundIf)', () => {
  const GHOST = card('Test Ghost Council', 'Creature — Spirit', 'At the beginning of your end step, you may exile ~. If you do, return it to the battlefield under its owner\'s control at the beginning of your next upkeep.', '{0}', ['B'], { power: '4', toughness: '4' });
  const HASTY = card('Test Hasty Ghost', 'Creature — Spirit', 'At the beginning of your end step, you may exile ~. If you do, return it to the battlefield under its owner\'s control at the beginning of your next upkeep. It gains haste.', '{0}', ['B'], { power: '4', toughness: '4' });
  const MAYOR = card('Test Caretaker', 'Creature — Angel', 'Whenever a creature you control dies, you may return that card to its owner\'s hand at the beginning of the next end step.', '{0}', ['W'], { power: '1', toughness: '1' });
  const FOODIE = card('Test Doomed Bear', 'Creature — Bear', '', '{0}', ['G'], { power: '1', toughness: '1' });
  const defs = [GHOST, MAYOR, FOODIE];
  const names = (s: GameState, zone: 'battlefield' | 'hand' | 'exile' | 'graveyard'): string[] => (zone === 'battlefield' || zone === 'exile'
    ? (s.zones[zone] as string[]) : (s.zones[zone]['p1'] as string[])).map((id) => s.defs[s.objects[id]!.defId]?.name ?? '?');
  const settleYes = (s0: GameState, yes: boolean): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const d = s.pending;
      if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('both are parsed and automated', () => { expect(GHOST.automation.level).toBe('full'); expect(MAYOR.automation.level).toBe('full'); });
  it('exiled at the end step, it returns at the beginning of its controller\'s next upkeep (not before), (the haste sentence after a delayed return is not read: the negative case below)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ghost Council'] }, defs });
    s = advanceTo(s, 1, 'end');
    s = settleYes(s, true);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settleYes(pass(s), true);
    expect(names(s, 'battlefield')).not.toContain('Test Ghost Council');
    expect(names(s, 'exile')).toContain('Test Ghost Council');
    s = advanceTo(s, 3, 'upkeep');
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settleYes(pass(s), true);
    expect(names(s, 'battlefield')).toContain('Test Ghost Council');
  });
  // edh-next-79 (parser/lower/delay-tail.ts#foldReturnedTail): the sentence after the delayed return is read as an instruction of the delayed trigger, done to the object that came back
  // (the played test is in cloud/edh-next-79); before, the ability stayed partial here
  it('"It gains haste" after a delayed return is an instruction of the delayed trigger (edh-next-79): the ability is automated', () => {
    expect(HASTY.automation.level).toBe('full');
  });
  it('declined: it stays and is not exiled or returned (the negative case)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ghost Council'] }, defs });
    s = advanceTo(s, 1, 'end');
    s = settleYes(s, false);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settleYes(pass(s), false);
    expect(names(s, 'battlefield')).toContain('Test Ghost Council');
    expect(names(s, 'exile')).not.toContain('Test Ghost Council');
  });
});

describe('CR 701.21a, 101.2: the same ban stops a sacrifice an opponent\'s spell offers as an "unless" payment (Sigarda ruling 2018-12-07)', () => {
  const WARDEN = card('Test Sacrifice Warden', 'Creature — Angel', 'Spells and abilities your opponents control can\'t cause you to sacrifice permanents.', '{0}', ['W'], { power: '1', toughness: '1' });
  const TAX = card('Test Sacrifice Tax', 'Sorcery', 'Target opponent loses 3 life unless they sacrifice a creature.', '{0}');
  const BEAR3 = card('Test Grizzly', 'Creature — Bear', '', '{0}', ['G'], { power: '2', toughness: '2' });
  const defs = [WARDEN, TAX, BEAR3];
  const run = (s0: GameState): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sacrifice Tax', 'hand', 'p1') });
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] as never });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as unknown as { options: string[] }).options.slice(0, 1) });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  const count = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name).length;
  it('the protected player cannot take the sacrifice option: the life is lost and the permanent stays', () => {
    const s = run(scenario([], { p1: { hand: ['Test Sacrifice Tax'] }, p2: { battlefield: ['Test Sacrifice Warden'] }, defs }));
    expect(life(s, 'p2')).toBe(17);
    expect(count(s, 'Test Sacrifice Warden')).toBe(1);
  });
  it('without the ban the same player may sacrifice instead (the negative case)', () => {
    const s = run(scenario([], { p1: { hand: ['Test Sacrifice Tax'] }, p2: { battlefield: ['Test Grizzly'] }, defs }));
    expect(life(s, 'p2')).toBe(20);
    expect(count(s, 'Test Grizzly')).toBe(0);
  });
});

