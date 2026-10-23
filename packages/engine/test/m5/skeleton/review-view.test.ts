/**
 * WP0 review, CR 400.2: the new top-level records (history, pending triggers, the event of a triggered ability on the stack) must not carry the identity of a card
 * the viewer can't see. Non-interference: swap the identity of a hidden card; the opponent's view must not change (the owner's view must).
 */
import { describe, expect, it } from 'vitest';
import { getChars, viewFor, type GameState, type LastKnown } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { find, scenario, tweak } from '../helpers';

const base = (): GameState => scenario(['Grizzly Bears', 'Hill Giant', 'Serra Angel'], { p1: { hand: ['Grizzly Bears', 'Serra Angel'], battlefield: ['Hill Giant'] }, p2: { hand: ['Hill Giant'] } });

/** A last-known record of `id` (a card in a hidden zone) as WP8 will write it for a draw or a discard. */
function lastKnown(s: GameState, id: string, leftZone: LastKnown['leftZone'], defId: string): LastKnown {
  const o = clone(s.objects[id]!);
  o.defId = defId;
  return { object: o, chars: { ...getChars(s, id), name: defId, names: [defId] }, leftZone };
}

/** The same game with the records WP8 will write, about the p1 hand card `secret`, whose identity is `name`. */
function withRecords(secretName: 'Grizzly Bears' | 'Serra Angel'): GameState {
  const s0 = base();
  const secret = find(s0, 'Grizzly Bears', 'hand'); // the same object id in both variants
  const giant = find(s0, 'Hill Giant', 'battlefield');
  return tweak(s0, (t) => {
    t.history = []; // the game's own history (WP8 writes it from the first event on) would be in front of the two records below
    t.objects[secret]!.defId = secretName;
    t.history.push({ turn: 1, combat: 0, ev: 'draw', actor: 'p1', subject: secret, facts: { name: secretName, zone: 'hand', creature: true } });
    t.history.push({ turn: 1, combat: 0, ev: 'zoneChange', subject: giant, facts: { name: 'Hill Giant', zone: 'battlefield', creature: true } }); // public
    t.pendingTriggers.push({
      id: 'pt1', sourceId: giant, sourceName: 'Hill Giant', controller: 'p1', abilityRef: { source: 'printed', face: 0, index: 0 },
      context: { ev: 'zoneChange', roles: { subject: { objects: [{ id: secret, zone: 'hand' }] } }, before: { [secret]: lastKnown(t, secret, 'hand', secretName), [giant]: lastKnown(t, giant, 'battlefield', 'Hill Giant') } },
    });
  });
}

describe('CR 400.2: viewFor does not leak the identity of cards the viewer cannot see through history, pending triggers or event contexts', () => {
  const a = withRecords('Grizzly Bears');
  const b = withRecords('Serra Angel');
  const secret = find(a, 'Grizzly Bears', 'hand');

  it('non-interference: swapping the identity of a hidden card changes nothing in the opponent\'s view of the new records', () => {
    const [va, vb] = [viewFor(a, 'p2'), viewFor(b, 'p2')];
    expect(JSON.stringify(va.history)).toBe(JSON.stringify(vb.history));
    expect(JSON.stringify(va.pendingTriggers)).toBe(JSON.stringify(vb.pendingTriggers));
    const text = JSON.stringify([va.history, va.pendingTriggers]);
    expect(text).not.toContain('Grizzly Bears');
    expect(text).not.toContain('Serra Angel');
  });

  it('the spectator sees no more than the opponent does', () => {
    expect(JSON.stringify(viewFor(a, null).history)).toBe(JSON.stringify(viewFor(b, null).history));
    expect(JSON.stringify(viewFor(a, null).pendingTriggers)).toBe(JSON.stringify(viewFor(b, null).pendingTriggers));
  });

  it('the owner still sees their own hidden card in the record (a hand card is visible to its owner)', () => {
    const v = viewFor(a, 'p1');
    expect(v.history[0]!.facts['name']).toBe('Grizzly Bears');
    expect(v.pendingTriggers[0]!.context.before[secret]!.object.defId).toBe('Grizzly Bears');
  });

  it('public records survive for everybody: a permanent on the battlefield keeps its facts and its snapshot', () => {
    const v = viewFor(a, 'p2');
    const giant = find(a, 'Hill Giant', 'battlefield');
    expect(v.history[1]).toMatchObject({ subject: giant, facts: { name: 'Hill Giant' } });
    expect(v.pendingTriggers[0]!.context.before[giant]!.chars!.name).toBe('Hill Giant');
  });

  it('the hidden record keeps what is public about it (when, who, which kind of event) but not the subject or its facts', () => {
    const e = viewFor(a, 'p2').history[0]!;
    expect(e).toMatchObject({ turn: 1, ev: 'draw', actor: 'p1', facts: {} });
    expect(e.subject).toBeUndefined();
    expect(viewFor(a, 'p2').pendingTriggers[0]!.context.before[secret]).toBeUndefined();
    // NETFIX2 re-review (audit m4): the roles keep the zones but not the id of a card in another player's hand (an id tells when the card was drawn)
    expect(a.pendingTriggers[0]!.context.roles).toEqual({ subject: { objects: [{ id: secret, zone: 'hand' }] } });
    expect(viewFor(a, 'p2').pendingTriggers[0]!.context.roles).toEqual({ subject: { objects: [{ id: '', zone: 'hand' }] } });
    expect(viewFor(a, 'p1').pendingTriggers[0]!.context.roles).toEqual(a.pendingTriggers[0]!.context.roles); // its owner saw it
  });

  it('the event of a triggered ability on the stack is redacted the same way (stack objects are public, their look-back snapshots are not)', () => {
    const s = tweak(a, (t) => {
      const giant = find(t, 'Hill Giant', 'battlefield');
      const id = 'o-trigger';
      t.objects[id] = {
        ...clone(t.objects[giant]!), id, kind: 'ability', zone: 'stack',
        stack: { kind: 'triggered', sourceId: giant, sourceName: 'Hill Giant', targets: [], costsPaid: {}, event: { ev: 'zoneChange', roles: {}, before: { [secret]: lastKnown(t, secret, 'hand', 'Grizzly Bears') } } },
      };
      t.zones.stack.push(id);
    });
    expect(JSON.stringify(viewFor(s, 'p2').objects['o-trigger'])).not.toContain('Grizzly Bears');
    expect(viewFor(s, 'p1').objects['o-trigger']!.stack!.event!.before[secret]).toBeDefined();
  });

  it('library cards stay hidden even from their owner in snapshots (the same rule as lki)', () => {
    const s = tweak(a, (t) => {
      t.pendingTriggers[0]!.context.before[secret] = lastKnown(t, secret, 'library', 'Grizzly Bears');
    });
    expect(viewFor(s, 'p1').pendingTriggers[0]!.context.before[secret]).toBeUndefined();
  });
});
