/**
 * M6-3 (m6 design D8, E8, 3.4 "Turning face up"): the turn-face-up special action (core/special/turn-face-up.ts, performed by effects/handlers/face-ops.ts), the
 * `turnFaceUp` proposal with its `during` bodies and megamorph's counter, effects that turn permanents face up or face down, and the rules of manifested,
 * cloaked and double-faced face-down permanents.
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import { evalQty } from '../../../src/effects/eval';
import { SPECIAL_ACTIONS } from '../../../src/keywords/special';
import { keywordRegistry } from '../../../src/keywords/registry';
import { gameOf } from '../../../src/rules/hookpoints';
import { ctxOn } from '../../m5/eval/helpers';
import { act, answer, drive, find, lands, pt, putFaceDown, rejectSpecial, resolveTop, scenario, synthetic, turnUp, turnUpActions, viewFor } from './support';

const XMORPH = synthetic('Test Swelling Shade', 'Creature — Shade', '{2}{B}', 'Morph {X}{B}', { power: '1', toughness: '1' });
const ETB = synthetic('Test Veiled Healer', 'Creature — Human Cleric', '{3}{W}', 'When this creature enters, you gain 5 life.\nMorph {1}{W}', { power: '1', toughness: '4' });
const FLIPPER = synthetic('Test Mask Weaver', 'Creature — Human Wizard', '{U}', '{0}: Turn target face-down creature face up.');
const HIDER = synthetic('Test Veil Caster', 'Creature — Human Wizard', '{U}', '{0}: Turn target creature face down.');

/** Activate the first non-mana activated ability of `source` targeting `target`, then let it resolve. */
function activateOn(s: ReturnType<typeof scenario>, source: string, target: string): ReturnType<typeof scenario> {
  const key = getChars(s, source).abilities.find((a) => a.def.kind === 'activated')!.key;
  let t = act(s, { type: 'activate', player: 'p1', source, ability: key });
  while (t.pending && t.pending.kind !== 'priority') {
    t = t.pending.kind === 'chooseTargets' ? answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] }) : answer(t, { kind: 'payCost', auto: true });
  }
  return resolveTop(t);
}

describe('CR 702.37e, 116.2b: turning a face-down permanent face up is a special action', () => {
  it('listed with the morph cost it would have face up; taken with a spell on the stack, it does not use the stack and the player keeps priority', () => {
    let s = scenario(['Exalted Angel', 'Lightning Bolt', 'Plains', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: [...lands('Plains', 4), 'Mountain'] } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    expect(turnUpActions(s).map((a) => [a.object, (a.action as { via?: string }).via, a.label])).toEqual([[id, 'morph', 'Turn Exalted Angel face up (morph {2}{W}{W})']]);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(s.zones.stack).toHaveLength(1);
    const ts = s.objects[id]!.timestamp;
    s = turnUp(s, id);
    expect(s.zones.stack).toHaveLength(1); // the special action did not use the stack (CR 116.2b)
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // and priority stays with the player (CR 117.3c)
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.faceDownInfo).toBeUndefined();
    expect(s.objects[id]!.timestamp).toBeGreaterThan(ts); // CR 613.7f
    expect(getChars(s, id)).toMatchObject({ name: 'Exalted Angel', power: '4', toughness: '5' });
    expect(getChars(s, id).keywords.map((k) => k.keyword)).toContain('flying');
    expect(s.log.some((l) => /turns a face-down creature face up for its morph cost: it is Exalted Angel/.test(l.text))).toBe(true);
  });

  it('not listed when its controller can\'t pay, nor for the other player; an unlisted special action is rejected (CR 116.1)', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 3) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    expect(turnUpActions(s)).toEqual([]);
    expect(rejectSpecial(s, id)).toMatch(/can't be turned face up/);
    const [s2, other] = putFaceDown(scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 4) } }), 'p2', 'Exalted Angel');
    expect(turnUpActions(s2)).toEqual([]);
    expect(rejectSpecial(s2, other)).toMatch(/can't be turned face up/);
  });

  it('CR 733.1: the payment can be cancelled, and then nothing happened', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 4) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    const mid = act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: id });
    expect(mid.pending).toMatchObject({ kind: 'payCost', cancellable: true });
    const back = act(mid, { type: 'cancel', player: 'p1' });
    expect(back.objects[id]!.faceDown).toBe(true);
    expect(back.zones.battlefield.filter((x) => back.objects[x]!.tapped)).toEqual([]);
  });

  it('CR 702.37f: X in the morph cost is chosen as the special action is taken and kept on the permanent (faceUpX)', () => {
    let s = scenario(['Swamp'], { p1: { battlefield: lands('Swamp', 4) }, defs: [XMORPH] });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Test Swelling Shade');
    s = drive(act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: id }), [{ kind: 'chooseNumber', n: 2 }]);
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.faceUpX).toBe(2);
    expect(evalQty(ctxOn(s, id), { q: 'faceUpX' })).toBe(2); // another ability of the permanent reads X (q:faceUpX)
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.tapped)).toHaveLength(3); // {2}{B}
  });
});

describe('CR 708.8, 708.11: what happens as a permanent is turned face up', () => {
  it('CR 708.8: no enters-the-battlefield ability triggers; effects that applied to it face down still apply', () => {
    let s = scenario(['Plains', 'Giant Growth', 'Forest'], { p1: { hand: ['Giant Growth'], battlefield: [...lands('Plains', 2), 'Forest'] }, defs: [ETB] });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Test Veiled Healer');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Giant Growth', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id }] }]);
    s = resolveTop(s);
    expect(pt(s, id)).toBe('5/5'); // a face-down 2/2 with +3/+3
    s = turnUp(s, id);
    expect(s.zones.stack).toHaveLength(0);
    expect(s.players[0]!.life).toBe(20);
    expect(getChars(s, id).name).toBe('Test Veiled Healer');
    expect(pt(s, id)).toBe('4/7'); // its own 1/4 plus +3/+3: Giant Growth still applies (CR 708.8)
  });

  it('CR 708.11, 614.1e: Hooded Hydra ("As this creature is turned face up, put five +1/+1 counters on it") is a 5/5 when it is face up', () => {
    let s = scenario(['Hooded Hydra', 'Forest'], { p1: { battlefield: lands('Forest', 5) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Hooded Hydra');
    s = turnUp(s, id);
    expect(s.objects[id]?.zone).toBe('battlefield'); // a 0/0 with five counters does not die (the counters are put as it turns, CR 708.11)
    expect(s.objects[id]!.counters['+1/+1']).toBe(5);
    expect(pt(s, id)).toBe('5/5');
  });

  it('CR 702.37b: Den Protector turned up for its megamorph cost gets a +1/+1 counter, there before its "turned face up" trigger looks', () => {
    let s = scenario(['Den Protector', 'Forest', 'Grizzly Bears'], { p1: { battlefield: lands('Forest', 2), graveyard: ['Grizzly Bears'] } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Den Protector', { by: 'megamorph', profile: 'plain' });
    expect(turnUpActions(s).map((a) => (a.action as { via?: string }).via)).toEqual(['megamorph']);
    s = turnUp(s, id);
    expect(s.objects[id]!.counters['+1/+1']).toBe(1);
    expect(pt(s, id)).toBe('3/2');
    const trigger = s.objects[s.zones.stack[0]!];
    expect(trigger?.stack?.kind).toBe('triggered'); // "When this creature is turned face up, return target card from your graveyard to your hand."
  });

  it('a "when this creature is turned face up" trigger (Alley Assailant, disguise): the opponent loses 3 life and its controller gains 3', () => {
    let s = scenario(['Alley Assailant', 'Swamp'], { p1: { battlefield: lands('Swamp', 6) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Alley Assailant', { by: 'disguise', profile: 'ward2' });
    expect(turnUpActions(s).map((a) => (a.action as { via?: string }).via)).toEqual(['disguise']);
    s = turnUp(s, id);
    expect(s.objects[id]!.tapped).toBe(false); // "enters tapped" is about entering (CR 708.8)
    s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    s = resolveTop(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect([s.players[0]!.life, s.players[1]!.life]).toEqual([23, 17]);
  });
});

describe('CR 701.40, 701.58: manifested and cloaked permanents', () => {
  it('CR 701.40b: a manifested creature card is turned face up for its mana cost', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { battlefield: lands('Forest', 2) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Grizzly Bears', { by: 'manifest', profile: 'plain' });
    expect(turnUpActions(s).map((a) => [(a.action as { via?: string }).via, a.label])).toEqual([['manifest', 'Turn Grizzly Bears face up (manifest {1}{G})']]);
    s = turnUp(s, id);
    expect(getChars(s, id).name).toBe('Grizzly Bears');
  });

  it('CR 701.40c: a manifested card with morph lists both procedures', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 6) } }); // {4}{W}{W} (its mana cost) or {2}{W}{W} (morph)
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel', { by: 'manifest', profile: 'plain' });
    expect(turnUpActions(s).map((a) => (a.action as { via?: string }).via).sort()).toEqual(['manifest', 'morph']);
    expect(rejectSpecial(s, id)).toMatch(/Say which way/);
    s = turnUp(s, id, 'morph');
    expect(getChars(s, id).name).toBe('Exalted Angel');
  });

  it('CR 701.40b, 701.40g: a manifested instant has no mana cost procedure (it is not a creature card): nothing is listed', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { battlefield: lands('Mountain', 3) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Lightning Bolt', { by: 'manifest', profile: 'plain' });
    expect(turnUpActions(s)).toEqual([]);
    expect(rejectSpecial(s, id)).toMatch(/can't be turned face up/);
  });

  it('CR 701.58a: a cloaked permanent has ward {2}; turned face up for its mana cost it loses it', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { battlefield: lands('Forest', 2) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Grizzly Bears', { by: 'cloak', profile: 'ward2' });
    expect(getChars(s, id).keywords.map((k) => k.keyword)).toEqual(['ward']);
    expect(turnUpActions(s).map((a) => (a.action as { via?: string }).via)).toEqual(['cloak']);
    s = turnUp(s, id);
    expect(getChars(s, id).keywords).toEqual([]);
  });
});

describe('effects that turn permanents face up or face down (CR 708.2, 708.7, 712.15-712.16)', () => {
  it('CR 708.7: an effect turns a face-down permanent face up with no cost (Test Mask Weaver); CR 701.40g: a manifested instant is revealed and stays face down', () => {
    let s = scenario(['Exalted Angel', 'Lightning Bolt', 'Island'], { p1: { battlefield: ['Test Mask Weaver'] }, defs: [FLIPPER] });
    let angel: string, bolt: string;
    [s, angel] = putFaceDown(s, 'p1', 'Exalted Angel');
    [s, bolt] = putFaceDown(s, 'p1', 'Lightning Bolt', { by: 'manifest', profile: 'plain' });
    const weaver = find(s, 'Test Mask Weaver', 'battlefield');
    s = activateOn(s, weaver, angel);
    expect(s.objects[angel]!.faceDown).toBe(false);
    expect(getChars(s, angel).name).toBe('Exalted Angel');
    s = activateOn(s, weaver, bolt);
    expect(s.objects[bolt]!.faceDown).toBe(true);
    expect(s.log.some((l) => /it is Lightning Bolt, an instant or sorcery card: it is revealed and stays face down/.test(l.text))).toBe(true);
  });

  it('CR 708.2a: an effect turns a face-up creature face down: a 2/2 with no name and a new timestamp; CR 708.2b: a face-down one stays as it is', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: ['Test Veil Caster', 'Exalted Angel', ...lands('Plains', 4)] }, defs: [HIDER] });
    const caster = find(s, 'Test Veil Caster', 'battlefield');
    const angel = find(s, 'Exalted Angel', 'battlefield');
    const ts = s.objects[angel]!.timestamp;
    s = activateOn(s, caster, angel);
    expect(s.objects[angel]!.faceDown).toBe(true);
    expect(s.objects[angel]!.faceDownInfo).toEqual({ by: 'effect', profile: 'plain' });
    expect(s.objects[angel]!.timestamp).toBeGreaterThan(ts); // CR 613.7f
    expect(pt(s, angel)).toBe('2/2');
    expect(turnUpActions(s).map((a) => (a.action as { via?: string }).via)).toEqual(['morph']); // it still has morph if face up (CR 702.37e)
    const ts2 = s.objects[angel]!.timestamp;
    s = activateOn(s, caster, angel);
    expect(s.objects[angel]!.timestamp).toBe(ts2); // CR 708.2b: nothing happens
    expect(s.log.some((l) => /already face down: nothing happens/.test(l.text))).toBe(true);
  });

  it('CR 712.16: a double-faced permanent can\'t be turned face down; CR 712.15a: a face-down double-faced card can\'t transform and turns up front face up', () => {
    let s = scenario(['Delver of Secrets // Insectile Aberration', 'Island'], { p1: { battlefield: ['Test Veil Caster', 'Delver of Secrets // Insectile Aberration', 'Island'] }, defs: [HIDER] });
    const caster = find(s, 'Test Veil Caster', 'battlefield');
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    s = activateOn(s, caster, delver);
    expect(s.objects[delver]!.faceDown).toBe(false);
    expect(s.log.some((l) => /double-faced and can't be turned face down/.test(l.text))).toBe(true);
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Delver of Secrets // Insectile Aberration', { by: 'manifest', profile: 'plain' });
    s = turnUp(s, id, 'manifest');
    expect(s.objects[id]!.face).toBe(0);
    expect(getChars(s, id).name).toBe('Delver of Secrets');
  });
});

describe('hidden information while turning face up', () => {
  it('the opponent sees the pseudo-definition until it is face up, then the card', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 4) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    expect(viewFor(s, 'p2').objects[id]!.defId).toBe('__facedown__');
    const mid = act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: id });
    expect(JSON.stringify(viewFor(mid, 'p2'))).not.toMatch(/Exalted Angel/); // while paying (cancellable, CR 733.1) the opponent sees the state before
    s = drive(mid);
    expect(viewFor(s, 'p2').objects[id]!.defId).toBe('Exalted Angel');
  });
});

describe('the other special actions keywords grant (foretell, suspend) stay planned stubs (moved here from the deleted test/m6/skeleton/absent-m6-3.test.ts); plot is native since FAST5X E6', () => {
  it('their checks deny citing their rule and the keywords stay planned; morph, megamorph and disguise are native (M6-3)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { hand: ['Grizzly Bears'] } });
    const card = find(s, 'Grizzly Bears', 'hand');
    for (const a of SPECIAL_ACTIONS) {
      const d = a.check(gameOf(s), card, 'p1');
      expect(d, a.key).not.toBeNull();
      expect(d!.rules, a.key).toEqual([a.rule]);
    }
    expect(keywordRegistry.get('suspend')!.status).toBe('implemented'); // std-rx22: core/special/suspend.ts and keywords/data/suspend.json (its keyword stub still denies)
    expect(keywordRegistry.get('foretell')!.status).toBe('native'); // cloud r3-mech: core/special/foretell.ts, actions/cast-opt/foretell.ts (its keyword stub still denies)
    expect(keywordRegistry.get('plot')!.status).toBe('native'); // FAST5X E6: core/special/plot.ts, actions/cast-opt/plot.ts (its keyword stub still denies)
    for (const k of ['morph', 'megamorph', 'disguise']) expect(keywordRegistry.get(k)!.status, k).toBe('native');
  });
});
