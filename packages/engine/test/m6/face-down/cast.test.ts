/**
 * M6-3 (m6 design 3.4 "Casting face down"): morph, megamorph and disguise cast face down for {3} through the cast option providers
 * (actions/cast-opt/face-down.ts), the face-down spell, its resolution face down (CR 708.4) and the reveal of a face-down spell that leaves the stack for any
 * other zone, or of a face-down permanent that leaves the battlefield (CR 708.9).
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions } from '../../../src/index';
import { castMethods } from '../../../src/actions/cast';
import { charsOfObject } from '../../../src/rules/characteristics';
import { deny } from '../../../src/rules/denial';
import { withStatics } from '../../m5/helpers';
import { act, answer, castFaceDown, drive, faceDownOf, find, lands, logFor, putFaceDown, resolveTop, scenario, synthetic, viewChars, viewFor } from './support';

const GAIN = synthetic('Test Veiled Healer', 'Creature — Human Cleric', '{3}{W}', 'When this creature enters, you gain 5 life.\nMorph {1}{W}');

const angelHand = () => scenario(['Exalted Angel', 'Plains'], { p1: { hand: ['Exalted Angel'], battlefield: lands('Plains', 7) } });

describe('CR 702.37c, 708.4: casting a card with morph face down', () => {
  it('the card offers the method "morph"; the spell is a face-down 2/2 creature spell with no name and mana value 0, paid with {3}', () => {
    let s = angelHand();
    const card = find(s, 'Exalted Angel', 'hand');
    expect(castMethods(s, card, 0)).toContain('morph');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === card && (a.action as { method?: string }).method === 'morph')).toBe(true);
    // AF2 (FINAL6 audit): the face-down spell has no name (CR 708.2a); the label says so instead of "Cast  (morph)"
    expect(legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === card && (a.action as { method?: string }).method === 'morph')?.label).toBe('Cast face down (morph)');
    s = castFaceDown(s, 'Exalted Angel');
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.faceDown).toBe(true);
    expect(spell.faceDownInfo).toEqual({ by: 'morph', profile: 'plain' });
    expect(getChars(s, spell.id)).toMatchObject({ name: '', types: ['Creature'], manaValue: 0, manaCost: null, power: '2', toughness: '2', abilities: [] });
    expect(spell.stack!.costsPaid.alternative).toBe('morph');
    expect(spell.stack!.costsPaid.manaSpent).toHaveLength(3); // CR 702.37c: {3}
    expect(s.log.some((l) => l.text === 'Alice casts a face-down spell with morph.')).toBe(true);
  });

  it('CR 708.4: "can\'t cast spells with mana value 3 or more" judges the face-down spell (mana value 0), not the card', () => {
    const s = angelHand();
    const card = find(s, 'Exalted Angel', 'hand');
    const noBig = { canCast: (g: { s: Parameters<typeof charsOfObject>[0] }, spell: string, _p: string, _f: number, via: { chars?: { manaValue: number } }) =>
      ((via.chars ?? charsOfObject(g.s, g.s.objects[spell]!)).manaValue >= 3 ? deny('Spells with mana value 3 or more can\'t be cast.', 'CR 101.2') : null) };
    withStatics(noBig as never, () => {
      const methods = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === card).map((a) => (a.action as { method?: string }).method);
      expect(methods).toEqual(['morph']); // the face-up cast (mana value 4) is not offered
      expect(castFaceDown(s, 'Exalted Angel').zones.stack).toHaveLength(1);
    });
  });

  it('CR 702.37b: a card with megamorph is cast the same way (method "morph"); the state remembers megamorph', () => {
    let s = scenario(['Den Protector', 'Forest'], { p1: { hand: ['Den Protector'], battlefield: lands('Forest', 3) } });
    s = castFaceDown(s, 'Den Protector');
    expect(s.objects[s.zones.stack[0]!]!.faceDownInfo).toEqual({ by: 'megamorph', profile: 'plain' });
  });

  it('CR 702.168b: a card with disguise is cast face down as a 2/2 with ward {2}', () => {
    let s = scenario(['Alley Assailant', 'Swamp'], { p1: { hand: ['Alley Assailant'], battlefield: lands('Swamp', 3) } });
    const card = find(s, 'Alley Assailant', 'hand');
    expect(castMethods(s, card, 0)).toContain('disguise');
    expect(castMethods(s, card, 0)).not.toContain('morph');
    s = castFaceDown(s, 'Alley Assailant', 'disguise');
    const spell = s.zones.stack[0]!;
    expect(s.objects[spell]!.faceDownInfo).toEqual({ by: 'disguise', profile: 'ward2' });
    expect(getChars(s, spell).keywords.map((k) => k.keyword)).toEqual(['ward']);
  });

  it('a card without morph or disguise does not offer the methods', () => {
    const s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: lands('Forest', 3) } });
    expect(castMethods(s, find(s, 'Grizzly Bears', 'hand'), 0)).toEqual([]);
  });
});

describe('CR 708.4, 708.3: the face-down spell resolves into a face-down permanent; enters-the-battlefield abilities of the card do nothing', () => {
  it('Exalted Angel resolves face down (its status kept), a 2/2 with no flying', () => {
    let s = castFaceDown(angelHand(), 'Exalted Angel');
    s = resolveTop(s);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]!.faceDownInfo).toEqual({ by: 'morph', profile: 'plain' });
    expect(getChars(s, id!)).toMatchObject({ name: '', power: '2', toughness: '2', keywords: [] });
  });

  it('CR 708.3: "When this creature enters, you gain 5 life" does not trigger; "This creature enters tapped" (Alley Assailant) does not apply', () => {
    let s = scenario(['Plains', 'Swamp', 'Alley Assailant'], { p1: { hand: ['Test Veiled Healer', 'Alley Assailant'], battlefield: [...lands('Plains', 3), ...lands('Swamp', 3)] }, defs: [GAIN] });
    s = resolveTop(castFaceDown(s, 'Test Veiled Healer'));
    expect(s.players[0]!.life).toBe(20);
    s = resolveTop(castFaceDown(s, 'Alley Assailant', 'disguise'));
    const assailant = faceDownOf(s, 'p1').find((id) => s.objects[id]!.faceDownInfo?.by === 'disguise')!;
    expect(s.objects[assailant]!.tapped).toBe(false);
  });
});

describe('CR 708.5, 400.2: casting face down tells the opponent nothing about the card', () => {
  it('the zone change, the log and the opponent\'s view of the stack name no card; the controller sees it', () => {
    const s0 = angelHand();
    const r = castFaceDown(s0, 'Exalted Angel');
    const spell = r.zones.stack[0]!;
    expect(logFor(r, 'p2').join('\n')).not.toMatch(/Exalted Angel/);
    const theirs = viewFor(r, 'p2');
    expect(JSON.stringify(theirs.objects[spell])).not.toMatch(/Exalted Angel/);
    expect(theirs.objects[spell]).toMatchObject({ defId: '__facedown__', faceDown: true, faceDownInfo: { by: 'morph', profile: 'plain' }, stack: { costsPaid: { alternative: 'morph' } } });
    expect(theirs.objects[spell]!.cardId).toBeUndefined();
    expect(viewChars(theirs, spell)).toMatchObject({ name: '', power: '2', toughness: '2' }); // getChars runs on the view (D7)
    expect(viewFor(r, 'p1').objects[spell]!.defId).toBe('Exalted Angel');
  });
});

describe('CR 708.9: a face-down spell or permanent is revealed when it leaves for a zone other than the battlefield', () => {
  it('a countered face-down spell is revealed: it is put into the graveyard face up and the log names it', () => {
    let s = scenario(['Exalted Angel', 'Counterspell', 'Plains', 'Island'], { p1: { hand: ['Exalted Angel'], battlefield: lands('Plains', 3) }, p2: { hand: ['Counterspell'], battlefield: lands('Island', 2) } });
    s = castFaceDown(s, 'Exalted Angel');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Counterspell', 'hand', 'p2') });
    while (s.pending && s.pending.kind !== 'priority') {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: spell }] }) : answer(s, { kind: 'payCost', auto: true });
    }
    s = drive(act(act(s, { type: 'pass', player: 'p2' }), { type: 'pass', player: 'p1' }));
    const card = find(s, 'Exalted Angel', 'graveyard', 'p1');
    expect(s.objects[card]!.faceDown).toBe(false);
    expect(logFor(s, 'p2').some((l) => /revealed as it leaves the stack: it is Exalted Angel/.test(l))).toBe(true);
    expect(viewFor(s, 'p2').lki[spell]).toBeDefined(); // its last known information is visible to everyone (core/view.ts#lkiVisible)
  });

  it('a face-down permanent that dies is revealed', () => {
    let s = scenario(['Exalted Angel', 'Lightning Bolt', 'Mountain'], { p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') });
    while (s.pending && s.pending.kind !== 'priority') {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id }] }) : answer(s, { kind: 'payCost', auto: true });
    }
    s = drive(act(act(s, { type: 'pass', player: 'p2' }), { type: 'pass', player: 'p1' }));
    expect(find(s, 'Exalted Angel', 'graveyard', 'p1')).toBeDefined();
    expect(logFor(s, 'p2').some((l) => /revealed as it leaves the battlefield: it is Exalted Angel/.test(l))).toBe(true);
  });
});
