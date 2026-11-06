/**
 * Commander lane edh-c, round edh-c-51 (EDHREC ranks 23,501 to 24,000): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 611.2a, 613.4c       "Until your next turn, up to one target creature gets -5/-0." (Mu Yanling: lasts through the opponent's turn, ends when Alice's next turn begins)
 *   CR 701.9a, 700.4        "target opponent discards a card for each Zubera that died this turn" (Ashen-Skin Zubera: every Zubera that died, any controller)
 *   CR 120.1, 119.3         "Target player loses life equal to the damage already dealt to that player this turn." (Final Punishment: damage to that player only)
 *   CR 701.20a, 701.9a      "Choose a color. Target player reveals their hand and discards all cards of that color." (Persecute)
 *   CR 205.3m, 701.19c      "Choose a creature type. ... discards all creature cards of that type. Then destroy all creatures of that type that player controls. They can't be regenerated." (Tsabo's Decree)
 *   CR 509.1h, 701.8a       "When this creature blocks a creature, destroy both creatures." (Alaborn Zealot)
 *   CR 608.2h, 701.6a       "Counter target blue spell. If it was a Jace planeswalker spell, scry 2." (Jace's Defeat)
 *   CR 502.3, 611.2a        "During that player's next untap step, creatures they control don't untap." (Imaginary Threats)
 *   CR 115.1, 611.2a        "Permanents you control can't be the targets of blue or black spells your opponents control this turn." (Display of Dominance)
 *   CR 609.7a, 615.1        "Prevent all damage a red source of your choice would deal this turn." (Burrenton Forge-Tender)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { declareBlockers, declareAttackers, toDeclareAttackers, toDeclareBlockers, passUntil } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id });
const yard = (s: GameState, p: string): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);
const hand = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const field = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId);

/** Pass priority until a decision other than priority is asked (the spell on the stack resolves and asks for its choice). */
const untilAsked = (s0: GameState): GameState => { let s = s0; for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = pass(s); return s; };

/** A synthetic card with colors (the shared helper builds colorless ones). */
const colored = (name: string, type: string, text: string, colors: string[], ptv?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(ptv ? { power: ptv[0], toughness: ptv[1] } : {}) } as OracleCard);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{1}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target player.');
const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');

describe('CR 611.2a, 613.4c: "Until your next turn, up to one target creature gets -5/-0."', () => {
  const WEAVE = card('Test Weave', 'Sorcery', 'Until your next turn, up to one target creature gets -5/-0.');
  const DEFS: CardDef[] = [WEAVE, OGRE];
  it('is automated', () => expect(full(WEAVE)).toBe(true));
  it('the target gets -5/-0 through the opponent\'s turn and the effect ends as Alice\'s next turn begins; no target is allowed', () => {
    let s = scenario([], { p1: { hand: ['Test Weave'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Weave', { targets: [obj(ogre)] }));
    expect(pt(s, ogre)).toBe('-2/3');
    s = advanceTo(s, 4, 'main1');
    expect(pt(s, ogre)).toBe('-2/3');
    s = advanceTo(s, 5, 'upkeep');
    expect(pt(s, ogre)).toBe('3/3');
  });
  it('negative: without the spell the creature keeps its size; "up to one" lets Alice choose no target', () => {
    let s = scenario([], { p1: { hand: ['Test Weave'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Weave', { targets: [] }));
    expect(pt(s, ogre)).toBe('3/3');
  });
});

describe('CR 701.9a, 700.4: "target opponent discards a card for each Zubera that died this turn"', () => {
  const ZUB = card('Test Zubera', 'Creature — Spirit Zubera', 'When this creature dies, target opponent discards a card for each Zubera that died this turn.', ['1', '1']);
  const DEFS: CardDef[] = [ZUB, WRATH, BEAR];
  it('is automated', () => expect(full(ZUB)).toBe(true));
  it('two Zubera dying together: the first trigger to resolve counts both, the second counts both again', () => {
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Zubera', 'Test Zubera'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const before = hand(s, 'p2').length;
    s = cast(s, 'Test Wrath');
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { targets: [plr('p2')] });
    expect(yard(s, 'p2')).toHaveLength(4);
    expect(hand(s, 'p2')).toHaveLength(before - 4);
  });
  it('negative: a creature that is not a Zubera does not count', () => {
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Zubera', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Wrath');
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { targets: [plr('p2')] });
    expect(yard(s, 'p2')).toHaveLength(1);
  });
});

describe('CR 120.1, 119.3: "Target player loses life equal to the damage already dealt to that player this turn."', () => {
  const PUNISH = card('Test Punishment', 'Sorcery', 'Target player loses life equal to the damage already dealt to that player this turn.');
  const DEFS: CardDef[] = [PUNISH, BOLT, BEAR];
  it('is automated', () => expect(full(PUNISH)).toBe(true));
  it('the player loses as much life as the damage they were dealt this turn (3), in addition to that damage', () => {
    let s = scenario([], { p1: { hand: ['Test Bolt', 'Test Punishment'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Bolt', { targets: [plr('p2')] }));
    expect(life(s, 'p2')).toBe(17);
    s = resolveAll(cast(s, 'Test Punishment', { targets: [plr('p2')] }));
    expect(life(s, 'p2')).toBe(14);
  });
  it('negative: no damage dealt, no life lost; damage to a creature or to the other player does not count', () => {
    let s = scenario([], { p1: { hand: ['Test Bolt', 'Test Punishment'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Bolt', { targets: [plr('p1')] }));
    s = resolveAll(cast(s, 'Test Punishment', { targets: [plr('p2')] }));
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 701.20a, 701.9a, 608.2c: "Choose a color. Target player reveals their hand and discards all cards of that color." (and Tsabo\'s Decree)', () => {
  const PERSECUTE = card('Test Persecution', 'Sorcery', 'Choose a color. Target player reveals their hand and discards all cards of that color.');
  const DECREE = card('Test Decree', 'Sorcery', 'Choose a creature type. Target player reveals their hand and discards all creature cards of that type. Then destroy all creatures of that type that player controls. They can\'t be regenerated.');
  const RED = colored('Test Red Bear', 'Creature — Bear', '', ['R'], ['2', '2'], '{R}');
  const RED2 = colored('Test Red Spell', 'Instant', 'Draw a card.', ['R'], undefined, '{1}{R}');
  const BLUE = colored('Test Blue Bear', 'Creature — Bear', '', ['U'], ['2', '2'], '{U}');
  const GREEN_WOLF = colored('Test Green Wolf', 'Creature — Wolf', '', ['G'], ['2', '2'], '{G}');
  const DEFS: CardDef[] = [PERSECUTE, DECREE, RED, RED2, BLUE, GREEN_WOLF, BEAR, OGRE];
  it('are automated', () => { expect(full(PERSECUTE)).toBe(true); expect(full(DECREE)).toBe(true); });
  it('Persecution: only the cards of the chosen color are discarded, the others stay in the hand', () => {
    let s = scenario([], { p1: { hand: ['Test Persecution'] }, p2: { hand: ['Test Red Bear', 'Test Red Spell', 'Test Blue Bear', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = untilAsked(cast(s, 'Test Persecution', { targets: [plr('p2')] }));
    expect(s.pending?.kind).toBe('chooseColor');
    s = resolveAll(answer(s, { kind: 'chooseColor', color: 'R' }));
    expect(yard(s, 'p2').sort()).toEqual(['Test Red Bear', 'Test Red Spell']);
    expect(hand(s, 'p2').filter((n) => n !== 'Plains').sort()).toEqual(['Test Bear', 'Test Blue Bear']);
  });
  it('Decree: creature cards of the type are discarded, other cards stay; the creatures of the type the target player controls are destroyed (and can\'t be regenerated), the caster\'s own stay', () => {
    let s = scenario([], { p1: { hand: ['Test Decree'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Bear', 'Test Red Spell', 'Test Green Wolf'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = untilAsked(cast(s, 'Test Decree', { targets: [plr('p2')] }));
    expect(s.pending?.kind).toBe('chooseName');
    s = resolveAll(answer(s, { kind: 'chooseName', name: 'Bear' }));
    expect(yard(s, 'p2').sort()).toEqual(['Test Bear', 'Test Bear']);
    expect(hand(s, 'p2').filter((n) => n !== 'Plains').sort()).toEqual(['Test Green Wolf', 'Test Red Spell']);
    expect(field(s, 'p2')).toEqual(['Test Ogre']);
    expect(field(s, 'p1')).toEqual(['Test Bear']);
  });
});

describe('CR 509.1h, 701.8a: "When this creature blocks a creature, destroy both creatures."', () => {
  const ZEAL = card('Test Zealot', 'Creature — Human Soldier', 'When this creature blocks a creature, destroy both creatures.', ['1', '1']);
  const DEFS: CardDef[] = [ZEAL, OGRE, BEAR];
  it('is automated', () => expect(full(ZEAL)).toBe(true));
  it('the blocker and the attacker it blocks both die, a creature that was not blocked is untouched', () => {
    let s = scenario([], { p1: { battlefield: ['Test Zealot', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 4, 'main1');
    const [ogreA, ogreB] = findAll(s, 'Test Ogre', 'battlefield', 'p2') as [ObjectId, ObjectId];
    const zealot = find(s, 'Test Zealot', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[ogreA], [ogreB]]);
    s = declareBlockers(toDeclareBlockers(s), [[zealot, ogreA]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'combatDamage', 'combat');
    expect(s.zones.battlefield).not.toContain(zealot);
    expect(s.zones.battlefield).not.toContain(ogreA);
    expect(s.zones.battlefield).toContain(ogreB);
  });
  it('negative: a Zealot that does not block (the opponent has no attacker) destroys nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Zealot'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 4, 'main1');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Ogre', 'battlefield', 'p2')]]);
    s = declareBlockers(toDeclareBlockers(s), []);
    expect(s.zones.battlefield).toContain(find(s, 'Test Zealot', 'battlefield', 'p1'));
  });
});

describe('CR 608.2h, 701.6a: "Counter target blue spell. If it was a Jace planeswalker spell, scry 2."', () => {
  const DEFEAT = card('Test Defeat', 'Instant', 'Counter target blue spell. If it was a Jace planeswalker spell, scry 2.');
  const JACE = colored('Test Jace', 'Legendary Planeswalker — Jace', '', ['U'], undefined);
  const BLUE_SPELL = colored('Test Blue Wisp', 'Sorcery', 'Draw a card.', ['U']);
  const DEFS: CardDef[] = [DEFEAT, JACE, BLUE_SPELL];
  it('is automated', () => expect(full(DEFEAT)).toBe(true));
  it('the Jace planeswalker spell is countered and Alice scries 2', () => {
    let s = scenario([], { p1: { hand: ['Test Defeat', 'Test Jace'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Jace');
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    const before = s.log.length;
    s = resolveAll(cast(s, 'Test Defeat', { targets: [obj(spell)] }));
    expect(yard(s, 'p1')).toContain('Test Jace');
    expect(s.log.slice(before).some((l) => /scr/i.test(l.text))).toBe(true);
  });
  it('negative: a blue spell that is not a Jace planeswalker spell is countered without a scry', () => {
    let s = scenario([], { p1: { hand: ['Test Defeat', 'Test Blue Wisp'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Blue Wisp');
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    const before = s.log.length;
    s = resolveAll(cast(s, 'Test Defeat', { targets: [obj(spell)] }));
    expect(yard(s, 'p1')).toContain('Test Blue Wisp');
    expect(s.log.slice(before).some((l) => /scr/i.test(l.text))).toBe(false);
  });
});

describe('CR 502.3, 611.2a: "During that player\'s next untap step, creatures they control don\'t untap." (with "Creatures target opponent controls attack this turn if able.")', () => {
  const THREAT = card('Test Threat', 'Sorcery', 'Creatures target opponent controls attack this turn if able. During that player\'s next untap step, creatures they control don\'t untap.');
  const DEFS: CardDef[] = [THREAT, OGRE, BEAR];
  it('is automated', () => expect(full(THREAT)).toBe(true));
  it('the opponent\'s tapped creatures stay tapped through their next untap step only, and their lands untap; the caster\'s creatures untap as usual', () => {
    let s = scenario([], { p1: { hand: ['Test Threat'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Plains'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const plains = find(s, 'Plains', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    for (const id of [ogre, plains, bear]) s.objects[id]!.tapped = true;
    s = resolveAll(cast(s, 'Test Threat', { targets: [plr('p2')] }));
    s = advanceTo(s, 4, 'upkeep');
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(s.objects[plains]!.tapped).toBe(false);
    s = advanceTo(s, 5, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(false); // its own controller's untap step is not restricted
    s.objects[ogre]!.tapped = true;
    s = advanceTo(s, 6, 'upkeep');
    expect(s.objects[ogre]!.tapped).toBe(false); // the restriction was for that one untap step only
  });
  it('negative: without the spell the creature untaps in its controller\'s untap step', () => {
    let s = scenario([], { p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s.objects[ogre]!.tapped = true;
    s = advanceTo(s, 4, 'upkeep');
    expect(s.objects[ogre]!.tapped).toBe(false);
  });
});

describe('CR 115.1, 611.2a: "Permanents you control can\'t be the targets of blue or black spells your opponents control this turn."', () => {
  const DISPLAY = card('Test Display', 'Instant', 'Permanents you control can\'t be the targets of blue or black spells your opponents control this turn.');
  const ZAP_U = colored('Test Blue Zap', 'Instant', 'Test Blue Zap deals 1 damage to target creature.', ['U']);
  const ZAP_R = colored('Test Red Zap', 'Instant', 'Test Red Zap deals 1 damage to target creature.', ['R']);
  const DEFS: CardDef[] = [DISPLAY, ZAP_U, ZAP_R, BEAR];
  const targetable = (s: GameState, spell: string, victim: ObjectId): boolean => {
    try {
      const t = act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2') });
      const d = t.pending as { kind: string } | null;
      if (d?.kind !== 'chooseTargets') return false;
      answer(t, { kind: 'chooseTargets', targets: [obj(victim)] });
      return true;
    } catch { return false; }
  };
  it('is automated', () => expect(full(DISPLAY)).toBe(true));
  it('the opponent\'s blue spell can\'t target Alice\'s permanent, a red spell can, and the opponent\'s own permanent is a legal target of the blue spell', () => {
    let s = scenario([], { p1: { hand: ['Test Display'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Blue Zap', 'Test Red Zap'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Display'));
    s = pass(s);
    expect(s.pending?.player).toBe('p2');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(targetable(s, 'Test Blue Zap', mine)).toBe(false);
    expect(targetable(s, 'Test Red Zap', mine)).toBe(true);
    expect(targetable(s, 'Test Blue Zap', theirs)).toBe(true);
  });
  it('negative: without the spell the blue spell targets Alice\'s permanent', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { hand: ['Test Blue Zap'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = pass(s);
    expect(targetable(s, 'Test Blue Zap', find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(true);
  });
});

describe('CR 609.7a, 615.1: "Prevent all damage a red source of your choice would deal this turn."', () => {
  const TENDER = card('Test Tender', 'Creature — Human Cleric', 'Sacrifice this creature: Prevent all damage a red source of your choice would deal this turn.', ['1', '1']);
  const SHOCK = colored('Test Red Shock', 'Instant', 'Test Red Shock deals 3 damage to target player.', ['R']);
  const BLUE_SHOCK = colored('Test Blue Shock', 'Instant', 'Test Blue Shock deals 3 damage to target player.', ['U']);
  const DEFS: CardDef[] = [TENDER, SHOCK, BLUE_SHOCK];
  it('is automated', () => expect(full(TENDER)).toBe(true));
  it('the red spell chosen as the source deals no damage; a second red spell cast later still does', () => {
    let s = scenario([], { p1: { hand: ['Test Red Shock', 'Test Red Shock'], battlefield: ['Test Tender'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Red Shock', { targets: [plr('p2')] });
    const shock = s.zones.stack[s.zones.stack.length - 1]!;
    const tender = find(s, 'Test Tender', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: tender, ability: activatedAbilities(s, s.objects[tender]!)[0]!.key });
    s = resolveAll(settle(s, { objects: [shock] }), { objects: [shock] });
    expect(life(s, 'p2')).toBe(20);
    s = resolveAll(cast(s, 'Test Red Shock', { targets: [plr('p2')] }));
    expect(life(s, 'p2')).toBe(17);
  });
  it('negative: only red sources are offered (a blue spell is not), and without the ability the damage is dealt', () => {
    let s = scenario([], { p1: { hand: ['Test Blue Shock', 'Test Red Shock'], battlefield: ['Test Tender'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Blue Shock', { targets: [plr('p2')] });
    const blue = s.zones.stack[s.zones.stack.length - 1]!;
    const tender = find(s, 'Test Tender', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: tender, ability: activatedAbilities(s, s.objects[tender]!)[0]!.key }));
    const d = s.pending as { kind: string; options?: ObjectId[] } | null;
    if (d?.kind === 'chooseObjects') expect(d.options).not.toContain(blue);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(17);
  });
});
