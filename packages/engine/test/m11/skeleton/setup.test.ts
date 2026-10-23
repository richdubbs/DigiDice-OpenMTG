/**
 * M11-0 (docs/design/m11-commander.md 4.1-4.2, 8): the Commander game configuration and state contracts. A Commander game is set up as CR 903.6-903.7 say
 * (the commanders face up in the command zone, the variant's starting life); everything else about Commander arrives with M11-1.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMANDER_VARIANTS, ConfigError, commanderCastsOf, commanderDamageTo, commanderIdentity, commanderOfCard, commanderOptions, commandersOf, commanderTax,
  compileCard, createGame, isCommander, isCommanderGame, viewFor, type CardDef, type Color, type GameConfig, type GameState,
} from '../../../src/index';
import { cloneState } from '../../../src/util/clone';
import { simpleConfig, startedGame } from '../../helpers';

const legend = (name: string, cost: string, text = '', identity?: Color[]): CardDef => ({
  ...compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Legendary Creature — Elf Warrior', power: '3', toughness: '3', oracle_text: text }),
  ...(identity ? { colorIdentity: identity } : {}),
});
const TITANIA = legend('Test Titania', '{3}{G}', '', ['G']);
const KRAUM = legend('Test Kraum', '{3}{U}{R}', 'Partner', ['U', 'R']);
const TYMNA = legend('Test Tymna', '{1}{W}{B}', 'Partner', ['W', 'B']);
const NO_IDENTITY = legend('Test Nameless', '{2}{G}');

/** A Commander game of `variant`: Alice with `alice`, Bob with `bob` as commanders, decks of Forests and bears (simpleConfig). */
function commanderConfig(variant: Parameters<typeof commanderOptions>[0], alice: CardDef[], bob: CardDef[], extra: Partial<GameConfig['options']> = {}): GameConfig {
  const base = simpleConfig('m11-setup');
  return {
    ...base,
    defs: [...(base.defs as CardDef[]), TITANIA, KRAUM, TYMNA, NO_IDENTITY],
    players: [
      { ...base.players[0]!, commanders: alice.map((d) => d.id) },
      { ...base.players[1]!, commanders: bob.map((d) => d.id) },
    ],
    options: { startingPlayer: 'p1', commander: commanderOptions(variant), ...extra },
  };
}

const commanderObjects = (s: GameState, player: string) => s.zones.command.map((id) => s.objects[id]!).filter((o) => o.owner === player);

describe('M11-0: Commander game setup (CR 903.6, 903.7, 103.2c, 103.4c-d)', () => {
  it('CR 903.6, 103.2c: each commander begins the game face up in its owner\'s command zone, a card with the designation', () => {
    const s = startedGame(commanderConfig('commander', [TITANIA], [KRAUM, TYMNA]));
    expect(isCommanderGame(s)).toBe(true);
    const alice = commanderObjects(s, 'p1');
    expect(alice.map((o) => s.defs[o.defId]!.name)).toEqual(['Test Titania']);
    expect(alice[0]).toMatchObject({ kind: 'card', zone: 'command', faceDown: false, owner: 'p1', controller: 'p1' });
    expect(commanderObjects(s, 'p2').map((o) => s.defs[o.defId]!.name)).toEqual(['Test Kraum', 'Test Tymna']); // CR 702.124b: both partners
    expect(s.players.find((p) => p.id === 'p1')!.commanders).toEqual([{ card: alice[0]!.cardId, defId: TITANIA.id, casts: 0, identity: ['G'] }]);
    expect(isCommander(s, alice[0]!)).toBe(true);
    // the rest of the deck is the library and the opening hand (CR 903.6: the remaining cards are shuffled and become the library)
    expect((s.zones.library['p1']?.length ?? 0) + (s.zones.hand['p1']?.length ?? 0)).toBe(40);
  });

  it('CR 903.7, 103.4c: a Commander game starts at 40 life; Duel Commander at 20; two-player Brawl at 25 (CR 903.12f, 103.4d)', () => {
    expect(startedGame(commanderConfig('commander', [TITANIA], [KRAUM, TYMNA])).players.map((p) => p.life)).toEqual([40, 40]);
    expect(startedGame(commanderConfig('duel', [TITANIA], [KRAUM, TYMNA])).players.map((p) => p.life)).toEqual([20, 20]);
    expect(startedGame(commanderConfig('brawl', [TITANIA], [KRAUM, TYMNA])).players.map((p) => p.life)).toEqual([25, 25]);
    expect(startedGame(commanderConfig('commander', [TITANIA], [KRAUM, TYMNA], { startingLife: 30 })).players.map((p) => p.life)).toEqual([30, 30]); // an explicit life wins
  });

  it('the variants as data: commander damage 21 except Brawl (CR 903.10a, 903.12h) and Duel Commander (its format rules), tax {2} (CR 903.8), a free first mulligan in Brawl only (CR 903.12g, 103.5c)', () => {
    expect(commanderOptions('commander')).toEqual({ variant: 'commander', damageLimit: 21, tax: 2, freeMulligan: false });
    expect(commanderOptions('duel')).toMatchObject({ damageLimit: null, tax: 2, freeMulligan: false }); // Duel Commander's own rules (test/m11/rules/variants.test.ts)
    expect(commanderOptions('brawl')).toMatchObject({ damageLimit: null, freeMulligan: true });
    expect(commanderOptions('standardbrawl')).toMatchObject({ damageLimit: null, freeMulligan: true });
    expect(Object.keys(COMMANDER_VARIANTS).sort()).toEqual(['brawl', 'commander', 'duel', 'standardbrawl']);
    const opts = commanderOptions('commander');
    opts.tax = 9;
    expect(commanderOptions('commander').tax).toBe(2); // a fresh record each time
  });

  it('the configuration is checked: one or two commanders per player in a Commander game, none outside one, known definitions (CR 903.3, 702.124g)', () => {
    expect(() => createGame(commanderConfig('commander', [], [TITANIA]))).toThrow(ConfigError);
    expect(() => createGame(commanderConfig('commander', [KRAUM, TYMNA, TITANIA], [TITANIA]))).toThrow(/two with a partner/);
    const base = simpleConfig('m11-setup');
    expect(() => createGame({ ...base, defs: [...(base.defs as CardDef[]), TITANIA], players: [{ ...base.players[0]!, commanders: [TITANIA.id] }, base.players[1]!] }))
      .toThrow(/not a Commander game/);
    const unknown = commanderConfig('commander', [TITANIA], [KRAUM, TYMNA]);
    unknown.players[0] = { ...unknown.players[0]!, commanders: ['no-such-card'] };
    expect(() => createGame(unknown)).toThrow(/Unknown commander/);
  });
});

describe('M11-0: the readers of the Commander state (statics/commander.ts)', () => {
  const s = startedGame(commanderConfig('commander', [TITANIA], [KRAUM, TYMNA]));
  const [titania] = commanderObjects(s, 'p1');
  const [kraum, tymna] = commanderObjects(s, 'p2');

  it('CR 903.4, 702.124c: the commander\'s color identity is both partners\' combined (WUBRG order); CR 903.4f: undefined without a commander', () => {
    expect(commanderIdentity(s, 'p1')).toEqual(['G']);
    expect(commanderIdentity(s, 'p2')).toEqual(['W', 'U', 'B', 'R']);
    expect(commanderIdentity(startedGame(), 'p1')).toBeUndefined();
  });

  it('CR 903.4a: a definition without colorIdentity gives an unknown identity (resolved by hand, never guessed)', () => {
    const t = startedGame(commanderConfig('commander', [NO_IDENTITY], [TITANIA]));
    expect(t.players[0]!.commanders![0]!.identity).toBeNull();
    expect(commanderIdentity(t, 'p1')).toBeUndefined();
  });

  it('CR 903.8, 702.124d: the tax counts each commander\'s own casts from the command zone', () => {
    const t = cloneState(s);
    t.players.find((p) => p.id === 'p2')!.commanders![0]!.casts = 2; // Kraum cast twice (M11-1 counts the casts)
    expect(commanderTax(t, kraum!.cardId)).toBe(4);
    expect(commanderTax(t, tymna!.cardId)).toBe(0); // the partner's casts do not count
    expect(commanderCastsOf(t, 'p2')).toBe(2);
    expect(commanderTax(t, titania!.cardId)).toBe(0);
    expect(commanderTax(t, undefined)).toBe(0);
    expect(commanderOfCard(t, kraum!.cardId)).toMatchObject({ owner: 'p2', rec: { defId: KRAUM.id, casts: 2 } });
  });

  it('CR 903.3: the designation follows the card (face down still a commander); tokens and other cards are not commanders', () => {
    const t = cloneState(s);
    t.objects[titania!.id] = { ...t.objects[titania!.id]!, faceDown: true };
    expect(isCommander(t, t.objects[titania!.id]!)).toBe(true);
    expect(isCommander(t, { ...titania!, kind: 'token', cardId: undefined })).toBe(false);
    const library = t.zones.library['p1']!.map((id) => t.objects[id]!);
    expect(library.some((o) => isCommander(t, o))).toBe(false);
  });

  it('CR 903.3b-c: a melded or merged permanent with a commander component is a commander', () => {
    const t = cloneState(s);
    const other = t.objects[t.zones.library['p1']![0]!]!;
    const merged = { ...other, components: [{ kind: 'card' as const, defId: other.defId, cardId: other.cardId, owner: 'p1' }, { kind: 'card' as const, defId: TITANIA.id, cardId: titania!.cardId, owner: 'p1', mergedAt: 5 }] };
    expect(isCommander(t, merged)).toBe(true);
  });

  it('CR 903.10a: commander damage is read per commander card; 0 until dealt', () => {
    const t = cloneState(s);
    expect(commanderDamageTo(t, 'p1', kraum!.cardId!)).toBe(0);
    t.players.find((p) => p.id === 'p1')!.commanderDamage = { [kraum!.cardId!]: 7 };
    expect(commanderDamageTo(t, 'p1', kraum!.cardId!)).toBe(7);
    expect(commanderDamageTo(t, 'p1', tymna!.cardId!)).toBe(0);
    expect(commandersOf(t, 'p2').map((c) => c.defId)).toEqual([KRAUM.id, TYMNA.id]);
  });

  it('every view carries the commanders\' definitions and records, also while a commander is in a hidden zone (public: CR 903.6)', () => {
    const t = cloneState(s);
    // Titania goes to Alice's library (as CR 903.9b would allow if Alice declined): the opponent sees a blank card, but still knows the commander
    const id = titania!.id;
    t.zones.command = t.zones.command.filter((x) => x !== id);
    t.objects[id] = { ...t.objects[id]!, zone: 'library' };
    t.zones.library['p1'] = [id, ...t.zones.library['p1']!];
    const v = viewFor(t, 'p2');
    expect(v.objects[id]!.defId).not.toBe(TITANIA.id);
    expect(v.defs[TITANIA.id]?.name).toBe('Test Titania');
    expect(v.players.find((p) => p.id === 'p1')!.commanders).toEqual(t.players.find((p) => p.id === 'p1')!.commanders);
  });

  it('CR 406.3a, 400.2, 903.9a: a commander exiled face down carries no commander marker in another player\'s view (commanderMoved is hidden)', () => {
    const t = cloneState(s);
    const id = titania!.id;
    t.zones.command = t.zones.command.filter((x) => x !== id);
    t.objects[id] = { ...t.objects[id]!, zone: 'exile', faceDown: true, commanderMoved: true };
    t.zones.exile = [...t.zones.exile, id];
    const seen = viewFor(t, 'p2').objects[id]!;
    expect(seen.faceDown).toBe(true);
    expect(seen.defId).not.toBe(TITANIA.id);
    expect(seen.cardId).toBeUndefined();
    expect('commanderMoved' in seen).toBe(false);
    expect(viewFor(t, 'p1').objects[id]!.commanderMoved).toBe(true); // the owner can't examine it (CR 406.3, FAST5X E25), but the commander designation is the card's (CR 903.3) and the owner is the one asked (CR 903.9a)
  });
});
