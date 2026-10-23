/**
 * WP2 review fixes: a duration is never dropped (CR 611.2a: a resolved effect lasts as long as stated; 603.7b: a delayed trigger with a stated duration such
 * as "this turn" triggers repeatedly). A model that limits an effect to this turn must fail against Oracle text that states no limit, and the real wording
 * must pass.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern, StaticEffect } from '../../../src/types/ability';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { Gen, rng } from './gen';
import { accepts, CTX, draw, effectStep, mana, objTarget, rejects, spell, t } from './build';

const eot = { d: 'endOfTurn' } as const;
const eoc = { d: 'endOfCombat' } as const;
const creatureSpells: StaticEffect = { s: 'costMod', applies: { spells: { types: ['Creature'] }, caster: 'you' }, change: { kind: 'reduce', generic: 1 } };

describe('CR 611.2a: a this-turn cost modification keeps its duration (effect step, costMod)', () => {
  const def = spell([effectStep([creatureSpells], eot)]);
  it('accepts the Oracle wording with "this turn" inside the sentence', () => accepts(def, 'Creature spells you cast this turn cost {1} less to cast.'));
  it('accepts "Until end of turn," in front', () => accepts(def, 'Until end of turn, creature spells you cast cost {1} less to cast.'));
  it('rejects the permanent wording', () => rejects(def, 'Creature spells you cast cost {1} less to cast.'));
  it('a permanent duration prints no words and rejects "this turn"', () => {
    const perm = spell([effectStep([creatureSpells], { d: 'permanent' })]);
    accepts(perm, 'Creature spells you cast cost {1} less to cast.');
    rejects(perm, 'Creature spells you cast this turn cost {1} less to cast.');
  });
  it('a combat-long duration differs from a turn-long one', () => {
    const combat = spell([effectStep([creatureSpells], eoc)]);
    accepts(combat, 'Creature spells you cast this combat cost {1} less to cast.');
    rejects(combat, 'Creature spells you cast this turn cost {1} less to cast.');
  });
});

describe('CR 611.2a: a this-turn rule modification keeps its duration (effect step, rule)', () => {
  const landPlays: StaticEffect = { s: 'rule', rule: 'landPlays', value: 1 };
  const def = spell([effectStep([landPlays], eot)]);
  it('accepts "this turn"', () => accepts(def, 'You may play an additional land this turn.'));
  it('rejects the permanent wording', () => rejects(def, 'You may play an additional land on each of your turns.'));
  it('rejects a bare "no maximum hand size" for a this-turn rule', () => {
    const hand = spell([effectStep([{ s: 'rule', rule: 'maxHandSize', value: 'none' }], eot)]);
    rejects(hand, 'You have no maximum hand size.');
    accepts(hand, 'You have no maximum hand size this turn.');
  });
});

describe('CR 611.2a and 603.2d: a this-turn trigger modifier keeps its duration', () => {
  const mod: StaticEffect = { s: 'triggerMod', cause: { ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }, abilitiesOf: { types: ['Permanent'], controller: 'you' }, additional: 1 };
  const def = spell([effectStep([mod], eot)]);
  it('rejects the durationless text and accepts "this turn"', () => {
    const text = 'If a creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time';
    rejects(def, `${text}.`);
    accepts(def, `${text} this turn.`);
  });
});

describe('CR 611.2a: a cost or option that has no duration wording refuses a stated duration', () => {
  it('additionalCost under a this-turn effect is refused', () => {
    const e: StaticEffect = { s: 'additionalCost', cost: { mana: mana(1) } };
    rejects(spell([effectStep([e], eot)]), 'As an additional cost to cast Test Card, pay {1}.');
  });
  it('alternativeCost under a this-turn effect is refused', () => {
    const e: StaticEffect = { s: 'alternativeCost', cost: { mana: mana(0) }, name: 'free' };
    rejects(spell([effectStep([e], eot)]), "You may pay {0} rather than pay Test Card's mana cost.");
  });
  it('pregame under a this-turn effect is refused', () => {
    const e: StaticEffect = { s: 'pregame', action: 'reveal', optional: false };
    rejects(spell([effectStep([e], eot)]), 'You reveal Test Card from your opening hand.');
  });
});

describe('CR 603.7b: a delayed event trigger with a stated duration says "this turn"', () => {
  const dies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
  const make = (duration?: { d: string }): AbilityDef =>
    spell([{ op: 'delay', when: { at: 'event', event: dies }, do: [draw()], ...(duration ? { duration } : {}) } as EffectStep]);
  it('accepts "this turn" for an end-of-turn duration', () => accepts(make(eot), 'When a creature dies this turn, draw a card.'));
  it('rejects the wording without a time limit for an end-of-turn duration', () => {
    rejects(make(eot), 'When a creature dies, draw a card.');
    rejects(make(eot), 'Whenever a creature dies, draw a card.');
  });
  it('no duration prints no limit and rejects "this turn"', () => {
    accepts(make(), 'When a creature dies, draw a card.');
    rejects(make(), 'When a creature dies this turn, draw a card.');
  });
  it('another duration has no wording here and is refused', () => rejects(make({ d: 'endOfCombat' }), 'When a creature dies, draw a card.'));
  it('a delayed trigger at a step or at end of combat cannot show a duration, so it is refused', () => {
    const atEnd = spell([{ op: 'delay', when: { at: 'endOfCombat' }, do: [draw()], duration: eot } as EffectStep]);
    rejects(atEnd, 'Draw a card at end of combat.');
    rejects(atEnd, 'At end of combat, draw a card.');
  });
});

describe('CR 509.1c and 611.2a: "must be blocked this turn if able" is the wording of the effect, not of the static ability', () => {
  const must: StaticEffect = { s: 'restrict', subject: t('c'), mode: 'mustIfAble', action: 'beBlocked' };
  it('the effect with an end-of-turn duration accepts "must be blocked this turn if able"', () => {
    accepts(spell([effectStep([must], eot)], [objTarget('c')]), 'Target creature must be blocked this turn if able.');
  });
  it('the effect with a permanent duration rejects "this turn"', () => {
    rejects(spell([effectStep([must], { d: 'permanent' })], [objTarget('c')]), 'Target creature must be blocked this turn if able.');
  });
  it('a static restriction states no duration, so "this turn" is rejected', () => {
    const stat: StaticEffect = { s: 'restrict', subject: { ref: 'self' }, mode: 'mustIfAble', action: 'beBlocked' };
    rejects({ kind: 'static', text: '', effects: [stat] }, 'Test Card must be blocked this turn if able.');
    accepts({ kind: 'static', text: '', effects: [stat] }, 'Test Card must be blocked if able.');
  });
});

describe('CR 611.2a (invariant): replacing a non-permanent duration by a permanent one changes the text or the renderer refuses', () => {
  it('holds for every effect and delay step of 20000 generated abilities', () => {
    const survivors: string[] = [];
    let checked = 0;
    const text = (def: AbilityDef): string | null => {
      try {
        return K.ability(def, newState(CTX));
      } catch {
        return null;
      }
    };
    for (let seed = 1; seed <= 20000; seed++) {
      const def = new Gen(rng(seed)).ability();
      const base = text(def);
      if (base === null) continue;
      // every {op:'effect'|'delay'} node with a non-permanent duration, by its path
      const hits: (string | number)[][] = [];
      const visit = (node: unknown, path: (string | number)[]): void => {
        if (Array.isArray(node)) node.forEach((x, i) => visit(x, [...path, i]));
        else if (node && typeof node === 'object') {
          const o = node as Record<string, unknown>;
          const d = o.duration as { d?: string } | undefined;
          // a regeneration shield lasts until end of turn when nothing else is said (CR 701.19a), so only another duration has words
          if ((o.op === 'effect' || o.op === 'delay') && d && d.d !== 'permanent') hits.push(path);
          if (o.op === 'regenerate' && d && d.d !== 'permanent' && d.d !== 'endOfTurn') hits.push(path);
          for (const k of Object.keys(o)) visit(o[k], [...path, k]);
        }
      };
      visit(def, []);
      for (const path of hits) {
        const copy = JSON.parse(JSON.stringify(def)) as AbilityDef;
        const node = path.reduce<unknown>((n, k) => (n as Record<string | number, unknown>)[k], copy) as { op: string; duration?: unknown };
        if (node.op === 'effect') node.duration = { d: 'permanent' };
        else delete node.duration;
        const other = text(copy);
        checked++;
        if (other === base) survivors.push(`seed ${seed} ${path.join('.')} ${JSON.stringify((path.reduce<unknown>((n, k) => (n as Record<string | number, unknown>)[k], def) as { duration: unknown }).duration)}`);
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(survivors.slice(0, 20), `${survivors.length} duration(s) are silent`).toEqual([]);
  }, 60_000); // merge wave 7: about 5.5 s alone with the wave's new readings (4.8 s on main), over the 5 s default
});
