/**
 * p2-intervening-3 (lane p2-intervening): the intervening "if" readings of parser/holes/p2iv3.ts played through the engine with synthetic cards compiled by the
 * game's default compiler (wordings invented, design 6.10), and their compiled conditions. Each test is named after the rule it checks, with its negative case.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 506.2, 508.1b, 119.1  "if it's attacking the player with the most life or tied for most life"
 *   CR 601.2h, 106.1         "if at least three mana of the same color was spent to cast it"
 *   CR 400.3                 "if a permanent was put into your hand from the battlefield this turn"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, find, life, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';
import { localIndex } from '../../m5/parser/support';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const castAt = (s: GameState, name: string, target?: ObjectId, player = 'p1'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), target ? { targets: [{ kind: 'object', id: target }] } : {}));
const tweak = (s: GameState, f: (t: GameState) => void): GameState => { const t = structuredClone(s); f(t); return t; };

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const CHALLENGER = card('Test Crown Challenger', 'Creature — Human', "Whenever this creature attacks, if it's attacking the player with the most life or tied for most life, you gain 2 life.", { pt: ['2', '2'] });
const TINKER = card('Test Tinker Drone', 'Artifact Creature — Construct', 'When this creature enters, if at least three mana of the same color was spent to cast it, you gain 2 life.', { pt: ['2', '2'], cost: '{3}' });
const RECALL = card('Test Recall', 'Instant', "Return target creature to its owner's hand.");
const KEEPER = card('Test Recall Keeper', 'Enchantment', 'At the beginning of your end step, if a permanent was put into your hand from the battlefield this turn, you gain 2 life.');
const DEFS: CardDef[] = [BEAR, CHALLENGER, TINKER, RECALL, KEEPER];

describe('the synthetic cards are automated, with the expected conditions', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('the conditions compile as parser/holes/p2iv3.ts reads them', () => {
    const cond = (d: CardDef): unknown => (d.faces[0]!.abilities[0] as { interveningIf?: unknown }).interveningIf;
    expect(cond(CHALLENGER)).toEqual({ cond: 'all', of: [{ cond: 'matches', object: { ref: 'self' }, filter: { attacking: { defender: 'opponent' } } }, { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, lifeVs: { op: '>', than: { ref: 'defending' } } }, op: '==', right: 0 }] });
    expect(cond(TINKER)).toEqual({ cond: 'any', of: (['W', 'U', 'B', 'R', 'G'] as const).map((color) => ({ cond: 'wasCast', spent: { color, atLeast: 3 } })) });
    expect(cond(KEEPER)).toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { owner: 'you' }, from: 'battlefield', to: 'hand' }, scope: 'turn' });
  });
});

describe('CR 506.2, 119.1: "Whenever this creature attacks, if it\'s attacking the player with the most life or tied for most life, ..."', () => {
  const attack = (lives: [number, number]): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Crown Challenger'] } });
    s = tweak(advanceTo(s, 3, 'main1'), (t) => { t.players[0]!.life = lives[0]; t.players[1]!.life = lives[1]; });
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Crown Challenger', 'battlefield', 'p1'), 'p2']]);
    return passUntil(s, (x) => x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'combat');
  };
  it('tied at 20: you gain 2 life; the defending player has 18 to your 20: nothing', () => {
    expect(life(attack([20, 20]), 'p1')).toBe(22);
    expect(life(attack([20, 18]), 'p1')).toBe(20);
  });
});

describe('CR 601.2h, 106.1: "When this creature enters, if at least three mana of the same color was spent to cast it, ..."', () => {
  it('cast with three Plains: you gain 2 life; with two Plains and an Island: nothing', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Plains'], hand: ['Test Tinker Drone'] } });
    s = castAt(s, 'Test Tinker Drone');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Tinker Drone')).toBe(true);
    expect(life(s, 'p1')).toBe(22);
    let t = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Island'], hand: ['Test Tinker Drone'] } });
    t = castAt(t, 'Test Tinker Drone');
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Test Tinker Drone')).toBe(true);
    expect(life(t, 'p1')).toBe(20);
  });
});

describe('CR 400.3: "At the beginning of your end step, if a permanent was put into your hand from the battlefield this turn, ..."', () => {
  it('your creature returned to your hand: you gain 2 life; the opponent\'s creature returned to theirs: nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Recall Keeper', 'Test Bear'], hand: ['Test Recall'] } });
    s = castAt(s, 'Test Recall', find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(life(resolveAll(advanceTo(s, 1, 'end')), 'p1')).toBe(22);
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Recall Keeper'], hand: ['Test Recall'] }, p2: { battlefield: ['Test Bear'] } });
    t = castAt(t, 'Test Recall', find(t, 'Test Bear', 'battlefield', 'p2'));
    expect(life(resolveAll(advanceTo(t, 1, 'end')), 'p1')).toBe(20);
  });
});

/** Near misses: each stays manual. */
const NEAR_MISSES: readonly string[] = [
  "Whenever this creature attacks, if it's attacking the player with the least life, you gain 2 life.",
  'When this creature enters, if three mana of the same color was spent to cast it, you gain 2 life.',
  'At the beginning of your end step, if a permanent was put into your graveyard from the battlefield this turn, you gain 2 life.',
];
const compile = (text: string): CardDef => card('Test Vigil Keeper', 'Creature — Human', text, { pt: ['2', '2'] });

describe('p2-intervening-3: near misses stay manual (fail closed)', () => {
  for (const text of NEAR_MISSES) it(`"${text}"`, () => expect(compile(text).automation.level).not.toBe('full'));
});

const index = localIndex();
describe.skipIf(index === null)('p2-intervening-3 design 6.10 (local index): synthetic wordings', () => {
  it('no synthetic line is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) { lines.add(l.trim()); lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim()); }
      }
    }
    const ours = [CHALLENGER, TINKER, KEEPER].map((d) => d.faces[0]!.abilities[0]!.text ?? '').concat(NEAR_MISSES);
    for (const l of ours) {
      expect(lines.has(l), l).toBe(false);
      expect(lines.has(l.replace(/\bthis creature\b/g, '~')), l).toBe(false);
    }
  });
});
