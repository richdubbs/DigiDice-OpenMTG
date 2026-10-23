/**
 * std-rx29 (wave 2, Standard lane rx29, computed quantities): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (names and wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c, 107.1b, 608.2h  "Choose exactly two creatures you control. You draw X cards and the chosen creatures get +X/+X ..., where X is the difference
 *                              between the chosen creatures' powers": the greater power less the lesser; one creature: 0
 *   CR 120.3, 603.10a, 400.7   "When this creature dies, create X ... tokens, where X is the amount of damage dealt to it this turn": the damage it was dealt
 *                              before it died, added up; destroyed without damage: none
 *   CR 613.4, 208.1, 608.2f    "for each creature you control with power greater than that creature's base power, put a number of +1/+1 counters on that
 *                              creature equal to the difference": only the creatures above their base, each by its own difference
 *   CR 701.21a, 608.2h, 608.2g "sacrifice any number of other creatures, then exile the top X cards of your library, where X is their total power" read as the
 *                              sacrificed creatures last existed (a counter counts); "you may cast any number of instant and/or sorcery spells from among the
 *                              exiled cards without paying their mana costs" casts only what you choose of those
 *   CR 111.1, 108.3, 608.2c    "Put a +1/+1 counter on that token for each permanent you own that your opponents control" after a reflexive token: the token
 *                              is the one created, the count is the permanents you own that an opponent controls
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { passUntil } from '../../m4/helpers';
import { attackWith, card, counters, full, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

const SPREE = card('Test Spree', 'Sorcery', "Choose exactly two creatures you control. You draw X cards and the chosen creatures get +X/+X and gain haste until end of turn, where X is the difference between the chosen creatures' powers.");
const COLONY = card('Test Colony', 'Creature — Rat', 'When this creature dies, create X 1/1 black Rat creature tokens, where X is the amount of damage dealt to it this turn.', ['1', '4']);
const SOVEREIGN = card('Test Sovereign', 'Creature — Cat', "Whenever this creature attacks, for each creature you control with power greater than that creature's base power, put a number of +1/+1 counters on that creature equal to the difference.", ['2', '2']);
const INVENTOR = card('Test Inventor', 'Creature — Wizard', 'Haste\nWhenever this creature attacks, sacrifice any number of other creatures, then exile the top X cards of your library, where X is their total power. You may cast any number of instant and/or sorcery spells from among the exiled cards without paying their mana costs.', ['1', '1']);
const HOST = card('Test Host', 'Creature — Monk', "At the beginning of combat on your turn, you may have target opponent gain control of target permanent you control. When you do, create a 1/1 white Ally creature token. Put a +1/+1 counter on that token for each permanent you own that your opponents control.", ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5']);
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to target creature.');
const END = card('Test End', 'Instant', 'Destroy target creature.');
const BREW = card('Test Brew', 'Instant', 'You gain 3 life.', undefined, '{5}');
const STONE = card('Test Stone', 'Artifact', '');
const DEFS = [SPREE, COLONY, SOVEREIGN, INVENTOR, HOST, BEAR, GIANT, SHOCK, END, BREW, STONE];

/** Play the beginning-of-combat trigger: the opponent and `stone` as its targets, then `yes` to its "you may". */
function hostTrigger(s0: GameState, stone: ObjectId, yes: boolean): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind !== 'priority' || x.zones.stack.length > 0, 'the combat trigger');
  for (let guard = 0; guard < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const d = s.pending!;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [(d as { players: string[] }).players.length > 0 ? { kind: 'player', id: 'p2' } : { kind: 'object', id: stone }] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'priority') s = pass(s);
    else s = settle(s);
  }
  return s;
}
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const castAt = (s: GameState, name: string, target: ObjectId): GameState =>
  resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), { targets: [{ kind: 'object', id: target }] });

describe('the synthetic cards are automated', () => {
  it('every synthetic card compiles fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 608.2c, 107.1b, 608.2h: "choose exactly two creatures you control" and "the difference between the chosen creatures\' powers"', () => {
  it('a 2/2 and a 5/5: you draw three cards and both get +3/+3', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Spree'], battlefield: ['Test Bear', 'Test Giant'] } });
    const before = handSize(s0) - 1;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spree', 'hand') }));
    expect(handSize(s)).toBe(before + 3);
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toBe('5/5');
    expect(pt(s, find(s, 'Test Giant', 'battlefield'))).toBe('8/8');
  });
  it('one creature only: it is chosen and the difference is 0 (no card, no bonus)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Spree'], battlefield: ['Test Giant'] } });
    const before = handSize(s0) - 1;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spree', 'hand') }));
    expect(handSize(s)).toBe(before);
    expect(pt(s, find(s, 'Test Giant', 'battlefield'))).toBe('5/5');
  });
});

describe('CR 120.3, 603.10a, 400.7: "where X is the amount of damage dealt to it this turn" in its own dies trigger', () => {
  it('dealt 2 and then 2 more, it dies to the second: four Rats', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock', 'Test Shock'], battlefield: ['Test Colony'] } });
    const colony = find(s, 'Test Colony', 'battlefield');
    s = castAt(s, 'Test Shock', colony);
    expect(tokens(s).length).toBe(0);
    s = castAt(s, 'Test Shock', colony);
    expect(s.zones.battlefield.includes(colony)).toBe(false);
    s = resolveAll(s);
    expect(tokens(s).length).toBe(4);
  });
  it('destroyed without being dealt damage: no Rat', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test End'], battlefield: ['Test Colony'] } });
    s = resolveAll(castAt(s, 'Test End', find(s, 'Test Colony', 'battlefield')));
    expect(tokens(s).length).toBe(0);
  });
});

describe('CR 613.4, 208.1, 608.2f: "for each creature you control with power greater than that creature\'s base power ... equal to the difference"', () => {
  it('a 2/2 with two +1/+1 counters gets two more; a plain 2/2 gets none', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sovereign', { name: 'Test Bear', counters: { '+1/+1': 2 } }, 'Test Giant'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(attackWith(s, [find(s, 'Test Sovereign', 'battlefield')]));
    expect(counters(s, bear, '+1/+1')).toBe(4);
    expect(counters(s, find(s, 'Test Giant', 'battlefield'), '+1/+1')).toBe(0);
    expect(counters(s, find(s, 'Test Sovereign', 'battlefield'), '+1/+1')).toBe(0);
  });
});

describe('CR 701.21a, 608.2h, 608.2g: "sacrifice any number of other creatures, then exile the top X cards ..., where X is their total power"', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Inventor', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Giant'], library: ['Test Brew', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  /** Attack, sacrifice `sac`, then cast `castIt` of the exiled cards (or none). */
  function run(s0: GameState, sac: string[], castIt: boolean): GameState {
    let s = attackWith(s0, [find(s0, 'Test Inventor', 'battlefield')]);
    for (let guard = 0; guard < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'chooseObjects') {
        const opts = (d as { options: ObjectId[] }).options;
        const sacrifice = opts.some((id) => s.zones.battlefield.includes(id));
        const ids = sacrifice ? opts.filter((id) => sac.includes(s.objects[id]!.defId)) : castIt ? opts.filter((id) => s.objects[id]!.defId === 'Test Brew') : [];
        s = answer(s, { kind: 'chooseObjects', ids });
      } else if (d.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    return s;
  }
  it('the 3/3 (a 2/2 with a counter, read as it last existed) and the 5/5: eight cards exiled, the instant among them cast for free', () => {
    const s0 = board();
    const life = s0.players.find((p) => p.id === 'p1')!.life;
    const s = run(s0, ['Test Bear', 'Test Giant'], true);
    expect(s.zones.exile.length).toBe(7);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 3);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Brew', 'Test Giant']);
  });
  it('nothing sacrificed: nothing exiled, nothing cast', () => {
    const s0 = board();
    const s = run(s0, [], true);
    expect(s.zones.exile.length).toBe(0);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(s0.players.find((p) => p.id === 'p1')!.life);
  });
  it('the instant exiled but not chosen stays in exile', () => {
    const s = run(board(), ['Test Giant'], false);
    expect(s.zones.exile.length).toBe(5);
  });
});

describe('CR 111.1, 108.3, 608.2c: "put a +1/+1 counter on that token for each permanent you own that your opponents control"', () => {
  it('giving the opponent one of your two artifacts: the token gets one counter (the artifact is yours and theirs to control)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Host', 'Test Stone', 'Test Stone'] } });
    const stone = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Stone')!;
    s = hostTrigger(s, stone, true);
    expect(s.objects[stone]!.controller).toBe('p2');
    const made = tokens(s);
    expect(made.length).toBe(1);
    expect(counters(s, made[0]!, '+1/+1')).toBe(1);
  });
  it('declining: no control change, no token', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Host', 'Test Stone'] } });
    const stone = find(s, 'Test Stone', 'battlefield');
    s = hostTrigger(s, stone, false);
    expect(s.objects[stone]!.controller).toBe('p1');
    expect(tokens(s).length).toBe(0);
  });
});
