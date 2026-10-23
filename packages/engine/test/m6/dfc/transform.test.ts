/**
 * M6-4 (m6 design 3.6): transforming and converting through the `transform` proposal (effects/proposal-kinds/transform.ts, effects/handlers/dfc-ops.ts),
 * CR 701.27f with the delayed record's creation time, who can transform (CR 712.9: the representing card, never the copiable values), CR 712.10, CR 712.20,
 * and daybound's "can't transform except due to its daybound ability" (CR 702.145b).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, getChars, type AbilityDef, type GameState } from '../../../src/index';
import { collectDelayed, createDelayedTrigger } from '../../../src/triggers/delayed';
import { Game } from '../../../src/core/game';
import {
  act, cast, CONVERT, dfc, drive, find, instantOnTarget, lands, looks, onField, pick, put, resolveTop, scenario, SHAPESHIFT, target, TRANSFORM, tweak, until,
} from './support';

const DELVER = 'Delver of Secrets // Insectile Aberration';

/** "{0}: Transform this creature." on both faces of a synthetic double-faced creature (CR 701.27f). */
const TURN: AbilityDef = { kind: 'activated', text: '{0}: Transform this creature.', cost: {}, effect: { targets: [], steps: [{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }] } } as AbilityDef;
/** "{0}: At the beginning of the next end step, transform this creature." (a delayed triggered ability of the permanent, CR 701.27f). */
const LATER: AbilityDef = {
  kind: 'activated', text: '{0}: At the beginning of the next end step, transform this creature.', cost: {},
  effect: { targets: [], steps: [{ op: 'delay', when: { at: 'step', step: 'end' }, do: [{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }] }] },
} as AbilityDef;
const SHIFTER = dfc(
  { name: 'Test Dawn Shifter', type_line: 'Creature — Human', mana_cost: '{1}', power: '1', toughness: '1', abilities: [TURN, LATER] },
  { name: 'Test Dusk Shifter', type_line: 'Creature — Horror', power: '3', toughness: '3', abilities: [TURN] },
);

/** Activate the `index`th activated ability of `id` (no targets, {0}). */
function activate(s: GameState, id: string, index: number): GameState {
  const key = getChars(s, id).abilities.filter((a) => a.def.kind === 'activated')[index]!.key;
  return drive(act(s, { type: 'activate', player: 'p1', source: id, ability: key }));
}

describe('CR 701.27a, 712.18: transforming is a proposed event; the permanent is the same object', () => {
  it('Delver of Secrets transforms into Insectile Aberration: same object, new timestamp, the `transformed` event; Giant Growth keeps applying (CR 712.18)', () => {
    let s = scenario([DELVER, 'Giant Growth', 'Forest'], { p1: { battlefield: [DELVER, 'Forest'], hand: ['Giant Growth', 'Test Turnabout'] }, defs: [TRANSFORM] });
    const delver = onField(s, DELVER);
    s = resolveTop(cast(s, 'Giant Growth', [target(delver)]));
    const ts = s.objects[delver]!.timestamp;
    s = resolveTop(cast(s, 'Test Turnabout', [target(delver)]));
    expect(looks(s, delver)).toMatchObject({ name: 'Insectile Aberration', pt: [6, 5], face: 1 }); // 3/2 + 3/3
    expect(s.objects[delver]!.timestamp).toBeGreaterThan(ts); // CR 613.7g
    expect(s.objects[delver]!.transformedAt).toBe(s.objects[delver]!.timestamp); // CR 701.27f bookkeeping
    expect(s.log.some((l) => l.text === 'Delver of Secrets transforms into Insectile Aberration.')).toBe(true);
  });

  it('CR 701.28a, 701.27e: converting turns it over the same way, and the event says it converted', () => {
    let s = scenario([DELVER], { p1: { battlefield: [DELVER], hand: ['Test Reconfigure'] }, defs: [CONVERT] });
    const delver = onField(s, DELVER);
    s = resolveTop(cast(s, 'Test Reconfigure', [target(delver)]));
    expect(looks(s, delver)).toMatchObject({ name: 'Insectile Aberration', face: 1 });
    expect(s.log.some((l) => l.text === 'Delver of Secrets converts into Insectile Aberration.')).toBe(true);
    const g = new Game(s);
    expect(g.s.objects[delver]!.transformedAt).toBeDefined();
  });

  it('CR 701.28c: a permanent that is not double-faced doesn\'t convert', () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'], hand: ['Test Reconfigure'] }, defs: [CONVERT] });
    const bears = onField(s, 'Grizzly Bears');
    s = resolveTop(cast(s, 'Test Reconfigure', [target(bears)]));
    expect(looks(s, bears)).toMatchObject({ name: 'Grizzly Bears', face: 0 });
    expect(s.log.some((l) => /Grizzly Bears doesn't convert: it is not represented by a double-faced card/.test(l.text))).toBe(true);
  });
});

describe('CR 701.27f: an ability of the permanent transforms it only if it hasn\'t transformed since', () => {
  it('two transform abilities of the permanent on the stack: only the first transforms it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dawn Shifter // Test Dusk Shifter'] }, defs: [SHIFTER] });
    const id = onField(s, 'Test Dawn Shifter // Test Dusk Shifter');
    s = activate(s, id, 0);
    s = activate(s, id, 0);
    expect(s.zones.stack).toHaveLength(2);
    s = resolveTop(resolveTop(s));
    expect(looks(s, id)).toMatchObject({ name: 'Test Dusk Shifter', face: 1 }); // the second one did nothing
    expect(s.log.some((l) => /doesn't transform: it has transformed since this ability was put onto the stack/.test(l.text))).toBe(true);
  });

  it('the delayed record keeps its creation time, and the stack object carries it (triggers/delayed.ts)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Dawn Shifter // Test Dusk Shifter'] }, defs: [SHIFTER] });
    const g = new Game(tweak(s, () => {}));
    const id = onField(g.s, 'Test Dawn Shifter // Test Dusk Shifter');
    const at = g.s.counters.timestamp;
    const rec = createDelayedTrigger(g, { source: { id, zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'end' }, do: [] });
    expect(rec.createdAt).toBe(at);
    const fired = collectDelayed(g, [{ seq: 0, batch: 0, before: {}, ev: 'step', roles: { player: { players: ['p1'] } }, data: { step: 'end', turn: g.s.turn.number } }]);
    expect(fired[0]?.abilityRef).toMatchObject({ source: 'delayed', index: at });
  });

  it('a delayed triggered ability of the permanent: no transform if it transformed (twice) since the delayed ability was created; else it transforms', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dawn Shifter // Test Dusk Shifter'] }, defs: [SHIFTER] });
    const id = onField(s, 'Test Dawn Shifter // Test Dusk Shifter');
    s = resolveTop(activate(s, id, 1)); // the delayed ability is created
    let control = s;
    s = resolveTop(activate(s, id, 0)); // front -> back
    s = resolveTop(activate(s, id, 0)); // back -> front: it transformed since the delayed ability was created
    expect(looks(s, id).face).toBe(0);
    s = until(s, (t) => t.turn.step === 'end' && t.zones.stack.length > 0);
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(looks(s, id).face).toBe(0); // CR 701.27f: the instruction is ignored
    expect(s.log.some((l) => /has transformed since this delayed triggered ability was created/.test(l.text))).toBe(true);
    // without the transforms in between, the same delayed ability transforms it
    control = until(control, (t) => t.turn.step === 'end' && t.zones.stack.length > 0);
    control = resolveTop(control);
    expect(looks(control, id).face).toBe(1);
  });
});

describe('CR 712.9: who can transform is decided by what represents the permanent', () => {
  it('a Clone that is a copy of Wildblood Pack can\'t transform', () => {
    const GANG = 'Instigator Gang // Wildblood Pack';
    let s = scenario(['Clone', GANG, 'Island'], { p1: { hand: ['Clone', 'Test Turnabout'], battlefield: lands('Island', 4) }, p2: { battlefield: [{ name: GANG, face: 1 }] }, defs: [TRANSFORM] });
    const pack = find(s, GANG, 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Clone'), [pick(pack)]);
    const clone = find(s, 'Clone', 'battlefield');
    expect(looks(s, clone)).toMatchObject({ name: 'Wildblood Pack', pt: [5, 5] });
    s = resolveTop(cast(s, 'Test Turnabout', [target(clone)]));
    expect(looks(s, clone)).toMatchObject({ name: 'Wildblood Pack', face: 0 });
    expect(s.log.some((l) => /doesn't transform: it is not a double-faced permanent/.test(l.text))).toBe(true);
  });

  it('a Kruin Outlaw that became a copy of Elite Vanguard transforms, and stays a copy of Elite Vanguard (until the copy effect ends)', () => {
    const KRUIN = 'Kruin Outlaw // Terror of Kruin Pass';
    let s = scenario([KRUIN, 'Elite Vanguard'], { p1: { hand: ['Test Shapeshift', 'Test Turnabout'], battlefield: [KRUIN, 'Elite Vanguard'] }, defs: [SHAPESHIFT, TRANSFORM] });
    const kruin = onField(s, KRUIN);
    const vanguard = onField(s, 'Elite Vanguard');
    s = resolveTop(cast(s, 'Test Shapeshift', [target(kruin), target(vanguard)]));
    expect(looks(s, kruin)).toMatchObject({ name: 'Elite Vanguard', pt: [2, 1] });
    s = resolveTop(cast(s, 'Test Turnabout', [target(kruin)]));
    expect(looks(s, kruin)).toMatchObject({ name: 'Elite Vanguard', pt: [2, 1], face: 1 }); // transformed, and still a copy
    const t = until(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep');
    expect(looks(t, kruin)).toMatchObject({ name: 'Terror of Kruin Pass', face: 1 }); // CR 514.2: the copy effect ended; it is its back face
  });
});

describe('CR 712.10, 712.20, 702.145b', () => {
  it('CR 712.10: a permanent whose other face is a sorcery face doesn\'t transform', () => {
    const odd = dfc({ name: 'Test Bound Scholar', type_line: 'Creature — Human', power: '1', toughness: '1' }, { name: 'Test Unbound Lesson', type_line: 'Sorcery' });
    let s = scenario([], { p1: { battlefield: ['Test Bound Scholar // Test Unbound Lesson'], hand: ['Test Turnabout'] }, defs: [odd, TRANSFORM] });
    const id = onField(s, 'Test Bound Scholar // Test Unbound Lesson');
    s = resolveTop(cast(s, 'Test Turnabout', [target(id)]));
    expect(looks(s, id)).toMatchObject({ name: 'Test Bound Scholar', face: 0 });
  });

  it('CR 712.20: an "As this creature transforms into ~" ability on the back face applies while it transforms (its counters are there at once)', () => {
    const during: AbilityDef = {
      kind: 'static', text: 'As this creature transforms into Test Moonlit Brute, put two +1/+1 counters on it.', zone: ['battlefield'],
      effects: [{ s: 'replace', replaces: { ev: 'becomes', what: 'transformed', object: { self: true } }, body: { b: 'during', do: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 2 }] } }],
    } as AbilityDef;
    const card = dfc({ name: 'Test Sunlit Pup', type_line: 'Creature — Wolf', power: '1', toughness: '1' }, { name: 'Test Moonlit Brute', type_line: 'Creature — Wolf', power: '3', toughness: '3', abilities: [during] });
    let s = scenario([], { p1: { battlefield: ['Test Sunlit Pup // Test Moonlit Brute'], hand: ['Test Turnabout'] }, defs: [card, TRANSFORM] });
    const id = onField(s, 'Test Sunlit Pup // Test Moonlit Brute');
    expect(ENGINE_CAPABILITIES.has('body:during') && ENGINE_CAPABILITIES.has('feature:replace.on.transform')).toBe(true);
    s = resolveTop(cast(s, 'Test Turnabout', [target(id)]));
    expect(looks(s, id)).toMatchObject({ name: 'Test Moonlit Brute', pt: [5, 5], face: 1 });
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
    // the front face has no such ability: transforming back puts no counter
    s = tweak(s, (x) => { put(x, 'p1', 'hand', 'Test Turnabout'); });
    s = resolveTop(cast(s, 'Test Turnabout', [target(id)]));
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
  });

  it('CR 702.145b: a daybound permanent can\'t transform except due to its daybound ability (a transform effect does nothing)', () => {
    const CATHAR = 'Brutal Cathar // Moonrage Brute';
    let s = scenario([CATHAR], { p1: { battlefield: [CATHAR], hand: ['Test Turnabout'] }, defs: [TRANSFORM] });
    const id = onField(s, CATHAR);
    s = resolveTop(cast(s, 'Test Turnabout', [target(id)]));
    expect(looks(s, id)).toMatchObject({ name: 'Brutal Cathar', face: 0 });
    expect(s.log.some((l) => /daybound and can transform only due to it/.test(l.text) || /can't transform/.test(l.text) || /daybound/.test(l.text))).toBe(true);
  });
});

describe('CR 707.8a: a token copy of a transformed permanent', () => {
  it('a token copy of a transformed Delver of Secrets enters as Insectile Aberration (a double-faced token, back face up) and can transform back', () => {
    const MIRROR = instantOnTarget('Test Mirror Image', "Create a token that's a copy of target creature.", (t) => [{ op: 'copy', what: t, result: 'token', who: { ref: 'you' } }]);
    let s = scenario([DELVER], { p1: { battlefield: [{ name: DELVER, face: 1 }], hand: ['Test Mirror Image', 'Test Turnabout'] }, defs: [MIRROR, TRANSFORM] });
    const delver = onField(s, DELVER);
    s = resolveTop(cast(s, 'Test Mirror Image', [target(delver)]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(looks(s, token)).toMatchObject({ name: 'Insectile Aberration', face: 1 });
    expect(s.defs[s.objects[token]!.defId]!.layout).toBe('double_faced_token');
    s = resolveTop(cast(s, 'Test Turnabout', [target(token)]));
    expect(looks(s, token)).toMatchObject({ name: 'Delver of Secrets', face: 0 });
  });
});
