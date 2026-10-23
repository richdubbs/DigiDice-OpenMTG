/**
 * AF2 (FINAL6 audit D1): which snapshots of its event a trigger's effect keeps (triggers/context.ts#contextOf). CR 603.10a: only a look-back trigger reads an
 * object as it was before its event; an event that put an object onto the battlefield is not looked back at unless the trigger looks back at it (a card
 * leaving a graveyard). Leaving the battlefield, and every event that does not put an object onto the battlefield, keep their snapshot as before.
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern } from '../../src/types/ability';
import type { LastKnown, SemEvent } from '../../src/types/state';
import { contextOf } from '../../src/triggers/context';
import { lookBackApplies } from '../../src/triggers/lookback';

const snap = (zone: 'stack' | 'graveyard' | 'battlefield', newId: string): LastKnown => ({ object: { id: 'old', zone } as never, chars: null, leftZone: zone, newId });
const move = (from: 'stack' | 'graveyard' | 'battlefield', to: 'battlefield' | 'graveyard'): SemEvent => ({
  ev: 'zoneChange', seq: 0, batch: 0, roles: { subject: { objects: [{ id: 'new', zone: to }] } }, data: { from, to, oldId: 'old', newId: 'new' }, before: { old: snap(from, 'new') },
});
const looks = (p: EventPattern) => (e: SemEvent): boolean => lookBackApplies(p, e);

describe('CR 603.10a, 608.2h: the snapshots an effect keeps (contextOf)', () => {
  it('"enters": a spell that resolved into a permanent is not looked back at (the effect reads the permanent)', () => {
    const e = move('stack', 'battlefield');
    expect(contextOf([e], {}, looks({ ev: 'zoneChange', to: 'battlefield' } as EventPattern)).before).toEqual({});
    expect(contextOf([e]).before).toEqual({}); // no look-back predicate: never looked back at
  });
  it('"leaves your graveyard": a card returned to the battlefield is looked back at (its snapshot in the graveyard is kept)', () => {
    const e = move('graveyard', 'battlefield');
    expect(Object.keys(contextOf([e], {}, looks({ ev: 'zoneChange', from: 'graveyard' } as EventPattern)).before)).toEqual(['old']);
    expect(contextOf([e], {}, looks({ ev: 'zoneChange', to: 'battlefield' } as EventPattern)).before).toEqual({});
  });
  it('"dies" keeps the snapshot on the battlefield, with or without the predicate (unchanged)', () => {
    const e = move('battlefield', 'graveyard');
    expect(Object.keys(contextOf([e], {}, looks({ ev: 'zoneChange', from: 'battlefield', to: 'graveyard' } as EventPattern)).before)).toEqual(['old']);
    expect(Object.keys(contextOf([e]).before)).toEqual(['old']);
  });
});
