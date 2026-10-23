/**
 * Phase 2 lane p2-coinflip, round p2-coinflip-3: the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified.
 *
 *   CR 608.2d, 110.2      "return a Zombie creature card at random from your graveyard to the battlefield": no player chooses; it enters under your control
 *   CR 602.5b, 404.1      "Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard"
 *   CR 705.2              "flip two coins. Create a ... token for each flip you win": each flip is called; one token per won flip
 *   CR 701.9b, 603.5      "that player may discard a card at random. If the player does, untap that creature."
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, put, scenario, tweak } from '../../m5/helpers';
import { card, resolveAll } from '../cmd3/helpers';

const zoneNames = (s: GameState, zone: 'hand' | 'graveyard', p = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const onField = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

describe('CR 608.2d, 602.5b: "{T}: Return a Zombie creature card at random from your graveyard to the battlefield. Activate only during your turn and only if ..."', () => {
  const TYRANT = card('Test Crypt Lord', 'Creature — Zombie', '{T}: Return a Zombie creature card at random from your graveyard to the battlefield. Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard.', ['2', '2']);
  const ZOMBIE = card('Test Shambler', 'Creature — Zombie', '', ['2', '2']);
  const BEAR = card('Test Old Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [TYRANT, ZOMBIE, BEAR];
  const board = (graveyard: string[]): GameState => scenario(['Plains'], { p1: { battlefield: ['Test Crypt Lord'], graveyard }, defs: DEFS });
  const activations = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => (a as { object?: string }).object === find(s, 'Test Crypt Lord', 'battlefield', 'p1')).length;
  it('CR 608.2d, 110.2: with three Zombie creature cards in the graveyard one of them enters under your control, no player choosing it; the Bear stays', () => {
    let s = board(['Test Shambler', 'Test Shambler', 'Test Shambler', 'Test Old Bear']);
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Crypt Lord', 'battlefield', 'p1'), ability: 'p:0:0' });
    s = resolveAll(s);
    expect(onField(s, 'p1')).toEqual(['Test Crypt Lord', 'Test Shambler']);
    expect(zoneNames(s, 'graveyard')).toEqual(['Test Old Bear', 'Test Shambler', 'Test Shambler']);
  });
  it('CR 602.5b: with two Zombie creature cards (and a Bear) the ability cannot be activated', () => {
    expect(activations(board(['Test Shambler', 'Test Shambler', 'Test Shambler']))).toBe(1);
    expect(activations(board(['Test Shambler', 'Test Shambler', 'Test Old Bear']))).toBe(0);
  });
});

describe('CR 705.2: "{0}: Flip two coins. Create a 1/1 colorless Thopter artifact creature token for each flip you win."', () => {
  const FLIPPER = card('Test Coin Tinker', 'Creature — Human Artificer', '{0}: Flip two coins. Create a 1/1 colorless Thopter artifact creature token for each flip you win.\nWhenever you win a coin flip, you gain 1 life.', ['1', '1']);
  const DEFS: CardDef[] = [FLIPPER];
  it('CR 705.2: each of the two flips is called; one token per won flip (each won flip is also one life from "whenever you win a coin flip")', () => {
    const seen = new Set<number>();
    for (const seed of ['tink-a', 'tink-b', 'tink-c', 'tink-d', 'tink-e', 'tink-f']) {
      let s = scenario(['Plains'], { p1: { battlefield: ['Test Coin Tinker'] }, defs: DEFS, seed });
      const start = life(s, 'p1');
      s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Coin Tinker', 'battlefield', 'p1'), ability: 'p:0:0' });
      let calls = 0;
      for (let guard = 0; guard < 50; guard++) {
        const d = s.pending as unknown as { kind: string; prompt?: string } | undefined;
        if (d?.kind === 'chooseOption' && (d.prompt ?? '').startsWith('Call the coin flip')) {
          calls++;
          s = answer(s, { kind: 'chooseOption', ids: ['heads'] });
        } else if (d?.kind === 'priority' && s.zones.stack.length === 0) break;
        else if (d?.kind === 'priority') s = pass(s);
        else break;
      }
      const tokens = onField(s, 'p1').filter((n) => n.includes('Thopter')).length;
      expect(calls, seed).toBe(2);
      expect(tokens, seed).toBe(life(s, 'p1') - start);
      seen.add(tokens);
    }
    expect(seen.size, 'the seeds give different numbers of won flips').toBeGreaterThan(1);
  });
});

describe('CR 701.9b, 603.5: "At the beginning of the upkeep of enchanted creature\'s controller, that player may discard a card at random. If the player does, untap that creature."', () => {
  const NUMB = card('Test Numbing Haze', 'Enchantment — Aura', "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step.\nAt the beginning of the upkeep of enchanted creature's controller, that player may discard a card at random. If the player does, untap that creature.");
  const BEAR = card('Test Old Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [NUMB, BEAR];
  /** p2's tapped Bear enchanted by p1's Haze, p2 holding `hand`; played to p2's upkeep, the trigger resolved with p2's answer to "may". */
  const upkeep = (hand: string[], yes: boolean): { s: GameState; bear: string } => {
    const s0 = scenario([], { p2: { battlefield: ['Test Old Bear'], hand }, defs: DEFS });
    const bear = find(s0, 'Test Old Bear', 'battlefield', 'p2');
    let s = tweak(s0, (x) => { const h = put(x, 'p1', 'battlefield', 'Test Numbing Haze'); x.objects[h]!.attachedTo = bear; x.objects[bear]!.tapped = true; });
    s = advanceTo(s, 2, 'upkeep');
    for (let guard = 0; guard < 20; guard++) {
      const d = s.pending as unknown as { kind: string; player?: string } | undefined;
      if (d?.kind === 'yesNo') { expect(d.player).toBe('p2'); s = answer(s, { kind: 'yesNo', yes }); } else if (d?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else break;
    }
    return { s, bear };
  };
  it('CR 701.9b, 603.5: the player who chooses to discards one card of their hand at random (no one picks it) and the creature untaps', () => {
    const { s, bear } = upkeep(['Test Old Bear'], true);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Old Bear']);
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('CR 603.5: declining, nothing is discarded and the creature stays tapped; with an empty hand nothing is discarded, so it stays tapped too', () => {
    const no = upkeep(['Test Old Bear'], false);
    expect(zoneNames(no.s, 'hand', 'p2')).toEqual(['Test Old Bear']);
    expect(no.s.objects[no.bear]!.tapped).toBe(true);
    const empty = upkeep([], true);
    expect(empty.s.objects[empty.bear]!.tapped).toBe(true);
  });
});
