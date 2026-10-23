/**
 * FAST5 T66: the parts of the package that are not template data: the hole grammars (target phrases with a total / a shared card type / one for each opponent,
 * "spell or nonland permanent", the graveyard-from-library event), the renderer's wordings, the model fields and their capabilities, and the decision limit of
 * a choice among cards (design 6.3, 6.8; CR 115.1, 601.2c, 608.2d, 603.2c).
 */
import { describe, expect, it } from 'vitest';
import type { Action, Decision } from '../../../src/index';
import { renderGate } from '../../../src/index';
import { chooseObjectsLimitHolds, validateAnswer } from '../../../src/core/validate';
import { IllegalAnswer } from '../../../src/core/errors';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import type { AbilityDef, EffectStep, TargetSpec } from '../../../src/types/ability';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { automated, bare, card } from '../../m5/templates/support';
import { accepts, objTarget, rejects, spell, t, you } from '../../m5/render/build';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Volley', 'Creature — Test', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const specsOf = (f: ReturnType<typeof sorcery>): TargetSpec[] => ((bare(f.abilities)[0] as { effect: { targets: TargetSpec[] } }).effect.targets);

describe('T66 target phrases (parser/holes/object.ts, parser/lower/targets.ts): the rules of the set chosen', () => {
  it('CR 115.1, 601.2c: "up to two target creatures with total mana value 6 or less" is ONE target spec with a group limit', () => {
    const f = creature('When ~ enters, gain control of up to two target creatures with total mana value 6 or less for as long as ~ remains on the battlefield.');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    const spec = specsOf(f)[0]!;
    expect(spec).toMatchObject({ kind: 'object', min: 0, max: 2, groupLimit: { stat: 'manaValue', cmp: { op: '<=', value: 6 } } });
  });
  it('a total of power or toughness is the same shape; a singular phrase has no total', () => {
    const f = sorcery('Gain control of up to three target creatures with total power 5 or less until end of turn.');
    expect(specsOf(f)[0]).toMatchObject({ groupLimit: { stat: 'power', cmp: { op: '<=', value: 5 } } });
    expect(automated(sorcery('Gain control of target creature with total power 5 or less until end of turn.').abilities)).toBe(false);
  });
  it('CR 205.2a, 115.1: "two target nonland permanents that share a card type" is one spec of exactly two with the shared card type', () => {
    const f = sorcery('Exchange control of two target nonland permanents that share a card type.');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(specsOf(f)[0]).toMatchObject({ min: 2, max: 2, sharedCardType: true, filter: { notTypes: ['Land'] } });
    // a single target, "each", and three targets do not share a card type this way
    for (const text of ['Exchange control of target nonland permanent that shares a card type.', 'Exchange control of each nonland permanent that share a card type.', 'Exchange control of three target nonland permanents that share a card type.']) {
      expect(automated(sorcery(text).abilities), text).toBe(false);
    }
  });
  it('CR 115.1, 601.2c, 608.2f: "for each opponent, exile up to one target ... that player controls" is one spec, at most one for each opponent, controlled by an opponent', () => {
    const f = creature('When ~ enters, for each opponent, exile up to one target creature that player controls until ~ leaves the battlefield.');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(specsOf(f)[0]).toMatchObject({ kind: 'object', min: 0, max: 1, perOpponent: true, filter: { controller: 'opponent', types: ['Creature'] } });
    expect(automated(creature('When ~ enters, exile up to one target creature that player controls until ~ leaves the battlefield.').abilities)).toBe(false);
  });
  it('CR 115.1, 612.1: "target spell or nonland permanent" is an object on the stack or a permanent that is not a land', () => {
    const f = sorcery('The owner of target spell or nonland permanent puts it on their choice of the top or bottom of their library.');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(specsOf(f)[0]).toMatchObject({ kind: 'object', filter: { zone: ['stack', 'battlefield'], notTypes: ['Land'] } });
  });
});

describe('T66 CR 603.2c, 400.3: "one or more land cards are put into your graveyard from your library" (parser/holes/event.ts)', () => {
  const trigger = (text: string) => creature(text);
  it('is the zone change library to graveyard of cards you own, one trigger for the batch', () => {
    const f = trigger('Whenever one or more land cards are put into your graveyard from your library, you gain 1 life.');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    const ev = (bare(f.abilities)[0] as { trigger: { batch?: boolean; on: unknown[] } }).trigger;
    expect(ev.batch).toBe(true);
    expect(ev.on).toEqual([{ ev: 'zoneChange', from: 'library', subject: { isCard: true, owner: 'you', types: ['Land'] }, to: 'graveyard' }]);
  });
  it('is not read for another library or graveyard, or another zone', () => {
    for (const text of [
      "Whenever one or more land cards are put into an opponent's graveyard from your library, you gain 1 life.",
      "Whenever one or more land cards are put into your graveyard from an opponent's library, you gain 1 life.",
      'Whenever one or more land cards are put into your graveyard from your hand, you gain 1 life.',
    ]) expect(automated(trigger(text).abilities), text).toBe(false);
  });
});

describe('T66 the renderer (render/*.ts): the wordings of the model', () => {
  const eachNot = (subtypes: string[]): AbilityDef => spell([{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'], not: { subtypes } } }, to: { zone: 'hand' } }]);
  it('CR 205.3m: three or more creature types are a list ("that isn\'t a Kraken, Leviathan, or Serpent"), two are non-X words', () => {
    accepts(eachNot(['Kraken', 'Leviathan', 'Serpent']), "Return each creature that isn't a Kraken, Leviathan, or Serpent to its owner's hand.");
    rejects(eachNot(['Kraken', 'Leviathan', 'Serpent']), "Return each creature that isn't a Kraken, Leviathan, or Merfolk to its owner's hand.");
    accepts(eachNot(['Kraken', 'Leviathan']), "Return all non-Kraken, non-Leviathan creatures to their owners' hands.");
  });
  it('CR 202.3: "mana value 4 or 5" says the numbers once; the same filter with a different number is another wording', () => {
    const mv = (n: number) => ({ anyOf: [{ types: ['Artifact'] }], manaValue: { op: '==' as const, value: n } });
    const def = spell([{ op: 'search', who: you, zone: 'library', filter: { anyOf: [mv(4), mv(5)] }, max: 1, reveal: true, as: 's' }, { op: 'move', what: { ref: 'bound', name: 's' }, to: { zone: 'hand' } }, { op: 'shuffle', who: you }] as EffectStep[]);
    accepts(def, 'Search your library for an artifact card with mana value 4 or 5, reveal it, put it into your hand, then shuffle.');
    rejects(def, 'Search your library for an artifact card with mana value 4 or 6, reveal it, put it into your hand, then shuffle.');
    rejects(def, 'Search your library for an artifact card with mana value 4 and 5, reveal it, put it into your hand, then shuffle.');
  });
  it('CR 510.2: "whose controller was dealt combat damage by ~ this turn" is the history of the permanent\'s controller, said after the other features', () => {
    const def = spell([{ op: 'destroy', what: { ref: 'each', filter: { anyOf: [{ notTypes: ['Land'], manaValue: { op: '==', value: 3 } }], controllerDealtCombatDamageBySourceThisTurn: true } } }]);
    accepts(def, 'Destroy each nonland permanent with mana value 3 whose controller was dealt combat damage by Test Card this turn.');
    rejects(def, 'Destroy each nonland permanent with mana value 3 that was dealt damage by Test Card this turn.');
  });
  it('CR 115.1, 601.2c: a total, a shared card type, and one target for each opponent are said where the model keeps them', () => {
    const limited = spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c', { types: ['Creature'] }, { min: 0, max: 2, groupLimit: { stat: 'manaValue', cmp: { op: '<=', value: 4 } } })]);
    accepts(limited, "Return up to two target creatures with total mana value 4 or less to their owners' hands.");
    rejects(limited, "Return up to two target creatures with total power 4 or less to their owners' hands.");
    const shared = spell([{ op: 'exchange', a: t('c'), b: t('c'), what: 'control' }], [objTarget('c', { notTypes: ['Land'] }, { min: 2, max: 2, sharedCardType: true })]);
    accepts(shared, 'Exchange control of two target nonland permanents that share a card type.');
    rejects(shared, 'Exchange control of two target nonland permanents.');
    const each = spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } }], [objTarget('c', { notTypes: ['Land'], controller: 'opponent' }, { min: 0, max: 1, perOpponent: true })]);
    accepts(each, 'For each opponent, exile up to one target nonland permanent that player controls.');
    rejects(each, 'Exile up to one target nonland permanent an opponent controls.');
  });
  it('CR 701.21a, 110.4: only each opponent or each player can choose a permanent of each type and sacrifice the rest', () => {
    const keep = (who: { ref: 'each'; who: 'opponent' | 'player' | 'otherPlayer' }): AbilityDef => spell([{ op: 'sacrificeChoice', who, filter: {}, count: 1, mode: 'keepEachType' }]);
    accepts(keep({ ref: 'each', who: 'opponent' }), 'Each opponent chooses a permanent they control of each permanent type and sacrifices the rest.');
    accepts(keep({ ref: 'each', who: 'player' }), 'Each player chooses a permanent they control of each permanent type and sacrifices the rest.');
    expect(renderGate(keep({ ref: 'each', who: 'otherPlayer' }), ['Each other player chooses a permanent they control of each permanent type and sacrifices the rest.'], { selfNames: ['Test Card'] }).ok).toBe(false);
  });
});

describe('T66 the model (types/ability.ts) and its capabilities', () => {
  it('names the value forms this build runs, and no other', () => {
    for (const cap of ['op:chooseObjects.groupLimit', 'op:sacrificeChoice.keepEachType', 'feature:target.perOpponent', 'feature:target.sharedCardType', 'feature:target.groupLimit', 'filter:controllerDealtCombatDamageBySourceThisTurn']) {
      expect(ENGINE_CAPABILITIES.has(cap), cap).toBe(true);
    }
  });
  it('a card that uses one of them needs exactly that capability', () => {
    const d = (steps: EffectStep[], targets: TargetSpec[] = []): AbilityDef => spell(steps, targets);
    const caps = (a: AbilityDef): string[] => capabilitiesOfDef(a);
    expect(caps(d([{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { zone: 'graveyard' } }, min: 0, max: 2, as: 'x', groupLimit: { stat: 'manaValue', cmp: { op: '<=', value: 4 } } }]))).toContain('op:chooseObjects.groupLimit');
    expect(caps(d([{ op: 'sacrificeChoice', who: { ref: 'each', who: 'opponent' }, filter: {}, count: 1, mode: 'keepEachType' }]))).toContain('op:sacrificeChoice.keepEachType');
    expect(caps(d([{ op: 'move', what: t('c'), to: { zone: 'exile' } }], [objTarget('c', {}, { perOpponent: true })]))).toContain('feature:target.perOpponent');
    expect(caps(d([{ op: 'exchange', a: t('c'), b: t('c'), what: 'control' }], [objTarget('c', {}, { min: 2, max: 2, sharedCardType: true })]))).toContain('feature:target.sharedCardType');
    expect(caps(d([{ op: 'destroy', what: { ref: 'each', filter: { controllerDealtCombatDamageBySourceThisTurn: true } } }]))).toContain('filter:controllerDealtCombatDamageBySourceThisTurn');
  });
});

describe('CR 608.2d, 115.1: a choice among cards with a limit on their total (core/validate.ts)', () => {
  const decision = (limit: Extract<Decision, { kind: 'chooseObjects' }>['limit']): Decision => ({ id: 'd1', kind: 'chooseObjects', player: 'p1', prompt: 'choose', options: ['a', 'b', 'c'], min: 0, max: 2, ...(limit ? { limit } : {}) });
  const limit = { stat: 'manaValue' as const, op: '<=' as const, value: 4, values: { a: 3, b: 2, c: 1 } };
  const answer = (ids: string[]) => ({ kind: 'chooseObjects' as const, ids });
  const state = {} as never;
  it('keeps the total: 3 and 1 is taken, 3 and 2 is an illegal answer (asked again), the empty choice is fine', () => {
    expect(chooseObjectsLimitHolds(decision(limit) as never, ['a', 'c'])).toBe(true);
    expect(chooseObjectsLimitHolds(decision(limit) as never, ['a', 'b'])).toBe(false);
    expect(() => validateAnswer(state, decision(limit), answer(['a', 'c']))).not.toThrow();
    expect(() => validateAnswer(state, decision(limit), answer([]))).not.toThrow();
    expect(() => validateAnswer(state, decision(limit), answer(['a', 'b']))).toThrow(IllegalAnswer);
  });
  it('a decision without a limit is unchanged', () => {
    expect(() => validateAnswer(state, decision(undefined), answer(['a', 'b']))).not.toThrow();
    expect(chooseObjectsLimitHolds(decision(undefined) as never, ['a', 'b', 'c'])).toBe(true);
  });
  it('compares the total (3 + 1 = 4) with the value 4 by every operator', () => {
    for (const [op, ok] of [['>=', true], ['==', true], ['!=', false], ['<', false], ['>', false]] as const) {
      expect(chooseObjectsLimitHolds(decision({ ...limit, op }) as never, ['a', 'c']), op).toBe(ok);
    }
  });
});

void (undefined as unknown as Action);
