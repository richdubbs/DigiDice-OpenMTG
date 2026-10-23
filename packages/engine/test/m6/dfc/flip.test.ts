/**
 * M6-4 (m6 design 3.6): flip (CR 710): `changeFace flip` sets the permanent flipped once (CR 710.4), on any permanent whose copiable values are a flip card's
 * (CR 110.5c), and the flipped status picks the half of any flip card it copies later (CR 707.3, the Tomoya example). `filter:flipped` is advertised.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, getChars } from '../../../src/index';
import { matchesFilter, NO_ENV } from '../../../src/rules/filter';

import { BOUNCE, cast, find, FLIP, lands, looks, onField, pick, resolveTop, scenario, SHAPESHIFT, target } from './support';

const AKKI = 'Akki Lavarunner // Tok-Tok, Volcano Born';
const JUSHI = 'Jushi Apprentice // Tomoya the Revealer';
const NEZUMI = 'Nezumi Shortfang // Stabwhisker the Odious';

describe('CR 710: flipping a permanent', () => {
  it('CR 710.2, 710.1c: Akki Lavarunner flips into Tok-Tok, Volcano Born: the flipped half\'s name, types and P/T, the color and mana cost of the normal half', () => {
    let s = scenario([AKKI], { p1: { battlefield: [AKKI], hand: ['Test Upend'] }, defs: [FLIP] });
    const id = onField(s, AKKI);
    s = resolveTop(cast(s, 'Test Upend', [target(id)]));
    expect(s.objects[id]!.flipped).toBe(true);
    expect(looks(s, id)).toMatchObject({ name: 'Tok-Tok, Volcano Born', pt: [2, 2], supertypes: ['Legendary'] });
    const c = getChars(s, id);
    expect(c.colors).toEqual(['R']);
    expect(c.manaValue).toBe(4);
    expect(s.log.map((l) => l.text)).toContain('Akki Lavarunner flips into Tok-Tok, Volcano Born.');
    expect(matchesFilter(s, s.objects[id]!, { flipped: true }, { you: 'p1', env: NO_ENV })).toBe(true);
    expect(matchesFilter(s, s.objects[id]!, { flipped: false }, { you: 'p1', env: NO_ENV })).toBe(false);
    expect(ENGINE_CAPABILITIES.has('filter:flipped') && ENGINE_CAPABILITIES.has('op:changeFace.flip') && ENGINE_CAPABILITIES.has('feature:ev.becomes.flipped')).toBe(true);
  });

  it('CR 710.4: flipping is one way (a second flip does nothing); a flipped permanent that leaves the battlefield retains no memory of it', () => {
    let s = scenario([AKKI], { p1: { battlefield: [AKKI], hand: ['Test Upend', 'Test Upend', 'Test Recall'] }, defs: [FLIP, BOUNCE] });
    const id = onField(s, AKKI);
    s = resolveTop(cast(s, 'Test Upend', [target(id)]));
    s = resolveTop(cast(s, 'Test Upend', [target(id)]));
    expect(looks(s, id).name).toBe('Tok-Tok, Volcano Born');
    expect(s.log.some((l) => /is already flipped/.test(l.text))).toBe(true);
    s = resolveTop(cast(s, 'Test Recall', [target(id)]));
    const card = find(s, AKKI, 'hand');
    expect(s.objects[card]!.flipped).toBe(false);
    expect(getChars(s, card).name).toBe('Akki Lavarunner');
  });

  it('a permanent that is not a flip card doesn\'t flip', () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'], hand: ['Test Upend'] }, defs: [FLIP] });
    const id = onField(s, 'Grizzly Bears');
    s = resolveTop(cast(s, 'Test Upend', [target(id)]));
    expect(s.objects[id]!.flipped).toBe(false);
    expect(s.log.some((l) => /doesn't flip: it is not a flip card/.test(l.text))).toBe(true);
  });
});

describe('CR 110.5c, 707.3: flipping and copy effects', () => {
  it('CR 110.5c: a Clone that copies an unflipped Jushi Apprentice can flip, and is then Tomoya the Revealer', () => {
    let s = scenario(['Clone', JUSHI, 'Island'], { p1: { hand: ['Clone', 'Test Upend'], battlefield: [JUSHI, ...lands('Island', 4)] }, defs: [FLIP] });
    s = resolveTop(cast(s, 'Clone'), [pick(onField(s, JUSHI))]);
    const clone = onField(s, 'Clone');
    expect(looks(s, clone).name).toBe('Jushi Apprentice');
    s = resolveTop(cast(s, 'Test Upend', [target(clone)]));
    expect(looks(s, clone)).toMatchObject({ name: 'Tomoya the Revealer', pt: [2, 3] });
  });

  it('CR 707.3 (the Tomoya example): a flipped Tomoya that becomes a copy of Nezumi Shortfang is Stabwhisker the Odious', () => {
    let s = scenario([JUSHI, NEZUMI], { p1: { battlefield: [JUSHI], hand: ['Test Upend', 'Test Shapeshift'] }, p2: { battlefield: [NEZUMI] }, defs: [FLIP, SHAPESHIFT] });
    const jushi = onField(s, JUSHI);
    s = resolveTop(cast(s, 'Test Upend', [target(jushi)]));
    expect(looks(s, jushi).name).toBe('Tomoya the Revealer');
    s = resolveTop(cast(s, 'Test Shapeshift', [target(jushi), target(find(s, NEZUMI, 'battlefield', 'p2'))]));
    expect(looks(s, jushi)).toMatchObject({ name: 'Stabwhisker the Odious', pt: [3, 3] });
  });
});
