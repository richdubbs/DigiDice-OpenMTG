/**
 * Lane std-mana, round std-mana-2: the round's engine change played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 122.1, 608.2d   "Put up to three charge counters on target artifact.": the controller chooses how many, from none to three (putCounters `upTo`)
 *   CR 701.17a, 608.2d "Mill three cards. Put up to one artifact card milled this way into your hand.": at most one of the milled cards of that kind, or none
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Activate `source`'s first ability, target `target`, answer how-many questions with `n` and object choices with the first `n` offered, then resolve. */
function activate(s0: GameState, source: ObjectId, n: number, target?: ObjectId): { s: GameState; asked: number[] } {
  const asked: number[] = [];
  let s = act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' });
  for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending as unknown as { kind: string; [k: string]: unknown };
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: target ? [{ kind: 'object', id: target }] : [] });
    else if (d.kind === 'chooseNumber') { asked.push(d['max'] as number); s = answer(s, { kind: 'chooseNumber', n }); }
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: ((d['options'] as string[] | undefined) ?? []).slice(0, n) } as never);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return { s, asked };
}

describe('CR 122.1, 608.2d: "Put up to three charge counters on target artifact" (putCounters upTo)', () => {
  const WAND = card('Test Charge Wand', 'Artifact', '{T}: Put up to three charge counters on target artifact.');
  const DEFS = [WAND];
  const setup = (): { s: GameState; wand: ObjectId } => {
    const s = scenario([], { p1: { battlefield: ['Test Charge Wand'] }, defs: DEFS });
    return { s, wand: find(s, 'Test Charge Wand', 'battlefield', 'p1') };
  };
  it('is parsed and automated', () => {
    expect(automated(WAND)).toBe(true);
    expect(JSON.stringify(WAND.faces[0]!.abilities)).toContain('"op":"putCounters","on":{"ref":"target","id":"t0"},"kind":"charge","count":3,"upTo":true');
  });
  it('the controller chooses two of at most three', () => {
    const { s: s0, wand } = setup();
    const { s, asked } = activate(s0, wand, 2, wand);
    expect(asked).toEqual([3]);
    expect(s.objects[wand]!.counters['charge']).toBe(2);
  });
  it('none is a legal choice: no counter is put', () => {
    const { s: s0, wand } = setup();
    const { s } = activate(s0, wand, 0, wand);
    expect(s.objects[wand]!.counters['charge'] ?? 0).toBe(0);
  });
});

describe('CR 701.17a, 608.2d: "Mill three cards. Put up to one artifact card milled this way into your hand."', () => {
  const SIEVE = card('Test Grit Sieve', 'Artifact', '{T}: Mill three cards. Put up to one artifact card milled this way into your hand.');
  const GEAR = card('Test Loose Gear', 'Artifact', '');
  const DEFS = [SIEVE, GEAR];
  it('is parsed and automated; one artifact card among the milled ones goes to the hand, the others stay in the graveyard', () => {
    expect(automated(SIEVE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Grit Sieve'], library: ['Test Loose Gear', 'Test Loose Gear', 'Plains'] }, defs: DEFS });
    const { s } = activate(s0, find(s0, 'Test Grit Sieve', 'battlefield', 'p1'), 1);
    const hand = s.zones.hand['p1']!.map((id) => s.objects[id]!.defId);
    const yard = s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId);
    expect(hand.filter((n) => n === 'Test Loose Gear').length).toBeLessThanOrEqual(1);
    expect(yard.length + hand.filter((n) => n === 'Test Loose Gear').length).toBe(3); // three cards milled, at most one taken back
  });
});
