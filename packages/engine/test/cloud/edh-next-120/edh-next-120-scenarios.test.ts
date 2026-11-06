/**
 * Must-finish round edh-next-120 (hidden and simultaneous choices, player choices): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names, design 6.10; the wordings are the cards' own where only one card prints them), in four-player games, each with its negative cases and the
 * Scryfall rulings of the card. CR cites checked against MagicCompRules 20260925 where marked "checked".
 *
 *   CR 608.2d, 101.4, 120.3      "Each player secretly chooses a number 0 or greater, then all players reveal those numbers simultaneously ..." (Wheel of Misfortune)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, viewFor, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { commanderScenario, inCommand, legend } from '../../m11/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { numbers?: number[]; options?: string[]; asked?: string[]; onAsk?: (s: GameState) => void; yes?: boolean[]; targets?: TargetChoice[][] }
/** Answer the decisions that come up until someone has priority: numbers and option labels in the order asked. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    script.onAsk?.(s);
    if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'chooseOption') {
      const want = script.options?.shift();
      const id = want === undefined ? p.options[0]!.id : p.options.find((o) => o.label === want)!.id;
      s = answer(s, { kind: 'chooseOption', ids: [id] });
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const gy = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;
const PLAYERS: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

// ---- Wheel of Misfortune -------------------------------------------------------------------------------------------------------------------------------------------------

const WHEEL = card('Test Misfortune Wheel', 'Sorcery', "Each player secretly chooses a number 0 or greater, then all players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way. ~ deals damage equal to the highest number to each player who chose that number. Each player who didn't choose the lowest number discards their hand, then draws seven cards.", { colors: ['R'] });
const KEEP = card('Test Keepsake', 'Artifact', '');

describe('CR 608.2d, 101.4, 120.3 (checked): "Each player secretly chooses a number 0 or greater, then all players reveal those numbers simultaneously ..." (Wheel of Misfortune)', () => {
  const setup = (): GameState => mpScenario({
    defs: [WHEEL, KEEP],
    zones: { p1: { hand: ['Test Misfortune Wheel', 'Test Keepsake', 'Test Keepsake'] }, p2: { hand: ['Test Keepsake', 'Test Keepsake'] }, p3: { hand: ['Test Keepsake', 'Test Keepsake'] }, p4: { hand: ['Test Keepsake', 'Test Keepsake'] } },
  });
  it('is automated', () => expect(full(WHEEL)).toBe(true));
  it('every player chooses, in turn order, a number from 0 up', () => {
    const asked: string[] = [];
    let min = -1;
    cast(setup(), 'Test Misfortune Wheel', { numbers: [1, 2, 3, 4], asked, onAsk: (s) => { if (s.pending?.kind === 'chooseNumber') min = s.pending.min; } });
    expect(asked.filter((a) => a.startsWith('chooseNumber'))).toEqual(['chooseNumber:p1', 'chooseNumber:p2', 'chooseNumber:p3', 'chooseNumber:p4']);
    expect(min).toBe(0);
  });
  it('ruling 2020-11-10: 4, 7, 7, 7: the last three are dealt 7 damage each and discard their hands and draw seven; the player who chose the lowest number keeps their hand', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Misfortune Wheel', { numbers: [4, 7, 7, 7] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    for (const p of ['p2', 'p3', 'p4'] as PlayerId[]) {
      expect(life(s, p)).toBe(life(s0, p) - 7);
      expect(s.zones.hand[p]).toHaveLength(7);
      expect(gy(s, p)).toBe(2); // the two cards of the hand
    }
    expect(s.zones.hand.p1).toHaveLength(s0.zones.hand.p1!.length - 1); // the cards left after the cast: kept
  });
  it('damage goes only to the players who chose the highest number; every player but the lowest ones wheels (0, 5, 2, 5)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Misfortune Wheel', { numbers: [0, 5, 2, 5] });
    expect(PLAYERS.map((p) => life(s0, p) - life(s, p))).toEqual([0, 5, 0, 5]);
    expect(PLAYERS.map((p) => s.zones.hand[p]!.length)).toEqual([s0.zones.hand.p1!.length - 1, 7, 7, 7]);
  });
  it('the negative case: every player chose the same number: each is dealt that much, and nobody discards (each chose the lowest number)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Misfortune Wheel', { numbers: [3, 3, 3, 3] });
    expect(PLAYERS.map((p) => life(s0, p) - life(s, p))).toEqual([3, 3, 3, 3]);
    expect(PLAYERS.map((p) => s.zones.hand[p]!.length)).toEqual([s0.zones.hand.p1!.length - 1, 2, 2, 2]);
  });
  it('a highest number of 0 deals no damage', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Misfortune Wheel', { numbers: [0, 0, 0, 0] });
    expect(PLAYERS.map((p) => life(s0, p) - life(s, p))).toEqual([0, 0, 0, 0]);
  });
  it('ruling 2020-11-10: the numbers stay secret until all are chosen: a later chooser sees no earlier number, then everyone sees all four at once', () => {
    const seen: string[][] = [];
    const s = cast(setup(), 'Test Misfortune Wheel', {
      numbers: [11, 12, 13, 14],
      onAsk: (st) => { if (st.pending?.kind === 'chooseNumber') seen.push(viewFor(st, st.pending.player).log.map((e) => e.text)); },
    });
    // p3 (third) has seen that p1 and p2 chose, but neither number
    const p3 = seen[2]!.join('\n');
    expect(p3).toMatch(/secretly chooses a number/);
    expect(p3).not.toMatch(/\b11\b|\b12\b/);
    // after the reveal, an onlooker's log names every number
    const after = viewFor(s, 'p2').log.map((e) => e.text).join('\n');
    for (const n of ['11', '12', '13', '14']) expect(after).toContain(`reveals ${n}`);
  });
});

// ---- Prisoner's Dilemma --------------------------------------------------------------------------------------------------------------------------------------------------

const DILEMMA = card('Test Dilemma', 'Sorcery', "Each opponent secretly chooses silence or snitch, then the choices are revealed. If each opponent chose silence, ~ deals 4 damage to each of them. If each opponent chose snitch, ~ deals 8 damage to each of them. Otherwise, ~ deals 12 damage to each opponent who chose silence.", { colors: ['R'] });

describe('CR 608.2c, 608.2d, 120.3 (checked): "Each opponent secretly chooses silence or snitch, then the choices are revealed. If each opponent chose silence, ... Otherwise, ..." (Prisoner\'s Dilemma)', () => {
  const setup = (): GameState => mpScenario({ defs: [DILEMMA], zones: { p1: { hand: ['Test Dilemma'] }, p2: {}, p3: {}, p4: {} } });
  const lost = (s0: GameState, s: GameState): number[] => PLAYERS.map((p) => life(s0, p) - life(s, p));
  it('is automated', () => expect(full(DILEMMA)).toBe(true));
  it('only the opponents choose, in turn order, between the two words', () => {
    const asked: string[] = [];
    let labels: string[] = [];
    cast(setup(), 'Test Dilemma', { options: ['silence', 'silence', 'silence'], asked, onAsk: (s) => { if (s.pending?.kind === 'chooseOption') labels = s.pending.options.map((o) => o.label); } });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p2', 'chooseOption:p3', 'chooseOption:p4']);
    expect(labels).toEqual(['silence', 'snitch']);
  });
  it('each opponent chose silence: 4 damage to each of them, none to you', () => {
    const s0 = setup();
    expect(lost(s0, cast(s0, 'Test Dilemma', { options: ['silence', 'silence', 'silence'] }))).toEqual([0, 4, 4, 4]);
  });
  it('each opponent chose snitch: 8 damage to each of them (and not the "otherwise" 12)', () => {
    const s0 = setup();
    expect(lost(s0, cast(s0, 'Test Dilemma', { options: ['snitch', 'snitch', 'snitch'] }))).toEqual([0, 8, 8, 8]);
  });
  it('otherwise (a mix): 12 damage to each opponent who chose silence, none to the snitches', () => {
    const s0 = setup();
    expect(lost(s0, cast(s0, 'Test Dilemma', { options: ['silence', 'snitch', 'silence'] }))).toEqual([0, 12, 0, 12]);
    const s1 = setup();
    expect(lost(s1, cast(s1, 'Test Dilemma', { options: ['snitch', 'silence', 'snitch'] }))).toEqual([0, 0, 12, 0]);
  });
  it('the choices are secret until all are made, then revealed to everyone', () => {
    const seen: string[][] = [];
    const s = cast(setup(), 'Test Dilemma', { options: ['snitch', 'silence', 'snitch'], onAsk: (st) => { if (st.pending?.kind === 'chooseOption') seen.push(viewFor(st, st.pending.player).log.map((e) => e.text)); } });
    const p4 = seen[2]!.filter((t) => /Test Dilemma|chooses|reveals/.test(t)).join('\n');
    expect(p4).not.toMatch(/snitch|silence/); // p4 learns that p2 and p3 chose, not what
    const after = viewFor(s, 'p1').log.map((e) => e.text).join('\n');
    expect(after).toMatch(/reveals snitch[\s\S]*reveals silence[\s\S]*reveals snitch/);
  });
});

// ---- Noble Heritage ------------------------------------------------------------------------------------------------------------------------------------------------------

const HEIR = card('Test Heir', 'Legendary Creature — Human Noble', 'When ~ enters and at the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. For each opponent who does, you gain protection from that player until your next turn.', { pt: ['2', '2'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ZAP = card('Test Zap', 'Instant', '~ deals 2 damage to any target.', { colors: ['R'] });
const QUAKE = card('Test Quake', 'Instant', '~ deals 1 damage to each player.', { colors: ['R'] });
const HERITAGE = card('Test Heritage', 'Legendary Enchantment — Background', 'Commander creatures you own have "When this creature enters and at the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. For each opponent who does, you gain protection from that player until your next turn."');

describe('CR 702.16k, 702.16b, 702.16e (checked): "Each player may put two +1/+1 counters on a creature they control. For each opponent who does, you gain protection from that player until your next turn." (Noble Heritage)', () => {
  const setup = (p4Bear = true): GameState => mpScenario({
    defs: [HEIR, BEAR, ZAP, QUAKE],
    zones: { p1: { hand: ['Test Heir'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Zap', 'Test Quake'] }, p3: { battlefield: ['Test Bear'], hand: ['Test Zap'] }, p4: { battlefield: p4Bear ? ['Test Bear'] : [], hand: ['Test Zap', 'Test Quake'] } },
  });
  const counters = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Test Bear').reduce((n, id) => n + Number(s.objects[id]!.counters['+1/+1'] ?? 0), 0);
  /** p1 casts the Heir; the players answer the "may" in turn order (p1, p2, p3, p4). */
  const enter = (yes: boolean[], p4Bear = true): GameState => cast(setup(p4Bear), 'Test Heir', { yes: [...yes] });
  /** Can `who` (holding priority after p1 passes) target p1 with Test Zap? */
  const canZapP1 = (s0: GameState, who: PlayerId): boolean => {
    let s = s0;
    for (let g = 0; g < 8 && s.pending?.player !== who; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    const r = applyAction(s, { type: 'cast', player: who, card: find(s, 'Test Zap', 'hand', who) });
    if (r.error) return false;
    const t = r.state.pending;
    return t?.kind === 'chooseTargets' && JSON.stringify(t).includes('"p1"');
  };
  /** `who` casts Test Quake (1 damage to each player); the life each player lost. */
  const quake = (s0: GameState, who: PlayerId): number[] => {
    let s = s0;
    for (let g = 0; g < 8 && s.pending?.player !== who; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    const s1 = settle(act(s, { type: 'cast', player: who, card: find(s, 'Test Quake', 'hand', who) }));
    return PLAYERS.map((p) => life(s, p) - life(s1, p));
  };
  it('is automated, and so is the Background that grants it to commander creatures', () => { expect(full(HEIR)).toBe(true); expect(full(HERITAGE)).toBe(true); });
  it('each player in turn is asked; those who accept put two +1/+1 counters on a creature they control, those who decline do not', () => {
    const asked: string[] = [];
    const s = cast(setup(), 'Test Heir', { yes: [false, true, true, false], asked });
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual(['yesNo:p1', 'yesNo:p2', 'yesNo:p3', 'yesNo:p4']);
    expect(PLAYERS.map((p) => counters(s, p))).toEqual([0, 2, 2, 0]);
  });
  it('protection from a player who did: that player can\'t target you; a player who declined still can (the negative case)', () => {
    const s = enter([false, true, false, false]);
    expect(canZapP1(s, 'p2')).toBe(false);
    expect(canZapP1(s, 'p3')).toBe(true);
  });
  it('damage from sources controlled by a player who did is prevented; damage from a player who declined is not', () => {
    const s = enter([false, true, false, false]);
    expect(quake(s, 'p2')).toEqual([0, 1, 1, 1]);
    expect(quake(s, 'p4')).toEqual([1, 1, 1, 1]);
  });
  it('ruling 2022-06-10: the protection is yours only: your permanents are not protected (an opponent who did can still target your creature)', () => {
    const s0 = enter([false, true, false, false]);
    let s = s0;
    for (let g = 0; g < 8 && s.pending?.player !== 'p2'; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    const r = applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Zap', 'hand', 'p2') });
    const myBear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(JSON.stringify(r.state.pending)).toContain(myBear);
  });
  it('you doing it yourself gives no protection (only opponents who do); a player with no creature can\'t do it and gives none', () => {
    const s = enter([true, false, false, true], false);
    expect(counters(s, 'p1')).toBe(2);
    expect(counters(s, 'p4')).toBe(0);
    expect(canZapP1(s, 'p4')).toBe(true);
  });
  it('"until your next turn": the protection ends as your next turn begins', () => {
    let s = enter([false, true, false, false]);
    for (let g = 0; g < 400 && !(s.turn.activePlayer === 'p1' && s.turn.number > 1 && s.turn.step === 'upkeep'); g++) {
      const p = s.pending!;
      if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = drive(s, {});
    }
    expect(s.turn.activePlayer).toBe('p1');
    // the upkeep trigger is on the stack: the protection of the turn before has ended (CR 611.2b), whatever this one gives
    expect(canZapP1(s, 'p2')).toBe(true);
  });
});

describe('CR 702.16k, 903.3 (checked): the Background grants the ability to a commander creature you own (Noble Heritage), in a Commander game', () => {
  const HERO = legend('Test Heritage Hero', '{G}', ['1', '1'], ['G', 'W']);
  const OTHER = legend('Test Rival Hero', '{G}', ['1', '1'], ['G']);
  const ZAPG = card('Test Green Zap', 'Instant', '~ deals 2 damage to any target.');
  it('your commander cast from the command zone enters; the opponent who puts the counters gives you protection from them', () => {
    let s = commanderScenario({ p1Commanders: [HERO], p2Commanders: [OTHER], defs: [HERITAGE, BEAR, ZAPG], p1: { battlefield: ['Test Heritage', 'Forest'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Green Zap'] } });
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Heritage Hero') }), { yes: [false, true] }), { yes: [false, true] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(Number(s.objects[bear]!.counters['+1/+1'] ?? 0)).toBe(2);
    for (let g = 0; g < 8 && s.pending?.player !== 'p2'; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    const r = applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Green Zap', 'hand', 'p2') });
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(r.state.pending)).not.toContain('"p1"');
  });
});

// ---- Faramir, Prince of Ithilien -----------------------------------------------------------------------------------------------------------------------------------------

const PRINCE = card('Test Steward Prince', 'Legendary Creature — Human Noble', "At the beginning of your end step, choose an opponent. At the beginning of that player's next end step, you draw a card if they didn't attack you that turn. Otherwise, create three 1/1 white Human Soldier creature tokens.", { pt: ['3', '3'] });
const RAIDER = card('Test Raider', 'Creature — Orc', '', { pt: ['1', '1'] });
const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testwalker', oracle_text: '+1: You gain 1 life.', loyalty: '3', colors: [], keywords: [] } as never);

describe('CR 603.7a, 608.2c, 506.2, 508.1b (checked): "At the beginning of your end step, choose an opponent. At the beginning of that player\'s next end step, you draw a card if they didn\'t attack you that turn. Otherwise, ..." (Faramir, Prince of Ithilien)', () => {
  const setup = (): GameState => mpScenario({
    defs: [PRINCE, RAIDER, WALKER],
    zones: { p1: { battlefield: ['Test Steward Prince', { name: 'Test Walker', counters: { loyalty: 3 } } as never] }, p2: { battlefield: ['Test Raider'] }, p3: { battlefield: ['Test Raider'] }, p4: {} },
  });
  const soldiers = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && JSON.stringify(s.objects[id]).includes('Soldier')).length;
  /** Play on until `done`: p1 chooses `pick` at its end step; the active player declares `attacks(s)` (or none). */
  function run(s0: GameState, done: (s: GameState) => boolean, pick: string, attacks: (s: GameState) => { attacker: ObjectId; defender: string }[] = () => []): GameState {
    let s = s0;
    for (let g = 0; g < 600 && !done(s); g++) {
      const p = s.pending!;
      if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: attacks(s) as never });
      else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options.find((o) => o.label === pick)?.id ?? p.options[0]!.id] });
      else s = drive(s, {});
    }
    return s;
  }
  const atP2End = (s: GameState): boolean => s.turn.activePlayer === 'p3'; // p2's turn, its end step included, is over
  const raider = (s: GameState, p: PlayerId): ObjectId => find(s, 'Test Raider', 'battlefield', p);
  const walker = (s: GameState): ObjectId => find(s, 'Test Walker', 'battlefield', 'p1');
  it('is automated', () => expect(full(PRINCE)).toBe(true));
  it('at your end step you choose one of your opponents', () => {
    let labels: string[] = [];
    run(setup(), (s) => { if (s.pending?.kind === 'chooseOption') { labels = s.pending.options.map((o) => o.label); return true; } return false; }, 'Bob');
    expect(labels.sort()).toEqual(['Bob', 'Carol', 'Dan']);
  });
  it('the chosen opponent didn\'t attack you during their next turn: at their end step you draw a card (no tokens)', () => {
    const s0 = setup();
    const before = s0.zones.hand.p1!.length;
    const s = run(s0, atP2End, 'Bob');
    expect(s.zones.hand.p1!.length - before).toBe(1);
    expect(soldiers(s)).toBe(0);
  });
  it('the chosen opponent attacked you: three 1/1 Human Soldier tokens, no card', () => {
    const s0 = setup();
    const before = s0.zones.hand.p1!.length;
    const s = run(s0, atP2End, 'Bob', (st) => (st.turn.activePlayer === 'p2' ? [{ attacker: raider(st, 'p2'), defender: 'p1' }] : []));
    expect(soldiers(s)).toBe(3);
    expect(s.zones.hand.p1!.length - before).toBe(0);
  });
  it('the negative case: the chosen opponent attacked ANOTHER player: you still draw', () => {
    const s0 = setup();
    const before = s0.zones.hand.p1!.length;
    const s = run(s0, atP2End, 'Bob', (st) => (st.turn.activePlayer === 'p2' ? [{ attacker: raider(st, 'p2'), defender: 'p3' }] : []));
    expect(s.zones.hand.p1!.length - before).toBe(1);
    expect(soldiers(s)).toBe(0);
  });
  it('ruling 2023-06-16: attacking a planeswalker you control is not attacking you: you draw', () => {
    const s0 = setup();
    const before = s0.zones.hand.p1!.length;
    const s = run(s0, atP2End, 'Bob', (st) => (st.turn.activePlayer === 'p2' ? [{ attacker: raider(st, 'p2'), defender: walker(st) }] : []));
    expect(s.zones.hand.p1!.length - before).toBe(1);
    expect(soldiers(s)).toBe(0);
  });
  it('another opponent attacking you does not count: only the chosen player\'s attacks, on their own turn', () => {
    const s0 = setup();
    // choose Carol (p3): Bob (p2) attacks you during his turn; at Carol's end step (Carol didn't attack) you draw, and nothing happens at Bob's end step
    const atP3End = (s: GameState): boolean => s.turn.activePlayer === 'p4';
    const midP2 = run(s0, atP2End, 'Carol', (st) => (st.turn.activePlayer === 'p2' ? [{ attacker: raider(st, 'p2'), defender: 'p1' }] : []));
    expect(soldiers(midP2)).toBe(0);
    const before = midP2.zones.hand.p1!.length;
    const s = run(midP2, atP3End, 'Carol');
    expect(s.zones.hand.p1!.length - before).toBe(1);
    expect(soldiers(s)).toBe(0);
  });
});

// ---- Deadpool, Trading Card ----------------------------------------------------------------------------------------------------------------------------------------------

const MERC = card('Test Merc', 'Legendary Creature — Mutant Mercenary Hero', "As ~ enters, you may exchange his text box and another creature's.\nAt the beginning of your upkeep, you lose 3 life.\n{3}, Sacrifice ~: Each other player draws a card.", { pt: ['4', '4'] });
const OWL = card('Test Owl', 'Creature — Bird', 'Flying\nAt the beginning of your upkeep, you gain 2 life.', { pt: ['1', '1'] });
const HERALD = card('Test Herald', 'Creature — Human', 'When this creature enters, you gain 5 life.', { pt: ['2', '1'] });
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.');
const ROGUE = card('Test Rogue', 'Creature — Mutant Mercenary', "As ~ enters, you may exchange his text box and another creature's.\nAt the beginning of your upkeep, you lose 3 life.", { pt: ['2', '2'] });
const TWIN = card('Test Twin', 'Sorcery', "Create a token that's a copy of target creature you control.");
const PAIR = card('Test Pair', 'Sorcery', 'Create two tokens that are copies of target creature you control.');
const GROWER = card('Test Grower', 'Creature — Plant', 'This creature enters with three +1/+1 counters on it.', { pt: ['0', '0'] });

describe('CR 612.5, 701.12h, 613.1c, 614.12 (checked): "As ~ enters, you may exchange his text box and another creature\'s." (Deadpool, Trading Card)', () => {
  const setup = (p2: string[] = ['Test Owl']): GameState => mpScenario({
    players: 3, defs: [MERC, OWL, HERALD, SLAY, GROWER],
    zones: { p1: { hand: ['Test Merc', 'Test Slay'] }, p2: { battlefield: p2 }, p3: {} },
  });
  const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.map((k) => k.keyword);
  const texts = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.map((a) => a.def.text ?? '');
  const merc = (s: GameState): ObjectId => find(s, 'Test Merc', 'battlefield', 'p1');
  const owl = (s: GameState): ObjectId => find(s, 'Test Owl', 'battlefield', 'p2');
  const toUpkeep = (s0: GameState, who: PlayerId): GameState => {
    let s = s0;
    for (let g = 0; g < 400 && !(s.turn.activePlayer === who && s.turn.step === 'draw'); g++) {
      const p = s.pending!;
      if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = drive(s, {});
    }
    return s;
  };
  it('is automated', () => expect(full(MERC)).toBe(true));
  it('accepted: each gets the other\'s rules text: the Merc has flying and the life-gain upkeep ability, the Owl the life-loss one; names and power/toughness stay', () => {
    const asked: string[] = [];
    const s = cast(setup(), 'Test Merc', { yes: [true], asked });
    expect(kw(s, merc(s))).toContain('flying');
    expect(kw(s, owl(s))).not.toContain('flying');
    expect(texts(s, owl(s)).join('|')).toMatch(/lose 3 life/);
    expect(texts(s, merc(s)).join('|')).not.toMatch(/lose 3 life/);
    expect(texts(s, merc(s)).join('|')).toMatch(/gain 2 life/);
    expect([getChars(s, merc(s)).name, getChars(s, merc(s)).power, getChars(s, owl(s)).name, getChars(s, owl(s)).power]).toEqual(['Test Merc', '4', 'Test Owl', '1']);
  });
  it('played: at the Owl controller\'s upkeep THEY lose 3 life; at yours you gain 2 and lose nothing', () => {
    const s0 = cast(setup(), 'Test Merc', { yes: [true] });
    const s2 = toUpkeep(s0, 'p2');
    expect(life(s2, 'p2')).toBe(life(s0, 'p2') - 3);
    const s1 = toUpkeep(s2, 'p1');
    expect(life(s1, 'p1')).toBe(life(s2, 'p1') + 2);
  });
  it('the negative case: declined, nothing is exchanged (you lose 3 at your upkeep)', () => {
    const s0 = cast(setup(), 'Test Merc', { yes: [false] });
    expect(kw(s0, merc(s0))).not.toContain('flying');
    expect(kw(s0, owl(s0))).toContain('flying');
    const s1 = toUpkeep(s0, 'p1');
    expect(life(s1, 'p1')).toBe(life(s0, 'p1') - 3);
  });
  it('the exchange lasts: the Owl leaving the battlefield does not give the Merc its own text back', () => {
    let s = cast(setup(), 'Test Merc', { yes: [true] });
    const o = owl(s);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: o }]] });
    expect(s.objects[o]?.zone === 'battlefield').toBe(false);
    expect(kw(s, merc(s))).toContain('flying');
    expect(texts(s, merc(s)).join('|')).not.toMatch(/lose 3 life/);
  });
  it('CR 614.12, 603.6a: the Merc enters with the other creature\'s text, so an "enters" ability it got triggers for it (and the other creature, which didn\'t enter, gets nothing)', () => {
    const s0 = setup(['Test Herald']);
    const s = cast(s0, 'Test Merc', { yes: [true] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 5);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
  });
  it('review fix (CR 614.12, fail closed): an "enters with" replacement the Merc gets is not skipped: the players are asked to settle it by hand', () => {
    const s0 = setup([{ name: 'Test Grower', counters: { '+1/+1': 3 } } as never]);
    let err = '';
    try { cast(s0, 'Test Merc', { yes: [true] }); } catch (e) { err = String(e); }
    expect(err).toMatch(/unexpected decision manualResolve.*enters with three \+1\/\+1 counters/);
  });
  it('the negative case: an exchange with a creature that has no such ability asks nothing by hand', () => {
    const asked: string[] = [];
    cast(setup(), 'Test Merc', { yes: [true], asked });
    expect(asked.some((a) => a.startsWith('manualResolve'))).toBe(false);
  });
  /** p1 controls Test Rogue (the same text, nonlegendary) and casts `spell` on it; every text box question is answered yes with the Owl; the options offered are kept. */
  const copyRogue = (spell: string): { s: GameState; offers: ObjectId[][]; rogue: ObjectId; owl: ObjectId } => {
    let s = mpScenario({ players: 3, defs: [ROGUE, OWL, TWIN, PAIR], zones: { p1: { battlefield: ['Test Rogue'], hand: [spell] }, p2: { battlefield: ['Test Owl'] }, p3: {} } });
    const rogue = find(s, 'Test Rogue', 'battlefield', 'p1');
    const owl = find(s, 'Test Owl', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') });
    const offers: ObjectId[][] = [];
    for (let g = 0; g < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending!;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: rogue }] } as never);
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'chooseObjects' && /text boxes/.test(d.prompt)) { offers.push([...d.options].sort()); s = answer(s, { kind: 'chooseObjects', ids: [owl] }); }
      else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else s = drive(s, {});
    }
    return { s, offers, rogue, owl };
  };
  it('a token copy of it (made, not moved) is asked too and exchanges; the original keeps its own text (CR 707.2, 614.1c, 614.12a; coordinator D\'s edh-d-81 case)', () => {
    const { s, rogue, owl } = copyRogue('Test Twin');
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    expect(kw(s, token)).toContain('flying');
    expect(texts(s, owl).join('|')).toMatch(/lose 3 life/);
    expect(kw(s, rogue)).not.toContain('flying');
  });
  it('CR 614.12a: a creature entering at the same time is not offered: neither of two token copies made together is offered the other', () => {
    const { s, offers, rogue, owl } = copyRogue('Test Pair');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
    expect(offers).toEqual([[owl, rogue].sort(), [owl, rogue].sort()]);
  });
  it('no other creature: nothing is offered', () => {
    const asked: string[] = [];
    cast(setup([]), 'Test Merc', { yes: [true], asked });
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual([]);
  });
});
