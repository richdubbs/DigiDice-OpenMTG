/**
 * `getChars` through `computeAll` with a cache (design 9.2): the answer must be the same cached and uncached, whoever changed the state and however
 * (in place during an action, by a test, by hand); a state without layer sources must not pay for the layers; results are the caller's own arrays;
 * last known information carries the layered characteristics; redacted views keep working.
 */
import { describe, expect, it } from 'vitest';
import { EngineBug, getChars, viewFor, type AbilityDef, type GameState, type ObjectId } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import { cloneState } from '../../../src/util/clone';
import { charsOfObject, allChars, CHARS_CACHE_STATS } from '../../../src/rules/characteristics';
import { computeAll } from '../../../src/statics/layers';
import { layerSourcesPresent } from '../../../src/statics/live';
import { scenario } from '../helpers';
import { board, continuous, creature, each, enchantment, nth, SELF, staticOf, tweak } from './fixtures';

const FLYING: AbilityDef = { kind: 'keyword', text: 'Flying', keyword: 'flying' };
const count = { q: 'count', of: each({ types: ['Creature'], controller: 'you' }) } as const;

const ANTHEM = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
const SKYLORD = creature('Test Skylord', '2', '2', [staticOf('Other creatures you control have flying.', [continuous(each({ types: ['Creature'], controller: 'you', other: true }), [{ layer: 6, add: [FLYING] }])])]);
const STAR = creature('Test Star', '*', '*', [staticOf('Test Star\'s power and toughness are each equal to the number of creatures you control.', [continuous(SELF, [{ layer: '7a', power: count, toughness: count }], true)])]);
const DYE = enchantment('Test Dye', '{1}{U}', [staticOf('Each creature is blue.', [continuous(each({ types: ['Creature'] }), [{ layer: 5, colors: { set: ['U'] } }])])]);
const BEAR = creature('Test Bear', '2', '2');

const layered = (): GameState => board([ANTHEM, SKYLORD, STAR, DYE, BEAR], ['Test Anthem', 'Test Skylord', 'Test Star', 'Test Bear', 'Test Bear'], ['Test Dye', 'Test Bear']);

const allIds = (s: GameState): ObjectId[] => Object.keys(s.objects);
const fresh = (s: GameState, id: ObjectId) => computeAll(s).get(id);

describe('a state without layer sources is computed one object at a time, and the answer is the same as the full computation', () => {
  it('real cards with counters: layerSourcesPresent is false and getChars equals computeAll for every object', () => {
    const s = scenario(['Grizzly Bears', 'Serra Angel', 'Forest', 'Mind Stone'], {
      p1: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 2, '-1/-1': 1 } }, { name: 'Serra Angel', counters: { deathtouch: 1 } }, 'Forest', 'Mind Stone'], hand: ['Grizzly Bears'] },
    });
    expect(layerSourcesPresent(s)).toBe(false);
    for (const id of allIds(s)) expect(getChars(s, id), id).toEqual(fresh(s, id));
    const bears = nth(s, 'Grizzly Bears');
    expect([getChars(s, bears).power, getChars(s, bears).toughness]).toEqual(['3', '3']);
    expect(getChars(s, nth(s, 'Serra Angel')).keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['flying', 'vigilance', 'deathtouch']));
  });

  it('costs nothing in the cache: no layered computation happens for such a state', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const before = CHARS_CACHE_STATS.misses + CHARS_CACHE_STATS.hits;
    for (let i = 0; i < 50; i++) getChars(s, nth(s, 'Grizzly Bears'));
    expect(CHARS_CACHE_STATS.misses + CHARS_CACHE_STATS.hits).toBe(before);
  });

  it('a state becomes layered the moment an object with a static continuous effect, or a resolved continuous effect, exists', () => {
    const plain = board([BEAR], ['Test Bear']);
    expect(layerSourcesPresent(plain)).toBe(false);
    expect(layerSourcesPresent(board([BEAR, ANTHEM], ['Test Bear', 'Test Anthem']))).toBe(true);
    const withRecord = tweak(plain, (t) => {
      t.continuousEffects.push({ id: `e${t.counters.effect++}`, source: null, sourceName: 'x', controller: 'p1', timestamp: 99, startedTurn: 1, duration: { d: 'endOfTurn' }, effect: continuous({ ref: 'fixed', objects: [] }, []) });
    });
    expect(layerSourcesPresent(withRecord)).toBe(true);
  });

  it('the answer follows the state when an object is added later (a new object has a new id)', () => {
    const s = board([BEAR, ANTHEM], ['Test Bear']);
    expect(layerSourcesPresent(s)).toBe(false);
    expect(getChars(s, nth(s, 'Test Bear')).power).toBe('2');
    // put an anthem onto the battlefield the way the scenario helper does (a fresh id from the counter)
    const t = tweak(s, (x) => {
      const id = `o${x.counters.object++}`;
      x.objects[id] = { ...x.objects[nth(x, 'Test Bear')]!, id, defId: 'Test Anthem', counters: {}, timestamp: x.counters.timestamp++ };
      x.zones.battlefield.push(id);
    });
    expect(getChars(t, nth(t, 'Test Bear')).power).toBe('3');
  });
});

describe('cached vs uncached equality on a layered state', () => {
  it('the cache is used: two calls on the same unchanged state compute once', () => {
    const s = layered();
    const id = nth(s, 'Test Bear');
    allChars(s); // warm
    const hits = CHARS_CACHE_STATS.hits;
    const misses = CHARS_CACHE_STATS.misses;
    for (let i = 0; i < 20; i++) getChars(s, id);
    expect(CHARS_CACHE_STATS.misses).toBe(misses);
    expect(CHARS_CACHE_STATS.hits).toBe(hits + 20);
  });

  it('every object, cached or not, has the same characteristics', () => {
    const s = layered();
    for (const id of allIds(s)) expect(getChars(s, id), id).toEqual(fresh(s, id));
    const star = nth(s, 'Test Star');
    expect(getChars(s, star).power).toBe('5'); // p1 controls the skylord, the star and two bears: 4, and the anthem adds 1
  });

  it('edits made IN PLACE to the very same state object are seen at once: tapped, counters, controller, life, phasing, attachment, zone, effects', () => {
    const s = layered();
    const bears = [nth(s, 'Test Bear', 0), nth(s, 'Test Bear', 1), nth(s, 'Test Bear', 2)];
    const star = nth(s, 'Test Star');
    const check = (what: string): void => {
      for (const id of allIds(s)) expect(getChars(s, id), `${what}: ${id}`).toEqual(fresh(s, id));
    };
    check('initial');
    const before = getChars(s, bears[0]!).power;
    s.objects[bears[0]!]!.counters['+1/+1'] = 2;
    check('counters');
    expect(Number(getChars(s, bears[0]!).power)).toBe(Number(before) + 2);
    s.objects[bears[0]!]!.controller = 'p2';
    check('controller');
    s.objects[bears[1]!]!.phasedOut = true;
    check('phasing');
    s.objects[bears[1]!]!.phasedOut = false;
    s.players[0]!.life = 3;
    check('life');
    s.objects[star]!.zone = 'graveyard';
    s.zones.battlefield = s.zones.battlefield.filter((x) => x !== star);
    s.zones.graveyard['p1']!.push(star);
    check('zone');
    s.objects[bears[2]!]!.tapped = true;
    check('tapped');
    s.continuousEffects.push({ id: 'e900', source: null, sourceName: 'x', controller: 'p1', timestamp: 900, startedTurn: 1, duration: { d: 'endOfTurn' }, effect: continuous({ ref: 'fixed', objects: [{ id: bears[2]!, zone: 'battlefield' }] }, [{ layer: '7b', power: 7, toughness: 7 }]) });
    check('effect added');
    expect(getChars(s, bears[2]!).power).toBe('7'); // p2's bear: set to 7, and p1's anthem does not reach it
    s.continuousEffects.pop();
    check('effect removed');
    s.turn.activePlayer = 'p2';
    check('turn');
  });

  it('after random edits (seeded), cached and uncached agree for every object every time', () => {
    const s = layered();
    let seed = 12345;
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const ids = s.zones.battlefield.slice();
    for (let step = 0; step < 150; step++) {
      const id = ids[rnd(ids.length)]!;
      const o = s.objects[id]!;
      switch (rnd(7)) {
        case 0: o.counters['+1/+1'] = rnd(3); break;
        case 1: o.counters['-1/-1'] = rnd(3); break;
        case 2: o.controller = o.controller === 'p1' ? 'p2' : 'p1'; break;
        case 3: o.tapped = !o.tapped; break;
        case 4: o.phasedOut = !o.phasedOut; break;
        case 5: s.players[rnd(2)]!.life = rnd(30); break;
        default: o.counters['flying'] = rnd(2); break;
      }
      const probe = ids[rnd(ids.length)]!;
      expect(getChars(s, probe), `step ${step}`).toEqual(fresh(s, probe));
      if (step % 25 === 0) for (const x of allIds(s)) expect(getChars(s, x), `step ${step} ${x}`).toEqual(fresh(s, x));
    }
  });

  it('a clone of the state is a different state with its own cache entry', () => {
    const s = layered();
    const id = nth(s, 'Test Bear');
    const power = getChars(s, id).power;
    const t = cloneState(s);
    t.objects[id]!.counters['+1/+1'] = 5;
    expect(getChars(t, id).power).toBe(String(Number(power) + 5));
    expect(getChars(s, id).power).toBe(power);
  });
});

describe('results belong to the caller (design 4.3, hazards 2-3)', () => {
  it.each([['layer-free', () => scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }), 'Grizzly Bears'], ['layered', layered, 'Test Bear']] as const)(
    '%s: every call returns its own arrays, and editing one result changes neither the next call nor the cache',
    (_n, make, name) => {
      const s = make();
      const id = nth(s, name);
      const a = getChars(s, id);
      const b = getChars(s, id);
      for (const key of ['types', 'colors', 'supertypes', 'subtypes', 'abilities', 'keywords', 'names', 'cantHave'] as const) expect(a[key], key).not.toBe(b[key]);
      a.types.push('Land');
      a.keywords.push(FLYING as never);
      a.abilities.length = 0;
      a.power = '99';
      const c = getChars(s, id);
      expect(c.types).not.toContain('Land');
      expect(c.keywords.length).toBe(b.keywords.length);
      expect(c.abilities.length).toBe(b.abilities.length);
      expect(c.power).toBe(b.power);
    },
  );
});

describe('last known information, copies and views', () => {
  it('CR 608.2h: the characteristics stored when an object leaves include every effect on it at that moment', () => {
    const s = layered();
    const bear = nth(s, 'Test Bear');
    const power = getChars(s, bear).power; // 3: the anthem
    const g = new Game(cloneState(s));
    moveObject(g, bear, 'graveyard', { cause: 'test' });
    expect(g.s.lki[bear]!.chars!.power).toBe(power);
    expect(g.s.lki[bear]!.chars!.colors).toEqual(['U']); // the dye
    expect(g.s.lki[bear]!.chars!.keywords.map((k) => k.keyword)).toEqual(['flying']); // the skylord
  });

  it('an object that is not the one in the state (a copy with edits) is computed as though the state held it', () => {
    const s = layered();
    const bear = s.objects[nth(s, 'Test Bear')]!;
    const edited = { ...bear, counters: { '+1/+1': 4 } };
    expect(charsOfObject(s, edited).power).toBe(String(Number(getChars(s, bear.id).power) + 4));
    expect(getChars(s, bear.id).power).not.toBe(charsOfObject(s, edited).power); // the state is untouched
  });

  it('a redacted view (hidden cards have no definition) still answers for the visible objects, with the layers, and fails as before for a hidden one', () => {
    const s = tweak(layered(), (t) => {
      // one of p2's cards is in its hand
      const id = `o${t.counters.object++}`;
      t.objects[id] = { ...t.objects[nth(t, 'Test Bear', 0)]!, id, zone: 'hand', owner: 'p2', controller: 'p2' };
      t.zones.hand['p2']!.push(id);
    });
    const view = viewFor(s, 'p1') as unknown as GameState;
    const hiddenId = view.zones.hand['p2']![view.zones.hand['p2']!.length - 1]!; // m4 (audit 2026-10-12): under the view's alias
    expect(view.objects[hiddenId]!.defId).toBe('__hidden__');
    const bear = nth(s, 'Test Bear');
    expect(getChars(view, bear)).toEqual(getChars(s, bear));
    expect(() => getChars(view, hiddenId)).toThrow(EngineBug);
  });
});
