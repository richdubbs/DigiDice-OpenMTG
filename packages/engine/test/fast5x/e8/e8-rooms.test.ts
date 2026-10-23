/**
 * FAST5X E8: Rooms, doors and unlocking (CR 709.5, 116.2m), played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * are invented, design 6.10).
 *
 *   CR 709.5, 709.5a  a Room permanent has the shared type line, and the name, mana cost and rules text of its UNLOCKED halves only (colors and mana value follow
 *                     the mana cost it has, CR 105.2, 202.3): a Room with both doors locked has no name, is colorless and has mana value 0
 *   CR 709.5d         it enters with the designation of the half that was cast; put onto the battlefield otherwise, with neither
 *   CR 709.5e, 116.2m the unlock cost: a special action (no stack), any time its controller has priority and the stack is empty during a main phase of their turn
 *   CR 709.5f, 709.5g "unlock a locked door of", "lock or unlock a door of"
 *   CR 709.5h         "When you unlock this door": the half the ability is on, also as the Room enters with it unlocked
 *   CR 709.5i         "Whenever you fully unlock a Room": the Room has one designation and gets the other
 *   CR 400.7          a Room that leaves and returns is a new object with no designations
 *   CR 106.6          "Spend this mana only to cast Room spells and unlock doors"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { copiableOrWhy } from '../../../src/statics/copy';
import { act, answer, castAuto, find, legal, life, pass, reject, scenario, zoneNames } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function room(left: [string, string, string], right: [string, string, string]): CardDef {
  return compileCard({
    name: `${left[0]} // ${right[0]}`, layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: `${left[1]} // ${right[1]}`, colors: [],
    card_faces: [
      { name: left[0], type_line: 'Enchantment — Room', mana_cost: left[1], oracle_text: left[2] },
      { name: right[0], type_line: 'Enchantment — Room', mana_cost: right[1], oracle_text: right[2] },
    ],
  } as unknown as OracleCard);
}
function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer the decisions of an action: costs automatically, targets, options; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], option?: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    const k = s.pending.kind;
    if (k === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (k === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (k === 'chooseOption' && option !== undefined) s = answer(s, { kind: 'chooseOption', ids: [option] });
    else if (k === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) }); // simultaneous triggers (CR 603.3b)
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, targets: TargetChoice[] = [], option?: string): GameState {
  let s = s0;
  for (let guard = 0; (s.zones.stack.length > 0 || s.pending?.kind !== 'priority') && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets, option);
  return s;
}
const unlocks = (s: GameState, player = 'p1') => legal(s, player, 'special').filter((a) => a.action.type === 'special' && a.action.kind === 'unlock');
function unlock(s: GameState, id: ObjectId, door: number, player = 'p1'): GameState {
  const la = unlocks(s, player).find((a) => a.object === id && a.action.type === 'special' && a.action.door === door);
  if (!la) throw new Error(`no unlock of door ${door}`);
  return settle(act(s, la.action));
}
const plains = (n: number) => Array.from({ length: n }, () => 'Plains');

const STUDY = room(['Test Study', '{W}', 'When you unlock this door, you gain 3 life.'], ['Test Gallery', '{2}{W}', 'Creatures you control get +1/+0.\nWhen you unlock this door, draw a card.']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const EERIE = card('Test Watcher', 'Creature — Spirit', 'Whenever an enchantment you control enters and whenever you fully unlock a Room, you gain 1 life.', ['1', '1']);
const FULLY = card('Test Locksmith', 'Creature — Human', 'Whenever you fully unlock a Room, draw a card.', ['1', '1']);
const KEY = card('Test Key', 'Artifact', '{T}: Unlock a locked door of target Room you control.');
const LEVER = card('Test Lever', 'Artifact', '{T}: Lock or unlock a door of target Room you control. Activate only as a sorcery.');
const HOOK = card('Test Hook', 'Artifact', "{T}: Return target enchantment you control to its owner's hand.");
const VENT = card('Test Vent', 'Land', '{T}: Add {W}. Spend this mana only to cast Room spells and unlock doors.');
const DEFS = [STUDY, BEAR, EERIE, FULLY, KEY, LEVER, VENT];

describe('the cards are automated (CR 709.5)', () => {
  it('every synthetic card plays fully (experimental templates excepted: they cap a card at partial, design 6.9)', () => {
    for (const d of [STUDY, BEAR, EERIE, FULLY]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
    for (const d of [KEY, LEVER, VENT]) expect(d.faces[0]!.abilities.every((a) => a.kind !== 'manual'), d.name).toBe(true);
  });
});

describe('CR 709.5, 709.5a, 709.5c: the characteristics of a Room permanent', () => {
  it('with both doors locked it has the shared type line only: no name, no mana cost, colorless, mana value 0, no rules text', () => {
    const s = scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: [STUDY.name, 'Test Bear'] } });
    const c = getChars(s, find(s, STUDY.name, 'battlefield'))!;
    expect(c).toMatchObject({ name: '', names: [], manaCost: null, manaValue: 0, colors: [], types: ['Enchantment'], subtypes: ['Room'] });
    expect(c.abilities).toEqual([]);
    expect(getChars(s, find(s, 'Test Bear', 'battlefield'))!.power).toBe('2'); // the locked door's anthem has no effect
  });

  it('with one door unlocked it has that door\'s name, mana cost, colors, mana value and abilities; fully unlocked both (CR 709.4)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name, 'Test Bear'] } });
    const id = find(s0, STUDY.name, 'battlefield');
    const right = tweak(s0, (t) => { t.objects[id]!.unlocked = [1]; });
    expect(getChars(right, id)).toMatchObject({ name: 'Test Gallery', names: ['Test Gallery'], manaValue: 3, colors: ['W'] });
    expect(getChars(right, find(right, 'Test Bear', 'battlefield'))!.power).toBe('3');
    const both = tweak(s0, (t) => { t.objects[id]!.unlocked = [0, 1]; });
    expect(getChars(both, id)).toMatchObject({ name: 'Test Study // Test Gallery', names: ['Test Study', 'Test Gallery'], manaValue: 4 });
  });

  it('in a hand both halves are combined (CR 709.4): the designations are a battlefield matter', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: [STUDY.name] } });
    expect(getChars(s, find(s, STUDY.name, 'hand'))).toMatchObject({ names: ['Test Study', 'Test Gallery'], manaValue: 4 });
  });
});

describe('CR 709.5d, 709.5h: a Room enters with the half that was cast unlocked, and "When you unlock this door" triggers', () => {
  it('casting the left half: it enters with the left door unlocked, the left door\'s trigger resolves, the right door stays locked', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: [STUDY.name], battlefield: plains(4) } });
    const s = resolveAll(castAuto(s0, STUDY.name, { face: 0 }));
    const id = find(s, STUDY.name, 'battlefield');
    expect(s.objects[id]!.unlocked).toEqual([0]);
    expect(life(s, 'p1')).toBe(23);
    expect(getChars(s, id)!.name).toBe('Test Study');
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]); // the right door's draw did not trigger
  });

  it('casting the right half: only the right door\'s trigger, and its anthem works', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: [STUDY.name], battlefield: [...plains(4), 'Test Bear'] } });
    const s = resolveAll(castAuto(s0, STUDY.name, { face: 1 }));
    expect(s.objects[find(s, STUDY.name, 'battlefield')]!.unlocked).toEqual([1]);
    expect(life(s, 'p1')).toBe(20);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(1);
    expect(getChars(s, find(s, 'Test Bear', 'battlefield'))!.power).toBe('3');
  });

  it('put onto the battlefield without being cast, it enters with neither designation and nothing triggers', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name] } });
    expect(s.objects[find(s, STUDY.name, 'battlefield')]!.unlocked).toBeUndefined();
    expect(unlocks(s).map((a) => a.label)).toEqual([]); // no lands to pay with
  });
});

describe('CR 709.5e, 116.2m: the unlock cost, a special action', () => {
  it('is listed for each locked door its controller can pay for, at sorcery timing; paying it unlocks the door without using the stack', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name, ...plains(3)] } });
    const id = find(s0, STUDY.name, 'battlefield');
    expect(unlocks(s0).map((a) => a.label).sort()).toEqual(['Unlock Test Gallery ({2}{W})', 'Unlock Test Study ({W})']);
    const s1 = unlock(s0, id, 1);
    expect(s1.objects[id]!.unlocked).toEqual([1]);
    expect(s1.zones.battlefield.filter((x) => s1.objects[x]!.defId === 'Plains' && s1.objects[x]!.tapped).length).toBe(3);
    // the special action itself never uses the stack (CR 116.2m); the door's own trigger does (CR 603.3)
    expect(s1.zones.stack.length).toBe(1);
    expect(s1.pending?.player).toBe('p1'); // the player keeps priority (CR 116.3c... 117.3c)
    const s2 = resolveAll(s1);
    expect(zoneNames(s2, 'hand', 'p1').length).toBe(1);
    expect(unlocks(s2)).toEqual([]); // no mana left for the other door
  });

  it('is not listed while the stack is not empty, outside a main phase, during an opponent\'s turn, or for an opponent\'s Room; an unlisted unlock is rejected', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name, ...plains(3)] }, p2: { battlefield: [STUDY.name, ...plains(3)] } });
    const mine = find(s0, STUDY.name, 'battlefield', 'p1');
    const theirs = find(s0, STUDY.name, 'battlefield', 'p2');
    expect(unlocks(s0).every((a) => a.object === mine)).toBe(true);
    expect(unlocks(s0, 'p2')).toEqual([]);
    const busy = settle(act(unlock(s0, mine, 1), { type: 'pass', player: 'p1' })); // the door's trigger is on the stack; p2 has priority
    expect(busy.zones.stack.length).toBe(1);
    expect(unlocks(busy, 'p2')).toEqual([]);
    expect(reject(busy, { type: 'special', player: 'p2', kind: 'unlock', object: theirs, door: 0 }).rules).toContain('CR 116.2m');
    const combat = tweak(s0, (t) => { t.turn.step = 'beginCombat'; });
    expect(unlocks(combat)).toEqual([]);
  });

  it('can be paid only with mana that may be spent on it: "Spend this mana only to cast Room spells and unlock doors" pays it (CR 106.6)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name, 'Test Vent'], hand: ['Test Bear'] } });
    const id = find(s0, STUDY.name, 'battlefield');
    expect(unlocks(s0).map((a) => a.label)).toEqual(['Unlock Test Study ({W})']);
    const s1 = unlock(s0, id, 0);
    expect(s1.objects[id]!.unlocked).toEqual([0]);
  });
});

describe('CR 709.5i: fully unlocking a Room', () => {
  it('"Whenever you fully unlock a Room" triggers when the second door is unlocked, not the first; eerie triggers on an enchantment entering and on fully unlocking', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: [STUDY.name], battlefield: [...plains(4), 'Test Locksmith', 'Test Watcher'] }, p2: { battlefield: ['Test Locksmith'] } });
    const theirHand = zoneNames(s0, 'hand', 'p2').length;
    const s1 = resolveAll(castAuto(s0, STUDY.name, { face: 1 })); // an enchantment enters (eerie: +1 life), the right door's draw; not fully unlocked
    expect(life(s1, 'p1')).toBe(21);
    expect(zoneNames(s1, 'hand', 'p1').length).toBe(1);
    const id = find(s1, STUDY.name, 'battlefield');
    const s2 = resolveAll(unlock(s1, id, 0)); // the left door: +3 life (its own trigger), fully unlocked: eerie +1, Locksmith draws
    expect(s2.objects[id]!.unlocked).toEqual([0, 1]);
    expect(life(s2, 'p1')).toBe(25);
    expect(zoneNames(s2, 'hand', 'p1').length).toBe(2);
    expect(zoneNames(s2, 'hand', 'p2').length).toBe(theirHand); // "you fully unlock": not the opponent's Locksmith
  });
});

describe('CR 709.5f-g: effects that unlock and lock doors', () => {
  it('"Unlock a locked door of target Room you control": the only locked door is unlocked, its trigger fires', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name, 'Test Key'] } });
    const id = find(s0, STUDY.name, 'battlefield');
    const s1 = tweak(s0, (t) => { t.objects[id]!.unlocked = [1]; });
    const key = legal(s1, 'p1', 'activate').find((a) => a.object === find(s1, 'Test Key', 'battlefield'))!;
    const s2 = resolveAll(settle(act(s1, key.action), [{ kind: 'object', id } as unknown as TargetChoice]));
    expect(s2.objects[id]!.unlocked).toEqual([0, 1]);
    expect(life(s2, 'p1')).toBe(23);
  });

  it('"Lock or unlock a door of target Room you control": the player chooses; locking removes the designation and the door\'s abilities', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [STUDY.name, 'Test Lever', 'Test Bear'] } });
    const id = find(s0, STUDY.name, 'battlefield');
    const s1 = tweak(s0, (t) => { t.objects[id]!.unlocked = [1]; });
    expect(getChars(s1, find(s1, 'Test Bear', 'battlefield'))!.power).toBe('3');
    const lever = legal(s1, 'p1', 'activate').find((a) => a.object === find(s1, 'Test Lever', 'battlefield'))!;
    const s2 = resolveAll(settle(act(s1, lever.action), [{ kind: 'object', id } as unknown as TargetChoice]), [], 'lock:1');
    expect(s2.objects[id]!.unlocked).toBeUndefined();
    expect(getChars(s2, find(s2, 'Test Bear', 'battlefield'))!.power).toBe('2');
  });
});

describe('CR 400.7, 709.5b: a new object, and copies', () => {
  it('a fully unlocked Room returned to its owner\'s hand is a new object: cast again (right half), only the right door is unlocked', () => {
    const s0 = scenario([], { defs: [...DEFS, HOOK], p1: { battlefield: [STUDY.name, 'Test Hook', ...plains(3)] } });
    const id = find(s0, STUDY.name, 'battlefield');
    const s1 = tweak(s0, (t) => { t.objects[id]!.unlocked = [0, 1]; });
    const hook = legal(s1, 'p1', 'activate').find((a) => a.object === find(s1, 'Test Hook', 'battlefield'))!;
    const s2 = resolveAll(settle(act(s1, hook.action), [{ kind: 'object', id } as unknown as TargetChoice]));
    const inHand = find(s2, STUDY.name, 'hand');
    expect(s2.objects[inHand]!.unlocked).toBeUndefined();
    const s3 = resolveAll(castAuto(s2, STUDY.name, { face: 1 }));
    expect(s3.objects[find(s3, STUDY.name, 'battlefield')]!.unlocked).toEqual([1]);
  });

  it('copying a Room spell is refused (not automated): its copiable values include both halves, CR 709.5b', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: [STUDY.name], battlefield: plains(1) } });
    const s = castAuto(s0, STUDY.name, { face: 0 });
    const spell = s.zones.stack[0]!;
    expect(copiableOrWhy(s, s.objects[spell]!)).toMatchObject({ reason: expect.stringMatching(/CR 709\.5b/) });
  });

  it('"Copy target spell you control" on a Room spell is resolved by hand (CR 709.5b, 709.5d): no copy goes onto the stack, no token Room enters', () => {
    const TWIN = card('Test Twin', 'Instant', 'Copy target spell you control.');
    expect(full(TWIN), JSON.stringify(TWIN.automation)).toBe(true);
    const s0 = scenario([], { defs: [...DEFS, TWIN], p1: { hand: [STUDY.name, 'Test Twin'], battlefield: plains(1) } });
    const s1 = castAuto(s0, STUDY.name, { face: 0 });
    const spell = s1.zones.stack[0]!;
    let s = settle(castAuto(s1, 'Test Twin'), [{ kind: 'object', id: spell } as unknown as TargetChoice]);
    expect(s.zones.stack.length).toBe(2);
    let sawManual = false;
    for (let guard = 0; (s.zones.stack.length > 0 || s.pending?.kind !== 'priority') && guard < 30; guard++) {
      if (s.pending?.kind === 'manualResolve') {
        sawManual = true;
        expect(s.pending.reason).toMatch(/CR 709\.5b/);
        s = answer(s, { kind: 'manualResolve', ops: [] });
      } else s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
    }
    expect(sawManual).toBe(true);
    expect(Object.values(s.objects).filter((o) => o.kind === 'token')).toEqual([]);
    expect(s.objects[find(s, STUDY.name, 'battlefield')]!.unlocked).toEqual([0]);
    expect(life(s, 'p1')).toBe(23); // only the original's door trigger
  });
});
