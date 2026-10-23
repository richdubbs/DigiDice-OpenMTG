/**
 * FAST5X E25: face-down II, played through the engine with real fixture cards and synthetic cards compiled by the game's default compiler (invented wordings,
 * design 6.10). Nothing is mocked.
 *
 *   CR 701.62a-b  manifest dread by another player ("its controller", "the exiled card's owner"); X times; the card put into the graveyard this way
 *   CR 701.58a, e cloak from a hand, of cards chosen from a look, of another player's library, of an exiled shuffled pile, "then attach ~ to it"
 *   CR 608.2c, h  "that creature", "each of those creatures", "its controller" (the target's, as it last existed)
 *   CR 708.5      only the controller may look at a face-down permanent, unless an effect lets another player look (CR 609.4)
 *   CR 708.7      "can't be turned face up": neither the special action nor an effect turns it face up (CR 101.2)
 *   CR 708.3, 708.8, 603.4  "a permanent entered the battlefield face down", "you turned a permanent face up this turn"
 *   CR 614.1c, 614.1e, 708.11  "as ~ enters or is turned face up, put X counters on it" (not as it enters face down, CR 708.3)
 *   CR 406.3      a card exiled face down can be looked at only by the players who could see it as it was exiled, and by nobody once its pile is shuffled
 */
import { describe, expect, it } from 'vitest';
import { canSee, viewFor, type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';
import { advanceTo, put } from '../../m3/scenario';
import {
  act, castFaceDown, drive, faceDownOf, find, getChars, lands, logFor, pass, putFaceDown, resolveAll, resolveTop, scenario, synthetic, turnUp, turnUpActions, tweak, viewText,
} from '../../m6/face-down/support';

const SHATTER = synthetic('Test Shatter', 'Instant', '{0}', 'Destroy target artifact.');
const SWAT = synthetic('Test Swat', 'Instant', '{0}', 'Destroy target creature.');
const MANIFESTER = synthetic('Test Mist Ritual', 'Sorcery', '{0}', 'Manifest the top card of your library.');
const HAND_CLOAK = synthetic('Test Veil Rite', 'Sorcery', '{0}', 'Cloak a card from your hand.');
const PILE = synthetic('Test Lineup', 'Sorcery', '{0}', 'Exile any number of face-up creatures you control with disguise in a face-down pile, shuffle that pile, then cloak them.');
const SPY = synthetic('Test Spyglass', 'Sorcery', '{0}', "Cloak the top card of target opponent's library.");
const FLIPPER = synthetic('Test Unmasking', 'Instant', '{0}', 'Turn target face-down creature face up.');
const HOARD = synthetic('Test Hoard', 'Sorcery', '{0}', 'Exile the top card of your library face down.');
const STASH = synthetic('Test Stash', 'Sorcery', '{0}', 'Search your library for a card, exile it face down, then shuffle.');
const RECALL = synthetic('Test Recall', 'Instant', '{0}', "Return target card in exile to its owner's hand.");
const DEFS: CardDef[] = [SHATTER, SWAT, MANIFESTER, HAND_CLOAK, PILE, SPY, FLIPPER, HOARD, STASH, RECALL];

const castOn = (s: GameState, name: string, answers: DecisionAnswer[] = [], player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers);
const obj = (id: ObjectId): DecisionAnswer => ({ kind: 'chooseTargets', targets: [{ kind: 'object', id }] });
const pick = (ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const optionsNamed = (s: GameState, name: string): ObjectId[] => ((s.pending as { options: ObjectId[] }).options).filter((o) => s.objects[o]!.defId === name);
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: string): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId);
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('CR 701.62a, 608.2h: another player manifests dread', () => {
  it('Unwanted Remake: the destroyed creature\'s controller looks, chooses and controls the manifested permanent; the caster learns nothing of it', () => {
    let s = scenario(['Unwanted Remake', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Plains'], {
      p1: { hand: ['Unwanted Remake'], battlefield: ['Plains'] }, p2: { battlefield: ['Grizzly Bears'], library: ['Lightning Bolt', 'Hill Giant'] },
    });
    s = castOn(s, 'Unwanted Remake', [obj(find(s, 'Grizzly Bears', 'battlefield'))]);
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    s = drive(s, [pick(optionsNamed(s, 'Hill Giant'))]);
    const [id] = faceDownOf(s, 'p2');
    expect(s.objects[id!]).toMatchObject({ defId: 'Hill Giant', owner: 'p2', controller: 'p2', faceDownInfo: { by: 'manifest' } });
    expect(names(s, 'graveyard', 'p2').sort()).toEqual(['Grizzly Bears', 'Lightning Bolt']);
    expect(viewText(viewFor(s, 'p1'))).not.toMatch(/Hill Giant/);
    expect(logFor(s, 'p1')).toContain('Bob manifests a card.');
    expect(logFor(s, 'p2')).toContain('Bob manifests Hill Giant.');
  });

  it('Fear of Impostors: the countered spell\'s controller manifests dread (read as the spell last existed, CR 608.2h); "its" is not the Nightmare (CR 109.5)', () => {
    let s = scenario(['Fear of Impostors', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Forest', 'Island'], {
      p1: { hand: ['Grizzly Bears'], battlefield: lands('Forest', 2), library: ['Hill Giant', 'Lightning Bolt'] }, p2: { hand: ['Fear of Impostors'], battlefield: lands('Island', 3) },
    });
    s = castOn(s, 'Grizzly Bears');
    s = pass(s); // p2 gets priority with the Bears on the stack
    s = castOn(s, 'Fear of Impostors', [], 'p2');
    s = resolveTop(s); // Fear of Impostors enters; its trigger targets the Bears spell
    s = drive(s, [obj(find(s, 'Grizzly Bears', 'stack'))]);
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    s = drive(s, [pick(optionsNamed(s, 'Hill Giant'))]);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Grizzly Bears', 'Lightning Bolt']);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Hill Giant', controller: 'p1' });
    expect(faceDownOf(s, 'p2')).toEqual([]);
  });

  it('Unidentified Hovership: when it leaves, the owner of the card it exiled manifests dread (CR 607.2a)', () => {
    let s = scenario(['Unidentified Hovership', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Plains'], {
      p1: { hand: ['Unidentified Hovership', 'Test Shatter'], battlefield: lands('Plains', 3) }, p2: { battlefield: ['Grizzly Bears'], library: ['Hill Giant', 'Lightning Bolt'] }, defs: DEFS,
    });
    s = resolveTop(castOn(s, 'Unidentified Hovership'));
    s = resolveTop(drive(s, [obj(find(s, 'Grizzly Bears', 'battlefield'))]));
    expect(find(s, 'Grizzly Bears', 'exile')).toBeDefined();
    s = castOn(s, 'Test Shatter', [obj(find(s, 'Unidentified Hovership', 'battlefield'))]);
    s = resolveTop(s); // the Hovership is destroyed; its leaves trigger goes on the stack
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    s = drive(s, [pick(optionsNamed(s, 'Hill Giant'))]);
    expect(s.objects[faceDownOf(s, 'p2')[0]!]).toMatchObject({ defId: 'Hill Giant', controller: 'p2' });
  });

  it('Unidentified Hovership: the exiled card left exile before the Hovership left: nobody manifests dread (CR 607.2a, 400.7)', () => {
    let s = scenario(['Unidentified Hovership', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Plains'], {
      p1: { hand: ['Unidentified Hovership', 'Test Shatter', 'Test Recall'], battlefield: lands('Plains', 3) }, p2: { battlefield: ['Grizzly Bears'], library: ['Hill Giant', 'Lightning Bolt'] }, defs: DEFS,
    });
    s = resolveTop(castOn(s, 'Unidentified Hovership'));
    s = resolveTop(drive(s, [obj(find(s, 'Grizzly Bears', 'battlefield'))]));
    s = resolveTop(castOn(s, 'Test Recall', [obj(find(s, 'Grizzly Bears', 'exile'))]));
    expect(names(s, 'hand', 'p2')).toEqual(['Grizzly Bears']);
    s = castOn(s, 'Test Shatter', [obj(find(s, 'Unidentified Hovership', 'battlefield'))]);
    s = resolveAll(s);
    expect(s.pending).not.toMatchObject({ kind: 'chooseObjects' });
    expect(faceDownOf(s, 'p2')).toEqual([]);
    expect(names(s, 'library', 'p2').slice(0, 2)).toEqual(['Hill Giant', 'Lightning Bolt']); // nobody looked at or moved the top cards
    expect(logFor(s, 'p1')).not.toContain('Bob manifests a card.');
  });
});

describe('CR 701.24a, 303.4, 701.62a: Stay Hidden, Stay Silent', () => {
  it("the enchanted creature goes into its owner's library, that library is shuffled, then the Aura's controller manifests dread", () => {
    let s = scenario(['Stay Hidden, Stay Silent', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Island'], {
      p1: { battlefield: lands('Island', 6), library: ['Hill Giant', 'Lightning Bolt'] }, p2: { battlefield: ['Grizzly Bears'] },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    let aura = '';
    s = tweak(s, (x) => { aura = put(x, 'p1', 'battlefield', 'Stay Hidden, Stay Silent'); x.objects[aura]!.attachedTo = bears; });
    const key = getChars(s, aura).abilities.find((a) => a.def.kind === 'activated')!.key;
    s = resolveTop(drive(act(s, { type: 'activate', player: 'p1', source: aura, ability: key })));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    s = drive(s, [pick(optionsNamed(s, 'Hill Giant'))]);
    expect(names(s, 'library', 'p2')).toContain('Grizzly Bears');
    expect(s.objects[faceDownOf(s, 'p1')[0]!]).toMatchObject({ defId: 'Hill Giant', controller: 'p1' });
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Lightning Bolt', 'Stay Hidden, Stay Silent']); // the Aura enchants nothing any more (CR 704.5m)
  });
});

describe('CR 701.62a-b, 608.2c: manifest dread X times, each of those creatures, and the card put into the graveyard this way', () => {
  it("Valgavoth's Onslaught (X = 2) with Paranormal Analyst: two manifested 2/2s with two +1/+1 counters each; the Analyst triggers twice and returns each binned card", () => {
    let s = scenario(["Valgavoth's Onslaught", 'Paranormal Analyst', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Shock', 'Forest'], {
      p1: { hand: ["Valgavoth's Onslaught"], battlefield: ['Paranormal Analyst', ...lands('Forest', 5)], library: ['Grizzly Bears', 'Lightning Bolt', 'Hill Giant', 'Shock'] },
    });
    s = castOn(s, "Valgavoth's Onslaught", [{ kind: 'chooseNumber', n: 2 }]);
    s = resolveTop(s);
    s = drive(s, [pick(optionsNamed(s, 'Grizzly Bears'))]);
    s = drive(s, [pick(optionsNamed(s, 'Hill Giant'))]);
    const ids = faceDownOf(s, 'p1');
    expect(ids.map((id) => s.objects[id]!.defId).sort()).toEqual(['Grizzly Bears', 'Hill Giant']);
    for (const id of ids) {
      expect(counters(s, id)).toBe(2);
      expect(getChars(s, id)).toMatchObject({ power: '4', toughness: '4' });
    }
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Lightning Bolt', 'Shock', "Valgavoth's Onslaught"]);
    expect(s.zones.stack).toHaveLength(2); // CR 701.62b: one trigger per manifest dread
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Lightning Bolt', 'Shock']);
    expect(names(s, 'graveyard', 'p1')).toEqual(["Valgavoth's Onslaught"]);
  });
});

describe('CR 701.58a, 701.58e: cloak from a hand, from a look, from another library, from an exiled pile', () => {
  it('"Cloak a card from your hand": the player chooses the card (CR 402.3), it becomes a 2/2 with ward {2} only its controller can identify', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Veil Rite', 'Grizzly Bears', 'Hill Giant'] }, defs: DEFS });
    s = castOn(s, 'Test Veil Rite');
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    s = drive(s, [pick([find(s, 'Hill Giant', 'hand', 'p1')])]);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Hill Giant', faceDownInfo: { by: 'cloak', profile: 'ward2' } });
    expect(names(s, 'hand', 'p1')).toEqual(['Grizzly Bears']);
    expect(viewText(viewFor(s, 'p2'))).not.toMatch(/Hill Giant/);
  });

  it('Hide in Plain Sight: two of the top five cloaked one at a time, the other three on the bottom of the library', () => {
    let s = scenario(['Hide in Plain Sight', 'Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Shock', 'Exalted Angel', 'Forest'], {
      p1: { hand: ['Hide in Plain Sight'], battlefield: lands('Forest', 4), library: ['Grizzly Bears', 'Hill Giant', 'Lightning Bolt', 'Shock', 'Exalted Angel'] },
    });
    s = resolveTop(castOn(s, 'Hide in Plain Sight'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 2, max: 2 });
    s = drive(s, [pick([...optionsNamed(s, 'Hill Giant'), ...optionsNamed(s, 'Exalted Angel')])]);
    expect(faceDownOf(s, 'p1').map((id) => s.objects[id]!.defId).sort()).toEqual(['Exalted Angel', 'Hill Giant']);
    const lib = names(s, 'library', 'p1');
    expect(lib.slice(0, 20).every((n) => n === 'Plains')).toBe(true); // the 20 setup Plains are on top now
    expect(lib.slice(20).sort()).toEqual(['Grizzly Bears', 'Lightning Bolt', 'Shock']);
  });

  it("\"cloak the top card of target opponent's library\": the card is the opponent's, the permanent is the caster's (CR 110.2, 108.3)", () => {
    let s = scenario(['Hill Giant'], { p1: { hand: ['Test Spyglass'] }, p2: { library: ['Hill Giant'] }, defs: DEFS });
    s = resolveTop(castOn(s, 'Test Spyglass', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]));
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Hill Giant', owner: 'p2', controller: 'p1', faceDownInfo: { by: 'cloak' } });
    expect(viewText(viewFor(s, 'p2'))).not.toMatch(/Hill Giant/);
  });

  it('an exiled face-down pile, shuffled, then cloaked: the disguise creature becomes a cloaked permanent nobody else can tell (CR 406.3)', () => {
    let s = scenario(['Lumbering Laundry', 'Grizzly Bears'], { p1: { hand: ['Test Lineup'], battlefield: ['Lumbering Laundry', 'Grizzly Bears'] }, defs: DEFS });
    s = resolveTop(castOn(s, 'Test Lineup'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0 });
    expect((s.pending as { options: ObjectId[] }).options).toEqual([find(s, 'Lumbering Laundry', 'battlefield')]); // the Bears has no disguise
    s = drive(s, [pick([find(s, 'Lumbering Laundry', 'battlefield')])]);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Lumbering Laundry', faceDownInfo: { by: 'cloak', profile: 'ward2' } });
    expect(s.zones.exile).toEqual([]);
    expect(viewFor(s, 'p2').objects[id!]!.defId).toBe('__facedown_ward2__');
  });

  it('Cryptic Coat: cloak the top card of your library, then attach the Equipment to that permanent (CR 301.5)', () => {
    let s = scenario(['Cryptic Coat', 'Hill Giant', 'Island'], { p1: { hand: ['Cryptic Coat'], battlefield: lands('Island', 3), library: ['Hill Giant'] } });
    s = resolveTop(castOn(s, 'Cryptic Coat'));
    s = resolveTop(s);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[find(s, 'Cryptic Coat', 'battlefield')]!.attachedTo).toBe(id);
    expect(getChars(s, id!)).toMatchObject({ power: '3', toughness: '2' });
  });
});

describe('CR 708.5, 609.4: looking at face-down permanents you don\'t control', () => {
  it('Found Footage: its controller sees the opponent\'s face-down creatures; the opponent and a spectator still don\'t', () => {
    let s = scenario(['Found Footage', 'Exalted Angel'], { p1: { battlefield: ['Found Footage'] } });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p2', 'Exalted Angel');
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(true);
    expect(viewFor(s, 'p1').objects[id]!.defId).toBe('Exalted Angel');
    expect(viewFor(s, null).objects[id]!.defId).toBe('__facedown__');
    // without the Clue, p1 can't look (CR 708.5)
    const t = tweak(s, (x) => { x.zones.battlefield = x.zones.battlefield.filter((o) => x.objects[o]!.defId !== 'Found Footage'); delete x.objects[find(s, 'Found Footage', 'battlefield')]; });
    expect(viewFor(t, 'p1').objects[id]!.defId).toBe('__facedown__');
    expect(viewText(viewFor(t, 'p1'))).not.toMatch(/Exalted Angel/);
  });

  it('Lumbering Laundry: until end of turn only (CR 611.2a, 514.2)', () => {
    let s = scenario(['Lumbering Laundry', 'Exalted Angel', 'Plains'], { p1: { battlefield: ['Lumbering Laundry', ...lands('Plains', 2)] } });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p2', 'Exalted Angel');
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(false);
    const laundry = find(s, 'Lumbering Laundry', 'battlefield');
    const key = getChars(s, laundry).abilities.find((a) => a.def.kind === 'activated')!.key;
    s = resolveTop(drive(act(s, { type: 'activate', player: 'p1', source: laundry, ability: key })));
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[id]!, 'p2')).toBe(true); // its controller, as always
    s = advanceTo(s, 2, 'upkeep');
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(false);
  });
});

describe('CR 708.7, 101.2: "can\'t be turned face up during your turn" (Karlov Watchdog)', () => {
  it('during its controller\'s turn, an opponent can\'t take the special action and an effect leaves the permanent face down; on the opponent\'s own turn it can', () => {
    let s = scenario(['Karlov Watchdog', 'Exalted Angel', 'Plains'], { p1: { battlefield: ['Karlov Watchdog'], hand: ['Test Unmasking'] }, p2: { battlefield: lands('Plains', 4) }, defs: DEFS });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p2', 'Exalted Angel');
    s = pass(s); // p2 has priority in p1's main phase
    expect(s.pending?.player).toBe('p2');
    expect(turnUpActions(s, 'p2')).toEqual([]);
    s = pass(s);
    s = resolveTop(castOn(s, 'Test Unmasking', [obj(id)]));
    expect(s.objects[id]!.faceDown).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(turnUpActions(s, 'p2').map((a) => a.object)).toEqual([id]);
    s = turnUp(s, id, 'morph', [], 'p2');
    expect(s.objects[id]!.faceDown).toBe(false);
  });
});

describe('CR 708.3, 708.8, 603.4: the turn\'s face-down history (Oblivious Bookworm, Tunnel Tipster)', () => {
  it('nothing face down this turn: you draw, then discard', () => {
    const s = scenario(['Oblivious Bookworm', 'Grizzly Bears'], { p1: { battlefield: ['Oblivious Bookworm'], hand: ['Grizzly Bears'] } });
    let t = advanceTo(s, 1, 'end');
    t = pass(pass(t));
    t = drive(t, [{ kind: 'yesNo', yes: true }]);
    expect(t.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' }); // the discard
    t = drive(t, [pick([find(t, 'Grizzly Bears', 'hand', 'p1')])]);
    expect(names(t, 'graveyard', 'p1')).toEqual(['Grizzly Bears']);
  });
  it('a permanent entered the battlefield face down under your control this turn: no discard; Tunnel Tipster gets its counter', () => {
    let s = scenario(['Oblivious Bookworm', 'Tunnel Tipster', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Oblivious Bookworm', 'Tunnel Tipster'], hand: ['Test Mist Ritual', 'Grizzly Bears'], library: ['Hill Giant'] }, defs: DEFS });
    s = resolveTop(castOn(s, 'Test Mist Ritual'));
    expect(faceDownOf(s, 'p1')).toHaveLength(1);
    let t = drive(advanceTo(s, 1, 'end')); // the two end step triggers are ordered
    expect(t.zones.stack).toHaveLength(2);
    t = resolveAll(t, [{ kind: 'yesNo', yes: true }]);
    expect(names(t, 'hand', 'p1')).toHaveLength(2); // drew, did not discard
    expect(counters(t, find(t, 'Tunnel Tipster', 'battlefield'))).toBe(1);
  });
  it('you turned a permanent face up this turn: no discard', () => {
    let s = scenario(['Oblivious Bookworm', 'Exalted Angel', 'Grizzly Bears', 'Plains'], { p1: { battlefield: ['Oblivious Bookworm', ...lands('Plains', 4)], hand: ['Grizzly Bears'] } });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    s = turnUp(s, id, 'morph');
    expect(s.objects[id]!.faceDown).toBe(false);
    let t = drive(advanceTo(s, 1, 'end'));
    expect(t.zones.stack).toHaveLength(1);
    t = resolveAll(t, [{ kind: 'yesNo', yes: true }]);
    expect(t.pending?.kind).toBe('priority'); // no discard asked for
    expect(names(t, 'hand', 'p1')).toHaveLength(2); // drew, did not discard
    expect(names(t, 'graveyard', 'p1')).toEqual([]);
  });
  it("you turned an opponent's permanent face up with your spell: you did turn a permanent face up, no discard (CR 701.40b, 608.2)", () => {
    let s = scenario(['Oblivious Bookworm', 'Exalted Angel', 'Grizzly Bears'], { p1: { battlefield: ['Oblivious Bookworm'], hand: ['Test Unmasking', 'Grizzly Bears'] }, defs: DEFS });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p2', 'Exalted Angel');
    s = resolveTop(castOn(s, 'Test Unmasking', [obj(id)]));
    expect(s.objects[id]!.faceDown).toBe(false);
    let t = drive(advanceTo(s, 1, 'end'));
    expect(t.zones.stack).toHaveLength(1);
    t = resolveAll(t, [{ kind: 'yesNo', yes: true }]);
    expect(t.pending?.kind).toBe('priority'); // no discard asked for
    expect(names(t, 'hand', 'p1')).toHaveLength(2); // drew, did not discard
    expect(names(t, 'graveyard', 'p1')).toEqual(['Test Unmasking']);
  });
  it("an opponent's spell turned your permanent face up: you turned nothing face up, you discard (CR 701.40b, 608.2)", () => {
    let s = scenario(['Oblivious Bookworm', 'Exalted Angel', 'Grizzly Bears'], { p1: { battlefield: ['Oblivious Bookworm'], hand: ['Grizzly Bears'] }, p2: { hand: ['Test Unmasking'] }, defs: DEFS });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    s = pass(s); // p2 has priority in p1's main phase
    s = resolveTop(castOn(s, 'Test Unmasking', [obj(id)], 'p2'));
    expect(s.objects[id]!.faceDown).toBe(false);
    let t = advanceTo(s, 1, 'end');
    t = pass(pass(t));
    t = drive(t, [{ kind: 'yesNo', yes: true }]);
    expect(t.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' }); // the discard
  });
});

describe('CR 603.2, 708.8: Cryptid Inspector', () => {
  it('a face-down permanent entering and a permanent turned face up each put a counter on it', () => {
    let s = scenario(['Cryptid Inspector', 'Exalted Angel', 'Hill Giant', 'Plains'], { p1: { battlefield: ['Cryptid Inspector', ...lands('Plains', 4)], hand: ['Test Mist Ritual'], library: ['Hill Giant'] }, defs: DEFS });
    const inspector = find(s, 'Cryptid Inspector', 'battlefield');
    s = resolveAll(resolveTop(castOn(s, 'Test Mist Ritual')));
    expect(counters(s, inspector)).toBe(1);
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    expect(counters(s, inspector)).toBe(1); // put there by the test, not by entering
    s = resolveAll(turnUp(s, id, 'morph'));
    expect(counters(s, inspector)).toBe(2);
  });
});

describe('CR 614.1c, 614.1e, 708.3, 708.11: Crowd-Control Warden', () => {
  it('cast face up, it enters with a counter for each other creature you control', () => {
    let s = scenario(['Crowd-Control Warden', 'Grizzly Bears', 'Forest', 'Plains'], { p1: { hand: ['Crowd-Control Warden'], battlefield: ['Grizzly Bears', 'Grizzly Bears', ...lands('Forest', 3), ...lands('Plains', 2)] } });
    s = resolveTop(castOn(s, 'Crowd-Control Warden'));
    expect(counters(s, find(s, 'Crowd-Control Warden', 'battlefield'))).toBe(2);
  });
  it('cast face down it enters with none; turned face up for its disguise cost it gets them as it is turned face up', () => {
    let s = scenario(['Crowd-Control Warden', 'Grizzly Bears', 'Forest', 'Plains'], { p1: { hand: ['Crowd-Control Warden'], battlefield: ['Grizzly Bears', ...lands('Forest', 4), ...lands('Plains', 4)] } });
    s = resolveTop(castFaceDown(s, 'Crowd-Control Warden', 'disguise'));
    const [id] = faceDownOf(s, 'p1');
    expect(counters(s, id!)).toBe(0);
    s = turnUp(s, id!, 'disguise');
    expect(s.objects[id!]!.faceDown).toBe(false);
    expect(counters(s, id!)).toBe(1);
    expect(getChars(s, id!)).toMatchObject({ power: '5', toughness: '5' });
  });
});

describe('CR 708.3, 708.7, 110.4a: Yarus, Roar of the Old Gods', () => {
  it('a face-down creature that dies returns face down under its owner\'s control, then is turned face up; an instant card stays in the graveyard', () => {
    let s = scenario(['Yarus, Roar of the Old Gods', 'Hill Giant', 'Lightning Bolt'], { p1: { battlefield: ['Yarus, Roar of the Old Gods'], hand: ['Test Swat', 'Test Swat'] }, defs: DEFS });
    let giant: ObjectId;
    let bolt: ObjectId;
    [s, giant] = putFaceDown(s, 'p1', 'Hill Giant', { by: 'manifest', profile: 'plain' });
    [s, bolt] = putFaceDown(s, 'p1', 'Lightning Bolt', { by: 'manifest', profile: 'plain' });
    s = resolveAll(resolveTop(castOn(s, 'Test Swat', [obj(giant)])));
    const back = find(s, 'Hill Giant', 'battlefield');
    expect(s.objects[back]).toMatchObject({ faceDown: false, controller: 'p1' });
    s = resolveAll(resolveTop(castOn(s, 'Test Swat', [obj(bolt)])));
    expect(names(s, 'graveyard', 'p1')).toContain('Lightning Bolt'); // CR 400.7: the card in the graveyard is an instant card, whatever the face-down creature was
    expect(s.zones.battlefield.map((x) => s.objects[x]!.defId)).not.toContain('Lightning Bolt');
  });
});

describe('CR 406.3: cards exiled face down', () => {
  it('"exile the top card of your library face down": nobody may look at it', () => {
    let s = scenario(['Hill Giant'], { p1: { hand: ['Test Hoard'], library: ['Hill Giant'] }, defs: DEFS });
    s = resolveTop(castOn(s, 'Test Hoard'));
    const id = s.zones.exile.find((x) => s.objects[x]!.defId === 'Hill Giant')!;
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(false);
    expect(canSee(s, s.objects[id]!, 'p2')).toBe(false);
    expect(viewText(viewFor(s, 'p1'))).not.toMatch(/Hill Giant/);
  });
  it('"search your library for a card, exile it face down": the searcher may keep looking at it, the opponent may not', () => {
    let s = scenario(['Hill Giant'], { p1: { hand: ['Test Stash'], library: ['Hill Giant'] }, defs: DEFS });
    s = resolveTop(castOn(s, 'Test Stash'));
    s = drive(s, [pick([find(s, 'Hill Giant', 'library', 'p1')])]);
    const id = s.zones.exile.find((x) => s.objects[x]!.defId === 'Hill Giant')!;
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[id]!, 'p2')).toBe(false);
    expect(viewText(viewFor(s, 'p2'))).not.toMatch(/Hill Giant/);
  });
});
