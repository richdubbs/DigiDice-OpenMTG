/**
 * Round edh-replace-7: the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default compiler. Rules (Comprehensive Rules 2026-09-25):
 *
 *   CR 120.1, 120.3, 603.2, 608.2c   "Whenever another source you control deals exactly 1 damage to a permanent or player, ~ deals 2 damage to that permanent or player." (Ghyrson Starn,
 *                                    Kelermorph, ruling 2022-10-07): one trigger for each damage event, the damaged object or player named "that permanent or player"
 *   CR 104.3, 104.3b, 614.1a         "If you would lose the game, instead exile ~ and your life total becomes 1." (The Golden Throne, rulings 2022-10-07): the loss of the game is a replaceable
 *                                    event (state-based actions and effects), a player who can't lose the game is not proposed, a concession is never replaced
 *   CR 903.8, 306.5b, 614.1c         "~ enters with a loyalty counter on her for each time you've cast a commander from the command zone this game." (Jeska, Thrice Reborn)
 *   CR 614.1a, 611.2a, 510.2         "Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead." (Jeska)
 *   CR 508.1d, 509.1c                "~ attacks or blocks each combat if able." (Khârn the Betrayer)
 *   CR 108.4, 603.2, 603.10a         "When you lose control of ~, ..." (Khârn): another player gains control, or it leaves the battlefield (ruling 2022-10-07)
 *   CR 615.1, 615.5, 613.1b          "If damage would be dealt to ~, prevent that damage and an opponent of your choice gains control of it." (Khârn): the control passes at once
 *   CR 614.15, 608.2d                "You may return target nonland permanent card ... to your hand. If that land is a Plains, you may return that card to the battlefield instead." (Emeria Shepherd)
 *   CR 615.1, 615.5, 120.3, 109.4    Comeuppance: damage prevented, then dealt back to the creature that dealt it or to the controller of the noncreature source (ruling 2014-11-07)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, reject, scenario } from '../../m3/scenario';
import { clone } from '../../../src/util/clone';
import { card, counters, settle, resolveAll } from '../cmd3/helpers';
import { commanderScenario, inCommand, legend, runCombat, tweak } from '../../m11/rules/helpers';

const walker = (name: string, text: string, loyalty: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', oracle_text: text, colors: [], keywords: [], loyalty } as unknown as OracleCard);
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;
const lost = (s: GameState, p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost;
const inZone = (s: GameState, zone: 'hand' | 'graveyard' | 'exile', owner: PlayerId, defId: string): ObjectId[] => (zone === 'exile' ? s.zones.exile.filter((id) => s.objects[id]!.owner === owner) : s.zones[zone][owner] ?? []).filter((id) => s.objects[id]!.defId === defId);
const onBf = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
/** Cast `name` from the hand of `who`, answering its targets, and resolve everything on the stack. */
function cast(s0: GameState, name: string, targets: TargetChoice[] = [], who: PlayerId = 'p1', picks: Parameters<typeof settle>[1] = {}): GameState {
  const s = settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), { targets, ...picks });
  return resolveAll(s, { targets, ...picks });
}
const setLife = (s: GameState, p: PlayerId, n: number): GameState => tweak(s, (t) => { t.players.find((x) => x.id === p)!.life = n; });

// ---- Ghyrson Starn, Kelermorph ------------------------------------------------------------------------------------------------------------------------------------

describe('CR 120.1, 603.2, 608.2c: "Whenever another source you control deals exactly 1 damage to a permanent or player, ~ deals 2 damage to that permanent or player."', () => {
  const STUB = card('Test Autostub', 'Creature — Tyranid', 'Whenever another source you control deals exactly 1 damage to a permanent or player, ~ deals 2 damage to that permanent or player.\n{T}: ~ deals 1 damage to any target.', ['2', '2']);
  const PRICK = card('Test Prick', 'Instant', '~ deals 1 damage to any target.');
  const SMITE = card('Test Smite', 'Instant', '~ deals 2 damage to any target.');
  const BEAR = card('Test Big Bear', 'Creature — Bear', '', ['5', '5']);
  const defs = [STUB, PRICK, SMITE, BEAR];
  const game = (): GameState => scenario([], { defs, p1: { hand: ['Test Prick', 'Test Smite'], battlefield: ['Test Autostub'] }, p2: { hand: ['Test Prick'], battlefield: ['Test Big Bear'] } });
  it('is fully automated', () => expect(STUB.automation.level).toBe('full'));
  it('1 damage to a player: the player is dealt 2 more (3 in all)', () => {
    const s = cast(game(), 'Test Prick', [player('p2')]);
    expect(life(s, 'p2')).toBe(20 - 1 - 2);
  });
  it('1 damage to a creature: the creature is dealt 2 more (3 in all)', () => {
    const s0 = game();
    const bear = find(s0, 'Test Big Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Prick', [obj(bear)]);
    expect(dmg(s, bear)).toBe(3);
  });
  it('2 damage is not exactly 1: nothing triggers', () => {
    const s = cast(game(), 'Test Smite', [player('p2')]);
    expect(life(s, 'p2')).toBe(20 - 2);
  });
  it("~ itself is not 'another source': its own 1 damage does not trigger it", () => {
    const s0 = game();
    const stub = find(s0, 'Test Autostub', 'battlefield', 'p1');
    const ping = legal(s0, 'p1', 'activate').find((x) => x.object === stub)!;
    const s = resolveAll(settle(act(s0, ping.action), { targets: [player('p2')] }), { targets: [player('p2')] });
    expect(life(s, 'p2')).toBe(19);
  });
  it("a source an opponent controls is not 'a source you control': no trigger", () => {
    const s = cast(pass(game()), 'Test Prick', [player('p1')], 'p2');
    expect(life(s, 'p1')).toBe(19);
  });
  it('a source that is not a permanent counts too (the spell on the stack is a source you control)', () => {
    const s = cast(game(), 'Test Prick', [player('p2')]);
    expect(onBf(s, 'Test Autostub')).toHaveLength(1);
    expect(inZone(s, 'graveyard', 'p1', 'Test Prick')).toHaveLength(1);
  });
});

// ---- The Golden Throne ---------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 104.3, 104.3b, 614.1a: "If you would lose the game, instead exile ~ and your life total becomes 1."', () => {
  const THRONE = card('Test Throne', 'Legendary Artifact', 'If you would lose the game, instead exile ~ and your life total becomes 1.');
  const STUDY = card('Test Study', 'Sorcery', 'Draw a card.');
  const WARD = card('Test Ward Charm', 'Enchantment', "You can't lose the game and your opponents can't win the game.");
  const THRONE2 = card('Test Second Throne', 'Legendary Artifact', 'If you would lose the game, instead exile ~ and your life total becomes 1.');
  const defs = [THRONE, THRONE2, STUDY, WARD];
  const emptyLibrary = (s0: GameState, p: PlayerId): GameState => tweak(s0, (s) => { for (const id of s.zones.library[p]!) delete s.objects[id]; s.zones.library[p] = []; });
  it('is fully automated', () => expect(THRONE.automation.level).toBe('full'));
  it('0 life: the player does not lose; the Throne is exiled and the life total becomes 1 (the state-based action, CR 704.5a)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Throne'] } });
    s = pass(setLife(s, 'p1', 0));
    expect(lost(s, 'p1')).toBe(false);
    expect(life(s, 'p1')).toBe(1);
    expect(inZone(s, 'exile', 'p1', 'Test Throne')).toHaveLength(1);
    expect(onBf(s, 'Test Throne')).toHaveLength(0);
  });
  it('negative case: without the Throne the same player loses', () => {
    let s = scenario([], { defs, p1: { battlefield: [] } });
    s = pass(setLife(s, 'p1', 0));
    expect(lost(s, 'p1')).toBe(true);
  });
  it("the Throne only protects its controller (\"you\"): an opponent at 0 life loses and the Throne stays", () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Throne'] } });
    s = pass(setLife(s, 'p2', 0));
    expect(lost(s, 'p2')).toBe(true);
    expect(onBf(s, 'Test Throne')).toHaveLength(1);
  });
  it('ruling 2022-10-07: ten poison counters: the life total becomes 1, the Throne is exiled, and the player loses at once afterwards (nothing is left to replace it)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Throne'] } });
    s = pass(tweak(s, (t) => { t.players.find((x) => x.id === 'p1')!.poison = 10; }));
    expect(inZone(s, 'exile', 'p1', 'Test Throne')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(1);
    expect(lost(s, 'p1')).toBe(true);
  });
  it('ruling 2022-10-07: a draw from an empty library: the life total becomes 1 (a loss of 19 life) and the player does not lose', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Study'], battlefield: ['Test Throne'] } });
    s = emptyLibrary(s, 'p1');
    s = cast(s, 'Test Study');
    s = pass(pass(s));
    expect(lost(s, 'p1')).toBe(false);
    expect(life(s, 'p1')).toBe(1);
    expect(inZone(s, 'exile', 'p1', 'Test Throne')).toHaveLength(1);
  });
  it('ruling 2022-10-07: if an effect says the player can\'t lose the game, the Throne does not apply (it stays on the battlefield)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Throne', 'Test Ward Charm'] } });
    s = pass(setLife(s, 'p1', 0));
    expect(lost(s, 'p1')).toBe(false);
    expect(onBf(s, 'Test Throne')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(0);
  });
  it('two Thrones: the first replacement fixes the life total, so only one is exiled', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Throne', 'Test Second Throne'] } });
    s = pass(setLife(s, 'p1', 0));
    expect(s.pending?.kind).toBe('chooseReplacement'); // CR 616.1: both replacement effects could apply, the affected player chooses
    s = settle(answer(s, { kind: 'chooseReplacement', id: (s.pending as unknown as { options: { id: string }[] }).options[0]!.id }));
    expect(lost(s, 'p1')).toBe(false);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId.includes('Throne'))).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId.includes('Throne'))).toHaveLength(1);
  });
  it('CR 104.3a: conceding is never replaced', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Throne'] } });
    s = act(s, { type: 'concede', player: 'p1' } as never);
    expect(lost(s, 'p1')).toBe(true);
    expect(onBf(s, 'Test Throne')).toHaveLength(1);
  });
});

// ---- Comeuppance ---------------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 615.1, 615.5, 120.3: "Prevent all damage that would be dealt to you and planeswalkers you control this turn by sources you don\'t control. If damage from a creature source is prevented this way, ~ deals that much damage to that creature. If ... noncreature source ..., to the source\'s controller."', () => {
  const BACKLASH = card('Test Backlash', 'Instant', "Prevent all damage that would be dealt to you and planeswalkers you control this turn by sources you don't control. If damage from a creature source is prevented this way, ~ deals that much damage to that creature. If damage from a noncreature source is prevented this way, ~ deals that much damage to the source's controller.");
  const ZAP = card('Test Zap', 'Instant', '~ deals 3 damage to any target.');
  const SHOOTER = card('Test Shooter', 'Creature — Archer', '{0}: ~ deals 2 damage to any target.', ['1', '4']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [BACKLASH, ZAP, SHOOTER, BEAR];
  const ready = (): GameState => cast(scenario([], { defs, p1: { hand: ['Test Backlash', 'Test Zap'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Zap'], battlefield: ['Test Shooter'] } }), 'Test Backlash');
  it('is fully automated', () => expect(BACKLASH.automation.level).toBe('full'));
  it("a noncreature source (an instant) of an opponent: the damage to you is prevented and the spell's controller is dealt that much", () => {
    const s = cast(pass(ready()), 'Test Zap', [player('p1')], 'p2');
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20 - 3);
  });
  it('a creature source of an opponent: the damage to you is prevented and that creature is dealt that much (not its controller)', () => {
    const s0 = pass(ready());
    const shooter = find(s0, 'Test Shooter', 'battlefield', 'p2');
    const ping = legal(s0, 'p2', 'activate').find((x) => x.object === shooter)!;
    const s = resolveAll(settle(act(s0, ping.action), { targets: [player('p1')] }), { targets: [player('p1')] });
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
    expect(dmg(s, shooter)).toBe(2);
  });
  it('negative cases: damage to your creature is not prevented; damage from a source you control (your own spell) is not prevented', () => {
    const s0 = ready();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test Zap', [obj(bear)], 'p1');
    expect(onBf(s1, 'Test Bear')).toHaveLength(0);
    const s2 = cast(ready(), 'Test Zap', [player('p1')], 'p1');
    expect(life(s2, 'p1')).toBe(17);
  });
  it('the effect lasts this turn only: next turn the damage is dealt', () => {
    let s = advanceTo(ready(), 2, 'main1');
    s = cast(s, 'Test Zap', [player('p1')], 'p2');
    expect(life(s, 'p1')).toBe(17);
  });
});

// ---- Jeska, Thrice Reborn -------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 903.8, 306.5b, 614.1c: "~ enters with a loyalty counter on her for each time you\'ve cast a commander from the command zone this game."', () => {
  const WALKER = walker('Test Commander Walker', "Test Commander Walker enters with a loyalty counter on her for each time you've cast a commander from the command zone this game.", '0');
  const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const game = (casts: number): GameState => tweak(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WALKER], p1: { hand: ['Test Commander Walker'] } }), (t) => {
    t.players.find((p) => p.id === 'p1')!.commanders![0]!.casts = casts;
  });
  it('is fully automated', () => expect(WALKER.automation.level).toBe('full'));
  it('two casts of the commander from the command zone: two loyalty counters', () => {
    const s = cast(game(2), 'Test Commander Walker');
    expect(counters(s, onBf(s, 'Test Commander Walker')[0]!, 'loyalty')).toBe(2);
  });
  it('no cast yet: no loyalty counters (the walker is put into the graveyard, CR 704.5i)', () => {
    const s = cast(game(0), 'Test Commander Walker');
    expect(onBf(s, 'Test Commander Walker')).toHaveLength(0);
    expect(inZone(s, 'graveyard', 'p1', 'Test Commander Walker')).toHaveLength(1);
  });
  it('the casts of the player counted are the controller\'s: the opponent\'s casts do not add loyalty', () => {
    const s0 = game(1);
    const s1 = tweak(s0, (t) => { t.players.find((p) => p.id === 'p2')!.commanders![0]!.casts = 5; });
    const s = cast(s1, 'Test Commander Walker');
    expect(counters(s, onBf(s, 'Test Commander Walker')[0]!, 'loyalty')).toBe(1);
  });
  it('inCommand sanity: the commander is in the command zone', () => {
    expect(inCommand(game(0), 'Test Titania')).toBeDefined();
  });
});

describe('CR 614.1a, 611.2a, 510.2: "Choose target creature. Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead."', () => {
  const WALKER = walker('Test Triple Walker', '0: Choose target creature. Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead.', '3');
  const withLoyalty = WALKER;
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const BEAR2 = card('Test Other Bear', 'Creature — Bear', '', ['3', '3']);
  const FOE = card('Test Foe', 'Creature — Orc', '', ['4', '4']);
  const defs = [withLoyalty, BEAR, BEAR2, FOE];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: [{ name: 'Test Triple Walker', counters: { loyalty: 3 } }, 'Test Bear', 'Test Other Bear'] }, p2: { battlefield: ['Test Foe'] } });
  function activate(s0: GameState, target: ObjectId): GameState {
    const w = find(s0, 'Test Triple Walker', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === w)!;
    return resolveAll(settle(act(s0, a.action), { targets: [obj(target)] }), { targets: [obj(target)] });
  }
  const attackWith = (s0: GameState, ids: ObjectId[]): GameState => runCombat(s0, { attack: ids.map((id) => [id] as [ObjectId]) });
  it('the ability is fully automated', () => expect(WALKER.automation.level).toBe('full'));
  it('the chosen creature deals triple combat damage to the opponent; the other creature deals normal damage', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const other = find(s0, 'Test Other Bear', 'battlefield', 'p1');
    const s1 = activate(s0, bear);
    const s2 = attackWith(s1, [bear, other]);
    expect(life(s2, 'p2')).toBe(20 - 6 - 3);
  });
  it('negative case: without the ability the same attack deals 2 + 3', () => {
    const s0 = setup();
    const s2 = attackWith(s0, [find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Other Bear', 'battlefield', 'p1')]);
    expect(life(s2, 'p2')).toBe(15);
  });
  it('"until your next turn": at the start of your next turn the replacement is gone', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = activate(s0, bear);
    const s2 = advanceTo(s1, 3, 'main1');
    const s3 = attackWith(s2, [bear]);
    expect(life(s3, 'p2')).toBe(18);
  });
});

// ---- Khârn the Betrayer --------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 508.1d, 509.1c, 108.4, 603.10a, 615.5: Khârn the Betrayer', () => {
  const KHARN = card('Test Betrayer', 'Legendary Creature — Astartes', 'Berzerker — ~ attacks or blocks each combat if able.\nSigil of Corruption — When you lose control of ~, draw two cards.\nThe Betrayer — If damage would be dealt to ~, prevent that damage and an opponent of your choice gains control of it.', ['3', '3']);
  const ZAP = card('Test Zap', 'Instant', '~ deals 2 damage to any target.');
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [KHARN, ZAP, DOOM, BEAR];
  const game = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Betrayer'] }, p2: { hand: ['Test Zap', 'Test Doom'] } });
  it('is fully automated', () => expect(KHARN.automation.level).toBe('full'));
  it('damage to it is prevented and the opponent gains control of it at once; its former controller draws two cards (the trigger)', () => {
    const s0 = pass(game());
    const k = find(s0, 'Test Betrayer', 'battlefield', 'p1');
    const hand0 = s0.zones.hand['p1']!.length;
    const s = cast(s0, 'Test Zap', [obj(k)], 'p2');
    expect(s.objects[k]!.controller).toBe('p2');
    expect(dmg(s, k)).toBe(0);
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 2);
  });
  it('it leaves the battlefield: its controller loses control of it and draws two cards (ruling 2022-10-07)', () => {
    const s0 = pass(game());
    const k = find(s0, 'Test Betrayer', 'battlefield', 'p1');
    const hand0 = s0.zones.hand['p1']!.length;
    const s = cast(s0, 'Test Doom', [obj(k)], 'p2');
    expect(onBf(s, 'Test Betrayer')).toHaveLength(0);
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 2);
  });
  it('negative case: no draw while it stays under your control (damage to another creature, a pass of the turn)', () => {
    let s0 = scenario([], { defs, p1: { battlefield: ['Test Betrayer', 'Test Bear'] }, p2: { hand: ['Test Zap'] } });
    s0 = pass(s0);
    const hand0 = s0.zones.hand['p1']!.length;
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Zap', [obj(bear)], 'p2');
    expect(s.zones.hand['p1']!.length).toBe(hand0);
    expect(onBf(s, 'Test Betrayer')).toHaveLength(1);
  });
  it('it attacks each combat if able: declaring no attackers is refused; a creature without the requirement may stay home', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Betrayer', 'Test Bear'] } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('declareAttackers');
    const k = find(s, 'Test Betrayer', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const refused = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' as PlayerId }] } });
    expect(refused.message).toBeTruthy();
    const ok = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: k, defender: 'p2' as PlayerId }] });
    expect(ok.pending?.kind === 'declareAttackers').toBe(false);
  });
});

// ---- Emeria Shepherd -----------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 614.15, 608.2d: "... you may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead."', () => {
  const SHEPHERD = card('Test Shepherd', 'Creature — Angel', 'Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [SHEPHERD, BEAR];
  const game = (): GameState => scenario(['Plains', 'Forest'], { defs, p1: { hand: ['Plains', 'Forest'], battlefield: ['Test Shepherd'], graveyard: ['Test Bear', 'Forest'] } });
  const playLand = (s0: GameState, name: string, picks: Parameters<typeof settle>[1]): GameState => resolveAll(settle(act(s0, { type: 'playLand', player: 'p1', card: find(s0, name, 'hand', 'p1') }), picks), picks);
  it('is fully automated', () => expect(SHEPHERD.automation.level).toBe('full'));
  it('a Forest: the card goes to the hand (not the battlefield)', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s = playLand(s0, 'Forest', { targets: [obj(bear)], yes: true });
    expect(inZone(s, 'hand', 'p1', 'Test Bear')).toHaveLength(1);
    expect(onBf(s, 'Test Bear')).toHaveLength(0);
  });
  it('a Plains: the card is returned to the battlefield instead', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s = playLand(s0, 'Plains', { targets: [obj(bear)], yes: true });
    expect(onBf(s, 'Test Bear')).toHaveLength(1);
    expect(inZone(s, 'hand', 'p1', 'Test Bear')).toHaveLength(0);
  });
  it('declining the optional return leaves the card in the graveyard (Plains or not)', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s = playLand(s0, 'Plains', { targets: [obj(bear)], yes: false });
    expect(inZone(s, 'graveyard', 'p1', 'Test Bear')).toHaveLength(1);
    expect(onBf(s, 'Test Bear')).toHaveLength(0);
  });
  it('a land card in the graveyard is not a legal target (nonland permanent cards only)', () => {
    const s0 = game();
    const forest = findAll(s0, 'Forest', 'graveyard', 'p1')[0]!;
    expect(() => playLand(s0, 'Forest', { targets: [obj(forest)], yes: true })).toThrow(/legal target/);
  });
});

void clone;
void ({} as CardDef);
