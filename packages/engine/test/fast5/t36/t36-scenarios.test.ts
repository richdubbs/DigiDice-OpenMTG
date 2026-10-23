/**
 * FAST5 T36 (prevention, next-spell and spell-cast restrictions): the templates of parser/templates/zz-fast5/t36.json (and the engine support they needed)
 * played through the engine with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Each test is named after the rule
 * it checks.
 *
 *   CR 601.3, 506.3      "Cast ~ only during the declare attackers step and only if you've been attacked this step."
 *   CR 609.7a, 615.7-615.9  "The next time a red source of your choice would deal damage to you this turn, prevent that damage."
 *   CR 701.9a, 614.1a    "If a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield instead of putting it into your graveyard."
 *   CR 500.7, 603.7a     "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { castCheck } from '../../../src/actions/cast';
import { act, advanceTo, answer, castAuto, find, life, pass, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);
const denied = (s: GameState, player: string, id: string): boolean => 'denial' in castCheck(s, player, id, undefined, undefined);

const STAND = card('Test Stand', 'Instant', "Cast this spell only during the declare attackers step and only if you've been attacked this step.\nYou gain 3 life.", { cost: '{0}', colors: ['W'] });
const WARD = card('Test Ward', 'Enchantment', '{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.', { cost: '{1}{W}', colors: ['W'] });
const PINGER = card('Test Pinger', 'Creature — Human Shaman', '{T}: Test Pinger deals 2 damage to any target.', { cost: '{R}', colors: ['R'], pt: ['1', '1'] });
const GREEN_PINGER = card('Test Green Pinger', 'Creature — Elf Shaman', '{T}: Test Green Pinger deals 2 damage to any target.', { cost: '{G}', colors: ['G'], pt: ['1', '1'] });
const OTHER_PINGER = card('Test Other Pinger', 'Creature — Goblin Shaman', '{T}: Test Other Pinger deals 2 damage to any target.', { cost: '{R}', colors: ['R'], pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', colors: ['G'], pt: ['2', '2'] });
const FORTUNE = card('Test Fortune', 'Instant', "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game.", { cost: '{0}', colors: ['U'] });
const LIEGE = card('Test Liege', 'Creature — Treefolk', 'If a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield instead of putting it into your graveyard.', { cost: '{2}{G}', colors: ['G'], pt: ['3', '3'] });
const DURESS = card('Test Duress', 'Sorcery', 'Target opponent discards a card.', { cost: '{0}', colors: ['B'] });
const REGRET = card('Test Regret', 'Sorcery', 'Discard a card.', { cost: '{0}', colors: ['B'] });
const ALL = [LIEGE, DURESS, REGRET, STAND, WARD, PINGER, OTHER_PINGER, GREEN_PINGER, BEAR, FORTUNE];

describe('design 6.9: every T36 sentence is compiled to data, none left manual', () => {
  it('no manual ability on the T36 test cards', () => {
    for (const d of [STAND, WARD, FORTUNE, LIEGE]) expect(noManual(d), d.name).toEqual([]);
  });
});

describe('CR 601.3, 506.3: "Cast ~ only during the declare attackers step and only if you\'ve been attacked this step."', () => {
  /** p1 attacks p2 with a Bear (or nobody) and the game stops in the declare attackers step. */
  function attackStep(attack: boolean): GameState {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Stand'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Stand'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    for (let i = 0; i < 60 && !(s.turn.step === 'declareAttackers' && s.pending!.kind === 'priority'); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: attack ? [{ attacker: bear, defender: 'p2' }] : [] });
      else s = pass(s);
      if (!attack && s.turn.step === 'main2') break;
    }
    return s;
  }
  it('the defending player may cast it in the declare attackers step; the attacking player, who has not been attacked, may not', () => {
    const s = attackStep(true);
    expect(s.turn.step).toBe('declareAttackers');
    expect(denied(s, 'p2', find(s, 'Test Stand', 'hand', 'p2'))).toBe(false);
    expect(denied(s, 'p1', find(s, 'Test Stand', 'hand', 'p1'))).toBe(true);
  });
  it('not in the first main phase, not at the beginning of combat, not after attackers are declared and the step is over', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Stand'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Stand'] } });
    expect(denied(s0, 'p2', find(s0, 'Test Stand', 'hand', 'p2'))).toBe(true);
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(denied(combat, 'p2', find(combat, 'Test Stand', 'hand', 'p2'))).toBe(true);
    let s = attackStep(true);
    while (s.turn.step === 'declareAttackers') s = pass(s);
    expect(s.turn.step).not.toBe('declareAttackers');
    expect(denied(s, 'p2', find(s, 'Test Stand', 'hand', 'p2'))).toBe(true);
  });
  it('cast and resolved: the controller gains the life', () => {
    let s = attackStep(true);
    s = pass(s); // p1 passes; p2 has priority
    expect(s.pending?.player).toBe('p2');
    s = passBoth(castAuto(s, 'Test Stand', { player: 'p2' }));
    expect(life(s, 'p2')).toBe(23);
  });
});

describe('CR 609.7a, 615.1, 615.7-615.9: "The next time a red source of your choice would deal damage to you this turn, prevent that damage."', () => {
  const board = (): GameState => scenario(['Mountain', 'Plains'], { defs: ALL, p1: { battlefield: ['Test Ward', 'Test Pinger', 'Test Other Pinger', 'Test Green Pinger', 'Mountain', 'Plains'] } });
  /** Activate `index` of `source`, announce the targets, pay automatically (the ability is on the stack). */
  function activate(s0: GameState, source: string, ability: string, targets: TargetChoice[] = []): GameState {
    let s = act(s0, { type: 'activate', player: 'p1', source, ability });
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return s;
  }
  const self: TargetChoice[] = [{ kind: 'player', id: 'p1' }];
  it('the chosen red source: its next damage to you is prevented, the one after is not (the shield is used up)', () => {
    let s = board();
    const pinger = find(s, 'Test Pinger', 'battlefield');
    s = activate(s, find(s, 'Test Ward', 'battlefield'), 'p:0:0');
    s = passBoth(s); // the shield's ability resolves: choose the source
    expect(s.pending?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [pinger] });
    s = passBoth(activate(s, pinger, 'p:0:0', self));
    expect(life(s, 'p1')).toBe(20); // the chosen source's damage is prevented
    s = passBoth(activate(s, find(s, 'Test Other Pinger', 'battlefield'), 'p:0:0', self)); // not the chosen source
    expect(life(s, 'p1')).toBe(18);
    expect(s.pending?.kind).toBe('priority');
  });
  it('a source that was not chosen (the green one) still damages you', () => {
    let s = board();
    const pinger = find(s, 'Test Pinger', 'battlefield');
    s = passBoth(activate(s, find(s, 'Test Ward', 'battlefield'), 'p:0:0'));
    s = answer(s, { kind: 'chooseObjects', ids: [pinger] });
    s = passBoth(activate(s, find(s, 'Test Green Pinger', 'battlefield'), 'p:0:0', self));
    expect(life(s, 'p1')).toBe(18);
  });
  it('the offered sources are red only (the green creature is not a choice)', () => {
    let s = board();
    s = passBoth(activate(s, find(s, 'Test Ward', 'battlefield'), 'p:0:0'));
    const d = s.pending as unknown as { kind: string; from?: string[]; options?: string[]; candidates?: string[] };
    expect(d.kind).toBe('chooseObjects');
    const offered = (d.candidates ?? d.options ?? d.from ?? []) as string[];
    expect(offered).toContain(find(s, 'Test Pinger', 'battlefield'));
    expect(offered).not.toContain(find(s, 'Test Green Pinger', 'battlefield'));
  });
});

describe('CR 701.9a, 614.1a: "If a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield instead of putting it into your graveyard."', () => {
  const cast = (s: GameState, name: string, targets: TargetChoice[] = []): GameState => {
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
    while (t.pending && t.pending.kind !== 'priority') {
      if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets });
      else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else break;
    }
    return t;
  };
  it("an opponent's spell makes you discard it: it is put onto the battlefield under your control, not into the graveyard", () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Duress'] }, p2: { hand: ['Test Liege'] } });
    let s = passBoth(cast(s0, 'Test Duress', [{ kind: 'player', id: 'p2' }]));
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Liege', 'hand', 'p2')] });
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Test Liege');
    expect(id).toBeTruthy();
    expect(s.objects[id!]!.controller).toBe('p2');
    expect(s.zones.graveyard['p2']).toHaveLength(0);
  });
  it('you discard it yourself with your own spell: it goes to the graveyard (the spell is your own)', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Regret', 'Test Liege'] } });
    let s = passBoth(cast(s0, 'Test Regret'));
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Liege', 'hand', 'p1')] });
    expect(s.zones.battlefield.some((x) => s.objects[x]!.defId === 'Test Liege')).toBe(false);
    expect(s.zones.graveyard['p1']!.some((x) => s.objects[x]!.defId === 'Test Liege')).toBe(true);
  });
});

describe("CR 500.7, 603.7a: \"Take an extra turn after this one. At the beginning of that turn's end step, you lose the game.\"", () => {
  it('the end step of this turn is safe; you lose at the end step of the extra turn, and your opponent wins', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Fortune'] } });
    let s = passBoth(castAuto(s0, 'Test Fortune'));
    expect(s.result).toBeFalsy();
    s = advanceTo(s, 1, 'end');
    s = pass(pass(s)); // through this turn's end step: nothing happens
    expect(s.result).toBeFalsy();
    s = advanceTo(s, 2, 'end');
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.result).toBeFalsy();
    for (let i = 0; i < 6 && !s.result; i++) s = pass(s);
    expect(s.result?.winner ?? s.result).toBeTruthy();
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
  });
});
