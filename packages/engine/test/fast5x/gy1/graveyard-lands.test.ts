/**
 * GY1: "You may play lands from your graveyard." as a static ability of a permanent (parser/templates/zz-fast5x/gy1.json, statics/play-permits.ts
 * #isGraveyardLandPermit, capability `permit:play.zone`), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * wordings, design 6.10) and fixture cards. Each test is named after the rule it checks.
 *
 *   CR 116.2a, 305.1   a land card in your graveyard is offered as a land play while you control the permanent, and not after it leaves the battlefield
 *   CR 305.2, 305.2a   playing it uses your land play: a second land that turn is refused (from the graveyard or the hand)
 *   CR 305.1           it enters the battlefield
 *   CR 404.1           "your graveyard": an opponent's graveyard lands are not offered (and the opponent gets nothing from your permanent)
 *   CR 305.9, 601.3    nonland cards in the graveyard are not offered, and nothing is ever cast this way
 *   CR 305.1, 305.3    not at a time you couldn't play a land (sorcery timing, your own turn)
 *   CR 712.12          a modal double-faced card is played with its land face, as from the hand
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { PLAY_PERMIT_CAPABILITIES, isGraveyardLandPermit } from '../../../src/statics/play-permits';
import type { PermissionDef } from '../../../src/types/ability';
import { act, advanceTo, find, scenario } from '../../m5/helpers';
import { activate, drive, resolveAll } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';

const CRUCIBLE = synthetic('Test Kiln of Ages', 'Artifact', '{3}', 'You may play lands from your graveyard.\nSacrifice this artifact: You gain 1 life.');
const MDFC = 'Shatterskull Smashing // Shatterskull, the Hammer Pass';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
/** The labels of `player`'s land plays that are not from the hand. */
const offPlays = (s: GameState, player: PlayerId = 'p1'): string[] =>
  legalActions(s, player).filter((a) => a.kind === 'playLand' && s.objects[a.object!]!.zone !== 'hand').map((a) => a.label);
const lands = (s: GameState, player: PlayerId = 'p1'): number => s.players.find((p) => p.id === player)!.landsPlayedThisTurn;
const onField = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => nameOf(s, id) === name);

const board = (p1: { battlefield?: string[]; hand?: string[]; graveyard?: string[] }, p2: { graveyard?: string[] } = {}): GameState =>
  scenario(['Forest', 'Mountain', 'Grizzly Bears', MDFC], { p1: { battlefield: ['Test Kiln of Ages'], ...p1 }, p2, defs: [CRUCIBLE] });

describe('GY1: the template, the capability and the permission form', () => {
  it('the synthetic card compiles with no manual ability; permit:play.zone is registered, and only for exactly this form (fail closed)', () => {
    expect(CRUCIBLE.faces[0]!.abilities.filter((a) => a.kind === 'manual')).toEqual([]);
    expect(PLAY_PERMIT_CAPABILITIES).toContain('permit:play.zone');
    expect(ENGINE_CAPABILITIES.has('permit:play.zone')).toBe(true);
    // the plain fields stay unregistered: any other "from" form keeps the card manual
    for (const c of ['feature:permit.play.from', 'feature:permit.play.of', 'permit:play', 'feature:permit.cast.from']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    const exact: PermissionDef = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: ['Land'] }, from: 'graveyard' };
    expect(isGraveyardLandPermit(exact)).toBe(true);
    expect(isGraveyardLandPermit({ ...exact, from: 'exile' })).toBe(false);
    expect(isGraveyardLandPermit({ ...exact, action: 'cast' })).toBe(false);
    expect(isGraveyardLandPermit({ ...exact, of: { types: ['Creature'] } })).toBe(false);
    // std-rl (CR 205.3i): lands of one land type are honored too ("You may play Forests from your graveyard", "... Desert lands ..."); a nonland subtype or two are not
    expect(isGraveyardLandPermit({ ...exact, of: { types: ['Land'], subtypes: ['Forest'] } })).toBe(true);
    expect(isGraveyardLandPermit({ ...exact, of: { subtypes: ['Forest'] } })).toBe(true);
    expect(isGraveyardLandPermit({ ...exact, of: { subtypes: ['Goblin'] } })).toBe(false);
    expect(isGraveyardLandPermit({ ...exact, of: { types: ['Land'], subtypes: ['Forest', 'Island'] } })).toBe(false);
    expect(isGraveyardLandPermit({ ...exact, who: { ref: 'each' } as unknown as PermissionDef['who'] })).toBe(false);
    expect(isGraveyardLandPermit({ ...exact, count: 1 })).toBe(false);
    expect(isGraveyardLandPermit({ ...exact, fromTop: true })).toBe(false);
  });
  it('a card whose other sentences are automated compiles full except for the template status cap (Crucible-like: the permission alone)', () => {
    const card = compileCard({ name: 'Test Kiln', layout: 'normal', type_line: 'Artifact', mana_cost: '{3}', oracle_text: 'You may play lands from your graveyard.', colors: [] } as unknown as OracleCard);
    expect(card.faces[0]!.abilities.map((a) => a.kind)).toEqual(['static']);
    expect(card.automation.level).not.toBe('manual');
  });
});

describe('CR 116.2a, 305.1: a land card in your graveyard is offered while you control the permanent', () => {
  it('the land in your graveyard is a playLand legal action', () => {
    const s = board({ graveyard: ['Forest'] });
    expect(offPlays(s)).toEqual(['Play Forest from graveyard']);
    const play = legalActions(s, 'p1').find((a) => a.kind === 'playLand' && a.object === find(s, 'Forest', 'graveyard', 'p1'))!;
    expect(play.action).toEqual({ type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') });
  });
  it('without the permanent nothing is offered and the play is refused (CR 305.1: from the hand only)', () => {
    const s = scenario(['Forest'], { p1: { graveyard: ['Forest'] } });
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.1');
  });
  it('after the permanent leaves the battlefield the permission is gone (CR 113.6, 611.3a)', () => {
    let s = board({ graveyard: ['Forest'] });
    s = resolveAll(activate(s, find(s, 'Test Kiln of Ages', 'battlefield')));
    expect(onField(s, 'Test Kiln of Ages')).toBe(false);
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.1');
  });
});

describe('CR 305.1, 305.2, 305.2a: playing it is the land play of the turn', () => {
  it('it enters the battlefield under your control and counts as your land play (CR 305.1, 305.2a)', () => {
    let s = board({ graveyard: ['Forest', 'Mountain'] });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') });
    const forest = s.zones.battlefield.find((id) => nameOf(s, id) === 'Forest')!;
    expect(forest).toBeDefined();
    expect(s.objects[forest]!.controller).toBe('p1');
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toEqual(['Mountain']);
    expect(lands(s)).toBe(1);
    expect(s.zones.stack).toEqual([]); // a special action: never a spell (CR 305.1, 116.2a)
    // CR 305.2, 305.2b: no second land this turn, from the graveyard or the hand
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.2');
  });
  it('a land played from the hand first uses the land play (CR 305.2a)', () => {
    let s = board({ hand: ['Mountain'], graveyard: ['Forest'] });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'hand', 'p1') });
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.2');
  });
  it('after the graveyard land, the land in hand is refused (CR 305.2)', () => {
    let s = board({ hand: ['Mountain'], graveyard: ['Forest'] });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') });
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'hand', 'p1') }).error?.rules).toContain('CR 305.2');
  });
});

describe('CR 404.1: "your graveyard" is the graveyard of the permanent\'s controller', () => {
  it("an opponent's graveyard lands are not offered and can't be played", () => {
    const s = board({}, { graveyard: ['Forest'] });
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p2') }).error?.rules).toContain('CR 305.1');
  });
  it('the opponent gets no permission from your permanent on their own turn', () => {
    let s = board({ graveyard: ['Forest'] }, { graveyard: ['Mountain'] });
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(offPlays(s, 'p2')).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p2', card: find(s, 'Mountain', 'graveyard', 'p2') }).error?.rules).toContain('CR 305.1');
  });
});

describe('CR 305.9, 601.3: lands only, and nothing is cast', () => {
  it('a nonland card in the graveyard is not offered, neither as a land nor as a spell', () => {
    const s = board({ battlefield: ['Test Kiln of Ages', 'Forest', 'Forest'], graveyard: ['Grizzly Bears'] });
    const bears = find(s, 'Grizzly Bears', 'graveyard', 'p1');
    expect(legalActions(s, 'p1').filter((a) => a.object === bears)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: bears }).error).toBeDefined();
    expect(applyAction(s, { type: 'cast', player: 'p1', card: bears }).error).toBeDefined();
    expect(s.zones.graveyard.p1).toContain(bears);
  });
});

describe('CR 305.1, 305.3: only when you could play a land', () => {
  it('not outside a main phase (sorcery timing)', () => {
    let s = board({ graveyard: ['Forest'] });
    s = advanceTo(s, 1, 'beginCombat');
    expect(s.pending?.player).toBe('p1');
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.1');
  });
  it("not during the opponent's turn", () => {
    let s = board({ graveyard: ['Forest'] });
    s = advanceTo(s, 2, 'main1');
    while (s.pending?.player !== 'p1') s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.turn.activePlayer).toBe('p2');
    expect(offPlays(s)).toEqual([]);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') }).error).toBeDefined();
  });
});

describe('CR 712.12: a modal double-faced card with a land face, as from the hand', () => {
  it('only its land face is offered; it enters with that face up and uses the land play; its spell face is never cast from the graveyard', () => {
    let s = board({ graveyard: [MDFC] });
    const card = find(s, MDFC, 'graveyard', 'p1');
    const offered = legalActions(s, 'p1').filter((a) => a.object === card);
    expect(offered.map((a) => a.label)).toEqual(['Play Shatterskull, the Hammer Pass from graveyard']);
    expect(offered[0]!.action).toEqual({ type: 'playLand', player: 'p1', card, face: 1 });
    // the front face is a sorcery: not a land (CR 712.12) and never cast this way (CR 305.9, 601.3)
    expect(applyAction(s, { type: 'playLand', player: 'p1', card, face: 0 }).error?.rules).toContain('CR 712.12');
    expect(applyAction(s, { type: 'cast', player: 'p1', card }).error).toBeDefined();
    s = drive(act(s, offered[0]!.action), [{ kind: 'yesNo', yes: false }]);
    const land = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === MDFC)!;
    expect(land).toBeDefined();
    expect(s.objects[land]!.face).toBe(1);
    expect(lands(s)).toBe(1);
  });
});
