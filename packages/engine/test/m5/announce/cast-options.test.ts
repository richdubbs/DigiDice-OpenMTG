/**
 * WP7: additional and alternative costs read from the card's statics and offered as cast methods (CR 118.8, 118.9, 601.2b, 601.2f), what is recorded in costsPaid,
 * GameObject.cast when the spell becomes a permanent (CR 400.7d, 607.2i), and emerge (CR 702.119).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { announceCond } from '../../../src/actions/announce-cond';
import { act, answer, find, labels, legal, passBoth, reject, scenario } from '../helpers';
import { additionalCost, alternativeCost, castCard, drive, mana, objectTarget, spec, spell, staticAbility } from './support';
import { synth } from '../helpers';

const board = (hand: string[], defs: ReturnType<typeof spell>[], over: { lands?: number; graveyard?: string[]; battlefield?: string[] } = {}): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], {
    p1: { hand, graveyard: over.graveyard ?? [], battlefield: [...Array(over.lands ?? 5).fill('Mountain') as string[], ...(over.battlefield ?? [])] },
    p2: { battlefield: ['Hill Giant'] },
    defs,
  });

const stackOf = (s: GameState) => s.objects[s.zones.stack[0]!]!.stack!;

describe('CR 118.8, 601.2b: optional additional costs from the card\'s additionalCost statics', () => {
  const kicker = staticAbility('Kicker {2}', [additionalCost('kicker', { mana: mana('{2}') }, { optional: true })]);

  it('kicker as a static effect: asked, paid, recorded as kicked and in additional', () => {
    let s = board(['Test Kick'], [spell('Test Kick', '{R}', [], { abilities: [kicker] })]);
    s = castCard(s, 'Test Kick');
    expect(s.pending).toMatchObject({ kind: 'yesNo', prompt: expect.stringContaining('kicker') });
    s = drive(answer(s, { kind: 'yesNo', yes: true }), []);
    expect(stackOf(s).costsPaid).toMatchObject({ kicked: 1, additional: ['kicker'] });
    expect(stackOf(s).costsPaid.manaSpent).toHaveLength(3);
  });

  it('not paid: nothing is recorded; not affordable: the question is skipped and the log says so', () => {
    let s = board(['Test Kick'], [spell('Test Kick', '{R}', [], { abilities: [kicker] })]);
    s = drive(answer(castCard(s, 'Test Kick'), { kind: 'yesNo', yes: false }), []);
    expect(stackOf(s).costsPaid.kicked).toBeUndefined();
    let poor = board(['Test Kick'], [spell('Test Kick', '{R}', [], { abilities: [kicker] })], { lands: 2 });
    poor = castCard(poor, 'Test Kick');
    expect(poor.pending?.kind).toBe('payCost');
    expect(poor.log.some((l) => l.text.includes("can't pay the kicker cost"))).toBe(true);
  });

  it('multikicker: the caster says how many times; kicked counts every payment', () => {
    const multi = staticAbility('Multikicker {1}', [additionalCost('kicker', { mana: mana('{1}') }, { optional: true, repeatable: true })]);
    let s = board(['Test Multi'], [spell('Test Multi', '{R}', [], { abilities: [multi] })]);
    s = castCard(s, 'Test Multi');
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 4 });
    s = drive(answer(s, { kind: 'chooseNumber', n: 3 }), []);
    expect(stackOf(s).costsPaid).toMatchObject({ kicked: 3, additional: ['kicker', 'kicker', 'kicker'] });
    expect(stackOf(s).costsPaid.manaSpent).toHaveLength(4);
  });

  it('buyback and other named costs go to `additional` only', () => {
    const buyback = staticAbility('Buyback {3}', [additionalCost('buyback', { mana: mana('{3}') }, { optional: true })]);
    let s = board(['Test Buyback'], [spell('Test Buyback', '{R}', [], { abilities: [buyback] })]);
    s = drive(answer(castCard(s, 'Test Buyback'), { kind: 'yesNo', yes: true }), []);
    expect(stackOf(s).costsPaid.additional).toEqual(['buyback']);
    expect(stackOf(s).costsPaid.kicked).toBeUndefined();
  });

  it('the kicked spell\'s conditional reading: wasCast sees what was announced', () => {
    let s = board(['Test Kick'], [spell('Test Kick', '{R}', [], { abilities: [kicker] })]);
    s = drive(answer(castCard(s, 'Test Kick'), { kind: 'yesNo', yes: true }), []);
    const env = { s, player: 'p1' as const, sourceId: s.zones.stack[0]!, costsPaid: stackOf(s).costsPaid };
    expect(announceCond(env, { cond: 'wasCast', kicked: true })).toBe(true);
    expect(announceCond(env, { cond: 'wasCast', kicked: 'kicker' })).toBe(true);
    expect(announceCond(env, { cond: 'wasCast', kicked: 'buyback' })).toBe(false);
    expect(announceCond(env, { cond: 'wasCast', kicked: false })).toBe(false);
    // cloud std-tdm / std-blb: an activation restriction reads this turn's history (AnnounceEnv.history, model/forms.ts#turnHistoryAtAnnouncement); last turn's is never read
    expect(announceCond(env, { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' })).toBeUndefined();
  });
});

describe('CR 118.8: a mandatory additional cost is always paid', () => {
  const discard = staticAbility('As an additional cost to cast this spell, discard a card.', [additionalCost(undefined, { other: [{ kind: 'discard', count: 1 }] })]);
  const card = spell('Test Discard Spell', '{R}', [], { abilities: [discard] });

  it('the other card in hand is discarded; with no other card the spell cannot be cast', () => {
    let s = board(['Test Discard Spell', 'Grizzly Bears'], [card]);
    s = drive(castCard(s, 'Test Discard Spell'), []);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Grizzly Bears']);
    expect(stackOf(s).costsPaid.costObjects).toHaveLength(1);
    expect(legal(board(['Test Discard Spell'], [card]), 'p1', 'cast')).toEqual([]);
  });
});

describe('CR 118.9: alternative costs are cast methods', () => {
  const evoke = staticAbility('Evoke {1}', [alternativeCost('evoke', { mana: mana('{1}') })]);
  const elemental = synth({ name: 'Test Elemental', cost: '{3}{R}', type: 'Creature — Elemental', pt: ['3', '3'], abilities: [evoke] });

  it('legalActions lists the normal cast and the evoke cast separately', () => {
    const s = board(['Test Elemental'], [elemental]);
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Test Elemental', 'Cast Test Elemental (evoke)']);
  });

  it('the alternative cost is paid instead of the mana cost and recorded as the method', () => {
    let s = board(['Test Elemental'], [elemental], { lands: 1 });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Test Elemental (evoke)']); // {3}{R} is out of reach, {1} is not
    s = drive(castCard(s, 'Test Elemental', { method: 'evoke' }), []);
    expect(stackOf(s).costsPaid).toMatchObject({ alternative: 'evoke' });
    expect(stackOf(s).costsPaid.manaSpent).toHaveLength(1);
  });

  it('GameObject.cast is written when the spell becomes a permanent (CR 400.7d, 607.2i)', () => {
    let s = board(['Test Elemental'], [elemental]);
    s = drive(castCard(s, 'Test Elemental', { method: 'evoke' }), []);
    s = passBoth(s);
    const perm = find(s, 'Test Elemental', 'battlefield');
    expect(s.objects[perm]!.cast).toMatchObject({ costsPaid: { alternative: 'evoke' }, from: 'hand', via: 'evoke', turn: 1 });
  });

  it('X, kicker and the zone cast from are remembered too', () => {
    const kicker = staticAbility('Kicker {1}', [additionalCost('kicker', { mana: mana('{1}') }, { optional: true })]);
    const hydra = synth({ name: 'Test Hydra', cost: '{X}{R}', type: 'Creature — Hydra', pt: ['2', '2'], abilities: [kicker] });
    let s = board(['Test Hydra'], [hydra]);
    s = castCard(s, 'Test Hydra');
    s = answer(s, { kind: 'yesNo', yes: true });
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }), []);
    s = passBoth(s);
    expect(s.objects[find(s, 'Test Hydra', 'battlefield')]!.cast).toMatchObject({ x: 2, from: 'hand', costsPaid: { kicked: 1, additional: ['kicker'] } });
  });

  it('a permanent that was not cast has no cast record', () => {
    const s = board([], [], { battlefield: ['Grizzly Bears'] });
    expect(s.objects[find(s, 'Grizzly Bears', 'battlefield')]!.cast).toBeUndefined();
  });

  it('an unknown method and the wrong zone are refused with the reason', () => {
    const s = board(['Test Elemental'], [elemental]);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Elemental', 'hand'), method: 'escape' }).message).toContain('Unknown way to cast');
  });
});

describe('CR 118.9, 702.34: flashback is an alternative cost from the graveyard, and the spell is exiled afterwards', () => {
  const flashback = staticAbility('Flashback {2}', [alternativeCost('flashback', { mana: mana('{2}') }, { from: 'graveyard' })]);
  const card = spell('Test Flash Static', '{R}', [], { type: 'Sorcery', abilities: [flashback] });

  it('from the graveyard only, labelled as before', () => {
    let s = board([], [card], { graveyard: ['Test Flash Static'] });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Test Flash Static with flashback']);
    s = drive(castCard(s, 'Test Flash Static', { method: 'flashback', zone: 'graveyard' }), []);
    s = passBoth(s);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Flash Static');
    const inHand = board(['Test Flash Static'], [card]);
    expect(reject(inHand, { type: 'cast', player: 'p1', card: find(inHand, 'Test Flash Static', 'hand'), method: 'flashback' }).message).toContain('Flashback');
  });
});

describe('CR 118.9: AlternativeCostDef.when restricts when the cost may be used', () => {
  const free = staticAbility('If you have no other cards in hand, you may cast this for {0}.', [
    alternativeCost('free', {}, { when: { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, op: '<=', right: 1 } }),
  ]);
  const card = spell('Test Last Card', '{3}{R}{R}{R}', [], { abilities: [free] });

  it('usable with the card alone in hand, not with another card', () => {
    const alone = board(['Test Last Card'], [card], { lands: 0 });
    expect(labels(alone, 'p1')).toContain('Cast Test Last Card (free)');
    const two = board(['Test Last Card', 'Grizzly Bears'], [card], { lands: 0 });
    expect(labels(two, 'p1')).not.toContain('Cast Test Last Card (free)');
    expect(reject(two, { type: 'cast', player: 'p1', card: find(two, 'Test Last Card', 'hand'), method: 'free' }).message).toContain("can't be cast with free");
  });

  it('a condition the engine cannot read is not guessed: the method is not offered', () => {
    const odd = staticAbility('x', [alternativeCost('odd', {}, { when: { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' } })]); // cloud std-tdm: this turn's history is read
    const s = board(['Test Odd Alt'], [spell('Test Odd Alt', '{R}', [], { abilities: [odd] })]);
    expect(labels(s, 'p1')).not.toContain('Cast Test Odd Alt (odd)');
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Odd Alt', 'hand'), method: 'odd' }).message).toContain("can't check the condition");
  });
});

describe('CR 702.119: emerge — sacrifice a creature, the total cost is reduced by its mana value', () => {
  const emerge = staticAbility('Emerge {2}{R}', [alternativeCost('emerge', { mana: mana('{2}{R}'), other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })]);
  const horror = synth({ name: 'Test Horror', cost: '{6}{R}', type: 'Creature — Horror', pt: ['6', '6'], abilities: [emerge] });

  it('with one Mountain and a Hill Giant (mana value 4) the {2}{R} emerge cost becomes {R}', () => {
    let s = board(['Test Horror'], [horror], { lands: 1, battlefield: ['Hill Giant'] });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Test Horror (emerge)']);
    s = castCard(s, 'Test Horror', { method: 'emerge' });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', options: [find(s, 'Hill Giant', 'battlefield')] });
    s = drive(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Hill Giant', 'battlefield')] }), []);
    expect(stackOf(s).costsPaid.manaSpent).toHaveLength(1);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Hill Giant');
  });

  it('without a creature to sacrifice the emerge cast is not offered', () => {
    const s = board(['Test Horror'], [horror], { lands: 3 });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual([]);
  });

  it('a spell cast the usual way (no method) is not affected by the emerge machinery: targets and payment as ever', () => {
    const t = spell('Test Plain Target', '{R}', [spec({})]);
    let s = board(['Test Plain Target'], [t]);
    s = castCard(s, 'Test Plain Target');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield'))] });
    expect(act(drive(s, []), { type: 'pass', player: 'p1' }).pending?.player).toBe('p2');
  });
});
