/**
 * edh-next-40, Layla Hassan's shape in a 4-player game (CR 603.2c, 510.2): "When ~ enters and whenever one or more Assassins you control deal combat damage to a player, ..."
 * is one occurrence for each player dealt combat damage (the Professional Face-Breaker ruling), as the one-event trigger is; its own enters stays an occurrence of its own.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { answer, find, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef => compileCard({
  name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
} as OracleCard);
const SLEUTH = card('Test Sleuth', 'Creature — Human Assassin', 'When ~ enters and whenever one or more Assassins you control deal combat damage to a player, return target historic card from your graveyard to your hand.', ['2', '2']);
const BLADE = card('Test Blade', 'Creature — Human Assassin', '', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '');
const RELIC2 = card('Test Relic Two', 'Artifact', '');

function fight(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  let n = 0; // each trigger picks the next card, so two triggers do not aim at the one card
  for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending!;
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object' as const, id: d.objects[n++ % d.objects.length]! }] });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${d.kind}`);
  }
  return s;
}
const game = (): GameState => mpScenario({ defs: [SLEUTH, BLADE, RELIC, RELIC2], cards: [], zones: { p1: { battlefield: ['Test Sleuth', 'Test Blade'], graveyard: ['Test Relic', 'Test Relic Two'] } } });
const hand = (s: GameState): number => s.zones.hand.p1!.length;

describe('CR 603.2c: Layla Hassan\'s shape in a 4-player game', () => {
  it('Assassins that deal combat damage to two different players trigger it twice: two cards return', () => {
    const s0 = game();
    const s = fight(s0, [{ attacker: find(s0, 'Test Sleuth', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s0, 'Test Blade', 'battlefield', 'p1'), defender: 'p3' }]);
    expect(hand(s) - hand(s0)).toBe(2);
  });
  it('negative: Assassins that deal combat damage to the same player trigger it once: one card returns', () => {
    const s0 = game();
    const s = fight(s0, [{ attacker: find(s0, 'Test Sleuth', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s0, 'Test Blade', 'battlefield', 'p1'), defender: 'p2' }]);
    expect(hand(s) - hand(s0)).toBe(1);
  });
});
