/**
 * FAST5X E24 on the game path, with real fixture cards whose Oracle text calls the character "he" or "she" (CR 201.5: the pronoun means the object itself,
 * parser/front/selfref.ts#pronounRefs; the shapes are zz-fast5x/e24.json):
 *   CR 701.24a, 121.1, 400.3   Gandalf, Wandering Wizard: "{6}: Gandalf's owner shuffles him into their library and draws three cards."
 *   CR 113.6m, 614.1c, 122.6   Gallia, Tragic Host: "Return this card from your graveyard to the battlefield tapped with a +1/+1 counter on her."
 *   CR 509.1b, 208.1, 611.3a   Stature, Size Shifter: "Stature can't be blocked if her power is 1 or less."
 *   CR 614.1c, 614.12, 122.1b  Leatherhead, Swamp Stalker: "Leatherhead enters with a hexproof counter on her."
 *   CR 120.3, 122.6, 603.2     Venus, Torn Between Worlds: "Whenever Venus is dealt damage, put that many +1/+1 counters on her."
 */
import { describe, expect, it } from 'vitest';
import type { DeclareBlockersDecision, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters?.[kind] ?? 0;

/** Answer the decisions that come up (costs automatically, the given objects for a choice, targets, yes); stop at priority. */
function settle(s0: GameState, ids: ObjectId[] = [], targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  return s;
}
/** Activate p1's (non-mana) ability of the object `id`, wherever it is. */
function activate(s: GameState, id: ObjectId, ids: ObjectId[] = []): GameState {
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${nameOf(s, id)}`);
  return settle(act(s, la.action), ids);
}

describe('CR 701.24a, 121.1: "~\'s owner shuffles ~ into their library and draws three cards" (Gandalf, Wandering Wizard)', () => {
  it('Gandalf goes into his owner\'s library, which is shuffled, and his owner draws three cards', () => {
    let s = scenario(['Gandalf, Wandering Wizard', 'Plains'], { p1: { battlefield: ['Gandalf, Wandering Wizard', ...lands('Plains', 6)] } });
    const gandalf = find(s, 'Gandalf, Wandering Wizard', 'battlefield', 'p1');
    const hand = s.zones.hand['p1']!.length;
    const library = s.zones.library['p1']!.length;
    s = resolveAll(activate(s, gandalf));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Gandalf, Wandering Wizard')).toBe(false);
    expect(s.zones.library['p1']!.length).toBe(library + 1 - 3);
    expect(s.zones.hand['p1']!.length).toBe(hand + 3);
    const where = [...s.zones.library['p1']!, ...s.zones.hand['p1']!].filter((id) => nameOf(s, id) === 'Gandalf, Wandering Wizard');
    expect(where.length).toBe(1); // in the library, or drawn again among the three cards
  });

  it('his OWNER shuffles and draws, not the player who controls him (CR 400.3, 108.3)', () => {
    let s = scenario(['Gandalf, Wandering Wizard', 'Plains'], { p1: { battlefield: lands('Plains', 6) }, p2: { battlefield: ['Gandalf, Wandering Wizard'] } });
    // p1 controls p2's Gandalf
    s = tweak(s, (t) => { const g = t.zones.battlefield.find((id) => t.defs[t.objects[id]!.defId]!.name === 'Gandalf, Wandering Wizard')!; t.objects[g]!.controller = 'p1'; });
    const gandalf = find(s, 'Gandalf, Wandering Wizard', 'battlefield', 'p2'); // owned by p2
    expect(s.objects[gandalf]!.controller).toBe('p1');
    const [h1, h2] = [s.zones.hand['p1']!.length, s.zones.hand['p2']!.length];
    const lib2 = s.zones.library['p2']!.length;
    s = resolveAll(activate(s, gandalf));
    expect(s.zones.hand['p1']!.length).toBe(h1);
    expect(s.zones.hand['p2']!.length).toBe(h2 + 3);
    expect(s.zones.library['p2']!.length).toBe(lib2 + 1 - 3);
  });
});

describe('CR 113.6m, 614.1c: "Return ~ from your graveyard to the battlefield tapped with a +1/+1 counter on ~" (Gallia, Tragic Host)', () => {
  it('from the graveyard, exiling another creature card: Gallia returns tapped with a +1/+1 counter', () => {
    let s = scenario(['Gallia, Tragic Host', 'Grizzly Bears', 'Swamp'], { p1: { battlefield: lands('Swamp', 5), graveyard: ['Gallia, Tragic Host', 'Grizzly Bears'] } });
    const gallia = find(s, 'Gallia, Tragic Host', 'graveyard', 'p1');
    const bears = find(s, 'Grizzly Bears', 'graveyard', 'p1');
    s = resolveAll(activate(s, gallia, [bears]));
    const back = find(s, 'Gallia, Tragic Host', 'battlefield', 'p1');
    expect(s.objects[back]!.tapped).toBe(true);
    expect(counters(s, back, '+1/+1')).toBe(1);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Grizzly Bears']);
  });
});

describe('CR 509.1b, 611.3a: "~ can\'t be blocked if ~\'s power is 1 or less" (Stature, Size Shifter)', () => {
  const canBlock = (s: GameState, blocker: ObjectId, attacker: ObjectId): boolean =>
    s.pending?.kind === 'declareBlockers' && (s.pending as DeclareBlockersDecision).candidates.some((c) => c.id === blocker && c.attackers.includes(attacker));
  const attack = (s: GameState, id: ObjectId): GameState =>
    passUntil(declareAttackers(toDeclareAttackers(s), [[id]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers');
  it('with power 1 she can\'t be blocked; with a +1/+1 counter (power 2) she can', () => {
    const s0 = scenario(['Stature, Size Shifter', 'Grizzly Bears'], { p1: { battlefield: ['Stature, Size Shifter'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const stature = find(s0, 'Stature, Size Shifter', 'battlefield', 'p1');
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    expect(Number(getChars(s0, stature)!.power)).toBe(1);
    expect(canBlock(attack(s0, stature), bears, stature)).toBe(false);
    const s1 = tweak(s0, (t) => { t.objects[stature]!.counters = { ...(t.objects[stature]!.counters ?? {}), '+1/+1': 1 }; });
    expect(Number(getChars(s1, stature)!.power)).toBe(2);
    expect(canBlock(attack(s1, stature), bears, stature)).toBe(true);
  });
});

describe('CR 614.1c, 122.1b: "~ enters with a hexproof counter on ~" (Leatherhead, Swamp Stalker)', () => {
  it('she enters with a hexproof counter and has hexproof', () => {
    let s = scenario(['Leatherhead, Swamp Stalker', 'Forest'], { p1: { hand: ['Leatherhead, Swamp Stalker'], battlefield: lands('Forest', 4) } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Leatherhead, Swamp Stalker', 'hand', 'p1') }));
    s = resolveAll(s);
    const l = find(s, 'Leatherhead, Swamp Stalker', 'battlefield', 'p1');
    expect(counters(s, l, 'hexproof')).toBe(1);
    expect(hasKeyword(getChars(s, l)!, 'hexproof')).toBe(true);
  });
});
