/**
 * AF2 (FINAL6 audit, defect D1): an enters trigger that reads its source's own information reads the permanent as it is NOW on the battlefield (CR 608.2h),
 * not as it was before it entered (a spell on the stack): an enters-the-battlefield ability does not look back in time (CR 603.10a, 603.6a). Only a look-back
 * trigger (dies, leaves the battlefield, CR 603.10a) reads the information from before its event; a source that left before its enters trigger resolves is
 * read from its last known information on the battlefield (CR 608.2h).
 *
 * The cards are compiled from their Oracle wording (Sharpshooter Elf, Murderous Redcap without persist) or invented wordings (design 6.10), played through
 * applyAction.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../src/index';
import { clone } from '../../src/util/clone';
import { act, answer, find, findAll, life, passBoth, put, scenario } from '../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{0}', colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}

const ELF = card('Sharpshooter Elf', 'Creature — Elf Ranger', "Reach\nSharpshooter Elf's power is equal to the number of creatures you control.\nWhen this creature enters, it deals damage equal to its power to target creature with flying an opponent controls.", ['*', '2']);
const REDCAP = card('Test Redcap', 'Creature — Goblin Assassin', 'When this creature enters, it deals damage equal to its power to any target.', ['2', '2']);
const WHELP = card('Test Ember Whelp', 'Creature — Dragon', 'This creature enters with two +1/+1 counters on it.\nWhen this creature enters, it deals damage equal to its power to any target.', ['1', '1']);
const HIEROPHANT = card('Test Hierophant', 'Creature — Vampire Cleric', 'When this creature dies, create X 1/1 white Vampire creature tokens with lifelink, where X is its power.', ['1', '1']);
const SKY_WALL = card('Test Sky Wall', 'Creature — Wall', 'Flying', ['0', '10']);
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const DRAKE = card('Test Counting Drake', 'Creature — Drake', 'This creature enters with three +1/+1 counters on it.\nWhen this creature enters, target player loses life equal to the number of +1/+1 counters on it.', ['0', '0']);
const CHORUS = card('Test Chorus', 'Enchantment', 'Whenever a creature you control enters, you gain life equal to its toughness.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const DEFS = [ELF, REDCAP, WHELP, HIEROPHANT, SKY_WALL, DOOM, DRAKE, CHORUS, BEAR];

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: 'p1' | 'p2'): TargetChoice => ({ kind: 'player', id });

/** Answer every decision but priority: targets with `targets`, costs automatically. */
function settle(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  return s;
}

/** Cast a p1 card from hand, let it resolve, and choose the targets of its enters trigger: the trigger waits on the stack, p1 has priority. */
function castAndTrigger(s0: GameState, name: string, triggerTargets: TargetChoice[]): GameState {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  s = settle(passBoth(s), triggerTargets);
  expect(s.zones.stack).toHaveLength(1); // the enters trigger
  return s;
}

/** Test setup only: put cards onto p1's battlefield while the trigger waits (nothing triggers; their arrival is not an event of the game). */
function addCreatures(s0: GameState, names: string[]): GameState {
  const s = clone(s0);
  for (const n of names) put(s, 'p1', 'battlefield', n);
  return s;
}

const damageOn = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

describe('CR 608.2h, 603.10a: an enters trigger reads its source as it is on the battlefield (FINAL6 D1)', () => {
  it('Sharpshooter Elf with two other creatures deals 3 (its CDA counts itself on the battlefield)', () => {
    let s = scenario(['Grizzly Bears', 'Llanowar Elves'], { p1: { hand: ['Sharpshooter Elf'], battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, p2: { battlefield: ['Test Sky Wall'] }, defs: DEFS });
    const wall = find(s, 'Test Sky Wall', 'battlefield', 'p2');
    s = passBoth(castAndTrigger(s, 'Sharpshooter Elf', [obj(wall)]));
    expect(damageOn(s, wall)).toBe(3);
  });

  it('Sharpshooter Elf: two more creatures enter while the trigger waits, it deals 5 (its power when the trigger resolves)', () => {
    let s = scenario(['Grizzly Bears', 'Llanowar Elves'], { p1: { hand: ['Sharpshooter Elf'], battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, p2: { battlefield: ['Test Sky Wall'] }, defs: DEFS });
    const wall = find(s, 'Test Sky Wall', 'battlefield', 'p2');
    s = castAndTrigger(s, 'Sharpshooter Elf', [obj(wall)]);
    s = passBoth(addCreatures(s, ['Grizzly Bears', 'Grizzly Bears']));
    expect(findAll(s, 'Grizzly Bears', 'battlefield', 'p1')).toHaveLength(3);
    expect(damageOn(s, wall)).toBe(5);
  });

  it('a Redcap-style creature with Glorious Anthem deals 3 (an anthem applies only on the battlefield, CR 611.3a)', () => {
    let s = scenario(['Glorious Anthem'], { p1: { hand: ['Test Redcap'], battlefield: ['Glorious Anthem'] }, defs: DEFS });
    s = passBoth(castAndTrigger(s, 'Test Redcap', [player('p2')]));
    expect(life(s, 'p2')).toBe(17);
  });

  it('the counters it entered with count (CR 614.1c, 122.6): a 1/1 that enters with two +1/+1 counters deals 3', () => {
    let s = scenario([], { p1: { hand: ['Test Ember Whelp'] }, defs: DEFS });
    s = castAndTrigger(s, 'Test Ember Whelp', [player('p2')]);
    expect(s.objects[find(s, 'Test Ember Whelp', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(2);
    s = passBoth(s);
    expect(life(s, 'p2')).toBe(17);
  });

  it('"the number of +1/+1 counters on it" counts the counters it entered with (Maga, Traitor to Mortals): 3', () => {
    let s = scenario([], { p1: { hand: ['Test Counting Drake'] }, defs: DEFS });
    s = passBoth(castAndTrigger(s, 'Test Counting Drake', [player('p2')]));
    expect(life(s, 'p2')).toBe(17);
  });

  it('"whenever a creature you control enters, ... its toughness" reads the entering creature on the battlefield (Glorious Anthem: a 2/2 is 3/3)', () => {
    let s = scenario(['Glorious Anthem'], { p1: { hand: ['Test Bear'], battlefield: ['Glorious Anthem', 'Test Chorus'] }, defs: DEFS });
    s = passBoth(castAndTrigger(s, 'Test Bear', []));
    expect(life(s, 'p1')).toBe(23);
  });

  it('the source left before its enters trigger resolved: its last known power on the battlefield (counters and anthem: 4), not its power as a spell', () => {
    let s = scenario(['Glorious Anthem'], { p1: { hand: ['Test Ember Whelp', 'Test Doom'], battlefield: ['Glorious Anthem'] }, defs: DEFS });
    s = castAndTrigger(s, 'Test Ember Whelp', [player('p2')]);
    const whelp = find(s, 'Test Ember Whelp', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), [obj(whelp)]);
    s = passBoth(s); // Test Doom resolves: the Whelp dies
    expect(findAll(s, 'Test Ember Whelp', 'graveyard', 'p1')).toHaveLength(1);
    expect(s.zones.stack).toHaveLength(1);
    s = passBoth(s); // the enters trigger resolves
    expect(life(s, 'p2')).toBe(16);
  });
});

describe('CR 603.10a, 608.2h: a look-back trigger still reads the last known information (unchanged)', () => {
  it('a dies trigger reads its power on the battlefield (Glorious Anthem: 2 tokens), not the card in the graveyard', () => {
    let s = scenario(['Glorious Anthem'], { p1: { hand: ['Test Doom'], battlefield: ['Glorious Anthem', 'Test Hierophant'] }, defs: DEFS });
    const h = find(s, 'Test Hierophant', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), [obj(h)]);
    s = settle(passBoth(s));
    s = passBoth(s);
    const vampires = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
    expect(vampires).toHaveLength(2);
  });
});
