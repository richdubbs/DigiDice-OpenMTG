/**
 * WP32: ward end to end (CR 702.21a) through `applyAction`, the trigger collector, the interpreter's `pay` and `counter` ops: "Whenever this permanent becomes the
 * target of a spell or ability an opponent controls, counter that spell or ability unless that player pays [cost]." The `becameTarget` event is emitted for
 * spells, activated abilities and (new in WP32) triggered abilities (CR 115.1, 603.3d), and the `by` filter is judged on the spell or ability itself.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { classifyCard } from '../../../src/model/classify';
import { drive, mana, objectTarget } from '../announce/support';
import { withExamples } from '../zones/support';
import { trig } from './cards';
import { act, activated, answer, find, keyword, passBoth, scenario, stackAbilities, synth } from './helpers';

const warded = (cost: Parameters<typeof keyword>[1], name = 'Test Warded'): CardDef =>
  synth({ name, cost: '{1}{U}', type: 'Creature — Spirit', pt: ['2', '2'], abilities: [keyword('ward', cost)] });
const ward2 = warded({ mana: mana('{2}') });
const wardLife = warded({ other: [{ kind: 'payLife', amount: 3 }] }, 'Test Life Warded');

/** "{T}: This deals 1 damage to target creature." */
const pinger = synth({
  name: 'Test Pinger', cost: '{2}', type: 'Artifact',
  abilities: [activated('{T}: This artifact deals 1 damage to target creature.', { tap: true }, [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }], {}, [
    { op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 1 },
  ])],
});

/** "When this creature enters, it deals 1 damage to target creature." (a triggered ability that targets) */
const shocker = synth({
  name: 'Test Shocker', cost: '{R}', type: 'Creature — Goblin', pt: ['1', '1'],
  abilities: [trig('When this creature enters, it deals 1 damage to target creature.', [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }], {
    targets: [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }],
    steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 1 }],
  })],
});

/** "Whenever this creature becomes the target of a spell, you gain 1 life." (`by` is a spell: an ability never matches, whatever its source is) */
const spellWatcher = synth({
  name: 'Test Spell Watcher', cost: '{1}{W}', type: 'Creature — Cleric', pt: ['1', '3'],
  abilities: [trig('Whenever this creature becomes the target of a spell, you gain 1 life.', [{ ev: 'becomes', what: 'targeted', object: { self: true }, by: { stackKind: 'spell' } }], {
    steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }],
  })],
});

const MOUNTAINS = ['Mountain', 'Mountain', 'Mountain'];

function board(p2: string[], p1: { hand?: string[]; battlefield?: string[] } = {}): GameState {
  return withExamples(scenario(['Lightning Bolt', 'Mountain', 'Island', 'Grizzly Bears'], {
    defs: [ward2, wardLife, pinger, shocker, spellWatcher],
    p1: { hand: p1.hand ?? ['Lightning Bolt'], battlefield: p1.battlefield ?? MOUNTAINS },
    p2: { battlefield: p2 },
  }), 'Lightning Bolt');
}

const onBattlefield = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

/** p1 casts Lightning Bolt at the warded creature; the ward trigger goes on the stack above it. */
function boltWarded(s: GameState, name = 'Test Warded'): GameState {
  return drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') }), [{ kind: 'chooseTargets', targets: [objectTarget(find(s, name, 'battlefield'))] }]);
}

describe('CR 702.21a: ward counters a spell an opponent controls unless that player pays', () => {
  it('the ward trigger goes on the stack above the targeting spell (CR 603.3)', () => {
    const s = boltWarded(board(['Test Warded']));
    expect(stackAbilities(s).map((a) => [a.source, a.controller])).toEqual([['Test Warded', 'p2']]);
    expect(s.zones.stack).toHaveLength(2);
  });

  it('the targeting player declines to pay {2}: Lightning Bolt is countered (CR 701.6a) and the creature lives', () => {
    const s = boltWarded(board(['Test Warded']));
    const asked = passBoth(s);
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' }); // CR 118.12a: the payer decides
    const t = passBoth(answer(asked, { kind: 'yesNo', yes: false }));
    expect(t.zones.stack).toEqual([]);
    expect(t.zones.graveyard['p1']!.some((id) => t.objects[id]!.defId === 'Lightning Bolt')).toBe(true);
    expect(onBattlefield(t, 'Test Warded')).toBe(true);
    expect(t.log.some((l) => l.rules?.includes('CR 701.6a'))).toBe(true);
  });

  it('the targeting player pays {2}: Lightning Bolt resolves and kills the creature', () => {
    const s = boltWarded(board(['Test Warded']));
    const paid = drive(answer(passBoth(s), { kind: 'yesNo', yes: true }), []);
    expect(paid.zones.stack).toHaveLength(1); // the ward ability resolved, Lightning Bolt is still there
    const t = passBoth(paid);
    expect(onBattlefield(t, 'Test Warded')).toBe(false);
    expect(t.players.find((p) => p.id === 'p1')!.manaPool).toEqual([]);
  });

  it('a player who can\'t pay is not asked (CR 118.3): with no untapped land left the spell is countered at once', () => {
    const s = boltWarded(board(['Test Warded'], { battlefield: ['Mountain'] }));
    const t = passBoth(passBoth(s));
    expect(onBattlefield(t, 'Test Warded')).toBe(true);
    expect(t.zones.stack).toEqual([]);
  });

  it('ward -- pay 3 life: paying the life lets the spell resolve (CR 119.4)', () => {
    const s = boltWarded(board(['Test Life Warded']), 'Test Life Warded');
    const t = passBoth(drive(answer(passBoth(s), { kind: 'yesNo', yes: true }), []));
    expect(lifeOf(t, 'p1')).toBe(17);
    expect(onBattlefield(t, 'Test Life Warded')).toBe(false);
  });

  it('ward does not trigger for a spell its own controller controls ("an opponent controls")', () => {
    const s0 = withExamples(scenario(['Lightning Bolt', 'Mountain'], { defs: [ward2], p1: { hand: ['Lightning Bolt'], battlefield: [...MOUNTAINS, 'Test Warded'] } }), 'Lightning Bolt');
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') }), [{ kind: 'chooseTargets', targets: [objectTarget(find(s0, 'Test Warded', 'battlefield'))] }]);
    expect(stackAbilities(s)).toEqual([]);
  });
});

describe('CR 113.7a: the ward trigger exists independently of the warded permanent', () => {
  it('the warded creature is destroyed in response: ward still resolves and counters the spell unless its controller pays (CR 702.21a)', () => {
    const s0 = withExamples(scenario(['Lightning Bolt', 'Doom Blade', 'Mountain', 'Swamp'], {
      defs: [ward2], p1: { hand: ['Lightning Bolt'], battlefield: MOUNTAINS }, p2: { hand: ['Doom Blade'], battlefield: ['Test Warded', 'Swamp', 'Swamp'] },
    }), 'Lightning Bolt', 'Doom Blade');
    const s = boltWarded(s0);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Warded']);
    const p2 = act(s, { type: 'pass', player: 'p1' });
    const blade = drive(act(p2, { type: 'cast', player: 'p2', card: find(p2, 'Doom Blade', 'hand') }), [{ kind: 'chooseTargets', targets: [objectTarget(find(p2, 'Test Warded', 'battlefield'))] }]);
    const gone = passBoth(blade); // Doom Blade resolves: the warded creature dies (CR 400.7)
    expect(onBattlefield(gone, 'Test Warded')).toBe(false);
    expect(stackAbilities(gone).map((a) => a.source)).toEqual(['Test Warded']);
    const asked = passBoth(gone);
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' }); // pay {2}? never "the engine cannot find its definition"
    const t = passBoth(answer(asked, { kind: 'yesNo', yes: false }));
    expect(t.zones.stack).toEqual([]);
    expect(t.log.some((l) => l.rules?.includes('CR 701.6a'))).toBe(true);
    expect(t.log.some((l) => l.level === 'manual')).toBe(false);
  });
});

describe('CR 702.21a, 115.1: ward sees abilities too', () => {
  it('an activated ability of an opponent targeting it is countered unless they pay (CR 602.2, 701.6a, 113.7a)', () => {
    const s0 = board(['Test Warded'], { hand: [], battlefield: ['Test Pinger'] });
    const s = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Pinger', 'battlefield'), ability: 'p:0:0' }), [{ kind: 'chooseTargets', targets: [objectTarget(find(s0, 'Test Warded', 'battlefield'))] }]);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Pinger', 'Test Warded']);
    const t = passBoth(passBoth(s)); // p1 has no mana: can't pay, the ping is countered
    expect(t.zones.stack).toEqual([]);
    const w = t.objects[find(t, 'Test Warded', 'battlefield')]!;
    expect(w.damage ?? 0).toBe(0);
  });

  it('a triggered ability of an opponent targeting it is countered unless they pay (CR 603.3d: it becomes the target when put on the stack)', () => {
    const s0 = board(['Test Warded'], { hand: ['Test Shocker'], battlefield: ['Mountain'] });
    const cast = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shocker', 'hand') }), []);
    const entered = passBoth(cast); // Test Shocker resolves and enters; its trigger asks for a target
    expect(entered.pending).toMatchObject({ kind: 'chooseTargets', player: 'p1' });
    const s = answer(entered, { kind: 'chooseTargets', targets: [objectTarget(find(entered, 'Test Warded', 'battlefield'))] } as DecisionAnswer);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Shocker', 'Test Warded']);
    expect(s.zones.stack).toHaveLength(2);
    const t = passBoth(passBoth(s)); // no mana left: the triggered ability is countered
    expect(t.zones.stack).toEqual([]);
    expect(t.objects[find(t, 'Test Warded', 'battlefield')]!.damage ?? 0).toBe(0);
  });
});

describe('CR 115.1: "becomes the target of a spell" is judged on the spell or ability, not on its source (WP32)', () => {
  it('a spell triggers it', () => {
    const s0 = board(['Test Spell Watcher']);
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') }), [{ kind: 'chooseTargets', targets: [objectTarget(find(s0, 'Test Spell Watcher', 'battlefield'))] }]);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Spell Watcher']);
  });

  it('an activated ability does not, although its source (an artifact) is not an ability either', () => {
    const s0 = board(['Test Spell Watcher'], { hand: [], battlefield: ['Test Pinger'] });
    const s = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Pinger', 'battlefield'), ability: 'p:0:0' }), [{ kind: 'chooseTargets', targets: [objectTarget(find(s0, 'Test Spell Watcher', 'battlefield'))] }]);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Pinger']);
  });
});

describe('design 5.2: ward is advertised now that every targeting spell and ability emits "becomes the target"', () => {
  it('feature:ev.becomes.targeted and keyword:ward are capabilities', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.targeted')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:ward')).toBe(true);
  });

  it('a creature with nothing but ward {2} classifies full', () => {
    expect(classifyCard({ faces: ward2.faces.map((f) => ({ abilities: f.abilities })) } as never, ENGINE_CAPABILITIES).level).toBe('full');
  });
});
