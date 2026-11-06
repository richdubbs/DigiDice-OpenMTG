/**
 * Commander EDHREC ranks 29,501-30,000 (third pass), round edh-c-79: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 205.3i, 305.6, 608.2h, 611.2a    "All creatures get -1/-1 until end of turn for each basic land type among lands you control."
 *   CR 120.3, 107.1a, 107.3, 608.2h     "~ deals X damage to target opponent and half X damage, rounded up, to you, where X is the number of Mountains you control."
 *   CR 120.2b, 120.3                    "~ deals X damage to each creature with flying and 1 additional damage to each blue creature."
 *   CR 608.2b, 122.1, 608.2h             "... then remove a +1/+1 counter from ~ for each card in target opponent's hand."
 *   CR 615.1a, 510.2, 611.2a            "Prevent all combat damage that would be dealt this turn by target attacking creature with flying."
 *   CR 608.2d, 400.3, 400.7             "When ~ enters, put a creature you control on top of its owner's library."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { card, full, pt, resolveAll } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const nameAt = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;

/** Cast `name` from p1's hand with these targets, pay, and stop at the first decision of the resolution (or priority after it). */
function castAt(s0: GameState, name: string, targets: TargetChoice[] = [], x = 0): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 12; guard++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
    else break;
  }
  return passBoth(s);
}
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[]): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' });
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 12; guard++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return passBoth(s);
}

describe('CR 205.3i, 305.6, 608.2h, 611.2a: "All creatures get -1/-1 until end of turn for each basic land type among lands you control."', () => {
  const DESPAIR = card('Test Despair', 'Sorcery', 'All creatures get -1/-1 until end of turn for each basic land type among lands you control.');
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5']);
  const DESERT = card('Test Desert', 'Land — Desert', '');
  const DEFS: CardDef[] = [DESPAIR, GIANT, DESERT];
  const run = (mine: string[], theirs: string[] = []): { s: GameState; a: ObjectId; b: ObjectId } => {
    let s = scenario(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'], { p1: { hand: ['Test Despair'], battlefield: ['Test Giant', ...mine] }, p2: { battlefield: ['Test Giant', ...theirs] }, defs: DEFS });
    const a = find(s, 'Test Giant', 'battlefield', 'p1');
    const b = find(s, 'Test Giant', 'battlefield', 'p2');
    s = resolveAll(castAt(s, 'Test Despair'));
    return { s, a, b };
  };
  it('is automated', () => expect(full(DESPAIR)).toBe(true));
  it('three basic land types (two Plains count once, a Desert counts nothing): every creature of every player gets -3/-3', () => {
    const { s, a, b } = run(['Plains', 'Plains', 'Island', 'Forest', 'Test Desert']);
    expect(pt(s, a)).toBe('2/2');
    expect(pt(s, b)).toBe('2/2');
  });
  it('the lands of an opponent are not counted (negative): no land of yours means no change', () => {
    const { s, a, b } = run([], ['Plains', 'Island', 'Swamp']);
    expect(pt(s, a)).toBe('5/5');
    expect(pt(s, b)).toBe('5/5');
  });
  it('it lasts until end of turn only: on the next turn the creatures are 5/5 again', () => {
    const { s, a } = run(['Plains', 'Island']);
    expect(pt(s, a)).toBe('3/3');
    const later = advanceTo(s, 3, 'upkeep');
    expect(pt(later, a)).toBe('5/5');
  });
});

describe('CR 120.3, 107.1a, 107.3, 608.2h: "~ deals X damage to target opponent and half X damage, rounded up, to you, where X is the number of Mountains you control."', () => {
  const FLAME = card('Test Flame', 'Sorcery', 'Test Flame deals X damage to target opponent and half X damage, rounded up, to you, where X is the number of Mountains you control.');
  const run = (lands: string[], target: TargetChoice = { kind: 'player', id: 'p2' }): GameState => {
    const s = scenario(['Mountain', 'Forest'], { p1: { hand: ['Test Flame'], battlefield: lands }, defs: [FLAME] });
    return resolveAll(castAt(s, 'Test Flame', [target]));
  };
  it('is automated', () => expect(full(FLAME)).toBe(true));
  it('three Mountains: 3 to the opponent, half of 3 rounded up (2) to you', () => {
    const s = run(['Mountain', 'Mountain', 'Mountain', 'Forest']);
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(18);
  });
  it('four Mountains: 4 and 2; one Mountain: 1 and 1 (rounded up); a Forest is no Mountain (negative: none means 0 and 0)', () => {
    const four = run(['Mountain', 'Mountain', 'Mountain', 'Mountain']);
    expect([life(four, 'p2'), life(four, 'p1')]).toEqual([16, 18]);
    const one = run(['Mountain', 'Forest']);
    expect([life(one, 'p2'), life(one, 'p1')]).toEqual([19, 19]);
    const none = run(['Forest']);
    expect([life(none, 'p2'), life(none, 'p1')]).toEqual([20, 20]);
  });
});

describe('CR 120.2b, 120.3: "~ deals X damage to each creature with flying and 1 additional damage to each blue creature."', () => {
  const STORM = card('Test Storm', 'Sorcery', 'Test Storm deals X damage to each creature with flying and 1 additional damage to each blue creature.', undefined, '{X}');
  const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['9', '9']);
  const colored = (name: string, type: string, text: string, color: string): CardDef =>
    compileCard({ name, layout: 'normal', mana_cost: `{${color}}`, type_line: type, oracle_text: text, colors: [color], power: '9', toughness: '9' } as OracleCard);
  const BLUE_FLIER = colored('Test Blue Flier', 'Creature — Bird', 'Flying', 'U');
  const BLUE_WALKER = colored('Test Blue Walker', 'Creature — Merfolk', '', 'U');
  const RED_WALKER = colored('Test Red Walker', 'Creature — Ogre', '', 'R');
  const DEFS: CardDef[] = [STORM, FLIER, BLUE_FLIER, BLUE_WALKER, RED_WALKER];
  const run = (x: number): { s: GameState; ids: { flier: ObjectId; blueWalker: ObjectId; blueFlier: ObjectId; redWalker: ObjectId } } => {
    const s0 = scenario(['Plains', 'Plains', 'Plains'], { p1: { hand: ['Test Storm'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Flier', 'Test Blue Walker'] }, p2: { battlefield: ['Test Blue Flier', 'Test Red Walker'] }, defs: DEFS });
    const ids = {
      flier: find(s0, 'Test Flier', 'battlefield', 'p1'), blueWalker: find(s0, 'Test Blue Walker', 'battlefield', 'p1'),
      blueFlier: find(s0, 'Test Blue Flier', 'battlefield', 'p2'), redWalker: find(s0, 'Test Red Walker', 'battlefield', 'p2'),
    };
    return { s: resolveAll(castAt(s0, 'Test Storm', [], x)), ids };
  };
  it('is automated', () => expect(full(STORM)).toBe(true));
  it('X = 2: a flier takes 2, a blue flier takes 2 and 1 more (3), a blue creature without flying takes 1, a red creature without flying takes nothing', () => {
    const { s, ids } = run(2);
    expect(dmg(s, ids.flier)).toBe(2);
    expect(dmg(s, ids.blueFlier)).toBe(3);
    expect(dmg(s, ids.blueWalker)).toBe(1);
    expect(dmg(s, ids.redWalker)).toBe(0);
  });
  it('X = 0 (negative): only the additional 1 is dealt, to the blue creatures', () => {
    const { s, ids } = run(0);
    expect(dmg(s, ids.flier)).toBe(0);
    expect(dmg(s, ids.blueFlier)).toBe(1);
    expect(dmg(s, ids.blueWalker)).toBe(1);
    expect(dmg(s, ids.redWalker)).toBe(0);
  });
});

describe('CR 608.2b, 122.1, 608.2h: "At the beginning of your upkeep, put a +1/+1 counter on ~ for each card in your hand, then remove a +1/+1 counter from ~ for each card in target opponent\'s hand."', () => {
  const DESCENDANT = card('Test Descendant', 'Creature — Human', "At the beginning of your upkeep, put a +1/+1 counter on this creature for each card in your hand, then remove a +1/+1 counter from this creature for each card in target opponent's hand.", ['1', '1']);
  const upkeep = (theirHand: string[], start = 0): { s: GameState; id: ObjectId; mine: number; theirs: number } => {
    let s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Descendant', counters: start === 0 ? {} : { '+1/+1': start } }], hand: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: theirHand }, defs: [DESCENDANT] });
    const id = find(s, 'Test Descendant', 'battlefield', 'p1');
    s = advanceTo(s, 3, 'upkeep');
    const mine = s.zones.hand['p1']!.length;
    const theirs = s.zones.hand['p2']!.length; // the opponent drew on turn 2
    for (let g = 0; g < 8 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else s = passBoth(s);
    }
    return { s, id, mine, theirs };
  };
  it('is automated', () => expect(full(DESCENDANT)).toBe(true));
  it('the counters put are the cards in your hand, those removed the cards in the opponent\'s hand: the difference stays', () => {
    const { s, id, mine, theirs } = upkeep(['Plains', 'Plains']);
    expect(theirs).toBeGreaterThan(0);
    expect(mine).toBeGreaterThan(theirs);
    expect(counters(s, id)).toBe(mine - theirs);
  });
  it('an opponent with more cards than you removes every counter, including ones put by other effects (the ruling), and none go below zero', () => {
    const { s, id, mine, theirs } = upkeep(Array(6).fill('Plains'), 2);
    expect(theirs).toBeGreaterThan(mine + 2);
    expect(counters(s, id)).toBe(0);
  });
  it('an opponent with fewer cards removes fewer (negative: one card in the opponent\'s hand removes one counter, not all)', () => {
    const { s, id, mine, theirs } = upkeep([], 3);
    expect(counters(s, id)).toBe(3 + mine - theirs);
  });
});

describe('CR 615.1a, 510.2, 611.2a: "{0}: Prevent all combat damage that would be dealt this turn by target attacking creature with flying."', () => {
  const CHANTER = card('Test Chanter', 'Creature — Human', '{0}: Prevent all combat damage that would be dealt this turn by target attacking creature with flying.', ['1', '1']);
  const WISP = card('Test Wisp', 'Creature — Spirit', 'Flying', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [CHANTER, WISP, BEAR];
  const fight = (shield: boolean): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Chanter', 'Test Wisp', 'Test Bear'] }, p2: {}, defs: DEFS });
    const wisp = find(s, 'Test Wisp', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[wisp], [bear]]);
    if (shield) s = activate(s, find(s, 'Test Chanter', 'battlefield', 'p1'), [obj(wisp)]);
    return passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
  };
  it('is automated', () => expect(full(CHANTER)).toBe(true));
  it('the attacking flier deals no combat damage; the other attacker still does', () => {
    const s = fight(true);
    expect(life(s, 'p2')).toBe(18);
  });
  it('without the ability (negative) both attackers deal their damage', () => {
    const s = fight(false);
    expect(life(s, 'p2')).toBe(15);
  });
  it('a creature without flying cannot be its target (negative)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Chanter', 'Test Wisp', 'Test Bear'] }, p2: {}, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Wisp', 'battlefield', 'p1')], [bear]]);
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Chanter', 'battlefield', 'p1'), ability: 'p:0:0' });
    let ok = true;
    try {
      const u = t.pending?.kind === 'chooseTargets' ? answer(t, { kind: 'chooseTargets', targets: [obj(bear)] }) : t;
      ok = u.pending?.kind !== 'chooseTargets' && u.zones.stack.length > 0;
    } catch { ok = false; }
    expect(ok).toBe(false);
  });
});

describe('CR 608.2d, 400.3, 400.7: "When ~ enters, put a creature you control on top of its owner\'s library."', () => {
  const GARGANTUAN = card('Test Gargantuan', 'Creature — Beast', "When this creature enters, put a creature you control on top of its owner's library.", ['6', '6']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [GARGANTUAN, BEAR];
  const topName = (s: GameState, p: string): string => nameAt(s, s.zones.library[p]![0]!);
  it('is automated', () => expect(full(GARGANTUAN)).toBe(true));
  it('you choose the creature as the ability resolves: the chosen creature goes on top of its owner\'s library', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Gargantuan'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = castAt(s, 'Test Gargantuan');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    for (let g = 0; g < 8 && s.pending?.kind !== undefined && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [bear] });
      else s = passBoth(s);
    }
    expect(topName(s, 'p1')).toBe('Test Bear');
    expect(s.zones.battlefield.map((id) => nameAt(s, id))).toEqual(['Test Gargantuan']);
  });
  it('with no other creature it must be itself (the ruling)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Gargantuan'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Gargantuan'));
    expect(topName(s, 'p1')).toBe('Test Gargantuan');
    expect(s.zones.battlefield.length).toBe(0);
  });
  it('a creature of an opponent is not offered (negative): "a creature you control"', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Gargantuan'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Gargantuan'));
    expect(s.zones.battlefield.map((id) => nameAt(s, id))).toEqual(['Test Bear']);
    expect(topName(s, 'p1')).toBe('Test Gargantuan');
  });
});
