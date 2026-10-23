/**
 * WP7 review 2, conditions read while announcing (CR 601.2b-c, 602.5b) and the capabilities that claim them (design 5.2, 15.1 item 5: "nothing is falsely full").
 *
 *  - what the static check calls readable is exactly what the evaluator can answer: a listed action is accepted (ARCHITECTURE: legalActions contract);
 *  - a value the evaluator cannot answer is a DENIAL, never "false" and never "not required";
 *  - the capability names (`feature:announce.*`) are as fine as the readable subset, so a condition kind or player reference the announcement can't read stays a
 *    missing capability when WP4 adds its evaluator for resolution (`cond:happened`, `ref:each`, ...);
 *  - an activation restriction is judged three-valued: an `ask` leaf is attested later, so `not ask` is offered.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, ModeSpec, PlayerRef, TargetSpec } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/index';
import { announceCond, announceReadable } from '../../../src/actions/announce-cond';
import { unsupportedForms } from '../../../src/actions/announce';
import { activatedForms, modeSpecForms, targetSpecForms } from '../../../src/model/forms';
import { act, activated, answer, find, legal, reject, scenario, synth } from '../helpers';
import { castCard, drive, spec, spell } from './support';

const gadget = (extra: Parameters<typeof activated>[3]) => synth({ name: 'Test Gadget', type: 'Artifact', abilities: [activated('Do it.', {}, [], extra)] });
const withGadget = (extra: Parameters<typeof activated>[3]) => {
  const s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Test Gadget', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [gadget(extra)] });
  return { s, id: find(s, 'Test Gadget', 'battlefield') };
};

describe('CR 602.5b: an activation restriction the announcement can\'t read is not offered (it used to be listed and then refused)', () => {
  it('"each opponent" is not a player the announcement can read: not listed, and the request is refused for the same reason', () => {
    const only: Condition = { cond: 'compare', left: { q: 'life', of: { ref: 'each', who: 'opponent' } }, op: '<=', right: 40 };
    const { s, id } = withGadget({ onlyIf: only });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
    expect(reject(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }).message).toContain("can't");
  });

  it('a readable life total is judged against the board and offered', () => {
    const { s } = withGadget({ onlyIf: { cond: 'compare', left: { q: 'life', of: { ref: 'anOpponent' } }, op: '<=', right: 40 } });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
  });
});

describe('CR 602.5b: the controller attests an `ask` restriction later, so the pure check is three-valued', () => {
  it('"not (ask)" is offered; the attestation decides when the ability is activated', () => {
    const { s: s0, id } = withGadget({ onlyIf: { cond: 'not', of: { cond: 'ask', text: 'You control a Wizard.' } } });
    expect(legal(s0, 'p1', 'activate')).toHaveLength(1);
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    s = drive(answer(s, { kind: 'yesNo', yes: false }), []); // "no Wizard": the restriction (not ask) holds
    expect(s.zones.stack).toHaveLength(1);
  });

  it('"ask and a false board condition" is not offered: a definite false decides without asking', () => {
    const { s } = withGadget({ onlyIf: { cond: 'all', of: [{ cond: 'ask', text: 'x' }, { cond: 'exists', of: { ref: 'each', filter: { types: ['Planeswalker'] } } }] } });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
  });

  it('"ask" whose answer another player gives is not read (the controller attests, nobody else)', () => {
    const { s } = withGadget({ onlyIf: { cond: 'ask', text: 'x', who: { ref: 'anOpponent' } } });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
  });
});

describe('CR 601.2c: a conditional target the announcement can\'t read keeps the spell out (it used to be skipped: the cast ignored the condition)', () => {
  const second = (onlyIf: Condition): TargetSpec[] => [spec({ id: 't0' }), spec({ id: 't1', onlyIf, text: 'another target creature' })];

  it('"if it is the turn of each opponent" is not readable: not castable', () => {
    const s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], {
      p1: { hand: ['Test Cond'], battlefield: ['Mountain', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] },
      defs: [spell('Test Cond', '{R}', second({ cond: 'turnOf', whose: { ref: 'each', who: 'opponent' } }))],
    });
    expect(legal(s, 'p1', 'cast')).toEqual([]);
  });

  it('a readable condition on the second target is honored: required once it holds', () => {
    const s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], {
      p1: { hand: ['Test Cond2'], battlefield: ['Mountain', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] },
      defs: [spell('Test Cond2', '{R}', second({ cond: 'turnOf', whose: 'you' }))],
    });
    let t = castCard(s, 'Test Cond2');
    t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Grizzly Bears', 'battlefield') }] });
    expect(t.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'another target creature' });
  });
});

describe('design 5.2, 15.1 item 5: capabilities are as fine as what the announcement reads', () => {
  const where = { spec: 'spec', mode: 'mode', activate: 'activate' } as const;
  const forms = (c: Condition, w: keyof typeof where): string[] => {
    if (w === 'spec') return targetSpecForms(spec({ onlyIf: c }));
    if (w === 'mode') return modeSpecForms({ min: 1, max: 1, options: [], override: { when: c, min: 1, max: 1 } } as ModeSpec);
    return activatedForms({ kind: 'activated', text: 't', cost: {}, effect: { targets: [], steps: [] }, onlyIf: c } as Parameters<typeof activatedForms>[0]);
  };
  const missing = (c: Condition, w: keyof typeof where): string[] => forms(c, w).filter((f) => f.startsWith('feature:announce.') && !ENGINE_CAPABILITIES.has(f));

  const readable: [string, Condition, keyof typeof where][] = [
    ['wasCast kicked', { cond: 'wasCast', kicked: true }, 'mode'],
    ['not/all/any', { cond: 'all', of: [{ cond: 'not', of: { cond: 'wasCast', via: 'evoke' } }, { cond: 'any', of: [{ cond: 'turnOf', whose: 'you' }] }] }, 'spec'],
    ['count of each', { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'] } } }, op: '>=', right: 2 }, 'activate'],
    ['exists each', { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } } }, 'activate'],
    ['matches self', { cond: 'matches', object: { ref: 'self' }, filter: { types: ['Artifact'] } }, 'activate'],
    ['life of you', { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '>', right: 5 }, 'activate'],
    ['zoneSize of controllerOf self', { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'controllerOf', object: { ref: 'self' } } }, op: '>', right: 1 }, 'spec'],
    ['X in a target condition', { cond: 'compare', left: { q: 'X' }, op: '>=', right: 2 }, 'spec'],
    ['ask in an activation restriction', { cond: 'ask', text: 'x' }, 'activate'],
    ['counters of one kind on self (FAST3 integration after M6-4; CR 602.5b)', { cond: 'compare', left: { q: 'counters', on: { ref: 'self' }, kind: 'brick' }, op: '>=', right: 3 }, 'activate'],
    // cloud std-tdm (CR 602.5b, 117.5): the history of this turn with no player or object reference (model/forms.ts#turnHistoryAtAnnouncement: in an activation restriction only, std-blb)
    ['history of this turn (cloud std-tdm)', { cond: 'happened', event: { ev: 'draw' }, scope: 'turn' }, 'activate'],
  ];
  const unreadable: [string, Condition, keyof typeof where][] = [
    ['happened (last turn: only this turn\'s history is read, cloud std-tdm)', { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' }, 'spec'],
    ['did', { cond: 'did', step: 'a' }, 'spec'],
    ['designation', { cond: 'designation', who: { ref: 'you' }, what: 'monarch' }, 'activate'],
    ['chosen', { cond: 'chosen', link: 'l', equals: 'x' }, 'mode'],
    ['life of each opponent', { cond: 'compare', left: { q: 'life', of: { ref: 'each', who: 'opponent' } }, op: '>', right: 5 }, 'activate'],
    ['turnOf bound', { cond: 'turnOf', whose: { ref: 'bound', name: 'p' } }, 'spec'],
    ['turnOf defending', { cond: 'turnOf', whose: { ref: 'defending' } }, 'spec'],
    ['exists of a target', { cond: 'exists', of: { ref: 'target', id: 't0' } }, 'spec'],
    ['matches a target', { cond: 'matches', object: { ref: 'target', id: 't0' }, filter: {} }, 'spec'],
    ['life of a target player (the player isn\'t chosen yet when conditions are read)', { cond: 'compare', left: { q: 'life', of: { ref: 'target', id: 't0' } }, op: '>', right: 5 }, 'spec'],
    ['ask in a target condition (nobody attests)', { cond: 'ask', text: 'x' }, 'spec'],
    ['a count of a counter on a target (the target is not chosen yet)', { cond: 'compare', left: { q: 'counters', on: { ref: 'target', id: 't0' }, kind: '+1/+1' }, op: '>', right: 1 }, 'spec'],
    ['X before X is announced (a mode count / an activation restriction)', { cond: 'compare', left: { q: 'X' }, op: '>=', right: 2 }, 'mode'],
    ['xAtLeast before X is announced', { cond: 'wasCast', xAtLeast: 2 }, 'mode'],
  ];

  it.each(readable)('%s: no missing announce capability, statically readable, and never undefined at run time', (_n, c, w) => {
    expect(missing(c, w)).toEqual([]);
    expect(announceReadable(c, w)).toBe(true);
    const { s, id } = withGadget({});
    // std-tdm / std-blb merge: an activation restriction is read with AnnounceEnv.history set (actions/activate.ts, CR 602.5b), the run-time side of `where === 'activate'`
    const r = announceCond({ s, player: 'p1', sourceId: id, costsPaid: {}, x: 2, castFrom: 'hand', attest: () => true, ...(w === 'activate' ? { history: true as const } : {}) }, c);
    expect(r).not.toBeUndefined();
  });

  it.each(unreadable)('%s: a missing announce capability (so the degrade pass keeps the card manual) and not readable', (_n, c, w) => {
    expect(missing(c, w).length).toBeGreaterThan(0);
    expect(announceReadable(c, w)).toBe(false);
  });

  it('every node of a condition is named, so one unreadable leaf inside `all` is enough to make the card manual', () => {
    expect(missing({ cond: 'all', of: [{ cond: 'wasCast', kicked: true }, { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' }] }, 'spec')).toEqual(['feature:announce.cond.happened']);
  });

  it('chooser and player references: readable ones stay capabilities, unreadable ones are missing', () => {
    const refs = (who: PlayerRef) => targetSpecForms(spec({ kind: 'player', filter: undefined, players: { who } }));
    const miss = (who: PlayerRef) => refs(who).filter((f) => f.startsWith('feature:announce.') && !ENGINE_CAPABILITIES.has(f));
    expect(miss({ ref: 'anOpponent' })).toEqual([]);
    expect(miss({ ref: 'controllerOf', object: { ref: 'target', id: 't0' } })).toEqual([]);
    expect(miss({ ref: 'defending' })).toHaveLength(1);
    expect(miss({ ref: 'controllerOf', object: { ref: 'event', role: 'subject' } })).toHaveLength(1);
    expect(miss({ ref: 'each', who: 'player' })).toHaveLength(1);
    expect(miss({ ref: 'bound', name: 'p' })).toHaveLength(1);
  });

  it('the same names drive the run-time gate: an unreadable condition makes the program unsupported', () => {
    const p = { targets: [spec({ onlyIf: { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' } })], steps: [] };
    expect(unsupportedForms(p)).toEqual(['feature:announce.cond.happened']);
    expect(unsupportedForms({ targets: [spec({ onlyIf: { cond: 'wasCast', kicked: true } })], steps: [] })).toEqual([]);
  });
});
