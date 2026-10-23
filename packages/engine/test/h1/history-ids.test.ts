/**
 * NETFIX2 (review of NETFIX1, CR 400.2): a history entry whose subject the viewer can see (a discarded card, now in a graveyard) kept all its facts, and
 * the facts name the object as it was at the event (`rules/history.ts` objectFacts: `id`, and `source.id`, `attacker.id`, `by.id` for the other object of
 * an event). For a card discarded from a hand that is the card's id in the hand: the view hides it (audit m4 aliases, because an id tells when the card
 * was drawn), and the history gave it back, so a discard (looting, cycling, a discard cost) told the other players when each discarded card was drawn.
 *
 * A view's history names no object by an id the viewer could not see when the fact was recorded (an object in another player's hand or in a library,
 * not revealed to the viewer); the entry keeps its visible subject and its other facts. The owner's own view keeps them all.
 *
 * Re-review: the same for every other part of a view (a cycling ability on the stack named the cycled card by its hand id as its `sourceId`).
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type GameState, type HistoryEntry, type PlayerId } from '../../src/index';
import { act, answer, castAuto, find, legal, passBoth, scenario } from '../m3/scenario';

/** The ids of the objects in p1's hand or library that `viewer` could not see, in any of `states`. */
function hiddenFrom(states: readonly GameState[], viewer: PlayerId | null): Set<string> {
  const out = new Set<string>();
  for (const s of states) {
    for (const zone of ['hand', 'library'] as const) {
      for (const id of s.zones[zone]['p1'] ?? []) if (!(viewer && s.objects[id]?.revealedTo?.includes(viewer)) && viewer !== 'p1') out.add(id);
    }
  }
  return out;
}

/** The object ids an entry names: its subject and every id fact (`id`, `source.id`, `attacker.id`, `by.id`, ...). */
function idsOf(e: HistoryEntry): string[] {
  const out = e.subject !== undefined ? [e.subject] : [];
  for (const [k, v] of Object.entries(e.facts)) if ((k === 'id' || k.endsWith('.id')) && typeof v === 'string' && v !== '') out.push(v);
  return out;
}

/** p1 casts Faithless Looting (draw two, then discard two, CR 701.9) and discards Shock, held from the start, and one of the two cards drawn. */
function loot(): GameState[] {
  const s0 = scenario(['Faithless Looting', 'Shock', 'Mountain'], { p1: { hand: ['Faithless Looting', 'Shock'], battlefield: ['Mountain'] } });
  const s1 = passBoth(castAuto(s0, 'Faithless Looting'));
  expect(s1.pending?.kind).toBe('chooseObjects');
  const shock = find(s1, 'Shock', 'hand', 'p1');
  const drawn = s1.zones.hand['p1']!.find((id) => s1.objects[id]!.defId === 'Plains')!;
  const s2 = answer(s1, { kind: 'chooseObjects', ids: [shock, drawn] });
  expect(s2.zones.graveyard['p1']!.map((id) => s2.objects[id]!.defId).sort()).toEqual(['Faithless Looting', 'Plains', 'Shock']);
  return [s0, s1, s2];
}

describe('NETFIX2: a view\'s history names no card by an id hidden from the viewer (CR 400.2, audit m4)', () => {
  it('a discard: the entries keep their visible subject and facts, without the hand ids of the discarded cards', () => {
    const states = loot();
    const s = states.at(-1)!;
    // Not vacuous: the state's own history names each discarded card by its id in the hand (the rules read it there, CR 603.4).
    const hidden = hiddenFrom(states, 'p2');
    const discards = s.history.filter((e) => e.ev === 'action' && e.facts['verb'] === 'discard');
    expect(discards).toHaveLength(2);
    expect(discards.every((e) => idsOf(e).some((id) => hidden.has(id)))).toBe(true);

    for (const viewer of ['p2', null] as const) {
      const v = viewFor(s, viewer);
      const named = v.history.flatMap((e) => idsOf(e).filter((id) => hiddenFrom(states, viewer).has(id)).map((id) => `${e.ev} ${e.subject ?? '-'} names ${id}`));
      expect(named, String(viewer)).toEqual([]);
      // The discards are still there for the viewer: the subject (the card in the graveyard, public) and what it was.
      for (const shown of [
        v.history.filter((e) => e.ev === 'zoneChange' && e.facts['from'] === 'hand' && e.facts['to'] === 'graveyard'),
        v.history.filter((e) => e.ev === 'action' && e.facts['verb'] === 'discard'),
      ]) {
        expect(shown.map((e) => e.facts['name']).sort(), String(viewer)).toEqual(['Plains', 'Shock']);
        expect(shown.every((e) => e.subject !== undefined && s.zones.graveyard['p1']!.includes(e.subject))).toBe(true);
      }
    }
    // The owner saw the cards in the hand: their view keeps every fact.
    expect(viewFor(s, 'p1').history).toEqual(s.history);
  });

  it('re-review: a cycling ability on the stack (CR 702.29a) and its last known information do not name the card by its hand id', () => {
    const s0 = scenario(['Intimidation Tactics', 'Swamp'], { p1: { hand: ['Intimidation Tactics'], battlefield: ['Swamp', 'Swamp', 'Swamp'] } });
    const card = find(s0, 'Intimidation Tactics', 'hand', 'p1');
    const cycle = legal(s0, 'p1', 'activate').find((l) => /cycling/i.test(l.label));
    expect(cycle).toBeDefined();
    let s = act(s0, cycle!.action);
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    const ability = s.zones.stack.find((id) => s.objects[id]!.kind === 'ability')!;
    expect(s.objects[ability]!.stack!.sourceId).toBe(card); // (the state keeps it: the rules read it)
    const strings = (v: unknown): string[] => JSON.stringify(v).match(/"o\d+"/g) ?? [];
    for (const viewer of ['p2', null] as const) {
      expect(viewFor(s, viewer).objects[ability]!.stack!.sourceId, String(viewer)).toBe('');
      expect(strings(viewFor(s, viewer)), String(viewer)).not.toContain(`"${card}"`);
    }
    expect(viewFor(s, 'p1').objects[ability]!.stack!.sourceId).toBe(card); // its owner saw the card in the hand
    s = passBoth(s); // it resolves: its last known information stays in the view
    expect(s.lki[ability]?.object.stack?.sourceId).toBe(card);
    for (const viewer of ['p2', null] as const) expect(strings(viewFor(s, viewer)), String(viewer)).not.toContain(`"${card}"`);
  });
});
