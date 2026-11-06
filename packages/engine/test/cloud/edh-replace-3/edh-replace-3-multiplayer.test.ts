/**
 * Commander lane edh-replace, round edh-replace-3: the readings that need more than two players, played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler (Commander is a four-player game). CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 603.2c, 510.2          "Whenever one or more creatures you control deal combat damage to one or more players, ..." (one trigger for the whole combat damage step)
 *   CR 603.4, 608.2h, 102.3   "Whenever ~ deals combat damage to an opponent, it deals that much damage to each other opponent if ~'s power is 7 or greater."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** p1 declares the attacks, nobody blocks, and the game goes on to the end of combat (triggers ordered as listed, targets the first option). */
function fight(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], order: (ids: string[]) => string[] = (ids) => ids): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending!;
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: order(d.items.map((x) => x.id)) });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object' as const, id: [...d.objects][0]! }] });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('CR 603.4, 608.2h, 102.3: "Whenever ~ deals combat damage to an opponent, it deals that much damage to each other opponent if ~\'s power is 7 or greater."', () => {
  const ATONER = card('Test Vengeful Brute', 'Creature — Human Warrior', "Whenever this creature deals combat damage to an opponent, it deals that much damage to each other opponent if this creature's power is 7 or greater.", ['3', '3']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [ATONER, BEAR];
  it('is automated', () => expect(full(ATONER)).toBe(true));
  it('power 7 or more: the damage dealt to the attacked opponent is also dealt, as much, to each OTHER opponent (not to the attacked one twice, not to you)', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Vengeful Brute', counters: { '+1/+1': 4 } }] } } });
    s = fight(s, [{ attacker: find(s, 'Test Vengeful Brute', 'battlefield', 'p1'), defender: 'p2' }]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20 - 7, 20 - 7, 20 - 7]);
  });
  it('power 6: only the attacked opponent is dealt damage; another creature of yours dealing combat damage does not trigger it', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Vengeful Brute', counters: { '+1/+1': 3 } }, 'Test Plain Bear'] } } });
    s = fight(s, [{ attacker: find(s, 'Test Vengeful Brute', 'battlefield', 'p1'), defender: 'p2' }]);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20 - 6, 20, 20]);
    let t = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Vengeful Brute', counters: { '+1/+1': 4 }, since: 99 }, 'Test Plain Bear'] } } });
    t = fight(t, [{ attacker: find(t, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p2' }]);
    expect([lifeOf(t, 'p2'), lifeOf(t, 'p3'), lifeOf(t, 'p4')]).toEqual([20 - 2, 20, 20]);
  });
});

describe('CR 608.2h: if the creature is gone as the ability resolves, its power as it last existed on the battlefield decides (the Vincent ruling)', () => {
  const ATONER = card('Test Vengeful Brute', 'Creature — Human Warrior', "Whenever this creature deals combat damage to an opponent, it deals that much damage to each other opponent if this creature's power is 7 or greater.", ['3', '3']);
  const DOOM = card('Test Doom Spell', 'Instant', 'Destroy target creature.');
  it('destroyed in response with power 7: the trigger still deals the damage to each other opponent; with power 6 it does not', () => {
    const run = (plus: number): number[] => {
      let s = mpScenario({ defs: [ATONER, DOOM], zones: { p1: { battlefield: [{ name: 'Test Vengeful Brute', counters: { '+1/+1': plus } }] }, p2: { hand: ['Test Doom Spell'] } } });
      const brute = find(s, 'Test Vengeful Brute', 'battlefield', 'p1');
      s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: brute, defender: 'p2' }] });
      for (let i = 0; i < 100 && s.zones.stack.length === 0; i++) {
        const d = s.pending!;
        if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
        else if (d.kind === 'priority') s = pass(s);
        else throw new Error(`unexpected ${d.kind}`);
      }
      expect(s.zones.stack).toHaveLength(1); // the trigger
      s = pass(s); // p1 passes; p2 may respond
      expect(s.pending?.player).toBe('p2');
      s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Doom Spell', 'hand', 'p2') });
      for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
        s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: brute }] }) : answer(s, { kind: 'payCost', auto: true });
      }
      for (let i = 0; i < 100 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'priority' ? pass(s) : (() => { throw new Error(`unexpected ${s.pending?.kind}`); })();
      expect(s.zones.battlefield).not.toContain(brute);
      return [lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')];
    };
    expect(run(4)).toEqual([20 - 7, 20 - 7, 20 - 7]);
    expect(run(3)).toEqual([20 - 6, 20, 20]);
  });
});

describe('CR 603.4, 608.2h: the power is judged when the ability resolves ("it only matters what its power is when the ability resolves", the Vincent ruling)', () => {
  const GROWER = card('Test Growing Brute', 'Creature — Human Warrior', "Whenever one or more creatures you control deal combat damage to a player, put a +1/+1 counter on this creature.\nWhenever this creature deals combat damage to an opponent, it deals that much damage to each other opponent if this creature's power is 7 or greater.", ['3', '3']);
  it('at power 6 the two triggers resolve in the order their controller chose: with the counter first the power is 7 as the damage ability resolves (6 damage to each other opponent), after it it is still 6 (none)', () => {
    const run = (order: (ids: string[]) => string[]): number[] => {
      let s = mpScenario({ defs: [GROWER], zones: { p1: { battlefield: [{ name: 'Test Growing Brute', counters: { '+1/+1': 3 } }] } } });
      s = fight(s, [{ attacker: find(s, 'Test Growing Brute', 'battlefield', 'p1'), defender: 'p2' }], order);
      expect(counters(s, find(s, 'Test Growing Brute', 'battlefield', 'p1'))).toBe(4);
      return [lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')];
    };
    const forward = run((ids) => ids);
    const backward = run((ids) => [...ids].reverse());
    expect(forward[0]).toBe(20 - 6);
    expect(backward[0]).toBe(20 - 6);
    expect([forward[1], backward[1]].sort()).toEqual([20 - 6, 20]); // exactly one order lets the counter in first
    expect([forward[2], backward[2]].sort()).toEqual([20 - 6, 20]);
  });
});

describe('CR 603.2c, 510.2, 120.2b: "Whenever one or more creatures you control deal combat damage to one or more players, proliferate."', () => {
  const GRAFTER = card('Test Spreading Beast', 'Creature — Beast', 'Whenever one or more creatures you control deal combat damage to a player, put a +1/+1 counter on this creature.', ['2', '2']);
  const GRAFTER_WHOLE = card('Test Whole Beast', 'Creature — Beast', 'Whenever one or more creatures you control deal combat damage to one or more players, put a +1/+1 counter on this creature.', ['2', '2']);
  const PLAIN = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [GRAFTER, GRAFTER_WHOLE, PLAIN];
  it('is automated', () => expect(full(GRAFTER_WHOLE)).toBe(true));
  it('creatures dealing combat damage to Bob and to Carol at once trigger it ONCE (one counter), whereas "to a player" triggers once for each player', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Whole Beast', since: 0 }, 'Test Plain Bear'] } } });
    s = fight(s, [{ attacker: find(s, 'Test Whole Beast', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p3' }]);
    expect(counters(s, find(s, 'Test Whole Beast', 'battlefield', 'p1'))).toBe(1);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20 - 2, 20 - 2, 20]);
    let t = mpScenario({ defs, zones: { p1: { battlefield: ['Test Spreading Beast', 'Test Plain Bear'] } } });
    t = fight(t, [{ attacker: find(t, 'Test Spreading Beast', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(t, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p3' }]);
    expect(counters(t, find(t, 'Test Spreading Beast', 'battlefield', 'p1'))).toBe(2); // "to a player": once for each player dealt damage (the older reading, unchanged)
  });
  it('a single attacked player or no combat damage: once, and not at all when nothing is dealt (a blocked attacker is no damage to a player)', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Whole Beast'] } } });
    s = fight(s, [{ attacker: find(s, 'Test Whole Beast', 'battlefield', 'p1'), defender: 'p2' }]);
    expect(counters(s, find(s, 'Test Whole Beast', 'battlefield', 'p1'))).toBe(1);
    const t = mpScenario({ defs, zones: { p1: { battlefield: ['Test Whole Beast'] } } });
    const t2 = passUntil(t, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(counters(t2, find(t2, 'Test Whole Beast', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 607.2d, 614.12a: "As ~ enters, choose an opponent / a player." and "the chosen player" in a four-player game (parser/holes/player.ts: the chosen player is the link of std-control-1)', () => {
  const RACK = card('Test Torture Rack', 'Artifact', "As this artifact enters, choose an opponent.\nAt the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in their hand.");
  const SASKIA = card('Test Mirror Warlord', 'Creature — Human Soldier', "As this creature enters, choose a player.\nWhenever a creature you control deals combat damage to a player, it deals that much damage to the chosen player.", ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [RACK, SASKIA, BEAR];
  const choose = (s0: GameState, name: string, chosen: PlayerId): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(pass(pass(s)))); // all four players pass: it resolves
    expect(s.pending?.kind).toBe('chooseOption');
    return answer(s, { kind: 'chooseOption', ids: [chosen] });
  };
  it('are automated', () => { expect(full(RACK)).toBe(true); expect(full(SASKIA)).toBe(true); });
  it('the Rack hits only the chosen opponent, at ITS upkeep, for 3 minus the cards in hand; a hand of three or more takes nothing (a negative number is no damage)', () => {
    const run = (hand: number): number[] => {
      let s = mpScenario({ defs, zones: { p1: { hand: ['Test Torture Rack'] }, p2: { hand: Array(hand).fill('Plains') }, p3: { hand: Array(hand).fill('Plains') }, p4: { hand: Array(hand).fill('Plains') } } });
      s = choose(s, 'Test Torture Rack', 'p3');
      // on through the upkeeps of the three opponents (each player's upkeep trigger, if any, resolves)
      s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the second turn of p1', 900);
      return [lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')];
    };
    // the chosen player p3 had `hand` Plains in hand, then draws one at its draw step (after its upkeep, so the upkeep sees `hand`)
    expect(run(1)).toEqual([20, 20, 20 - 2, 20]);
    expect(run(3)).toEqual([20, 20, 20, 20]);
    expect(run(5)).toEqual([20, 20, 20, 20]);
  });
  it('"the chosen player" of "choose a player" may be yourself or an opponent: a creature of yours that damages a player also damages the chosen one (as much, once for each such creature)', () => {
    let s = mpScenario({ defs, zones: { p1: { hand: ['Test Mirror Warlord'], battlefield: [{ name: 'Test Plain Bear', since: 0 }] } } });
    s = choose(s, 'Test Mirror Warlord', 'p4');
    s = fight(s, [{ attacker: find(s, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p2' }]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20 - 2, 20, 20 - 2]);
  });
});

describe('CR 107.3, 601.2b: "Whenever ~ attacks, you may tap X untapped Myr you control. If you do, ~ gets +X/+0 until end of turn and deals X damage to the player or planeswalker it\'s attacking."', () => {
  const SPHERE = card('Test Swarm Engine', 'Artifact Creature — Construct', "Whenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.", ['4', '7']);
  const MYR = card('Test Tin Myr', 'Artifact Creature — Myr', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated', () => expect(full(SPHERE)).toBe(true));
  /** Attack p2 (or the planeswalker); answer the optional payment with X = n and tap the first n Myr offered (n < 0: decline). */
  function run(s0: GameState, n: number, defender: PlayerId = 'p2'): GameState {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Swarm Engine', 'battlefield', 'p1'), defender }] });
    for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: n >= 0 } as never);
      else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, n) });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
    }
    return s;
  }
  const defs = [SPHERE, MYR, BEAR];
  const board = ['Test Swarm Engine', 'Test Tin Myr', 'Test Tin Myr', 'Test Tin Myr', 'Test Plain Bear'];
  it('X = 2: two Myr are tapped, the creature gets +2/+0 and deals 2 damage to the attacked player on top of its combat damage', () => {
    const s = run(mpScenario({ defs, zones: { p1: { battlefield: board } } }), 2);
    const engine = find(s, 'Test Swarm Engine', 'battlefield', 'p1');
    expect(lifeOf(s, 'p2')).toBe(20 - 2 - (4 + 2));
    expect([lifeOf(s, 'p3'), lifeOf(s, 'p4'), lifeOf(s, 'p1')]).toEqual([20, 20, 20]);
    const tapped = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && o.tapped && o.id !== engine).length;
    expect(tapped).toBe(2);
    expect(s.objects[engine]!.tapped).toBe(true);
  });
  it('X = 0 or declining the payment: nothing happens besides the creature\'s own combat damage', () => {
    for (const n of [0, -1]) {
      const s = run(mpScenario({ defs, zones: { p1: { battlefield: board } } }), n);
      expect(lifeOf(s, 'p2')).toBe(20 - 4);
      expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && o.tapped && o.id !== find(s, 'Test Swarm Engine', 'battlefield', 'p1'))).toHaveLength(0);
    }
  });
  it('only untapped Myr can be tapped: with one Myr tapped already, X is at most 2, and the Bear is never offered', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Swarm Engine', { name: 'Test Tin Myr', tapped: true }, 'Test Tin Myr', 'Test Tin Myr', 'Test Plain Bear'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Swarm Engine', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 20 && s.pending!.kind !== 'chooseNumber'; i++) s = s.pending!.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: true } as never) : pass(s);
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 2 });
  });
});
