/**
 * edh-d-27 (Commander coordinator D, lane vote, second pass): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites from memory of the 2026-09-25 rules (see the record).
 *
 *   CR 701.38a-b       "Each player secretly votes for another player ... For each vote an opponent received, ~ deals 2 damage to that player and each creature that player controls. For each vote
 *                      you received, draw a card." (nobody votes for themselves; one damage event per vote)
 *   CR 701.38a, 121.1  "Each player draws a card for each vote they received. Each player who received no votes may put a permanent card from their hand onto the battlefield."
 *   CR 701.38a, 122.1  "For each creature with one or more votes, put that many stun counters on it, then tap it." (votes for objects)
 *   CR 701.38a         "Each player secretly votes for up to one creature ... If no creature got votes, ... Otherwise, destroy each creature with the most votes or tied for most votes."
 *   CR 121.2, 701.9a   "draw a card for each quill vote. For each card drawn this way, discard a card."
 *   CR 701.54a, 122.1  "If dominion gets more votes, the Ring tempts you, then you put a +1/+1 counter on your Ring-bearer."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) });
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script {
  /** Option labels for the votes for words or players (player names Alice, Bob, Carol, Dan), in the order asked. */
  options?: string[];
  /** Object choices (votes for creatures, a card put onto the battlefield, a discard): a list of card names to pick, or undefined for the first choices. */
  objects?: (string[] | undefined)[];
  /** What was asked, in order: "kind:player" and, for an option decision, the labels offered. */
  asked?: string[];
}
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(p.kind === 'chooseOption' ? `${p.kind}:${p.player}:${p.options.map((o) => o.label).join('/')}` : `${p.kind}:${p.player}`);
    if (p.kind === 'chooseOption') {
      const want = script.options?.shift();
      const id = want === undefined ? p.options[0]!.id : p.options.find((o) => o.label === want)!.id;
      s = answer(s, { kind: 'chooseOption', ids: [id] });
    } else if (p.kind === 'chooseObjects') {
      const pick = script.objects?.shift();
      const ids = pick === undefined ? p.options.slice(0, p.min) : pick.map((n) => p.options.find((o) => nameOf(s, o) === n)!);
      s = answer(s, { kind: 'chooseObjects', ids });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
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
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onBf = (s: GameState, p: PlayerId, name: string): ObjectId[] => s.zones.battlefield.filter((i) => s.objects[i]!.controller === p && nameOf(s, i) === name);
const inGy = (s: GameState, p: PlayerId, name: string): number => s.zones.graveyard[p]!.filter((i) => nameOf(s, i) === name).length;

// ---- Mob Verdict: "Each player secretly votes for another player ..." ---------------------------------------------------------------------------------------------------

const VERDICT = card('Test Mob', 'Sorcery', 'Each player secretly votes for another player, then those votes are revealed. For each vote an opponent received, ~ deals 2 damage to that player and each creature that player controls. For each vote you received, draw a card.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '5'] });

describe('CR 701.38a-b, 120.3: "Each player secretly votes for another player ... For each vote an opponent received, ~ deals 2 damage to that player and each creature that player controls."', () => {
  const setup = (): GameState => mpScenario({ defs: [VERDICT, BEAR, OGRE], zones: { p1: { hand: ['Test Mob'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Ogre'] }, p4: {} } });
  it('is automated', () => expect(full(VERDICT)).toBe(true));
  it('every vote an opponent received is its own 2 damage to that player and to each of their creatures; the votes you received each draw a card', () => {
    const s0 = setup();
    // Alice votes Bob, Bob votes Alice, Carol votes Bob, Dan votes Carol: Bob 2 votes (4 damage), Carol 1 vote (2 damage), Alice 1 vote (draws 1)
    const asked: string[] = [];
    const s = cast(s0, 'Test Mob', { options: ['Bob', 'Alice', 'Bob', 'Carol'], asked });
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 4);
    expect(life(s, 'p3')).toBe(life(s0, 'p3') - 2);
    expect(life(s, 'p4')).toBe(life(s0, 'p4'));
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(onBf(s, 'p2', 'Test Bear')).toEqual([]); // 4 damage kills the 2/2
    expect(onBf(s, 'p3', 'Test Ogre').length).toBe(1); // 2 damage does not kill the 3/5
    expect(onBf(s, 'p1', 'Test Bear').length).toBe(1); // you are not an opponent: your creatures are not damaged
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1); // the spell leaves the hand, one card is drawn
    // nobody may vote for themselves (the negative case): Alice's choices are the other three players
    expect(asked[0]).toBe('chooseOption:p1:Bob/Carol/Dan');
    expect(asked[1]).toBe('chooseOption:p2:Alice/Carol/Dan');
  });
  it('the damage is dealt once per vote, not once per voted player: three votes for Dan are three separate 2-damage events (6 life)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Mob', { options: ['Dan', 'Dan', 'Dan', 'Alice'] });
    expect(life(s, 'p4')).toBe(life(s0, 'p4') - 6);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1')); // one vote received: one card
  });
  it('a vote for you hurts nobody and a vote nobody cast does nothing (no votes for any opponent: only cards)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Mob', { options: ['Bob', 'Alice', 'Alice', 'Alice'] });
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 2);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 3);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

// ---- Círdan: "Each player draws a card for each vote they received. Each player who received no votes may put a permanent card from their hand onto the battlefield." -----------

const CIRDAN = card('Test Shipwright', 'Creature — Elf', 'Whenever ~ enters, each player secretly votes for a player, then those votes are revealed. Each player draws a card for each vote they received. Each player who received no votes may put a permanent card from their hand onto the battlefield.', { pt: ['2', '2'] });

describe('CR 701.38a, 121.1: "Each player draws a card for each vote they received. Each player who received no votes may put a permanent card from their hand onto the battlefield."', () => {
  const setup = (): GameState => mpScenario({ defs: [CIRDAN, BEAR, OGRE], zones: { p1: { hand: ['Test Shipwright', 'Test Bear'] }, p2: { hand: ['Test Bear'] }, p3: { hand: ['Test Ogre'] }, p4: { hand: ['Test Bear'] } } });
  it('is automated', () => expect(full(CIRDAN)).toBe(true));
  it('each player draws as many cards as votes they received; only the players with none may put a permanent card from their hand onto the battlefield', () => {
    const s0 = setup();
    const asked: string[] = [];
    // everyone votes for Bob (Alice may vote for herself too): Bob draws 4; Alice, Carol and Dan received no votes and may put a card
    const s = cast(s0, 'Test Shipwright', { options: ['Bob', 'Bob', 'Bob', 'Bob'], objects: [['Test Bear'], ['Test Ogre'], ['Test Bear']], asked });
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2') + 4);
    expect(onBf(s, 'p1', 'Test Bear').length).toBe(1);
    expect(onBf(s, 'p3', 'Test Ogre').length).toBe(1);
    expect(onBf(s, 'p4', 'Test Bear').length).toBe(1);
    expect(onBf(s, 'p2', 'Test Bear').length).toBe(0); // Bob received votes: not asked, still has the card
    expect(asked.filter((a) => a.startsWith('chooseObjects')).sort()).toEqual(['chooseObjects:p1', 'chooseObjects:p3', 'chooseObjects:p4']);
    expect(asked[0]).toBe('chooseOption:p1:Alice/Bob/Carol/Dan'); // a vote for a player may be for yourself
  });
  it('a player who received a vote draws and does not get to put a card; a player who received none draws nothing', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Shipwright', { options: ['Alice', 'Alice', 'Bob', 'Bob'], objects: [['Test Ogre'], ['Test Bear']] });
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 2); // Alice received two votes (the creature left her hand)
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2') + 2);
    expect(handSize(s, 'p3')).toBe(handSize(s0, 'p3') - 1); // Carol received none, drew nothing, put her card
    expect(onBf(s, 'p3', 'Test Ogre').length).toBe(1);
    expect(onBf(s, 'p1', 'Test Bear').length).toBe(0);
  });
});

// ---- Trap the Trespassers: "For each creature with one or more votes, put that many stun counters on it, then tap it." --------------------------------------------------------

const TRAP = card('Test Snare', 'Instant', 'Each player secretly votes for a creature you don\'t control, then those votes are revealed. For each creature with one or more votes, put that many stun counters on it, then tap it.');

describe('CR 701.38a, 122.1: "Each player secretly votes for a creature you don\'t control ... For each creature with one or more votes, put that many stun counters on it, then tap it."', () => {
  const A = card('Test Alpha', 'Creature — Bear', '', { pt: ['2', '2'] });
  const B = card('Test Beta', 'Creature — Bear', '', { pt: ['2', '2'] });
  const C = card('Test Gamma', 'Creature — Bear', '', { pt: ['2', '2'] });
  const MINE = card('Test Mine', 'Creature — Bear', '', { pt: ['2', '2'] });
  const setup = (): GameState => mpScenario({ defs: [TRAP, A, B, C, MINE], zones: { p1: { hand: ['Test Snare'], battlefield: ['Test Mine'] }, p2: { battlefield: ['Test Alpha'] }, p3: { battlefield: ['Test Beta'] }, p4: { battlefield: ['Test Gamma'] } } });
  const stun = (s: GameState, p: PlayerId, name: string): number => s.objects[onBf(s, p, name)[0]!]!.counters['stun'] ?? 0;
  const tapped = (s: GameState, p: PlayerId, name: string): boolean => s.objects[onBf(s, p, name)[0]!]!.tapped;
  it('is automated', () => expect(full(TRAP)).toBe(true));
  it('each creature gets as many stun counters as votes and is tapped; a creature nobody voted for is untouched; your creatures are not offered', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = cast(s0, 'Test Snare', { objects: [['Test Alpha'], ['Test Alpha'], ['Test Beta'], ['Test Alpha']], asked });
    expect(stun(s, 'p2', 'Test Alpha')).toBe(3);
    expect(tapped(s, 'p2', 'Test Alpha')).toBe(true);
    expect(stun(s, 'p3', 'Test Beta')).toBe(1);
    expect(tapped(s, 'p3', 'Test Beta')).toBe(true);
    expect(stun(s, 'p4', 'Test Gamma')).toBe(0); // no votes
    expect(tapped(s, 'p4', 'Test Gamma')).toBe(false);
    expect(stun(s, 'p1', 'Test Mine')).toBe(0);
    expect(tapped(s, 'p1', 'Test Mine')).toBe(false);
    expect(asked.filter((a) => a.startsWith('chooseObjects')).length).toBe(4); // every player votes once
  });
});

// ---- Vault 11: "Each player secretly votes for up to one creature ... If no creature got votes, each player draws a card. Otherwise, destroy each creature with the most votes or tied ..." ----

const DILEMMA = card('Test Dilemma', 'Sorcery', 'Each player secretly votes for up to one creature, then those votes are revealed. If no creature got votes, each player draws a card. Otherwise, destroy each creature with the most votes or tied for most votes.');

describe('CR 701.38a: "Each player secretly votes for up to one creature ... If no creature got votes, each player draws a card. Otherwise, destroy each creature with the most votes or tied for most votes."', () => {
  const setup = (): GameState => mpScenario({ defs: [DILEMMA, BEAR, OGRE], zones: { p1: { hand: ['Test Dilemma'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, p3: { battlefield: ['Test Bear'] }, p4: {} } });
  it('is automated', () => expect(full(DILEMMA)).toBe(true));
  it('nobody votes: no creature is destroyed (nothing has the most votes) and each player draws a card', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Dilemma', { objects: [[], [], [], []] });
    expect(onBf(s, 'p1', 'Test Bear').length).toBe(1);
    expect(onBf(s, 'p2', 'Test Ogre').length).toBe(1);
    expect(onBf(s, 'p3', 'Test Bear').length).toBe(1);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1);
    for (const p of ['p2', 'p3', 'p4'] as const) expect(handSize(s, p)).toBe(handSize(s0, p) + 1);
  });
  it('one vote is enough: the creature with the most votes dies (and a tie destroys both), nobody draws', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Dilemma', { objects: [['Test Ogre'], [], [], []] });
    expect(onBf(s, 'p2', 'Test Ogre')).toEqual([]);
    expect(inGy(s, 'p2', 'Test Ogre')).toBe(1);
    expect(onBf(s, 'p1', 'Test Bear').length).toBe(1);
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2'));
    const t = cast(setup(), 'Test Dilemma', { objects: [['Test Ogre'], ['Test Bear'], [], []] });
    expect(onBf(t, 'p2', 'Test Ogre')).toEqual([]);
    expect(onBf(t, 'p1', 'Test Bear').length + onBf(t, 'p3', 'Test Bear').length).toBe(1); // one bear died too (tied for most votes with the ogre)
  });
});

// ---- Messenger Jays: "draw a card for each quill vote. For each card drawn this way, discard a card." --------------------------------------------------------------------------

const JAYS = card('Test Jay', 'Creature — Bird', 'When ~ enters, starting with you, each player votes for feather or quill. Put a +1/+1 counter on ~ for each feather vote and draw a card for each quill vote. For each card drawn this way, discard a card.', { pt: ['1', '1'] });

describe('CR 121.2, 701.9a, 608.2c: "draw a card for each quill vote. For each card drawn this way, discard a card."', () => {
  const setup = (): GameState => mpScenario({ defs: [JAYS], zones: { p1: { hand: ['Test Jay'] }, p2: {}, p3: {}, p4: {} } });
  const counters = (s: GameState): number => s.objects[onBf(s, 'p1', 'Test Jay')[0]!]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(JAYS)).toBe(true));
  it('each quill vote draws a card and then discards a card; each feather vote is a counter', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Jay', { options: ['feather', 'quill', 'quill', 'quill'] });
    expect(counters(s)).toBe(1);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1); // drew 3, discarded 3
    expect(s.zones.graveyard['p1']!.length).toBe(3);
  });
  it('no quill vote: nothing is drawn, so nothing is discarded (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Jay', { options: ['feather', 'feather', 'feather', 'feather'] });
    expect(counters(s)).toBe(4);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
  });
});

// ---- Galadriel: "If dominion gets more votes, the Ring tempts you, then you put a +1/+1 counter on your Ring-bearer." ----------------------------------------------------------

const QUEEN = card('Test Queen', 'Creature — Elf', 'When ~ enters, starting with you, each player votes for dominion or guidance. If dominion gets more votes, the Ring tempts you, then you put a +1/+1 counter on your Ring-bearer. If guidance gets more votes or the vote is tied, draw a card.', { pt: ['2', '2'] });

describe('CR 701.54a, 122.1: "the Ring tempts you, then you put a +1/+1 counter on your Ring-bearer"', () => {
  const setup = (): GameState => mpScenario({ defs: [QUEEN], zones: { p1: { hand: ['Test Queen'] }, p2: {}, p3: {}, p4: {} } });
  const counters = (s: GameState): number => s.objects[onBf(s, 'p1', 'Test Queen')[0]!]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(QUEEN)).toBe(true));
  it('dominion: the Ring tempts you (your creature becomes the Ring-bearer) and it gets a +1/+1 counter; no card is drawn', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Queen', { options: ['dominion', 'dominion', 'dominion', 'guidance'] });
    expect(counters(s)).toBe(1);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
  });
  it('guidance (or a tie): a card is drawn and no counter is put (the negative case)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Queen', { options: ['dominion', 'dominion', 'guidance', 'guidance'] });
    expect(counters(s)).toBe(0);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1);
  });
});
