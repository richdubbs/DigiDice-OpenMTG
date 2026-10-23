/**
 * std-copy-2 (lane std-copy): the round's engine changes played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10; Strife Scholar // Awaken the Ages and Lightning Bolt are fixture cards). Each test is named after the rule it checks, with its negative
 * case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 722.3c-d, 707.10   "Whenever you cast a prepared spell, copy it": the spell cast from the exile copy of a prepare spell; not another spell
 *   CR 722.3a, 722.3c     "Each creature you control becomes prepared": only creatures with a prepare spell, and not one that is prepared already
 *   CR 707.10, 611.2c, 702.80a  "you may copy it. If you do, those spells gain wither": the spell and its copy deal damage as -1/-1 counters; declined, neither does
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { act, find, scenario } from '../../m3/scenario';
import { cast, drive, resolveAll, resolveTop, target, activate } from '../../m5/cr-examples/helpers';
import { card, counters, full } from '../cmd3/helpers';

const CODEX = card('Test Prepared Codex', 'Artifact Creature — Book Construct', 'Whenever you cast a prepared spell, copy it. You may choose new targets for the copy.\n{1}, {T}: Each creature you control becomes prepared.', ['1', '3']);
const TYRANT = card('Test Wither Tyrant', 'Creature — Dragon', 'Flying\nWhenever you cast an instant or sorcery spell with a single target, you may copy it. If you do, those spells gain wither. You may choose new targets for the copy.', ['5', '5']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['4', '4']);
const OX = card('Test Ox', 'Creature — Ox', '', ['4', '4']);
const INSIGHT = card('Test Insight', 'Instant', 'Draw a card.', undefined, '{R}');
const DEFS: CardDef[] = [CODEX, TYRANT, BEAR, OX, INSIGHT];

const SCHOLAR = 'Strife Scholar // Awaken the Ages';
const mountains = (n: number): string[] => Array<string>(n).fill('Mountain');
const exileCopies = (s: GameState): string[] => s.zones.exile.filter((id) => s.objects[id]!.kind === 'spellCopy');
const named = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
const spirits = (s: GameState): number => named(s, 'Spirit Token').length + named(s, 'Spirit').length;

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** Strife Scholar cast and resolved (it enters prepared) with the codex on the battlefield. */
function prepared(extra: { hand?: string[]; battlefield?: string[] } = {}): { s: GameState; scholar: string } {
  let s = scenario([SCHOLAR, 'Mountain', 'Lightning Bolt'], { p1: { hand: [SCHOLAR, ...(extra.hand ?? [])], battlefield: [...mountains(12), 'Test Prepared Codex', ...(extra.battlefield ?? [])] }, defs: DEFS });
  s = resolveTop(cast(s, SCHOLAR));
  return { s, scholar: named(s, SCHOLAR)[0]! };
}

describe('CR 722.3c-d, 707.10: "Whenever you cast a prepared spell, copy it."', () => {
  it('CR 722.3d: casting the exile copy of a prepare spell triggers it; the copy resolves too (two Spirits each)', () => {
    let { s } = prepared();
    expect(s.objects[named(s, SCHOLAR)[0]!]!.prepared).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p1', card: exileCopies(s)[0]!, method: 'prepare' }));
    expect(s.zones.stack.length).toBe(2); // the spell and the trigger
    s = resolveAll(s);
    expect(spirits(s)).toBe(4);
  });
  it('CR 722.3a: a spell cast from the hand is no prepared spell: no trigger', () => {
    let { s } = prepared({ hand: ['Lightning Bolt'] });
    s = cast(s, 'Lightning Bolt', [target('p2')]);
    expect(s.zones.stack.length).toBe(1);
  });
});

describe('CR 722.3a, 722.3c: "Each creature you control becomes prepared."', () => {
  it('CR 722.3a: after its prepare spell was cast the creature is unprepared; the ability prepares it again (a new exile copy); a creature with no prepare spell stays unprepared', () => {
    let { s, scholar } = prepared({ battlefield: ['Test Bear'] });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: exileCopies(s)[0]!, method: 'prepare' })));
    expect(s.objects[scholar]!.prepared).toBeUndefined();
    expect(exileCopies(s)).toEqual([]);
    s = resolveTop(activate(s, find(s, 'Test Prepared Codex', 'battlefield', 'p1')));
    expect(s.objects[scholar]!.prepared).toBe(true);
    expect(exileCopies(s)).toHaveLength(1);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.prepared).toBeUndefined();
  });
  it('CR 722.3a: a creature that is prepared already gets no second copy', () => {
    let { s, scholar } = prepared();
    s = resolveTop(activate(s, find(s, 'Test Prepared Codex', 'battlefield', 'p1')));
    expect(s.objects[scholar]!.prepared).toBe(true);
    expect(exileCopies(s)).toHaveLength(1);
  });
  it('CR 722.3a: creatures an opponent controls do not become prepared', () => {
    let s = scenario([SCHOLAR, 'Mountain'], { p1: { battlefield: [...mountains(3), 'Test Prepared Codex'] }, p2: { battlefield: [SCHOLAR] }, defs: DEFS });
    s = resolveTop(activate(s, find(s, 'Test Prepared Codex', 'battlefield', 'p1')));
    expect(s.objects[named(s, SCHOLAR)[0]!]!.prepared).toBeUndefined();
  });
});

describe('CR 707.10, 611.2c, 702.80a: "you may copy it. If you do, those spells gain wither."', () => {
  const setup = (): { s: GameState; bear: string; ox: string } => {
    const s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: [...mountains(2), 'Test Wither Tyrant'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] }, defs: DEFS });
    return { s, bear: find(s, 'Test Bear', 'battlefield', 'p2'), ox: find(s, 'Test Ox', 'battlefield', 'p2') };
  };
  it('CR 707.10c, 702.80a: copied with a new target, the spell and its copy each deal their damage as -1/-1 counters', () => {
    let { s, bear, ox } = setup();
    s = cast(s, 'Lightning Bolt', [target(bear)]);
    s = resolveAll(s, [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }, target(ox)]);
    expect(counters(s, bear, '-1/-1')).toBe(3);
    expect(counters(s, ox, '-1/-1')).toBe(3);
    expect(s.objects[bear]!.damage ?? 0).toBe(0);
  });
  it('CR 608.2d: declined, there is no copy and the spell deals ordinary damage', () => {
    let { s, bear, ox } = setup();
    s = cast(s, 'Lightning Bolt', [target(bear)]);
    s = resolveAll(s, [{ kind: 'yesNo', yes: false }]);
    expect(counters(s, bear, '-1/-1')).toBe(0);
    expect(s.objects[bear]!.damage).toBe(3);
    expect(counters(s, ox, '-1/-1')).toBe(0);
  });
  it('CR 115.9c: an instant with no target does not trigger it', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Insight'], battlefield: [...mountains(2), 'Test Wither Tyrant'] }, defs: DEFS });
    s = cast(s, 'Test Insight');
    expect(s.zones.stack.length).toBe(1);
  });
});
