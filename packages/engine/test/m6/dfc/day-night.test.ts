/**
 * M6-4 (m6 design 3.6, E14): day and night (core/day-night.ts): the untap-step check of the previous turn's active player's spells (CR 502.2, 731.2), the
 * immediate checks of daybound and nightbound (CR 702.145c-d, f-g), entering transformed at night (CR 702.145b), the `dayNight` event (CR 731.1a), and the
 * werewolf transforms read through the `lastTurn` history scope (which are not the day/night check).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, type AbilityDef, type GameState } from '../../../src/index';
import { cast, dfc, equivalent, find, lands, looks, onField, resolveAll, resolveTop, scenario, target, tweak, until } from './support';

const CATHAR = 'Brutal Cathar // Moonrage Brute';
const HUNTMASTER = 'Huntmaster of the Fells // Ravager of the Fells';
const KRUIN = 'Kruin Outlaw // Terror of Kruin Pass';

const daybound: AbilityDef = { kind: 'keyword', keyword: 'daybound', text: 'Daybound' } as AbilityDef;
const nightbound: AbilityDef = { kind: 'keyword', keyword: 'nightbound', text: 'Nightbound' } as AbilityDef;
/** A synthetic daybound / nightbound pair with nothing else (design 6.10: invented names). */
const WATCHER = dfc(
  { name: 'Test Dawn Watcher', type_line: 'Creature — Human Werewolf', mana_cost: '{1}', power: '1', toughness: '1', abilities: [daybound] },
  { name: 'Test Dusk Prowler', type_line: 'Creature — Werewolf', power: '4', toughness: '4', abilities: [nightbound] },
);
const W = 'Test Dawn Watcher // Test Dusk Prowler';

/** "Whenever day becomes night or night becomes day, you gain 1 life." (CR 731.1a) */
const SUNDIAL = equivalent({ name: 'Test Sundial', type_line: 'Enchantment' }, [{
  kind: 'triggered', text: 'Whenever day becomes night or night becomes day, you gain 1 life.', trigger: { on: [{ ev: 'dayNight' }] },
  effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] },
} as AbilityDef]);

/** "Put a card named Brutal Cathar from your hand onto the battlefield. Then if it's day, draw a card." (CR 702.145d mid-resolution) */
const SUMMONS = equivalent({ name: 'Test Summons', type_line: 'Sorcery', mana_cost: '{0}' }, [{
  kind: 'spell', text: "Put a card named Brutal Cathar from your hand onto the battlefield. Then if it's day, draw a card.",
  effect: {
    targets: [],
    steps: [
      { op: 'move', what: { ref: 'each', filter: { name: 'Brutal Cathar', zone: 'hand', owner: 'you' } }, to: { zone: 'battlefield', controller: { ref: 'you' } } },
      { op: 'if', cond: { cond: 'designation', who: { ref: 'you' }, what: 'day' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    ],
  },
} as AbilityDef]);

const at = (s: GameState, which: 'day' | 'night'): GameState => tweak(s, (x) => { x.designations.dayNight = which; });

describe('CR 702.145d, g: a daybound or nightbound permanent makes it day or night when it is neither', () => {
  it('Brutal Cathar entering mid-resolution makes it day before the next instruction (CR 702.145d: immediately, not a state-based action)', () => {
    let s = scenario([CATHAR], { p1: { hand: [CATHAR, 'Test Summons'] }, defs: [SUMMONS] });
    expect(s.designations.dayNight).toBeUndefined();
    const hand = s.zones.hand.p1!.length;
    s = resolveTop(cast(s, 'Test Summons'));
    expect(s.designations.dayNight).toBe('day');
    expect(s.zones.hand.p1!.length).toBe(hand - 2 + 1); // the sorcery and Cathar left; the card drawn because it was already day
    expect(s.log.some((l) => l.text === 'It becomes day.' && l.rules?.includes('CR 702.145d'))).toBe(true);
  });

  it('CR 702.145g: a nightbound permanent with no daybound permanent around makes it night; with a daybound one too, it becomes day (CR 702.145d)', () => {
    const s = scenario([], { p1: { battlefield: [{ name: W, face: 1 }] }, defs: [WATCHER] }); // the scenario reaches the main phase through state-based action checks
    expect(s.designations.dayNight).toBe('night');
    expect(s.log.some((l) => l.text === 'It becomes night.' && l.rules?.includes('CR 702.145g'))).toBe(true);
    const both = scenario([], { p1: { battlefield: [{ name: W, face: 1 }, W] }, defs: [WATCHER] });
    expect(both.designations.dayNight).toBe('day');
    // and as it became day, the back-face-up nightbound one transformed (CR 702.145f)
    expect(both.zones.battlefield.map((id) => looks(both, id).name).filter((n) => n.startsWith('Test'))).toEqual(['Test Dawn Watcher', 'Test Dawn Watcher']);
  });
});

describe('CR 502.2, 731.2: the untap step checks the previous turn\'s active player', () => {
  it('day becomes night when the previous turn\'s active player cast no spells; the daybound permanent transforms as it does (CR 702.145b-c)', () => {
    let s = at(scenario([], { p1: { battlefield: [W] }, defs: [WATCHER, SUNDIAL] }), 'day');
    s = tweak(s, (x) => { void x; });
    const id = onField(s, W);
    s = until(s, (t) => t.turn.number === 2 && t.turn.step === 'upkeep');
    expect(s.designations.dayNight).toBe('night');
    expect(looks(s, id)).toMatchObject({ name: 'Test Dusk Prowler', face: 1 });
    expect(s.log.some((l) => l.text === 'Day becomes night.' && l.rules?.includes('CR 502.2'))).toBe(true);
  });

  it('CR 502.2: an opponent\'s instant does not keep it day (only the active player\'s spells count)', () => {
    let s = at(scenario(['Giant Growth', 'Forest', 'Grizzly Bears'], { p1: { battlefield: [W] }, p2: { hand: ['Giant Growth'], battlefield: ['Forest', 'Grizzly Bears'] }, defs: [WATCHER] }), 'day');
    s = until(s, (t) => t.pending?.kind === 'priority' && t.pending.player === 'p2');
    s = resolveTop(cast(s, 'Giant Growth', [target(find(s, 'Grizzly Bears', 'battlefield', 'p2'))], 'p2'));
    s = until(s, (t) => t.turn.number === 2 && t.turn.step === 'upkeep');
    expect(s.designations.dayNight).toBe('night');
  });

  it('night becomes day when the previous turn\'s active player cast two or more spells; the nightbound permanent transforms back (CR 702.145e-f); the dayNight event triggers (CR 731.1a)', () => {
    let s = at(scenario(['Giant Growth', 'Forest'], { p1: { hand: ['Giant Growth', 'Giant Growth'], battlefield: [{ name: W, face: 1 }, 'Forest', 'Forest'] }, defs: [WATCHER, SUNDIAL] }), 'night');
    s = tweak(s, (x) => { void x; });
    const id = onField(s, W);
    s = resolveTop(cast(s, 'Giant Growth', [target(id)]));
    s = resolveTop(cast(s, 'Giant Growth', [target(id)]));
    s = until(s, (t) => t.turn.number === 2 && t.turn.step === 'upkeep');
    expect(s.designations.dayNight).toBe('day');
    expect(looks(s, id)).toMatchObject({ name: 'Test Dawn Watcher', face: 0 });
  });

  it('a dayNight trigger fires when day becomes night (CR 731.1a), not when it first becomes day', () => {
    let s = scenario([], { p1: { battlefield: [W, 'Test Sundial'] }, defs: [WATCHER, SUNDIAL] });
    s = until(s, (t) => t.designations.dayNight === 'day');
    s = until(s, (t) => t.turn.number === 2 && t.turn.step === 'upkeep' && t.pending?.kind === 'priority');
    s = resolveAll(s);
    expect(s.designations.dayNight).toBe('night');
    expect(s.players[0]!.life).toBe(21); // one change between day and night
    expect(ENGINE_CAPABILITIES.has('ev:dayNight')).toBe(true);
  });
});

describe('CR 702.145b: daybound permanents enter transformed at night', () => {
  it('a daybound creature cast at night enters with its back face up (the keyword\'s replacement effect, class 3 of CR 616.1d)', () => {
    let s = at(scenario([CATHAR, 'Plains'], { p1: { hand: [CATHAR], battlefield: lands('Plains', 3) } }), 'night');
    s = resolveTop(cast(s, CATHAR));
    const id = onField(s, CATHAR);
    expect(looks(s, id)).toMatchObject({ name: 'Moonrage Brute', face: 1 });
    expect(ENGINE_CAPABILITIES.has('keyword:daybound') && ENGINE_CAPABILITIES.has('keyword:nightbound')).toBe(true);
  });

  it('by day it enters front face up', () => {
    let s = at(scenario([CATHAR, 'Plains'], { p1: { hand: [CATHAR], battlefield: lands('Plains', 3) } }), 'day');
    s = resolveTop(cast(s, CATHAR));
    expect(looks(s, onField(s, CATHAR))).toMatchObject({ name: 'Brutal Cathar', face: 0 });
  });
});

describe('the werewolf transforms (lastTurn history scope): not the day/night check', () => {
  it('Kruin Outlaw transforms at the next upkeep when no spells were cast last turn', () => {
    let s = scenario([KRUIN], { p1: { battlefield: [KRUIN] } });
    const id = onField(s, KRUIN);
    s = until(s, (t) => t.turn.number === 2 && t.turn.step === 'upkeep' && t.zones.stack.length > 0);
    s = resolveTop(s);
    expect(looks(s, id)).toMatchObject({ name: 'Terror of Kruin Pass', face: 1 });
  });

  it('two players casting one spell each does not transform Ravager of the Fells; one player casting two does, and "whenever this transforms into ~" triggers', () => {
    const board = (): GameState => scenario([HUNTMASTER, 'Giant Growth', 'Forest', 'Grizzly Bears'], {
      p1: { hand: ['Giant Growth', 'Giant Growth'], battlefield: [{ name: HUNTMASTER, face: 1 }, 'Forest', 'Forest', 'Grizzly Bears'] },
      p2: { hand: ['Giant Growth'], battlefield: ['Forest', 'Grizzly Bears'] },
    });
    // one each
    let s = board();
    const id = onField(s, HUNTMASTER);
    s = resolveTop(cast(s, 'Giant Growth', [target(find(s, 'Grizzly Bears', 'battlefield', 'p1'))]));
    s = until(s, (t) => t.pending?.kind === 'priority' && t.pending.player === 'p2');
    s = resolveTop(cast(s, 'Giant Growth', [target(find(s, 'Grizzly Bears', 'battlefield', 'p2'))], 'p2'));
    s = until(s, (t) => t.turn.number === 2 && t.turn.step === 'draw');
    expect(looks(s, id)).toMatchObject({ name: 'Ravager of the Fells', face: 1 });
    // two by one player
    let u = board();
    u = resolveTop(cast(u, 'Giant Growth', [target(find(u, 'Grizzly Bears', 'battlefield', 'p1'))]));
    u = resolveTop(cast(u, 'Giant Growth', [target(find(u, 'Grizzly Bears', 'battlefield', 'p1'))]));
    u = until(u, (t) => t.turn.number === 2 && t.turn.step === 'upkeep' && t.zones.stack.length > 0);
    u = resolveTop(u);
    expect(looks(u, id)).toMatchObject({ name: 'Huntmaster of the Fells', face: 0 });
    expect(u.zones.stack.length).toBe(1); // "Whenever this creature enters or transforms into Huntmaster of the Fells" triggered
    const life = u.players[0]!.life;
    u = resolveTop(u);
    expect(u.players[0]!.life).toBe(life + 2);
  });
});

describe('CR 702.145c, 712.9: a copy of a daybound card that is not double-faced', () => {
  /** "It becomes night." (op:designate.night) */
  const DUSK = equivalent({ name: 'Test Early Dusk', type_line: 'Sorcery', mana_cost: '{0}' }, [{
    kind: 'spell', text: 'It becomes night.', effect: { targets: [], steps: [{ op: 'designate', who: { ref: 'you' }, what: 'night' }] },
  } as AbilityDef]);

  it('a Clone that copies a daybound creature keeps daybound but never transforms as it becomes night; the original does, at once (CR 702.145b)', () => {
    let s = at(scenario(['Clone', 'Island'], { p1: { hand: ['Clone', 'Test Early Dusk'], battlefield: lands('Island', 4) }, p2: { battlefield: [W] }, defs: [WATCHER, DUSK] }), 'day');
    const watcher = find(s, W, 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Clone'), [{ kind: 'chooseObjects', ids: [watcher] }]);
    const clone = find(s, 'Clone', 'battlefield');
    expect(looks(s, clone)).toMatchObject({ name: 'Test Dawn Watcher', face: 0 });
    s = resolveTop(cast(s, 'Test Early Dusk'));
    expect(s.designations.dayNight).toBe('night');
    expect(looks(s, watcher)).toMatchObject({ name: 'Test Dusk Prowler', face: 1 });
    expect(looks(s, clone)).toMatchObject({ name: 'Test Dawn Watcher', face: 0 });
    expect(s.log.filter((l) => /doesn't transform/.test(l.text))).toEqual([]);
  });
});
