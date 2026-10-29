/**
 * F17/F9 (2026-10-26; docs/ARCHITECTURE.md, the decision model's list of memos): `viewFor` keeps, per game and viewer, the redacted log, history and last
 * known information (core/view.ts `ViewMemo`) and redacts only what was added since. Cached against uncached: every view of random games, with face-down
 * cards turned face up and down (the answers a redacted entry read change) and states viewed out of order (another branch of the same game), is exactly
 * the view of a copy of the state (new entries: nothing cached). And the memo is used: consecutive views share their redacted entries, which are frozen.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, viewFor, type Action, type GameConfig, type GameState, type PlayerId } from '../../src/index';
import { compiledDefs } from '../fixtures';
import { Bot } from '../m3/bot';
import { synthetic } from '../m6/face-down/support';
import { realChoose, realConfig } from './decks';

const SYNTH = [
  synthetic('Test Shroud Tailor', 'Creature — Human Rogue', '{1}{U}', 'When this creature enters, cloak the top card of your library.', { power: '1', toughness: '1' }),
  synthetic('Test Mask Weaver', 'Creature — Human Wizard', '{1}{U}', '{1}: Turn target face-down creature face up.', { power: '1', toughness: '2' }),
  synthetic('Test Veil Caster', 'Creature — Human Wizard', '{1}{U}', '{2}: Turn target creature face down.', { power: '1', toughness: '2' }),
];
const ALICE = ['Exalted Angel', 'Den Protector', 'Grinning Demon', 'Test Shroud Tailor', 'Test Veil Caster', 'Lightning Bolt'];
const BOB = ['Willbender', 'Alley Assailant', 'Test Mask Weaver', 'Counterspell', 'Shock', 'Clone'];
const LANDS = ['Plains', 'Island', 'Swamp', 'Mountain'];

function deckOf(cards: string[]): string[] {
  const out = [...cards, ...cards, ...cards];
  while (out.length < 40) out.push(LANDS[out.length % LANDS.length]!);
  return out;
}

function config(seed: string): GameConfig {
  return {
    seed,
    players: [
      { name: 'Alice', deck: deckOf(ALICE), stops: { fullControl: true } },
      { name: 'Bob', deck: deckOf(BOB), stops: { fullControl: true } },
    ],
    defs: [...compiledDefs([...new Set([...ALICE, ...BOB, ...LANDS])].filter((n) => !n.startsWith('Test '))), ...SYNTH],
    options: { skipMulligans: true },
  };
}

const VIEWERS: (PlayerId | null)[] = ['p1', 'p2', null];

/** The view of a copy of `s`: its log, history and last known information are new objects, so nothing the memo kept applies. */
const uncached = (s: GameState, viewer: PlayerId | null): string => JSON.stringify(viewFor(structuredClone(s), viewer));

/** Random face-down games (the soak bot, with the listed special actions taken now and then), every state kept. */
function faceDownGame(seed: string, budget: number): GameState[] {
  const bot = new Bot(seed);
  let s = createGame(config(seed));
  const states = [s];
  for (let i = 0; i < budget && !s.result; i++) {
    const d = s.pending!;
    let a: Action = bot.next(s);
    if (d.kind === 'priority') {
      const special = legalActions(s, d.player).find((la) => la.kind === 'special' || (la.kind === 'cast' && ['morph', 'disguise'].includes((la.action as { method?: string }).method ?? '')));
      if (special) a = special.action;
    }
    const r = applyAction(s, a);
    if (r.error) throw new Error(`${seed} #${i}: ${r.error.message}`);
    s = r.state;
    states.push(s);
  }
  return states;
}

describe('F17/F9 core/view.ts ViewMemo: the incremental redaction of log, history and last known information', () => {
  it('cached against uncached: every view of random face-down games, in order and out of order, is the view of a fresh copy', () => {
    let compared = 0;
    let faceUps = 0;
    for (const seed of ['view-memo-0', 'view-memo-1']) {
      const states = faceDownGame(seed, 260);
      // in order: each viewer's memo grows with the game (the screen and the actor, as the browser asks)
      for (const s of states) for (const v of VIEWERS) { expect(JSON.stringify(viewFor(s, v)), `${seed} log ${s.log.length}`).toBe(uncached(s, v)); compared++; }
      // out of order: an earlier state after a later one (a cancelled action, a replay seeking back) and a jump forward again
      for (const i of [states.length - 1, 5, Math.floor(states.length / 2), 1, states.length - 2]) {
        const s = states[i]!;
        for (const v of VIEWERS) { expect(JSON.stringify(viewFor(s, v)), `${seed} state ${i}`).toBe(uncached(s, v)); compared++; }
      }
      // a face-down permanent turned face up (the same object id, the same log and history): the entries about it that were redacted for the other player
      // are shown now, and hidden again when it is face down (the answers the memo's entries read changed both ways)
      for (const s of states.filter((x, i) => i % 10 === 0 && x.zones.battlefield.some((id) => x.objects[id]!.faceDown))) {
        const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
        const o = s.objects[id]!;
        const up: GameState = { ...s, objects: { ...s.objects, [id]: { ...o, faceDown: false } } };
        const other: PlayerId = o.controller === 'p1' ? 'p2' : 'p1';
        const before = JSON.stringify(viewFor(s, other));
        const after = JSON.stringify(viewFor(up, other));
        expect(after).toBe(uncached(up, other));
        expect(JSON.stringify(viewFor(s, other))).toBe(before);
        expect(before).toBe(uncached(s, other));
        if (JSON.stringify(viewFor(up, other).history) !== JSON.stringify(viewFor(s, other).history)) faceUps++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(faceUps).toBeGreaterThan(0);
  }, 300_000);

  it('cached against uncached: a real game with decisions mid-action (the other player is shown the state the action started from, CR 733.1)', () => {
    let s = createGame(realConfig(1));
    let midAction = 0;
    for (let i = 0; i < 400 && !s.result; i++) {
      for (const v of VIEWERS) expect(JSON.stringify(viewFor(s, v)), `#${i} ${v}`).toBe(uncached(s, v));
      if (s.suspended !== null) midAction++;
      const r = applyAction(s, realChoose(s));
      if (r.error) throw new Error(r.error.message);
      s = r.state;
    }
    expect(midAction).toBeGreaterThan(0);
  }, 300_000);

  it('the memo is used: a later view shares the earlier redacted entries (frozen), in arrays and records of its own', () => {
    let s = createGame(realConfig(2));
    for (let i = 0; i < 120 && !s.result; i++) s = applyAction(s, realChoose(s)).state;
    const v1 = viewFor(s, 'p2');
    const next = applyAction(s, realChoose(s)).state;
    const v2 = viewFor(next, 'p2');
    expect(v1.history.length).toBeGreaterThan(10);
    expect(v2.log).not.toBe(v1.log);
    expect(v2.history).not.toBe(v1.history);
    expect(v2.lki).not.toBe(v1.lki);
    for (let i = 0; i < v1.log.length; i++) expect(v2.log[i]).toBe(v1.log[i]);
    for (let i = 0; i < v1.history.length; i++) expect(v2.history[i]).toBe(v1.history[i]);
    for (const id of Object.keys(v1.lki)) if (next.lki[id] === s.lki[id]) expect(v2.lki[id]).toBe(v1.lki[id]);
    expect(Object.isFrozen(v2.log[0])).toBe(true);
    expect(Object.isFrozen(v2.history[0])).toBe(true);
    for (const l of Object.values(v2.lki)) expect(Object.isFrozen(l) && Object.isFrozen(l.object)).toBe(true);
    // the definitions are shared, in a map of the view's own
    expect(v2.defs).not.toBe(next.defs);
    for (const [id, d] of Object.entries(v2.defs)) expect(d).toBe(next.defs[id]);
    // and another viewer's entries are its own (its private log lines differ)
    const spectator = viewFor(next, null);
    expect(JSON.stringify(spectator.log)).toBe(JSON.stringify(viewFor(structuredClone(next), null).log));
  });
});
