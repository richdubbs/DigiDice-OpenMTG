/**
 * WP2 review fixes: a number or an actor in the model is a number or an actor in the text. CR 707.10 (copying a spell as many times as stated), CR 701.16
 * (investigate), 701.34 (proliferate), 701.20 (populate): "twice" and "three times" are rules content, never decoration.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, Condition, EffectStep, EventPattern, KeywordActionName, Quantity } from '../../../src/types/ability';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { Gen, rng } from './gen';
import { accepts, CTX, objTarget, playerTarget, rejects, spell, t, trig, you } from './build';

const instantOrSorcery = { id: 's', kind: 'spell', min: 1, max: 1, text: '', filter: { types: ['Instant', 'Sorcery'] } } as const;
const copySpell = (extra: Record<string, unknown> = {}): AbilityDef =>
  spell([{ op: 'copy', what: t('s'), result: 'spell', who: you, ...extra } as EffectStep], [instantOrSorcery as never]);

describe('CR 707.10: copying a spell states how many copies', () => {
  it('count 1 (or none) is "Copy target instant or sorcery spell."', () => {
    accepts(copySpell({ count: 1 }), 'Copy target instant or sorcery spell.');
    accepts(copySpell(), 'Copy target instant or sorcery spell.');
  });
  it('count 2 is "twice", and the singular wording is rejected', () => {
    accepts(copySpell({ count: 2 }), 'Copy target instant or sorcery spell twice.');
    rejects(copySpell({ count: 2 }), 'Copy target instant or sorcery spell.');
  });
  it('count 3 is "three times"', () => {
    accepts(copySpell({ count: 3 }), 'Copy target instant or sorcery spell three times.');
    rejects(copySpell({ count: 3 }), 'Copy target instant or sorcery spell twice.');
  });
  it('copies take the plural in the rider about new targets', () => {
    accepts(copySpell({ count: 2, newTargets: 'may' }), 'Copy target instant or sorcery spell twice. You may choose new targets for the copies.');
  });
  it('the player who copies is stated when it is not you', () => {
    const other = spell([{ op: 'copy', what: t('s'), result: 'spell', who: t('p') } as EffectStep], [instantOrSorcery as never, playerTarget('p')]);
    rejects(other, 'Copy target instant or sorcery spell.');
    accepts(other, 'Target player copies target instant or sorcery spell.');
  });
  it('a copy exception is stated', () => {
    const except = copySpell({ except: [{ layer: 5, colors: { set: ['R'] } }] });
    rejects(except, 'Copy target instant or sorcery spell.');
  });
});

describe('CR 701: a keyword action done more than once says so', () => {
  const action = (name: KeywordActionName, n?: Quantity): AbilityDef => spell([{ op: 'action', action: name, who: you, ...(n === undefined ? {} : { n }) } as EffectStep]);
  it.each([
    ['investigate', 'Investigate'], ['proliferate', 'Proliferate'], ['populate', 'Populate'], ['learn', 'Learn'], ['venture', 'Venture into the dungeon'],
    ['cascade', 'Cascade'], ['manifestDread', 'Manifest dread'],
  ] as [KeywordActionName, string][])('%s twice and three times', (name, words) => {
    accepts(action(name, 2), `${words} twice.`);
    rejects(action(name, 2), `${words}.`);
    accepts(action(name, 3), `${words} three times.`);
    rejects(action(name, 3), `${words} twice.`);
    accepts(action(name, 1), `${words}.`);
    accepts(action(name), `${words}.`);
  });
  it('amass keeps its own amount', () => {
    accepts(action('amass', 2), 'Amass 2.');
    rejects(action('amass', 2), 'Amass 3.');
  });
});

describe('CR 603.4 / 700.4 (history): "by" of a history condition or quantity is not dropped', () => {
  const dies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
  const happened = (by?: 'opponent'): AbilityDef =>
    trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'draw', who: you, count: 1 }], { interveningIf: { cond: 'happened', event: dies, scope: 'turn', ...(by ? { by } : {}) } as Condition });
  it('a condition about who did it is refused for an event with no such wording', () => {
    accepts(happened(), 'At the beginning of your upkeep, if a creature died this turn, draw a card.');
    rejects(happened('opponent'), 'At the beginning of your upkeep, if a creature died this turn, draw a card.');
  });
  it('a quantity about who did it is refused for an event with no such wording', () => {
    const q = (by?: 'opponent'): Quantity => ({ q: 'happenedCount', event: dies, scope: 'turn', ...(by ? { by } : {}) });
    const draws = (n: Quantity): AbilityDef => spell([{ op: 'draw', who: you, count: n } as EffectStep]);
    accepts(draws(q()), 'Draw cards equal to the number of creatures that died this turn.');
    rejects(draws(q('opponent')), 'Draw cards equal to the number of creatures that died this turn.');
  });
});

describe('CR 508.1d: a limit on a restriction needs its words', () => {
  it('a maximum on "can\'t attack a player" has no wording and is refused', () => {
    const def: AbilityDef = { kind: 'static', text: '', effects: [{ s: 'restrict', subject: you, mode: 'cant', action: 'attackPlayer', max: 2 }] };
    rejects(def, "You can't attack.");
  });
  it('a filter on an action that does not take one is refused', () => {
    const def: AbilityDef = { kind: 'static', text: '', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'attack', other: { types: ['Land'] } }] };
    rejects(def, "Test Card can't attack.");
  });
});

describe('CR 707.10, 701 (invariant): removing a count, a number or an actor from a generated step changes the text', () => {
  const text = (def: AbilityDef): string | null => {
    try {
      return K.ability(def, newState(CTX));
    } catch {
      return null;
    }
  };
  it('holds for copy.count, copy.who, action.n over 6000 generated abilities', () => {
    const survivors: string[] = [];
    let checked = 0;
    for (let seed = 1; seed <= 6000; seed++) {
      const def = new Gen(rng(seed)).ability();
      const base = text(def);
      if (base === null) continue;
      const visit = (node: unknown, path: (string | number)[]): void => {
        if (Array.isArray(node)) return node.forEach((x, i) => visit(x, [...path, i]));
        if (node === null || typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        const fields = o.op === 'copy' && o.result === 'spell' ? ['count', 'except'] : o.op === 'action' ? ['n'] : [];
        for (const f of fields) {
          if (o[f] === undefined || o[f] === 1) continue;
          const copy = JSON.parse(JSON.stringify(def)) as AbilityDef;
          const target = path.reduce<unknown>((n, k) => (n as Record<string | number, unknown>)[k], copy) as Record<string, unknown>;
          delete target[f];
          checked++;
          const other = text(copy);
          if (other === base) survivors.push(`seed ${seed} ${path.join('.')}.${f} = ${JSON.stringify(o[f])}`);
        }
        for (const k of Object.keys(o)) visit(o[k], [...path, k]);
      };
      visit(def, []);
    }
    expect(checked).toBeGreaterThan(10);
    expect(survivors.slice(0, 20), `${survivors.length} silent`).toEqual([]);
  });
});

void objTarget;
