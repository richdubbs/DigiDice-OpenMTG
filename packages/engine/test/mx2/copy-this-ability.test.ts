/**
 * MX2: copy effects "except it has this ability" (CR 707.9a) and "except it doesn't copy that creature's color" (CR 707.9c) on the game path: Vesuvan
 * Doppelganger (its granted upkeep trigger refers to itself), Cryptoplasm, Unstable Shapeshifter. The copy exception `{thisAbility: true}` is stored by the
 * `effect` handler as the resolving ability itself (effects/handlers/lasting.ts), so the copy keeps the ability through every later copy.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, type DecisionAnswer, type GameState, type ObjectId } from '../../src/index';
import { capabilitiesOf } from '../../src/model/capabilities';
import { getCard } from '../fixtures';
import { advanceTo, answer, find, scenario } from '../m5/helpers';
import { cast, drive, resolveTop, target } from '../m5/cr-examples/helpers';

const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const islands = (n: number) => Array(n).fill('Island') as string[];
const upkeepTriggers = (c: ReturnType<typeof getChars>): number => c.abilities.filter((a) => a.def.kind === 'triggered' && /beginning of your upkeep/i.test(a.def.text)).length;

/** Answer the pending decisions of an upkeep "you may have ~ become a copy of target creature" trigger: target first, then yes. */
function takeUpkeep(s0: GameState, of: ObjectId): GameState {
  let s = s0;
  for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
    const k = s.pending.kind;
    if (k === 'chooseTargets') s = answer(s, target(of));
    else if (k === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true } as DecisionAnswer);
    else if (k === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
    else break;
  }
  return s;
}

describe('MX2: the cards compile full', () => {
  it('Vesuvan Doppelganger, Cryptoplasm, Unstable Shapeshifter, Artisan of Forms, Thespian\'s Stage', () => {
    for (const n of ['Vesuvan Doppelganger', 'Cryptoplasm', 'Unstable Shapeshifter']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });
});

describe('CR 707.9a, 707.9c: Vesuvan Doppelganger', () => {
  const board = (): GameState => scenario(['Vesuvan Doppelganger', 'Hill Giant', 'Grizzly Bears', 'Island'], {
    p1: { hand: ['Vesuvan Doppelganger'], battlefield: islands(5) }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] },
  });

  it('enters as a copy of Hill Giant, stays blue, and has the upkeep ability; at the upkeep it becomes Grizzly Bears and keeps that ability', () => {
    let s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = drive(resolveTop(cast(s, 'Vesuvan Doppelganger')), [pick(giant)]);
    const v = find(s, 'Vesuvan Doppelganger', 'battlefield');
    let c = getChars(s, v);
    expect([c.name, c.power, c.toughness, c.colors]).toEqual(['Hill Giant', '3', '3', ['U']]); // CR 707.9c: its own color, blue
    expect(upkeepTriggers(c)).toBe(1); // CR 707.9a: the granted ability is part of the copy
    s = advanceTo(s, 3, 'upkeep');
    expect(s.zones.stack).toHaveLength(1);
    s = takeUpkeep(s, bears);
    s = resolveTop(s);
    s = takeUpkeep(s, bears);
    c = getChars(s, v);
    expect([c.name, c.power, c.toughness, c.colors]).toEqual(['Grizzly Bears', '2', '2', ['U']]);
    expect(upkeepTriggers(c)).toBe(1); // "and it has this ability": the same ability, again
    s = advanceTo(s, 5, 'upkeep');
    expect(s.zones.stack).toHaveLength(1);
    s = takeUpkeep(s, giant);
    s = resolveTop(s);
    s = takeUpkeep(s, giant);
    c = getChars(s, v);
    expect([c.name, c.power, c.colors]).toEqual(['Hill Giant', '3', ['U']]);
    expect(upkeepTriggers(c)).toBe(1);
  });
});

describe('CR 707.9a: Cryptoplasm and Unstable Shapeshifter keep "this ability" through every copy', () => {
  it('Cryptoplasm: at the upkeep it becomes Hill Giant, then Grizzly Bears, with its upkeep ability each time', () => {
    let s = scenario(['Cryptoplasm', 'Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Cryptoplasm'] }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] } });
    const crypto = find(s, 'Cryptoplasm', 'battlefield');
    s = advanceTo(s, 3, 'upkeep');
    s = takeUpkeep(s, find(s, 'Hill Giant', 'battlefield'));
    s = resolveTop(s);
    s = takeUpkeep(s, find(s, 'Hill Giant', 'battlefield'));
    let c = getChars(s, crypto);
    expect([c.name, c.colors, upkeepTriggers(c)]).toEqual(['Hill Giant', ['R'], 1]); // no color exception: it copies the color
    s = advanceTo(s, 5, 'upkeep');
    s = takeUpkeep(s, find(s, 'Grizzly Bears', 'battlefield'));
    s = resolveTop(s);
    s = takeUpkeep(s, find(s, 'Grizzly Bears', 'battlefield'));
    c = getChars(s, crypto);
    expect([c.name, upkeepTriggers(c)]).toEqual(['Grizzly Bears', 1]);
  });

  it('Unstable Shapeshifter: whenever another creature enters, it becomes a copy of that creature and keeps the trigger', () => {
    let s = scenario(['Unstable Shapeshifter', 'Hill Giant', 'Grizzly Bears', 'Mountain', 'Forest'], {
      p1: { hand: ['Hill Giant', 'Grizzly Bears'], battlefield: ['Unstable Shapeshifter', 'Mountain', 'Mountain', 'Mountain', 'Mountain', 'Forest', 'Forest'] },
    });
    const shifter = find(s, 'Unstable Shapeshifter', 'battlefield');
    s = resolveTop(cast(s, 'Hill Giant'));
    s = resolveTop(s);
    let c = getChars(s, shifter);
    const enters = (x: typeof c): number => x.abilities.filter((a) => a.def.kind === 'triggered' && /another creature enters/i.test(a.def.text)).length;
    expect([c.name, enters(c)]).toEqual(['Hill Giant', 1]);
    s = resolveTop(cast(s, 'Grizzly Bears'));
    s = resolveTop(s);
    c = getChars(s, shifter);
    expect([c.name, c.power, enters(c)]).toEqual(['Grizzly Bears', '2', 1]);
  });

  it('Cemetery Puca: a creature dies, its controller pays {1}: it becomes a copy of that creature as it last existed (CR 608.2h) and keeps the trigger', () => {
    let s = scenario(['Cemetery Puca', 'Hill Giant', 'Lightning Bolt', 'Mountain', 'Island'], {
      p1: { hand: ['Lightning Bolt'], battlefield: ['Cemetery Puca', 'Mountain', 'Island'] }, p2: { battlefield: ['Hill Giant'] },
    });
    const puca = find(s, 'Cemetery Puca', 'battlefield');
    s = resolveTop(cast(s, 'Lightning Bolt', [target(find(s, 'Hill Giant', 'battlefield'))]));
    s = drive(s, [{ kind: 'yesNo', yes: true } as DecisionAnswer]);
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s, [{ kind: 'yesNo', yes: true } as DecisionAnswer]);
    s = drive(s, [{ kind: 'yesNo', yes: true } as DecisionAnswer]);
    const c = getChars(s, puca);
    const dies = c.abilities.filter((a) => a.def.kind === 'triggered' && /creature dies/i.test(a.def.text)).length;
    expect([c.name, c.power, dies]).toEqual(['Hill Giant', '3', 1]);
  });
});

