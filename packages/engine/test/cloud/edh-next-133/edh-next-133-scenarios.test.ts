/**
 * edh-next-133 (must-finish round, group copies; code edhn133): played scenarios of each new reading, with synthetic cards (invented names) and the negative cases.
 * CR cites checked against the Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt).
 *
 *   CR 611.3d, 400.7b, 601.2a, 702.74a  "Elemental permanent spells you cast from your hand gain evoke {4} as you cast them." (Ashling, the Limitless)
 *   CR 611.3d, 400.7b, 601.2a, 702.175a "Creature spells you cast gain offspring {2} as you cast them." (Zinnia, Valley's Voice)
 *   CR 603.7a, 707.2, 122.6, 107.1a, 608.2h  "When ~ dies, if it had two or more +1/+1 counters on it, create a token that's a copy of it at the beginning of the next end step. The token enters with half that many +1/+1 counters on it, rounded down." (Ochre Jelly)
 *   CR 614.12a, 707.5, 707.9e, 122.6  "As ~ enters, you may exile two creature cards from graveyards. If you do, it enters as a copy of one of those cards with a number of additional +1/+1 counters on it equal to the power of the other card." (The Mimeoplasm)
 *   CR 707.9a, 603.12, 707.2, 122.1  "At the beginning of combat on your turn, you may pay {E}{E}. When you do, ~ becomes a copy of another target creature you control, except it has this ability and ..." (Aurora Shifter)
 *   CR 707.10, 707.10c, 115.9b, 608.2c, 702.193a  "Whenever you cast your second spell each turn, copy that spell if it targets a permanent or player, and you may choose new targets for the copy. If you don't copy a spell this way, draw a card." (Shiko and Narset, Unified)
 *   CR 707.2, 608.2c, 205.1b, 122.1  "Whenever ~ attacks, put a flood counter on another target creature or land. If it's a creature, it becomes a copy of ~. If it's a land, it becomes an Island in addition to its other types." (The Flood of Mars)
 *   CR 208.1, 613.4b, 608.2h, 707.2, 707.9a  "Whenever ~ deals combat damage to a player, draw cards equal to its base power." / "{1}{U}, Exile another nontoken artifact creature you control: ~ becomes a copy of the exiled creature, except it has ..." (Curie, Emergent Intelligence)
 *   CR 707.12, 707.10a, 608.2d, 608.2g, 607.2a  "At the beginning of your upkeep, you may copy a card exiled with ~. If you do, you may cast the copy without paying its mana cost." (Panoptic Mirror)
 *   CR 115.9c, 707.10, 603.2  "Whenever a player casts a spell that targets only a single creature other than ~, you may copy that spell. The copy targets ~." (Ivy, Gleeful Spellthief)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, find, findAll, life, pass, reject, scenario } from '../../m3/scenario';
import { card, pt, resolveAll, settle } from '../cmd3/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toStep } from '../../m4/helpers';

const onBf = (s: GameState, name: string, who: 'p1' | 'p2' = 'p1'): number => findAll(s, name, 'battlefield', who).length;

describe('CR 611.3d, 400.7b, 601.2a, 702.74a: "Elemental permanent spells you cast from your hand gain evoke {4} as you cast them."', () => {
  const ASH = card('Test Ash Sage', 'Creature — Elemental Sorcerer', 'Elemental permanent spells you cast from your hand gain evoke {4} as you cast them.', ['2', '2']);
  const BIG = card('Test Big Elemental', 'Creature — Elemental', 'When this creature enters, you gain 3 life.', ['6', '6'], '{7}');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', ['6', '6'], '{7}');
  const BOLT = card('Test Elemental Bolt', 'Kindred Instant — Elemental', 'You gain 1 life.', undefined, '{7}');
  const UNMAKE = card('Test Unmake', 'Instant', 'Destroy target creature.');
  const DEFS = [ASH, BIG, OGRE, BOLT, UNMAKE];
  const setup = (bf: string[], hand: string[] = ['Test Big Elemental', 'Test Big Ogre', 'Test Elemental Bolt', 'Test Unmake'], gy: string[] = []): GameState =>
    scenario(['Plains'], { defs: DEFS, p1: { battlefield: [...bf, 'Plains', 'Plains', 'Plains', 'Plains'], hand, graveyard: gy } });
  it('is automated', () => {
    expect(ASH.automation.level).toBe('full');
  });
  it('an Elemental creature card cast from the hand for its evoke cost {4}: it enters, its own enters ability triggers, and it is sacrificed (evoke)', () => {
    let s = setup(['Test Ash Sage']);
    const l0 = life(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1'), method: 'evoke' })));
    expect(onBf(s, 'Test Big Elemental')).toBe(0);
    expect(findAll(s, 'Test Big Elemental', 'graveyard', 'p1').length).toBe(1);
    expect(life(s, 'p1')).toBe(l0 + 3);
  });
  it('ruling 2025-11-17: Ashling leaves after the spell was cast for its evoke cost: the permanent still has evoke and is sacrificed', () => {
    let s = setup(['Test Ash Sage']);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1'), method: 'evoke' }));
    // the source leaves while the spell is on the stack: its caster destroys it in response
    const ash = find(s, 'Test Ash Sage', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unmake', 'hand', 'p1') }), { targets: [{ kind: 'object', id: ash }] });
    s = settle(pass(pass(s)));
    expect(onBf(s, 'Test Big Elemental')).toBe(0); // the Elemental spell is still on the stack
    expect(findAll(s, 'Test Ash Sage', 'graveyard', 'p1').length).toBe(1);
    s = resolveAll(s);
    expect(onBf(s, 'Test Big Elemental')).toBe(0);
  });
  it('negative: a spell cast for its mana cost stays on the battlefield', () => {
    let s = setup(['Test Ash Sage', 'Plains', 'Plains', 'Plains']);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1') })));
    expect(onBf(s, 'Test Big Elemental')).toBe(1);
  });
  it('negative: without the static ability the Elemental has no evoke cost', () => {
    const s = setup([]);
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1'), method: 'evoke' });
  });
  it('negative: a non-Elemental creature, and an Elemental instant (not a permanent spell), get no evoke cost', () => {
    const s = setup(['Test Ash Sage']);
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Ogre', 'hand', 'p1'), method: 'evoke' });
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Elemental Bolt', 'hand', 'p1'), method: 'evoke' });
  });
  it('the whole card: the evoked Elemental is sacrificed, so the second ability makes a token copy of it with haste (the token has no evoke: the grant is not copiable, CR 707.2)', () => {
    const FULL = card('Test Limitless Sage', 'Legendary Creature — Elemental Sorcerer', "Elemental permanent spells you cast from your hand gain evoke {4} as you cast them.\nWhenever you sacrifice a nontoken Elemental, create a token that's a copy of it. The token gains haste until end of turn. At the beginning of your next end step, sacrifice it unless you pay {W}{U}{B}{R}{G}.", ['4', '4']);
    let s = scenario(['Plains'], { defs: [...DEFS, FULL], p1: { battlefield: ['Test Limitless Sage', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Big Elemental'] } });
    expect(FULL.automation.level).toBe('full');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1'), method: 'evoke' })));
    const tok = findAll(s, 'Test Big Elemental', 'battlefield', 'p1');
    expect(tok.length).toBe(1);
    expect(s.objects[tok[0]!]!.kind).toBe('token');
    expect(findAll(s, 'Test Big Elemental', 'graveyard', 'p1').length).toBe(1);
  });
  it("negative: an opponent's static ability does not give your spells evoke", () => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Big Elemental'] }, p2: { battlefield: ['Test Ash Sage'] } });
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1'), method: 'evoke' });
  });
  it('one evoke: the permanent has one sacrifice trigger, not one from the static and one from the stored grant', () => {
    let s = setup(['Test Ash Sage']);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Elemental', 'hand', 'p1'), method: 'evoke' }));
    s = settle(pass(pass(s))); // the creature spell resolves: its enters ability and the evoke trigger go on the stack
    expect(onBf(s, 'Test Big Elemental')).toBe(1);
    expect(s.zones.stack.length).toBe(2);
  });
});

describe('CR 611.3d, 400.7b, 601.2a, 702.175a: "Creature spells you cast gain offspring {2} as you cast them."', () => {
  const BARD = card('Test Valley Bard', 'Creature — Bird Bard', 'Creature spells you cast gain offspring {2} as you cast them.', ['1', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3'], '{1}');
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
  const UNMAKE = card('Test Unmake', 'Instant', 'Destroy target creature.');
  const DEFS = [BARD, BEAR, RITE, UNMAKE];
  const setup = (bf: string[], hand: string[] = ['Test Bear', 'Test Rite', 'Test Unmake']): GameState =>
    scenario(['Plains'], { defs: DEFS, p1: { battlefield: [...bf, 'Plains', 'Plains', 'Plains'], hand } });
  const bears = (s: GameState): { cards: number; tokens: string[] } => {
    const ids = findAll(s, 'Test Bear', 'battlefield', 'p1');
    return { cards: ids.filter((id) => s.objects[id]!.kind !== 'token').length, tokens: ids.filter((id) => s.objects[id]!.kind === 'token').map((id) => pt(s, id)) };
  };
  it('is automated', () => {
    expect(BARD.automation.level).toBe('full');
  });
  it('the offspring cost paid: the creature enters and a 1/1 token copy of it is created', () => {
    let s = setup(['Test Valley Bard']);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }), { yes: true }));
    expect(bears(s)).toEqual({ cards: 1, tokens: ['1/1'] });
  });
  it('negative: the offspring cost declined: no token', () => {
    let s = setup(['Test Valley Bard']);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }), { yes: false }));
    expect(bears(s)).toEqual({ cards: 1, tokens: [] });
  });
  it('the source leaves while the spell is on the stack: the permanent still has offspring (CR 611.3d, 400.7b) and the token is created', () => {
    let s = setup(['Test Valley Bard']);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }), { yes: true });
    const bard = find(s, 'Test Valley Bard', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unmake', 'hand', 'p1') }), { targets: [{ kind: 'object', id: bard }] });
    s = settle(pass(pass(s)));
    expect(findAll(s, 'Test Valley Bard', 'graveyard', 'p1').length).toBe(1);
    s = resolveAll(s);
    expect(bears(s)).toEqual({ cards: 1, tokens: ['1/1'] });
  });
  it('negative: without the static ability there is no offspring cost to pay', () => {
    let s = setup([]);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }), { yes: true }));
    expect(bears(s)).toEqual({ cards: 1, tokens: [] });
  });
  it('negative: a noncreature spell does not gain offspring (no extra cost asked, nothing copied)', () => {
    let s = setup(['Test Valley Bard']);
    const l0 = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rite', 'hand', 'p1') });
    expect(s.pending?.kind === 'yesNo' || s.pending?.kind === 'chooseOption').toBe(false);
    s = resolveAll(settle(s));
    expect(life(s, 'p1')).toBe(l0 + 1);
  });
});

describe('CR 115.9c, 707.10, 603.2: "Whenever a player casts a spell that targets only a single creature other than ~, you may copy that spell. The copy targets ~."', () => {
  const IVY = card('Test Spellthief', 'Creature — Faerie Rogue', 'Flying\nWhenever a player casts a spell that targets only a single creature other than ~, you may copy that spell. The copy targets ~.', ['1', '1']);
  const GROW = card('Test Growth', 'Instant', 'Target creature gets +2/+2 until end of turn.');
  const BIGGROW = card('Test Big Growth', 'Instant', 'Target creature with power 4 or greater gets +2/+2 until end of turn.');
  const TWIN = card('Test Twin Growth', 'Instant', 'Two target creatures each get +1/+1 until end of turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
  const DEFS = [IVY, GROW, BIGGROW, TWIN, BEAR, OGRE];
  const setup = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Spellthief', 'Test Bear'], hand: ['Test Growth', 'Test Big Growth', 'Test Twin Growth'] }, p2: { battlefield: ['Test Ogre'] } });
  it('is automated', () => {
    expect(IVY.automation.level).toBe('full');
  });
  it("a spell aimed at another creature (any player's): the copy targets the Faerie and resolves first; the original still resolves", () => {
    let s = setup();
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Growth', 'hand', 'p1') }), { targets: [{ kind: 'object', id: ogre }] }), { yes: true });
    expect(pt(s, find(s, 'Test Spellthief', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, ogre)).toBe('6/6');
  });
  it('"you may": declined, no copy', () => {
    let s = setup();
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Growth', 'hand', 'p1') }), { targets: [{ kind: 'object', id: ogre }] }), { yes: false });
    expect(pt(s, find(s, 'Test Spellthief', 'battlefield', 'p1'))).toBe('1/1');
    expect(pt(s, ogre)).toBe('6/6');
  });
  it('negative: a spell that targets the Faerie itself does not trigger', () => {
    let s = setup();
    const ivy = find(s, 'Test Spellthief', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Growth', 'hand', 'p1') }), { targets: [{ kind: 'object', id: ivy }] });
    expect(s.zones.stack.length).toBe(1);
    s = resolveAll(s, { yes: true });
    expect(pt(s, ivy)).toBe('3/3');
  });
  it('negative: a spell with two different target creatures does not trigger', () => {
    let s = setup();
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Growth', 'hand', 'p1') }), { targets: [{ kind: 'object', id: ogre }, { kind: 'object', id: bear }] });
    expect(s.zones.stack.length).toBe(1);
  });
  it('ruling 2022-09-09: the Faerie is not a legal target of the spell: no copy is created, the original resolves', () => {
    let s = setup();
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Growth', 'hand', 'p1') }), { targets: [{ kind: 'object', id: ogre }] }), { yes: true });
    expect(pt(s, find(s, 'Test Spellthief', 'battlefield', 'p1'))).toBe('1/1');
    expect(pt(s, ogre)).toBe('6/6');
    expect(s.pending?.kind).toBe('priority');
  });
});

describe('CR 603.7a, 707.2, 122.6, 107.1a, 608.2h: "When ~ dies, if it had two or more +1/+1 counters on it, create a token that\'s a copy of it at the beginning of the next end step. The token enters with half that many +1/+1 counters on it, rounded down."', () => {
  const JELLY = card('Test Jelly', 'Creature — Ooze', "Trample\nThis creature enters with X +1/+1 counters on it.\nSplit — When this creature dies, if it had two or more +1/+1 counters on it, create a token that's a copy of it at the beginning of the next end step. The token enters with half that many +1/+1 counters on it, rounded down.", ['1', '1'], '{X}{G}'); // 1/1 (not 0/0) so it survives the scenario's setup without counters
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const DEFS = [JELLY, KILL];
  const withJelly = (n: number): GameState => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Jelly'], hand: ['Test Kill', 'Test Kill'] } });
    const id = find(s, 'Test Jelly', 'battlefield', 'p1');
    return { ...s, objects: { ...s.objects, [id]: { ...s.objects[id]!, counters: { '+1/+1': n } } } };
  };
  const killJelly = (s0: GameState): GameState => {
    const id = findAll(s0, 'Test Jelly', 'battlefield', 'p1')[0]!;
    return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), { targets: [{ kind: 'object', id }] }));
  };
  const jellies = (s: GameState): number[] => findAll(s, 'Test Jelly', 'battlefield', 'p1').map((id) => s.objects[id]!.counters['+1/+1'] ?? 0);
  it('is automated', () => {
    expect(JELLY.automation.level).toBe('full');
  });
  it('ruling 2021-07-23: five counters: at the next end step a token copy enters with two; when it dies, the next one enters with one', () => {
    let s = killJelly(withJelly(5));
    expect(jellies(s)).toEqual([]); // not before the end step
    s = resolveAll(toStep(s, 'end'));
    expect(jellies(s)).toEqual([2]);
    expect(s.objects[findAll(s, 'Test Jelly', 'battlefield', 'p1')[0]!]!.kind).toBe('token');
    const turn = s.turn.number;
    s = killJelly(s); // the token dies in this end step: its own trigger waits for the next end step (the next turn's)
    expect(jellies(s)).toEqual([]);
    s = resolveAll(passUntil(s, (x) => x.turn.number === turn + 1 && x.turn.step === 'end' && x.pending?.kind === 'priority', 'the next end step'));
    expect(jellies(s)).toEqual([1]);
  });
  it('negative: one counter (fewer than two): no token', () => {
    let s = killJelly(withJelly(1));
    s = resolveAll(toStep(s, 'end'));
    expect(jellies(s)).toEqual([]);
  });
  it('three counters, rounded down: the token enters with one', () => {
    let s = killJelly(withJelly(3));
    s = resolveAll(toStep(s, 'end'));
    expect(jellies(s)).toEqual([1]);
  });
});

describe('CR 614.12a, 707.5, 707.9e, 122.6: "As ~ enters, you may exile two creature cards from graveyards. If you do, it enters as a copy of one of those cards with a number of additional +1/+1 counters on it equal to the power of the other card."', () => {
  const PLASM = card('Test Plasm', 'Legendary Creature — Ooze', 'As ~ enters, you may exile two creature cards from graveyards. If you do, it enters as a copy of one of those cards with a number of additional +1/+1 counters on it equal to the power of the other card.', ['0', '0']);
  const GIANT = card('Test Giant', 'Creature — Giant', 'When this creature enters, you gain 3 life.', ['5', '5'], '{5}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{2}');
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'This creature enters with three +1/+1 counters on it.', ['0', '0'], '{3}');
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
  const DEFS = [PLASM, GIANT, BEAR, HYDRA, RITE];
  const setup = (mine: string[], theirs: string[]): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Plasm'], graveyard: mine }, p2: { graveyard: theirs } });
  const castPlasm = (s0: GameState, copyName?: string, yes = true): GameState => {
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Plasm', 'hand', 'p1') });
    const pick = copyName === undefined ? undefined : Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]?.name === copyName).map((o) => o.id);
    return resolveAll(settle(s), { yes, ...(pick ? { objects: pick } : {}) });
  };
  it('is automated', () => {
    expect(PLASM.automation.level).toBe('full');
  });
  it('rulings 2011-09-22: two cards from different graveyards; it enters as a copy of the chosen one (its enters ability triggers) with counters equal to the power of the other; both are exiled', () => {
    let s = setup(['Test Bear'], ['Test Giant']);
    const l0 = life(s, 'p1');
    s = castPlasm(s, 'Test Giant');
    const ids = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind !== 'token' && s.defs[s.objects[id]!.defId]?.name === 'Test Plasm');
    expect(ids.length).toBe(1);
    expect(pt(s, ids[0]!)).toBe('7/7');
    expect(s.objects[ids[0]!]!.counters['+1/+1']).toBe(2);
    expect(life(s, 'p1')).toBe(l0 + 3);
    expect(findAll(s, 'Test Giant', 'exile', 'p2').length + findAll(s, 'Test Bear', 'exile', 'p1').length).toBe(2);
  });
  it('the other way round: a copy of the Bear with five counters', () => {
    let s = setup(['Test Bear'], ['Test Giant']);
    s = castPlasm(s, 'Test Bear');
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]?.name === 'Test Plasm')!;
    expect(pt(s, id)).toBe('7/7');
    expect(s.objects[id]!.counters['+1/+1']).toBe(5);
  });
  it('ruling 2011-09-22: a copy of a card that enters with counters gets those counters too', () => {
    let s = setup(['Test Bear', 'Test Hydra'], []);
    s = castPlasm(s, 'Test Hydra');
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]?.name === 'Test Plasm')!;
    expect(s.objects[id]!.counters['+1/+1']).toBe(5);
  });
  it('ruling 2011-09-22: only one creature card in graveyards: nothing is exiled, it enters as itself (a 0/0 that dies)', () => {
    let s = setup(['Test Bear', 'Test Rite'], []);
    s = castPlasm(s);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Plasm', 'graveyard', 'p1').length).toBe(1);
  });
  it('"you may": declined, nothing is exiled and it enters as itself', () => {
    let s = setup(['Test Bear'], ['Test Giant']);
    s = castPlasm(s, undefined, false);
    expect(findAll(s, 'Test Giant', 'graveyard', 'p2').length).toBe(1);
    expect(findAll(s, 'Test Plasm', 'graveyard', 'p1').length).toBe(1);
  });
});

describe('CR 707.9a, 603.12, 707.2: "At the beginning of combat on your turn, you may pay {E}{E}. When you do, ~ becomes a copy of another target creature you control, except it has this ability and \"Whenever ~ deals combat damage to a player, you get that many {E}.\""', () => {
  const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Whenever this creature deals combat damage to a player, you get that many {E}.\nAt the beginning of combat on your turn, you may pay {E}{E}. When you do, this creature becomes a copy of another target creature you control, except it has this ability and "Whenever this creature deals combat damage to a player, you get that many {E}."', ['1', '3']);
  const GIANT = card('Test Giant', 'Creature — Giant', 'When this creature enters, you gain 3 life.', ['5', '5'], '{5}');
  const DEFS = [SHIFTER, GIANT];
  const setup = (energy: number): GameState => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Shifter', 'Test Giant'] } });
    return { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, counters: { ...p.counters, energy } } : p)) };
  };
  const energy = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.counters['energy'] ?? 0;
  const atCombat = (s0: GameState, yes: boolean): GameState => {
    const giant = find(s0, 'Test Giant', 'battlefield', 'p1');
    return resolveAll(passUntil(s0, (x) => x.turn.step === 'beginCombat', 'the beginning of combat'), { yes, targets: [{ kind: 'object', id: giant }] });
  };
  it('is automated', () => {
    expect(SHIFTER.automation.level).toBe('full');
  });
  it('paid: it becomes a copy of the target (no enters ability: it does not enter, ruling 2024-06-07) and keeps both abilities; the energy is spent', () => {
    let s = setup(3);
    const l0 = life(s, 'p1');
    s = atCombat(s, true);
    const id = find(s, 'Test Shifter', 'battlefield', 'p1');
    expect(pt(s, id)).toBe('5/5');
    expect(energy(s)).toBe(1);
    expect(life(s, 'p1')).toBe(l0);
    const text = JSON.stringify(getChars(s, id)!.abilities.map((a) => a.def.text));
    expect(text).toContain('you may pay {E}{E}');
    expect(text).toContain('you get that many {E}');
  });
  it('the copied "this ability" is the beginning-of-combat triggered ability itself (not the reflexive "When you do" ability)', () => {
    const s = atCombat(setup(4), true);
    const id = find(s, 'Test Shifter', 'battlefield', 'p1');
    const trig = getChars(s, id)!.abilities.filter((a) => a.def.kind === 'triggered').map((a) => a.def as { trigger: { on: { ev: string; step?: string }[] }; text: string });
    expect(trig.some((t) => t.trigger.on[0]!.ev === 'step' && t.trigger.on[0]!.step === 'beginCombat' && /you may pay \{E\}\{E\}\. When you do/.test(t.text))).toBe(true);
  });
  it('negative: declined, it stays itself and keeps the energy', () => {
    let s = setup(3);
    s = atCombat(s, false);
    expect(pt(s, find(s, 'Test Shifter', 'battlefield', 'p1'))).toBe('1/3');
    expect(energy(s)).toBe(3);
  });
  it('negative: with one energy it can\'t pay, nothing happens', () => {
    let s = setup(1);
    s = atCombat(s, true);
    expect(pt(s, find(s, 'Test Shifter', 'battlefield', 'p1'))).toBe('1/3');
    expect(energy(s)).toBe(1);
  });
});

describe('CR 707.10, 707.10c, 115.9b, 608.2c: "Whenever you cast your second spell each turn, copy that spell if it targets a permanent or player, and you may choose new targets for the copy. If you don\'t copy a spell this way, draw a card."', () => {
  const SN = card('Test Unified Sage', 'Legendary Creature — Human Spirit Dragon', "Flying, vigilance\nFlurry — Whenever you cast your second spell each turn, copy that spell if it targets a permanent or player, and you may choose new targets for the copy. If you don't copy a spell this way, draw a card.", ['3', '5']);
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
  const RITE2 = card('Test Second Rite', 'Instant', 'You gain 2 life.');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.');
  const DEFS = [SN, RITE, RITE2, ZAP, NEGATE];
  const setup = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Unified Sage'], hand: ['Test Rite', 'Test Second Rite', 'Test Zap', 'Test Negate'], library: ['Plains', 'Plains', 'Plains'] } });
  const cast = (s: GameState, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), { targets, yes: false });
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is automated', () => {
    expect(SN.automation.level).toBe('full');
  });
  it('the second spell targets a player: it is copied (same target unless changed); no card is drawn', () => {
    let s = resolveAll(cast(setup(), 'Test Rite'));
    const l0 = life(s, 'p2');
    s = cast(s, 'Test Zap', [{ kind: 'player', id: 'p2' }]);
    const h0 = hand(s);
    s = resolveAll(s, { yes: false });
    expect(life(s, 'p2')).toBe(l0 - 2);
    expect(hand(s)).toBe(h0);
  });
  it('ruling 2025-04-04: the spell is countered before the trigger resolves: the copy is still made', () => {
    let s = resolveAll(cast(setup(), 'Test Rite'));
    const l0 = life(s, 'p2');
    s = cast(s, 'Test Zap', [{ kind: 'player', id: 'p2' }]);
    const zap = s.zones.stack.find((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Zap')!;
    s = cast(s, 'Test Negate', [{ kind: 'object', id: zap }]); // the third spell: no trigger
    s = settle(pass(pass(s))); // Negate resolves: Zap is countered
    expect(findAll(s, 'Test Zap', 'graveyard', 'p1').length).toBe(1);
    s = resolveAll(s, { yes: false });
    expect(life(s, 'p2')).toBe(l0 - 1);
  });
  it('negative: the second spell has no target: no copy, draw a card', () => {
    let s = resolveAll(cast(setup(), 'Test Rite'));
    const h0 = hand(s);
    s = resolveAll(cast(s, 'Test Second Rite'));
    expect(hand(s)).toBe(h0 - 1 + 1);
  });
  it('negative: the second spell targets only a spell (not a permanent or player): no copy, draw a card', () => {
    // the Negate is the SECOND spell of the turn, aimed at the first spell still on the stack
    let u = setup();
    u = cast(u, 'Test Second Rite'); // first spell, on the stack
    const rite = u.zones.stack.find((id) => u.defs[u.objects[id]!.defId]?.name === 'Test Second Rite')!;
    const h0 = hand(u);
    u = cast(u, 'Test Negate', [{ kind: 'object', id: rite }]); // the second spell: it targets a spell only
    expect(u.zones.stack.length).toBe(3); // Rite, Negate and the trigger
    u = resolveAll(u, { yes: false });
    expect(hand(u)).toBe(h0 - 1 + 1); // Negate left the hand, one card drawn
    expect(findAll(u, 'Test Second Rite', 'graveyard', 'p1').length).toBe(1); // countered once (no copy of Negate)
  });
  it('negative: the first spell of the turn does not trigger', () => {
    const s = cast(setup(), 'Test Zap', [{ kind: 'player', id: 'p2' }]);
    expect(s.zones.stack.length).toBe(1);
  });
});

describe('CR 707.2, 608.2c, 205.1b: "Whenever ~ attacks, put a flood counter on another target creature or land. If it\'s a creature, it becomes a copy of ~. If it\'s a land, it becomes an Island in addition to its other types."', () => {
  const FLOOD = card('Test Flood', 'Creature — Alien Zombie Horror', "Islandwalk\nWhenever this creature attacks, put a flood counter on another target creature or land. If it's a creature, it becomes a copy of this creature. If it's a land, it becomes an Island in addition to its other types.", ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const ARBOR = card('Test Arbor', 'Land Creature — Forest Dryad', '', ['1', '1']);
  const DEFS = [FLOOD, BEAR, ARBOR];
  const setup = (): GameState => scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Flood'] }, p2: { battlefield: ['Test Bear', 'Forest', 'Test Arbor'] } });
  const attackAt = (s0: GameState, id: string): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Flood', 'battlefield', 'p1')]]);
    s = settle(s, { targets: [{ kind: 'object', id }] });
    return resolveAll(s);
  };
  it('is automated', () => {
    expect(FLOOD.automation.level).toBe('full');
  });
  it('a creature target gets the counter and becomes a copy of it', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = attackAt(s0, bear);
    expect(s.objects[bear]!.counters['flood']).toBe(1);
    expect(getChars(s, bear)!.name).toBe('Test Flood');
    expect(pt(s, bear)).toBe('3/3');
  });
  it('a land target gets the counter and is an Island in addition to its other types (still a Forest)', () => {
    const s0 = setup();
    const forest = find(s0, 'Forest', 'battlefield', 'p2');
    const s = attackAt(s0, forest);
    expect(s.objects[forest]!.counters['flood']).toBe(1);
    expect(getChars(s, forest)!.subtypes).toEqual(expect.arrayContaining(['Forest', 'Island']));
  });
  it('ruling 2023-10-13: a land creature becomes a copy, which is not a land, so it does not become an Island', () => {
    const s0 = setup();
    const arbor = find(s0, 'Test Arbor', 'battlefield', 'p2');
    const s = attackAt(s0, arbor);
    const c = getChars(s, arbor)!;
    expect(c.name).toBe('Test Flood');
    expect(c.types).not.toContain('Land');
    expect(c.subtypes).not.toContain('Island');
  });
});

describe('CR 208.1, 613.4b, 608.2h, 707.2: "Whenever ~ deals combat damage to a player, draw cards equal to its base power." and "{1}{U}, Exile another nontoken artifact creature you control: ~ becomes a copy of the exiled creature, except it has ..."', () => {
  const CURIE = card('Test Curie', 'Legendary Artifact Creature — Robot', 'Whenever this creature deals combat damage to a player, draw cards equal to its base power.\n{1}{U}, Exile another nontoken artifact creature you control: This creature becomes a copy of the exiled creature, except it has "Whenever this creature deals combat damage to a player, draw cards equal to its base power."', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['4', '4'], '{4}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const UNMAKE = card('Test Unmake', 'Instant', 'Destroy target creature.');
  const DEFS = [CURIE, GOLEM, BEAR, UNMAKE];
  const setup = (bf: string[] = []): GameState => scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Curie', 'Island', 'Island', ...bf], hand: ['Test Unmake'], library: Array(10).fill('Island') } });
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  const hitWithCurie = (s0: GameState): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Curie', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.zones.stack.length > 0, 'blockers or the trigger', 20);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    return passUntil(s, (x) => x.zones.stack.length > 0, 'the combat damage trigger', 20);
  };
  it('is automated', () => {
    expect(CURIE.automation.level).toBe('full');
  });
  it('draws cards equal to its base power, not its power (a +1/+1 counter does not count, ruling 2024-03-08)', () => {
    let s = setup();
    const id = find(s, 'Test Curie', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [id]: { ...s.objects[id]!, counters: { '+1/+1': 1 } } } };
    s = hitWithCurie(s);
    const h0 = handSize(s);
    s = resolveAll(s);
    expect(handSize(s)).toBe(h0 + 2);
  });
  it('ruling 2024-03-08: it left the battlefield before the trigger resolved: its base power as it last existed there', () => {
    let s = hitWithCurie(setup());
    const id = find(s, 'Test Curie', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unmake', 'hand', 'p1') }), { targets: [{ kind: 'object', id }] });
    const h0 = handSize(s);
    s = settle(pass(pass(s))); // Unmake resolves first
    expect(findAll(s, 'Test Curie', 'graveyard', 'p1').length).toBe(1);
    s = resolveAll(s);
    expect(handSize(s)).toBe(h0 + 2);
  });
  it('the activated ability: it becomes a copy of the exiled creature with the draw ability, and draws by the copy\'s base power', () => {
    let s = setup(['Test Golem']);
    const golem = find(s, 'Test Golem', 'battlefield', 'p1');
    const id = find(s, 'Test Curie', 'battlefield', 'p1');
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' }), { objects: [golem] }));
    expect(findAll(s, 'Test Golem', 'exile', 'p1').length).toBe(1);
    expect(getChars(s, id)!.name).toBe('Test Golem');
    expect(pt(s, id)).toBe('4/4');
    s = hitWithCurie(s);
    const h0 = handSize(s);
    s = resolveAll(s);
    expect(handSize(s)).toBe(h0 + 4);
  });
  it('negative: no other nontoken artifact creature (only a non-artifact Bear): the ability can\'t be activated', () => {
    const s = setup(['Test Bear']);
    const id = find(s, 'Test Curie', 'battlefield', 'p1');
    reject(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' });
  });
});

describe('CR 707.12, 608.2d, 608.2g, 607.2a: "At the beginning of your upkeep, you may copy a card exiled with ~. If you do, you may cast the copy without paying its mana cost."', () => {
  const MIRROR = card('Test Mirror', 'Artifact', 'Imprint — {X}, {T}: You may exile an instant or sorcery card with mana value X from your hand.\nAt the beginning of your upkeep, you may copy a card exiled with this artifact. If you do, you may cast the copy without paying its mana cost.');
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', undefined, '{1}{R}');
  const GIFT = card('Test Gift', 'Sorcery', 'You gain 3 life.', undefined, '{1}{W}');
  const DEFS = [MIRROR, SHOCK, GIFT];
  const imprinted = (names: string[]): GameState => {
    // the imprint ability itself, once per card (X = 2, the mana value of both cards), on two turns of its controller when there are two cards
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Mirror', 'Plains', 'Plains'], hand: names, library: Array(10).fill('Plains') }, p2: { library: Array(10).fill('Plains') } });
    names.forEach((n, i) => {
      if (i > 0) {
        const t0 = s.turn.number;
        for (let guard = 0; guard < 300 && !(s.turn.number === t0 + 2 && s.turn.step === 'main1' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); guard++) {
          const d = s.pending;
          s = d?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [] }) : d?.kind === 'priority' ? pass(s) : settle(s, { yes: false });
        }
      }
      const mirror = find(s, 'Test Mirror', 'battlefield', 'p1');
      const card0 = find(s, n, 'hand', 'p1');
      let t = act(s, { type: 'activate', player: 'p1', source: mirror, ability: 'p:0:0' });
      if (t.pending?.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: 2 });
      s = resolveAll(settle(t, { objects: [card0], yes: true }), { objects: [card0], yes: true });
      expect(findAll(s, n, 'exile', 'p1').length).toBe(1);
    });
    return s;
  };
  // answer every decision until the stack is empty, picking the first spell offered when the copies to cast are chosen
  const castFirst = (s0: GameState, targets: { kind: 'object' | 'player'; id: string }[]): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: string[] }).options.slice(0, 1) });
      else if (d?.kind === 'priority') s = pass(s);
      else s = settle(s, { yes: true, targets });
    }
    return s;
  };
  const toMyUpkeep = (s0: GameState): GameState => passUntil(s0, (x) => x.turn.number === s0.turn.number + 2 && x.turn.step === 'upkeep' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'), 'my next upkeep', 200);
  it('is automated', () => {
    expect(MIRROR.automation.level).toBe('full');
  });
  it('a copy of the imprinted card is cast without paying its mana cost; the card stays imprinted', () => {
    let s = toMyUpkeep(imprinted(['Test Shock']));
    const l0 = life(s, 'p2');
    s = castFirst(s, [{ kind: 'player', id: 'p2' }]);
    expect(life(s, 'p2')).toBe(l0 - 2);
    expect(findAll(s, 'Test Shock', 'exile', 'p1').length).toBe(1);
  });
  it('ruling 2005-03-01: the copy and its cast are optional: declined, nothing happens', () => {
    let s = toMyUpkeep(imprinted(['Test Shock']));
    const l0 = life(s, 'p2');
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) {
      const d = s.pending;
      s = d?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [] }) : d?.kind === 'priority' ? pass(s) : settle(s, { yes: false });
    }
    expect(life(s, 'p2')).toBe(l0);
  });
  it('ruling 2004-12-01: two imprinted cards, one trigger: only one of them is copied', () => {
    let s = toMyUpkeep(imprinted(['Test Shock', 'Test Gift']));
    const l0 = life(s, 'p1');
    const l2 = life(s, 'p2');
    s = castFirst(s, [{ kind: 'player', id: 'p2' }]);
    expect((life(s, 'p1') - l0) + (l2 - life(s, 'p2'))).toBeGreaterThan(0);
    expect(life(s, 'p1') - l0 === 3 && l2 - life(s, 'p2') === 2).toBe(false);
  });
});

describe('review fix (CR 707.2, 608.2h): a delayed token copy of a creature that was a copy copies what it copied, as it last existed on the battlefield', () => {
  const JELLY = card('Test Jelly', 'Creature — Ooze', "Trample\nThis creature enters with X +1/+1 counters on it.\nSplit — When this creature dies, if it had two or more +1/+1 counters on it, create a token that's a copy of it at the beginning of the next end step. The token enters with half that many +1/+1 counters on it, rounded down.", ['1', '1'], '{X}{G}');
  const CLONE = card('Test Clone', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', ['0', '0']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('a Clone of the Jelly with four counters dies: at the end step a Jelly token with two counters', () => {
    let s = scenario(['Plains'], { defs: [JELLY, CLONE, KILL], p1: { battlefield: ['Test Jelly'], hand: ['Test Clone', 'Test Kill'] } });
    const jelly = find(s, 'Test Jelly', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Clone', 'hand', 'p1') }), { objects: [jelly] });
    const cl = find(s, 'Test Clone', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [cl]: { ...s.objects[cl]!, counters: { '+1/+1': 4 } } } };
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill', 'hand', 'p1') }), { targets: [{ kind: 'object', id: cl }] }));
    s = resolveAll(toStep(declareAttackers(toDeclareAttackers(s), []), 'end'));
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks.map((id) => getChars(s, id)!.name)).toEqual(['Test Jelly']);
    expect(s.objects[toks[0]!]!.counters['+1/+1']).toBe(2);
  });
});
