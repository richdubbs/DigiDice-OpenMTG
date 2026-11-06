/**
 * Commander lane edh-perms, round edh-perms-24: a four-player Commander game for the readings that need commanders. Alice (p1) is the active player.
 * CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 903.3, 108.3, 613.1f, 603.2   "Commander creatures you own have "Whenever ~ becomes tapped, it and other creatures you control that share a creature type with it each get +2/+0 and gain undying until end of turn.""
 */
import { describe, expect, it } from 'vitest';
import { commanderOptions, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, mpScenario, pass, passUntil } from '../../m12/rules/helpers';
import { legend } from '../../m11/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: '{0}', oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const HAUNT = card('Test Haunting Pact', 'Legendary Enchantment — Background', 'Commander creatures you own have "Whenever this creature becomes tapped, it and other creatures you control that share a creature type with it each get +2/+0 and gain undying until end of turn."');
const CAPTAIN = legend('Test Captain', '{1}{W}', ['3', '3'], ['W'], '', 'Legendary Creature — Goblin Warrior');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const DEFS = [HAUNT, CAPTAIN, GOBLIN, ELF, legend('Test Beta', '{1}{W}', ['3', '3'], ['W']), legend('Test Gamma', '{1}{W}', ['3', '3'], ['W']), legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])];

const game = (): GameState => mpScenario({
  players: 4, defs: DEFS, options: { startingPlayer: 'p1', commander: commanderOptions('commander') },
  commanders: { p1: [CAPTAIN], p2: [legend('Test Beta', '{1}{W}', ['3', '3'], ['W'])], p3: [legend('Test Gamma', '{1}{W}', ['3', '3'], ['W'])], p4: [legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])] },
  zones: { p1: { battlefield: ['Test Haunting Pact', 'Test Goblin', 'Test Elf'] }, p2: { battlefield: ['Test Goblin'] } },
  setup: (x) => {
    const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Test Captain')!;
    x.zones.command = x.zones.command.filter((o) => o !== id);
    x.zones.battlefield.push(id);
    x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
  },
});
const settle = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 100 && (s.zones.stack.length > 0 || s.pending?.kind === 'order'); i++) {
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${s.pending?.kind}`);
  }
  return s;
};
/** Declare the attackers (the attack taps them) and let the triggers resolve. */
function attack(s0: GameState, who: ObjectId[]): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks: who.map((attacker) => ({ attacker, defender: 'p2' as PlayerId })) });
  return settle(s);
}
const power = (s: GameState, id: ObjectId): string | undefined => getChars(s, id)!.power;
const hasUndying = (s: GameState, id: ObjectId): boolean => (getChars(s, id)!.abilities ?? []).some((a) => JSON.stringify(a).includes('undying'));
const mine = (s: GameState, name: string): ObjectId => find(s, name, 'battlefield', 'p1');

describe('the Background is fully automated', () => {
  it('compiles to full', () => expect(HAUNT.automation.level, JSON.stringify(HAUNT.automation)).toBe('full'));
});

describe('CR 903.3, 108.3, 613.1f, 603.2: "Commander creatures you own have "Whenever ~ becomes tapped, it and other creatures you control that share a creature type with it each get +2/+0 and gain undying until end of turn.""', () => {
  it('the commander taps to attack: it and the Goblin (a creature type in common) get +2/+0 and undying, the Elf does not', () => {
    const s0 = game();
    const s = attack(s0, [mine(s0, 'Test Captain')]);
    expect(power(s, mine(s, 'Test Captain'))).toBe('5');
    expect(power(s, mine(s, 'Test Goblin'))).toBe('3');
    expect(power(s, mine(s, 'Test Elf'))).toBe('1');
    expect(hasUndying(s, mine(s, 'Test Goblin'))).toBe(true);
    expect(hasUndying(s, mine(s, 'Test Captain'))).toBe(true);
    expect(hasUndying(s, mine(s, 'Test Elf'))).toBe(false);
  });
  it('negative: an opponent\'s Goblin (not "you control") is not pumped', () => {
    const s0 = game();
    const s = attack(s0, [mine(s0, 'Test Captain')]);
    expect(power(s, find(s, 'Test Goblin', 'battlefield', 'p2'))).toBe('1');
  });
  it('negative: a creature that is not a commander has no such ability: tapping the Goblin changes nothing', () => {
    const s0 = game();
    const s = attack(s0, [mine(s0, 'Test Goblin')]);
    expect(power(s, mine(s, 'Test Captain'))).toBe('3');
    expect(power(s, mine(s, 'Test Goblin'))).toBe('1');
  });
});
