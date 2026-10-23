/**
 * WP18: contract C1 (design 12.1): compileCardV2 is total. Random garbage text and malformed card objects never throw, never drop a card, and never
 * produce an automated ability that fails the schema and lint (whatever is not understood is manual). Seeded (src/rng.ts), so a failure reproduces.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, compileCardV2, defaultCompileSources, spansOf, validateAbility, type CardDef, type OracleCard } from '../../../src/index';
import { randomInt, seedRng, type RngState } from '../../../src/rng';

const WORDS = [
  'target', 'creature', 'draw', 'a', 'card', 'cards', 'deals', 'damage', 'to', 'any', 'When', 'Whenever', 'this', 'enters', 'dies', 'you', 'control', 'each',
  'opponent', 'gets', '+1/+1', '-2/-2', 'until', 'end', 'of', 'turn', 'destroy', 'exile', 'return', 'it', 'its', 'owner\'s', 'hand', 'graveyard', 'library',
  'flying', 'Flying,', 'haste', 'Protection', 'from', 'black', 'and', 'Enchant', 'Equip', 'Kicker', 'X', '{T}:', '{1}{R}', '{X}', '{D}', 'Add', '{G}.', 'or',
  'unless', 'pays', 'may', 'instead', 'If', 'Then', 'that', 'player', '~', 'Test Card', '•', '—', '+1:', '−3:', 'I,', 'II', '—', '(', ')', '"', '.', ',', ':',
  'LEVEL', '1-4', '|', 'Choose', 'one', 'counter', 'counters', 'sacrifice', 'Activate', 'only', 'as', 'sorcery', ' ', '​', '’', 'Ω', '🂡',
];
const CHARS = 'abcXYZ{}()[]"\'.,:;—–-+/|•~\n\t 0123456789';
const LAYOUTS = ['normal', 'split', 'flip', 'transform', 'modal_dfc', 'meld', 'adventure', 'prepare', 'saga', 'class', 'case', 'leveler', 'mutate', 'prototype', 'token', 'emblem', 'planar', 'reversible_card', 'art_series', 'weird_new_layout'];
const COSTS = ['{1}{R}', '{X}{X}{G}', '', '{D}', '{C/P}', '{2/W}', '{B/P}', 'garbage', '{', '{}', '{100}', '{W}{U}{B}{R}{G}{S}{C}'];
const TYPES = ['Instant', 'Sorcery', 'Creature — Test', 'Legendary Planeswalker — Test', 'Enchantment — Aura', 'Artifact — Equipment', 'Land', 'Battle — Siege', '', 'Kindred Instant — Goblin', 'Token Creature — Soldier', 'Nonsense'];

const pick = <T,>(r: RngState, xs: readonly T[]): T => xs[randomInt(r, xs.length)]!;

function garbageText(r: RngState): string {
  const n = randomInt(r, 40);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const roll = randomInt(r, 10);
    if (roll < 7) parts.push(pick(r, WORDS));
    else if (roll < 9) parts.push(Array.from({ length: 1 + randomInt(r, 6) }, () => pick(r, [...CHARS])).join(''));
    else parts.push('\n');
  }
  return parts.join(randomInt(r, 4) === 0 ? '' : ' ');
}

function garbageFace(r: RngState): Record<string, unknown> {
  const f: Record<string, unknown> = { name: randomInt(r, 8) === 0 ? 7 : `Face ${randomInt(r, 100)}` };
  if (randomInt(r, 4) !== 0) f['oracle_text'] = randomInt(r, 12) === 0 ? 42 : garbageText(r);
  if (randomInt(r, 3) !== 0) f['mana_cost'] = pick(r, COSTS);
  if (randomInt(r, 3) !== 0) f['type_line'] = pick(r, TYPES);
  if (randomInt(r, 4) === 0) { f['power'] = pick(r, ['1', '*', '1+*', 'X']); f['toughness'] = pick(r, ['1', '*', '0']); }
  if (randomInt(r, 6) === 0) f['loyalty'] = pick(r, ['3', 'X']);
  if (randomInt(r, 8) === 0) f['colors'] = pick(r, [['R'], ['Q'], 'R', null]);
  if (randomInt(r, 10) === 0) f['color_indicator'] = ['U', 7];
  return f;
}

function garbageCard(r: RngState): OracleCard {
  const c: Record<string, unknown> = { ...garbageFace(r), name: `Fuzz ${randomInt(r, 1e6)}`, layout: pick(r, LAYOUTS) };
  if (randomInt(r, 3) === 0) c['oracle_id'] = `fuzz-${randomInt(r, 1e6)}`;
  if (randomInt(r, 3) === 0) c['card_faces'] = Array.from({ length: randomInt(r, 4) }, () => (randomInt(r, 10) === 0 ? null : garbageFace(r)));
  if (randomInt(r, 6) === 0) c['keywords'] = pick(r, [['Flying'], 'Flying', [3], null]);
  if (randomInt(r, 6) === 0) c['all_parts'] = pick(r, [[{ component: 'token', name: 'Soldier' }], [{ component: 'meld_result', name: 'X' }], 'parts', [null]]);
  return c as unknown as OracleCard;
}

function checkDef(def: CardDef, label: string): void {
  expect(def.faces.length, label).toBeGreaterThanOrEqual(1);
  expect(['full', 'partial', 'manual'], label).toContain(def.automation.level);
  for (const face of def.faces) {
    for (const a of face.abilities) {
      if (a.kind === 'manual') continue;
      expect(validateAbility(a).filter((i) => i.severity === 'error'), `${label}: ${JSON.stringify(a).slice(0, 200)}`).toEqual([]);
    }
  }
  def.faces.forEach((_, f) => expect(() => spansOf(def, f), label).not.toThrow());
}

describe('contract C1: compileCardV2 never throws (totality fuzz, seeded)', () => {
  it('2,000 random garbage cards: no exception, every card is kept, automated abilities pass schema and lint', () => {
    const r = seedRng('wp18-totality');
    const src = defaultCompileSources();
    for (let i = 0; i < 2000; i++) {
      const c = garbageCard(r);
      let def: CardDef | undefined;
      expect(() => { def = compileCardV2(c, src); }, `card ${i}: ${JSON.stringify(c).slice(0, 300)}`).not.toThrow();
      checkDef(def!, `card ${i}`);
    }
  }, 120_000);

  it('random text is never fully automated by accident unless every unit was understood (garbage made of unknown characters is manual)', () => {
    const r = seedRng('wp18-chars');
    for (let i = 0; i < 300; i++) {
      const text = Array.from({ length: 5 + randomInt(r, 40) }, () => pick(r, [...'qzxj{}()[]"|•~;'])).join('');
      const def = compileCard({ name: 'Fuzz', layout: 'normal', type_line: 'Instant', oracle_text: text } as OracleCard);
      if (text.trim() !== '') expect(def.automation.level, JSON.stringify(text)).toBe('manual');
    }
  });

  it('malformed objects (no name, null faces, non-string text, null itself) give a manual card, never an exception', () => {
    const src = defaultCompileSources();
    const nasty: unknown[] = [
      {}, { name: 'X' }, { name: 'X', layout: 'split', card_faces: [null, null] }, { name: 'X', layout: 'normal', oracle_text: 42 }, { name: 'X', layout: 'normal', card_faces: 'x' },
      { name: 'X', layout: 'transform', card_faces: [{ name: 'A', oracle_text: 'Flying' }, { oracle_text: null }] }, { name: 'X', layout: 'normal', mana_cost: '{Q}{', oracle_text: 'Flying' },
      null, undefined, 'Lightning Bolt', 7,
    ];
    for (const c of nasty) {
      let def: CardDef | undefined;
      expect(() => { def = compileCardV2(c as OracleCard, src); }, JSON.stringify(c)).not.toThrow();
      checkDef(def!, JSON.stringify(c) ?? String(c));
    }
    // not a card at all: one manual face, never "full"
    for (const c of [null, undefined, 'Lightning Bolt', 7]) expect(compileCardV2(c as unknown as OracleCard, src).automation.level, String(c)).toBe('manual');
    // an unreadable cost next to an understood keyword: the engine can't cast the card (CR 202.1b), so the card is manual (WP18 review)
    expect(compileCardV2({ name: 'X', layout: 'normal', type_line: 'Creature — Test', mana_cost: '{Q}{', oracle_text: 'Flying' } as OracleCard, src).automation.level).toBe('manual');
  });

  it('the fallback (something threw inside) is a manual card with the error as the reason', () => {
    const src = { ...defaultCompileSources(), get caps(): never { throw new Error('caps exploded'); } };
    const def = compileCardV2({ name: 'Test Boom', layout: 'normal', type_line: 'Instant', oracle_text: 'Draw a card.' } as OracleCard, src);
    expect(def.automation).toMatchObject({ level: 'manual', source: 'none' });
    expect(def.faces[0]!.abilities).toMatchObject([{ kind: 'manual', text: 'Draw a card.', reason: expect.stringContaining('caps exploded') }]);
  });
});
