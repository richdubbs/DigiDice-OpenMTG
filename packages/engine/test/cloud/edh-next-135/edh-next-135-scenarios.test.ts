/**
 * Must-finish round edh-next-135 (choices, votes and opponents): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10; the wordings are the cards' own where only one card prints them), in four-player games, each with its negative cases and the Scryfall rulings of the card. CR cites
 * checked against MagicCompRules 20260925.
 *
 *   CR 700.3, 406.3, 608.2d    "Exile the top three cards of your library in a face-down pile, then ... another face-down pile. Look at ..., then turn a pile of your choice face up. ..." (Hostile Negotiations)
 *   CR 701.23a, 608.2d, 608.2g "Search your library for up to three monocolored cards with different names and exile them. An opponent chooses one ... cast the other cards ..." (Emergent Ultimatum)
 *   CR 701.38a, 701.38d, 613.7 "You choose how each player votes this turn." (Illusion of Choice)
 *   CR 603.12, 701.20a         "Reveal any number of Dragon cards from your hand. When you do, ~ deals X plus 2 damage to any other target, ..." (Invasion of Tarkir)
 *   CR 101.4, 608.2d           "Then starting with the next opponent in turn order, each opponent chooses a creature card in your graveyard that hasn't been chosen. ..." (Rejoin the Fight)
 *   CR 701.55a, 701.55c        "If an opponent would face a villainous choice, they face that choice an additional time." (The Valeyard)
 *   CR 701.23a, 208.1, 608.2d  "Search your library for up to four creature cards with different powers and reveal them. An opponent chooses two ..." (Threats Undetected)
 *   CR 608.2d, 608.2g, 107.3   "Target opponent chooses X cards from their hand. Look at those cards. You may cast a spell from among them without paying its mana cost." (Extract Brain)
 *   CR 608.2d, 701.20a, 506.4  "... then choose land or nonland. An opponent guesses whether the top card of your library is the chosen kind. Reveal that card. ..." (Gollum, Scheming Guide)
 *   CR 608.2d, 202.3, 608.2g   "choose a card in your hand. That player guesses whether the card's mana value is greater than 4. If the player guessed wrong, ..." (Master of Predicaments)
 *   CR 608.2d, 607.2d, 118.3   "When this creature enters, secretly choose an opponent. / Reveal the player you chose: Exile target creature that's attacking you if ..." (Stalking Leonin)
 *   CR 101.4, 608.2c, 303.4f   "Exile all nontoken permanents. Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped ..." (Thieves' Auction)
 *   CR 500.1, 120.2a, 510.2, 603.4    "At the beginning of your upkeep, if you haven't been dealt combat damage since your last turn, you draw a card and you lose 1 life." (Marchesa, Resolute Monarch)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type CardDef, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { numbers?: number[]; options?: string[]; optionIds?: string[]; asked?: string[]; onAsk?: (s: GameState) => void; yes?: boolean[]; targets?: TargetChoice[][]; objects?: ((s: GameState) => string[])[] }
/** Answer the decisions that come up until someone has priority: numbers and option labels in the order asked. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    script.onAsk?.(s);
    if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'chooseOption') {
      const byId = script.optionIds?.shift();
      const want = byId === undefined ? script.options?.shift() : undefined;
      const id = byId ?? (want === undefined ? p.options[0]!.id : p.options.find((o) => o.label === want || o.label.startsWith(want))!.id);
      s = answer(s, { kind: 'chooseOption', ids: [id] });
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') {
      const pick = script.objects?.shift();
      s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    } else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);

// ---- Hostile Negotiations ------------------------------------------------------------------------------------------------------------------------------------------------

const NEGOTIATE = card('Test Tense Parley', 'Instant', 'Exile the top three cards of your library in a face-down pile, then exile the top three cards of your library in another face-down pile. Look at the cards in each pile, then turn a pile of your choice face up. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard. You lose 3 life.', { colors: ['B'] });
const LIB = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((n) => card(`Test ${n}`, 'Artifact', ''));
const KEEP = card('Test Keepsake', 'Artifact', ''); // the card p1 draws in its first draw step (a multiplayer game: CR 103.8)

describe('CR 700.3, 406.3, 608.2d (checked): two given face-down piles, one turned face up, an opponent chooses (Hostile Negotiations)', () => {
  const setup = (libSize?: number): GameState => mpScenario({
    defs: [NEGOTIATE, KEEP, ...LIB],
    zones: { p1: { hand: ['Test Tense Parley'], library: ['Test Keepsake', ...LIB.map((d) => d.name)] } },
    setup: (s) => { if (libSize !== undefined) s.zones.library.p1 = s.zones.library.p1!.slice(0, libSize + 1); },
  });
  it('is automated', () => expect(full(NEGOTIATE)).toBe(true));
  it('the top three form pile 1 and the next three pile 2; you turn one face up, an opponent chooses; that pile goes to your hand, the other to your graveyard; you lose 3 life', () => {
    const s0 = setup();
    const asked: string[] = [];
    let upLabels: string[] = [];
    let chooseLabels: string[] = [];
    const s = cast(s0, 'Test Tense Parley', { optionIds: ['pile2', 'p2', 'pile1'], asked, onAsk: (x) => {
      if (x.pending?.kind !== 'chooseOption') return;
      if (x.pending.player === 'p1' && x.pending.options[0]!.id === 'pile1') upLabels = x.pending.options.map((o) => o.label);
      else if (x.pending.player !== 'p1') chooseLabels = x.pending.options.map((o) => o.label);
    } });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p1', 'chooseOption:p1', 'chooseOption:p2']); // you turn a pile up, then choose the opponent, who chooses a pile
    expect(upLabels).toEqual(['Pile 1: Test Alpha, Test Bravo, Test Charlie', 'Pile 2: Test Delta, Test Echo, Test Foxtrot']); // you looked at the cards in each pile
    expect(chooseLabels).toEqual(['Pile 1: 3 cards face down', 'Pile 2: Test Delta, Test Echo, Test Foxtrot']); // the opponent sees only the pile turned face up
    expect(names(s, s.zones.hand.p1!).filter((n) => n !== 'Test Keepsake').sort()).toEqual(['Test Alpha', 'Test Bravo', 'Test Charlie']);
    expect(names(s, s.zones.graveyard.p1!).sort()).toEqual(['Test Delta', 'Test Echo', 'Test Foxtrot', 'Test Tense Parley']);
    expect(s.zones.exile.length ?? 0).toBe(0);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3);
  });
  it('the negative case: the opponent chooses the face-up pile: it goes to your hand, the face-down pile to your graveyard', () => {
    const s = cast(setup(), 'Test Tense Parley', { optionIds: ['pile1', 'p3', 'pile1'] });
    expect(names(s, s.zones.hand.p1!).filter((n) => n !== 'Test Keepsake').sort()).toEqual(['Test Alpha', 'Test Bravo', 'Test Charlie']);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n !== 'Test Tense Parley').sort()).toEqual(['Test Delta', 'Test Echo', 'Test Foxtrot']);
  });
  it('the cards are exiled face down: before the turn, the opponents cannot see them (CR 406.3)', () => {
    let hiddenFromP2 = false;
    cast(setup(), 'Test Tense Parley', { optionIds: ['pile1', 'p2', 'pile2'], onAsk: (x) => {
      if (x.pending?.kind !== 'chooseOption' || x.pending.player !== 'p1' || x.pending.options[0]!.id !== 'pile1') return;
      const exiled = Object.values(x.objects).filter((o) => o.zone === 'exile' && o.owner === 'p1');
      hiddenFromP2 = exiled.length === 6 && exiled.every((o) => o.faceDown === true && !(o.revealedTo ?? []).includes('p2'));
    } });
    expect(hiddenFromP2).toBe(true);
  });
  it('ruling 2022-10-14: with four cards in the library, the second pile has one card; with three, the second pile is empty (it may be turned face up and chosen)', () => {
    let labels: string[] = [];
    const s4 = cast(setup(4), 'Test Tense Parley', { optionIds: ['pile1', 'p4', 'pile2'], onAsk: (x) => { if (x.pending?.kind === 'chooseOption' && x.pending.player === 'p1' && x.pending.options[0]!.id === 'pile1') labels = x.pending.options.map((o) => o.label); } });
    expect(labels).toEqual(['Pile 1: Test Alpha, Test Bravo, Test Charlie', 'Pile 2: Test Delta']);
    expect(names(s4, s4.zones.hand.p1!)).toEqual(['Test Keepsake', 'Test Delta']);
    const s3 = cast(setup(3), 'Test Tense Parley', { optionIds: ['pile2', 'p2', 'pile2'] });
    expect(names(s3, s3.zones.hand.p1!)).toEqual(['Test Keepsake']); // the empty pile was turned face up and chosen
    expect(names(s3, s3.zones.graveyard.p1!).filter((n) => n !== 'Test Tense Parley').sort()).toEqual(['Test Alpha', 'Test Bravo', 'Test Charlie']);
  });
});

// ---- Marchesa, Resolute Monarch ------------------------------------------------------------------------------------------------------------------------------------------

const MONARCH = card('Test Wary Regent', 'Legendary Creature — Human Noble', "Menace, deathtouch\nAt the beginning of your upkeep, if you haven't been dealt combat damage since your last turn, you draw a card and you lose 1 life.", { pt: ['3', '6'], colors: ['B', 'R'] });
const BRUTE = card('Test Road Brute', 'Creature — Ogre', '', { pt: ['3', '3'] });
const ZAP = card('Test Zap', 'Instant', '~ deals 2 damage to target player.', { colors: ['R'] });

describe('CR 500.1, 120.2a, 510.2, 603.4 (checked): "if you haven\'t been dealt combat damage since your last turn" (Marchesa, Resolute Monarch)', () => {
  const setup = (): GameState => mpScenario({
    defs: [MONARCH, BRUTE, ZAP],
    zones: { p1: { battlefield: ['Test Wary Regent'] }, p2: { hand: ['Test Zap'] }, p3: { battlefield: ['Test Road Brute'] } },
  });
  /** Pass to turn `n`'s first main phase; on turn `attackOn` the Ogre of p3 attacks p1 (no blocks). */
  const toTurn = (s0: GameState, n: number, attackOn?: number): GameState => {
    let s = s0;
    if (attackOn !== undefined) {
      s = passUntil(s, (x) => x.turn.number === attackOn && x.pending?.kind === 'declareAttackers', 'the attack');
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Road Brute', 'battlefield', 'p3'), defender: 'p1' }] });
    }
    return passUntil(s, (x) => x.turn.number === n && x.turn.step === 'main1' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', `turn ${n}`);
  };
  it('is automated', () => expect(full(MONARCH)).toBe(true));
  it('no damage since your last turn: at your next upkeep you draw a card and lose 1 life (and draw for the turn)', () => {
    const s0 = setup();
    const s = toTurn(s0, 5);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 1);
    expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length + 2);
  });
  it('the negative case: an opponent\'s creature dealt you combat damage on their turn after yours: no draw, no life loss', () => {
    const s0 = setup();
    const s = toTurn(s0, 5, 3);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3); // the Ogre's combat damage only
    expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length + 1); // the draw step only
  });
  it('noncombat damage is not combat damage (CR 120.2a-b): a spell\'s 2 damage on an opponent\'s turn still lets you draw', () => {
    let s = setup();
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'turn 2');
    const before = life(s, 'p1');
    s = cast(s, 'Test Zap', { targets: [[{ kind: 'player', id: 'p1' }]] }, 'p2');
    expect(life(s, 'p1')).toBe(before - 2);
    const s5 = toTurn(s, 5);
    expect(life(s5, 'p1')).toBe(before - 3);
  });
  it('"since your last turn" starts after your last turn ended: combat damage before that turn does not count (turn 3 hit, checked at the turn 9 upkeep)', () => {
    const s0 = setup();
    const s5 = toTurn(s0, 5, 3); // hit on turn 3: no draw at turn 5
    const s9 = toTurn(s5, 9);
    expect(life(s9, 'p1')).toBe(life(s5, 'p1') - 1);
    expect(s9.zones.hand.p1!.length).toBe(s5.zones.hand.p1!.length + 2);
  });
});

// ---- Emergent Ultimatum --------------------------------------------------------------------------------------------------------------------------------------------------

const EMERGE = card('Test Rising Edict', 'Sorcery', 'Search your library for up to three monocolored cards with different names and exile them. An opponent chooses one of those cards. Shuffle that card into your library. You may cast the other cards without paying their mana costs. Exile ~.', { colors: ['B', 'G', 'U'] });
const BLOOM = card('Test Bloom Gift', 'Sorcery', 'You gain 2 life.', { cost: '{3}{W}', colors: ['W'] });
const STUDY = card('Test Deep Study', 'Sorcery', 'Draw two cards.', { cost: '{4}{U}', colors: ['U'] });
const SAPLING = card('Test Sapling Guard', 'Creature — Plant', '', { cost: '{5}{G}', pt: ['2', '2'], colors: ['G'] });
const IDOL = card('Test Plain Idol', 'Artifact', '', { cost: '{2}' });
const TWIN = card('Test Twin Hues', 'Sorcery', 'You gain 1 life.', { cost: '{W}{U}', colors: ['W', 'U'] });

describe('CR 701.23a, 201.2, 608.2d, 608.2g (checked): search, exile, an opponent shuffles one back, cast the others free (Emergent Ultimatum)', () => {
  const setup = (): GameState => mpScenario({
    defs: [EMERGE, BLOOM, STUDY, SAPLING, IDOL, TWIN, KEEP],
    zones: { p1: { hand: ['Test Rising Edict'], library: ['Test Keepsake', 'Test Bloom Gift', 'Test Deep Study', 'Test Sapling Guard', 'Test Plain Idol', 'Test Twin Hues', 'Test Bloom Gift'] } },
  });
  const byNames = (want: string[]) => (s: GameState): string[] => {
    const opts = (s.pending as { options: string[] }).options;
    const out: string[] = [];
    for (const n of want) { const id = opts.find((o) => !out.includes(o) && s.defs[s.objects[o]!.defId]!.name === n); if (id !== undefined) out.push(id); }
    return out;
  };
  it('is automated', () => expect(full(EMERGE)).toBe(true));
  it('only monocolored cards can be found (a colorless or a two-color card is not monocolored: ruling 2025-04-04)', () => {
    let offered: string[] = [];
    cast(setup(), 'Test Rising Edict', { objects: [(s) => { offered = names(s, (s.pending as { options: string[] }).options); return []; }] });
    expect([...new Set(offered)].sort()).toEqual(['Test Bloom Gift', 'Test Deep Study', 'Test Sapling Guard']);
  });
  it('three found and exiled; the opponent shuffles one back; you cast the other two free as part of the resolution; the Ultimatum ends in exile', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = cast(s0, 'Test Rising Edict', {
      asked,
      objects: [byNames(['Test Bloom Gift']), byNames(['Test Deep Study']), byNames(['Test Sapling Guard']), byNames(['Test Deep Study']), byNames(['Test Bloom Gift', 'Test Sapling Guard'])],
      optionIds: ['p3'],
    });
    expect(asked.filter((a) => a.startsWith('chooseObjects'))).toEqual(['chooseObjects:p1', 'chooseObjects:p1', 'chooseObjects:p1', 'chooseObjects:p3', 'chooseObjects:p1']); // you search (a card at a time), the opponent chooses, you choose what to cast
    expect(names(s, s.zones.library.p1!)).toContain('Test Deep Study'); // shuffled back
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1'))).toContain('Test Sapling Guard');
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 2);
    expect(names(s, s.zones.exile)).toEqual(['Test Rising Edict']);
  });
  it('the negative case: you may cast none of the others: they stay in exile', () => {
    const s = cast(setup(), 'Test Rising Edict', {
      objects: [byNames(['Test Bloom Gift']), byNames(['Test Deep Study']), () => [], byNames(['Test Bloom Gift']), () => []],
      optionIds: ['p2'],
    });
    expect(names(s, s.zones.exile).sort()).toEqual(['Test Deep Study', 'Test Rising Edict']);
  });
  it('ruling 2025-04-04: one card found: it is shuffled back and nothing is cast; different names: two copies of one card cannot both be found', () => {
    let offered: string[] = [];
    const s = cast(setup(), 'Test Rising Edict', {
      objects: [byNames(['Test Bloom Gift']), (x) => { offered = names(x, (x.pending as { options: string[] }).options); return []; }, byNames(['Test Bloom Gift'])],
      optionIds: ['p4'],
    });
    expect(offered).not.toContain('Test Bloom Gift'); // the second pick may not have the first one's name (CR 201.2)
    expect(names(s, s.zones.exile)).toEqual(['Test Rising Edict']);
    expect(names(s, s.zones.library.p1!).filter((n) => n === 'Test Bloom Gift')).toHaveLength(2);
  });
});

// ---- Illusion of Choice --------------------------------------------------------------------------------------------------------------------------------------------------

const ILLUSION = card('Test False Ballot', 'Instant', 'You choose how each player votes this turn.\nDraw a card.', { colors: ['U'] });
const ORCHARD = card('Test Orchard Poll', 'Sorcery', 'Starting with you, each player votes for sprout or harvest. You gain 3 life for each harvest vote. You lose 1 life for each sprout vote.');
const BROKER = card('Test Ballot Clerk', 'Creature — Human', 'While voting, you may vote an additional time.', { pt: ['2', '3'] });

describe('CR 701.38a, 701.38d, 613.7 (checked): "You choose how each player votes this turn." (Illusion of Choice)', () => {
  const setup = (): GameState => mpScenario({
    defs: [ILLUSION, ORCHARD, BROKER, KEEP],
    zones: { p1: { hand: ['Test False Ballot', 'Test Orchard Poll'], library: ['Test Keepsake'] }, p2: { hand: ['Test False Ballot', 'Test Orchard Poll'] }, p3: { battlefield: ['Test Ballot Clerk'] } },
  });
  it('is automated', () => expect(full(ILLUSION)).toBe(true));
  it('after it resolves, you make every player\'s vote decision this turn; the votes count as theirs', () => {
    const s0 = setup();
    const asked: string[] = [];
    let s = cast(s0, 'Test False Ballot');
    s = cast(s, 'Test Orchard Poll', { asked, options: ['harvest', 'harvest', 'harvest', 'harvest'], onAsk: (x) => { if (x.pending?.kind === 'chooseNumber') asked.push('n'); } });
    expect(asked.filter((a) => /^choose(Option|Number)/.test(a))).toEqual(['chooseOption:p1', 'chooseOption:p1', 'chooseOption:p1', 'chooseNumber:p3', 'chooseOption:p1']); // p3 takes no additional vote
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 12);
  });
  it('ruling 2016-08-23 (Ballot Broker): a voter who may vote an additional time decides that themselves after the normal vote; you choose that vote too', () => {
    const s0 = setup();
    const asked: string[] = [];
    let s = cast(s0, 'Test False Ballot');
    s = cast(s, 'Test Orchard Poll', { asked, numbers: [1], options: ['harvest', 'harvest', 'sprout', 'sprout', 'harvest'] });
    expect(asked.filter((a) => /^choose(Option|Number)/.test(a))).toEqual(['chooseOption:p1', 'chooseOption:p1', 'chooseOption:p1', 'chooseNumber:p3', 'chooseOption:p1', 'chooseOption:p1']);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 3 * 3 - 2);
  });
  it('the negative case: without it, each player decides their own vote', () => {
    const asked: string[] = [];
    cast(setup(), 'Test Orchard Poll', { asked, numbers: [0] });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p1', 'chooseOption:p2', 'chooseOption:p3', 'chooseOption:p4']);
  });
  it('ruling 2016-08-23: with two of them this turn, the controller of the one that resolved most recently chooses', () => {
    let s = setup();
    s = cast(s, 'Test False Ballot');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p2' && x.zones.stack.length === 0, 'p2 priority');
    // p2 casts its own at instant speed during p1's turn (the cards cost nothing)
    s = cast(s, 'Test False Ballot', {}, 'p2');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1' && x.zones.stack.length === 0, 'p1 priority');
    const asked: string[] = [];
    cast(s, 'Test Orchard Poll', { asked, numbers: [0] });
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p2', 'chooseOption:p2', 'chooseOption:p2', 'chooseOption:p2']);
  });
  it('"this turn": next turn each player votes for themselves again', () => {
    let s = cast(setup(), 'Test False Ballot');
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'turn 2');
    const asked: string[] = [];
    cast(s, 'Test Orchard Poll', { asked, numbers: [0] }, 'p2');
    expect(asked.filter((a) => a.startsWith('chooseOption'))).toEqual(['chooseOption:p2', 'chooseOption:p3', 'chooseOption:p4', 'chooseOption:p1']);
  });
});

// ---- Invasion of Tarkir --------------------------------------------------------------------------------------------------------------------------------------------------

const ROOST = card('Test Roost Herald', 'Creature — Human', 'When ~ enters, reveal any number of Dragon cards from your hand. When you do, ~ deals X plus 2 damage to any other target, where X is the number of cards revealed this way.', { pt: ['1', '1'], colors: ['R'] });
const WYRM = card('Test Ember Wyrm', 'Creature — Dragon', 'Flying', { cost: '{4}{R}', pt: ['4', '4'], colors: ['R'] });
const WALL = card('Test Stone Wall', 'Creature — Wall', '', { pt: ['0', '8'] });

describe('CR 603.12, 701.20a (checked): "reveal any number of ... from your hand. When you do, ..." (Invasion of Tarkir)', () => {
  const setup = (): GameState => mpScenario({
    defs: [ROOST, WYRM, WALL, KEEP],
    zones: { p1: { hand: ['Test Roost Herald', 'Test Ember Wyrm', 'Test Ember Wyrm', 'Test Keepsake'] }, p2: { battlefield: ['Test Stone Wall'] } },
  });
  const pick = (want: string[]) => (s: GameState): string[] => {
    const opts = (s.pending as { options: string[] }).options;
    const out: string[] = [];
    for (const n of want) { const id = opts.find((o) => !out.includes(o) && s.defs[s.objects[o]!.defId]!.name === n); if (id !== undefined) out.push(id); }
    return out;
  };
  it('is automated', () => expect(full(ROOST)).toBe(true));
  it('two Dragons revealed: X is 2, so 4 damage to the target; only Dragon cards of your hand can be revealed', () => {
    const s0 = setup();
    let offered: string[] = [];
    const s = cast(s0, 'Test Roost Herald', { objects: [(x) => { offered = names(x, (x.pending as { options: string[] }).options); return pick(['Test Ember Wyrm', 'Test Ember Wyrm'])(x); }], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(offered).toEqual(['Test Ember Wyrm', 'Test Ember Wyrm']);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 4);
    expect(names(s, s.zones.hand.p1!).filter((n) => n === 'Test Ember Wyrm')).toHaveLength(2); // revealed, not moved
  });
  it('ruling 2023-04-14, the negative case: no Dragon revealed still triggers the reflexive ability: 2 damage', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Roost Herald', { objects: [() => []], targets: [[{ kind: 'player', id: 'p3' }]] });
    expect(life(s, 'p3')).toBe(life(s0, 'p3') - 2);
  });
  it('"any other target": the source itself is not a legal target; a creature is', () => {
    let opts: string[] = [];
    const s0 = setup();
    const s = cast(s0, 'Test Roost Herald', { objects: [pick(['Test Ember Wyrm'])], onAsk: (x) => { if (x.pending?.kind === 'chooseTargets') opts = JSON.stringify(x.pending).match(/"id":"[^"]+"/g) ?? []; }, targets: [[{ kind: 'object', id: find(s0, 'Test Stone Wall', 'battlefield', 'p2') }]] });
    const herald = find(s, 'Test Roost Herald', 'battlefield', 'p1');
    expect(opts.some((o) => o.includes(herald))).toBe(false);
    expect(s.objects[find(s, 'Test Stone Wall', 'battlefield', 'p2')]!.damage).toBe(3);
  });
});

// ---- Rejoin the Fight ----------------------------------------------------------------------------------------------------------------------------------------------------

const REJOIN = card('Test Rally Again', 'Sorcery', 'Mill three cards. Then starting with the next opponent in turn order, each opponent chooses a creature card in your graveyard that hasn\'t been chosen. Return each card chosen this way to the battlefield under your control.', { colors: ['B'] });
const GRUNTS = ['Ash', 'Birch', 'Cedar', 'Elm'].map((n) => card(`Test ${n} Grunt`, 'Creature — Soldier', '', { pt: ['2', '2'] }));

describe('CR 101.4, 608.2d (checked): each opponent in turn order chooses a creature card in your graveyard that hasn\'t been chosen (Rejoin the Fight)', () => {
  const setup = (gy: string[], lib: string[] = []): GameState => mpScenario({
    defs: [REJOIN, KEEP, ...GRUNTS],
    zones: { p1: { hand: ['Test Rally Again'], graveyard: gy, library: ['Test Keepsake', ...lib] } },
  });
  const pickFirst = (s: GameState): string[] => [(s.pending as { options: string[] }).options[0]!];
  it('is automated', () => expect(full(REJOIN)).toBe(true));
  it('the three opponents choose in turn order from the next one, each a card not chosen before (the milled cards included); all three return under your control', () => {
    const s0 = setup(['Test Ash Grunt', 'Test Birch Grunt'], ['Test Cedar Grunt', 'Test Elm Grunt', 'Test Keepsake']);
    const asked: string[] = [];
    const offered: number[] = [];
    const s = cast(s0, 'Test Rally Again', { asked, objects: [pickFirst, pickFirst, pickFirst], onAsk: (x) => { if (x.pending?.kind === 'chooseObjects') offered.push((x.pending as { options: string[] }).options.length); } });
    expect(asked.filter((a) => a.startsWith('chooseObjects'))).toEqual(['chooseObjects:p2', 'chooseObjects:p3', 'chooseObjects:p4']);
    expect(offered).toEqual([4, 3, 2]); // two in the graveyard and two milled; a chosen card is offered to nobody after
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(names(s, mine).length).toBe(3);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n.endsWith('Grunt'))).toHaveLength(1);
  });
  it('the negative case: fewer creature cards than opponents: the last opponent has none left to choose, and only the cards chosen return', () => {
    const s0 = setup(['Test Ash Grunt', 'Test Birch Grunt'], ['Test Keepsake', 'Test Keepsake', 'Test Keepsake']);
    const asked: string[] = [];
    const s = cast(s0, 'Test Rally Again', { asked, objects: [pickFirst, pickFirst, pickFirst] });
    expect(asked.filter((a) => a.startsWith('chooseObjects'))).toEqual(['chooseObjects:p2']); // p3 has one card left (no choice to make, CR 608.2d), p4 none
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(2);
  });
  it('only creature cards of YOUR graveyard are offered (an opponent\'s creature card is not)', () => {
    const s0 = mpScenario({ defs: [REJOIN, KEEP, ...GRUNTS], zones: { p1: { hand: ['Test Rally Again'], graveyard: ['Test Ash Grunt', 'Test Birch Grunt'], library: ['Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Keepsake'] }, p2: { graveyard: ['Test Elm Grunt'] } } });
    let offered: string[] = [];
    cast(s0, 'Test Rally Again', { objects: [(x) => { offered = names(x, (x.pending as { options: string[] }).options); return pickFirst(x); }] });
    expect(offered.sort()).toEqual(['Test Ash Grunt', 'Test Birch Grunt']);
  });
});

// ---- The Valeyard --------------------------------------------------------------------------------------------------------------------------------------------------------

const VALEYARD = card('Test Shadow Lord', 'Legendary Creature — Time Lord Rogue', 'If an opponent would face a villainous choice, they face that choice an additional time.\nWhile voting, you may vote an additional time.', { pt: ['3', '4'], colors: ['B'] });
const PLAN = card('Test Grim Plan', 'Sorcery', 'Target opponent faces a villainous choice -- They lose 3 life, or you draw two cards.', { colors: ['B'] });

describe('CR 701.55a, 701.55c (checked): an opponent faces a villainous choice an additional time (The Valeyard)', () => {
  const setup = (who: PlayerId = 'p1'): GameState => mpScenario({
    defs: [VALEYARD, PLAN, KEEP],
    zones: who === 'p1'
      ? { p1: { hand: ['Test Grim Plan'], battlefield: ['Test Shadow Lord'], library: ['Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Keepsake'] } }
      : { p1: { hand: ['Test Grim Plan'], library: ['Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Keepsake'] }, [who]: { battlefield: ['Test Shadow Lord'] } } as never,
  });
  it('is automated', () => expect(full(VALEYARD)).toBe(true));
  it('your opponent faces the choice twice, one after the other, and may choose differently: 3 life lost and you draw two', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = cast(s0, 'Test Grim Plan', { asked, targets: [[{ kind: 'player', id: 'p2' }]], yes: [true, false] });
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual(['yesNo:p2', 'yesNo:p2']);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 3);
    expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length - 1 + 2);
  });
  it('the same option twice: 6 life lost', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Grim Plan', { targets: [[{ kind: 'player', id: 'p3' }]], yes: [true, true] });
    expect(life(s, 'p3')).toBe(life(s0, 'p3') - 6);
  });
  it('the negative case: the controller\'s own opponent only: when an opponent of the Valeyard\'s controller makes YOU face the choice, you face it once', () => {
    const s0 = setup('p2'); // p2 controls the Valeyard; p1 (an opponent of p2) targets p3, also an opponent of p2: twice; targeting p2 itself: once
    const asked: string[] = [];
    cast(s0, 'Test Grim Plan', { asked, targets: [[{ kind: 'player', id: 'p2' }]], yes: [true] });
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual(['yesNo:p2']);
    const asked3: string[] = [];
    cast(s0, 'Test Grim Plan', { asked: asked3, targets: [[{ kind: 'player', id: 'p3' }]], yes: [true, true] });
    expect(asked3.filter((a) => a.startsWith('yesNo'))).toEqual(['yesNo:p3', 'yesNo:p3']);
  });
});

// ---- Threats Undetected --------------------------------------------------------------------------------------------------------------------------------------------------

const THREATS = card('Test Hidden Menace', 'Sorcery', 'Search your library for up to four creature cards with different powers and reveal them. An opponent chooses two of those cards. Shuffle the chosen cards into your library and put the rest into your hand.', { colors: ['G'] });
const BEASTS = [['One', '1'], ['Twin', '2'], ['Pair', '2'], ['Tri', '3'], ['Penta', '5']].map(([n, p]) => card(`Test ${n} Beast`, 'Creature — Beast', '', { pt: [p!, p!] }));

describe('CR 701.23a, 208.1, 608.2d (checked): search for creature cards with different powers; an opponent chooses two to shuffle back (Threats Undetected)', () => {
  const setup = (lib: string[] = BEASTS.map((b) => b.name)): GameState => mpScenario({
    defs: [THREATS, KEEP, ...BEASTS],
    zones: { p1: { hand: ['Test Hidden Menace'], library: ['Test Keepsake', ...lib] } },
  });
  const pickName = (n: string) => (s: GameState): string[] => [(s.pending as { options: string[] }).options.find((o) => s.defs[s.objects[o]!.defId]!.name === n)!];
  it('is automated', () => expect(full(THREATS)).toBe(true));
  it('ruling 2022-09-09: after a power-2 card is found, the other power-2 card is no longer offered; the opponent keeps two in the library, the other two go to your hand', () => {
    const s0 = setup();
    const offered: string[][] = [];
    const asked: string[] = [];
    const s = cast(s0, 'Test Hidden Menace', {
      asked, optionIds: ['p3'],
      onAsk: (x) => { if (x.pending?.kind === 'chooseObjects' && x.pending.player === 'p1') offered.push(names(x, (x.pending as { options: string[] }).options).filter((n) => n.endsWith('Beast')).sort()); },
      objects: [pickName('Test Twin Beast'), pickName('Test One Beast'), pickName('Test Tri Beast'), pickName('Test Penta Beast'), (x) => [pickName('Test Twin Beast')(x)[0]!, pickName('Test Penta Beast')(x)[0]!]],
    });
    expect(offered[1]).toEqual(['Test One Beast', 'Test Penta Beast', 'Test Tri Beast']); // Test Pair Beast (power 2) is gone
    expect(asked.filter((a) => a.startsWith('chooseObjects')).at(-1)).toBe('chooseObjects:p3');
    expect(names(s, s.zones.hand.p1!).filter((n) => n.endsWith('Beast')).sort()).toEqual(['Test One Beast', 'Test Tri Beast']);
    expect(names(s, s.zones.library.p1!).filter((n) => n.endsWith('Beast')).sort()).toEqual(['Test Pair Beast', 'Test Penta Beast', 'Test Twin Beast']);
  });
  it('the negative case: only two found: the opponent chooses both, nothing goes to your hand', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Hidden Menace', { optionIds: ['p2'], objects: [pickName('Test One Beast'), pickName('Test Tri Beast'), () => []] });
    expect(names(s, s.zones.hand.p1!).filter((n) => n.endsWith('Beast'))).toEqual([]);
    expect(names(s, s.zones.library.p1!).filter((n) => n.endsWith('Beast'))).toHaveLength(5);
  });
});

// ---- Extract Brain -------------------------------------------------------------------------------------------------------------------------------------------------------

const BRAIN = card('Test Mind Siphon', 'Sorcery', 'Target opponent chooses X cards from their hand. Look at those cards. You may cast a spell from among them without paying its mana cost.', { cost: '{X}', colors: ['U', 'B'] });
const BOON = card('Test Small Boon', 'Sorcery', 'You gain 4 life.', { cost: '{5}{W}', colors: ['W'] });
const ROCK = card('Test Field Rock', 'Land', '');

describe('CR 608.2d, 608.2g, 107.3 (checked): target opponent chooses X cards from their hand; you may cast one of them free (Extract Brain)', () => {
  const setup = (): GameState => mpScenario({
    defs: [BRAIN, BOON, ROCK, KEEP],
    zones: { p1: { hand: ['Test Mind Siphon'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Small Boon', 'Test Field Rock', 'Test Keepsake'] } },
  });
  it('is automated', () => expect(full(BRAIN)).toBe(true));
  it('X = 2: the opponent chooses two cards of their hand (you see them); you cast the spell among them free; you get its effect, the card goes to its owner\'s graveyard', () => {
    const s0 = setup();
    const asked: string[] = [];
    let chooserMin = -1;
    const s = cast(s0, 'Test Mind Siphon', {
      asked, numbers: [2], targets: [[{ kind: 'player', id: 'p2' }]],
      onAsk: (x) => { if (x.pending?.kind === 'chooseObjects' && x.pending.player === 'p2') chooserMin = (x.pending as { min: number }).min; },
      objects: [(x) => (x.pending as { options: string[] }).options.filter((o) => ['Test Small Boon', 'Test Field Rock'].includes(x.defs[x.objects[o]!.defId]!.name)), (x) => (x.pending as { options: string[] }).options.filter((o) => x.defs[x.objects[o]!.defId]!.name === 'Test Small Boon')],
    });
    expect(chooserMin).toBe(2);
    expect(asked.filter((a) => a.startsWith('chooseObjects'))).toEqual(['chooseObjects:p2', 'chooseObjects:p1']);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 4);
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Test Small Boon']);
    expect(names(s, s.zones.hand.p2!).sort()).toEqual(['Test Field Rock', 'Test Keepsake']);
  });
  it('the negative case: you may cast nothing; the chosen cards stay in the opponent\'s hand', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Mind Siphon', { numbers: [1], targets: [[{ kind: 'player', id: 'p3' }]], objects: [() => []] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

// ---- Gollum, Scheming Guide ----------------------------------------------------------------------------------------------------------------------------------------------

const SNEAK = card('Test Riddling Sneak', 'Legendary Creature — Halfling Horror', "Whenever ~ attacks, look at the top two cards of your library, put them back in any order, then choose land or nonland. An opponent guesses whether the top card of your library is the chosen kind. Reveal that card. If they guessed right, remove ~ from combat. Otherwise, you draw a card and ~ can't be blocked this turn.", { pt: ['2', '1'], colors: ['B'] });
const LAND = card('Test Moor Land', 'Land', '');

describe('CR 608.2d, 701.20a, 506.4 (checked): an opponent guesses whether your top card is the chosen kind (Gollum, Scheming Guide)', () => {
  const setup = (lib: string[] | null): GameState => mpScenario({
    defs: [SNEAK, LAND, KEEP],
    zones: { p1: { battlefield: ['Test Riddling Sneak'], library: ['Test Keepsake', ...(lib ?? [])] } },
    setup: (s) => { if (lib === null) s.zones.library.p1 = s.zones.library.p1!.slice(0, 1); },
  });
  /** Attack p2 with the creature, answer the trigger's decisions, then go on to the second main phase. */
  const attackWith = (s0: GameState, script: Script): GameState => {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Riddling Sneak', 'battlefield', 'p1'), defender: 'p2' }] });
    s = settle(s, script);
    return passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
  };
  it('is automated', () => expect(full(SNEAK)).toBe(true));
  it('the guess is right (the land on top, "land" chosen, the opponent says it is): the card is revealed and ~ is removed from combat: no damage', () => {
    const s0 = setup(['Test Moor Land', 'Test Keepsake']);
    const asked: string[] = [];
    const s = attackWith(s0, { asked, optionIds: ['0', 'p2'], yes: [true] });
    expect(asked.filter((a) => /^(chooseOption|yesNo)/.test(a))).toEqual(['chooseOption:p1', 'chooseOption:p1', 'yesNo:p2']);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
    expect(s.log.some((l) => /reveals Test Moor Land/.test(l.text))).toBe(true); // revealed also after a right guess (ruling 2023-06-16)
  });
  it('the negative case: a wrong guess: you draw a card and ~ can\'t be blocked: 2 combat damage', () => {
    const s0 = setup(['Test Moor Land', 'Test Keepsake']);
    const hand0 = s0.zones.hand.p1!.length;
    const s = attackWith(s0, { optionIds: ['1', 'p3'], yes: [true] }); // "nonland" chosen, p3 guesses it is: the land is not nonland
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 2);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 1);
  });
  it('ruling 2023-06-16: with no card in your library no guess is right: you attempt to draw from the empty library and lose the game', () => {
    let s = passUntil(setup(null), (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Riddling Sneak', 'battlefield', 'p1'), defender: 'p2' }] });
    s = settle(s, { optionIds: ['0', 'p2'], yes: [false] });
    expect(s.log.some((l) => /the guess is wrong/.test(l.text))).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true); // CR 704.5b
  });
});

// ---- Master of Predicaments ----------------------------------------------------------------------------------------------------------------------------------------------

const SPHINX = card('Test Riddle Sphinx', 'Creature — Sphinx', "Flying\nWhenever ~ deals combat damage to a player, choose a card in your hand. That player guesses whether the card's mana value is greater than 4. If the player guessed wrong, you may cast the card without paying its mana cost.", { pt: ['4', '4'], colors: ['U'] });

describe('CR 608.2d, 202.3, 608.2g (checked): the damaged player guesses whether the chosen card\'s mana value is greater than 4 (Master of Predicaments)', () => {
  const setup = (): GameState => mpScenario({
    defs: [SPHINX, BOON, ROCK, KEEP],
    zones: { p1: { battlefield: ['Test Riddle Sphinx'], hand: ['Test Small Boon', 'Test Field Rock'] } },
  });
  const hit = (s0: GameState, script: Script): GameState => {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Riddle Sphinx', 'battlefield', 'p1'), defender: 'p3' }] });
    s = passUntil(s, (x) => x.turn.step === 'combatDamage' && x.zones.stack.length > 0 && x.pending?.kind === 'priority', 'the trigger');
    return settle(s, script);
  };
  const pickName = (n: string) => (s: GameState): string[] => [(s.pending as { options: string[] }).options.find((o) => s.defs[s.objects[o]!.defId]!.name === n)!];
  it('is automated', () => expect(full(SPHINX)).toBe(true));
  it('a wrong guess (a mana value 6 card, "not greater than 4"): you may cast it free', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = hit(s0, { asked, objects: [pickName('Test Small Boon')], yes: [false, true] });
    expect(asked.filter((a) => /^(chooseObjects|yesNo)/.test(a))).toEqual(['chooseObjects:p1', 'yesNo:p3', 'yesNo:p1']); // the guess is the damaged player's
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 4);
  });
  it('the negative case: a right guess: nothing is cast, and the card is not revealed (ruling 2014-07-18)', () => {
    const s0 = setup();
    const s = hit(s0, { objects: [pickName('Test Small Boon')], yes: [true] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(names(s, s.zones.hand.p1!)).toContain('Test Small Boon');
    const boon = s.zones.hand.p1!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Small Boon')!;
    expect(s.objects[boon]!.revealedTo ?? []).not.toContain('p3');
  });
  it('ruling 2014-07-18: a land card may be chosen, but it can\'t be played even after a wrong guess', () => {
    const s0 = setup();
    const s = hit(s0, { objects: [pickName('Test Field Rock')], yes: [true, true] }); // mana value 0, "greater than 4": wrong
    expect(names(s, s.zones.hand.p1!)).toContain('Test Field Rock');
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Field Rock')).toEqual([]);
  });
});

// ---- Stalking Leonin -----------------------------------------------------------------------------------------------------------------------------------------------------

const LEONIN = card('Test Prowling Warden', 'Creature — Cat Archer', "When ~ enters, secretly choose an opponent.\nReveal the player you chose: Exile target creature that's attacking you if it's controlled by the chosen player. Activate only once.", { pt: ['3', '3'], colors: ['W'] });

describe('CR 608.2d, 607.2d, 118.3 (checked): a secretly chosen opponent, revealed as a cost (Stalking Leonin)', () => {
  const setup = (onBattlefield = false): GameState => mpScenario({
    defs: [LEONIN, BRUTE, KEEP],
    zones: { p1: onBattlefield ? { battlefield: ['Test Prowling Warden'] } : { hand: ['Test Prowling Warden'] }, p2: { battlefield: ['Test Road Brute'] }, p3: { battlefield: ['Test Road Brute'] } },
  });
  const leonin = (s: GameState): string => find(s, 'Test Prowling Warden', 'battlefield', 'p1');
  /** On `attacker`'s turn, their Ogre attacks p1; p1 gets priority in the declare attackers step. */
  const attacked = (s0: GameState, attacker: PlayerId, turn: number): GameState => {
    let s = passUntil(s0, (x) => x.turn.number === turn && x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Road Brute', 'battlefield', attacker), defender: 'p1' }] });
    return passUntil(s, (x) => x.turn.step === 'declareAttackers' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'p1 priority');
  };
  const activate = (s: GameState, target: string): GameState => settle(drive(act(s, { type: 'activate', player: 'p1', source: leonin(s), ability: 'p:0:1' } as never), { targets: [[{ kind: 'object', id: target }]] }));
  it('is automated', () => expect(full(LEONIN)).toBe(true));
  it('the choice is secret: the other players\' views do not show the chosen player; yours does', () => {
    const s = cast(setup(), 'Test Prowling Warden', { optionIds: ['p3'] });
    const link = (v: GameState) => v.objects[leonin(s)]!.links?.['opponent'];
    expect(link(s)?.players).toEqual(['p3']);
    expect(link(viewFor(s, 'p1') as unknown as GameState)?.players).toEqual(['p3']);
    expect(link(viewFor(s, 'p3') as unknown as GameState)?.players).toBeUndefined();
    expect(link(viewFor(s, 'p2') as unknown as GameState)?.players).toBeUndefined();
  });
  it('revealing the chosen player exiles that player\'s attacking creature; the reveal makes the choice public', () => {
    let s = cast(setup(), 'Test Prowling Warden', { optionIds: ['p3'] });
    s = attacked(s, 'p3', 3);
    const ogre = find(s, 'Test Road Brute', 'battlefield', 'p3');
    s = activate(s, ogre);
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Test Road Brute');
    expect((viewFor(s, 'p2') as unknown as GameState).objects[leonin(s)]!.links?.['opponent']?.players).toEqual(['p3']);
  });
  it('the negative case: another opponent\'s attacking creature is not exiled (and the ability is used up: activate only once)', () => {
    let s = cast(setup(), 'Test Prowling Warden', { optionIds: ['p3'] });
    s = attacked(s, 'p2', 2);
    const ogre = find(s, 'Test Road Brute', 'battlefield', 'p2');
    s = activate(s, ogre);
    expect(s.objects[ogre]?.zone).toBe('battlefield');
    expect(() => act(s, { type: 'activate', player: 'p1', source: leonin(s), ability: 'p:0:1' } as never)).toThrow();
  });
  it('ruling 2017-08-25 (review): a player who gained control of it did not make the choice: they can\'t pay the cost', () => {
    const STEAL = card('Test Sudden Theft', 'Instant', 'Gain control of target creature.', { colors: ['U'] });
    let s = mpScenario({
      defs: [LEONIN, BRUTE, KEEP, STEAL],
      zones: { p1: { hand: ['Test Prowling Warden'] }, p2: { hand: ['Test Sudden Theft'] }, p3: { battlefield: ['Test Road Brute'] } },
    });
    s = cast(s, 'Test Prowling Warden', { optionIds: ['p3'] });
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p2' && x.zones.stack.length === 0, 'p2 priority');
    s = cast(s, 'Test Sudden Theft', { targets: [[{ kind: 'object', id: find(s, 'Test Prowling Warden', 'battlefield', 'p1') }]] }, 'p2');
    const warden = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Prowling Warden')!;
    expect(s.objects[warden]!.controller).toBe('p2');
    s = passUntil(s, (x) => x.turn.number === 3 && x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Road Brute', 'battlefield', 'p3'), defender: 'p2' }] });
    s = passUntil(s, (x) => x.turn.step === 'declareAttackers' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'p2 priority');
    expect(() => act(s, { type: 'activate', player: 'p2', source: warden, ability: 'p:0:1' } as never)).toThrow();
  });
  it('ruling 2017-08-25: with no opponent chosen (it never entered with its trigger), the cost can\'t be paid', () => {
    let s = setup(true);
    s = attacked(s, 'p2', 2);
    expect(() => activate(s, find(s, 'Test Road Brute', 'battlefield', 'p2'))).toThrow();
  });
});

// ---- Thieves' Auction ----------------------------------------------------------------------------------------------------------------------------------------------------

const AUCTION = card('Test Grand Swap', 'Sorcery', 'Exile all nontoken permanents. Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control. Repeat this process until all cards exiled this way have been chosen.', { colors: ['R'] });
const CHAIN = card('Test Heavy Chain', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-0.');

describe('CR 101.4, 608.2c, 303.4f (checked): every nontoken permanent exiled, then picked one at a time in turn order (Thieves\' Auction)', () => {
  const setup = (): GameState => mpScenario({
    defs: [AUCTION, BRUTE, WALL, KEEP, CHAIN],
    zones: { p1: { hand: ['Test Grand Swap'], battlefield: ['Test Keepsake', 'Test Keepsake'] }, p2: { battlefield: ['Test Road Brute'] }, p3: { battlefield: ['Test Stone Wall'] } },
  });
  const mine = (s: GameState, p: PlayerId): string[] => names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === p)).sort();
  it('is automated', () => expect(full(AUCTION)).toBe(true));
  it('four cards, four players: each takes one in turn order starting with you; each enters tapped under its picker\'s control', () => {
    const asked: string[] = [];
    const pickName = (n: string) => (x: GameState): string[] => [(x.pending as { options: string[] }).options.find((o) => x.defs[x.objects[o]!.defId]!.name === n)!];
    const s = cast(setup(), 'Test Grand Swap', { asked, objects: [pickName('Test Road Brute'), pickName('Test Stone Wall'), pickName('Test Keepsake')] });
    expect(asked.filter((a) => a.startsWith('chooseObjects'))).toEqual(['chooseObjects:p1', 'chooseObjects:p2', 'chooseObjects:p3']); // p4 takes the last card (no choice to make)
    expect(mine(s, 'p1')).toEqual(['Test Road Brute']);
    expect(mine(s, 'p2')).toEqual(['Test Stone Wall']);
    expect(mine(s, 'p3')).toEqual(['Test Keepsake']);
    expect(mine(s, 'p4')).toEqual(['Test Keepsake']);
    expect(s.zones.battlefield.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.zones.exile).toEqual([]);
  });
  it('more cards than players: the rounds go on until every card is chosen (you pick again after the last player)', () => {
    const s0 = mpScenario({ defs: [AUCTION, BRUTE, KEEP], zones: { p1: { hand: ['Test Grand Swap'], battlefield: ['Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Keepsake', 'Test Road Brute'] } } });
    const asked: string[] = [];
    const s = cast(s0, 'Test Grand Swap', { asked });
    expect(asked.filter((a) => a.startsWith('chooseObjects'))).toEqual(['chooseObjects:p1', 'chooseObjects:p2', 'chooseObjects:p3', 'chooseObjects:p4']); // the fifth card goes to p1 with no choice left
    expect(mine(s, 'p1')).toHaveLength(2);
    expect(['p2', 'p3', 'p4'].map((p) => mine(s, p as PlayerId).length)).toEqual([1, 1, 1]);
  });
  it('review (CR 303.4f): a Curse (an Aura that enchants a player) is put attached to a player its picker chooses', () => {
    const CURSE = card('Test Nagging Curse', 'Enchantment — Aura Curse', "Enchant player\nAt the beginning of enchanted player's upkeep, that player loses 1 life.");
    const s1 = mpScenario({ defs: [AUCTION, BRUTE, CURSE], zones: { p1: { hand: ['Test Grand Swap'], battlefield: ['Test Nagging Curse', 'Test Road Brute'] } }, setup: (x) => {
      x.objects[x.zones.battlefield.find((o) => x.defs[x.objects[o]!.defId]!.name === 'Test Nagging Curse')!]!.attachedTo = 'p2';
    } });
    const asked: string[] = [];
    const s = cast(s1, 'Test Grand Swap', { asked, optionIds: ['p4'], objects: [(x) => [(x.pending as { options: string[] }).options.find((o) => x.defs[x.objects[o]!.defId]!.name === 'Test Nagging Curse')!]] });
    expect(asked.some((a) => a.startsWith('manual'))).toBe(false);
    expect(mine(s, 'p1')).toEqual(['Test Nagging Curse']);
    const curse = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Nagging Curse')!;
    expect(s.objects[curse]!.attachedTo).toBe('p4');
    expect(mine(s, 'p2')).toEqual(['Test Road Brute']);
  });
  it('ruling 2005-08-01, the negative case: an Aura with nothing to enchant stays exiled and can\'t be picked; it can be put once a creature is back', () => {
    const s1 = mpScenario({ defs: [AUCTION, BRUTE, CHAIN], zones: { p1: { hand: ['Test Grand Swap'], battlefield: ['Test Heavy Chain', 'Test Road Brute'] } }, setup: (x) => {
      const id = (n: string) => x.zones.battlefield.find((o) => x.defs[x.objects[o]!.defId]!.name === n)!;
      x.objects[id('Test Heavy Chain')]!.attachedTo = id('Test Road Brute'); // the Aura enchants the Ogre
    } });
    expect(s1.zones.battlefield).toHaveLength(2);
    const offered: string[][] = [];
    const s = cast(s1, 'Test Grand Swap', { onAsk: (x) => { if (x.pending?.kind === 'chooseObjects') offered.push(names(x, (x.pending as { options: string[] }).options)); }, objects: [(x) => [(x.pending as { options: string[] }).options.find((o) => x.defs[x.objects[o]!.defId]!.name === 'Test Heavy Chain')!]] });
    expect(offered[0]!.sort()).toEqual(['Test Heavy Chain', 'Test Road Brute']);
    // the Aura could not be put (no creature yet): p1 picks again and gets the Ogre; p2 then takes the Aura, put on the Ogre
    expect(mine(s, 'p1')).toEqual(['Test Road Brute']);
    expect(mine(s, 'p2')).toEqual(['Test Heavy Chain']);
    expect(s.zones.exile).toEqual([]);
  });
});
