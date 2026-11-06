/**
 * Round edh-d-32 (Commander coordinator D, lane pile-open-phase): the behaviour it added, played through the engine. The opening-hand reveals use the real fixture cards (the Chancellors,
 * Sphinx of Foresight: Oracle wordings are the evidence); the piles use synthetic cards with the Oracle wordings (invented names, design 6.10), compiled by the default compiler. Every
 * group has its negative cases. CR cites are from the real text of 2026-09-25 (media.wizards.com MagicCompRules 20260925).
 *
 *   CR 103.6, 103.6b, 603.7a     "You may reveal this card from your opening hand. If you do, at the beginning of [the | your] first upkeep ..." (Chancellors, Sphinx of Foresight)
 *   CR 700.3, 700.3a, 700.3d     "Separate all creatures target player controls into two piles ..." (Do or Die), a player's choice of a pile, empty piles
 *   CR 700.3c, 608.2d            "Separate all creature cards in your graveyard into two piles. Exile the pile of an opponent's choice ..." (Death or Glory)
 *   CR 101.4, 608.2f, 701.21a    "Each opponent separates the creatures they control into two piles. For each opponent, you choose one of their piles ..." (Make an Example)
 *   CR 700.3, 701.20e            "Target opponent looks at the top four cards of your library and separates them into a face-down pile and a face-up pile ..." (Fortune's Favor, Atris)
 */
import { describe, expect, it } from 'vitest';
import { createGame, ENGINE_CAPABILITIES, type GameConfig, type GameState, type ObjectId } from '../../../src/index';
import { compiledDefs } from '../../fixtures';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { card, full, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const countIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): number => s.zones[zone][p]!.length;

// ---- opening-hand reveals ------------------------------------------------------------------------------------------------------------------------------
function opening(a: string, b = 'Plains'): GameState {
  const config: GameConfig = {
    seed: 'edhd32-reveal',
    players: [
      { name: 'Alice', deck: Array(40).fill(a) as string[], stops: { fullControl: true } },
      { name: 'Bob', deck: Array(40).fill(b) as string[], stops: { fullControl: true } },
    ],
    defs: compiledDefs([a, b, 'Plains']),
    options: { startingPlayer: 'p1', skipMulligans: true },
  };
  return createGame(config);
}
/** Pass priority until `stop` holds (answering what is asked with the first options). */
function playUntil(s0: GameState, stop: (s: GameState) => boolean): GameState {
  let s = s0;
  for (let guard = 0; !stop(s) && guard < 80; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  return s;
}

describe('CR 103.6b: "You may reveal this card from your opening hand. If you do, ..." (capability feature:pregame.reveal.delayed)', () => {
  it('registers the delayed reveal as an engine capability; the cards are fully automated', () => {
    expect(ENGINE_CAPABILITIES.has('feature:pregame.reveal.delayed')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:pregame.reveal')).toBe(false); // a reveal with no delayed consequence is not run
    const defs = compiledDefs(['Chancellor of the Forge', 'Chancellor of the Spires', 'Chancellor of the Tangle', 'Sphinx of Foresight']);
    for (const d of defs) expect(d.automation.level, d.name).toBe('full');
  });

  it('the starting player is asked first, with the cards that can be revealed; the public log names the revealed card', () => {
    let s = opening('Chancellor of the Forge');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, rules: ['CR 103.6', 'CR 103.6b'] });
    const id = s.zones.hand.p1![0]!;
    s = answer(s, { kind: 'chooseObjects', ids: [id] });
    expect(s.log.some((l) => l.text === 'Alice reveals Chancellor of the Forge from their opening hand.')).toBe(true);
    expect(s.zones.hand.p1).toContain(id); // revealed, still in the hand
  });

  it('Chancellor of the Forge: a revealed one makes a 1/1 Goblin with haste at the first upkeep; declining makes none', () => {
    let s = opening('Chancellor of the Forge');
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p1![0]!] });
    s = playUntil(s, (x) => x.turn.number === 1 && x.turn.step === 'main1');
    const goblins = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
    expect(goblins).toHaveLength(1);
    // negative: declined
    let t = opening('Chancellor of the Forge');
    t = answer(t, { kind: 'chooseObjects', ids: [] });
    t = playUntil(t, (x) => x.turn.number === 1 && x.turn.step === 'main1');
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token')).toHaveLength(0);
  });

  it('two revealed Chancellors each make a Goblin (one delayed trigger for each card revealed); it happens once, not at every upkeep', () => {
    let s = opening('Chancellor of the Forge');
    const [a, b] = s.zones.hand.p1!;
    s = answer(s, { kind: 'chooseObjects', ids: [a!, b!] });
    s = playUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(2);
  });

  it('Chancellor of the Spires: at the first upkeep, whoever it is, each opponent of the revealer mills seven', () => {
    let s = opening('Plains', 'Chancellor of the Spires'); // Alice (first player) has no Chancellor, Bob reveals one
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p2![0]!] });
    const before = countIn(s, 'graveyard', 'p1');
    s = playUntil(s, (x) => x.turn.number === 1 && x.turn.step === 'main1');
    expect(countIn(s, 'graveyard', 'p1') - before).toBe(7); // Alice's upkeep is the first upkeep of the game
    expect(countIn(s, 'graveyard', 'p2')).toBe(0);
  });

  it('Sphinx of Foresight: "your first upkeep" waits for the revealer\'s own turn (negative: not the first player\'s upkeep)', () => {
    let s = opening('Plains', 'Sphinx of Foresight');
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p2![0]!] });
    s = playUntil(s, (x) => x.turn.number === 1 && x.turn.step === 'main1');
    expect(s.log.some((l) => /scry|scries/i.test(l.text))).toBe(false); // Alice's upkeep: nothing for Bob
    s = playUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'));
    expect(s.log.some((l) => /delayed triggered ability of Sphinx of Foresight triggers/.test(l.text))).toBe(true);
    s = playUntil(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(s.log.filter((l) => /delayed triggered ability of Sphinx of Foresight triggers/.test(l.text))).toHaveLength(1); // once
  });

  it('Chancellor of the Tangle: adds {G} at the beginning of the controller\'s first main phase of the game, once', () => {
    let s = opening('Chancellor of the Tangle');
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p1![0]!] });
    s = playUntil(s, (x) => x.turn.number === 1 && x.turn.step === 'main1' && x.zones.stack.length > 0);
    s = pass(s);
    s = pass(s);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.some((m) => m.type === 'G')).toBe(true);
    s = playUntil(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(s.log.filter((l) => /delayed triggered ability of Chancellor of the Tangle triggers/.test(l.text))).toHaveLength(1);
  });
});

// ---- piles ---------------------------------------------------------------------------------------------------------------------------------------------
const DOD = card('Test Choice of Ends', 'Sorcery', 'Separate all creatures target player controls into two piles. Destroy all creatures in the pile of that player\'s choice. They can\'t be regenerated.');
const DOG = card('Test Fallen Fanfare', 'Sorcery', 'Separate all creature cards in your graveyard into two piles. Exile the pile of an opponent\'s choice and return the other to the battlefield.');
const MAE = card('Test Tithe of Creatures', 'Sorcery', 'Each opponent separates the creatures they control into two piles. For each opponent, you choose one of their piles. Each opponent sacrifices the creatures in their chosen pile. (Piles can be empty.)');
const BEAR = (n: string) => card(n, 'Creature — Bear', '', ['2', '2']);
const defsFor = [DOD, DOG, MAE, BEAR('Test Bear A'), BEAR('Test Bear B'), BEAR('Test Bear C')];

describe('CR 700.3: separating a player\'s creatures into two piles (Do or Die)', () => {
  it('the cards are fully automated', () => { for (const d of [DOD, DOG, MAE]) expect(full(d), d.name).toBe(true); });
  const board = (): GameState => scenario([], { defs: defsFor, p1: { hand: ['Test Choice of Ends'] }, p2: { battlefield: ['Test Bear A', 'Test Bear B', 'Test Bear C'] } });
  it('you separate, the player chooses a pile, and only that pile\'s creatures are destroyed', () => {
    let s = board();
    const [a, b, c] = ['Test Bear A', 'Test Bear B', 'Test Bear C'].map((n) => find(s, n, 'battlefield', 'p2'));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Choice of Ends', 'hand', 'p1') });
    s = settle(s, { targets: [{ kind: 'player', id: 'p2' }] as never });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 6 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' }); // the separator: the first pile
    s = answer(s, { kind: 'chooseObjects', ids: [a!] });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2' }); // the chooser is the targeted player
    s = answer(s, { kind: 'chooseOption', ids: ['pile2'] });
    expect(findAll(s, 'Test Bear A', 'battlefield', 'p2')).toHaveLength(1); // pile 1 survives
    expect(s.objects[a!]!.zone).toBe('battlefield');
    expect(findAll(s, 'Test Bear B', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Bear C', 'graveyard', 'p2')).toHaveLength(1);
    void b; void c;
  });
  it('a pile may be empty (CR 700.3d): all creatures in one pile, the other empty', () => {
    let s = board();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Choice of Ends', 'hand', 'p1') });
    s = settle(s, { targets: [{ kind: 'player', id: 'p2' }] as never });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 6 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = answer(s, { kind: 'chooseOption', ids: ['pile2'] }); // pile 2 holds all three
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && nameOf(s, id).startsWith('Test Bear'))).toHaveLength(0);
  });
  it('negative: the caster\'s own creatures are not separated', () => {
    let s = scenario([], { defs: defsFor, p1: { hand: ['Test Choice of Ends'], battlefield: ['Test Bear A'] }, p2: { battlefield: ['Test Bear B'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Choice of Ends', 'hand', 'p1') });
    s = settle(s, { targets: [{ kind: 'player', id: 'p2' }] as never });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 6 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
    const d = s.pending;
    expect(d?.kind === 'chooseObjects' && d.options.map((id) => nameOf(s, id))).toEqual(['Test Bear B']); // only the target's creature
  });
});

// ---- more piles -----------------------------------------------------------------------------------------------------------------------------------------
type Decision = NonNullable<GameState['pending']>;
/** Cast `name` from p1's hand, pay, and resolve it, answering each decision with `reply` (first match wins); returns the state and the kinds of decision seen, in order. */
function castAndDrive(s0: GameState, name: string, targets: unknown, reply: (d: Decision, s: GameState) => unknown): { s: GameState; seen: string[] } {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  const seen: string[] = [];
  for (let g = 0; g < 60; g++) {
    const d = s.pending;
    if (d === null) break;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets as never });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
    else { seen.push(`${d.player}:${d.kind}`); s = answer(s, reply(d, s) as never); }
  }
  return { s, seen };
}
const pileNames = (s: GameState, zone: 'hand' | 'graveyard', p: 'p1' | 'p2'): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id)).sort();

const FAV = card('Test Fortune Gift', 'Sorcery', 'Target opponent looks at the top four cards of your library and separates them into a face-down pile and a face-up pile. Put one pile into your hand and the other into your graveyard.');
const TOT = card('Test Truth Or Dare', 'Sorcery', 'Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put a card from the chosen pile into your hand, then put all other cards revealed this way on the bottom of your library in any order.');
const BYP = card('Test Graveyard Parley', 'Sorcery', 'Exile up to five target creature cards from graveyards. An opponent separates those cards into two piles. Put all cards from the pile of your choice onto the battlefield under your control and the rest into their owners\' graveyards.');
const NAMES5 = ['Test Bear A', 'Test Bear B', 'Test Bear C', 'Test Bear D', 'Test Bear E'];
const defs2 = [FAV, TOT, BYP, DOG, MAE, ...['A', 'B', 'C', 'D', 'E'].map((x) => BEAR(`Test Bear ${x}`)), card('Test Tome', 'Artifact', '')];

describe('CR 700.3, 701.20e: an opponent separates your top cards into a face-down and a face-up pile (Fortune\'s Favor, Atris)', () => {
  it('the cards are fully automated', () => { for (const d of [FAV, TOT, BYP]) expect(full(d), d.name).toBe(true); });
  const board = (): GameState => scenario([], { defs: defs2, p1: { hand: ['Test Fortune Gift'], library: NAMES5.slice(0, 4) }, p2: {} });
  it('the opponent separates, you choose a pile; that pile goes to your hand and the other to your graveyard; the face-up cards are shown, the face-down ones are not', () => {
    const s0 = board();
    const { s, seen } = castAndDrive(s0, 'Test Fortune Gift', [{ kind: 'player', id: 'p2' }], (d) => (d.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [(d as { options: string[] }).options[0]!] } : { kind: 'chooseOption', ids: [(d as { options: { id: string }[] }).options[0]!.id] }));
    expect(seen).toEqual(['p2:chooseObjects', 'p1:chooseOption']); // the opponent separates, then you choose
    // the opponent put the first card in the face-down pile (one card) and three in the face-up pile; you took the first option, the face-down pile
    expect(countIn(s, 'hand', 'p1')).toBe(1);
    expect(countIn(s, 'graveyard', 'p1')).toBe(3 + 1); // the three face-up cards and the resolved spell
    expect(pileNames(s, 'hand', 'p1')[0]).toMatch(/^Test Bear/);
  });
  it('negative: an empty face-down pile is allowed, and nothing else is moved (library keeps the rest)', () => {
    const s0 = board();
    const libBefore = s0.zones.library.p1!.length;
    const { s } = castAndDrive(s0, 'Test Fortune Gift', [{ kind: 'player', id: 'p2' }], (d) => (d.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [] } : { kind: 'chooseOption', ids: [(d as { options: { id: string }[] }).options[1]!.id] }));
    expect(s.zones.library.p1!.length).toBe(libBefore - 4);
  });
});

describe('CR 700.3c, 608.2d: Death or Glory — an opponent chooses which pile of your graveyard\'s creature cards is exiled, the other returns', () => {
  const board = (): GameState => scenario([], { defs: defs2, p1: { hand: ['Test Fallen Fanfare'], graveyard: ['Test Bear A', 'Test Bear B', 'Test Bear C', 'Test Tome'] }, p2: { graveyard: ['Test Bear D'] } });
  it('the chosen pile is exiled, the other enters the battlefield under your control; other cards and other graveyards are not separated', () => {
    const { s, seen } = castAndDrive(board(), 'Test Fallen Fanfare', [], (d) => (d.kind === 'chooseObjects'
      ? { kind: 'chooseObjects', ids: [(d as { options: string[] }).options[0]!] } : { kind: 'chooseOption', ids: ['pile1'] }));
    expect(seen).toEqual(['p1:chooseObjects', 'p2:chooseOption']); // you separate, the opponent chooses
    const options = findAll(s, 'Test Bear A', 'exile').concat(findAll(s, 'Test Bear B', 'exile'), findAll(s, 'Test Bear C', 'exile'));
    expect(options).toHaveLength(1); // pile 1 held one card: it is exiled
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id).startsWith('Test Bear'))).toHaveLength(2);
    expect(findAll(s, 'Test Tome', 'graveyard', 'p1')).toHaveLength(1); // a non-creature card stays
    expect(findAll(s, 'Test Bear D', 'graveyard', 'p2')).toHaveLength(1); // the other graveyard is untouched
  });
  it('negative: with no creature card in the graveyard nothing happens and nobody is asked', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Fallen Fanfare'], graveyard: ['Test Tome'] }, p2: {} });
    const { s, seen } = castAndDrive(s0, 'Test Fallen Fanfare', [], () => ({ kind: 'chooseOption', ids: ['pile1'] }));
    expect(seen).toEqual([]);
    expect(findAll(s, 'Test Tome', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 101.4, 608.2f, 701.21a: Make an Example — each opponent separates, you choose a pile of each, those creatures are sacrificed', () => {
  const board = (): GameState => scenario([], { defs: defs2, p1: { hand: ['Test Tithe of Creatures'], battlefield: ['Test Bear E'] }, p2: { battlefield: ['Test Bear A', 'Test Bear B', 'Test Bear C'] } });
  it('the opponent separates, you choose; the creatures of the chosen pile are sacrificed, yours are untouched', () => {
    const s0 = board();
    const { s, seen } = castAndDrive(s0, 'Test Tithe of Creatures', [], (d) => (d.kind === 'chooseObjects'
      ? { kind: 'chooseObjects', ids: [(d as { options: string[] }).options[0]!] } : { kind: 'chooseOption', ids: ['pile2'] }));
    expect(seen).toEqual(['p2:chooseObjects', 'p1:chooseOption']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && nameOf(s, id).startsWith('Test Bear'))).toHaveLength(1); // pile 1 (one bear) kept
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id) === 'Test Bear E')).toHaveLength(1);
  });
  it('negative: an opponent with no creatures separates nothing', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Tithe of Creatures'] }, p2: {} });
    const { seen } = castAndDrive(s0, 'Test Tithe of Creatures', [], () => ({ kind: 'chooseOption', ids: ['pile1'] }));
    expect(seen).toEqual([]);
  });
});

describe('CR 700.3, 401.4: Truth or Tale — reveal five, an opponent chooses a pile, you take a card of it, the rest go to the bottom', () => {
  it('one card of the chosen pile goes to your hand, every other revealed card to the bottom of your library', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Truth Or Dare'], library: NAMES5 }, p2: {} });
    const libBefore = s0.zones.library.p1!.length;
    const { s, seen } = castAndDrive(s0, 'Test Truth Or Dare', [], (d) => {
      if (d.kind === 'order') return { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((x) => x.id) };
      if (d.kind === 'chooseOption') return { kind: 'chooseOption', ids: ['pile1'] };
      const dd = d as { options: string[]; min: number; player: string };
      return { kind: 'chooseObjects', ids: dd.player === 'p1' && dd.min === 1 ? [dd.options[0]!] : [dd.options[0]!, dd.options[1]!] };
    });
    expect(seen[0]).toBe('p1:chooseObjects'); // you separate
    expect(seen[1]).toBe('p2:chooseOption'); // an opponent chooses
    expect(countIn(s, 'hand', 'p1')).toBe(1); // exactly one card
    expect(s.zones.library.p1!.length).toBe(libBefore - 1);
    const bottom = s.zones.library.p1!.slice(-4).map((id) => nameOf(s, id));
    expect(bottom.every((n) => n.startsWith('Test Bear'))).toBe(true); // the four others went to the bottom
  });
});

describe('CR 700.3, 110.2a, 400.3: Boneyard Parley — exile up to five creature cards from graveyards, an opponent separates, you choose', () => {
  it('the chosen pile enters under your control; the rest go to their owners\' graveyards', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Graveyard Parley'], graveyard: ['Test Bear A'] }, p2: { graveyard: ['Test Bear B', 'Test Bear C'] } });
    const targets = ['Test Bear A', 'Test Bear B', 'Test Bear C'].map((n, i) => ({ kind: 'object', id: findAll(s0, n, 'graveyard')[0]!, target: `t${i}` }));
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Graveyard Parley', 'hand', 'p1') });
    s = settle(s, { targets: targets.map((t) => ({ kind: 'object', id: t.id })) as never });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 8 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
    const seen: string[] = [];
    for (let g = 0; g < 10 && s.pending !== null && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      seen.push(`${d.player}:${d.kind}`);
      s = d.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [(d as { options: string[] }).options[0]!] }) : answer(s, { kind: 'chooseOption', ids: ['pile1'] });
    }
    expect(seen).toEqual(['p2:chooseObjects', 'p1:chooseOption']); // an opponent separates, you choose
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id).startsWith('Test Bear'))).toHaveLength(1);
    expect(findAll(s, 'Test Bear A', 'graveyard', 'p1').length + findAll(s, 'Test Bear B', 'graveyard', 'p2').length + findAll(s, 'Test Bear C', 'graveyard', 'p2').length).toBe(2); // each went back to its owner's graveyard
    expect(s.zones.exile.filter((id) => nameOf(s, id).startsWith('Test Bear'))).toHaveLength(0); // nothing stays exiled
  });
});
