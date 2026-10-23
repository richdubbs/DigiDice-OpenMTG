/**
 * WP2: the normalization table of the render gate (render/equivalence.ts) row by row, the position-set matcher behind it, the false-reject measurement
 * hook, and the purity of the renderer (a function of the JSON alone: no mutation, no state between calls).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { normalizeForGate, renderAbility, renderGate } from '../../../src/index';
import { gateTokens } from '../../../src/render/equivalence';
import { measureGate } from '../../../src/render/metrics';
import { alt, firstAlt, parseMarked } from '../../../src/render/text';
import { examples } from './examples';

const names = ['Lightning Bolt'];
const n = (s: string): string => normalizeForGate(s, names);

describe('CR 207.2, 201.3, 107.2: normalizeForGate: what the table treats as the same thing', () => {
  it('case, curly quotes and apostrophes, dashes, spaces', () => {
    expect(n('Don’t   Block')).toBe("don't block");
    expect(n('“When this creature dies”')).toBe('"when ~ dies"');
    expect(n('I, II — Draw a card.')).toBe('i, ii -- 1 card.'.replace('1 card', 'draw 1 card').replace('i, ii -- draw 1 card.', 'i, ii -- draw 1 card.'));
    expect(n('−1: Draw a card.')).toBe('-1: draw 1 card.');
    expect(n('Ward—Pay 3 life')).toBe('ward -- pay 3 life');
  });
  it('reminder text is dropped, nested too', () => {
    expect(n('Flying (This creature can\'t be blocked except by creatures with flying or reach.)')).toBe('flying');
    expect(n('({T}: Add {W} or {U}.)')).toBe('');
    expect(n('Equip {1} (Attach to target creature you control (sorcery speed).)')).toBe('equip {1}');
  });
  it('the object\'s own name, CARDNAME and "this <type>" are "~"; "this turn" is not', () => {
    expect(n('Lightning Bolt deals 3 damage to any target.')).toBe('~ deals 3 damage to any target.');
    expect(n('CARDNAME deals 3 damage')).toBe('~ deals 3 damage');
    expect(n('When this creature dies, draw a card. This spell costs {1} less. Destroy this Aura.')).toBe('when ~ dies, draw 1 card. ~ costs {1} less. destroy ~.');
    expect(n('Until end of turn, this turn, this way, this combat')).toBe('until end of turn, this turn, this way, this combat');
    expect(n("this creature's power")).toBe("~'s power");
    expect(normalizeForGate('Bruna, the Fading Light and Bruna', ['Bruna, the Fading Light', 'Bruna'])).toBe('~ and ~');
  });
  it('number words and the articles a, an, one are digits', () => {
    expect(n('Create two 1/1 white Soldier creature tokens.')).toBe('create 2 1/1 white soldier creature tokens.');
    expect(n('Draw a card. Draw one card. Draw an extra card.')).toBe('draw 1 card. draw 1 card. draw 1 extra card.');
    expect(n('Target player mills twenty cards.')).toBe('target player mills 20 cards.');
    expect(n('Choose one --')).toBe('choose 1 --');
  });
  it('contractions of is, are and have', () => {
    expect(n("It's your turn and you're the monarch; they've won")).toBe('it is your turn and you are the monarch; they have won');
    expect(n("the creature's power")).toBe("the creature's power");
  });
  it('non- and non', () => {
    expect(n('target non-Aura enchantment')).toBe('target nonaura enchantment');
    expect(n('target nonblack creature')).toBe('target nonblack creature');
  });
  it('"enters the battlefield" is "enters"', () => {
    expect(n('When this creature enters the battlefield, draw a card.')).toBe('when ~ enters, draw 1 card.');
    expect(n('Put it onto the battlefield.')).toBe('put it onto the battlefield.');
  });
  it('is idempotent on all the worked examples', () => {
    for (const ex of examples as unknown as { name: string; oracle: string[] }[]) {
      for (const line of ex.oracle) {
        const once = normalizeForGate(line, [ex.name]);
        expect(normalizeForGate(once, [ex.name]), `${ex.name}: ${line}`).toBe(once);
      }
    }
  });
  it('splits into words and punctuation', () => {
    expect(gateTokens('~ deals 3 damage to any target, then draw {t}: add {g}.')).toEqual(['~', 'deals', '3', 'damage', 'to', 'any', 'target', ',', 'then', 'draw', '{t}', ':', 'add', '{g}', '.']);
    expect(gateTokens('i, ii -- "when it dies."')).toEqual(['i', ',', 'ii', '--', '"', 'when', 'it', 'dies', '.', '"']);
  });
});

describe('design 6.8 (G6): marked text: alternative groups', () => {
  it('parses nested groups and takes the first option for display', () => {
    const t = `a ${alt('b', `c ${alt('d', 'e')}`)} f`;
    expect(firstAlt(t)).toBe('a b f');
    const tree = parseMarked(t);
    expect(tree).toHaveLength(3);
  });
  it('a group of one option is just that option', () => {
    expect(alt('x', 'x')).toBe('x');
    expect(firstAlt(alt('x', 'y'))).toBe('x');
  });
});

describe('design 6.8 (G6) and CR 608.2c: the gate accepts every reading of an alternative and nothing else', () => {
  const draw: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'gainLife', who: { ref: 'you' }, amount: 1 }] } };
  const ctx = { selfNames: ['Test Card'] };
  it.each([
    'Draw a card. Gain 1 life.',
    'Draw a card and gain 1 life.',
    'Draw a card, then gain 1 life.',
    'Draw a card. You gain 1 life.',
    'You draw a card and you gain 1 life.',
  ])('joiner variant: %s', (text) => {
    expect(renderGate(draw, [text], ctx).ok).toBe(true);
  });
  it.each(['Draw a card. Gain 2 life.', 'Draw a card. Lose 1 life.', 'Draw a card.', 'Gain 1 life. Draw a card.', 'Draw a card. Gain 1 life. Draw a card.'])('not a reading: %s', (text) => {
    expect(renderGate(draw, [text], ctx).ok).toBe(false);
  });
  it('reports where the first difference is', () => {
    const r = renderGate(draw, ['Draw a card. Gain 2 life.'], ctx);
    expect(r.ok).toBe(false);
    expect(gateTokens(r.expected)[r.firstDiff!]).toBe('2');
  });
  it('several Oracle lines are joined with a space', () => {
    const r = renderGate(draw, ['Draw a card.', 'Gain 1 life.'], ctx);
    expect(r.ok).toBe(true);
  });
});

describe('design 6.12: the false-reject measurement hook', () => {
  const ctx = { selfNames: ['Test Card'] };
  const bolt: AbilityDef = { kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: '' }], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3 }] } };
  it('counts accepted and rejected abilities and groups the rejections by the words that disagree', () => {
    const report = measureGate([
      { id: 'a', def: bolt, oracle: ['Test Card deals 3 damage to any target.'], ctx },
      { id: 'b', def: bolt, oracle: ['Test Card deals 4 damage to any target.'], ctx },
      { id: 'c', def: bolt, oracle: ['Test Card deals 5 damage to any target.'], ctx },
      { id: 'd', def: { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'nonsense' } as never] } }, oracle: ['Nonsense.'], ctx },
    ]);
    expect(report.total).toBe(4);
    expect(report.accepted).toBe(1);
    expect(report.rejected).toBe(3);
    expect(report.rejectRate).toBeCloseTo(0.75);
    expect(report.unrenderable).toBe(1);
    expect(report.diffs.map((d) => [d.rendered, d.expected])).toEqual([['3', '4'], ['3', '5']].map(([a, b]) => [a, b]));
    expect(report.rejects.map((r) => r.id)).toEqual(['b', 'c', 'd']);
  });
  it('an empty run has rate 0', () => {
    expect(measureGate([]).rejectRate).toBe(0);
  });
});

describe('design 2.1 principle 8: the renderer is a function of the JSON alone', () => {
  const deepFreeze = <T,>(x: T): T => {
    if (x && typeof x === 'object') {
      Object.freeze(x);
      for (const v of Object.values(x as object)) deepFreeze(v);
    }
    return x;
  };
  it('does not modify its input and gives the same answer twice', () => {
    for (const ex of examples as unknown as { name: string; card: { abilities?: AbilityDef[]; faces?: { abilities: AbilityDef[] }[] } }[]) {
      const abilities = deepFreeze(JSON.parse(JSON.stringify(ex.card.abilities ?? ex.card.faces!.flatMap((f) => f.abilities))) as AbilityDef[]);
      for (const def of abilities) {
        const ctx = { selfNames: [ex.name] };
        const a = renderAbility(def, ctx);
        const b = renderAbility(def, ctx);
        expect(b).toEqual(a);
      }
    }
  });
  it('the context is not modified and gives no state to the next call', () => {
    const ctx = Object.freeze({ selfNames: Object.freeze(['Test Card']) as unknown as string[] });
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'destroy', what: { ref: 'self' } }] } };
    expect(renderAbility(def, ctx)).toEqual(['Destroy Test Card.']);
    expect(renderAbility(def, ctx)).toEqual(['Destroy Test Card.']);
  });
  it('display data of the model (text, span) never reaches the output', () => {
    const def: AbilityDef = { kind: 'spell', text: 'WRONG TEXT', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1, span: 'WRONG SPAN' }] } };
    expect(renderAbility(def, { selfNames: ['X'] })).toEqual(['Draw a card.']);
  });
});
