/**
 * p2-player-rules-3 (Phase 2 lane p2-player-rules): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 611.3a, 101.2   "As long as ~ is attached to a creature, your opponents can't cast spells during your turn": only while attached, only during your turn
 *   CR 701.30b-c       "Whenever you clash and win": your own clash won triggers it, a lost one doesn't; so does winning as the opponent of another player's clash
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, find, labels, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));

/** Answer decisions (payment automatic, yes/no: `yes`, objects: the first ones offered); stop at the next priority. */
function settle(s0: GameState, yes = false): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; options: string[]; min: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, yes = false): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, yes);
  return s;
}

describe('CR 611.3a, 101.2: "As long as ~ is attached to a creature, your opponents can\'t cast spells during your turn."', () => {
  const FLAIL = card('Test Gag Flail', 'Artifact — Equipment', "As long as ~ is attached to a creature, your opponents can't cast spells during your turn.\nEquip {0}");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');
  const defs = [FLAIL, BEAR, TONIC];
  it('is automated; while attached, the opponent can\'t cast during your turn; unattached, they can', () => {
    expect(automated(FLAIL)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Gag Flail', 'Test Bear'] }, p2: { hand: ['Test Tonic'] } });
    expect(labels(pass(s0), 'p2')).toContain('Cast Test Tonic');
    const flail = find(s0, 'Test Gag Flail', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = tweak(s0, (x) => { x.objects[flail]!.attachedTo = bear; });
    expect(labels(pass(s1), 'p2')).not.toContain('Cast Test Tonic');
  });
  it('attached, it does not stop the opponent during their own turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Gag Flail', 'Test Bear'] }, p2: { hand: ['Test Tonic'] } });
    const flail = find(s0, 'Test Gag Flail', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = tweak(s0, (x) => { x.objects[flail]!.attachedTo = bear; });
    for (let guard = 0; !(s.turn.number === 2 && s.turn.step === 'main1') && guard < 200; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(labels(s, 'p2')).toContain('Cast Test Tonic');
  });
});

describe('CR 701.30b-c: "Whenever you clash and win, you gain 2 life."', () => {
  const ECHO = card('Test Echo Grove', 'Enchantment', 'Whenever you clash and win, you gain 2 life.');
  const DUEL = card('Test Duel', 'Instant', 'Clash with an opponent.');
  const ONE = card('Test Pebble', 'Artifact', '', undefined, '{1}');
  const FIVE = card('Test Boulder', 'Artifact', '', undefined, '{5}');
  const defs = [ECHO, DUEL, ONE, FIVE];
  it('is automated; a clash you win triggers it, one you lose does not', () => {
    expect(automated(ECHO)).toBe(true);
    let won = scenario([], { defs, p1: { battlefield: ['Test Echo Grove'], hand: ['Test Duel'], library: ['Test Boulder'] }, p2: { library: ['Test Pebble'] } });
    const l0 = life(won, 'p1');
    won = resolveAll(settle(castCard(won, 'Test Duel')));
    expect(life(won, 'p1')).toBe(l0 + 2);
    let lost = scenario([], { defs, p1: { battlefield: ['Test Echo Grove'], hand: ['Test Duel'], library: ['Test Pebble'] }, p2: { library: ['Test Boulder'] } });
    lost = resolveAll(settle(castCard(lost, 'Test Duel')));
    expect(life(lost, 'p1')).toBe(l0);
  });
  it('winning as the opponent of another player\'s clash triggers it too (both players clash, CR 701.30b)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Echo Grove'], library: ['Test Boulder'] }, p2: { hand: ['Test Duel'], library: ['Test Pebble'] } });
    const l0 = life(s, 'p1');
    s = pass(s);
    s = resolveAll(settle(castCard(s, 'Test Duel', { player: 'p2' })));
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Duel');
    expect(life(s, 'p1')).toBe(l0 + 2);
  });
});
