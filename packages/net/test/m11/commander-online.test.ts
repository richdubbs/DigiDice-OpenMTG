/**
 * M11-3 (docs/design/m11-commander.md 6): online Commander games. The guest's decklist carries its commander section (DeckSubmission.commander), the host
 * checks it for the host's format (milestone 7's validateDeck: CR 903.3-903.5, 903.12) and builds a Commander game of that format's variant
 * (`options.commander = commanderOptions(variant)`, `PlayerConfig.commanders`, CR 903.6-903.7). Nothing about a commander is hidden (CR 903.6): the views
 * carry the commander state unchanged. In process only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COMMANDER_VARIANTS, commanderOptions, isCommander, type OracleCard } from '@openmtg/engine';
import { commanderVariantOf, deckFromText, formatValidator, prepareDeck, type PreparedDeck, type ResolvedDeck } from '../../src/game/deck';
import { GameGuest } from '../../src/game/guest';
import { GameHost, gameConfigFor, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH } from '../../src/game/host';
import { MemoryTransport } from '../../src/link/memory';
import { checkDeckSubmission, LIMITS, parseGuestMessage, PROTOCOL_VERSION } from '../../src/protocol/messages';
import { localVersions } from '../../src/protocol/versions';
import { deck, FAST_LINK, fixtureDb, until } from '../helpers';

const ALL = { commander: 'legal', duel: 'legal', brawl: 'legal', standardbrawl: 'legal' };
const card = (name: string, extra: Partial<OracleCard> & { legalities?: Record<string, string>; color_identity?: string[] } = {}): OracleCard =>
  ({ name, layout: 'normal', type_line: 'Creature — Elf', oracle_text: '', legalities: ALL, color_identity: [], ...extra }) as OracleCard;
const forest = card('Forest', { type_line: 'Basic Land — Forest', color_identity: ['G'] });
const legend = card('Elf Lord', { type_line: 'Legendary Creature — Elf', color_identity: ['G'] });
const walker = card('Elf Walker', { type_line: 'Legendary Planeswalker — Elf', color_identity: ['G'] });
const goblin = card('Goblin', { color_identity: ['R'] });
const one = (c: OracleCard, count: number) => ({ card: c, count });
const resolved = (main: ResolvedDeck['main'], commander: ResolvedDeck['main'] = [], sideboard: ResolvedDeck['main'] = []): ResolvedDeck => ({ main, sideboard, commander });

describe('the four Commander formats are accepted online (CR 903: all four are offered)', () => {
  it('each commander format maps to its engine variant; every other format has none', () => {
    expect(commanderVariantOf('commander')).toBe('commander');
    expect(commanderVariantOf('EDH')).toBe('commander');
    expect(commanderVariantOf('Duel Commander')).toBe('duel');
    expect(commanderVariantOf('Brawl')).toBe('brawl');
    expect(commanderVariantOf('Standard Brawl')).toBe('standardbrawl');
    for (const f of ['casual', 'modern', 'vintage', 'no such format']) expect(commanderVariantOf(f)).toBeNull();
  });

  it('CR 903.5a, 903.3: a 100-card Commander deck with its commander is legal, and the validator reports the commander it read', () => {
    for (const f of ['commander', 'duel', 'brawl']) {
      const r = formatValidator(resolved([one(forest, 99)], [one(legend, 1)]), f);
      expect(r.errors, f).toEqual([]);
      expect(r.commanders, f).toEqual(['Elf Lord']);
    }
    const sb = formatValidator(resolved([one(forest, 59)], [one(legend, 1)]), 'standardbrawl'); // CR 903.12d: 60 cards
    expect(sb.errors).toEqual([]);
    expect(sb.commanders).toEqual(['Elf Lord']);
  });

  it('CR 903.5c: a card outside the commander\'s color identity is refused; CR 903.12c: a planeswalker commander only in Brawl', () => {
    expect(formatValidator(resolved([one(forest, 98), one(goblin, 1)], [one(legend, 1)]), 'commander').errors.join(' ')).toMatch(/Goblin.*outside.*CR 903.5c/);
    expect(formatValidator(resolved([one(forest, 99)], [one(walker, 1)]), 'commander').errors.join(' ')).toMatch(/can't be a commander/);
    expect(formatValidator(resolved([one(forest, 99)], [one(walker, 1)]), 'brawl').errors).toEqual([]);
  });

  it('Duel Commander\'s banned-as-commander list (Scryfall duel: restricted) refuses the card as the commander only', () => {
    const restricted = card('Restricted Lord', { type_line: 'Legendary Creature — Elf', color_identity: ['G'], legalities: { ...ALL, duel: 'restricted' } });
    expect(formatValidator(resolved([one(forest, 99)], [one(restricted, 1)]), 'duel').errors.join(' ')).toMatch(/banned as a commander in Duel Commander/);
    expect(formatValidator(resolved([one(forest, 98), one(restricted, 1)], [one(legend, 1)]), 'duel').errors).toEqual([]);
  });

  it('a format without a command zone reports no commanders (the configuration of those games is unchanged)', () => {
    expect(formatValidator(resolved([one(forest, 60)]), 'casual')).toEqual({ errors: [], warnings: [] });
  });
});

describe('prepareDeck with a commander section (CR 903.3, 903.6)', () => {
  const cards = fixtureDb();

  it('returns the commander def ids apart from the 99 and compiles the commander\'s definition', async () => {
    const r = await prepareDeck({ ...deck({ Forest: 99 }), commander: [{ name: 'Blor the Impervious', count: 1 }] }, { cards, format: 'commander' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.commanders).toEqual(['Blor the Impervious']);
    expect(r.deck.main).toHaveLength(99);
    expect(r.deck.main).not.toContain('Blor the Impervious');
    expect(r.deck.defs.map((d) => d.id).sort()).toEqual(['Blor the Impervious', 'Forest']);
  });

  it('every non-commander deck comes back with no commanders, exactly as before', async () => {
    const r = await prepareDeck(deck({ Forest: 10, 'Grizzly Bears': 4 }), { cards, format: 'casual' });
    expect(r.ok && r.deck.commanders).toEqual([]);
  });

  it('CR 903.3: a commander section in a format without a command zone is refused, never played as an ordinary card', async () => {
    const r = await prepareDeck({ ...deck({ Forest: 59 }), commander: [{ name: 'Blor the Impervious', count: 1 }] }, { cards, format: 'casual' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/has no commander \(CR 903.3\)/);
  });

  it('CR 903.3: a Commander deck without a commander is refused', async () => {
    const r = await prepareDeck(deck({ Forest: 100 }), { cards, format: 'commander' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/No commander/);
  });

  it('CR 903.3: an MTGO export (the commander listed as the sideboard) is read as the commander, and the sideboard is then empty', async () => {
    const r = await prepareDeck(deck({ Forest: 99 }, { 'Blor the Impervious': 1 }), { cards, format: 'commander' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.commanders).toEqual(['Blor the Impervious']);
    expect(r.deck.sideboard).toEqual([]);
  });

  it('any validator: a commander format still needs one or two commanders (CR 903.3, 702.124a)', async () => {
    const r = await prepareDeck(deck({ Forest: 100 }), { cards, format: 'commander', validate: () => ({ errors: [], warnings: [] }) });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/one commander, or two partners/);
  });

  it('decklist text: the Commander section becomes the submission\'s commander; CMP1: the Companion section its companion (CR 702.139a)', () => {
    const { deck: d, errors } = deckFromText('Commander\n1 Blor the Impervious\n\nDeck\n99 Forest\n');
    expect(errors).toEqual([]);
    expect(d.commander).toEqual([{ name: 'Blor the Impervious', count: 1 }]);
    expect(d.main).toEqual([{ name: 'Forest', count: 99 }]);
    expect(deckFromText('4 Forest\n').deck).not.toHaveProperty('commander');
    const withCompanion = deckFromText('Companion\n1 Lurrus of the Dream-Den\n\nDeck\n60 Forest\n');
    expect(withCompanion.errors).toEqual([]);
    expect(withCompanion.deck.companion).toEqual([{ name: 'Lurrus of the Dream-Den', count: 1 }]);
  });
});

describe('the commander section on the wire (nothing from the network is trusted)', () => {
  it('is optional, bounded and shape-checked: at most two commanders (CR 903.3, 702.124a)', () => {
    expect(checkDeckSubmission({ main: [], sideboard: [] })).toBeNull();
    expect(checkDeckSubmission({ main: [], sideboard: [], commander: [{ name: 'A', count: 1 }, { name: 'B', count: 1 }] })).toBeNull();
    expect(checkDeckSubmission({ main: [], sideboard: [], commander: [{ name: 'A', count: 3 }] })).toMatch(/3 commanders/);
    expect(checkDeckSubmission({ main: [], sideboard: [], commander: 'A' })).toMatch(/commander section malformed/);
    expect(checkDeckSubmission({ main: [], sideboard: [], commander: [{ name: '', count: 1 }] })).toMatch(/entry malformed/);
    expect(checkDeckSubmission({ main: Array(LIMITS.deckEntries).fill({ name: 'x', count: 1 }), sideboard: [], commander: [{ name: 'A', count: 1 }] })).toMatch(/too long/);
  });

  it('a hello carrying a commander section passes the guest-message check (protocol 3; M12-5a: 4, RPL-3: 5, the same deck section)', () => {
    expect(PROTOCOL_VERSION).toBe(5);
    const hello = { v: PROTOCOL_VERSION, type: 'hello', versions: localVersions(null), name: 'Gus', deck: { ...deck({ Forest: 99 }), commander: [{ name: 'Blor the Impervious', count: 1 }] }, proof: 'a'.repeat(64) };
    const r = parseGuestMessage(hello);
    expect(r.ok && r.message.type === 'hello' && r.message.deck.commander).toEqual([{ name: 'Blor the Impervious', count: 1 }]);
  });
});

describe('the host builds a Commander game from its format (m11 design 6, D1)', () => {
  const prepared = (main: string[], commanders: string[] = []): PreparedDeck => ({ main, sideboard: [], commanders, defs: [], warnings: [] });
  const g = { seed: 's', hostName: 'Hana', hostDeck: prepared(['Forest'], ['Blor the Impervious']), guestName: 'Gus', guestDeck: prepared(['Forest'], ['Ayumi, the Last Visitor']) };

  it('each variant\'s rules come from its data (commanderOptions): life, commander damage (none in Brawl or Duel Commander if the data says so), tax, mulligan', () => {
    for (const [format, variant] of [['commander', 'commander'], ['duel', 'duel'], ['Brawl', 'brawl'], ['Standard Brawl', 'standardbrawl']] as const) {
      const cfg = gameConfigFor({ format }, g);
      expect(cfg.options?.commander, format).toEqual(commanderOptions(variant));
      expect(cfg.options?.commander?.damageLimit, format).toBe(COMMANDER_VARIANTS[variant].options.damageLimit);
      expect(cfg.players.map((p) => p.commanders)).toEqual([['Blor the Impervious'], ['Ayumi, the Last Visitor']]);
      expect(cfg.players.map((p) => p.deck)).toEqual([['Forest'], ['Forest']]);
    }
  });

  it('the host\'s explicit game options still win over the variant\'s', () => {
    expect(gameConfigFor({ format: 'commander', gameOptions: { startingLife: 30 } }, g).options).toEqual({ commander: commanderOptions('commander'), startingLife: 30 });
  });

  it('neutrality: any other format makes exactly the configuration of before M11 (no commander, no options unless given)', () => {
    const plain = { ...g, hostDeck: prepared(['Forest']), guestDeck: prepared(['Forest']) };
    expect(gameConfigFor({}, plain)).toEqual({
      seed: 's', players: [{ id: 'p1', name: 'Hana', deck: ['Forest'] }, { id: 'p2', name: 'Gus', deck: ['Forest'] }], defs: [],
    });
    expect(gameConfigFor({ format: 'modern', gameOptions: { skipMulligans: true }, stops: { host: { fullControl: true } } }, plain)).toEqual({
      seed: 's', players: [{ id: 'p1', name: 'Hana', deck: ['Forest'], stops: { fullControl: true } }, { id: 'p2', name: 'Gus', deck: ['Forest'] }], defs: [],
      options: { skipMulligans: true },
    });
  });
});

describe('an online Commander game over the in-process link (CR 903.6, 903.7)', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function pair(format: string, hostCommander: string, guestCommander: string, size = 99) {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const h = await GameHost.attach({
      name: 'Hana', deck: { ...deck({ Forest: size }), commander: [{ name: hostCommander, count: 1 }] }, cards: fixtureDb(), format, seed: 'm11-online',
      gameOptions: { skipMulligans: true },
    }, transport);
    cleanups.push(() => h.close('test over', 200));
    const g = await GameGuest.join({
      host: 'memory', port: 0, code: h.code, name: 'Gus', deck: { ...deck({ Plains: size }), commander: [{ name: guestCommander, count: 1 }] }, link: FAST_LINK,
      connector: (o) => transport.connect(o.link),
    });
    cleanups.push(() => g.close());
    await until(() => g.view !== null, 5000, 'the first view');
    return { host: h, guest: g };
  }

  it('both commanders start face up in the command zone, at 40 life; the guest sees both commanders and their definitions (nothing is hidden)', async () => {
    const { host, guest } = await pair('Commander', 'Blor the Impervious', 'Isamaru, Hound of Konda');
    const s = host.state!;
    expect(s.options.commander).toEqual(commanderOptions('commander'));
    expect(s.players.map((p) => p.life)).toEqual([40, 40]);
    const names = (ids: readonly string[]) => ids.map((id) => s.objects[id]!.defId).sort();
    expect(names(s.zones.command)).toEqual(['Blor the Impervious', 'Isamaru, Hound of Konda']);
    for (const id of s.zones.command) expect(isCommander(s, s.objects[id]!)).toBe(true);
    // CR 903.6: the commander is revealed; the guest's view has both, by name, with each player's commander records.
    const v = guest.view!;
    expect(v.zones.command.map((id) => v.objects[id]!.defId).sort()).toEqual(['Blor the Impervious', 'Isamaru, Hound of Konda']);
    expect(v.defs['Blor the Impervious']).toBeDefined();
    expect(v.players.map((p) => p.commanders?.map((c) => c.defId))).toEqual([['Blor the Impervious'], ['Isamaru, Hound of Konda']]);
    expect(v.options.commander).toEqual(commanderOptions('commander'));
    // The 99 are the library and the hand (CR 903.6).
    expect((s.zones.library['p2']?.length ?? 0) + (s.zones.hand['p2']?.length ?? 0)).toBe(99);
    // The host's view of the guest's commander is public too.
    expect(host.view()!.players[1]!.commanders?.[0]?.defId).toBe('Isamaru, Hound of Konda');
  });

  it('Duel Commander and Standard Brawl use their variant\'s life (CR 903.7, 903.12f) from the data', async () => {
    const duel = await pair('Duel Commander', 'Blor the Impervious', 'Isamaru, Hound of Konda');
    expect(duel.host.state!.players.map((p) => p.life)).toEqual([COMMANDER_VARIANTS.duel.startingLife, COMMANDER_VARIANTS.duel.startingLife]);
    expect(duel.host.state!.options.commander).toEqual(commanderOptions('duel'));
    for (const c of cleanups.splice(0)) await c();
    const brawl = await pair('Standard Brawl', 'Blor the Impervious', 'Isamaru, Hound of Konda', 59);
    expect(brawl.host.state!.players.map((p) => p.life)).toEqual([25, 25]);
    expect(brawl.host.state!.options.commander?.damageLimit).toBeNull(); // CR 903.12h
  });

  it('a guest whose deck has no commander is refused with the reason, in a Commander game (CR 903.3)', async () => {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const h = await GameHost.attach({ name: 'Hana', deck: { ...deck({ Forest: 99 }), commander: [{ name: 'Blor the Impervious', count: 1 }] }, cards: fixtureDb(), format: 'commander' }, transport);
    cleanups.push(() => h.close('test over', 200));
    const join = GameGuest.join({ host: 'memory', port: 0, code: h.code, name: 'Gus', deck: deck({ Plains: 100 }), link: FAST_LINK, connector: (o) => transport.connect(o.link) });
    await expect(join).rejects.toMatchObject({ code: 'deckRejected', details: expect.arrayContaining([expect.stringMatching(/No commander/)]) });
  });

  it('the host refuses its own deck without a commander in a Commander format', async () => {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    await expect(GameHost.attach({ name: 'Hana', deck: deck({ Forest: 100 }), cards: fixtureDb(), format: 'commander' }, transport)).rejects.toMatchObject({ code: 'deckRejected' });
  });
});
