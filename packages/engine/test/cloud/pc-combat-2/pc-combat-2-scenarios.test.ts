/**
 * pc-combat-2 (Commander precon lane pc-combat): "you may put a creature card from your hand onto the battlefield tapped and attacking [that opponent]" played through the
 * engine with synthetic cards compiled by the default compiler (design 6.10), four players. CR cites from memory, unverified (no rules/cr in the cloud checkout).
 *
 *   CR 508.4, 608.2d  "Whenever ~ attacks an opponent, you may put a Dragon creature card from your hand onto the battlefield tapped and attacking that opponent."
 *   CR 508.4, 608.2d  "Whenever ~ attacks, you may put a Dragon creature card from your hand onto the battlefield tapped and attacking." (its controller chooses whom it attacks)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { attackerState } from '../../../src/rules/combat-state';
import { answer, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: '{0}', oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
const SUMMONER = card('Test Wyrm Caller', 'Creature — Human Shaman', 'Whenever ~ attacks an opponent, you may put a Dragon creature card from your hand onto the battlefield tapped and attacking that opponent.', ['1', '1']);
const FREE = card('Test Wyrm Herald', 'Creature — Human Shaman', 'Whenever ~ attacks, you may put a Dragon creature card from your hand onto the battlefield tapped and attacking.', ['1', '1']);
const DRAKE = card('Test Ember Drake', 'Creature — Dragon', '', ['3', '3']);
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
const DEFS = [SUMMONER, FREE, DRAKE, BEAR];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => { for (const d of DEFS) expect(d.automation.level, d.name).toBe('full'); });
});

const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
function attackAndResolve(name: string, hand: string[], defender: 'p2' | 'p3'): GameState {
  let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: [name], hand } } });
  s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: named(s, name)[0]!, defender }] });
  for (let i = 0; i < 60 && (s.zones.stack.length > 0 || s.pending?.kind === 'order'); i++) {
    const d = s.pending;
    if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
    else if (d?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: d.options.filter((o) => !o.disabled).slice(0, 1).map((o) => o.id) });
    else if (d?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d?.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d?.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${d?.kind}`);
  }
  return s;
}

describe('CR 508.4, 608.2d: "tapped and attacking that opponent"', () => {
  it('the Dragon enters tapped and attacking the opponent the creature attacks (p3), not another', () => {
    const s = attackAndResolve('Test Wyrm Caller', ['Test Ember Drake'], 'p3');
    const drake = named(s, 'Test Ember Drake')[0]!;
    expect(drake).toBeDefined();
    expect(s.objects[drake]!.tapped).toBe(true);
    expect(attackerState(s, drake)?.defendingPlayer).toBe('p3');
  });
  it('negative: a creature card that is not a Dragon stays in hand', () => {
    const s = attackAndResolve('Test Wyrm Caller', ['Test Plain Bear'], 'p2');
    expect(named(s, 'Test Plain Bear')).toHaveLength(0);
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(true);
  });
});

describe('CR 508.4, 608.2d: "tapped and attacking" (the controller chooses whom)', () => {
  it('the Dragon enters tapped and attacking some player or planeswalker', () => {
    const s = attackAndResolve('Test Wyrm Herald', ['Test Ember Drake'], 'p2');
    const drake = named(s, 'Test Ember Drake')[0]!;
    expect(s.objects[drake]!.tapped).toBe(true);
    expect(attackerState(s, drake)).toBeDefined();
  });
});
