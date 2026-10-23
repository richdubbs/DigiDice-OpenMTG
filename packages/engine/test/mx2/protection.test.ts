/**
 * MX2: protection from the chosen color (CR 702.16a-e, 607.2d). "The chosen color" is quality `chosen:color` (parser/holes/misc.ts#qualityAt); the layers read
 * the color chosen by the linked "As ~ enters, choose a color" of the granting effect's SOURCE as they grant the keyword (statics/mods.ts), a resolved effect
 * stores the color itself (effects/handlers/lasting-fix.ts#fixChosen), and anywhere else the walker names a capability that is never registered.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, legalActions, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../src/index';
import { capabilitiesOf } from '../../src/model/capabilities';
import { getCard } from '../fixtures';
import { act, answer, find, pass, scenario } from '../m5/helpers';
import { cast, drive, equivalent, resolveTop, target } from '../m5/cr-examples/helpers';

const protections = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.filter((k) => k.keyword === 'protection').map((k) => k.quality ?? '?');

/** Answer the pending color choice with `color` (a color letter). */
function chooseColor(s: GameState, color: string): GameState {
  const p = s.pending as unknown as { kind: string; options?: unknown[] };
  if (p.kind === 'chooseColor') return answer(s, { kind: 'chooseColor', color } as unknown as DecisionAnswer);
  if (p.kind === 'chooseOption') {
    const words: Record<string, RegExp> = { W: /white|^W$/i, U: /blue|^U$/i, B: /black|^B$/i, R: /red|^R$/i, G: /green|^G$/i };
    const i = (p.options ?? []).findIndex((o) => words[color]!.test(typeof o === 'string' ? o : JSON.stringify(o)));
    const opt = (p.options ?? [])[i] as { id?: string } | undefined;
    return answer(s, (opt?.id !== undefined ? { kind: 'chooseOption', ids: [opt.id] } : { kind: 'chooseOption', index: i }) as unknown as DecisionAnswer);
  }
  throw new Error(`unexpected decision ${p.kind}`);
}

/** Cast a permanent spell of p1 and resolve it, choosing `color` as it enters. */
function castChoosing(s0: GameState, name: string, color: string): GameState {
  let s = cast(s0, name);
  s = pass(pass(s));
  s = chooseColor(s, color);
  return drive(s);
}

describe('MX2: the capability and the walker', () => {
  it('feature:quality.chosen is registered; a printed or nested keyword with a chosen quality names a capability that is not', () => {
    expect(ENGINE_CAPABILITIES.has('feature:quality.chosen')).toBe(true);
    const printed = { kind: 'keyword', keyword: 'protection', quality: 'chosen:color', text: 'Protection from the chosen color' };
    expect(capabilitiesOf(printed as unknown as AbilityDef)).toContain('feature:quality.chosen.printed');
    expect(ENGINE_CAPABILITIES.has('feature:quality.chosen.printed')).toBe(false);
    const grant = { kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [printed] }] }] };
    expect(capabilitiesOf(grant as unknown as AbilityDef)).toContain('feature:quality.chosen');
    const otherLink = { ...printed, quality: 'chosen:cardType' };
    expect(capabilitiesOf({ ...grant, effects: [{ ...grant.effects[0], mods: [{ layer: 6, add: [otherLink] }] }] } as unknown as AbilityDef)).toContain('feature:quality.chosen.cardType');
  });

  it('Voice of All and Ward Sliver are full on the game path', () => {
    for (const n of ['Voice of All', 'Ward Sliver']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });
});

describe('CR 702.16, 607.2d: Voice of All ("This creature has protection from the chosen color")', () => {
  const board = (): GameState => scenario(['Voice of All', 'Plains', 'Lightning Bolt', 'Mountain'], {
    p1: { hand: ['Voice of All'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] },
  });

  it('red chosen as it enters: protection from red; Lightning Bolt can\'t target it (CR 702.16b)', () => {
    const s = castChoosing(board(), 'Voice of All', 'R');
    const voice = find(s, 'Voice of All', 'battlefield');
    expect(protections(s, voice)).toEqual(['color:R']);
    const t = pass(s);
    expect(t.pending?.player).toBe('p2');
    const bolt = find(t, 'Lightning Bolt', 'hand', 'p2');
    const u = act(t, { type: 'cast', player: 'p2', card: bolt });
    const d = u.pending as unknown as { kind: string; options?: { id: string }[][]; targets?: unknown };
    expect(d.kind).toBe('chooseTargets');
    expect(JSON.stringify(d)).toContain('p1'); // the player is a legal target: the list is not empty
    expect(JSON.stringify(d)).not.toContain(`"${voice}"`);
  });

  it('blue chosen: no protection from red; a red source\'s damage is dealt (CR 702.16e applies only to the chosen color)', () => {
    let s = castChoosing(board(), 'Voice of All', 'U');
    const voice = find(s, 'Voice of All', 'battlefield');
    expect(protections(s, voice)).toEqual(['color:U']);
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') }), [target(voice)]);
    s = resolveTop(s);
    expect(s.zones.battlefield.includes(voice)).toBe(false);
  });

  it('no color was chosen (put onto the battlefield by a test, never entering through its replacement): no protection at all, never "from nothing"', () => {
    const s = scenario(['Voice of All'], { p1: { battlefield: ['Voice of All'] } });
    expect(protections(s, find(s, 'Voice of All', 'battlefield'))).toEqual([]);
  });
});

describe('CR 707.5, 607.2d: Clone entering as a copy of Voice of All makes its own choice', () => {
  it('Clone copies Voice of All and chooses green: protection from green (the copied pair of linked abilities reads the own choice of the Clone)', () => {
    let s = scenario(['Clone', 'Voice of All', 'Island'], { p1: { hand: ['Clone'], battlefield: ['Island', 'Island', 'Island', 'Island'] }, p2: { battlefield: ['Voice of All'] } });
    const voice = find(s, 'Voice of All', 'battlefield');
    s = cast(s, 'Clone');
    s = pass(pass(s));
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      const k = s.pending.kind;
      if (k === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [voice] });
      else if (k === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true } as DecisionAnswer);
      else s = chooseColor(s, 'G');
    }
    const clone = find(s, 'Clone', 'battlefield');
    expect(getChars(s, clone).name).toBe('Voice of All');
    expect(protections(s, clone)).toEqual(['color:G']);
    expect(protections(s, voice)).toEqual([]); // the original entered without a choice in this test
  });
});

describe('CR 607.2d: Ward Sliver ("All Slivers have protection from the chosen color"): the choice is the source\'s', () => {
  it('Muscle Sliver gets protection from the color chosen as Ward Sliver entered', () => {
    let s = scenario(['Ward Sliver', 'Muscle Sliver', 'Plains'], { p1: { hand: ['Ward Sliver'], battlefield: ['Muscle Sliver', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    s = castChoosing(s, 'Ward Sliver', 'B');
    expect(protections(s, find(s, 'Muscle Sliver', 'battlefield'))).toEqual(['color:B']);
    expect(protections(s, find(s, 'Ward Sliver', 'battlefield'))).toEqual(['color:B']);
  });
});

describe('CR 608.2h, 611.2c: a resolved effect stores the chosen color (lasting-fix.ts#fixChosen)', () => {
  const WARD: CardDef = equivalent({ name: 'Test Prismatic Ward', type_line: 'Instant', mana_cost: '{0}' }, [{
    kind: 'spell', text: 'Choose a color. Target creature gains protection from the chosen color until end of turn.',
    effect: {
      targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }],
      steps: [
        { op: 'chooseValue', who: { ref: 'you' }, what: 'color', as: 'color', link: 'color' },
        { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't1' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'protection', quality: 'chosen:color', text: 'protection from the chosen color' }] }] }] },
      ],
    },
  } as unknown as AbilityDef]);

  it('green chosen: the creature has protection from green until end of turn, stored as color:G', () => {
    let s = scenario(['Grizzly Bears'], { p1: { hand: ['Test Prismatic Ward'], battlefield: ['Grizzly Bears'] }, defs: [WARD] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = cast(s, 'Test Prismatic Ward', [target(bears)]);
    s = pass(pass(s));
    s = drive(chooseColor(s, 'G'));
    expect(protections(s, bears)).toEqual(['color:G']);
    const rec = s.continuousEffects.at(-1)!;
    expect(JSON.stringify(rec.effect)).toContain('"quality":"color:G"');
    expect(JSON.stringify(rec.effect)).not.toContain('chosen:color');
    expect(legalActions(s, 'p1').length).toBeGreaterThan(0);
  });
});
