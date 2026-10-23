/**
 * LOOK2 (the follow-up of LOOK1): "that card" after the instruction that moved a binding into exile or a graveyard is that card, never the creature of the trigger's
 * damage event. Before, the sentence "You may cast that card for as long as it remains exiled." after "look at the top card of that player's library, then exile it
 * face down" had two candidates for "that card" (the card, and the attacking creature the discourse model may call a card), so the whole effect was manual
 * (parser/lower/anaphora.ts#movedCardFocus, #sentenceReferences). Played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 400.7, 608.2c   the card exiled face down is a new object in exile, and the permission of the next sentence names exactly that object: you may cast it from
 *                      exile (though you don't own it), the creature that dealt the damage is neither exiled nor named
 *   CR 406.3           the player who looked at the card and exiled it face down may still look at it, so they can cast it
 *   CR 611.2b, 400.7   "for as long as it remains exiled": once the card leaves exile the permission is gone
 *   CR 400.7, 608.2c   "... then put it into its owner's graveyard. You may cast that card this turn.": cast from the opponent's graveyard
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../src/index';
import { act, answer, find, findAll, legal, pass, scenario } from '../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the parse itself is checked by look2-anaphora.test.ts). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const trigger = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities.find((a) => a.kind === 'triggered'));
const libraryNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => s.objects[id]!.defId);

/** Answer the decisions that come up until priority: payments automatic, no "you may" in these abilities. */
function drive(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
/** Attack p2 with `attacker` (no blocks) and play on to the second main phase, letting what combat damage triggers resolve. */
function raid(s0: GameState, attacker: ObjectId): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] }));
  for (let i = 0; i < 80 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? (s.zones.stack.length > 0 ? resolveAll(s) : pass(s)) : drive(s);
  return s;
}
/** May p1 cast the object now? */
const offered = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'cast').some((a) => a.object === id);
/** Cast `id` as p1, pay automatically and let it resolve. */
const castNow = (s: GameState, id: ObjectId): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: id })));
/** The objects the permissions in force name (the effect handler fixed them as the permission was created, effects/handlers/lasting-fix.ts). */
const permitted = (s: GameState): unknown[] => s.continuousEffects.filter((e) => e.effect.s === 'permit').map((e) => (e.effect as { of?: { is?: unknown } }).of?.is);

const HOUND = card('Test Gearhound', 'Artifact Creature — Dog', '', { pt: ['1', '1'] });
const IDOL = card('Test Idol', 'Artifact', '', { cost: '{2}' });
const GROVE = card('Test Grove', 'Land', '');

describe('CR 400.7, 608.2c, 406.3: "Whenever an artifact creature you control deals combat damage to a player, look at the top card of that player\'s library, then exile it face down. You may cast that card for as long as it remains exiled."', () => {
  const CHARTER = card('Test Plunder Charter', 'Enchantment', "Whenever an artifact creature you control deals combat damage to a player, look at the top card of that player's library, then exile it face down. You may cast that card for as long as it remains exiled.");
  const DEFS = [CHARTER, HOUND, IDOL, GROVE];
  const setup = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Plunder Charter', { name: 'Test Gearhound', since: 0 }, 'Plains', 'Plains'] }, p2: { library: ['Test Idol', 'Test Grove'] } });

  it('is understood, and "that card" is the card the look bound and the move exiled, never the creature that dealt the damage', () => {
    expect(noManual(CHARTER)).toBe(true);
    const j = trigger(CHARTER);
    expect(j).toMatch(/"op":"look"[^]*"as":"(\w+)"[^]*"op":"move","what":\{"ref":"bound","name":"\1"\},"to":\{"zone":"exile","faceDown":true\}[^]*"s":"permit"[^]*"of":\{"is":\{"ref":"bound","name":"\1"\}\}/);
    expect(j).not.toContain('"role":"source"');
  });

  it('CR 400.7, 608.2c: the card exiled face down may be cast from exile by you (its owner is the opponent); the creature stays on the battlefield and is not named', () => {
    const s0 = setup();
    const hound = find(s0, 'Test Gearhound', 'battlefield', 'p1');
    const s = raid(s0, hound);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    expect(libraryNames(s, 'p2')[0]).toBe('Test Grove');
    const exiled = findAll(s, 'Test Idol', 'exile', 'p2');
    expect(exiled).toHaveLength(1);
    expect(s.objects[exiled[0]!]!.faceDown).toBe(true);
    expect(s.zones.battlefield).toContain(hound);
    expect(JSON.stringify(permitted(s))).toContain(`"id":"${exiled[0]}"`);
    expect(JSON.stringify(permitted(s))).not.toContain(`"id":"${hound}"`);
    expect(offered(s, exiled[0]!)).toBe(true); // CR 406.3: you looked at it as it was exiled face down, so you may still look at it
    const after = castNow(s, exiled[0]!);
    const idol = findAll(after, 'Test Idol', 'battlefield');
    expect(idol).toHaveLength(1);
    expect(after.objects[idol[0]!]!.controller).toBe('p1');
    expect(after.objects[idol[0]!]!.owner).toBe('p2');
  });

  it('CR 611.2b, 400.7: "for as long as it remains exiled": once the card has left exile, no permission is left', () => {
    const s0 = setup();
    const s = raid(s0, find(s0, 'Test Gearhound', 'battlefield', 'p1'));
    expect(permitted(s)).toHaveLength(1);
    const after = castNow(s, findAll(s, 'Test Idol', 'exile', 'p2')[0]!);
    expect(permitted(after)).toHaveLength(0);
  });
});

describe('CR 400.7, 608.2c: "... look at the top card of that player\'s library, then put it into its owner\'s graveyard. You may cast that card this turn."', () => {
  const PACT = card('Test Graverob Pact', 'Enchantment', "Whenever an artifact creature you control deals combat damage to a player, look at the top card of that player's library, then put it into its owner's graveyard. You may cast that card this turn.");
  const DEFS = [PACT, HOUND, IDOL, GROVE];

  it('is understood, and "that card" is the card put into the graveyard', () => {
    expect(noManual(PACT)).toBe(true);
    expect(trigger(PACT)).toMatch(/"op":"move","what":\{"ref":"bound","name":"(\w+)"\},"to":\{"zone":"graveyard"\}[^]*"of":\{"is":\{"ref":"bound","name":"\1"\}\}/);
  });

  it('the card is cast from the opponent\'s graveyard this turn; the creature that dealt the damage stays where it is', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Graverob Pact', { name: 'Test Gearhound', since: 0 }, 'Plains', 'Plains'] }, p2: { library: ['Test Idol', 'Test Grove'] } });
    const hound = find(s0, 'Test Gearhound', 'battlefield', 'p1');
    const s = raid(s0, hound);
    const card0 = find(s, 'Test Idol', 'graveyard', 'p2');
    expect(s.zones.battlefield).toContain(hound);
    expect(offered(s, card0)).toBe(true);
    const after = castNow(s, card0);
    const idol = findAll(after, 'Test Idol', 'battlefield');
    expect(idol).toHaveLength(1);
    expect(after.objects[idol[0]!]!.controller).toBe('p1');
  });
});
