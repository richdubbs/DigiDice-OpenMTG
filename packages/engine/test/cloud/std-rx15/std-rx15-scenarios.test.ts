/**
 * std-rx15 (wave 2, slice s12): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 611.2a, 205.1b, 613.4b   "~ becomes a <subtypes> with base power and toughness N/M" with no duration: it lasts after the turn ends, the new creature types
 *                               replace the old ones; "If ~ is a <subtype>, it becomes ..." does nothing when it is not
 *   CR 702.16b-f                "... and protection from each of your opponents": opponents' creatures can't block it, opponents' spells and abilities can't
 *                               target it, opponents' sources' damage to it is prevented; its controller's own can
 *   CR 702.82a-b                devour N and devour <type> N: as it enters its controller sacrifices any number of creatures (or permanents of the type) and it
 *                               enters with N times that many +1/+1 counters; sacrificing none gives none
 *   CR 707.9b, 702.6a, 602.2b   "create a token that's a copy of it, except it has "~'s equip abilities cost {2} less to activate."" after "Whenever a nontoken
 *                               Equipment you control enters": the token's equip costs {2} less, the original's does not; "Sacrifice that token" is the copy
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { canBeTargeted, hasProtectionFrom } from '../../../src/rules/protection';
import { card, counters, full, inYard, pt, resolveAll, settle } from '../cmd3/helpers';

const FABLE = card('Test Squire', 'Creature — Elf', '{1}: This creature becomes an Elf Druid with base power and toughness 3/4.\n'
  + '{1}: If this creature is a Druid, it becomes an Elf Shaman with base power and toughness 5/5.\n'
  + '{1}: If this creature is a Shaman, it becomes an Elf Avatar with base power and toughness 6/6 and protection from each of your opponents.', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const PLAINS = card('Test Plains', 'Basic Land — Plains', '({T}: Add {W}.)');
const MAW = card('Test Maw', 'Creature — Beast', 'Devour 2', ['1', '1']);
const DIGGER = card('Test Digger', 'Creature — Beast', 'Devour land 1', ['0', '1']);
const FORGE = card('Test Forge', 'Enchantment', 'Whenever a nontoken Equipment you control enters, create a token that\'s a copy of it, except it has "This Equipment\'s equip abilities cost {2} less to activate." Sacrifice that token at the beginning of the next upkeep.');
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {3}');
const DEFS = [FABLE, BEAR, PLAINS, MAW, DIGGER, FORGE, BLADE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** Activate the `i`th ability of Test Squire and resolve it. */
function activate(s0: GameState, i: number): GameState {
  const s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Squire', 'battlefield', 'p1'), ability: `p:0:${i}` });
  return resolveAll(s);
}

const board = (): GameState => {
  const s = scenario([], { p1: { battlefield: ['Test Squire', 'Test Bear', 'Test Plains', 'Test Plains', 'Test Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
  return advanceTo(s, 1, 'main1');
};
const subtypes = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes].sort();

describe('CR 611.2a, 205.1b, 613.4b: "~ becomes a <subtypes> with base power and toughness N/M" with no duration', () => {
  it('sets its creature types and base power and toughness for good: still so on the next turn', () => {
    let s = activate(board(), 0);
    const me = find(s, 'Test Squire', 'battlefield', 'p1');
    expect(pt(s, me)).toBe('3/4');
    expect(subtypes(s, me)).toEqual(['Druid', 'Elf']);
    s = advanceTo(s, 2, 'main1');
    expect(pt(s, me)).toBe('3/4');
  });
  it('"If ~ is a Druid, it becomes ..." does nothing while it is not a Druid, and works once it is one', () => {
    let s = activate(board(), 1);
    const me = find(s, 'Test Squire', 'battlefield', 'p1');
    expect(pt(s, me)).toBe('1/1');
    expect(subtypes(s, me)).toEqual(['Elf']);
    s = activate(activate(s, 0), 1);
    expect(pt(s, me)).toBe('5/5');
    expect(subtypes(s, me)).toEqual(['Elf', 'Shaman']);
  });
});

describe('CR 702.16b-f: "... and protection from each of your opponents"', () => {
  const avatar = (): GameState => activate(activate(activate(board(), 0), 1), 2);
  it('the third step gives 6/6 and the keyword; without the second step it gives nothing', () => {
    const s = avatar();
    const me = find(s, 'Test Squire', 'battlefield', 'p1');
    expect(pt(s, me)).toBe('6/6');
    expect(getChars(s, me)!.keywords.some((k) => k.keyword === 'protection' && k.quality === 'player:opponents')).toBe(true);
    const t = activate(board(), 2);
    expect(getChars(t, find(t, 'Test Squire', 'battlefield', 'p1'))!.keywords.some((k) => k.keyword === 'protection')).toBe(false);
  });
  it('protection from what an opponent controls, not from what its controller controls (damage, CR 702.16e; attachment, CR 702.16c-d)', () => {
    const s = avatar();
    const me = getChars(s, find(s, 'Test Squire', 'battlefield', 'p1'))!;
    expect(hasProtectionFrom(me, getChars(s, find(s, 'Test Bear', 'battlefield', 'p2'))!)).toBe(true);
    expect(hasProtectionFrom(me, getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!)).toBe(false);
  });
  it('an opponent\'s spell or ability can\'t target it; its controller\'s can, even when the source is not known (CR 702.16b, 115.1)', () => {
    const s = avatar();
    const me = getChars(s, find(s, 'Test Squire', 'battlefield', 'p1'))!;
    expect(canBeTargeted(me, 'p1', null, 'p2')).toBe(false);
    expect(canBeTargeted(me, 'p1', getChars(s, find(s, 'Test Bear', 'battlefield', 'p2'))!, 'p2')).toBe(false);
    expect(canBeTargeted(me, 'p1', null, 'p1')).toBe(true);
    expect(canBeTargeted(me, 'p1', getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!, 'p1')).toBe(true);
  });
  it('a creature an opponent controls can\'t block it (CR 702.16f); it can block the creature that lacks protection', () => {
    let s = avatar();
    const me = find(s, 'Test Squire', 'battlefield', 'p1');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
      if (guard > 20) throw new Error('no declare attackers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: me, defender: 'p2' }, { attacker: mine, defender: 'p2' }] });
    for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) {
      if (guard > 20) throw new Error('no declare blockers');
      s = pass(s);
    }
    const d = s.pending!;
    const blocker = find(s, 'Test Bear', 'battlefield', 'p2');
    const tryBlock = (attacker: ObjectId) => applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker }] } }).error;
    expect(tryBlock(me)).toBeDefined();
    expect(tryBlock(mine)).toBeUndefined();
  });
});

describe('CR 702.82a-b: devour', () => {
  const start = (hand: string, battlefield: string[]): GameState =>
    advanceTo(scenario([], { p1: { hand: [hand], battlefield }, p2: { battlefield: ['Test Bear'] }, defs: DEFS }), 1, 'main1');
  const castWith = (s0: GameState, name: string, pick: (s: GameState) => ObjectId[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    s = settle(s);
    for (let guard = 0; s.zones.stack.length > 0 && guard < 10; guard++) {
      s = pass(s);
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(s) });
      s = settle(s);
    }
    return s;
  };
  it('devour 2: two creatures sacrificed give four +1/+1 counters; the opponent\'s creature is never offered', () => {
    let offered: ObjectId[] = [];
    const s = castWith(start('Test Maw', ['Test Bear', 'Test Squire']), 'Test Maw', (t) => {
      offered = (t.pending as { options: ObjectId[] }).options;
      return offered;
    });
    expect(offered).toHaveLength(2);
    const maw = find(s, 'Test Maw', 'battlefield', 'p1');
    expect(counters(s, maw, '+1/+1')).toBe(4);
    expect(pt(s, maw)).toBe('5/5');
    expect(inYard(s, BEAR.id)).toBe(true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p2')).toBe(true);
  });
  it('sacrificing none gives no counters (it enters as printed)', () => {
    const s = castWith(start('Test Maw', ['Test Bear']), 'Test Maw', () => []);
    const maw = find(s, 'Test Maw', 'battlefield', 'p1');
    expect(counters(s, maw, '+1/+1')).toBe(0);
    expect(find(s, 'Test Bear', 'battlefield', 'p1')).toBeDefined();
  });
  it('devour land 1: only lands are offered; one land sacrificed gives one counter', () => {
    let offered: ObjectId[] = [];
    const s0 = start('Test Digger', ['Test Bear', 'Test Plains']);
    const land = find(s0, 'Test Plains', 'battlefield', 'p1');
    const s = castWith(s0, 'Test Digger', (t) => {
      offered = (t.pending as { options: ObjectId[] }).options;
      return offered;
    });
    expect(offered).toEqual([land]);
    expect(counters(s, find(s, 'Test Digger', 'battlefield', 'p1'), '+1/+1')).toBe(1);
    expect(inYard(s, PLAINS.id)).toBe(true);
    expect(find(s, 'Test Bear', 'battlefield', 'p1')).toBeDefined();
  });
});

describe('CR 707.9b, 702.6a, 602.2b: a token copy of an Equipment, except it has "~\'s equip abilities cost {2} less to activate."', () => {
  const made = (): GameState => {
    const s0 = advanceTo(scenario([], { p1: { hand: ['Test Blade'], battlefield: ['Test Forge', 'Test Bear', 'Test Plains'] }, defs: DEFS }), 1, 'main1');
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Blade', 'hand', 'p1') }));
  };
  const blades = (s: GameState): { card: ObjectId; token: ObjectId } => {
    const all = s.zones.battlefield.filter((id) => s.objects[id]!.defId === BLADE.id || s.defs[s.objects[id]!.defId]?.name === 'Test Blade');
    return { card: all.find((id) => s.objects[id]!.kind === 'card')!, token: all.find((id) => s.objects[id]!.kind === 'token')! };
  };
  const canEquip = (s: GameState, id: ObjectId): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === id);
  it('the nontoken Equipment makes one token copy; with one land only the token\'s equip ({3} less {2}) can be activated', () => {
    const s = made();
    const { card: c, token: t } = blades(s);
    expect(c).toBeDefined();
    expect(t).toBeDefined();
    expect(canEquip(s, t)).toBe(true);
    expect(canEquip(s, c)).toBe(false);
  });
  it('"Sacrifice that token" is the copy: at the next upkeep the token is gone and the card stays', () => {
    const s = advanceTo(made(), 2, 'main1');
    const all = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Blade');
    expect(all).toHaveLength(1);
    expect(s.objects[all[0]!]!.kind).toBe('card');
  });
});

describe('CR 702.82a, 111.1: a token created with devour devours as it enters', () => {
  const BROOD = card('Test Brood', 'Sorcery', 'Create a 1/1 green Beast creature token with devour 2.');
  it('is automated', () => expect(full(BROOD), JSON.stringify(BROOD.automation)).toBe(true));
  it('the token enters with twice the number of creatures sacrificed as +1/+1 counters', () => {
    let s = advanceTo(scenario([], { p1: { hand: ['Test Brood'], battlefield: ['Test Bear'] }, defs: [...DEFS, BROOD] }), 1, 'main1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Brood', 'hand', 'p1') }));
    let asked = false;
    for (let guard = 0; s.zones.stack.length > 0 && guard < 10; guard++) {
      s = pass(s);
      if (s.pending?.kind === 'chooseObjects') { asked = true; s = answer(s, { kind: 'chooseObjects', ids: (s.pending as { options: ObjectId[] }).options }); }
      s = settle(s);
    }
    expect(asked).toBe(true);
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(counters(s, tok, '+1/+1')).toBe(2);
    expect(inYard(s, BEAR.id)).toBe(true);
  });
});
