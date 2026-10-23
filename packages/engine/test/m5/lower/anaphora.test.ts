/**
 * WP17: anaphora by the unique-candidate rule (design 6.4): zero, one and two compatible antecedents, the compatibility checks (sort, number, head noun,
 * participle), event roles of the trigger, and pronouns in sentences no template parsed. Wordings are synthetic (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compatible, resolveAnaphor, scanAnaphors } from '../../../src/parser/lower/anaphora';
import { targetMention } from '../../../src/parser/lower/mentions';
import { eventMentions } from '../../../src/parser/lower/scope';
import type { Mention } from '../../../src/parser/lower/types';
import { lex } from '../../../src/parser/holes';
import { EXTRA, card, face, options } from './support';

const it1 = { sort: 'object', number: 'singular', text: 'it' } as const;
const tCreature = targetMention({ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }, 0);
const tArtifact = targetMention({ id: 't1', kind: 'object', min: 1, max: 1, text: 'target artifact', filter: { types: ['Artifact'] } }, 0);
const tPlayer = targetMention({ id: 't2', kind: 'player', min: 1, max: 1, text: 'target player', players: { who: 'any' } }, 0);
const tTwo = targetMention({ id: 't3', kind: 'object', min: 0, max: 2, text: 'up to two target creatures', filter: { types: ['Creature'] } }, 0);

describe('WP17 design 6.4: the unique-candidate rule', () => {
  it('zero compatible candidates: unresolved', () => {
    expect(resolveAnaphor(it1, [])).toEqual({ ok: false, count: 0 });
    expect(resolveAnaphor(it1, [tPlayer])).toEqual({ ok: false, count: 0 });
  });
  it('one compatible candidate: resolved to it', () => {
    const r = resolveAnaphor(it1, [tCreature, tPlayer]);
    expect(r.ok && r.mention.ref).toEqual({ ref: 'target', id: 't0' });
  });
  it('two compatible candidates: unresolved (no "most recent" tie-break)', () => {
    expect(resolveAnaphor(it1, [tCreature, tArtifact])).toEqual({ ok: false, count: 2 });
  });
  it('the head noun decides: "that creature" picks the creature among a creature and an artifact', () => {
    const r = resolveAnaphor({ sort: 'object', number: 'singular', head: 'creature', text: 'that creature' }, [tCreature, tArtifact]);
    expect(r.ok && r.mention.ref).toEqual({ ref: 'target', id: 't0' });
  });
  it('grammatical number: "those creatures" needs a plural mention, "it" a singular one', () => {
    expect(compatible({ sort: 'set', number: 'plural', head: 'creature', text: 'those creatures' }, tTwo)).toBe(true);
    expect(compatible({ sort: 'set', number: 'plural', head: 'creature', text: 'those creatures' }, tCreature)).toBe(false);
    expect(compatible(it1, tTwo)).toBe(false);
  });
  it('players: "that player" matches a target player, never an object; "their" may be a single player (Oracle\'s singular they)', () => {
    expect(compatible({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }, tPlayer)).toBe(true);
    expect(compatible({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }, tCreature)).toBe(false);
    expect(compatible({ sort: 'any', number: 'plural', text: 'their' }, tPlayer)).toBe(true);
  });
  it('participles: "the exiled card" needs a mention that was exiled', () => {
    const exiled: Mention = { ...tCreature, heads: [...tCreature.heads, 'card'], verbs: ['exiled'] };
    const a = { sort: 'object', number: 'singular', head: 'card', participle: 'exiled', text: 'the exiled card' } as const;
    expect(compatible(a, exiled)).toBe(true);
    expect(compatible(a, tCreature)).toBe(false);
  });
  it('CR 603.6, 120.1: event roles are candidates; a damage event has two objects, so a bare "it" is unresolved there', () => {
    const zc = eventMentions([{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }], false, []);
    expect((resolveAnaphor(it1, zc) as { ok: true; mention: Mention }).mention.ref).toEqual({ ref: 'event', role: 'subject' });
    const dmg = eventMentions([{ ev: 'damage', source: { types: ['Creature'] }, recipient: { object: { types: ['Creature'] } } }], false, []);
    expect(resolveAnaphor(it1, dmg)).toEqual({ ok: false, count: 2 });
  });
});

describe('WP17 pronouns in sentences no template parsed (design 6.7)', () => {
  it('scanAnaphors finds pronouns and demonstratives, not relative clauses', () => {
    expect(scanAnaphors(lex("Those creatures don't untap during their controller's next untap step.")).map((a) => a.text)).toEqual(['those creatures', 'their']);
    expect(scanAnaphors(lex('Creatures that attacked this turn get +1/+0.')).map((a) => a.text)).toEqual([]);
    expect(scanAnaphors(lex('Return the exiled card and that Goblin. It gains haste.')).map((a) => a.text)).toEqual(['the exiled card', 'that goblin', 'it']);
    expect(scanAnaphors(lex('You gain that much life.')).map((a) => a.sort)).toEqual(['number']);
  });
});

describe('WP17 anaphora end to end (synthetic cards)', () => {
  it('one candidate: "it" after a target is the target', () => {
    const f = face(card('Wisp Bind', 'Instant', 'Tap target creature. Put a +1/+1 counter on it.'));
    const steps = (f.abilities[0] as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps).toEqual([
      { op: 'tap', what: { ref: 'target', id: 't0' } },
      { op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 1 },
    ]);
  });
  it('design 3.1 rule 4 (WP21): "it" after the target was exiled is never the stale target handle (CR 400.7), so "return it" does not silently do nothing', () => {
    const f = face(card('Wisp Banish', 'Instant', "Exile target creature. Return it to the battlefield under its owner's control."));
    expect(JSON.stringify(f.abilities)).not.toContain('{"op":"move","what":{"ref":"target","id":"t0"},"to":{"zone":"battlefield"');
    // explicit (WP21 review): the lowering binds "it" to the exile step. FAST2 T10: the renderer names a move's binding ("it", "that card": the same thing
    // in its new zone, render/steps-zones.ts#bindMoved), so the gate accepts the sentence and the return acts on the exiled card
    const steps = (f.abilities[0] as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps).toEqual([
      { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'moved' },
      { op: 'move', what: { ref: 'bound', name: 'moved' }, to: { zone: 'battlefield', controller: 'owner' } },
    ]);
  });
  it('two candidates: the sentence is manual and contagious (whole program one manual step, targets kept)', () => {
    const f = face(card('Twin Banish', 'Instant', "Exile target creature and target artifact. Return it to the battlefield under its owner's control."));
    const eff = (f.abilities[0] as { effect: { targets: unknown[]; steps: { op: string }[] } }).effect;
    expect(eff.targets).toHaveLength(2);
    expect(eff.steps.map((s) => s.op)).toEqual(['manual']);
    expect(f.diagnostics.some((d) => d.code === 'unbound-reference')).toBe(true);
  });
  it('zero candidates: "that player" with no player to refer to is manual; nothing is left to automate, so the spell is a manual ability', () => {
    const f = face(card('Odd Gift', 'Sorcery', 'Draw two cards. That player loses 1 life.'), options(EXTRA));
    expect(f.abilities.map((a) => [a.kind, (a as { shape?: string }).shape])).toEqual([['manual', 'spell']]);
    expect(f.diagnostics.find((d) => d.code === 'unbound-reference')?.message).toMatch(/no compatible antecedent/);
  });
  it('CR 603.2: an event role is the antecedent of "that player" in a triggered ability', () => {
    const f = face(card('Tax Wisp', 'Enchantment', 'Whenever an opponent draws a card, that player loses 1 life.'));
    expect((f.abilities[0] as { effect: { steps: unknown[] } }).effect.steps).toEqual([{ op: 'loseLife', who: { ref: 'event', role: 'player' }, amount: 1 }]);
  });
});
