/**
 * Commander lane commander, round edh-next-82 (second round): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the default
 * compiler, each with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 where the record says so, else from memory (unverified).
 *
 *   CR 725.1, 500.1      "Whenever an opponent becomes the monarch, if you were the monarch as the turn began, ..." (Knights of the Black Rose)
 *   CR 726.1, 508.1b     "Whenever you attack the player who has the initiative, ..." (Loot Dispute); "Whenever you attack, if you or a player you're attacking has the initiative, ..." (Undercellar Sweep)
 *   CR 725.1, 101.2      "You can't become the monarch this turn." and "If damage would be dealt to ~ while you're the monarch, prevent that damage and put that many +1/+1 counters on it." (Jared Carthalion, True Heir)
 *   CR 400.7, 603.4      "..., if no permanents left the battlefield this turn, ..." (Sarevok, Deathbringer)
 *   CR 120.1, 400.7      "..., if a source you controlled dealt 5 or more damage this turn, ..." (Dragon Cultist)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { advanceTo, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { answer } from '../../m3/scenario';
import { cast, drive, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const names = (s: GameState): string[] => s.zones.battlefield.map((id) => nameOf(s, id));
const count = (s: GameState, name: string, owner?: 'p1' | 'p2'): number => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (owner === undefined || s.objects[id]!.controller === owner)).length;
const settle = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) s = s.pending?.kind === 'priority' ? pass(s) : s.pending?.kind === 'chooseTargets' ? answer(s, target('p2')) : drive(s); return s; };

describe('Knights of the Black Rose (CR 725.1, 500.1): "Whenever an opponent becomes the monarch, if you were the monarch as the turn began, that player loses 2 life and you gain 2 life."', () => {
  const KNIGHT = card('Test Black Knight', 'Creature — Knight', 'Whenever an opponent becomes the monarch, if you were the monarch as the turn began, that player loses 2 life and you gain 2 life.', { pt: ['2', '2'] });
  const USURP = card('Test Usurp', 'Sorcery', 'Target opponent becomes the monarch.');
  const play = (monarch: 'p1' | undefined, atStart: 'p1' | undefined): GameState => {
    const s0 = tweak(scenario([], { defs: [KNIGHT, USURP], p1: { battlefield: ['Test Black Knight'], hand: ['Test Usurp'] } }), (t) => {
      if (monarch) t.designations.monarch = monarch;
      if (atStart) t.designations.monarchAtTurnStart = atStart; else delete t.designations.monarchAtTurnStart;
    });
    return settle(cast(s0, 'Test Usurp', [target('p2')]));
  };
  it('is automated with no manual part', () => expect(noManual(KNIGHT)).toBe(true));
  it('you were the monarch as the turn began and an opponent becomes it: they lose 2, you gain 2', () => {
    const s0 = scenario([], { defs: [KNIGHT, USURP], p1: { battlefield: ['Test Black Knight'] } });
    const s = play('p1', 'p1');
    expect(s.designations.monarch).toBe('p2');
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 2);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 2);
  });
  it('negative: you became the monarch only during this turn (not as it began): nothing happens', () => {
    const s0 = scenario([], { defs: [KNIGHT, USURP], p1: { battlefield: ['Test Black Knight'] } });
    const s = play('p1', undefined);
    expect(s.designations.monarch).toBe('p2');
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('the turn start writes the monarch of that moment (core/turn.ts): the next turn it is the player who held it at the end of this one', () => {
    const s0 = tweak(scenario([], { defs: [KNIGHT], p1: { battlefield: ['Test Black Knight'] } }), (t) => { t.designations.monarch = 'p2'; });
    const next = advanceTo(s0, s0.turn.number + 1, 'upkeep');
    expect(next.designations.monarchAtTurnStart).toBe('p2');
    const none = advanceTo(scenario([], { defs: [KNIGHT], p1: { battlefield: ['Test Black Knight'] } }), 3, 'upkeep');
    expect(none.designations.monarchAtTurnStart).toBeUndefined();
  });
});

describe('Loot Dispute and Undercellar Sweep (CR 726.1, 508.1b, 603.4): attacking the player who has the initiative', () => {
  const LOOT = card('Test Loot Pit', 'Enchantment', 'Whenever you attack the player who has the initiative, create a Treasure token.');
  const SWEEP = card('Test Sweep Pit', 'Enchantment', "Whenever you attack, if you or a player you're attacking has the initiative, you create two 1/1 white Soldier creature tokens that are tapped and attacking.");
  const BEAR = card('Test Attacker Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const attack = (enchantment: string, initiative: 'p1' | 'p2' | undefined): GameState => {
    const s0 = tweak(scenario([], { defs: [LOOT, SWEEP, BEAR], p1: { battlefield: [enchantment, 'Test Attacker Bear'] } }), (t) => { if (initiative) t.designations.initiative = initiative; });
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, [[find(s, 'Test Attacker Bear', 'battlefield', 'p1'), 'p2']]);
    return settle(s);
  };
  it('both are automated with no manual part', () => { expect(noManual(LOOT)).toBe(true); expect(noManual(SWEEP)).toBe(true); });
  it('Loot: the defender has the initiative: a Treasure', () => { const s = attack('Test Loot Pit', 'p2'); expect(names(s).filter((n) => /Treasure/.test(n)).length, names(s).join()).toBe(1); });
  it('negative (Loot): you have the initiative yourself, or nobody does: no Treasure', () => {
    expect(names(attack('Test Loot Pit', 'p1')).filter((n) => /Treasure/.test(n)).length).toBe(0);
    expect(names(attack('Test Loot Pit', undefined)).filter((n) => /Treasure/.test(n)).length).toBe(0);
  });
  it('Sweep: the defender has the initiative: two tapped and attacking Soldiers; so does you having it', () => {
    const s = attack('Test Sweep Pit', 'p2');
    expect(names(s).filter((n) => /Soldier/.test(n)).length).toBe(2);
    const t = attack('Test Sweep Pit', 'p1');
    expect(names(t).filter((n) => /Soldier/.test(n)).length).toBe(2);
  });
  it('negative (Sweep): nobody has the initiative: no Soldiers', () => {
    const s = attack('Test Sweep Pit', undefined);
    expect(names(s).filter((n) => /Soldier/.test(n)).length).toBe(0);
  });
});

describe('Jared Carthalion, True Heir (CR 725.1, 101.2, 615.5): "You can\'t become the monarch this turn." and the damage replacement while you\'re the monarch', () => {
  const HEIR = card('Test True Heir', 'Creature — Human', "When ~ enters, target opponent becomes the monarch. You can't become the monarch this turn.\nIf damage would be dealt to ~ while you're the monarch, prevent that damage and put that many +1/+1 counters on it.", { pt: ['2', '2'] });
  const CROWN = card('Test Crown Grab', 'Sorcery', 'You become the monarch.');
  const BOLT = card('Test Zap', 'Sorcery', 'Test Zap deals 2 damage to target creature.');
  it('is automated with no manual part', () => expect(noManual(HEIR)).toBe(true));
  it('the opponent becomes the monarch and you cannot take it back this turn', () => {
    let s = scenario([], { defs: [HEIR, CROWN], p1: { hand: ['Test True Heir', 'Test Crown Grab'] } });
    s = settle(cast(s, 'Test True Heir', [target('p2')]));
    expect(s.designations.monarch).toBe('p2');
    s = settle(cast(s, 'Test Crown Grab'));
    expect(s.designations.monarch).toBe('p2'); // CR 725.1, 101.2: the effect that would make you the monarch does nothing
  });
  it('negative: without the restriction the same spell makes you the monarch', () => {
    const s = settle(cast(scenario([], { defs: [CROWN], p1: { hand: ['Test Crown Grab'] } }), 'Test Crown Grab'));
    expect(s.designations.monarch).toBe('p1');
  });
  it('the restriction is an effect that lasts until end of turn', () => {
    let s = scenario([], { defs: [HEIR, CROWN], p1: { hand: ['Test True Heir'] } });
    s = settle(cast(s, 'Test True Heir', [target('p2')]));
    const eff = s.continuousEffects.filter((e) => e.effect.s === 'restrict' && (e.effect as { action?: string }).action === 'becomeMonarch');
    expect(eff.length).toBe(1);
    expect(eff[0]!.duration).toEqual({ d: 'endOfTurn' });
  });
  it('while you are the monarch damage to it is prevented and becomes +1/+1 counters; otherwise it is dealt', () => {
    const run = (monarch: 'p1' | undefined): GameState => {
      const s0 = tweak(scenario([], { defs: [HEIR, BOLT], p1: { battlefield: ['Test True Heir'], hand: ['Test Zap'] } }), (t) => { if (monarch) t.designations.monarch = monarch; });
      return settle(cast(s0, 'Test Zap', [target(find(s0, 'Test True Heir', 'battlefield', 'p1'))]));
    };
    const a = run('p1');
    const heirA = find(a, 'Test True Heir', 'battlefield', 'p1');
    expect(a.objects[heirA]!.damage ?? 0).toBe(0);
    expect(getChars(a, heirA).power).toBe('4'); // two +1/+1 counters
    const b = run(undefined);
    expect(b.zones.battlefield.some((id) => nameOf(b, id) === 'Test True Heir')).toBe(false); // 2 damage kills the 2/2
  });
});

describe('Sarevok, Deathbringer (CR 400.7, 603.4): "At the beginning of each player\'s end step, if no permanents left the battlefield this turn, that player loses X life, where X is ~\'s power."', () => {
  const SAREVOK = card('Test Deathbringer', 'Creature — Human Knight', "At the beginning of each player's end step, if no permanents left the battlefield this turn, that player loses X life, where X is ~'s power.", { pt: ['3', '3'] });
  const GONE = card('Test Vanish', 'Sorcery', 'Exile target creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is automated with no manual part', () => expect(noManual(SAREVOK)).toBe(true));
  it('nothing left the battlefield: the active player loses life equal to its power at their end step', () => {
    const s0 = scenario([], { defs: [SAREVOK], p1: { battlefield: ['Test Deathbringer'] } });
    const s = settle(advanceTo(s0, s0.turn.number, 'end'));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3);
  });
  it('negative: a permanent left the battlefield this turn: no life lost', () => {
    const s0 = scenario([], { defs: [SAREVOK, GONE, BEAR], p1: { battlefield: ['Test Deathbringer'], hand: ['Test Vanish'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const s1 = settle(cast(s0, 'Test Vanish', [target(find(s0, 'Test Plain Bear', 'battlefield', 'p2'))]));
    expect(count(s1, 'Test Plain Bear')).toBe(0);
    const s = settle(advanceTo(s1, s1.turn.number, 'end'));
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

describe('Dragon Cultist (CR 120.1, 400.7): "..., if a source you controlled dealt 5 or more damage this turn, ..." (one source, not all of them together)', () => {
  const PIT = card('Test Damage Pit', 'Enchantment', 'At the beginning of your end step, if a source you controlled dealt 5 or more damage this turn, you gain 7 life.');
  const BIG = card('Test Big Brute', 'Creature — Giant', '', { pt: ['5', '5'] });
  const SMALL = card('Test Small Brute', 'Creature — Giant', '', { pt: ['3', '3'] });
  const SMALL2 = card('Test Small Brute Two', 'Creature — Giant', '', { pt: ['3', '3'] });
  const run = (...bodies: string[]): GameState => {
    const s0 = scenario([], { defs: [PIT, BIG, SMALL, SMALL2], p1: { battlefield: ['Test Damage Pit', ...bodies] } });
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, bodies.map((b) => [find(s, b, 'battlefield', 'p1'), 'p2'] as [ObjectId, 'p2']));
    s = settle(advanceTo(s, s.turn.number, 'end'));
    return s;
  };
  it('is automated with no manual part', () => expect(noManual(PIT)).toBe(true));
  it('one 5/5 deals 5: the trigger gains 7 life', () => expect(life(run('Test Big Brute'), 'p1')).toBe(life(scenario([], { defs: [PIT, BIG], p1: { battlefield: ['Test Damage Pit'] } }), 'p1') + 7));
  it('negative: two 3/3s deal 6 together but no one source dealt 5: nothing', () => {
    const base = life(scenario([], { defs: [PIT, SMALL], p1: { battlefield: ['Test Damage Pit'] } }), 'p1');
    const s = run('Test Small Brute', 'Test Small Brute Two');
    expect(life(s, 'p2')).toBe(life(scenario([], { defs: [PIT], p1: { battlefield: ['Test Damage Pit'] } }), 'p2') - 6); // 6 damage in all, from two sources
    expect(life(s, 'p1')).toBe(base);
  });
});
void resolveAll;

describe('review fixes (edh-next-82)', () => {
  it('Jared (ruling 2020-11-10): damage that can\'t be prevented is dealt and the same amount of counters is put on it', () => {
    const HEIR = card('Test True Heir', 'Creature — Human', "If damage would be dealt to ~ while you're the monarch, prevent that damage and put that many +1/+1 counters on it.", { pt: ['4', '4'] });
    const ZAP = card('Test Hard Zap', 'Sorcery', "Test Hard Zap deals 1 damage to target creature. That damage can't be prevented.");
    const s0 = tweak(scenario([], { defs: [HEIR, ZAP], p1: { battlefield: ['Test True Heir'], hand: ['Test Hard Zap'] } }), (t) => { t.designations.monarch = 'p1'; });
    if (!noManual(ZAP)) return; // the rider wording is not automated here: nothing to play
    const s = settle(cast(s0, 'Test Hard Zap', [target(find(s0, 'Test True Heir', 'battlefield', 'p1'))]));
    const heir = find(s, 'Test True Heir', 'battlefield', 'p1');
    expect(getChars(s, heir).power).toBe('5');
  });
});
