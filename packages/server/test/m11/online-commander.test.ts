/**
 * M11-3 (docs/design/m11-commander.md 6): the browser's `host` and `join` commands carry the deck's commander section (OnlineDeck.commander, CR 903.3) on
 * to packages/net; a deck without one is passed on exactly as before. Pure validation, in process.
 */
import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../../src/online/messages';

const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));
const COMMANDER_DECK = { main: [{ name: 'Forest', count: 99 }], sideboard: [], commander: [{ name: 'Blor the Impervious', count: 1 }] };

describe('the commander section from the browser (CR 903.3)', () => {
  it('host and join keep the commander section, names and counts only', () => {
    const host = parse({ t: 'host', id: 1, name: 'Hana', deck: { ...COMMANDER_DECK, commander: [{ name: 'Blor the Impervious', count: 1, x: 1 }] }, format: 'Duel Commander' });
    expect(host).toEqual({ ok: true, message: { t: 'host', id: 1, name: 'Hana', deck: COMMANDER_DECK, format: 'Duel Commander' } });
    const join = parse({ t: 'join', id: 2, address: '203.0.113.5:47620', code: '7KQ2-M9XD-4TRB-HC8P', name: 'Gus', deck: COMMANDER_DECK });
    expect(join.ok && join.message.t === 'join' && join.message.deck).toEqual(COMMANDER_DECK);
  });

  it('a deck without a commander section stays without one (normal online play is unchanged)', () => {
    const r = parse({ t: 'host', id: 1, name: 'Hana', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] } });
    expect(r.ok && r.message.t === 'host' && r.message.deck).toEqual({ main: [{ name: 'Forest', count: 60 }], sideboard: [] });
  });

  it('refuses a malformed section and more than two commanders (CR 903.3, 702.124a)', () => {
    expect(parse({ t: 'host', id: 1, name: 'H', deck: { ...COMMANDER_DECK, commander: 'Blor' } })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'host', id: 1, name: 'H', deck: { ...COMMANDER_DECK, commander: [{ name: 'Blor the Impervious', count: 3 }] } })).toMatchObject({ ok: false, id: 1 });
  });
});
