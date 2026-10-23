/**
 * WP11 review: a token's own "as it enters" replacement effects (CR 614.1c, 614.12). Creating tokens is replaced first, then each token entering is its own
 * entry where the "as it enters" effects apply (CR 616.1g, design 8.5). This holds for a token created by an effect (the `createToken` proposal) and for one
 * created by the milestone 3/4 route (core/zones.ts#createToken, a manual operation): a 0/0 token that "enters with two +1/+1 counters" has them before any
 * state-based action looks at it (CR 704.5f).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef } from '../../../src/index';
import { createToken } from '../../../src/core/zones';
import { proposeResult } from '../../../src/effects/propose';
import { scenario } from '../helpers';
import { entersSelf, eventsOf, permanent, run, staticAbility } from './support';

const ooze: CardDef = {
  ...permanent('Test Ooze', 'Token Creature — Ooze', [staticAbility('This creature enters with two +1/+1 counters on it.', [entersSelf({ counters: [{ kind: '+1/+1', count: 2 }] })])], { pt: ['0', '0'] }),
  isToken: true,
};
const chameleon: CardDef = {
  ...permanent('Test Shade', 'Token Creature — Shade', [staticAbility('As this creature enters, choose a color.', [entersSelf({ choose: [{ what: 'color', link: 'c' }] })])], { pt: ['1', '1'] }),
  isToken: true,
};

describe('CR 616.1g, 614.1c: each token created enters with its own "as it enters" replacements', () => {
  it('a createToken proposal: each 0/0 token enters with two +1/+1 counters', () => {
    const s0 = scenario([], { defs: [ooze] });
    const r = run(s0, (g) => proposeResult(g, { ev: 'createToken', player: 'p1', count: 2, token: 'Test Ooze' }));
    const ids = r.result!.newIds;
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(r.g.s.objects[id]!.counters).toEqual({ '+1/+1': 2 });
    expect(eventsOf(r.g, 'tokenCreated')).toHaveLength(2);
  });

  it('the entering facts of the effect and the token\'s own replacement both apply (CR 614.1c)', () => {
    const s0 = scenario([], { defs: [ooze] });
    const r = run(s0, (g) => proposeResult(g, { ev: 'createToken', player: 'p1', count: 1, token: 'Test Ooze', enter: { tapped: true, counters: [{ kind: '+1/+1', count: 1 }] } }));
    expect(r.g.s.objects[r.result!.newIds[0]!]).toMatchObject({ tapped: true, counters: { '+1/+1': 3 } });
  });

  it('CR 614.12a: a choice the token makes as it enters is asked, and stored in its link store', () => {
    const s0 = scenario([], { defs: [chameleon] });
    expect(run(s0, (g) => proposeResult(g, { ev: 'createToken', player: 'p1', count: 1, token: 'Test Shade' })).need).toMatchObject({ kind: 'chooseColor', player: 'p1' });
    const r = run(s0, (g) => proposeResult(g, { ev: 'createToken', player: 'p1', count: 1, token: 'Test Shade' }), [{ kind: 'chooseColor', color: 'G' }]);
    expect(r.g.s.objects[r.result!.newIds[0]!]!.links).toMatchObject({ c: { values: ['G'] } });
  });

  it('the milestone 3/4 route (core/zones.ts#createToken, used by manual operations) goes through the same entry', () => {
    const s0 = scenario([]);
    const r = run(s0, (g) => createToken(g, ooze, 'p1'));
    expect(r.g.s.objects[r.result!]!.counters).toEqual({ '+1/+1': 2 });
  });
});
