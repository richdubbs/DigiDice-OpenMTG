/**
 * WP32: the soak hot-spot fixes change no behavior. Each shortcut is checked against the slow path it replaces:
 *  - `triggersPossible` (triggers/possible.ts): "no definition of the game has a triggered ability" is exact, including keyword expansions and granted abilities;
 *  - `hasPriorityActions` stops at the first action that counts and gives the same answer as the whole list (core/legal.ts);
 *  - an illegal cast or land play is rejected before the state is cloned, with the same error as before (core/apply.ts, core/priority-actions.ts#earlyDenial).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, type AbilityDef, type GameState } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { hasPriorityActions, listLegalActions } from '../../../src/core/legal';
import { castCheck } from '../../../src/actions/cast';
import { containsTrigger, triggersPossible } from '../../../src/triggers/possible';
import { compiledDefs } from '../../fixtures';
import { Bot } from '../../m3/bot';
import { trig } from './cards';
import { find, keyword, scenario, synth } from './helpers';

const gain: AbilityDef = trig('Whenever a creature enters, you gain 1 life.', [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }], { steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] });

describe('triggers/possible.ts: "nothing can trigger" is exact (CR 603.2)', () => {
  it('a printed triggered ability, a keyword whose expansion triggers (prowess, CR 702.108a), a Saga chapter, a granted one', () => {
    expect(containsTrigger([gain])).toBe(true);
    expect(containsTrigger([keyword('prowess')])).toBe(true);
    expect(containsTrigger([keyword('flying')])).toBe(false);
    expect(containsTrigger([{ kind: 'chapter', text: 'I', chapters: [1], effect: { targets: [], steps: [] } }])).toBe(true);
    const granting: AbilityDef = { kind: 'static', text: 'Creatures you control have "..."', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: 6, add: [gain] }] }] };
    expect(containsTrigger([granting])).toBe(true);
    const grantingKeyword: AbilityDef = { kind: 'static', text: 'Creatures you control have prowess.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: 6, add: [keyword('prowess')] }] }] };
    expect(containsTrigger([grantingKeyword])).toBe(true);
  });

  it('"false is certain" at any depth: no cut-off, and a keyword first met deep inside a tree is not remembered as having no trigger', () => {
    const nest = (v: unknown, n: number): unknown => (n === 0 ? v : nest([v], n - 1));
    expect(containsTrigger(nest([gain], 60))).toBe(true);
    expect(containsTrigger(nest([keyword('exalted')], 60))).toBe(true); // CR 702.83a: a triggered ability
    expect(containsTrigger([keyword('exalted')])).toBe(true);
  });

  it('a game of vanilla cards has none; adding a card with one changes the answer', () => {
    const plain = scenario(['Grizzly Bears', 'Forest']);
    expect(triggersPossible(plain)).toBe(false);
    const watcher = synth({ name: 'Test Watcher', cost: '{1}', type: 'Enchantment', abilities: [gain] });
    expect(triggersPossible(scenario(['Grizzly Bears', 'Forest'], { defs: [watcher] }))).toBe(true);
  });

  it('a card whose triggered ability is in a definition added later (a token, CR 111.4) is seen: the answer is per definitions map and size', () => {
    const s = scenario(['Grizzly Bears']);
    expect(triggersPossible(s)).toBe(false);
    const t: GameState = { ...s, defs: { ...s.defs, 'Test Token': synth({ name: 'Test Token', type: 'Creature', pt: ['1', '1'], abilities: [gain] }) } };
    expect(triggersPossible(t)).toBe(true);
  });
});

describe('core/legal.ts: hasPriorityActions is the same answer as the whole list (CR 117.1, Arena-style auto-pass)', () => {
  it('at every priority of a seeded random game of real cards', () => {
    const names = ['Forest', 'Mountain', 'Llanowar Elves', 'Grizzly Bears', 'Lightning Bolt', 'Giant Growth', 'Hill Giant', 'Sol Ring', 'Fire // Ice', 'Think Twice'];
    const deck = names.flatMap((n) => [n, n, n, n]);
    let s = createGame({ seed: 'wp32-auto-pass', players: [{ name: 'A', deck, stops: { fullControl: true } }, { name: 'B', deck, stops: { fullControl: true } }], defs: compiledDefs(names) });
    const bot = new Bot('wp32-auto-pass');
    let checked = 0;
    for (let i = 0; i < 150 && !s.result; i++) {
      const d = s.pending!;
      if (d.kind === 'priority') {
        for (const p of ['p1', 'p2']) {
          const slow = listLegalActions(s, p).some((a) => a.kind !== 'pass' && !a.isMana);
          expect(hasPriorityActions(new Game(s, []), p)).toBe(slow);
          checked++;
        }
      }
      const r = applyAction(s, bot.next(s));
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('core/apply.ts: an illegal cast or land play is rejected before cloning, with the same error (CR 601.3, 305.1, 733)', () => {
  it('a cast that castCheck denies: the error is the denial, the state is the same object', () => {
    const s = scenario(['Hill Giant', 'Forest'], { p1: { hand: ['Hill Giant'], battlefield: ['Forest'] } });
    const card = find(s, 'Hill Giant', 'hand');
    const check = castCheck(s, 'p1', card);
    expect('denial' in check).toBe(true);
    const r = applyAction(s, { type: 'cast', player: 'p1', card });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
    expect(r.error).toEqual({ message: (check as { denial: { message: string } }).denial.message, rules: (check as { denial: { rules: string[] } }).denial.rules });
  });

  it('a second land in a turn is rejected the same way (CR 305.2)', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Forest', 'Forest'] } });
    const [a, b] = s0.zones.hand['p1']!;
    const s = applyAction(s0, { type: 'playLand', player: 'p1', card: a! }).state;
    const r = applyAction(s, { type: 'playLand', player: 'p1', card: b! });
    expect(r.error?.rules).toContain('CR 305.2');
    expect(r.state).toBe(s);
  });

  it('a legal cast still goes through (and is listed)', () => {
    const s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    const card = find(s, 'Grizzly Bears', 'hand');
    expect(legalActions(s, 'p1').some((a) => a.action.type === 'cast' && a.action.card === card)).toBe(true);
    const r = applyAction(s, { type: 'cast', player: 'p1', card });
    expect(r.error).toBeUndefined();
  });
});
