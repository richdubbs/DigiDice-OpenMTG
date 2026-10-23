/**
 * M11-4 (docs/design/m11-commander.md 2, 4.5, 8): what the parser, the renderer and the compiler know of Commander cards besides the template file: the
 * card's color identity (CR 903.4, design D5), the commander words of the noun-phrase and condition grammars (CR 903.3, 903.3d-e), the eminence zones
 * (CR 113.6b), "you cast another <spell>" (Edgar Markov), the keyword data of commander ninjutsu (CR 702.49d) and partner with (CR 702.124j), and the
 * capability discipline: a card that needs a Commander capability is never automated by an engine that lacks it (fail closed, design 5.2).
 */
import { describe, expect, it } from 'vitest';
import {
  compileCard, compileCardV2, defaultCompileSources, ENGINE_CAPABILITIES, keywordRegistry, renderGate, type AbilityDef, type CardDef, type OracleCard,
} from '../../../src/index';
import { colorIdentityOf } from '../../../src/cards/faces';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { keywordAt, lexiconIndex } from '../../../src/parser/front/lexicon-index';
import { getCard } from '../../fixtures';

const oracle = (type: string, text: string, extra: Partial<OracleCard> = {}): OracleCard =>
  ({ name: 'Example Wisp', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{2}{G}', power: '2', toughness: '2', ...extra }) as OracleCard;
const abilities = (type: string, text: string): AbilityDef[] => compileCard(oracle(type, text)).faces[0]!.abilities;
const level = (type: string, text: string): string => compileCard(oracle(type, text)).automation.level;
const strip = (a: AbilityDef): unknown => JSON.parse(JSON.stringify(a, (k, v) => (k === 'src' || k === 'prov' || k === 'text' ? undefined : v)));

describe('M11-4: CardDef.colorIdentity from Scryfall color_identity (CR 903.4, design D5)', () => {
  it('CR 903.4: copied in WUBRG order, never computed from the text (CR 903.4c-e are Scryfall\'s)', () => {
    expect(compileCard(getCard('Edgar Markov')).colorIdentity).toEqual(['W', 'B', 'R']);
    expect(compileCard(getCard("Kraum, Ludevic's Opus")).colorIdentity).toEqual(['U', 'R']);
    expect(compileCard(getCard('Command Tower')).colorIdentity).toEqual([]); // colorless (CR 903.4)
    expect(compileCard(getCard('The Ur-Dragon')).colorIdentity).toEqual(['W', 'U', 'B', 'R', 'G']);
  });

  it('CR 903.4a: missing or unreadable data gives no identity (a commander without one resolves "your commander\'s color identity" by hand)', () => {
    expect(colorIdentityOf(oracle('Creature', '', { color_identity: undefined }))).toBeUndefined();
    expect(colorIdentityOf(oracle('Creature', '', { color_identity: ['G', 'X'] }))).toBeUndefined();
    expect(colorIdentityOf(oracle('Creature', '', { color_identity: ['G', 'W', 'G'] }))).toEqual(['W', 'G']); // a repeated color is the same identity
    expect(compileCard(oracle('Creature', '')).colorIdentity).toBeUndefined();
    expect(colorIdentityOf(oracle('Creature', '', { color_identity: ['R', 'G', 'W'] }))).toEqual(['W', 'R', 'G']);
  });
});

describe('M11-4: the commander words of the noun-phrase grammar (CR 903.3, 903.3d-e)', () => {
  it('CR 903.3d: "commander creatures you control", "commanders you control", "commander creatures you own" (Backgrounds)', () => {
    expect(strip(abilities('Creature — Human Soldier', 'Commander creatures you control get +2/+2 and have indestructible.')[0]!)).toMatchObject({
      kind: 'static', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { commander: true, types: ['Creature'], controller: 'you' } } }],
    });
    expect(strip(abilities('Enchantment', 'Commanders you control have hexproof.')[0]!)).toMatchObject({ effects: [{ affects: { ref: 'each', filter: { commander: true, controller: 'you' } } }] });
    expect(strip(abilities('Legendary Enchantment — Background', 'Commander creatures you own have "Whenever this creature attacks, it gains double strike until end of turn."')[0]!))
      .toMatchObject({ effects: [{ affects: { ref: 'each', filter: { commander: true, types: ['Creature'], owner: 'you' } } }] });
  });

  it('CR 903.3d, 903.3e: "you control your commander" is a commander you own that you control; "you control a commander" any commander', () => {
    expect(strip(abilities('Creature — Kraken', 'As long as you control your commander, this creature gets +2/+2.')[0]!)).toMatchObject({
      condition: { cond: 'exists', of: { ref: 'each', filter: { commander: true, owner: 'you', controller: 'you' } } },
    });
    expect(strip(abilities('Creature — Drake', 'At the beginning of combat on your turn, if you control your commander, draw a card.')[0]!)).toMatchObject({
      interveningIf: { cond: 'exists', of: { ref: 'each', filter: { commander: true, owner: 'you', controller: 'you' } } },
    });
    expect(JSON.stringify(abilities('Instant', 'If you control a commander, you may cast this spell without paying its mana cost.\nDraw two cards.')[0]))
      .toContain('"when":{"cond":"exists","of":{"ref":"each","filter":{"commander":true,"controller":"you"}}}');
  });

  it('CR 903.3: "target commander" and "noncommander creature"', () => {
    expect(JSON.stringify(abilities('Instant', 'Target commander gains lifelink until end of turn.')[0])).toContain('"filter":{"commander":true}');
    expect(JSON.stringify(abilities('Instant', 'Destroy target noncommander creature.')[0])).toContain('"filter":{"commander":false,"types":["Creature"]}');
  });

  it('G6: the render gate words what the filter says ("your commander" is never "a commander", "noncommander" never "non-commander")', () => {
    const ctx = { selfNames: ['Example Wisp'], selfTypes: ['Creature'] };
    const lieutenant = abilities('Creature — Kraken', 'As long as you control your commander, this creature gets +2/+2.')[0]!;
    expect(renderGate(lieutenant, ['As long as you control your commander, Example Wisp gets +2/+2.'], ctx).ok).toBe(true);
    expect(renderGate(lieutenant, ['As long as you control a commander, Example Wisp gets +2/+2.'], ctx).ok).toBe(false);
    const any = abilities('Creature — Kraken', 'As long as you control a commander, this creature gets +2/+2.')[0]!;
    expect(renderGate(any, ['As long as you control your commander, Example Wisp gets +2/+2.'], ctx).ok).toBe(false);
  });
});

describe('M11-4: eminence (CR 113.6b, 603.4)', () => {
  const edgar = (): AbilityDef => abilities('Legendary Creature — Vampire Knight', 'Eminence — Whenever you cast another Vampire spell, if Example Wisp is in the command zone or on the battlefield, create a 1/1 black Vampire creature token.')[0]!;

  it('CR 113.6b: "if ~ is in the command zone or on the battlefield" states the zones: the trigger functions in both, the intervening if is the source itself there', () => {
    expect(strip(edgar())).toMatchObject({
      kind: 'triggered', zone: ['battlefield', 'command'], label: 'Eminence',
      trigger: { on: [{ ev: 'cast', player: 'you', spell: { subtypes: ['Vampire'], other: true } }] },
      interveningIf: { cond: 'exists', of: { ref: 'each', filter: { self: true, zone: ['command', 'battlefield'] } } },
    });
  });

  it('CR 113.6b: "As long as ~ is in the command zone or on the battlefield" is a static ability of those two zones', () => {
    expect(strip(abilities('Legendary Creature — Dragon Avatar', 'As long as Example Wisp is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.')[0]!))
      .toMatchObject({ kind: 'static', zone: ['battlefield', 'command'], effects: [{ s: 'costMod', change: { kind: 'reduce', generic: 1 } }] });
  });

  it('G6: an ability that functions in the command zone without saying so has no wording (the gate refuses it)', () => {
    const ctx = { selfNames: ['Example Wisp'], selfTypes: ['Creature'] };
    const quiet = { ...edgar(), interveningIf: undefined } as AbilityDef;
    expect(renderGate(quiet, ['Whenever you cast another Vampire spell, create a 1/1 black Vampire creature token.'], ctx).ok).toBe(false);
    const ur = abilities('Legendary Creature — Dragon Avatar', 'As long as Example Wisp is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.')[0]!;
    expect(renderGate({ ...ur, zone: ['command'] } as AbilityDef, ['Other Dragon spells you cast cost {1} less to cast.'], ctx).ok).toBe(false);
  });

  it('"Whenever you cast another <spell>" is a cast of a spell other than the source (CR 109.1), in any game', () => {
    expect(strip(abilities('Creature — Elf', 'Whenever you cast another Elf spell, draw a card.')[0]!)).toMatchObject({ trigger: { on: [{ ev: 'cast', player: 'you', spell: { subtypes: ['Elf'], other: true } }] } });
    expect(level('Creature — Elf', 'Whenever you cast another Elf spell, draw a card.')).toBe('full');
  });
});

describe('M11-4: keyword data (CR 702.49d, 702.124j)', () => {
  it('CR 702.49d: commander ninjutsu is one ninjutsu ability that also functions in the command zone (the family of ninjutsu)', () => {
    const k = keywordRegistry.get('commander ninjutsu')!;
    expect(k).toMatchObject({ rule: '702.49', family: 'ninjutsu', status: 'implemented' });
    const exp = keywordRegistry.expand({ kind: 'keyword', text: 'Commander ninjutsu {U}{B}', keyword: 'commander ninjutsu', cost: { mana: [{ kind: 'colored', color: 'U' }, { kind: 'colored', color: 'B' }] } }, { granted: false, faceName: 'X', types: ['Creature'], keyPrefix: 'k:0:0' });
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ kind: 'activated', zone: ['hand', 'command'], prov: { by: 'keyword', id: 'ninjutsu' } });
    expect(JSON.stringify(exp[0])).toContain('"kind":"reveal"');
    expect(ENGINE_CAPABILITIES.has('keyword:commander ninjutsu')).toBe(true);
  });

  it('the lexicon reads "Commander ninjutsu" as that keyword (the CR lexicon lists it too), never as plain ninjutsu', () => {
    const withLibrary = lexiconIndex(undefined, defaultParseOptions().keywords);
    expect(keywordAt(withLibrary, 'commander ninjutsu {u}{b}', 0)).toEqual({ name: 'commander ninjutsu', length: 18 });
    expect(keywordAt(lexiconIndex(), 'commander ninjutsu {u}{b}', 0)?.name.toLowerCase()).toBe('commander ninjutsu');
    const y = compileCard(getCard("Yuriko, the Tiger's Shadow")).faces[0]!.abilities[0]!;
    expect(y).toMatchObject({ kind: 'keyword', keyword: 'commander ninjutsu', cost: { mana: [{ kind: 'colored', color: 'U' }, { kind: 'colored', color: 'B' }] } });
  });

  it('CR 702.124j: partner with [name] expands to "When this creature enters, target player may search their library for a card named [name], reveal it, put it into their hand, then shuffle"', () => {
    const exp = keywordRegistry.expand({ kind: 'keyword', text: 'Partner with Toothy, Imaginary Friend', keyword: 'partner with', filter: { name: 'Toothy, Imaginary Friend' } }, { granted: false, faceName: 'Pir', types: ['Creature'], keyPrefix: 'k:0:0' });
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({
      kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
      effect: { targets: [{ kind: 'player' }], steps: [{ op: 'may', who: { ref: 'target', id: 't0' }, do: [
        { op: 'search', who: { ref: 'target', id: 't0' }, zone: 'library', filter: { name: 'Toothy, Imaginary Friend' }, max: 1, reveal: true },
        { op: 'move', to: { zone: 'hand' } }, { op: 'shuffle', who: { ref: 'target', id: 't0' } }] }] },
    });
  });

  it('CR 702.124j: the partner\'s name with a comma is read from the card\'s own related parts (Scryfall combo_piece), no index needed', () => {
    const pir = parseCard(getCard('Pir, Imaginative Rascal'), defaultParseOptions()).faces[0]!;
    expect(pir.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'partner with', filter: { name: 'Toothy, Imaginary Friend' } });
    // a "Partner with" naming a card that is not a related part does not parse (fail closed)
    const stray = parseCard({ ...getCard('Pir, Imaginative Rascal'), oracle_text: 'Partner with Brightwood Sentry, the Unrelated' }, defaultParseOptions()).faces[0]!;
    expect(stray.abilities[0]!.kind).toBe('manual');
  });
});

describe('M11-4: capability discipline (design 5.2: fail closed)', () => {
  // the engine as it was before M11-1: none of the Commander capabilities
  const WITHOUT = new Set([...ENGINE_CAPABILITIES].filter((c) => !/commander|zone\.command|mana\.commanderIdentity/i.test(c) || c === 'q:commanderCasts' || c === 'sq:commanderCasts'));
  const before = (name: string): CardDef => compileCardV2(getCard(name), defaultCompileSources({ caps: WITHOUT, parse: defaultParseOptions({ capabilities: WITHOUT }) }));

  it.each(['Command Tower', 'Arcane Signet', 'Stormsurge Kraken', 'Bastion Protector', 'Command Beacon', 'Edgar Markov', 'Loyal Drake', 'Fierce Guardianship'])(
    '%s is never full on an engine without the Commander capabilities', (name) => {
      expect(before(name).automation.level).not.toBe('full');
      expect(compileCard(getCard(name)).automation.level).toBe('full');
    },
  );

  it("Commander's Insignia needs only q:commanderCasts, exact in every game since M11-0 (0 outside Commander, CR 903.8)", () => {
    expect(before("Commander's Insignia").automation.level).toBe('full');
  });

  it('CMDF: "Commander spells you cast cost {1} less" is full now that the rule hooks read the commander field (rfilter:commander, test/cmdf/commander-spells.test.ts)', () => {
    expect(ENGINE_CAPABILITIES.has('rfilter:commander')).toBe(true);
    expect(level('Enchantment', 'Commander spells you cast cost {1} less to cast.')).toBe('full');
  });
});
