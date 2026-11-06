/**
 * Commander lane edh-c-7 (EDHREC ranks 18,751 to 19,375; code edhv7): the round's readings played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites checked against the Comprehensive Rules of 2026-09-25 where marked, else from memory.
 *
 *   CR 611.2a, 611.2c, 613.1f  "For as long as that creature has a hex counter on it, it has ...": a granted ability that lasts while the counter does (dur.lead.have)
 *   CR 603.7, 503.1            "<instruction> at the beginning of your next upkeep": a delayed trigger of the controller's next upkeep only (dl.yourNextUpkeep.tail)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, scenario, zoneNames, battlefieldNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit (a template's experimental status caps the level; that is not checked here). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Pass priority, answering targets, costs and yes/no, until the stack is empty and p1 has priority again. */
function settle(s0: GameState, targets: (ObjectId | ObjectId[])[] = []): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.length > 0 ? [queue.shift()!].flat().map((id) => ({ kind: 'object' as const, id })) : [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, targets: (ObjectId | ObjectId[])[] = []): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets);

describe('CR 611.2a, 613.1f: "Return target creature card from your graveyard to the battlefield with a hex counter on it. For as long as that creature has a hex counter on it, it has ..."', () => {
  const CALL = card('Test Grave Call', 'Sorcery', 'Return target creature card from your graveyard to the battlefield with a hex counter on it. For as long as that creature has a hex counter on it, it has "When this creature becomes the target of a spell or ability, sacrifice it."');
  const NUDGE = card('Test Nudge', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const HUSK = card('Test Husk', 'Creature — Zombie', 'Vigilance', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [CALL, NUDGE, HUSK, BEAR];
  const setup = (): { s: GameState; husk: ObjectId; bear: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test Grave Call', 'Test Nudge', 'Test Nudge'], graveyard: ['Test Husk'], battlefield: ['Test Plain Bear'] }, defs: DEFS });
    const husk = find(s, 'Test Husk', 'graveyard', 'p1');
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Grave Call', [husk]);
    return { s, husk: find(s, 'Test Husk', 'battlefield', 'p1'), bear };
  };
  it('is parsed and automated', () => expect(automated(CALL)).toBe(true));
  it('the creature returns with the counter; targeting it with a spell sacrifices it', () => {
    const { s: s0, husk } = setup();
    expect(s0.objects[husk]!.counters['hex']).toBe(1);
    const s1 = cast(s0, 'Test Nudge', [husk]);
    expect(battlefieldNames(s1, 'p1')).not.toContain('Test Husk');
    expect(zoneNames(s1, 'graveyard', 'p1')).toContain('Test Husk');
  });
  it('a creature that was not granted the ability, or one whose counter is gone, is not sacrificed when targeted (the grant ends with the counter)', () => {
    const { s: s0, husk, bear } = setup();
    const s1 = cast(s0, 'Test Nudge', [bear]);
    expect(battlefieldNames(s1, 'p1')).toContain('Test Plain Bear');
    s1.objects[husk]!.counters = {};
    const s2 = cast(s1, 'Test Nudge', [husk]);
    expect(battlefieldNames(s2, 'p1')).toContain('Test Husk');
  });
});

describe('CR 611.2a, 603.10a, 700.4: "Put a mark counter on target creature an opponent controls. For as long as that creature has a mark counter on it, it has \'When this creature dies, each opponent draws a card and gains 2 life.\'"', () => {
  const TOTEM = card('Test Mark Totem', 'Artifact', '{0}: Put a mark counter on target creature an opponent controls. For as long as that creature has a mark counter on it, it has "When this creature dies, each opponent draws a card and gains 2 life."');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const DEFS = [TOTEM, SMITE, OGRE];
  const setup = (): { s: GameState; totem: ObjectId; ogre: ObjectId; ogre2: ObjectId } => {
    const s = scenario([], { p1: { battlefield: ['Test Mark Totem'], hand: ['Test Smite', 'Test Smite'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] }, defs: DEFS });
    const [ogre, ogre2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Ogre');
    return { s, totem: find(s, 'Test Mark Totem', 'battlefield', 'p1'), ogre: ogre!, ogre2: ogre2! };
  };
  const mark = (s: GameState, totem: ObjectId, ogre: ObjectId): GameState => settle(act(s, { type: 'activate', player: 'p1', source: totem, ability: 'p:0:0' }), [ogre]);
  it('is parsed and automated', () => expect(automated(TOTEM)).toBe(true));
  it('the marked creature dies: each opponent of its controller (p1) draws a card and gains 2 life', () => {
    const { s: s0, totem, ogre } = setup();
    const s1 = mark(s0, totem, ogre);
    expect(s1.objects[ogre]!.counters['mark']).toBe(1);
    const hand = s1.zones.hand['p1']!.length;
    const s2 = cast(s1, 'Test Smite', [ogre]);
    expect(s2.zones.hand['p1']!.length).toBe(hand - 1 + 1); // the Smite left the hand, one card was drawn
    expect(life(s2, 'p1')).toBe(life(s1, 'p1') + 2);
    expect(life(s2, 'p2')).toBe(life(s1, 'p2'));
  });
  it('an unmarked creature, or one whose counter is gone, dies without the trigger', () => {
    const { s: s0, totem, ogre, ogre2 } = setup();
    let s1 = mark(s0, totem, ogre);
    const l = life(s1, 'p1');
    const s2 = cast(s1, 'Test Smite', [ogre2]);
    expect(life(s2, 'p1')).toBe(l);
    s1 = s2;
    s1.objects[ogre]!.counters = {};
    const s3 = cast(s1, 'Test Smite', [ogre]);
    expect(life(s3, 'p1')).toBe(l);
  });
});

describe('CR 603.7, 503.1: "Return each creature card from your graveyard to the battlefield. Exile those creatures at the beginning of your next upkeep."', () => {
  const RALLY = card('Test Brief Muster', 'Sorcery', 'Return each creature card from your graveyard to the battlefield. Exile those creatures at the beginning of your next upkeep.');
  const SPOOK = card('Test Spook', 'Creature — Spirit', '', ['1', '1']);
  it('is parsed and automated', () => expect(automated(RALLY)).toBe(true));
  it('the returned creatures stay through the opponent\'s upkeep and are exiled at the controller\'s next upkeep, once', () => {
    let s = scenario([], { p1: { hand: ['Test Brief Muster'], graveyard: ['Test Spook'] }, defs: [RALLY, SPOOK] });
    s = cast(s, 'Test Brief Muster');
    expect(battlefieldNames(s, 'p1')).toContain('Test Spook');
    s = advanceTo(s, 2, 'upkeep');
    expect(battlefieldNames(s, 'p1')).toContain('Test Spook');
    s = advanceTo(s, 3, 'upkeep');
    for (let guard = 0; guard < 10 && s.zones.stack.length > 0; guard++) s = pass(s);
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Spook');
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Spook')).toBe(true);
  });
  it('a returned creature that died before the upkeep is a new object (CR 400.7): it stays in the graveyard', () => {
    const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
    let s = scenario([], { p1: { hand: ['Test Brief Muster', 'Test Smite'], graveyard: ['Test Spook'] }, defs: [RALLY, SPOOK, SMITE] });
    s = cast(s, 'Test Brief Muster');
    s = cast(s, 'Test Smite', [find(s, 'Test Spook', 'battlefield', 'p1')]);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Spook');
    s = advanceTo(s, 3, 'upkeep');
    for (let guard = 0; guard < 10 && s.zones.stack.length > 0; guard++) s = pass(s);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Spook');
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Spook')).toBe(false);
  });
});

describe('CR 120.1, 602.5b: "Activate only if an opponent was dealt damage this turn." (history of damage to an opponent, combat or not)', () => {
  const IMP = card('Test Ember Imp', 'Creature — Imp', '{0}: Return ~ from your graveyard to your hand. Activate only if an opponent was dealt damage this turn.', ['1', '1']);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to each opponent.');
  const SELF = card('Test Backfire', 'Instant', 'Test Backfire deals 1 damage to you.');
  const DEFS = [IMP, ZAP, SELF];
  const canReturn = (s: GameState): boolean => !applyAction(s, { type: 'activate', player: 'p1', source: find(s, 'Test Ember Imp', 'graveyard', 'p1'), ability: 'p:0:0' }).error;
  it('is parsed and automated', () => expect(automated(IMP)).toBe(true));
  it('refused before any damage to an opponent; allowed after a spell dealt it; damage to yourself does not count', () => {
    const s0 = scenario([], { p1: { hand: ['Test Zap', 'Test Backfire'], graveyard: ['Test Ember Imp'] }, defs: DEFS });
    expect(canReturn(s0)).toBe(false);
    expect(canReturn(cast(s0, 'Test Backfire'))).toBe(false);
    const s1 = cast(s0, 'Test Zap');
    expect(life(s1, 'p2')).toBe(life(s0, 'p2') - 1);
    expect(canReturn(s1)).toBe(true);
    const s2 = settle(act(s1, { type: 'activate', player: 'p1', source: find(s1, 'Test Ember Imp', 'graveyard', 'p1'), ability: 'p:0:0' }));
    expect(zoneNames(s2, 'hand', 'p1')).toContain('Test Ember Imp');
  });
  it('the history is this turn\'s: on the next turn it is refused again', () => {
    const s0 = scenario([], { p1: { hand: ['Test Zap'], graveyard: ['Test Ember Imp'] }, defs: DEFS });
    const s1 = advanceTo(cast(s0, 'Test Zap'), 3, 'main1');
    expect(canReturn(s1)).toBe(false);
  });
});

describe('CR 120.1, 603.4: "When ~ enters, sacrifice it unless an opponent was dealt damage this turn." (the same condition in an effect; reads the turn\'s history when it resolves)', () => {
  const ELE = card('Test War Wisp', 'Creature — Elemental', 'When this creature enters, sacrifice it unless an opponent was dealt damage this turn.', ['2', '2']);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to each opponent.');
  it('is parsed and automated', () => expect(automated(ELE)).toBe(true));
  it('it stays after damage to an opponent this turn and is sacrificed without it', () => {
    const s0 = scenario([], { p1: { hand: ['Test War Wisp', 'Test Zap'] }, defs: [ELE, ZAP] });
    expect(battlefieldNames(cast(s0, 'Test War Wisp'), 'p1')).not.toContain('Test War Wisp');
    const s1 = cast(cast(s0, 'Test Zap'), 'Test War Wisp');
    expect(battlefieldNames(s1, 'p1')).toContain('Test War Wisp');
  });
});

describe('CR 120.1, 508.1d, 614.1: "This creature can\'t attack unless an opponent has been dealt damage this turn." (judged when attackers are declared)', () => {
  const GOB = card('Test Crazed Gob', 'Creature — Goblin', "This creature can't attack unless an opponent has been dealt damage this turn.", ['2', '2']);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to each opponent.');
  const BACKFIRE = card('Test Backfire', 'Instant', 'Test Backfire deals 1 damage to you.');
  const toAttack = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 50 && s.pending?.kind !== 'declareAttackers' && s.turn.number === 1; g++) s = pass(s); return s; };
  const attackResult = (s0: GameState): 'allowed' | 'refused' | 'no declaration' => {
    const s = toAttack(s0);
    if (s.pending?.kind !== 'declareAttackers') return 'no declaration';
    const gob = find(s, 'Test Crazed Gob', 'battlefield', 'p1');
    const r = applyAction(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: gob, defender: 'p2' }] } } as never);
    return r.error ? 'refused' : 'allowed';
  };
  const base = (): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Crazed Gob', since: 0 }], hand: ['Test Zap', 'Test Backfire'] }, defs: [GOB, ZAP, BACKFIRE] });
  it('is parsed and automated', () => expect(automated(GOB)).toBe(true));
  it('cannot attack before an opponent has been dealt damage; can after a spell dealt it; damage to yourself does not count', () => {
    expect(attackResult(base())).not.toBe('allowed');
    expect(attackResult(cast(base(), 'Test Backfire'))).not.toBe('allowed');
    expect(attackResult(cast(base(), 'Test Zap'))).toBe('allowed');
  });
});
