/**
 * CMP1: companion online (CR 702.139a). The guest's decklist carries its Companion section (DeckSubmission.companion, optional and additive), the host checks
 * the companion's condition with milestone 7's validateDeck (CR 702.139a-b; formats/companion.ts) and puts the companion into the game config
 * (PlayerConfig.companion): it starts outside the game, revealed to both players (CR 400.11, 702.139a). In process only (no hostile network
 * testing).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formatValidator, prepareDeck } from '../../src/game/deck';
import { GameGuest } from '../../src/game/guest';
import { GameHost, gameConfigFor, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH } from '../../src/game/host';
import { MemoryTransport } from '../../src/link/memory';
import { checkDeckSubmission } from '../../src/protocol/messages';
import { deck, FAST_LINK, fixtureDb, until } from '../helpers';

const LURRUS = 'Lurrus of the Dream-Den';
const cards = fixtureDb();
const withCompanion = (main: Record<string, number>, sideboard: Record<string, number> = {}, companion = LURRUS) => ({ ...deck(main, sideboard), companion: [{ name: companion, count: 1 }] });

describe('CR 702.139a: the companion section on the wire (nothing from the network is trusted)', () => {
  it('is optional, shape-checked and bounded to one card', () => {
    expect(checkDeckSubmission({ main: [], sideboard: [] })).toBeNull();
    expect(checkDeckSubmission({ main: [], sideboard: [], companion: [{ name: LURRUS, count: 1 }] })).toBeNull();
    expect(checkDeckSubmission({ main: [], sideboard: [], companion: [{ name: 'A', count: 1 }, { name: 'B', count: 1 }] })).toMatch(/2 companions/);
    expect(checkDeckSubmission({ main: [], sideboard: [], companion: LURRUS })).toMatch(/companion section malformed/);
    expect(checkDeckSubmission({ main: [], sideboard: [], companion: [{ name: '', count: 1 }] })).toMatch(/entry malformed/);
  });
});

describe('CR 702.139a-b: prepareDeck checks the companion and prepares it for the game', () => {
  it('a met condition: the companion def id comes apart, compiled, and one sideboard copy (Arena lists it there too) leaves the sideboard', async () => {
    const r = await prepareDeck(withCompanion({ Forest: 40, 'Grizzly Bears': 20 }, { [LURRUS]: 1, 'Lightning Bolt': 2 }), { cards, format: 'casual' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.companion).toBe(LURRUS);
    expect(r.deck.sideboard).toEqual(['Lightning Bolt', 'Lightning Bolt']);
    expect(r.deck.defs.map((d) => d.id)).toContain(LURRUS);
  });

  it('an unmet condition refuses the deck with the reason (an error, CR 702.139a)', async () => {
    const r = await prepareDeck(withCompanion({ Forest: 40, 'Kitchen Finks': 4 }), { cards, format: 'casual' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/Lurrus of the Dream-Den's companion condition is not met.*Kitchen Finks.*CR 702\.139a/);
  });

  it('a card without a companion ability is refused', async () => {
    const r = await prepareDeck(withCompanion({ Forest: 40 }, {}, 'Grizzly Bears'), { cards, format: 'casual' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/no companion ability/);
  });

  it('an MTGO list: the one fitting companion in the sideboard is read as the companion (the validator\'s note), its copy taken out', async () => {
    const r = await prepareDeck(deck({ Forest: 40, 'Grizzly Bears': 20 }, { [LURRUS]: 1, 'Lightning Bolt': 1 }), { cards, format: 'casual' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.companion).toBe(LURRUS);
    expect(r.deck.sideboard).toEqual(['Lightning Bolt']);
    expect(r.deck.warnings.join(' ')).toMatch(/Read Lurrus of the Dream-Den in the sideboard as the companion/);
  });

  it('a deck without a companion prepares exactly as before (no companion field)', async () => {
    const r = await prepareDeck(deck({ Forest: 40 }, { 'Lightning Bolt': 1 }), { cards, format: 'casual' });
    expect(r.ok && r.deck).not.toHaveProperty('companion');
    expect(formatValidator({ main: [{ card: cards.lookup('Forest')!, count: 60 }], sideboard: [] }, 'casual')).toEqual({ errors: [], warnings: [] });
  });

  it('gameConfigFor puts the companion into the player config (CR 702.139a), in any format', () => {
    const d = (companion?: string) => ({ main: ['Forest'], sideboard: [], commanders: [], ...(companion ? { companion } : {}), defs: [], warnings: [] });
    const c = gameConfigFor({ format: 'casual' }, { seed: 's', hostName: 'Hana', hostDeck: d(LURRUS), guestName: 'Gus', guestDeck: d() });
    expect(c.players[0]).toMatchObject({ companion: LURRUS });
    expect(c.players[1]).not.toHaveProperty('companion');
  });
});

describe('CR 702.139a: an online game with a companion over the in-process link', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  it("the guest's companion starts outside the game, revealed in both players' views; the guest's other sideboard cards stay hidden", async () => {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const h = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 40 }), cards, format: 'casual', seed: 'cmp1-online', gameOptions: { skipMulligans: true } }, transport);
    cleanups.push(() => h.close('test over', 200));
    const g = await GameGuest.join({
      host: 'memory', port: 0, code: h.code, name: 'Gus', deck: withCompanion({ Plains: 40 }, { 'Lightning Bolt': 1 }), link: FAST_LINK,
      connector: (o) => transport.connect(o.link),
    });
    cleanups.push(() => g.close());
    await until(() => g.view !== null, 5000, 'the first view');
    const s = h.state!;
    expect(s.players[1]!.companion).toEqual({ defId: LURRUS });
    expect(s.outside?.['p2']).toEqual(['Lightning Bolt', LURRUS]);
    const hostView = h.view()!;
    expect(hostView.players[1]!.companion).toEqual({ defId: LURRUS });
    expect(hostView.defs[LURRUS]).toBeDefined();
    expect(hostView.outside?.['p2']).toBeUndefined(); // the sideboard stays hidden (CR 400.11a)
    expect(g.view!.players[1]!.companion).toEqual({ defId: LURRUS });
  });
});
