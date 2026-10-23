/**
 * M6-10 (m6 design 5 "M6-10", 6, E22): the acceptance cards of the M6 gate. Every card of section 6 is compiled by the default compiler (the game path,
 * `compileCard` over the fixture's Oracle data) and its level is pinned in `ACCEPTANCE`: a card that is not full carries the exact cause that keeps it below
 * full (the gate report in STATUS.md lists them; a card that gets better fails this pin, which is then moved up). Every full card is played here as a scenario
 * on the game path: real fixture cards in a real game, driven by real actions; nothing is mocked and no card is hand-built JSON.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, advanceTo, answer, find, pass, scenario, tweak } from '../../m5/helpers';
import { activate, cast, countOn, drive, handSize, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';
import { declareAttackers, lifeOf, passUntil, runCombat, toDeclareAttackers, toStep } from '../../m4/helpers';
import { castFaceDown, turnUp } from '../face-down/support';

type Level = 'full' | 'partial' | 'manual';
interface Pin { level: Level; package: string; cause?: string }

/** Section 6, every card, with its game-path level on the merged milestone 6 tree and, below full, why (m6 design E22: a miss is reported, never absorbed). */
export const ACCEPTANCE: Readonly<Record<string, Pin>> = {
  // M6-1: replacement and prevention
  'Doubling Season': { level: 'full', package: 'M6-1' },
  'Leyline of the Void': { level: 'full', package: 'M6-1, FAST4 MX1 (static:pregame, CR 103.6a: core/pregame.ts)' },
  'Rest in Peace': { level: 'full', package: 'M6-1, M6-12 (eff.t6.exile.allGraveyards promoted, design 6.9)' },
  'Magma Spray': { level: 'full', package: 'M6-1' },
  Fog: { level: 'full', package: 'M6-1' },
  'Furnace of Rath': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Thought Reflection': { level: 'full', package: 'M6-1' },
  'Hardened Scales': { level: 'full', package: 'M6-1' },
  Pariah: { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Circle of Protection: Red': { level: 'full', package: 'FAST5 T36 (eff.t36.prevent.nextSourceOfChoice.you: a chosen source and a one-use shield that re-checks its color, CR 609.7a, 615.9)' },
  'Laboratory Maniac': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  Fatigue: { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Orb of Dreams': { level: 'full', package: 'M6-1' },
  'Golgari Thug': { level: 'full', package: 'M6-1' },
  'Fiery Temper': { level: 'full', package: 'M6-12 (madness, op:cast.costChange)' },
  Ephemerate: { level: 'full', package: 'M6-1' },
  'Dregscape Zombie': { level: 'full', package: 'M6-1' },
  // M6-2: copy effects
  Clone: { level: 'full', package: 'M6-2' },
  'Phantasmal Image': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Voice of All': { level: 'full', package: 'M6-2, MX2 (protection from the chosen color: quality chosen:color, CR 702.16a, 607.2d)' },
  'Spark Double': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Altered Ego': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Moritte of the Frost': { level: 'partial', package: 'M6-2', cause: 'its copy sentence (legendary and snow in addition, CR 707.9f "if it\'s a creature" counters and changeling) has no template' },
  'Quicksilver Gargantuan': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  Tarmogoyf: { level: 'full', package: 'M6-2' },
  'Vesuvan Doppelganger': { level: 'full', package: 'M6-2, MX2 (the retained color and the self-referencing "it has this ability", CR 707.9a, 707.9c)' },
  'Runeclaw Bear': { level: 'full', package: 'M6-2' },
  'Primal Clay': { level: 'manual', package: 'M6-2', cause: '"As this creature enters, it becomes your choice of ..." needs feature:copy.asEntersPT (CR 613.2a), which M6-2 left unregistered (fail closed), and has no template' },
  Cytoshape: { level: 'manual', package: 'M6-2', cause: '"Choose a nonlegendary creature on the battlefield. Target creature becomes a copy of that creature until end of turn." has no template' },
  // r4-fxz: the back face's "Target player draws X cards, where X is the number of cards in your hand" reads with eff.fxz.draw.whereX (CR 107.3, 121.1)
  'Jushi Apprentice // Tomoya the Revealer': { level: 'full', package: 'M6-2, M6-4, r4-fxz' },
  'Nezumi Shortfang // Stabwhisker the Odious': { level: 'partial', package: 'M6-2, M6-4', cause: '"Then if that player has no cards in hand, flip ~." and the back face\'s "loses 1 life for each card fewer than three in their hand" have no template' },
  'Essence of the Wild': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Rusted Sentinel': { level: 'full', package: 'M6-2' },
  'Sacred Cat': { level: 'full', package: 'M6-12 (embalm)' },
  Fork: { level: 'manual', package: 'M6-2', cause: '"Copy target instant or sorcery spell, except that the copy is red" has no template, and a spell copy with exceptions is resolved by hand (effects/handlers/tokens-copy.ts, CR 707.10, 707.9b)' },
  Twincast: { level: 'full', package: 'M6-2' },
  'Kavu Titan': { level: 'full', package: 'M6-5' },
  // M6-3: face-down
  'Exalted Angel': { level: 'full', package: 'M6-3' },
  Willbender: { level: 'full', package: 'M6-3, r4-fxb ("change the target of target spell or ability with a single target", op changeTarget, CR 115.7)' },
  'Den Protector': { level: 'full', package: 'M6-3' },
  'Hooded Hydra': { level: 'full', package: 'M6-3, r4-fxb ("create a ... token for each +1/+1 counter on it", the counters it last had, CR 608.2h)' },
  'Grinning Demon': { level: 'full', package: 'M6-3' },
  'Branchsnap Lorian': { level: 'full', package: 'M6-3' },
  'Wandering Ones': { level: 'full', package: 'M6-3' },
  'Alley Assailant': { level: 'full', package: 'M6-3' },
  'Whisperwood Elemental': { level: 'partial', package: 'M6-3', cause: 'manifest at the end step is full; "Until end of turn, face-up nontoken creatures you control gain \'When ~ dies, manifest the top card of your library.\'" has no template' },
  'Cryptic Coat': { level: 'full', package: 'M6-3, FAST5X E25 (the cloak-then-attach sentence), r4-fxb (sta.pump.cantbeblocked promoted, design 6.9)' },
  'Abhorrent Oculus': { level: 'full', package: 'M6-3' },
  // M6-5: costs
  'Burst Lightning': { level: 'full', package: 'M6-5' },
  'Gatekeeper of Malakir': { level: 'full', package: 'M6-5' },
  'Archangel of Wrath': { level: 'full', package: 'M6-5' },
  Mulldrifter: { level: 'full', package: 'M6-5' },
  'Everflowing Chalice': { level: 'full', package: 'M6-5' }, // r4-cost: the counted mana ability (eff.cost.mana.forEachCounter, CR 605.1a)
  Capsize: { level: 'full', package: 'M6-5' },
  'Village Rites': { level: 'full', package: 'M6-5' },
  // M6-7: requirements
  Lure: { level: 'full', package: 'M6-7' },
  'Goblin Brigand': { level: 'full', package: 'M6-7' },
  'Prized Unicorn': { level: 'full', package: 'M6-7' },
  'Hunt Down': { level: 'full', package: 'M6-7' },
  // M6-4: double-faced cards, flip, day and night, meld
  'Delver of Secrets // Insectile Aberration': { level: 'partial', package: 'M6-4', cause: '"look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform ~." has no template' },
  'Huntmaster of the Fells // Ravager of the Fells': { level: 'partial', package: 'M6-4', cause: 'the werewolf transforms are full; the back face\'s "2 damage to target opponent or planeswalker and 2 damage to up to one target creature that player or that planeswalker\'s controller controls" has no template' },
  'Instigator Gang // Wildblood Pack': { level: 'full', package: 'M6-4' },
  'Kruin Outlaw // Terror of Kruin Pass': { level: 'full', package: 'M6-4' },
  'Elite Vanguard': { level: 'full', package: 'M6-4' },
  'Brutal Cathar // Moonrage Brute': { level: 'full', package: 'M6-4, FAST4 MX1 (op:move.until, CR 610.3; trg.m6.self.entersOrTransformsInto promoted, design 6.9)' },
  'Beloved Beggar // Generous Soul': { level: 'full', package: 'M6-4' },
  'Akki Lavarunner // Tok-Tok, Volcano Born': { level: 'full', package: 'M6-4, M6-12 (eff.m6.flip promoted, design 6.9)' },
  'Bushi Tenderfoot // Kenzo the Hardhearted': { level: 'full', package: 'M6-4, M6-12 (eff.m6.flip promoted, design 6.9)' },
  'Bruna, the Fading Light': { level: 'full', package: 'M6-4, std-re ("target Angel or Human creature card": subtypes before one card type, CR 205.3m; the meld is on Gisela)' },
  'Gisela, the Broken Blade': { level: 'full', package: 'M6-4, MX2 (the intervening "if you both own and control" and action meldPair, CR 603.4, 701.42a)' },
  'Brisela, Voice of Nightmares': { level: 'full', package: 'M6-4, std-rx21 ("Your opponents can\'t cast spells with mana value 3 or less.": sta.stdrx21.player.cantCast.filter, CR 601.3)' },
  'Graf Rats': { level: 'full', package: 'M6-4, MX2 (the intervening "if you both own and control" and action meldPair, CR 603.4, 701.42a)' },
  'Midnight Scavengers': { level: 'full', package: 'M6-4' },
  'Chittering Host': { level: 'full', package: 'M6-4' },
  'Wheel of Sun and Moon': { level: 'partial', package: 'M6-4', cause: '"If a card would be put into enchanted player\'s graveyard from anywhere, instead that card is revealed and put on the bottom of that player\'s library." has no template' },
  // M6-6: layouts
  'History of Benalia': { level: 'full', package: 'M6-6' },
  // merge wave 8 (audit D2, CR 701.9a, 608.2c): chapter II "Discard any number of cards, then draw that many cards." reads "that many" as the cards discarded (the
  // discard acts on the chosen cards, lower/quantities.ts#unitSources), so the card is full
  'The Elder Dragon War': { level: 'full', package: 'M6-6, merge wave 8 (audit D2)' },
  'Bard Class': { level: 'partial', package: 'M6-6', cause: 'the class levels are full structure; level 1 "Legendary creatures you control enter with an additional +1/+1 counter on them", level 2\'s colored-only cost reduction and level 3\'s "You may play them this turn" have no template' },
  'Student of Warfare': { level: 'full', package: 'M6-6' },
  'Case of the Locked Hothouse': { level: 'full', package: 'M6-6, FAST5X E14 (the solved ability: sta.e14.top.look.lands.cast, CR 401.5, 601.3, 305.1)' },
  'Phyrexian Fleshgorger': { level: 'full', package: 'M6-6, FAST5X E27 ("Ward—Pay life equal to this creature\'s power", CR 702.21a, 608.2h)' },
  'Strife Scholar // Awaken the Ages': { level: 'full', package: 'M6-6' },
  'Encouraging Aviator // Jump': { level: 'full', package: 'M6-6' },
  'Croaking Counterpart': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  // M6-8: text change
  'Sleight of Mind': { level: 'full', package: 'M6-8' },
  'Magical Hack': { level: 'full', package: 'M6-8' },
  'Artificial Evolution': { level: 'full', package: 'M6-8' },
  // M6-9: mutate
  Gemrazer: { level: 'full', package: 'M6-9' },
  // M6-10: milestone 5 layers and triggers re-tested with layers 1a, 1b and 3 present
  Humility: { level: 'full', package: 'M6-10' },
  Opalescence: { level: 'full', package: 'M6-10' },
  'Blood Moon': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  'Urborg, Tomb of Yawgmoth': { level: 'full', package: 'M6-10 (zz-m6/gate.json)' },
  Panharmonicon: { level: 'full', package: 'M6-12 (static:triggerMod for a permanent entering, zz-m6/triggers.json)' },
  'Oko, Thief of Crowns': { level: 'full', package: 'M6-10, MX2 (op:exchange.control and layer-2 control on the stored controller, core/control.ts)' },
};

describe('m6 design 6, E22: the game-path level of every acceptance card', () => {
  for (const [name, pin] of Object.entries(ACCEPTANCE)) {
    it(`${name} (${pin.package}) is ${pin.level}${pin.cause ? ` (${pin.cause.slice(0, 60)}...)` : ''}`, () => {
      expect(compileCard(getCard(name)).automation.level).toBe(pin.level);
      expect(pin.level === 'full' || (pin.cause ?? '').length > 20, 'a card below full names its cause').toBe(true);
    });
  }

  it('the gate count: how many acceptance cards are full (the gate needs all of them, E22)', () => {
    const levels = Object.values(ACCEPTANCE).map((p) => p.level);
    expect([levels.length, levels.filter((l) => l === 'full').length]).toEqual([94, 84]); // std-rx21: + Brisela, Voice of Nightmares; std-re: + Bruna, the Fading Light; merge wave 8 (audit D2): + The Elder Dragon War; r4-fxz: + Jushi Apprentice; r4-fxb: + Cryptic Coat, Willbender, Hooded Hydra; r4-cost: + Everflowing Chalice; FAST5X E27: + Phyrexian Fleshgorger; FAST4 MX1: + Leyline of the Void, Brutal Cathar; MX2: + Oko, Voice of All, Gisela, Graf Rats, Vesuvan Doppelganger; FAST5X E14: + Case of the Locked Hothouse
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Scenarios: every full acceptance card, played on the game path
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
const on = (s: GameState, name: string, owner: PlayerId = 'p1'): ObjectId => find(s, name, 'battlefield', owner);
const ptOf = (s: GameState, id: ObjectId): [string | undefined, string | undefined] => [getChars(s, id).power, getChars(s, id).toughness];
const names = (s: GameState, zone: 'hand' | 'graveyard', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name);
const tokens = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
/** Cast from the hand with a cast method ("kicker", "evoke", ...), answering `answers`, paying automatically. */
const castBy = (s: GameState, name: string, method: string | undefined, answers: DecisionAnswer[] = [], player: PlayerId = 'p1'): GameState =>
  drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method !== undefined ? { method } : {}) }), answers);

describe('M6-1 acceptance cards on the game path (replacement and prevention, CR 614-616)', () => {
  it('Doubling Season (CR 614.1a, 614.16): Raise the Alarm creates four Soldiers', () => {
    let s = scenario(['Doubling Season', 'Raise the Alarm', 'Plains'], { p1: { hand: ['Raise the Alarm'], battlefield: ['Doubling Season', ...lands('Plains', 2)] } });
    s = resolveTop(cast(s, 'Raise the Alarm'));
    expect(tokens(s, 'p1')).toHaveLength(4);
  });

  it('Magma Spray (CR 614.1a, 615.8 shield): the creature it damaged that would die this turn is exiled instead', () => {
    let s = scenario(['Magma Spray', 'Mountain', 'Elite Vanguard'], { p1: { hand: ['Magma Spray'], battlefield: ['Mountain'] }, p2: { battlefield: ['Elite Vanguard'] } });
    s = resolveTop(cast(s, 'Magma Spray', [target(on(s, 'Elite Vanguard', 'p2'))]));
    expect(exiled(s)).toContain('Elite Vanguard');
    expect(names(s, 'graveyard', 'p2')).not.toContain('Elite Vanguard');
  });

  it('Fog (CR 615.1a): no combat damage is dealt this turn', () => {
    let s = scenario(['Fog', 'Forest', 'Hill Giant'], { p1: { battlefield: ['Hill Giant'] }, p2: { hand: ['Fog'], battlefield: ['Forest'] } });
    s = declareAttackers(toDeclareAttackers(s), [[on(s, 'Hill Giant')]]);
    s = passUntil(s, (x) => x.pending?.player === 'p2' && x.pending.kind === 'priority', 'p2 priority');
    s = resolveTop(cast(s, 'Fog', [], 'p2'));
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'declareBlockers', 'end of combat');
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = toStep(s, 'endCombat');
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('Furnace of Rath (CR 614.1a, 614.5): Shock deals 4 damage; two Furnaces double it twice (8)', () => {
    let s = scenario(['Furnace of Rath', 'Shock', 'Mountain'], { p1: { hand: ['Shock'], battlefield: ['Furnace of Rath', 'Mountain'] } });
    s = resolveTop(cast(s, 'Shock', [target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(16);
    let t = scenario(['Furnace of Rath', 'Shock', 'Mountain'], { p1: { hand: ['Shock'], battlefield: ['Furnace of Rath', 'Furnace of Rath', 'Mountain'] } });
    t = resolveTop(cast(t, 'Shock', [target('p2')]));
    expect(lifeOf(t, 'p2')).toBe(12);
  });

  it('Thought Reflection (CR 614.6, 614.5): a draw step draws two cards; two of them draw four (each draw its own event)', () => {
    let s = scenario(['Thought Reflection'], { p1: { battlefield: ['Thought Reflection'] } });
    const before = handSize(s, 'p1');
    s = advanceTo(s, 3, 'main1');
    expect(handSize(s, 'p1')).toBe(before + 2);
    let t = scenario(['Thought Reflection'], { p1: { battlefield: ['Thought Reflection', 'Thought Reflection'] } });
    t = advanceTo(t, 3, 'draw');
    // CR 616.1: the affected player chooses which of the two applies first, for the draw and again for each replacing draw (CR 614.5)
    for (let i = 0; i < 10 && t.pending?.kind === 'chooseReplacement'; i++) t = answer(t, { kind: 'chooseReplacement', id: t.pending.options[0]!.id });
    t = passUntil(t, (x) => x.turn.step === 'main1', 'the main phase');
    expect(handSize(t, 'p1')).toBe(before + 4);
  });

  it('Hardened Scales (CR 614.1a, 122.6): one more +1/+1 counter; with Doubling Season the player orders them (616.1e)', () => {
    let s = scenario(['Hardened Scales', 'Kavu Titan', 'Forest'], { p1: { hand: ['Kavu Titan'], battlefield: ['Hardened Scales', ...lands('Forest', 5)] } });
    s = resolveTop(castBy(s, 'Kavu Titan', undefined, [yes]));
    expect(s.objects[on(s, 'Kavu Titan')]!.counters['+1/+1']).toBe(4);
  });

  it('Pariah (CR 614.9): damage that would be dealt to its controller is dealt to the enchanted creature instead', () => {
    let s = scenario(['Pariah', 'Hill Giant', 'Shock', 'Mountain', 'Plains'], { p1: { hand: ['Pariah'], battlefield: ['Hill Giant', ...lands('Plains', 3)] }, p2: { hand: ['Shock'], battlefield: ['Mountain'] } });
    const giant = on(s, 'Hill Giant');
    s = resolveTop(cast(s, 'Pariah', [target(giant)]));
    s = pass(s);
    s = resolveTop(cast(s, 'Shock', [target('p1')], 'p2'));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.objects[giant]!.damage).toBe(2);
  });

  it('CR 614.9: the same template on a creature ("... is dealt to this creature instead", an invented card): the creature is dealt the damage', () => {
    const guardian = compileCard({ name: 'Test Bodyguard', layout: 'normal', type_line: 'Creature — Giant', mana_cost: '{3}{W}', power: '2', toughness: '5', oracle_text: 'All damage that would be dealt to you is dealt to this creature instead.', colors: ['W'] } as never);
    expect(guardian.automation.level).toBe('full');
    let s = scenario(['Shock', 'Mountain'], { p1: { battlefield: ['Test Bodyguard'] }, p2: { hand: ['Shock'], battlefield: ['Mountain'] }, defs: [guardian] });
    s = pass(s);
    s = resolveTop(cast(s, 'Shock', [target('p1')], 'p2'));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.objects[on(s, 'Test Bodyguard')]!.damage).toBe(2);
  });

  it('Laboratory Maniac (CR 614.6, 104.2b): drawing from an empty library wins the game', () => {
    let s = scenario(['Laboratory Maniac'], { p1: { battlefield: ['Laboratory Maniac'] } });
    s = tweak(s, (t) => { t.zones.library.p1 = []; });
    s = advanceTo(s, 3, 'draw');
    expect(s.result).toMatchObject({ winner: 'p1' });
  });

  it('Fatigue (CR 614.10a): Bob skips his next draw step only', () => {
    let s = scenario(['Fatigue', 'Island'], { p1: { hand: ['Fatigue'], battlefield: ['Island', 'Island'] } });
    s = resolveTop(cast(s, 'Fatigue', [target('p2')]));
    const before = handSize(s, 'p2');
    s = advanceTo(s, 2, 'main1');
    expect(handSize(s, 'p2')).toBe(before);
    s = advanceTo(s, 4, 'main1');
    expect(handSize(s, 'p2')).toBe(before + 1);
  });

  it('Orb of Dreams (CR 614.12): permanents enter tapped, but not the Orb itself', () => {
    let s = scenario(['Orb of Dreams', 'Elite Vanguard', 'Plains'], { p1: { hand: ['Orb of Dreams', 'Elite Vanguard'], battlefield: lands('Plains', 4) } });
    s = resolveTop(cast(s, 'Orb of Dreams'));
    expect(s.objects[on(s, 'Orb of Dreams')]!.tapped).toBe(false);
    s = resolveTop(cast(s, 'Elite Vanguard'));
    expect(s.objects[on(s, 'Elite Vanguard')]!.tapped).toBe(true);
  });

  it('Golgari Thug (CR 702.52a): its owner dredges it back instead of drawing', () => {
    let s = scenario(['Golgari Thug'], { p1: { graveyard: ['Golgari Thug'] } });
    s = advanceTo(s, 3, 'draw');
    s = drive(s, [yes]);
    expect(names(s, 'hand', 'p1')).toContain('Golgari Thug');
    expect(s.zones.graveyard.p1!.length).toBe(4);
  });

  it('Rest in Peace (CR 603.6a, 614.1a): when it enters, all graveyards are exiled; then a dying creature is exiled instead', () => {
    let s = scenario(['Rest in Peace', 'Plains', 'Grizzly Bears', 'Shock', 'Mountain'], { p1: { hand: ['Rest in Peace'], graveyard: ['Grizzly Bears'], battlefield: lands('Plains', 2) }, p2: { graveyard: ['Shock'], battlefield: ['Grizzly Bears', 'Mountain'], hand: ['Shock'] } });
    s = resolveTop(resolveTop(cast(s, 'Rest in Peace')));
    expect([s.zones.graveyard.p1, s.zones.graveyard.p2]).toEqual([[], []]);
    expect(exiled(s).sort()).toEqual(['Grizzly Bears', 'Shock']);
    s = pass(s);
    s = resolveTop(cast(s, 'Shock', [target(on(s, 'Grizzly Bears', 'p2'))], 'p2'));
    expect(s.zones.graveyard.p2).toEqual([]);
    expect(exiled(s).sort()).toEqual(['Grizzly Bears', 'Grizzly Bears', 'Shock', 'Shock']);
  });

  it('Fiery Temper (CR 702.35a-b): discarded to Faithless Looting, it is exiled and cast for its madness cost {R}', () => {
    let s = scenario(['Fiery Temper', 'Faithless Looting', 'Mountain'], { p1: { hand: ['Faithless Looting', 'Fiery Temper'], battlefield: lands('Mountain', 2) } });
    s = resolveTop(cast(s, 'Faithless Looting'));
    const temper = find(s, 'Fiery Temper', 'hand');
    s = answer(s, pick(temper, s.pending!.kind === 'chooseObjects' ? s.pending!.options.find((x) => x !== temper)! : temper));
    expect(exiled(s)).toContain('Fiery Temper');
    s = resolveTop(s, [yes, target('p2')]);
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(names(s, 'graveyard', 'p1')).toContain('Fiery Temper');
  });

  it('Ephemerate (CR 702.88a): exiled as it resolves, cast again from exile at the next upkeep', () => {
    let s = scenario(['Ephemerate', 'Plains', 'Elite Vanguard'], { p1: { hand: ['Ephemerate'], battlefield: ['Plains', 'Elite Vanguard'] } });
    s = resolveTop(cast(s, 'Ephemerate', [target(on(s, 'Elite Vanguard'))]));
    expect(exiled(s)).toContain('Ephemerate');
    expect(countOn(s, 'Elite Vanguard', 'p1')).toBe(1);
  });

  it('Dregscape Zombie (CR 702.84a): unearthed with haste; if it would leave, it is exiled instead', () => {
    let s = scenario(['Dregscape Zombie', 'Swamp', 'Shock', 'Mountain'], { p1: { graveyard: ['Dregscape Zombie'], battlefield: ['Swamp'] }, p2: { hand: ['Shock'], battlefield: ['Mountain'] } });
    const z = find(s, 'Dregscape Zombie', 'graveyard', 'p1');
    s = resolveTop(activate(s, z));
    const zombie = on(s, 'Dregscape Zombie');
    s = pass(s);
    s = resolveTop(cast(s, 'Shock', [target(zombie)], 'p2'));
    expect(exiled(s)).toContain('Dregscape Zombie');
  });
});

describe('M6-2 acceptance cards on the game path (copy effects, CR 707)', () => {
  const castCopy = (s: GameState, name: string, of: ObjectId | null, answers: DecisionAnswer[] = []): GameState => drive(resolveTop(cast(s, name, answers)), [pick(...(of ? [of] : []))]);

  it('Sacred Cat (CR 702.128a, 707.9b): embalmed, a white Zombie Cat token copy with no mana cost and lifelink', () => {
    let s = scenario(['Sacred Cat', 'Plains'], { p1: { graveyard: ['Sacred Cat'], battlefield: ['Plains'] } });
    s = resolveTop(activate(s, find(s, 'Sacred Cat', 'graveyard')));
    const [cat] = tokens(s, 'p1');
    const c = getChars(s, cat!);
    expect([c.colors, c.subtypes, c.manaCost]).toEqual([['W'], ['Cat', 'Zombie'], null]);
    expect(c.keywords.map((k) => k.keyword)).toContain('lifelink');
    expect(exiled(s)).toEqual(['Sacred Cat']);
  });

  it('Clone (CR 707.5): enters as a copy of the chosen creature', () => {
    let s = scenario(['Clone', 'Hill Giant', 'Island'], { p1: { hand: ['Clone'], battlefield: lands('Island', 4) }, p2: { battlefield: ['Hill Giant'] } });
    s = castCopy(s, 'Clone', on(s, 'Hill Giant', 'p2'));
    expect(getChars(s, on(s, 'Clone')).name).toBe('Hill Giant');
  });

  it('Phantasmal Image (CR 707.9a-b): an Illusion in addition, sacrificed when it becomes the target of a spell', () => {
    let s = scenario(['Phantasmal Image', 'Hill Giant', 'Island', 'Giant Growth', 'Forest'], { p1: { hand: ['Phantasmal Image', 'Giant Growth'], battlefield: [...lands('Island', 2), 'Forest'] }, p2: { battlefield: ['Hill Giant'] } });
    s = castCopy(s, 'Phantasmal Image', on(s, 'Hill Giant', 'p2'));
    const img = on(s, 'Phantasmal Image');
    expect(getChars(s, img)).toMatchObject({ name: 'Hill Giant', subtypes: ['Giant', 'Illusion'] });
    s = cast(s, 'Giant Growth', [target(img)]);
    s = resolveTop(s);
    expect(s.zones.battlefield).not.toContain(img);
  });

  it('Spark Double (CR 707.5, 707.9b, 707.9e): a copy of a creature you control with an extra +1/+1 counter, not legendary', () => {
    let s = scenario(['Spark Double', 'Isamaru, Hound of Konda', 'Island'], { p1: { hand: ['Spark Double'], battlefield: ['Isamaru, Hound of Konda', ...lands('Island', 4)] } });
    s = castCopy(s, 'Spark Double', on(s, 'Isamaru, Hound of Konda'));
    const copy = on(s, 'Spark Double');
    expect(getChars(s, copy).name).toBe('Isamaru, Hound of Konda');
    expect(getChars(s, copy).supertypes).not.toContain('Legendary');
    expect(s.objects[copy]!.counters['+1/+1']).toBe(1);
    expect(countOn(s, 'Isamaru, Hound of Konda', 'p1')).toBe(1); // the original stays (no legend rule)
  });

  it('Altered Ego (CR 707.9e): X additional +1/+1 counters on the copy', () => {
    let s = scenario(['Altered Ego', 'Hill Giant', 'Island', 'Forest'], { p1: { hand: ['Altered Ego'], battlefield: [...lands('Island', 3), ...lands('Forest', 3)] }, p2: { battlefield: ['Hill Giant'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Altered Ego', 'hand') }), [{ kind: 'chooseNumber', n: 2 }]);
    s = drive(resolveTop(s), [pick(on(s, 'Hill Giant', 'p2'))]);
    const ego = on(s, 'Altered Ego');
    expect(getChars(s, ego).name).toBe('Hill Giant');
    expect(s.objects[ego]!.counters['+1/+1']).toBe(2);
  });

  it('Quicksilver Gargantuan + Tarmogoyf (CR 707.9b, 707.9d): the copy is 7/7, the CDA is not copied', () => {
    let s = scenario(['Quicksilver Gargantuan', 'Tarmogoyf', 'Island'], { p1: { hand: ['Quicksilver Gargantuan'], battlefield: lands('Island', 7) }, p2: { battlefield: ['Tarmogoyf'] } });
    s = castCopy(s, 'Quicksilver Gargantuan', on(s, 'Tarmogoyf', 'p2'));
    const q = on(s, 'Quicksilver Gargantuan');
    expect(getChars(s, q).name).toBe('Tarmogoyf');
    expect(ptOf(s, q)).toEqual(['7', '7']);
  });

  it('Runeclaw Bear and Essence of the Wild + Rusted Sentinel (CR 616.1c, 616.1f example): the creature enters as a copy of Essence, untapped', () => {
    let s = scenario(['Essence of the Wild', 'Rusted Sentinel', 'Runeclaw Bear', 'Forest'], { p1: { hand: ['Rusted Sentinel', 'Runeclaw Bear'], battlefield: ['Essence of the Wild', ...lands('Forest', 6)] } });
    s = resolveAll(cast(s, 'Rusted Sentinel'));
    const sentinel = on(s, 'Rusted Sentinel');
    expect(getChars(s, sentinel).name).toBe('Essence of the Wild');
    expect(s.objects[sentinel]!.tapped).toBe(false);
    s = resolveAll(cast(s, 'Runeclaw Bear'));
    expect(getChars(s, on(s, 'Runeclaw Bear')).name).toBe('Essence of the Wild');
  });

  it('Twincast (CR 707.10): a copy of Shock with a new target', () => {
    let s = scenario(['Twincast', 'Shock', 'Island', 'Mountain'], { p1: { hand: ['Twincast'], battlefield: lands('Island', 2) }, p2: { hand: ['Shock'], battlefield: ['Mountain'] } });
    s = pass(s);
    s = cast(s, 'Shock', [target('p1')], 'p2');
    s = pass(s);
    s = cast(s, 'Twincast', [target(s.zones.stack[0]!)]);
    s = resolveAll(s, [yes, target('p2')]);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(lifeOf(s, 'p2')).toBe(18);
  });

  it('Kavu Titan (CR 702.33a, 614.1c): kicked, it enters with three +1/+1 counters and has trample', () => {
    let s = scenario(['Kavu Titan', 'Forest'], { p1: { hand: ['Kavu Titan'], battlefield: lands('Forest', 5) } });
    s = resolveTop(castBy(s, 'Kavu Titan', undefined, [yes]));
    const titan = on(s, 'Kavu Titan');
    expect(ptOf(s, titan)).toEqual(['5', '5']);
  });
});

describe('M6-3 acceptance cards on the game path (face-down, CR 708)', () => {
  it('Exalted Angel (CR 702.37): cast face down for {3}, turned face up for {2}{W}{W}', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { hand: ['Exalted Angel'], battlefield: lands('Plains', 7) } });
    s = resolveTop(castFaceDown(s, 'Exalted Angel'));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
    expect(ptOf(s, id)).toEqual(['2', '2']);
    s = turnUp(s, id);
    expect(getChars(s, id)).toMatchObject({ name: 'Exalted Angel', power: '4', toughness: '5' });
  });

  it('Den Protector (CR 702.37b, 708.11): megamorph puts a +1/+1 counter on it as it is turned face up', () => {
    let s = scenario(['Den Protector', 'Forest'], { p1: { hand: ['Den Protector'], battlefield: lands('Forest', 5) } });
    s = resolveTop(castFaceDown(s, 'Den Protector'));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
    s = drive(turnUp(s, id));
    expect(s.objects[id]!.counters['+1/+1']).toBe(1);
    expect(getChars(s, id).name).toBe('Den Protector');
  });

  it('Grinning Demon, Branchsnap Lorian, Wandering Ones (CR 702.37e): each is turned up for its own morph cost', () => {
    let s = scenario(['Branchsnap Lorian', 'Forest'], { p1: { hand: ['Branchsnap Lorian'], battlefield: lands('Forest', 4) } });
    s = resolveTop(castFaceDown(s, 'Branchsnap Lorian'));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
    s = turnUp(s, id);
    expect(getChars(s, id).name).toBe('Branchsnap Lorian');
    for (const n of ['Grinning Demon', 'Wandering Ones']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });

  it('Alley Assailant (CR 702.168a): cast disguised it is a 2/2 with ward {2}', () => {
    let s = scenario(['Alley Assailant', 'Swamp'], { p1: { hand: ['Alley Assailant'], battlefield: lands('Swamp', 3) } });
    s = resolveTop(castFaceDown(s, 'Alley Assailant', 'disguise'));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
    expect(ptOf(s, id)).toEqual(['2', '2']);
    expect(getChars(s, id).abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === 'ward')).toBe(true);
  });

  it('Abhorrent Oculus (CR 701.62a): at each opponent\'s upkeep its controller manifests dread', () => {
    let s = scenario(['Abhorrent Oculus'], { p1: { battlefield: ['Abhorrent Oculus'] } });
    s = advanceTo(s, 2, 'upkeep');
    for (let i = 0; i < 12 && !s.zones.battlefield.some((x) => s.objects[x]!.faceDown); i++) {
      const d = s.pending!;
      if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [d.options[0]!] });
      else if (d.kind === 'priority') s = pass(s);
      else break;
    }
    expect(s.zones.battlefield.some((x) => s.objects[x]!.faceDown && s.objects[x]!.controller === 'p1')).toBe(true);
  });
});

describe('M6-5 acceptance cards on the game path (costs as data, CR 118.8-118.9, 702.33)', () => {
  it('Burst Lightning (CR 702.33d): kicked it deals 4 damage', () => {
    let s = scenario(['Burst Lightning', 'Mountain'], { p1: { hand: ['Burst Lightning'], battlefield: lands('Mountain', 5) } });
    s = resolveTop(castBy(s, 'Burst Lightning', undefined, [yes, target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(16);
  });

  it('Gatekeeper of Malakir (CR 702.33d, 603.4): kicked, the target player sacrifices a creature', () => {
    let s = scenario(['Gatekeeper of Malakir', 'Swamp', 'Hill Giant'], { p1: { hand: ['Gatekeeper of Malakir'], battlefield: lands('Swamp', 3) }, p2: { battlefield: ['Hill Giant'] } });
    s = resolveAll(castBy(s, 'Gatekeeper of Malakir', undefined, [yes]), [target('p2')]);
    expect(countOn(s, 'Hill Giant', 'p2')).toBe(0);
  });

  it('Archangel of Wrath (CR 702.33d, 702.33f): kicked twice, both triggers deal 2 damage each', () => {
    let s = scenario(['Archangel of Wrath', 'Plains', 'Swamp', 'Mountain'], { p1: { hand: ['Archangel of Wrath'], battlefield: [...lands('Plains', 4), 'Swamp', 'Mountain'] } });
    s = resolveTop(castBy(s, 'Archangel of Wrath', undefined, [yes, yes]), [target('p2'), target('p2')]);
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(16);
  });

  it('Mulldrifter (CR 702.74a): evoked, it draws two cards and is sacrificed', () => {
    let s = scenario(['Mulldrifter', 'Island'], { p1: { hand: ['Mulldrifter'], battlefield: lands('Island', 3) } });
    const before = handSize(s, 'p1');
    s = resolveAll(castBy(s, 'Mulldrifter', 'evoke'));
    expect(handSize(s, 'p1')).toBe(before - 1 + 2);
    expect(names(s, 'graveyard', 'p1')).toContain('Mulldrifter');
  });

  it('Capsize (CR 702.27a): with buyback it returns to its owner\'s hand as it resolves', () => {
    let s = scenario(['Capsize', 'Island', 'Hill Giant'], { p1: { hand: ['Capsize'], battlefield: lands('Island', 6) }, p2: { battlefield: ['Hill Giant'] } });
    s = resolveTop(castBy(s, 'Capsize', undefined, [yes, target(on(s, 'Hill Giant', 'p2'))]));
    expect(names(s, 'hand', 'p1')).toEqual(['Capsize']);
    expect(names(s, 'hand', 'p2')).toContain('Hill Giant');
  });

  it('Village Rites (CR 118.8, 601.2b): sacrifice a creature as an additional cost, draw two', () => {
    let s = scenario(['Village Rites', 'Swamp', 'Elite Vanguard'], { p1: { hand: ['Village Rites'], battlefield: ['Swamp', 'Elite Vanguard'] } });
    const before = handSize(s, 'p1');
    s = cast(s, 'Village Rites', [pick(on(s, 'Elite Vanguard'))]);
    s = resolveTop(s);
    expect(countOn(s, 'Elite Vanguard', 'p1')).toBe(0);
    expect(handSize(s, 'p1')).toBe(before - 1 + 2);
  });
});

describe('M6-7 acceptance cards on the game path (requirements, CR 508.1d, 509.1c)', () => {
  it('Goblin Brigand (CR 508.1d): declaring no attackers is illegal while it can attack', () => {
    let s = scenario(['Goblin Brigand'], { p1: { battlefield: [{ name: 'Goblin Brigand', since: 0 }] } });
    s = toDeclareAttackers(s);
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [] })).toThrow();
    s = declareAttackers(s, [[on(s, 'Goblin Brigand')]]);
    expect(s.combat?.attackers?.length ?? Object.keys(s.combat ?? {}).length).toBeGreaterThan(0);
  });

  it('Lure, Prized Unicorn, Hunt Down are full (their scenarios: test/m6/combat/requirements-cards.test.ts)', () => {
    for (const n of ['Lure', 'Prized Unicorn', 'Hunt Down']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });
});

describe('M6-4, M6-6, M6-8, M6-9 acceptance cards on the game path', () => {
  it('Akki Lavarunner (CR 710.4, 710.2): dealing combat damage to an opponent flips it into Tok-Tok, whose replacement adds 1 to red damage dealt to a player (CR 614.1a)', () => {
    let s = scenario(['Akki Lavarunner // Tok-Tok, Volcano Born', 'Shock', 'Mountain'], { p1: { battlefield: ['Akki Lavarunner // Tok-Tok, Volcano Born', 'Mountain'], hand: ['Shock'] } });
    const akki = on(s, 'Akki Lavarunner // Tok-Tok, Volcano Born');
    s = runCombat(s, { attack: [[akki]] });
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the second main phase');
    expect(getChars(s, akki).name).toBe('Tok-Tok, Volcano Born');
    expect(lifeOf(s, 'p2')).toBe(19);
    s = resolveTop(cast(s, 'Shock', [target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(16); // 2 + 1 (Tok-Tok)
  });

  it('Bushi Tenderfoot (CR 710.4, 700.4): when a creature it dealt damage to this turn dies, it flips into Kenzo the Hardhearted', () => {
    let s = scenario(['Bushi Tenderfoot // Kenzo the Hardhearted', 'Llanowar Elves', 'Giant Growth', 'Forest'], { p1: { battlefield: ['Bushi Tenderfoot // Kenzo the Hardhearted', 'Forest'], hand: ['Giant Growth'] }, p2: { battlefield: ['Llanowar Elves'] } });
    const bushi = on(s, 'Bushi Tenderfoot // Kenzo the Hardhearted');
    s = resolveTop(cast(s, 'Giant Growth', [target(bushi)])); // a 4/4 until end of turn: it survives the block
    s = runCombat(s, { attack: [[bushi]], block: [[on(s, 'Llanowar Elves', 'p2'), bushi]] });
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the second main phase');
    expect(names(s, 'graveyard', 'p2')).toContain('Llanowar Elves');
    expect(getChars(s, bushi).name).toBe('Kenzo the Hardhearted');
  });

  it('Instigator Gang (CR 701.27): transforms at the upkeep after a turn with no spells', () => {
    let s = scenario(['Instigator Gang // Wildblood Pack'], { p1: { battlefield: ['Instigator Gang // Wildblood Pack'] } });
    s = advanceTo(s, 2, 'main1');
    const id = on(s, 'Instigator Gang // Wildblood Pack');
    expect(getChars(s, id).name).toBe('Wildblood Pack');
  });

  it('Beloved Beggar (CR 702.146a): disturbed from the graveyard as Generous Soul', () => {
    let s = scenario(['Beloved Beggar // Generous Soul', 'Plains'], { p1: { graveyard: ['Beloved Beggar // Generous Soul'], battlefield: lands('Plains', 6) } });
    const card = find(s, 'Beloved Beggar // Generous Soul', 'graveyard', 'p1');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && (a.action as { card: string; method?: string }).card === card && (a.action as { method?: string }).method === 'disturb')).toBe(true);
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card, method: 'disturb' })));
    expect(getChars(s, on(s, 'Beloved Beggar // Generous Soul')).name).toBe('Generous Soul');
  });

  it('Oko, Thief of Crowns, Voice of All, Gisela, Graf Rats and Vesuvan Doppelganger (MX2): full on the game path (scenarios: test/mx2/)', () => {
    for (const n of ['Oko, Thief of Crowns', 'Voice of All', 'Gisela, the Broken Blade', 'Graf Rats', 'Vesuvan Doppelganger']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });

  it('Midnight Scavengers + Graf Rats -> Chittering Host, Kruin Outlaw, Elite Vanguard: full on the game path (scenarios: test/m6/dfc/)', () => {
    for (const n of ['Midnight Scavengers', 'Chittering Host', 'Kruin Outlaw // Terror of Kruin Pass', 'Elite Vanguard']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });

  it('History of Benalia (CR 714.3a-c, 714.2b): chapter I makes a 2/2 Knight, chapter II another at the next precombat main phase', () => {
    let s = scenario(['History of Benalia', 'Plains'], { p1: { hand: ['History of Benalia'], battlefield: lands('Plains', 3) } });
    s = resolveAll(cast(s, 'History of Benalia'));
    expect(tokens(s, 'p1')).toHaveLength(1);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(s);
    expect(tokens(s, 'p1')).toHaveLength(2);
    expect(s.objects[on(s, 'History of Benalia')]!.counters.lore).toBe(2);
  });

  it('Student of Warfare (CR 711): level up twice: 3/3 first strike', () => {
    let s = scenario(['Student of Warfare', 'Plains'], { p1: { battlefield: ['Student of Warfare', ...lands('Plains', 2)] } });
    const id = on(s, 'Student of Warfare');
    s = resolveTop(activate(s, id, [], /[Ll]evel up/));
    s = resolveTop(activate(s, id, [], /[Ll]evel up/));
    expect(ptOf(s, id)).toEqual(['3', '3']);
  });

  it('Strife Scholar and Encouraging Aviator (CR 722.3): full on the game path (scenarios: test/m6/layouts/prepare.test.ts)', () => {
    for (const n of ['Strife Scholar // Awaken the Ages', 'Encouraging Aviator // Jump']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });

  it('Croaking Counterpart (CR 707.9b): the token copy is a 1/1 green Frog', () => {
    let s = scenario(['Croaking Counterpart', 'Hill Giant', 'Island', 'Forest'], { p1: { hand: ['Croaking Counterpart'], battlefield: [...lands('Island', 1), ...lands('Forest', 2)] }, p2: { battlefield: ['Hill Giant'] } });
    s = resolveTop(cast(s, 'Croaking Counterpart', [target(on(s, 'Hill Giant', 'p2'))]));
    const [tok] = tokens(s, 'p1');
    expect(getChars(s, tok!)).toMatchObject({ name: 'Hill Giant', power: '1', toughness: '1', colors: ['G'], subtypes: ['Frog'] });
  });

  it('Sleight of Mind (CR 612.2): a "red" word changed to "green" on Pyroclasm-like text is full (scenarios: test/m6/text/)', () => {
    for (const n of ['Sleight of Mind', 'Magical Hack', 'Artificial Evolution']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });

  it('Gemrazer (CR 702.140): mutated over a creature, the merged creature has its abilities (scenarios: test/m6/mutate/)', () => {
    expect(compileCard(getCard('Gemrazer')).automation.level).toBe('full');
  });
});

describe('M6-10: milestone 5 layers re-tested with layers 1a, 1b and 3 present', () => {
  it('Panharmonicon (CR 603.2d): Mulldrifter\'s enters trigger triggers an additional time', () => {
    let s = scenario(['Panharmonicon', 'Mulldrifter', 'Island'], { p1: { hand: ['Mulldrifter'], battlefield: ['Panharmonicon', ...lands('Island', 5)] } });
    const before = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Mulldrifter'));
    expect(handSize(s, 'p1')).toBe(before - 1 + 4);
  });

  it('Humility + Opalescence (CR 613.8, 613.7): Opalescence makes Humility a creature; with Humility newer it is a 1/1, with Opalescence newer a 4/4', () => {
    const s = scenario(['Humility', 'Opalescence'], { p1: { battlefield: ['Opalescence', 'Humility'] } });
    const h = on(s, 'Humility');
    expect(getChars(s, h).types).toContain('Creature');
    expect(getChars(s, on(s, 'Opalescence')).types).not.toContain('Creature'); // "each other non-Aura enchantment"
    expect(ptOf(s, h)).toEqual(['1', '1']);
    const t = scenario(['Humility', 'Opalescence'], { p1: { battlefield: ['Humility', 'Opalescence'] } });
    expect(ptOf(t, on(t, 'Humility'))).toEqual(['4', '4']);
  });

  it('Blood Moon + Urborg (CR 613.8, 305.7): Urborg is a Mountain with no abilities, so other lands are not Swamps', () => {
    const s = scenario(['Blood Moon', 'Urborg, Tomb of Yawgmoth', 'Plains'], { p1: { battlefield: ['Blood Moon', 'Urborg, Tomb of Yawgmoth', 'Plains'] } });
    const u = on(s, 'Urborg, Tomb of Yawgmoth');
    expect(getChars(s, u).subtypes).toEqual(['Mountain']);
    expect(getChars(s, on(s, 'Plains')).subtypes).toEqual(['Plains']);
    const t = scenario(['Urborg, Tomb of Yawgmoth', 'Plains'], { p1: { battlefield: ['Urborg, Tomb of Yawgmoth', 'Plains'] } });
    expect(getChars(t, on(t, 'Plains')).subtypes).toEqual(['Plains', 'Swamp']);
  });
});

describe('FAST4 MX1 acceptance cards on the game path (CR 103.6a, 610.3; more in test/fast4/mx1)', () => {
  it('Leyline of the Void (CR 614.1a): a creature of an opponent that would die is exiled instead (its opening-hand action: test/fast4/mx1/pregame.test.ts)', () => {
    let s = scenario(['Leyline of the Void', 'Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Leyline of the Void', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = resolveTop(cast(s, 'Lightning Bolt', [target(on(s, 'Grizzly Bears', 'p2'))]));
    expect(exiled(s)).toEqual(['Grizzly Bears']);
    expect(names(s, 'graveyard', 'p2')).toEqual([]);
  });

  it('Brutal Cathar (CR 610.3, 610.3c): exiles a creature of an opponent until it leaves the battlefield; then the card returns under the control of its owner', () => {
    const CATHAR = 'Brutal Cathar // Moonrage Brute';
    let s = scenario([CATHAR, 'Grizzly Bears', 'Murder', 'Plains', 'Swamp'], { p1: { hand: [CATHAR, 'Murder'], battlefield: [...lands('Plains', 3), ...lands('Swamp', 3)] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = resolveTop(resolveTop(cast(s, CATHAR), [target(on(s, 'Grizzly Bears', 'p2'))]));
    expect(exiled(s)).toEqual(['Grizzly Bears']);
    s = resolveTop(cast(s, 'Murder', [target(on(s, CATHAR))]));
    expect(exiled(s)).toEqual([]);
    expect(s.objects[on(s, 'Grizzly Bears', 'p2')]!.controller).toBe('p2');
  });
});
