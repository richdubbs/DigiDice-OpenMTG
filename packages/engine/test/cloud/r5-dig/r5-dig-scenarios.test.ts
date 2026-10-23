/**
 * Standard round 5, slice r5-dig (library digs and impulse play, the units round 4 left): the templates of parser/templates/zz-cloud/r5-dig.json and the parser,
 * renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2c, 118.12a, 608.2h   "Choose target spell. Mill two cards, then counter the chosen spell unless its controller pays {1} for each card in your graveyard."
 *                                ("unless" scopes the counter only; the count is read after the mill)
 *   CR 701.20a, 608.2c-d         "You may reveal up to two creature cards from among them. If C, put the revealed cards onto the battlefield. Otherwise, ... hand."
 *   CR 700.3, 701.20e            "... separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles. Put that pile into your hand ..."
 *   CR 701.23a, 608.2d           "... different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest
 *                                onto the battlefield tapped, then shuffle."
 *   CR 611.2a, 205.1a, 613.4b    "If ~ is a Druid, it becomes an Elf Warrior and gains trample." / "it becomes a 5/4 Elf Berserker and gains trample."
 *   CR 120.3, 109.2, 603.7       "Target creature you control deals damage equal to its power to each other creature. Until end of turn, whenever a creature you
 *                                control dies, exile the top card of your library. You may play it until the end of your next turn."
 *   CR 608.2f, 611.2a, 108.3     "Exile target creature and the top card of your library. For each of those cards, its owner may play it until the end of their next turn."
 *   CR 611.2a, 607.2a            "You may play that card until you exile another card with ~."
 *   CR 701.20a-b, 608.2e         "<player> reveals cards from the top of their library until they reveal ..., then puts those cards into their graveyard."
 *   CR 715.3, 715.3a, 715.3d     "When ~ dies, you may cast it from your graveyard as an Adventure until the end of your next turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (p.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
type Opts = Parameters<typeof settle>[1];
const cast = (s0: GameState, name: string, opts: Opts = {}, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), opts);
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
const lib = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'library', p);
const hand = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'hand', p);
const yard = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
const exiledId = (s: GameState, name: string): ObjectId => s.zones.exile.find((id) => s.objects[id]!.defId === name)!;
const libId = (s: GameState, name: string, p: PlayerId = 'p1'): ObjectId => s.zones.library[p]!.find((id) => s.objects[id]!.defId === name)!;
/** Can this player cast (or play) the object from where it is now? */
const castable = (s: GameState, id: ObjectId, p: PlayerId = 'p1'): boolean => legal(s, p).some((a) => (a.action as { card?: ObjectId }).card === id);
const sorted = (xs: string[]): string[] => [...xs].sort();

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
const ROCK = card('Test Rock', 'Artifact', '');
const GEM = card('Test Gem', 'Artifact', '');
const IDOL = card('Test Idol', 'Artifact', '');
const FOREST = card('Test Forest', 'Land — Forest', '');
const TRAIL = card('Test Trail', 'Land', '');

describe('CR 608.2c, 118.12a, 608.2h: "Mill two cards, then counter the chosen spell unless its controller pays {1} for each card in your graveyard."', () => {
  const SWALLOW = card('Test Swallow', 'Instant', 'Choose target spell. Mill two cards, then counter the chosen spell unless its controller pays {1} for each card in your graveyard.');
  it('is understood as the mill, then the payment that prevents the counter only', () => {
    expect(noManual(SWALLOW)).toBe(true);
    const steps = SWALLOW.faces[0]!.abilities[0]! as { effect: { steps: { op: string }[] } };
    expect(steps.effect.steps.map((x) => x.op)).toEqual(['mill', 'pay']);
  });
  it('the cost is counted after the mill: with no mana the spell is countered; with two Forests it is paid for the two milled cards', () => {
    for (const lands of [0, 2]) {
      const s0 = scenario([], {
        p1: { hand: ['Test Bear', 'Test Swallow'], battlefield: Array(lands).fill('Test Forest'), library: ['Test Rock', 'Test Gem'] }, defs: [SWALLOW, BEAR, ROCK, GEM, FOREST],
      });
      let s = cast(s0, 'Test Bear');
      const spell = s.zones.stack[0]!;
      s = cast(s, 'Test Swallow', { targets: [[obj(spell)]] });
      s = settle(pass(pass(s)), { answers: [yes] }); // the Swallow resolves; its controller (p1) is asked to pay
      s = resolveAll(s, { answers: [yes] });
      expect(sorted(yard(s))).toEqual(lands === 0 ? ['Test Bear', 'Test Gem', 'Test Rock', 'Test Swallow'] : ['Test Gem', 'Test Rock', 'Test Swallow']);
      if (lands === 2) {
        expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
        expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Forest').every((id) => s.objects[id]!.tapped)).toBe(true);
      }
    }
  });
});

describe('CR 701.20a, 608.2c-d: "You may reveal up to two creature cards from among them. If you control a Forest, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand."', () => {
  const DEBUT = card('Test Debut', 'Sorcery', 'Look at the top five cards of your library. You may reveal up to two creature cards from among them. If you control a Forest, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand. Then shuffle.');
  it('is understood', () => expect(noManual(DEBUT)).toBe(true));
  for (const forest of [true, false]) {
    it(`the two chosen creature cards are revealed and go ${forest ? 'onto the battlefield (the condition holds)' : 'into the hand (otherwise)'}; the rest stay in the library`, () => {
      const s0 = scenario([], { p1: { hand: ['Test Debut'], battlefield: forest ? ['Test Forest'] : [], library: ['Test Bear', 'Test Rock', 'Test Ogre', 'Test Gem'] }, defs: [DEBUT, BEAR, OGRE, ROCK, GEM, FOREST] });
      let s = cast(s0, 'Test Debut');
      s = settle(pass(pass(s)));
      expect(s.pending?.kind).toBe('chooseObjects');
      const options = (s.pending as { options: ObjectId[] }).options;
      expect(sorted(options.map((id) => s.objects[id]!.defId))).toEqual(['Test Bear', 'Test Ogre']); // only creature cards among the five
      s = settle(s, { picks: [options] });
      s = resolveAll(s);
      if (forest) expect(sorted(battlefieldNames(s, 'p1').filter((n) => n !== 'Test Forest'))).toEqual(['Test Bear', 'Test Ogre']);
      else expect(sorted(hand(s))).toEqual(['Test Bear', 'Test Ogre']);
      expect(lib(s)).toContain('Test Rock');
      expect(lib(s)).toContain('Test Gem');
    });
  }
  it('choosing none reveals nothing and moves nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Debut'], library: ['Test Bear', 'Test Rock'] }, defs: [DEBUT, BEAR, ROCK, FOREST] });
    const s = resolveAll(cast(s0, 'Test Debut'), { picks: [[]] });
    expect(hand(s)).toEqual([]);
    expect(lib(s)).toContain('Test Bear');
  });
});

describe('CR 700.3, 700.3a, 700.3d, 701.20e: "Look at the top four cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles. Put that pile into your hand and the other into your graveyard."', () => {
  const RIDDLE = card('Test Riddle', 'Instant', 'Look at the top four cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles. Put that pile into your hand and the other into your graveyard.');
  it('is understood: a piles step with faceDown, separated by you, chosen by an opponent', () => {
    expect(noManual(RIDDLE)).toBe(true);
    const j = JSON.stringify(RIDDLE.faces[0]!.abilities[0]);
    expect(j).toContain('"faceDown":true');
    expect(j).toContain('"chooser":{"ref":"anOpponent"}');
  });
  for (const pick of ['down', 'up'] as const) {
    it(`the opponent sees only the face-up pile and the number of face-down cards; choosing the ${pick === 'down' ? 'face-down' : 'face-up'} pile puts it into your hand`, () => {
      const s0 = scenario([], { p1: { hand: ['Test Riddle'], library: ['Test Bear', 'Test Rock', 'Test Ogre', 'Test Gem'] }, defs: [RIDDLE, BEAR, ROCK, OGRE, GEM] });
      let s = settle(pass(pass(cast(s0, 'Test Riddle'))));
      // you separate: the face-down pile is the Bear and the Ogre
      const bear = libId(s, 'Test Bear');
      const ogre = libId(s, 'Test Ogre');
      s = settle(s, { picks: [[bear, ogre]] });
      expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2' });
      const labels = (s.pending as { options: { id: string; label: string }[] }).options.map((o) => o.label);
      expect(labels[0]).toBe('Face-down pile: 2 cards');
      expect(labels[1]).toContain('Test Rock');
      expect(labels.join(' ')).not.toContain('Test Bear'); // the face-down cards are not shown to the chooser
      expect(s.objects[libId(s, 'Test Rock')]!.revealedTo ?? []).toContain('p2'); // the face-up pile is seen by every player
      expect(s.objects[bear]!.revealedTo ?? []).not.toContain('p2');
      s = answer(s, { kind: 'chooseOption', ids: [pick] });
      s = resolveAll(s);
      const down = ['Test Bear', 'Test Ogre'];
      const up = ['Test Gem', 'Test Rock'];
      expect(sorted(hand(s))).toEqual(pick === 'down' ? down : up);
      expect(sorted(yard(s).filter((n) => n !== 'Test Riddle'))).toEqual(pick === 'down' ? up : down);
    });
  }
});

describe('CR 701.23a, 201.2b, 608.2d: "... with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped, then shuffle."', () => {
  const TEACH = card('Test Teaching', 'Instant', 'Search your library for up to three artifact cards with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped, then shuffle.');
  it('is understood', () => expect(noManual(TEACH)).toBe(true));
  it('you find three artifacts; the opponent picks two for your graveyard; the other one enters tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Teaching'], library: ['Test Rock', 'Test Gem', 'Test Idol', 'Test Bear'] }, defs: [TEACH, ROCK, GEM, IDOL, BEAR] });
    let s = settle(pass(pass(cast(s0, 'Test Teaching'))));
    for (const n of ['Test Rock', 'Test Gem', 'Test Idol']) if (s.pending?.kind === 'chooseObjects' && s.pending.player === 'p1') s = settle(s, { picks: [[libId(s, n)]] });
    if (s.pending?.kind === 'chooseObjects' && s.pending.player === 'p1') {
      const opts = (s.pending as { options: ObjectId[] }).options;
      s = settle(s, { picks: [[libId(s, 'Test Rock'), libId(s, 'Test Gem'), libId(s, 'Test Idol')].filter((id) => opts.includes(id))] });
    }
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    expect((s.pending as { options: ObjectId[] }).options.length).toBe(3);
    s = settle(s, { picks: [[libId(s, 'Test Gem'), libId(s, 'Test Idol')]] });
    s = resolveAll(s);
    expect(sorted(yard(s).filter((n) => n !== 'Test Teaching'))).toEqual(['Test Gem', 'Test Idol']);
    const arts = s.zones.battlefield.filter((id) => ['Test Rock', 'Test Idol', 'Test Gem'].includes(s.objects[id]!.defId));
    expect(arts.map((id) => s.objects[id]!.defId)).toEqual(['Test Rock']);
    expect(arts.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(lib(s)).toContain('Test Bear');
  });
});

describe('CR 611.2a, 205.1a, 613.1d, 613.4b: "If ~ is a Druid, it becomes an Elf Warrior and gains trample." and "it becomes a 5/4 Elf Berserker and gains trample."', () => {
  const SHIFT = card('Test Shifter', 'Creature — Human Druid', '{0}: If Test Shifter is a Druid, it becomes an Elf Warrior and gains trample.\n{0}: If Test Shifter is a Warrior, it becomes a 5/4 Elf Berserker and gains haste.', { pt: ['1', '1'] });
  it('is understood: a permanent type change (its creature types become exactly the new ones) with the granted keyword, then base power and toughness', async () => {
    expect(noManual(SHIFT)).toBe(true);
    const { charsOfObject } = await import('../../../src/rules/characteristics');
    const s0 = scenario([], { p1: { battlefield: ['Test Shifter'] }, defs: [SHIFT] });
    const id = find(s0, 'Test Shifter', 'battlefield');
    const [first, second] = legal(s0, 'p1', 'activate').filter((a) => (a.action as { source?: ObjectId }).source === id);
    // the second ability first: not a Warrior yet, so nothing happens
    let s = resolveAll(settle(act(s0, second!.action)));
    expect(charsOfObject(s, s.objects[id]!).subtypes).toEqual(['Human', 'Druid']);
    s = resolveAll(settle(act(s, first!.action)));
    let c = charsOfObject(s, s.objects[id]!);
    expect(sorted(c.subtypes)).toEqual(['Elf', 'Warrior']);
    expect(c.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword))).toContain('trample');
    const again = legal(s, 'p1', 'activate').filter((a) => (a.action as { source?: ObjectId }).source === id)[1]!;
    s = resolveAll(settle(act(s, again.action)));
    c = charsOfObject(s, s.objects[id]!);
    expect(sorted(c.subtypes)).toEqual(['Berserker', 'Elf']);
    expect([Number(c.power), Number(c.toughness)]).toEqual([5, 4]);
    s = advanceTo(s, 2, 'main1'); // no duration: it lasts (CR 611.2a)
    expect(sorted(charsOfObject(s, s.objects[id]!).subtypes)).toEqual(['Berserker', 'Elf']);
  });
});

describe('CR 120.3, 109.2, 603.7, 611.2c: "Target creature you control deals damage equal to its power to each other creature. Until end of turn, whenever a creature you control dies, exile the top card of your library. You may play it until the end of your next turn."', () => {
  const WALTZ = card('Test Waltz', 'Sorcery', 'Target creature you control deals damage equal to its power to each other creature. Until end of turn, whenever a creature you control dies, exile the top card of your library. You may play it until the end of your next turn.');
  it('is understood: the permission is an instruction of the delayed trigger', () => {
    expect(noManual(WALTZ)).toBe(true);
    const j = JSON.stringify(WALTZ.faces[0]!.abilities[0]);
    expect(j).toMatch(/"op":"delay".*"do":\[\{"op":"move".*"s":"permit"/);
  });
  it('the target deals its power to every other creature, not to itself; each creature of yours that dies exiles a card you may play', () => {
    const s0 = scenario([], { p1: { hand: ['Test Waltz'], battlefield: ['Test Ogre', 'Test Bear'], library: ['Test Rock', 'Test Gem'] }, p2: { battlefield: ['Test Bear'] }, defs: [WALTZ, OGRE, BEAR, ROCK, GEM] });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Waltz', { targets: [[obj(ogre)]] }));
    expect(battlefieldNames(s)).toEqual(['Test Ogre']); // both Bears died (3 damage each), the Ogre dealt no damage to itself
    expect(s.objects[ogre]!.damage).toBe(0);
    expect(exiled(s)).toEqual(['Test Rock']); // only your Bear's death triggered
    expect(castable(s, exiledId(s, 'Test Rock'))).toBe(true);
  });
});

describe('CR 608.2f, 611.2a, 108.3: "Exile target creature and the top card of your library. For each of those cards, its owner may play it until the end of their next turn."', () => {
  const SUSPEND = card('Test Suspension', 'Instant', 'Exile target creature and the top card of your library. For each of those cards, its owner may play it until the end of their next turn.');
  it('is understood', () => expect(noManual(SUSPEND)).toBe(true));
  it('each card\'s owner, and only its owner, may play it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Suspension'], library: ['Test Rock'] }, p2: { battlefield: ['Test Bear'] }, defs: [SUSPEND, BEAR, ROCK] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = resolveAll(cast(s0, 'Test Suspension', { targets: [[obj(bear)]] }));
    expect(sorted(exiled(s))).toEqual(['Test Bear', 'Test Rock']);
    expect(castable(s, exiledId(s, 'Test Rock'), 'p1')).toBe(true);
    expect(castable(s, exiledId(s, 'Test Bear'), 'p1')).toBe(false);
    s = advanceTo(s, 2, 'main1'); // p2's turn: p2 may cast their Bear
    expect(castable(s, exiledId(s, 'Test Bear'), 'p2')).toBe(true);
    expect(castable(s, exiledId(s, 'Test Rock'), 'p2')).toBe(false);
  });
});

describe('CR 611.2a, 607.2a, 400.7: "you may play that card until you exile another card with ~"', () => {
  const AMULET = card('Test Amulet', 'Artifact', '{T}: Exile the top card of your library. You may play it until you exile another card with Test Amulet.');
  it('is understood: the duration untilExiledWith', () => {
    expect(noManual(AMULET)).toBe(true);
    expect(JSON.stringify(AMULET.faces[0]!.abilities[0])).toContain('"d":"untilExiledWith"');
  });
  it('the first card stays playable across turns until the source exiles the next card; then only the newer one is', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Amulet'], library: ['Test Rock', 'Test Gem'] }, defs: [AMULET, ROCK, GEM] });
    const amulet = find(s0, 'Test Amulet', 'battlefield');
    const tap = (st: GameState): GameState => resolveAll(settle(act(st, legal(st, 'p1', 'activate').find((a) => (a.action as { source?: ObjectId }).source === amulet)!.action)));
    let s = tap(s0);
    const rock = exiledId(s, 'Test Rock');
    expect(castable(s, rock)).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, rock)).toBe(true); // no turn limit
    s = tap(s);
    expect(castable(s, rock)).toBe(false);
    expect(castable(s, exiledId(s, 'Test Gem'))).toBe(true);
  });
});

describe('CR 701.20a-b, 608.2e, 404.1: "<player> reveals cards from the top of their library until they reveal ..., then puts those cards into their graveyard."', () => {
  const SPY = card('Test Spy', 'Creature — Rogue', 'When this creature enters, target player reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.', { pt: ['1', '1'] });
  const GRIND = card('Test Grind', 'Sorcery', 'Each opponent reveals cards from the top of their library until they reveal two land cards, then puts all cards revealed this way into their graveyard.');
  it('are understood', () => {
    expect(noManual(SPY)).toBe(true);
    expect(noManual(GRIND)).toBe(true);
  });
  it('the target player reveals until a land card; every revealed card, the land included, goes to their graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Spy'] }, p2: { library: ['Test Rock', 'Test Bear', 'Test Trail', 'Test Gem'] }, defs: [SPY, ROCK, BEAR, TRAIL, GEM] });
    let s = settle(pass(pass(cast(s0, 'Test Spy'))), { targets: [[player('p2')]] });
    s = resolveAll(s, { targets: [[player('p2')]] });
    expect(sorted(yard(s, 'p2'))).toEqual(['Test Bear', 'Test Rock', 'Test Trail']);
    expect(lib(s, 'p2')[0]).toBe('Test Gem');
  });
  it('each opponent reveals until two land cards', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grind'] }, p2: { library: ['Test Trail', 'Test Bear', 'Test Trail', 'Test Gem'] }, defs: [GRIND, TRAIL, BEAR, GEM] });
    const s = resolveAll(cast(s0, 'Test Grind'));
    expect(sorted(yard(s, 'p2'))).toEqual(['Test Bear', 'Test Trail', 'Test Trail']);
    expect(lib(s, 'p2')[0]).toBe('Test Gem');
  });
});

describe('CR 715.3, 715.3a, 715.3d: "When ~ dies, you may cast it from your graveyard as an Adventure until the end of your next turn."', () => {
  const KNIGHT = compileCard({
    name: 'Test Knight // Test Whisper', layout: 'adventure', mana_cost: '{0} // {0}', type_line: 'Creature — Human Knight // Sorcery — Adventure', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Knight', mana_cost: '{0}', type_line: 'Creature — Human Knight', oracle_text: 'When this creature dies, you may cast it from your graveyard as an Adventure until the end of your next turn.', power: '2', toughness: '2' },
      { name: 'Test Whisper', mana_cost: '{0}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' },
    ],
  } as unknown as OracleCard);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is understood', () => expect(noManual(KNIGHT)).toBe(true));
  it('after it dies only the Adventure may be cast from the graveyard; as it resolves it goes on an adventure, and the creature may then be cast from exile', () => {
    const s0 = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Knight // Test Whisper'] }, defs: [KNIGHT, KILL] });
    const knight = find(s0, 'Test Knight // Test Whisper', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Kill', { targets: [[obj(knight)]] }));
    const inYard = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Knight // Test Whisper')!;
    expect(inYard).toBeDefined();
    const casts = legal(s, 'p1').filter((a) => (a.action as { card?: ObjectId }).card === inYard);
    expect(casts.map((a) => (a.action as { face?: number }).face ?? 0)).toEqual([1]); // the Adventure face only
    s = resolveAll(settle(act(s, casts[0]!.action)));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
    const onAdventure = exiledId(s, 'Test Knight // Test Whisper');
    expect(s.objects[onAdventure]!.chosen?.onAdventure).toBe(true);
    expect(castable(s, onAdventure)).toBe(true);
  });
});

describe('CR 715.3, 715.3a, 601.3: the Adventure-only permission beside a graveyard permission that covers the creature face', () => {
  const KNIGHT = compileCard({
    name: 'Test Knight // Test Whisper', layout: 'adventure', mana_cost: '{0} // {0}', type_line: 'Creature — Human Knight // Sorcery — Adventure', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Knight', mana_cost: '{0}', type_line: 'Creature — Human Knight', oracle_text: 'When this creature dies, you may cast it from your graveyard as an Adventure until the end of your next turn.', power: '2', toughness: '2' },
      { name: 'Test Whisper', mana_cost: '{0}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' },
    ],
  } as unknown as OracleCard);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const CRYPT = card('Test Crypt', 'Enchantment', 'You may cast creature spells from your graveyard.');
  it('the creature face is cast by the graveyard permission, the Adventure by either', () => {
    expect(noManual(CRYPT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Knight // Test Whisper', 'Test Crypt'] }, defs: [KNIGHT, KILL, CRYPT] });
    const knight = find(s0, 'Test Knight // Test Whisper', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Kill', { targets: [[obj(knight)]] }));
    const inYard = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Knight // Test Whisper')!;
    const faces = legal(s, 'p1').filter((a) => (a.action as { card?: ObjectId }).card === inYard).map((a) => (a.action as { face?: number }).face ?? 0);
    expect(sorted(faces.map(String))).toEqual(['0', '1']);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: inYard, face: 0 } as never)));
    expect(battlefieldNames(s, 'p1')).toContain('Test Knight // Test Whisper');
  });
});

describe('CR 400.7, 120.3, 109.2: "Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its power to each other creature."', () => {
  const GREED = card('Test Greed', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its power to each other creature.');
  it('fails closed: a target handle still names the card it was (effects/refs.ts#rebase), so "each other creature" could not leave out the permanent it became', () => {
    expect(noManual(GREED)).toBe(false);
  });
});

describe('CR 608.2h, 701.20a: "Destroy target land. Its controller reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard."', () => {
  const EVIDENCE = card('Test Evidence', 'Sorcery', 'Destroy target land. Its controller reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.');
  it('the destroyed land\'s last controller reveals and mills', () => {
    expect(noManual(EVIDENCE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Evidence'], library: ['Test Trail'] }, p2: { battlefield: ['Test Forest'], library: ['Test Rock', 'Test Trail', 'Test Gem'] }, defs: [EVIDENCE, FOREST, TRAIL, ROCK, GEM] });
    const forest = find(s0, 'Test Forest', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Evidence', { targets: [[obj(forest)]] }));
    expect(sorted(yard(s, 'p2'))).toEqual(['Test Forest', 'Test Rock', 'Test Trail']);
    expect(lib(s, 'p2')[0]).toBe('Test Gem');
    expect(lib(s, 'p1')[0]).toBe('Test Trail'); // you reveal nothing
  });
});

describe('CR 608.2d, 701.23a: "An opponent chooses two of those cards" when the search found fewer than two', () => {
  const TEACH = card('Test Teaching', 'Instant', 'Search your library for up to three artifact cards with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped, then shuffle.');
  it('with one card found, that card is chosen (there is no choice) and nothing enters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Teaching'], library: ['Test Rock', 'Test Bear'] }, defs: [TEACH, ROCK, BEAR] });
    const rock = libId(s0, 'Test Rock');
    const s = resolveAll(cast(s0, 'Test Teaching'), { picks: [[rock]] });
    expect(yard(s)).toContain('Test Rock');
    expect(battlefieldNames(s, 'p1')).toEqual([]);
  });
});

describe('CR 611.2c, 122.6, 714.3c: "Exile the top card of your library. During any turn you put a lore counter on this Saga, you may play that card."', () => {
  const SAGA = card('Test Saga', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Exile the top card of your library. During any turn you put a lore counter on this Saga, you may play that card.\nII, III — You gain 1 life.');
  it('is understood: a permission with no end whose condition is the turn\'s history of lore counters you put on this Saga', () => {
    expect(noManual(SAGA)).toBe(true);
    const j = JSON.stringify(SAGA.faces[0]!.abilities);
    expect(j).toContain('"while":{"cond":"happened","event":{"ev":"counters","change":"put","kind":"lore","on":{"is":{"ref":"self"}},"by":"you"},"scope":"turn"}');
  });
  it('the card may be played in the turns a lore counter goes on the Saga (chapters I and II), not in a turn none does, and not after the Saga is gone', () => {
    let s = scenario([], { p1: { hand: ['Test Saga'], library: ['Test Rock', 'Test Gem', 'Test Idol', 'Test Bear'] }, defs: [SAGA, ROCK, GEM, IDOL, BEAR] });
    s = resolveAll(cast(s, 'Test Saga'));
    const rock = exiledId(s, 'Test Rock');
    expect(rock).toBeDefined();
    expect(castable(s, rock)).toBe(true); // the counter of chapter I was put this turn
    s = advanceTo(s, 2, 'main1'); // the opponent's turn: no lore counter
    expect(castable(s, rock, 'p1')).toBe(false);
    s = advanceTo(s, 3, 'main1'); // your precombat main phase: the lore counter of chapter II (CR 714.3c)
    s = resolveAll(s);
    expect(castable(s, rock)).toBe(true);
    s = advanceTo(s, 5, 'main1'); // chapter III, then the Saga is sacrificed (CR 714.4)
    s = resolveAll(s);
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Saga');
    expect(castable(s, rock)).toBe(true); // a lore counter was put on it this turn
    s = advanceTo(s, 7, 'main1');
    expect(castable(s, rock)).toBe(false); // no Saga, no lore counter
  });
});
