/**
 * pc-combat-4 (Commander precon lane pc-combat): "Whenever one or more creatures an opponent controls attack you and aren't blocked, that player draws three cards and gains control of
 * this artifact. Untap it." (Coveted Jewel's shape) played through the engine with a synthetic card compiled by the default compiler, four players. CR cites from memory, unverified.
 *
 *   CR 509.1h, 508.1b, 603.2c  unblocked attackers of a player; one trigger for the declaration
 *   CR 108.4, 613.1b, 701.21   the attacking opponent draws and gains control for good; the artifact untaps
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { answer, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: '{0}', oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
const GEM = card('Test Tempting Gem', 'Artifact', 'Whenever one or more creatures an opponent controls attack you and aren\'t blocked, that player draws three cards and gains control of this artifact. Untap it.');
const RAIDER = card('Test Hill Raider', 'Creature — Goblin', '', ['1', '1']);
const WALL = card('Test Stone Wall', 'Creature — Wall', '', ['0', '4']);
const WALKER = card('Test Oath Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const DEFS = [GEM, RAIDER, WALL, WALKER];
const WALK = { name: 'Test Oath Walker', counters: { loyalty: 3 } };

describe('the synthetic card is automated', () => { it('plays fully', () => { expect(GEM.automation.level, JSON.stringify(GEM.automation)).toBe('full'); }); });

const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

/** p2 attacks; p1 (with the Gem) blocks as `block` says (raider index -> wall); returns the state after combat damage. */
function play(attacks: ('p1' | 'p3' | 'walker')[], block: number[] = []): GameState {
  let s = mpScenario({
    defs: DEFS, options: { startingPlayer: 'p2' },
    zones: { p1: { battlefield: ['Test Tempting Gem', 'Test Stone Wall', 'Test Stone Wall', WALK] }, p2: { battlefield: attacks.map(() => 'Test Hill Raider') } },
  });
  const raiders = named(s, 'Test Hill Raider');
  const walls = named(s, 'Test Stone Wall');
  const gem = named(s, 'Test Tempting Gem')[0]!;
  s.objects[gem]!.tapped = true;
  s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p2', 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks: attacks.map((d, i) => ({ attacker: raiders[i]!, defender: d === 'walker' ? named(s, 'Test Oath Walker')[0]! : d })) });
  for (let i = 0; i < 80 && s.turn.step !== 'combatDamage' && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending!;
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: d.player === 'p1' ? block.map((r, k) => ({ blocker: walls[k]!, attacker: raiders[r]! })) : [] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${d.kind}`);
  }
  for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'priority' ? pass(s) : s;
  return s;
}
const handOf = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const gemOf = (s: GameState): ObjectId => named(s, 'Test Tempting Gem')[0]!;

describe('CR 509.1h, 508.1b: "one or more creatures an opponent controls attack you and aren\'t blocked"', () => {
  it('two unblocked attackers at p1: one trigger; p2 draws three and gains control of the Gem, which untaps', () => {
    const base = mpScenario({ defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p2: { battlefield: [] } } });
    const s = play(['p1', 'p1']);
    expect(handOf(s, 'p2') - handOf(base, 'p2')).toBe(3);
    expect(s.objects[gemOf(s)]!.controller).toBe('p2');
    expect(s.objects[gemOf(s)]!.tapped).toBe(false);
  });
  it('one of two attackers blocked, one not: still triggers (one or more unblocked)', () => {
    const s = play(['p1', 'p1'], [0]);
    expect(s.objects[gemOf(s)]!.controller).toBe('p2');
  });
  it('negative: every attacker blocked: nothing happens', () => {
    const s = play(['p1', 'p1'], [0, 1]);
    expect(s.objects[gemOf(s)]!.controller).toBe('p1');
    expect(s.objects[gemOf(s)]!.tapped).toBe(true);
  });
  it('negative: unblocked attackers at p3 (not me), or at my planeswalker: nothing happens', () => {
    expect(play(['p3', 'p3']).objects[gemOf(play(['p3', 'p3']))]!.controller).toBe('p1');
    const w = play(['walker']);
    expect(w.objects[gemOf(w)]!.controller).toBe('p1');
  });
  it('one unblocked at p1 and one at p3: one trigger, the Gem changes hands once', () => {
    const s = play(['p1', 'p3']);
    expect(s.objects[gemOf(s)]!.controller).toBe('p2');
  });
});
