/**
 * FAST4 MX1: "exile ... until ~ leaves the battlefield" (CR 610.3, `op:move.until`): the first one-shot effect exiles, a `GameState.untilMoves` record waits
 * for the source to leave the battlefield, and the second one-shot effect returns each card still in exile to the battlefield under its owner's control
 * (CR 610.3c) as a new object (CR 400.7), the records ended by the same event together (CR 610.3d). If the source left before the effect, nothing moves
 * (CR 610.3a-b). Real fixture cards on the game path: Banisher Priest, Banishing Light, Brutal Cathar (daybound: transforming is not leaving), Wrath of God.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, compileCard, ENGINE_CAPABILITIES, type AbilityDef, type GameState } from '../../../src/index';
import { untilSourceLeaves } from '../../../src/effects/handlers/zones-move';
import { moveUntilForm } from '../../../src/model/cap-walk';
import { getCard } from '../../fixtures';
import { answer, cast, equivalent, find, lands, looks, next, onField, resolveAll, resolveTop, scenario, target, tweak, until } from '../../m6/dfc/support';
import { logHas, pass } from '../../m4/helpers';

const CATHAR = 'Brutal Cathar // Moonrage Brute';
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const exile = (s: GameState): string[] => names(s, s.zones.exile);
const field = (s: GameState): string[] => names(s, s.zones.battlefield).filter((n) => !['Plains', 'Swamp', 'Forest'].includes(n));

/** p1 casts Banisher Priest; its enters trigger targets p2's Grizzly Bears (announced as it goes on the stack, CR 603.3d). */
function priestOnBears(extra: { hand?: string[]; p2?: string[] } = {}): GameState {
  const s = scenario(['Banisher Priest', 'Grizzly Bears', 'Murder', 'Wrath of God', 'Plains', 'Swamp'], {
    p1: { hand: ['Banisher Priest', ...(extra.hand ?? [])], battlefield: [...lands('Plains', 6), ...lands('Swamp', 3)] },
    p2: { battlefield: ['Grizzly Bears', ...(extra.p2 ?? [])] },
  });
  const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
  return resolveTop(cast(s, 'Banisher Priest'), [target(bears)]); // the Priest resolves; its trigger is put on the stack with its target
}

describe('FAST4 MX1: op:move.until is a capability for the one form the handler runs', () => {
  it('registers op:move.until, never the other forms; the CR 610.3 cards compile full', () => {
    expect(ENGINE_CAPABILITIES.has('op:move.until')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:move.until.other')).toBe(false);
    // Temporary Lockdown (mana value 3) exiles "each nonland permanent with mana value 2 or less": never itself
    for (const name of ['Banisher Priest', 'Banishing Light', 'Grasping Giant', 'Temporary Lockdown']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });

  it('the walker and the handler agree on the form (the walker can\'t import the engine)', () => {
    const leaves = { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } };
    const cases: [unknown, unknown, boolean][] = [
      [leaves, { zone: 'exile' }, true],
      [leaves, { zone: 'graveyard' }, false],
      [leaves, { zone: 'exile', faceDown: true }, false],
      [{ d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' } }, { zone: 'exile' }, false],
      [{ d: 'until', event: { ev: 'zoneChange', subject: { self: true, types: ['Creature'] }, from: 'battlefield' } }, { zone: 'exile' }, false],
      [{ d: 'until', event: { ev: 'tapped', subject: { self: true } } }, { zone: 'exile' }, false],
      [{ d: 'endOfTurn' }, { zone: 'exile' }, false],
    ];
    for (const [until, to, ok] of cases) {
      expect(untilSourceLeaves(until, to)).toBe(ok);
      expect(moveUntilForm(until, to)).toBe(ok ? 'op:move.until' : 'op:move.until.other');
    }
    const step = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'] } }, to: { zone: 'exile' }, until: leaves }] } };
    expect(capabilitiesOf(step as never)).toContain('op:move.until');
  });
});

describe('CR 610.3: exiled until the source leaves the battlefield', () => {
  it('Banisher Priest exiles the creature; when the Priest dies, the card returns at once under its owner\'s control as a new object (CR 610.3c, 400.7)', () => {
    let s = resolveTop(priestOnBears({ hand: ['Murder'] }));
    expect(exile(s)).toEqual(['Grizzly Bears']);
    const exiled = s.zones.exile[0]!;
    expect(s.untilMoves).toHaveLength(1);
    expect(s.untilMoves![0]!.objects).toEqual([{ object: { id: exiled, zone: 'exile' }, back: 'battlefield' }]);
    s = resolveTop(cast(s, 'Murder', [target(onField(s, 'Banisher Priest'))]));
    expect(exile(s)).toEqual([]);
    const back = find(s, 'Grizzly Bears', 'battlefield');
    expect(back).not.toBe(exiled); // a new object (CR 400.7)
    expect(s.objects[back]!.controller).toBe('p2'); // CR 610.3c: its owner
    expect(s.untilMoves).toEqual([]);
    expect(s.zones.stack).toEqual([]); // not a triggered ability: nothing used the stack (CR 610.3)
    expect(logHas(s, /Banisher Priest left the battlefield/, 'CR 610.3')).toBe(true);
  });

  it('CR 610.3b: if the Priest leaves the battlefield before its trigger resolves, the creature is not exiled at all', () => {
    let s = priestOnBears({ hand: ['Murder'] });
    expect(s.zones.stack).toHaveLength(1); // the enters trigger
    s = cast(s, 'Murder', [target(onField(s, 'Banisher Priest'))]);
    s = resolveAll(s);
    expect(field(s)).toEqual(['Grizzly Bears']);
    expect(exile(s)).toEqual([]);
    expect(s.untilMoves ?? []).toEqual([]);
    expect(logHas(s, /has already left the battlefield: nothing is exiled/, 'CR 610.3b')).toBe(true);
  });

  it('CR 610.3d, 400.7: two Priests destroyed by one Wrath of God return their cards at the same time, after the destruction (they survive it)', () => {
    let s = scenario(['Banisher Priest', 'Grizzly Bears', 'Llanowar Elves', 'Wrath of God', 'Plains'], {
      p1: { hand: ['Banisher Priest', 'Banisher Priest', 'Wrath of God'], battlefield: lands('Plains', 10) },
      p2: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] },
    });
    s = resolveTop(resolveTop(cast(s, 'Banisher Priest'), [target(find(s, 'Grizzly Bears', 'battlefield', 'p2'))]));
    s = resolveTop(resolveTop(cast(s, 'Banisher Priest'), [target(find(s, 'Llanowar Elves', 'battlefield', 'p2'))]));
    expect(exile(s).sort()).toEqual(['Grizzly Bears', 'Llanowar Elves']);
    expect(s.untilMoves).toHaveLength(2);
    s = resolveTop(cast(s, 'Wrath of God'));
    expect(field(s).sort()).toEqual(['Grizzly Bears', 'Llanowar Elves']);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n === 'Banisher Priest')).toHaveLength(2);
    // one return for both (CR 610.3d): a single log line names both sources
    expect(s.log.filter((l) => /left the battlefield: what they exiled until then returns/.test(l.text))).toHaveLength(1);
  });

  it('CR 400.7: a card that left exile meanwhile is a new object and does not return; the record is dropped', () => {
    let s = resolveTop(priestOnBears({ hand: ['Murder'] }));
    const exiled = s.zones.exile[0]!;
    // the exiled card goes to its owner's graveyard by some other effect (test setup: moved directly)
    s = tweak(s, (x) => {
      x.zones.exile = x.zones.exile.filter((id) => id !== exiled);
      x.objects[exiled]!.zone = 'graveyard';
      x.zones.graveyard.p2!.push(exiled);
    });
    s = resolveTop(cast(s, 'Murder', [target(onField(s, 'Banisher Priest'))]));
    expect(field(s)).toEqual([]);
    expect(names(s, s.zones.graveyard.p2!)).toContain('Grizzly Bears');
    expect(s.untilMoves ?? []).toEqual([]);
  });

  it('Banishing Light (an enchantment) exiles a nonland permanent; Naturalize on it returns the card', () => {
    let s = scenario(['Banishing Light', 'Grizzly Bears', 'Naturalize', 'Plains', 'Forest'], {
      p1: { hand: ['Banishing Light', 'Naturalize'], battlefield: [...lands('Plains', 3), ...lands('Forest', 2)] },
      p2: { battlefield: ['Grizzly Bears'] },
    });
    s = resolveTop(resolveTop(cast(s, 'Banishing Light'), [target(find(s, 'Grizzly Bears', 'battlefield', 'p2'))]));
    expect(exile(s)).toEqual(['Grizzly Bears']);
    s = resolveTop(cast(s, 'Naturalize', [target(onField(s, 'Banishing Light'))]));
    expect(field(s)).toEqual(['Grizzly Bears']);
    expect(find(s, 'Grizzly Bears', 'battlefield', 'p2')).toBeTruthy();
  });

  it('Brutal Cathar: transforming into Moonrage Brute at nightfall is not leaving the battlefield (CR 701.27a, 702.145b); transforming back into Brutal Cathar exiles again (CR 701.27e); when it leaves, both return', () => {
    let s = scenario([CATHAR, 'Grizzly Bears', 'Llanowar Elves', 'Giant Growth', 'Murder', 'Plains', 'Swamp', 'Forest'], {
      p1: { hand: [CATHAR, 'Giant Growth', 'Giant Growth', 'Murder'], battlefield: [...lands('Plains', 3), ...lands('Swamp', 3), ...lands('Forest', 2)] },
      p2: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] },
    });
    s = tweak(s, (x) => { x.designations.dayNight = 'day'; });
    s = resolveTop(resolveTop(cast(s, CATHAR), [target(find(s, 'Grizzly Bears', 'battlefield', 'p2'))]));
    expect(exile(s)).toEqual(['Grizzly Bears']);
    const cathar = onField(s, CATHAR);
    // CR 502.2, 702.145b: p2 casts no spell in turn 2, so it becomes night as turn 3 begins and the daybound Cathar transforms; transforming into Moonrage
    // Brute does not trigger "whenever this creature enters or transforms into Brutal Cathar" (CR 701.27e), though p2 has a creature to target
    s = until(s, (t) => t.turn.number === 3 && t.turn.step === 'upkeep' && t.pending?.kind === 'priority');
    expect(s.designations.dayNight).toBe('night');
    expect(looks(s, cathar)).toMatchObject({ name: 'Moonrage Brute', face: 1 });
    expect(s.zones.stack).toEqual([]);
    expect(exile(s)).toEqual(['Grizzly Bears']); // still exiled: the same permanent, it never left
    // p1 casts two spells in turn 3: it becomes day as turn 4 begins (CR 502.2) and the Brute transforms into Brutal Cathar, which triggers
    s = resolveTop(cast(s, 'Giant Growth', [target(cathar)]));
    s = resolveTop(cast(s, 'Giant Growth', [target(cathar)]));
    for (let i = 0; i < 80 && s.pending?.kind !== 'chooseTargets'; i++) s = next(s);
    expect([s.turn.number, s.designations.dayNight]).toEqual([4, 'day']);
    expect(looks(s, cathar)).toMatchObject({ name: 'Brutal Cathar', face: 0 });
    s = resolveTop(answer(s, target(find(s, 'Llanowar Elves', 'battlefield', 'p2'))));
    expect(exile(s).sort()).toEqual(['Grizzly Bears', 'Llanowar Elves']);
    expect(s.untilMoves).toHaveLength(2);
    s = until(s, (t) => t.pending?.kind === 'priority' && t.pending.player === 'p1');
    s = resolveTop(cast(s, 'Murder', [target(cathar)]));
    expect(field(s).sort()).toEqual(['Grizzly Bears', 'Llanowar Elves']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toHaveLength(2);
  });

  it('Temporary Lockdown exiles each nonland permanent with mana value 2 or less (not itself: mana value 3) until it leaves; they return together', () => {
    let s = scenario(['Temporary Lockdown', 'Llanowar Elves', 'Grizzly Bears', 'Hill Giant', 'Naturalize', 'Plains', 'Forest'], {
      p1: { hand: ['Temporary Lockdown', 'Naturalize'], battlefield: [...lands('Plains', 3), ...lands('Forest', 2), 'Llanowar Elves'] },
      p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] },
    });
    s = resolveTop(resolveTop(cast(s, 'Temporary Lockdown')));
    expect(exile(s).sort()).toEqual(['Grizzly Bears', 'Llanowar Elves']);
    expect(field(s).sort()).toEqual(['Hill Giant', 'Temporary Lockdown']);
    s = resolveTop(cast(s, 'Naturalize', [target(onField(s, 'Temporary Lockdown'))]));
    expect(field(s).sort()).toEqual(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves']);
    expect(s.objects[find(s, 'Llanowar Elves', 'battlefield')]!.controller).toBe('p1');
  });

  it('a source that would exile itself with the rest (CR 610.3: the event in the same effect) is never guessed: the players resolve that step by hand', () => {
    const WARDEN = equivalent({ name: 'Test Warden', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1' }, [{
      kind: 'triggered', text: 'When this creature enters, exile all creatures until this creature leaves the battlefield.', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
      effect: { targets: [], steps: [{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'] } }, to: { zone: 'exile' }, until: { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } } }] },
    } as AbilityDef]);
    let s = scenario(['Grizzly Bears'], { p1: { hand: ['Test Warden'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [WARDEN] });
    s = resolveTop(cast(s, 'Test Warden'));
    expect(s.zones.stack).toHaveLength(1); // its enters trigger
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('manualResolve');
    expect(field(s).sort()).toEqual(['Grizzly Bears', 'Test Warden']); // nothing was exiled by the engine
    expect(s.untilMoves ?? []).toEqual([]);
  });
});
