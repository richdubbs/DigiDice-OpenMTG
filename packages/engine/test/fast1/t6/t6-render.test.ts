/**
 * T6 (FAST1 wave, family C): the renderer additions the T6 templates and their sentences need for the exact render gate (design 6.8, G6). Each case states
 * what the renderer accepts for a JSON and which wording it must NOT accept, so the gate never excuses a different meaning. Wordings are synthetic
 * (design 6.10).
 *
 *   CR 701.21a        "sacrifices a creature of their choice" (another player chooses what they sacrifice)
 *   CR 111.1, 110.5b  "create a tapped Treasure token" beside "... that's tapped"
 *   CR 701.9a         "each player discards their hand"; "discard all the cards in your hand"; "then draw that many cards" (resultCount of that discard)
 *   CR 701.26a        "you may tap or untap target creature" (may tap, otherwise may untap the same object)
 *   CR 110.4          the six permanent types read "permanent card"
 *   CR 109.4          "each creature your opponents control"
 *   (word order)      "a creature card with mana value 3 or less from your graveyard"
 */
import { describe, it } from 'vitest';
import type { AbilityDef, EffectStep, ObjectFilter } from '../../../src/index';
import { accepts, bound, draw, objTarget, playerTarget, rejects, self, spell, t, you } from '../../m5/render/build';

const each = (filter: ObjectFilter) => ({ ref: 'each' as const, filter });

describe('CR 701.21a: "of their choice"', () => {
  const edict = (who: unknown, targets = [playerTarget('t0')]): AbilityDef =>
    spell([{ op: 'sacrificeChoice', who, filter: { types: ['Creature'] }, count: 1 } as EffectStep], targets);
  it('CR 701.21a: another player\'s sacrifice reads with or without "of their choice"', () => {
    accepts(edict(t('t0')), 'Target player sacrifices a creature of their choice.');
    accepts(edict(t('t0')), 'Target player sacrifices a creature.');
    accepts(edict({ ref: 'each', who: 'opponent' }, []), 'Each opponent sacrifices a creature of their choice.');
  });
  it('CR 701.21a: never "of your choice" for their sacrifice, and never "of their choice" for your own', () => {
    rejects(edict(t('t0')), 'Target player sacrifices a creature of your choice.');
    rejects(edict(you, []), 'Sacrifice a creature of their choice.');
  });
});

describe('CR 111.1, 110.5b: a tapped token', () => {
  const token = (extra: Record<string, unknown>): AbilityDef =>
    spell([{ op: 'createToken', who: you, count: 1, token: { predefined: 'Treasure' }, ...extra } as EffectStep]);
  it('CR 110.5b: "create a tapped Treasure token" and "a Treasure token that\'s tapped" read the same tapped token', () => {
    accepts(token({ tapped: true }), 'Create a tapped Treasure token.');
    accepts(token({ tapped: true }), "Create a Treasure token that's tapped.");
  });
  it('CR 110.5b: an untapped token never reads "tapped"; a tapped and attacking one never reads only "tapped"', () => {
    rejects(token({}), 'Create a tapped Treasure token.');
    rejects(token({ tapped: true, attacking: true }), 'Create a tapped Treasure token.');
  });
  it('CR 111.1: "tapped" comes before the whole description, which is kept', () => {
    const elf = spell([{ op: 'createToken', who: you, count: 1, token: { power: 1, toughness: 1, colors: ['G'], types: ['Creature'], subtypes: ['Elf', 'Warrior'] }, tapped: true } as EffectStep]);
    accepts(elf, 'Create a tapped 1/1 green Elf Warrior creature token.');
    rejects(elf, 'Create a tapped 1/1 green Elf creature token.');
    rejects(elf, 'Create a 1/1 green tapped Elf Warrior creature token.');
  });
});

describe('CR 701.9a: discarding a hand', () => {
  const discardHand = (who: unknown, as?: string): EffectStep => ({ op: 'discard', who, count: 'hand', ...(as ? { as } : {}) } as EffectStep);
  it('CR 701.9a: "each player discards their hand", never "each player\'s hand"', () => {
    accepts(spell([discardHand({ ref: 'each', who: 'player' })]), 'Each player discards their hand.');
    rejects(spell([discardHand({ ref: 'each', who: 'player' })]), "Each player discards each player's hand.");
  });
  it('CR 701.9a: "discard all the cards in your hand" is "discard your hand"', () => {
    accepts(spell([discardHand(you)]), 'Discard all the cards in your hand.');
    accepts(spell([discardHand(you)]), 'Discard your hand.');
  });
  it('CR 608.2c: "then draw that many cards" only for the number this discard discarded', () => {
    const winds = spell([discardHand(you, 'd'), { op: 'draw', who: you, count: { q: 'resultCount', step: 'd' } } as EffectStep]);
    accepts(winds, 'Discard all the cards in your hand, then draw that many cards.');
    rejects(winds, 'Discard all the cards in your hand, then draw seven cards.');
    rejects(spell([discardHand(you), draw(7)]), 'Discard all the cards in your hand, then draw that many cards.');
  });
});

describe('CR 701.26a: "you may tap or untap"', () => {
  const toggle = (a: string, b: string, inner: Record<string, unknown> = {}): AbilityDef => spell([{
    op: 'may', who: you, do: [{ op: 'tap', what: t(a) }], otherwise: [{ op: 'may', who: you, do: [{ op: 'untap', what: t(b) }], ...inner }],
  } as EffectStep], a === b ? [objTarget(a)] : [objTarget(a), objTarget(b)]);
  it('CR 701.26a: tap, otherwise untap, of the same object reads "you may tap or untap target creature"', () => {
    accepts(toggle('t0', 't0'), 'You may tap or untap target creature.');
  });
  it('CR 701.26a: two different objects, or an untap that is not optional, are never "tap or untap"', () => {
    rejects(toggle('t0', 't1'), 'You may tap or untap target creature.');
    const forced = spell([{ op: 'may', who: you, do: [{ op: 'tap', what: t('t0') }], otherwise: [{ op: 'untap', what: t('t0') }] } as EffectStep], [objTarget('t0')]);
    rejects(forced, 'You may tap or untap target creature.');
    const plain = spell([{ op: 'may', who: you, do: [{ op: 'tap', what: t('t0') }] } as EffectStep], [objTarget('t0')]);
    rejects(plain, 'You may tap or untap target creature.');
  });
});

describe('CR 110.4: "permanent card"', () => {
  const PERMANENT = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
  const back = (types: string[]): AbilityDef =>
    spell([{ op: 'move', what: t('t0'), to: { zone: 'hand' } } as EffectStep], [objTarget('t0', { types, zone: 'graveyard', owner: 'you', isCard: true } as ObjectFilter)]);
  it('CR 110.4: the six permanent types read "permanent card"', () => {
    accepts(back(PERMANENT), 'Return target permanent card from your graveyard to your hand.');
  });
  it('CR 110.4: five of them are not "permanent card"', () => {
    rejects(back(PERMANENT.filter((x) => x !== 'Battle')), 'Return target permanent card from your graveyard to your hand.');
  });
});

describe('CR 109.4: "your opponents control"', () => {
  const burn = (det: 'each'): AbilityDef =>
    spell([{ op: 'damage', source: self, to: { ref: det, filter: { types: ['Creature'], controller: 'opponent' } }, amount: 1 } as EffectStep]);
  it('CR 109.4: "each creature your opponents control" and "each creature an opponent controls" are the same set', () => {
    accepts(burn('each'), '~ deals 1 damage to each creature your opponents control.');
    accepts(burn('each'), '~ deals 1 damage to each creature an opponent controls.');
  });
  it('CR 109.4: never "you control"', () => {
    rejects(burn('each'), '~ deals 1 damage to each creature you control.');
  });
});

describe('word order: "with mana value N or less" before or after the zone', () => {
  const reanimate = (filter: ObjectFilter): AbilityDef =>
    spell([{ op: 'move', what: t('t0'), to: { zone: 'battlefield', controller: you } } as EffectStep], [objTarget('t0', filter)]);
  const F = { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true, manaValue: { op: '<=', value: 3 } } as ObjectFilter;
  it('"a creature card with mana value 3 or less from your graveyard" reads both ways', () => {
    accepts(reanimate(F), 'Return target creature card with mana value 3 or less from your graveyard to the battlefield.');
    accepts(reanimate(F), 'Return target creature card from your graveyard with mana value 3 or less to the battlefield.');
  });
  it('the comparison is never dropped or changed by the reordering', () => {
    rejects(reanimate(F), 'Return target creature card with mana value 4 or less from your graveyard to the battlefield.');
    rejects(reanimate({ ...F, manaValue: undefined } as ObjectFilter), 'Return target creature card with mana value 3 or less from your graveyard to the battlefield.');
  });
});

describe('the bounce choice (chooseObjects + move, render/fold.ts)', () => {
  it('CR 608.2d: "return a creature you control to its owner\'s hand" is a choice by you, not a target', () => {
    const a = spell([
      { op: 'chooseObjects', who: you, from: each({ types: ['Creature'], controller: 'you' }), min: 1, max: 1, as: 'b' } as EffectStep,
      { op: 'move', what: bound('b'), to: { zone: 'hand' } } as EffectStep,
    ]);
    accepts(a, "Return a creature you control to its owner's hand.");
    rejects(a, "Return target creature you control to its owner's hand.");
    rejects(a, "Return a creature to its owner's hand.");
  });
});
