/**
 * Fix round edh-fix-4 (a repair of the combined copy, not a card round): the behaviour it changed, played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler.
 *
 *   CR 614.12, 122.6, 614.17   Solemnity ruling 2017-07-14: "If an artifact, creature, enchantment, or land would enter the battlefield with counters on it at the same time that
 *                              Solemnity enters the battlefield, Solemnity doesn't stop it from getting those counters." (the permanents put onto the battlefield together)
 *   CR 608.2c, 608.2d, 101.4   "Each player may shuffle their hand and graveyard into their library. Each player who does draws two cards. You draw a card." (the rider of r5-refs
 *                              is read first for "Each player who does draws N cards", whatever else eff.draw could read in the ability)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const plusCounters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

interface Driver { yes?: boolean; target?: ObjectId }
function drive(s0: GameState, o: Driver = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: o.target! }] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Driver = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s: GameState, name: string, player: PlayerId = 'p1', o: Driver = {}): GameState => resolveAll(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), o);

const STASIS = card('Test Stasis', 'Enchantment', "Players can't get counters.\nCounters can't be put on artifacts, creatures, enchantments, or lands.");
const GROWER = card('Test Grower', 'Creature — Druid', 'This creature enters with two +1/+1 counters on it.', { pt: ['1', '1'] });
const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Planeswalker — Testy', loyalty: '3', colors: [], keywords: [], oracle_text: '+1: You gain 1 life.' } as unknown as OracleCard);
const RETURN = card('Test Revival', 'Sorcery', 'Return all permanent cards from your graveyard to the battlefield.');
const SINGLE = card('Test Recall', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield.');
const defs = [STASIS, GROWER, WALKER, RETURN, SINGLE];

describe('CR 614.12, 122.6 (Solemnity ruling 2017-07-14): a restriction on counters does not apply to the permanents entering in the same event as its source', () => {
  it('is fully automated', () => {
    expect(full(STASIS)).toBe(true);
    expect(full(RETURN)).toBe(true);
  });

  it('Stasis and a creature that enters with counters are returned together: the creature keeps its counters (and so does a planeswalker with its loyalty)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Revival'], graveyard: ['Test Stasis', 'Test Grower', 'Test Walker'] } });
    const s = cast(s0, 'Test Revival');
    const grower = findAll(s, 'Test Grower', 'battlefield', 'p1');
    expect(findAll(s, 'Test Stasis', 'battlefield', 'p1')).toHaveLength(1);
    expect(grower).toHaveLength(1);
    expect(plusCounters(s, grower[0]!)).toBe(2);
    expect(s.objects[find(s, 'Test Walker', 'battlefield', 'p1')]!.counters['loyalty']).toBe(3);
  });

  it('the order they are moved in does not matter: the creature first, or Stasis first', () => {
    for (const graveyard of [['Test Stasis', 'Test Grower'], ['Test Grower', 'Test Stasis']]) {
      const s = cast(scenario([], { defs, p1: { hand: ['Test Revival'], graveyard } }), 'Test Revival');
      expect(plusCounters(s, find(s, 'Test Grower', 'battlefield', 'p1')), graveyard.join(', ')).toBe(2);
    }
  });

  it('the negative case: Stasis already on the battlefield still stops a creature that enters later (alone, or in a group without it)', () => {
    const alone = cast(scenario([], { defs, p1: { hand: ['Test Recall'], battlefield: ['Test Stasis'], graveyard: ['Test Grower'] } }), 'Test Recall', 'p1');
    expect(plusCounters(alone, find(alone, 'Test Grower', 'battlefield', 'p1'))).toBe(0);
    const group = cast(scenario([], { defs, p1: { hand: ['Test Revival'], battlefield: ['Test Stasis'], graveyard: ['Test Grower', 'Test Walker'] } }), 'Test Revival');
    expect(plusCounters(group, find(group, 'Test Grower', 'battlefield', 'p1'))).toBe(0);
    expect(group.objects[find(group, 'Test Walker', 'battlefield', 'p1')]!.counters['loyalty'] ?? 0).toBe(3); // a planeswalker is none of the four types
  });

  it('the negative case: counters put on the creature afterwards (a later effect) are still stopped by the Stasis that came back with it', () => {
    const BOOST = card('Test Boost', 'Instant', 'Put a +1/+1 counter on target creature.');
    const s0 = scenario([], { defs: [...defs, BOOST], p1: { hand: ['Test Revival', 'Test Boost'], graveyard: ['Test Stasis', 'Test Grower'] } });
    let s = cast(s0, 'Test Revival');
    const grower = find(s, 'Test Grower', 'battlefield', 'p1');
    s = cast(s, 'Test Boost', 'p1', { target: grower });
    expect(plusCounters(s, grower)).toBe(2); // the Boost put none
  });
});

describe('CR 608.2c, 608.2d: "Each player who does draws two cards." is the rider of the "Each player may ..." before it, with a sentence after it that eff.draw reads', () => {
  const WHEEL = card('Test Wheel', 'Sorcery', 'Each player may shuffle their hand and graveyard into their library. Each player who does draws two cards. You draw a card.');
  it('is fully automated, with the draw inside the choice of each player (the same unit as without the last sentence)', () => {
    expect(full(WHEEL)).toBe(true);
    const json = JSON.stringify(WHEEL.faces[0]!.abilities);
    expect(json).toContain('"op":"draw","who":{"ref":"iterating"},"count":2');
    expect(json).not.toContain('"ref":"bound"');
  });
});
