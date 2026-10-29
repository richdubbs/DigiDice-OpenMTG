/**
 * Godot plan phase 2 (view schema 2, core/view-chars.ts): every view carries the characteristics summary of each object its viewer may see. Checked over
 * the states of a random face-down game (morph, disguise, cloak; face-down permanents turned up and down) and a real game, for both players and a
 * spectator: the summary is exactly what `getChars` gives for the object (CR 613: after the layers), a blank card (`HIDDEN_DEF`: libraries, another
 * player's hand) has none, a face-down permanent the viewer may not look at has the face-down characteristics the engine gives it (CR 708.2a), and the
 * summary is a pure function of the state (the view of a fresh copy of the state is the same).
 */
import { describe, expect, it } from 'vitest';
import {
  ENGINE_VIEW_SCHEMA, HIDDEN_DEF, adaptRecordedView, applyAction, createGame, getChars, isSummoningSick, legalActions, ptNumbers, readsViewSchema, viewFor,
  type Action, type GameConfig, type GameState, type GameView, type PlayerId, type ViewChars,
} from '../../src/index';
import { readAbility } from '../../src/core/view-chars';
import { compiledDefs } from '../fixtures';
import { Bot } from '../m3/bot';
import { synthetic } from '../m6/face-down/support';
import { realChoose, realConfig } from '../perf/decks';

const SYNTH = [
  synthetic('Test Shroud Tailor', 'Creature — Human Rogue', '{1}{U}', 'When this creature enters, cloak the top card of your library.', { power: '1', toughness: '1' }),
  synthetic('Test Mask Weaver', 'Creature — Human Wizard', '{1}{U}', '{1}: Turn target face-down creature face up.', { power: '1', toughness: '2' }),
];
const ALICE = ['Exalted Angel', 'Den Protector', 'Grinning Demon', 'Test Shroud Tailor', 'Lightning Bolt', 'Glorious Anthem'];
const BOB = ['Willbender', 'Alley Assailant', 'Test Mask Weaver', 'Counterspell', 'Shock', 'Clone'];
const LANDS = ['Plains', 'Island', 'Swamp', 'Mountain'];

function deckOf(cards: string[]): string[] {
  const out = [...cards, ...cards, ...cards];
  while (out.length < 40) out.push(LANDS[out.length % LANDS.length]!);
  return out;
}

function faceDownConfig(seed: string): GameConfig {
  return {
    seed,
    players: [{ name: 'Alice', deck: deckOf(ALICE), stops: { fullControl: true } }, { name: 'Bob', deck: deckOf(BOB), stops: { fullControl: true } }],
    defs: [...compiledDefs([...new Set([...ALICE, ...BOB, ...LANDS])].filter((n) => !n.startsWith('Test '))), ...SYNTH],
    options: { skipMulligans: true },
  };
}

/** A random game in which the face-down actions (morph, disguise, turning face up) are taken whenever offered. */
function faceDownGame(seed: string, budget: number): GameState[] {
  const bot = new Bot(seed);
  let s = createGame(faceDownConfig(seed));
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

function realGame(index: number, budget: number): GameState[] {
  let s = createGame(realConfig(index));
  const states = [s];
  for (let i = 0; i < budget && !s.result; i++) {
    const r = applyAction(s, realChoose(s));
    if (r.error) throw new Error(r.error.message);
    s = r.state;
    states.push(s);
  }
  return states;
}

const VIEWERS: (PlayerId | null)[] = ['p1', 'p2', null];

/** What the summary of `id` must be: `getChars` of the object in `s`, reduced as core/view-chars.ts documents. */
function expected(s: GameState, id: string): ViewChars | null {
  let c;
  try {
    c = getChars(s, id);
  } catch {
    return null;
  }
  const o = s.objects[id]!;
  const pt = ptNumbers(c);
  return {
    name: c.name, manaCost: c.manaCost, manaValue: c.manaValue, colors: c.colors, supertypes: c.supertypes, types: c.types, subtypes: c.subtypes,
    controller: c.controller, keywords: c.keywords.map((k) => k.keyword),
    ...(c.power !== undefined || c.toughness !== undefined ? { power: pt.power, toughness: pt.toughness } : {}),
    ...(c.loyalty !== undefined ? { loyalty: c.loyalty } : {}),
    ...(c.defense !== undefined ? { defense: c.defense } : {}),
    ...(o.zone === 'battlefield' ? { summoningSick: isSummoningSick(s, o, c) } : {}),
  } as ViewChars;
}

interface Tally { compared: number; hidden: number; faceDownHidden: number }

function check(s: GameState, viewer: PlayerId | null, label: string, t: Tally): GameView {
  const v = viewFor(s, viewer);
  const chars = v.chars!;
  expect(chars, label).toBeDefined();
  // nothing for a blank card; an entry for every object the view shows (a face-down one the viewer may not look at too)
  for (const [vid, o] of Object.entries(v.objects)) {
    if (o.defId === HIDDEN_DEF) {
      expect(chars[vid], `${label} ${vid} hidden`).toBeUndefined();
      t.hidden++;
    }
  }
  for (const id of Object.keys(chars)) expect(v.objects[id]?.defId, `${label} ${id} has an entry and is shown`).not.toBe(HIDDEN_DEF);
  // the summary equals getChars of the state the view is made of (the state as it is: no action in progress here)
  if (s.suspended === null) {
    for (const [id, o] of Object.entries(v.objects)) {
      if (o.defId === HIDDEN_DEF) continue;
      const want = expected(s, id);
      const got = chars[id];
      if (want === null) {
        expect(got, `${label} ${id}`).toBeUndefined();
        continue;
      }
      const { abilities, ...rest } = got!;
      expect(rest, `${label} ${id}`).toEqual(want);
      const c = getChars(s, id);
      expect(abilities.map((a) => a.key), `${label} ${id} ability keys`).toEqual(c.abilities.map((a) => a.key));
      for (const a of abilities) {
        expect(typeof a.text, `${label} ${id} ${a.key}`).toBe('string');
        expect(a.text.length, `${label} ${id} ${a.key}`).toBeGreaterThan(0);
        expect(a.text.startsWith('[cannot render'), `${label} ${id} ${a.key}: ${a.text}`).toBe(false);
      }
      if (s.objects[id]!.faceDown && viewer !== s.objects[id]!.controller && viewer !== null && !s.objects[id]!.revealedTo?.includes(viewer)) {
        // CR 708.2a: what the viewer is shown of a face-down permanent it may not look at is the face-down profile, the same as getChars gives
        expect(got!.name).toBe('');
        expect(got!.types).toEqual(['Creature']);
        t.faceDownHidden++;
      }
      t.compared++;
    }
  }
  return v;
}

describe('Godot plan phase 2: the characteristics summary of a view (view schema 2)', () => {
  it('face-down games: equals getChars for every object a viewer may see, none for a blank card, the face-down profile for a face-down one', () => {
    const t: Tally = { compared: 0, hidden: 0, faceDownHidden: 0 };
    for (const seed of ['view-chars-0', 'view-chars-1']) {
      const states = faceDownGame(seed, 220);
      states.forEach((s, i) => {
        if (i % 3 !== 0 && i !== states.length - 1) return;
        for (const v of VIEWERS) check(s, v, `${seed} #${i} ${v}`, t);
      });
    }
    expect(t.compared).toBeGreaterThan(1000);
    expect(t.hidden).toBeGreaterThan(1000);
    expect(t.faceDownHidden).toBeGreaterThan(0);
  }, 300_000);

  it('a real game (continuous effects, combat, the stack): equals getChars for every visible object of every third state', () => {
    const t: Tally = { compared: 0, hidden: 0, faceDownHidden: 0 };
    const states = realGame(1, 300);
    states.forEach((s, i) => {
      if (i % 3 === 0) for (const v of VIEWERS) check(s, v, `real #${i} ${v}`, t);
    });
    expect(t.compared).toBeGreaterThan(500);
  }, 300_000);

  it('is a pure function of the state: the view of a fresh copy has the same summary, every reading is the uncached one, a known card reads as its text', () => {
    const states = faceDownGame('view-chars-2', 160);
    let readings = 0;
    for (const s of [states[20]!, states[80]!, states.at(-1)!]) {
      for (const v of VIEWERS) {
        const view = viewFor(s, v);
        expect(JSON.stringify(view.chars)).toBe(JSON.stringify(viewFor(structuredClone(s), v).chars));
        // cached against uncached (the readings are memoized per ability definition: core/view-chars.ts BY_DEF, BY_JSON)
        for (const [id, c] of Object.entries(view.chars!)) {
          const chars = getChars(s, id);
          const names = chars.names.length > 0 ? chars.names : [chars.name];
          const types = [...chars.supertypes, ...chars.types, ...chars.subtypes];
          chars.abilities.forEach((a, i) => {
            expect(c.abilities[i]!.text, `${id} ${a.key}`).toBe(readAbility(a.def, names, types));
            expect(Object.isFrozen(c.abilities[i])).toBe(true);
            readings++;
          });
        }
      }
    }
    expect(readings).toBeGreaterThan(50);
    const s = states.at(-1)!;
    const v = viewFor(s, 'p1');
    const bolt = Object.entries(v.chars!).find(([, c]) => c.name === 'Lightning Bolt');
    if (bolt) expect(bolt[1].abilities.map((a) => a.text)).toEqual(['Lightning Bolt deals 3 damage to any target.']);
  }, 300_000);

  it('view schema 2 reads schema-1 recordings through an adapter that keeps the view as it is', () => {
    expect(ENGINE_VIEW_SCHEMA).toBe(2);
    expect(readsViewSchema(1)).toBe(true);
    expect(readsViewSchema(2)).toBe(true);
    expect(readsViewSchema(3)).toBe(false);
    expect(readsViewSchema(0)).toBe(false);
    const view = { viewer: 'p1' };
    expect(adaptRecordedView(view, 1)).toBe(view);
    expect(() => adaptRecordedView(view, 3)).toThrow(/cannot be read/);
  });
});
