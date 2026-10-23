/**
 * The stored form (design 11.4, 12.3): strip removes every display field and hydrate restores it from the player's local Oracle lines, refusing when the
 * text hash differs; and the text hash itself (pure SHA-256, normalization).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hydrateAbility, sha256Hex, stripAbility, textHash, validateAbility, validateStoredAbility, type FaceLines } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const DISPLAY = ['text', 'span', 'label'];

/** All keys at any depth. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) (out.add(k), keysDeep(x, out));
  return out;
}

describe('stripAbility', () => {
  it('removes every display field of the 53 examples at every depth (ability, target specs, mode options, manual nodes, granted abilities)', () => {
    for (const ex of EXAMPLES) {
      for (const a of ex.faces.flatMap((f) => f.abilities)) {
        const stored = stripAbility(a);
        for (const k of DISPLAY) expect(keysDeep(stored).has(k), `${ex.name}: ${k}`).toBe(false);
        expect(validateStoredAbility(stored), ex.name).toEqual([]);
      }
    }
  });
  it('keeps the structure, src, sentence and provenance, and does not modify its input', () => {
    const a = ab({
      kind: 'spell', text: 'Draw a card.', label: 'Landfall', src: [0], prov: { by: 'template', id: 't1' },
      effect: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' }, count: 1, sentence: 0, span: 'Draw a card.' }] },
    });
    const before = JSON.stringify(a);
    expect(stripAbility(a)).toEqual({
      kind: 'spell', src: [0], prov: { by: 'template', id: 't1' },
      effect: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1 }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' }, count: 1, sentence: 0 }] },
    });
    expect(JSON.stringify(a)).toBe(before);
  });
});

describe('hydrateAbility', () => {
  const lines: FaceLines = {
    lines: ['{T}, Pay {E}: Draw a card. Scry 2.', 'Flying'],
    sentences: [['Draw a card.', 'Scry 2.'], []],
  };
  const original = ab({
    kind: 'activated', text: '{T}, Pay {E}: Draw a card. Scry 2.', src: [0],
    cost: { tap: true, other: [{ kind: 'manual', text: '{T}, Pay {E}' }] },
    effect: {
      targets: [],
      steps: [
        { op: 'draw', who: { ref: 'you' }, count: { q: 'ask', text: 'Draw a card.' }, sentence: 0, span: 'Draw a card.' },
        { op: 'manual', text: 'Scry 2.', reason: 'needs-engine: op:scry', sentence: 1, span: 'Scry 2.' },
      ],
    },
  });

  it('restores the text of the ability, the span and manual text of each step from its sentence, and the cost words', () => {
    const stored = stripAbility(original);
    const back = hydrateAbility(stored, lines, 'h1', 'h1');
    expect(back).toEqual(original);
    expect(validateAbility(back!)).toEqual([]);
  });
  it('refuses (null) when the text hash differs: an erratum must not attach old behavior to new wording', () => {
    expect(hydrateAbility(stripAbility(original), lines, 'old', 'new')).toBeNull();
  });
  it('refuses when an index points outside the card\'s lines or sentences, or when the stored form is not a valid ability', () => {
    expect(hydrateAbility(stripAbility(ab({ ...(original as unknown as J), src: [5] })), lines, 'h', 'h')).toBeNull();
    const stored = stripAbility(original) as { effect: { steps: J[] } };
    stored.effect.steps[0]!['sentence'] = 9;
    expect(hydrateAbility(stored, lines, 'h', 'h')).toBeNull();
    expect(hydrateAbility({ kind: 'frobnicate' }, lines, 'h', 'h')).toBeNull();
  });
  it('a node with no sentence index takes the text of the whole ability; renderer-derived texts are left empty', () => {
    const a = ab({
      kind: 'spell', text: 'Choose one -- Draw a card.', src: [1],
      effect: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], modes: { min: 1, max: 1, options: [{ text: 'Draw a card.', program: { targets: [], steps: [{ op: 'manual', text: 'x', reason: 'r' }] } }] }, steps: [] },
    });
    const back = hydrateAbility(stripAbility(a), lines, 'h', 'h') as unknown as { text: string; effect: { targets: J[]; modes: { options: { text: string; program: { steps: J[] } }[] } } };
    expect(back.text).toBe('Flying');
    expect(back.effect.targets[0]!['text']).toBe('');
    expect(back.effect.modes.options[0]!.text).toBe('');
    expect(back.effect.modes.options[0]!.program.steps[0]!['text']).toBe('Flying');
  });
  it('round trip over the worked examples: strip(hydrate(strip(x))) equals strip(x), and the text of the ability comes back', () => {
    for (const ex of EXAMPLES) {
      for (const a of ex.faces.flatMap((f) => f.abilities)) {
        const withSrc = ab({ ...(a as unknown as J), src: [0] });
        const l: FaceLines = { lines: [(a as unknown as { text: string }).text], sentences: [[]] };
        const stored = stripAbility(withSrc);
        const back = hydrateAbility(stored, l, 'h', 'h');
        expect(back, ex.name).not.toBeNull();
        expect(stripAbility(back!), ex.name).toEqual(stored);
        expect((back as unknown as { text: string }).text, ex.name).toBe((a as unknown as { text: string }).text);
        expect(validateAbility(back!), ex.name).toEqual([]);
      }
    }
  });
});

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('matches node:crypto on strings of every length around the block boundaries, with non-ASCII text and astral characters', () => {
    const pieces = ['a', 'é', '—', '\u{1F600}', '{T}', '\n', 'Flying', '"', "'"];
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 200; n++) {
      let s = '';
      const len = n < 140 ? n : Math.floor(rnd() * 400);
      while (s.length < len) s += pieces[Math.floor(rnd() * pieces.length)];
      expect(sha256Hex(s), JSON.stringify(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

describe('textHash (design 12.3)', () => {
  const bolt = ['Lightning Bolt deals 3 damage to any target.'];
  it('is the SHA-256 of the normalized text of all faces, joined by a "//" line', () => {
    expect(textHash(bolt)).toBe(createHash('sha256').update(bolt[0]!).digest('hex'));
    expect(textHash(['A', 'B'])).toBe(createHash('sha256').update('A\n//\nB').digest('hex'));
  });
  it('does not depend on typography that differs between data sources', () => {
    const base = textHash(["Creatures you control have \"When this creature dies, draw a card.\"\nIt's fine."]);
    expect(textHash(['Creatures you control have “When this creature dies, draw a card.”\nIt’s fine.'])).toBe(base);
    expect(textHash(["Creatures  you control have \"When this creature dies, draw a card.\"\r\n\r\nIt's fine. "])).toBe(base);
    expect(textHash(['Café'])).toBe(textHash(['Café']));
  });
  it('depends on the words, the order of the lines and the faces', () => {
    expect(textHash(['Draw a card.'])).not.toBe(textHash(['Draw two cards.']));
    expect(textHash(['A\nB'])).not.toBe(textHash(['B\nA']));
    expect(textHash(['A', 'B'])).not.toBe(textHash(['B', 'A']));
    expect(textHash(['A', 'B'])).not.toBe(textHash(['A\nB']));
  });
});
