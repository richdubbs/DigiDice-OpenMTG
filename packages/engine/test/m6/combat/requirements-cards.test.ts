/**
 * R1 (M6-7a): the capability `restrict:mustIfAble` is advertised for the combat requirements a creature's own text imposes (CR 508.1d, 509.1c).
 * M6-7: the other-creature forms (`feature:require.other.*`: Lure, Prized Unicorn, Hunt Down) are advertised too; a requirement about a non-combat action
 * (`feature:require.<action>`) is not.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities, type StaticAbilityDef } from '../../../src/index';
import { ORACLE, card } from './cards';

const must = (action: string, extra: Record<string, unknown> = {}): StaticAbilityDef => ({ kind: 'static', text: 'test', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'mustIfAble', action, ...extra } as never] });

describe('R1 capability: restrict:mustIfAble (CR 508.1d, 509.1c)', () => {
  it('CR 508.1d, 509.1c: restrict:mustIfAble is advertised, and a creature\'s own requirement needs nothing else', () => {
    expect(ENGINE_CAPABILITIES.has('restrict:mustIfAble')).toBe(true);
    for (const action of ['attack', 'block', 'beBlocked']) expect(missingCapabilities(must(action), ENGINE_CAPABILITIES), action).toEqual([]);
  });

  it('CR 508.1d, 509.1c (M6-7): a requirement that names another creature is advertised; one about another action stays missing (never falsely automated)', () => {
    for (const action of ['attack', 'block', 'beBlocked']) expect(ENGINE_CAPABILITIES.has(`feature:require.other.${action}`), action).toBe(true);
    expect(missingCapabilities(must('block', { other: { types: ['Creature'] } }), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(must('attack', { other: { types: ['Planeswalker'] } }), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(must('beBlocked', { other: { subtypes: ['Wall'] } }), ENGINE_CAPABILITIES)).toEqual([]);
    // a filter the statics can't evaluate keeps its card manual (rfilter:<field>)
    expect(missingCapabilities(must('block', { other: { dealtDamageThisTurn: true } }), ENGINE_CAPABILITIES)).toEqual(['rfilter:dealtDamageThisTurn']);
    expect(missingCapabilities(must('untap'), ENGINE_CAPABILITIES)).toEqual(['feature:require.untap']);
    // the "can't" forms keep their own names
    expect(missingCapabilities({ kind: 'static', text: 't', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block', other: { types: ['Creature'] } }] }, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it.each([
    ['Goblin Brigand', 'full'], ['Bloodrock Cyclops', 'full'], ['Juggernaut', 'full'], ["Gaea's Protector", 'full'], ['Inescapable Brute', 'full'], ['Razorgrass Screen', 'full'], ['Bloodshed Fever', 'full'],
  ])('CR 508.1d / 509.1c: %s compiles %s', (name, level) => {
    const d = card(name);
    expect(d.automation?.level).toBe(level);
    expect(d.automation?.unsupported ?? []).not.toContain('restrict:mustIfAble');
  });

  it.each(['Lure', 'Prized Unicorn', 'Hunt Down', 'Elvish Bard', 'Rampant Elephant', 'Trumpeting Armodon', 'Alluring Scent', 'Bloodscent', 'Taunting Challenge'])(
    'CR 509.1c (M6-7): %s compiles full (the other-creature forms)', (name) => {
      const d = card(name);
      expect(d.automation?.level).toBe('full');
      expect(d.automation?.unsupported ?? []).toEqual([]);
    },
  );

  it.each(['Boiling Blood', 'Heckling Fiends', 'Courtly Provocateur', 'Culling Mark', 'Nacatl Hunt-Pride', 'Irresistible Prey', 'Goldenhide Ox', 'Bident of Thassa'])(
    'CR 508.1d / 509.1c, 611.2a (M6-7): %s compiles full (a requirement with a duration)', (name) => {
      expect(card(name).automation?.level).toBe('full');
    },
  );

  it('CR 509.1c (M6-7): Hunt Down is one block requirement of its first target, naming its second', () => {
    const steps = card('Hunt Down').faces[0]!.abilities.flatMap((a) => (a.kind === 'spell' ? a.effect.steps : []));
    expect(steps).toEqual([expect.objectContaining({ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'mustIfAble', action: 'block', other: { is: { ref: 'target', id: 't1' } } }] })]);
  });

  // R1 review: `beBlocked` without `other` means "blocked by at least one creature" (Gaea's Protector, enforced). Lure's "all creatures able to block ...
  // do so" is a different requirement (one `block` per able creature with `other`, M6-7): it must never reach that shape, or it would be falsely full.
  it.each(['Lure', 'Prized Unicorn'])('CR 509.1c: %s never compiles to the plain beBlocked requirement (that shape means one blocker suffices)', (name) => {
    const restricts = card(name).faces.flatMap((f) => f.abilities).flatMap((a) => (a.kind === 'static' ? a.effects : []));
    expect(restricts.filter((e) => e.s === 'restrict' && e.mode === 'mustIfAble' && e.action === 'beBlocked' && e.other === undefined)).toEqual([]);
    // M6-7: it is one `block` requirement of each creature, naming the lured creature
    expect(restricts).toEqual([{ s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'] } }, mode: 'mustIfAble', action: 'block', other: { is: name === 'Lure' ? { ref: 'attachedTo' } : { ref: 'self' } } }]);
  });

  const cache = process.env['OPENMTG_CACHE_DIR'];
  const jsonl = cache ? path.join(cache, 'cards.jsonl') : '';
  it.runIf(jsonl !== '' && existsSync(jsonl))('CR 508.1d, 509.1c test cards: the inline Oracle fields equal the local index', () => {
    const want = new Set(Object.keys(ORACLE));
    for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
      if (!line || want.size === 0) continue;
      const c = JSON.parse(line) as Record<string, unknown>;
      const name = c['name'] as string;
      if (!want.has(name)) continue;
      want.delete(name);
      const o = ORACLE[name]! as unknown as Record<string, unknown>;
      for (const k of ['mana_cost', 'type_line', 'power', 'toughness', 'oracle_text']) expect(c[k], `${name}.${k}`).toEqual(o[k]);
    }
    expect([...want]).toEqual([]);
  });
});
