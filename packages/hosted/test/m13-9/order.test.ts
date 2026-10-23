/** Matching order (design 4.5): first come, first matched; a queue per format and size; matches come back oldest first. */
import { describe, expect, it } from 'vitest';
import { DUEL, PAUPER, pairs, POD, Rig, SEC, STANDARD, who } from './helpers';

describe('M13-9: matching order', () => {
  it('one entry waits; two are matched, in the order they came, and leave the queue', () => {
    const r = new Rig();
    r.join('a');
    expect(r.tick()).toEqual([]);
    expect(r.matcher.queued('a')).toEqual(STANDARD);
    r.advance(SEC);
    r.join('b');
    const [m] = r.tick();
    expect(who(m!)).toEqual(['a', 'b']);
    expect(m).toMatchObject({ key: STANDARD, seats: 2, formedAt: r.now });
    // matched entries are out of the queue: not queued, not counted, and they can queue again
    expect(r.matcher.queued('a')).toBeNull();
    expect(r.matcher.queued('b')).toBeNull();
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(0);
    expect(r.tick()).toEqual([]);
    expect(r.join('a')).toBeNull();
  });

  it('first come, first matched: five entries make two matches in order and the fifth waits for the next', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd', 'e'], {}, SEC);
    expect(pairs(r.tick())).toEqual(['a+b', 'c+d']);
    expect(r.matcher.queued('e')).toEqual(STANDARD);
    r.advance(SEC);
    r.join('f');
    expect(pairs(r.tick())).toEqual(['e+f']);
  });

  it('the match holds the entries as sent: the deck handle, address key and enteredAt travel with them', () => {
    const r = new Rig();
    r.join('a', { address: 'x' });
    r.advance(5 * SEC);
    r.join('b', { address: 'y', recent: ['z'] });
    const [m] = r.tick();
    expect(m!.entries).toEqual([
      { session: 'a', addressKey: 'x', key: STANDARD, deck: 'deck-a', enteredAt: r.now - 5 * SEC, recentOpponents: [] },
      { session: 'b', addressKey: 'y', key: STANDARD, deck: 'deck-b', enteredAt: r.now, recentOpponents: ['z'] },
    ]);
    // the matcher keeps its own copy: what it hands out cannot be changed from outside by mistake
    expect(Object.isFrozen(m!.entries[0])).toBe(true);
    expect(Object.isFrozen(m!.entries[0]!.recentOpponents)).toBe(true);
  });

  it('entries that arrive at the same instant are matched in the order they arrived', () => {
    const r = new Rig();
    r.joinAll(['d', 'a', 'c', 'b']);
    expect(pairs(r.tick())).toEqual(['d+a', 'c+b']);
  });

  it('a later tick with nothing new forms nothing, and a tick forms every match that is due', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd', 'e', 'f'], {}, SEC);
    expect(r.tick()).toHaveLength(3);
    expect(r.tick()).toEqual([]);
    expect(r.advance(10 * SEC).tick()).toEqual([]);
  });

  it('every format and size has its own queue: nobody is matched across queues', () => {
    const r = new Rig();
    r.join('a', { key: STANDARD });
    r.join('b', { key: PAUPER });
    r.join('c', { key: DUEL });
    r.join('d', { key: POD });
    expect(r.tick()).toEqual([]);
    expect(r.matcher.queued('c')).toEqual(DUEL);
    expect(r.matcher.queued('d')).toEqual(POD);
    r.join('e', { key: PAUPER });
    r.join('f', { key: DUEL });
    expect(pairs(r.tick())).toEqual(['b+e', 'c+f']);
    expect(r.matcher.queued('a')).toEqual(STANDARD);
    expect(r.matcher.queued('d')).toEqual(POD);
  });

  it('the matches of one tick come back oldest first, whatever the queues\' order', () => {
    const r = new Rig();
    // the pauper queue exists first (a match formed there earlier), the standard queue second
    r.joinAll(['p0', 'p1'], { key: PAUPER });
    r.joinAll(['s0', 's1'], { key: STANDARD });
    expect(pairs(r.tick())).toEqual(['p0+p1', 's0+s1']);
    r.advance(SEC);
    r.join('s2', { key: STANDARD });
    r.advance(SEC);
    r.join('p2', { key: PAUPER });
    r.advance(SEC);
    r.join('p3', { key: PAUPER });
    r.advance(SEC);
    r.join('s3', { key: STANDARD });
    // standard's oldest (s2) is older than pauper's (p2)
    expect(pairs(r.tick())).toEqual(['s2+s3', 'p2+p3']);
  });

  it('a session that is not matchable now (no connection) or has sat down waits and keeps its place', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c'], {}, SEC);
    r.absent.add('a');
    // a has no connection: b and c are matched, a keeps the first place
    expect(pairs(r.tick())).toEqual(['b+c']);
    expect(r.matcher.queued('a')).toEqual(STANDARD);
    r.advance(SEC);
    r.join('d');
    r.absent.delete('a');
    expect(pairs(r.tick())).toEqual(['a+d']);
  });

  it('a session that sat down while queued is not matched (the lookup is asked at every tick)', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c'], {}, SEC);
    r.busy.add('a');
    expect(pairs(r.tick())).toEqual(['b+c']);
    r.busy.delete('a');
    r.advance(SEC);
    r.join('d');
    expect(pairs(r.tick())).toEqual(['a+d']);
  });
});
