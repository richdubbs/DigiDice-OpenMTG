/**
 * Card wave 2, slice s14 (std-rx13): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 502.3              "You may choose not to untap ~ during your untap step": its controller chooses, in their own untap step, whether it stays tapped; the
 *                         other permanents untap as usual; an opponent's untap step never asks
 *   CR 122.1d, 502.3      a stunned permanent its controller keeps tapped keeps its stun counter (it didn't untap)
 *   CR 603.2, 603.4       "Whenever a counter is put on a creature you control, ... This ability triggers only once each turn": any kind of counter, on a creature of
 *                         yours only, once a turn
 *   CR 603.7c, 608.2c     "Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, ...": the player is the one chosen,
 *                         fixed as the delayed trigger is created; it ends with the turn (CR 514.2)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const treasures = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token');

/**
 * Plays on until `turn` reaches its `step`: no attacks or blocks unless `attackers` names them (attacking p2), costs paid automatically, a target choice answered
 * with `targets`, and every "choose permanents not to untap" decision answered with `keep` (recording who was asked).
 */
function playTo(s0: GameState, turn: number, step: GameState['turn']['step'], o: { keep?: ObjectId[]; asked?: PlayerId[]; attackers?: ObjectId[]; targets?: TargetChoice[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 600 && !(s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority'); guard++) {
    const d = s.pending;
    if (!d) break;
    if (d.kind === 'chooseObjects' && d.rules?.includes('CR 502.3')) {
      o.asked?.push(d.player);
      s = answer(s, { kind: 'chooseObjects', ids: (o.keep ?? []).filter((id) => d.options.includes(id)) });
    } else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: s.turn.activePlayer === 'p1' ? (o.attackers ?? []).map((attacker) => ({ attacker, defender: 'p2' })) : [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

describe('CR 502.3: "You may choose not to untap ~ during your untap step."', () => {
  const VAULT = card('Test Quiet Vault', 'Artifact', 'You may choose not to untap this artifact during your untap step.\n{T}: You gain 1 life.');
  const ROCK = card('Test Plain Rock', 'Artifact', '{T}: You gain 1 life.');
  const DEFS = [VAULT, ROCK];
  const tapped = (s: GameState, ...ids: ObjectId[]): void => { for (const id of ids) s.objects[id]!.tapped = true; };
  it('is automated', () => {
    expect(full(VAULT)).toBe(true);
  });
  it('its controller keeps it tapped in their untap step; the other permanents untap; the opponent\'s untap step does not ask', () => {
    let s = scenario([], { p1: { battlefield: ['Test Quiet Vault', 'Test Plain Rock'] }, defs: DEFS });
    const vault = find(s, 'Test Quiet Vault', 'battlefield', 'p1');
    const rock = find(s, 'Test Plain Rock', 'battlefield', 'p1');
    tapped(s, vault, rock);
    const asked: PlayerId[] = [];
    s = playTo(s, 3, 'upkeep', { keep: [vault], asked });
    expect(asked).toEqual(['p1']); // turn 2 is p2's: nothing of p2's has the ability
    expect(s.objects[vault]!.tapped).toBe(true);
    expect(s.objects[rock]!.tapped).toBe(false);
  });
  it('choosing nothing untaps it as usual', () => {
    let s = scenario([], { p1: { battlefield: ['Test Quiet Vault'] }, defs: DEFS });
    const vault = find(s, 'Test Quiet Vault', 'battlefield', 'p1');
    tapped(s, vault);
    s = playTo(s, 3, 'upkeep', { keep: [] });
    expect(s.objects[vault]!.tapped).toBe(false);
  });
  it('an untapped one, or one an effect keeps tapped anyway, is not offered', () => {
    let s = scenario([], { p1: { battlefield: ['Test Quiet Vault'] }, defs: DEFS });
    const asked: PlayerId[] = [];
    s = playTo(s, 3, 'upkeep', { asked });
    expect(asked).toEqual([]);
  });
  it('CR 122.1d: a stunned one kept tapped keeps its stun counter; one not kept loses the counter instead of untapping', () => {
    for (const keep of [true, false]) {
      let s = scenario([], { p1: { battlefield: ['Test Quiet Vault'] }, defs: DEFS });
      const vault = find(s, 'Test Quiet Vault', 'battlefield', 'p1');
      tapped(s, vault);
      s.objects[vault]!.counters = { stun: 1 };
      s = playTo(s, 3, 'upkeep', { keep: keep ? [vault] : [] });
      expect(s.objects[vault]!.tapped, String(keep)).toBe(true);
      expect(s.objects[vault]!.counters?.['stun'] ?? 0, String(keep)).toBe(keep ? 1 : 0);
    }
  });
});

describe('CR 603.2, 603.4: "Whenever a counter is put on a creature you control, draw a card. This ability triggers only once each turn."', () => {
  const ENGINE = card('Test Ledger Engine', 'Enchantment', 'Whenever a counter is put on a creature you control, draw a card. This ability triggers only once each turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
  const SHIELD = card('Test Shield Word', 'Instant', 'Put a shield counter on target creature.');
  const DEFS = [ENGINE, BEAR, GROW, SHIELD];
  const castAt = (s0: GameState, name: string, target: ObjectId): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let guard = 0; guard < 40 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => {
    expect(full(ENGINE)).toBe(true);
  });
  it('any kind of counter on a creature you control triggers it, once each turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ledger Engine', 'Test Bear'], hand: ['Test Shield Word', 'Test Grow'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const before = hand(s, 'p1');
    s = castAt(s, 'Test Shield Word', bear); // a shield counter: one card drawn, one spell gone
    expect(hand(s, 'p1')).toBe(before);
    s = castAt(s, 'Test Grow', bear); // the second counter this turn: no trigger
    expect(hand(s, 'p1')).toBe(before - 1);
  });
  it('a counter on an opponent\'s creature does not trigger it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ledger Engine'], hand: ['Test Grow'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const before = hand(s, 'p1');
    s = castAt(s, 'Test Grow', find(s, 'Test Bear', 'battlefield', 'p2'));
    expect(hand(s, 'p1')).toBe(before - 1);
  });
});

describe('CR 603.7c, 608.2c: "Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token."', () => {
  const HEIST = card('Test Rail Job', 'Instant', 'Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token.');
  const RAIDER = card('Test Raider', 'Creature — Human Rogue', 'Haste', ['2', '2']);
  const DEFS = [HEIST, RAIDER];
  const heist = (s0: GameState): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rail Job', 'hand', 'p1') });
    for (let guard = 0; guard < 40 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    return s;
  };
  it('is automated; the delayed trigger names the chosen player, fixed as it is created', () => {
    expect(full(HEIST)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Raider'], hand: ['Test Rail Job'] }, defs: DEFS });
    s = heist(s);
    expect(s.delayedTriggers).toHaveLength(1);
    expect(JSON.stringify(s.delayedTriggers[0]!.when)).toContain('"p2"');
  });
  it('combat damage to that player this turn makes one tapped Treasure for each creature that deals it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Raider', 'Test Raider'], hand: ['Test Rail Job'] }, defs: DEFS });
    s = heist(s);
    s = playTo(s, 1, 'end', { attackers: named(s, 'Test Raider') });
    const made = treasures(s, 'p1');
    expect(made).toHaveLength(2);
    for (const id of made) expect(s.objects[id]!.tapped).toBe(true);
  });
  it('CR 514.2: the next turn\'s combat damage does not trigger it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Raider'], hand: ['Test Rail Job'] }, defs: DEFS });
    s = heist(s);
    s = playTo(s, 3, 'end', { attackers: named(s, 'Test Raider') });
    expect(treasures(s, 'p1')).toHaveLength(1); // the attack of turn 1 only (the Raider attacks on turn 3 too)
  });
});
