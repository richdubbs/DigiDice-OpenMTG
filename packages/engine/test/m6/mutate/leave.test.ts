/**
 * M6-9 (m6 design 3.7): a merged permanent leaves the battlefield as one permanent and its components are each put into the appropriate zone (CR 730.3): one
 * "dies", every card a card put into a graveyard; the replacement chosen for the one event applies to every component (CR 730.3d); the token cases of CR
 * 730.3e; an effect that finds the new object finds every card (CR 730.3c).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
const ANTHEM = 'Glorious Anthem';
import { BLINK, DEATH_WATCH, DOOM, ELVES, BEARS, GEMRAZER, GRAVE_WATCH, LEYLINE, OVER, UNDER, act, drive, find, mutate, resolveTop, table, target, tokenOf } from './support';

/** The mutate trigger's target when the opponent has Glorious Anthem (so that Gemrazer's trigger leaves Leyline of the Void alone). */
const anthem = (s: GameState) => (s.zones.battlefield.some((x) => s.objects[x]!.defId === ANTHEM) ? [target(find(s, ANTHEM, 'battlefield', 'p2'))] : []);
const named = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const merged = (over: boolean, opts: Parameters<typeof table>[1] = {}, field: string[] = [ELVES]): { s: GameState; id: string } => {
  const s = table(field, { hand: ['Test Doom', ...(opts.hand ?? [])], defs: [DOOM, ...(opts.defs ?? [])], ...(opts.theirs ? { theirs: opts.theirs } : {}) });
  const id = find(s, field[0]!, 'battlefield');
  return { s: resolveTop(mutate(s, id), [over ? OVER : UNDER, ...anthem(s)]), id };
};
/** Empty the stack, then cast `spell` (from p1's hand, targeting `id`) and resolve it. */
function castAt(s: GameState, id: string, spell = 'Test Doom'): GameState {
  let t = s;
  while (t.zones.stack.length > 0) t = resolveTop(t);
  const card = t.zones.hand.p1!.find((x) => t.objects[x]!.defId === spell)!;
  return resolveTop(drive(act(t, { type: 'cast', player: 'p1', card }), [target(id)]));
}
const kill = (s: GameState, id: string): GameState => castAt(s, id);

describe('CR 730.3: one permanent leaves the battlefield, each component is put into the appropriate zone', () => {
  it('destroyed: Gemrazer and Llanowar Elves are both put into the graveyard as cards; nothing is left on the battlefield', () => {
    const { s: s0, id } = merged(true);
    const s = kill(s0, id);
    expect(s.zones.battlefield.some((x) => [GEMRAZER, ELVES].includes(s.objects[x]!.defId))).toBe(false);
    expect(named(s, s.zones.graveyard.p1!.filter((x) => [GEMRAZER, ELVES].includes(s.objects[x]!.defId)))).toEqual([GEMRAZER, ELVES]);
    expect(s.zones.graveyard.p1!.every((x) => s.objects[x]!.components === undefined)).toBe(true);
    expect(s.log.some((l) => l.rules?.includes('CR 730.3'))).toBe(true);
  });

  it('"whenever a creature dies" triggers once; "whenever a creature card is put into a graveyard from anywhere" twice (CR 730.3, as CR 712.21)', () => {
    const { s: s0, id } = merged(true, { defs: [DEATH_WATCH, GRAVE_WATCH] }, [ELVES, 'Test Death Watcher', 'Test Grave Watcher']);
    let s = s0;
    while (s.zones.stack.length > 0) s = resolveTop(s);
    const life = s.players[0]!.life;
    const card = s.zones.hand.p1!.find((x) => s.objects[x]!.defId === 'Test Doom')!;
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card }), [target(id)]));
    expect(s.zones.stack).toHaveLength(3);
    while (s.zones.stack.length > 0) s = resolveTop(s);
    expect(s.players[0]!.life).toBe(life + 10 + 2);
  });

  it('CR 730.3d: Leyline of the Void (an opponent\'s) applies to the one event: both cards are exiled', () => {
    const { s: s0, id } = merged(false, { theirs: [LEYLINE, ANTHEM] });
    const s = kill(s0, id);
    expect(named(s, s.zones.exile.filter((x) => [GEMRAZER, ELVES].includes(s.objects[x]!.defId)))).toEqual([GEMRAZER, ELVES]);
    expect((s.zones.graveyard.p1 ?? []).filter((x) => [GEMRAZER, ELVES].includes(s.objects[x]!.defId))).toEqual([]);
  });
});

describe('CR 730.3e: replacement effects that apply to cards only', () => {
  it('a token-topped merged permanent with a card component and Leyline of the Void: the token goes to the graveyard, the card component is exiled', () => {
    let s = table([], { hand: ['Test Doom'], theirs: [LEYLINE, ANTHEM], more: [BEARS], defs: [DOOM] });
    const tok = tokenOf(s, BEARS);
    s = resolveTop(mutate(tok.s, tok.id), [UNDER, ...anthem(tok.s)]); // Gemrazer under the token: the merged permanent is a token (CR 730.2d)
    expect(s.objects[tok.id]!.kind).toBe('token');
    s = kill(s, tok.id);
    expect(s.zones.exile.filter((x) => s.objects[x]!.defId === GEMRAZER)).toHaveLength(1);
    expect(Object.values(s.objects).some((o) => o.defId === BEARS && o.kind === 'token')).toBe(false); // the token ceased to exist (SBA 704.5d)
    expect((s.zones.graveyard.p1 ?? []).some((x) => s.objects[x]!.defId === GEMRAZER)).toBe(false);
  });

  it('a card-topped merged permanent with a token component and Leyline of the Void: every component is exiled (the token ceases to exist there)', () => {
    let s = table([], { hand: ['Test Doom'], theirs: [LEYLINE, ANTHEM], more: [BEARS], defs: [DOOM] });
    const tok = tokenOf(s, BEARS);
    s = resolveTop(mutate(tok.s, tok.id), [OVER, ...anthem(tok.s)]); // Gemrazer on top: a card (CR 730.2d)
    expect(s.objects[tok.id]!.kind).toBe('card');
    s = kill(s, tok.id);
    expect(s.zones.exile.filter((x) => s.objects[x]!.defId === GEMRAZER)).toHaveLength(1);
    expect(Object.values(s.objects).some((o) => o.defId === BEARS && o.kind === 'token')).toBe(false);
    expect((s.zones.graveyard.p1 ?? []).some((x) => s.objects[x]!.defId === GEMRAZER)).toBe(false); // (Leyline exiled Test Doom too)
  });

  it('without such an effect, the card component of a token merged permanent goes where the permanent goes', () => {
    let s = table([], { hand: ['Test Doom'], more: [BEARS], defs: [DOOM] });
    const tok = tokenOf(s, BEARS);
    s = resolveTop(mutate(tok.s, tok.id), [UNDER]);
    s = kill(s, tok.id);
    expect((s.zones.graveyard.p1 ?? []).filter((x) => s.objects[x]!.defId === GEMRAZER)).toHaveLength(1);
  });
});

describe('CR 730.3c: an effect that finds the new object a merged permanent became finds every card', () => {
  it('"exile target creature, then return that card to the battlefield": both cards return, as two permanents', () => {
    const { s: s0, id } = merged(true, { hand: [BLINK.name], defs: [BLINK] });
    const s = castAt(s0, id, BLINK.name);
    expect(named(s, s.zones.battlefield.filter((x) => [GEMRAZER, ELVES].includes(s.objects[x]!.defId)))).toEqual([GEMRAZER, ELVES]);
    expect(s.zones.battlefield.every((x) => s.objects[x]!.components === undefined)).toBe(true);
  });
});
