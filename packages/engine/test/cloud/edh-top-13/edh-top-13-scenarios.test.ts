/**
 * Commander lane edh-top, round edh-top-13: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 508.1h, 122.1   "Each creature with one or more counters on it can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature."
 *   CR 701.17a, 400.7  "{T}: Put target land card in a graveyard that was milled this turn onto the battlefield tapped under your control." (ruling 2024-03-08: put there from a library without "mill" is no target)
 *   CR 122.1, 608.2d   "Whenever a land you control enters, you may get two rad counters."
 *   CR 510.1a, 611.3a  "During your turn, each creature assigns combat damage equal to its toughness rather than its power."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { activatedAbilities } from '../../../src/index';
import { assignsCombatDamageAsToughness } from '../../../src/statics/hooks';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...extra } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level === 'full')) && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WARDEN = card('Test Warden', 'Enchantment', "Each creature with one or more counters on it can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature.");
const FARMER = card('Test Farmer', 'Creature — Peasant', '{T}: Put target land card in a graveyard that was milled this turn onto the battlefield tapped under your control.', ['1', '1']);
const GRIND = card('Test Grind', 'Sorcery', 'Target player mills two cards.');
const RADDER = card('Test Radder', 'Creature — Zombie', 'Whenever a land you control enters, you may get two rad counters.', ['1', '1']);
const WALLS = card('Test Wall Lord', 'Enchantment', 'During your turn, each creature assigns combat damage equal to its toughness rather than its power.');
const DEFS = [BEAR, WARDEN, FARMER, GRIND, RADDER, WALLS];

describe('templates: the round\'s sentences are automated', () => {
  it('the tax, the milled card, the optional counters and the toughness damage', () => {
    for (const d of [WARDEN, FARMER, RADDER, WALLS]) expect(full(d), d.name).toBe(true);
  });
});

function until(s0: GameState, kind: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind !== kind; guard++) {
    if (guard > 40) throw new Error(`no ${kind}`);
    s = pass(s);
  }
  return s;
}
const ready = (s: GameState, ...names: string[]): string[] => {
  const ids = names.flatMap((n) => findAll(s, n, 'battlefield', 'p1'));
  for (const id of ids) s.objects[id]!.controlledSinceTurn = -1;
  return ids;
};
function declare(s: GameState, attacks: { attacker: string; defender: string }[]): ReturnType<typeof applyAction> {
  return applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } as never });
}

describe('CR 508.1h, 122.1: an attack tax of {X}, X the counters on the attacking creature (Nils)', () => {
  const base = (counters: Record<string, number> | undefined, lands: number): GameState =>
    scenario([], { p1: { battlefield: [{ name: 'Test Bear', ...(counters ? { counters } : {}) }, ...Array(lands).fill('Plains')] }, p2: { battlefield: ['Test Warden'] }, defs: DEFS });

  it('a creature with two counters of any kind costs {2}: asked, paid, and it attacks', () => {
    let s = base({ charge: 2 }, 2);
    const [b] = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] });
    expect(s.pending!.kind).toBe('yesNo');
    expect(s.pending!.prompt).toContain('{2}');
    s = answer(s, { kind: 'yesNo', yes: true });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.combat?.attackers.map((a) => a.id)).toEqual([b]);
    expect(findAll(s, 'Plains', 'battlefield', 'p1').filter((id) => s.objects[id]!.tapped).length).toBe(2);
  });
  it('the amount is the creature\'s own: three counters need {3}, and two lands reject the declaration (CR 118.3)', () => {
    let s = base({ '+1/+1': 3 }, 2);
    const [b] = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    const r = declare(s, [{ attacker: b!, defender: 'p2' }]);
    expect(r.error?.message).toMatch(/costs \{3\}/);
  });
  it('the negative case: a creature with no counter attacks free (it is not a "creature with one or more counters")', () => {
    let s = base(undefined, 0);
    const [b] = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    const r = declare(s, [{ attacker: b!, defender: 'p2' }]);
    expect(r.error).toBeUndefined();
    expect(r.state.pending?.kind).not.toBe('yesNo');
  });
});

describe('CR 701.17a, 400.7: "a land card in a graveyard that was milled this turn" (Tato Farmer)', () => {
  const start = (): GameState => {
    const s = scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Farmer'], hand: ['Test Grind'], library: ['Forest', 'Forest', 'Forest'], graveyard: ['Mountain'] }, defs: DEFS });
    s.objects[find(s, 'Test Farmer', 'battlefield', 'p1')]!.controlledSinceTurn = -1;
    return s;
  };
  const abilityKey = (s: GameState): string => activatedAbilities(s, s.objects[find(s, 'Test Farmer', 'battlefield', 'p1')]!).find((i) => i.def.isMana !== true)!.key;
  const offered = (s: GameState): string => {
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Farmer', 'battlefield', 'p1'), ability: abilityKey(s) });
    return JSON.stringify(t.pending);
  };
  it('a land the mill put into the graveyard is a target; a land that was already there is not', () => {
    let s = start();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grind', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] });
    for (let g = 0; g < 10 && s.zones.stack.length > 0; g++) s = pass(s);
    const milled = findAll(s, 'Forest', 'graveyard', 'p1');
    expect(milled.length).toBe(2);
    const o = offered(s);
    for (const id of milled) expect(o).toContain(id);
    expect(o).not.toContain(find(s, 'Mountain', 'graveyard', 'p1'));
  });
  it('the negative case: with nothing milled this turn the ability has no target (CR 602.2b)', () => {
    const s = start();
    expect(() => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Farmer', 'battlefield', 'p1'), ability: abilityKey(s) })).toThrow(/no legal one/);
  });
});

describe('CR 122.1, 608.2d: "Whenever a land you control enters, you may get two rad counters." (Tato Farmer)', () => {
  const play = (yes: boolean): GameState => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Radder'], hand: ['Forest'] }, defs: DEFS });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') });
    for (let g = 0; g < 10 && (s.zones.stack.length > 0 || s.pending?.kind === 'yesNo'); g++) s = s.pending?.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes }) : pass(s);
    return s;
  };
  const rad = (s: GameState): number => (s.players.find((p) => p.id === 'p1')!.counters as Record<string, number> | undefined)?.['rad'] ?? 0;
  it('accepting gives two rad counters, declining none', () => {
    expect(rad(play(true))).toBe(2);
    expect(rad(play(false))).toBe(0);
  });
});

describe('CR 510.1a, 611.3a: "During your turn, each creature assigns combat damage equal to its toughness rather than its power." (Baldin)', () => {
  it('only during the controller\'s turn: the rule is on in their turn and off in the opponent\'s', () => {
    const wall = card('Test Wall', 'Creature — Wall', '', ['0', '4']);
    const mk = (owner: 'p1' | 'p2'): GameState => scenario([], { p1: { battlefield: owner === 'p1' ? ['Test Wall Lord', 'Test Wall'] : ['Test Wall'] }, p2: { battlefield: owner === 'p2' ? ['Test Wall Lord'] : [] }, defs: [...DEFS, wall] });
    const dealsToughness = (s: GameState): boolean => {
      const w = find(s, 'Test Wall', 'battlefield', 'p1');
      return assignsCombatDamageAsToughness(s, w, getChars(s, w)!);
    };
    expect(dealsToughness(mk('p1'))).toBe(true); // p1's turn, p1's static
    expect(dealsToughness(mk('p2'))).toBe(false); // p1's turn, the static belongs to p2: not "your turn" for it
  });
});
