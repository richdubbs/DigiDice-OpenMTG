/**
 * Standard round 4, slice r4-dig (library digs and impulse play): the templates of parser/templates/zz-cloud/r4-dig.json and the parser, renderer and engine support
 * they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named
 * after the rule it checks.
 *
 *   CR 107.3, 608.2h, 611.2c   "Exile the top X cards of your library, where X is ...", "Target player exiles the top X cards of their library, where X is ...",
 *                              "Reveal the top X cards ...", "mill cards equal to ..."
 *   CR 608.2c, 611.2c, 400.7   "If you do, exile the top X cards ... You may play those cards this turn.": the permission joins the "if" branch; X read with last
 *                              known information after the object left (CR 608.2h)
 *   CR 701.17a, 603.2          "Whenever a player loses life, that player mills that many cards."
 *   CR 701.20a-b, 107.3        "Reveal cards from the top of your library until you reveal X permanent cards, where X is ... Put any number of those permanent
 *                              cards onto the battlefield, then put the rest of the revealed cards on the bottom of your library in a random order." (op revealUntil
 *                              with a computed count)
 *   CR 608.2c, 611.2c          "Exile the top two cards of your library. Choose one of them. Until end of turn, you may play that card." (the chosen card only)
 *   CR 701.23a, 201.2, 305.6   searches: "a card named A or B", "a land card with a basic land type", "a basic land card or a Desert card, ... then shuffle and put
 *                              it on top", "up to X basic land cards with different names"
 *   CR 611.2c, 400.7           "You may play that card from exile this turn."
 *   CR 701.20a, 701.20e        "reveal the top card of your library and put it into your hand"; "You may reveal up to two creature cards from among them and put
 *                              them into your hand"; "Put up to two ... from among them onto the battlefield"; "exile two of them face down, then put the rest on
 *                              the bottom of their library in a random order"
 *   CR 701.17a, 608.2d         "Mill four cards. You may put up to two creature and/or land cards from among the milled cards into your hand."
 *   CR 404.1, 608.2d           "return an artifact card or a creature card from your graveyard to your hand"; "exile a card from a graveyard"
 *   CR 701.20a, 402.3          "you may reveal a Wizard card from your hand. If you do, ..."; "Target player reveals X cards from their hand, where X is ..."
 *   CR 701.8a, 608.2c          "Choose target creature. Mill two cards, then destroy the chosen creature if its mana value is less than or equal to ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, battlefieldNames, find, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
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
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), opts);
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
/** Go to the declare attackers step of the current turn and attack with the named creatures of p1 (each attacks p2). */
function attackWith(s0: GameState, names: string[], opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, opts);
  s = answer(s, { kind: 'declareAttackers', attacks: names.map((n) => ({ attacker: find(s, n, 'battlefield', 'p1'), defender: 'p2' })) } as DecisionAnswer);
  return settle(s, opts);
}
const lib = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'library', p);
const hand = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'hand', p);
const yard = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
const exiledIds = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
/** Can p1 cast (or play) this card from where it is now? */
const castable = (s: GameState, id: ObjectId): boolean => legal(s, 'p1').some((a) => (a.action as { card?: ObjectId }).card === id);
const sorted = (xs: string[]): string[] => [...xs].sort();

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{0}' });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{0}' });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{0}' });
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'], cost: '{0}' });
const ROCK = card('Test Rock', 'Artifact', '', { cost: '{0}' });
const TRAIL = card('Test Trail', 'Land', '');
const FOREST = card('Test Forest', 'Land — Forest', '');
const DUNES = card('Test Dunes', 'Land — Desert', '');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 1 damage to any target.', { cost: '{0}' });

describe('CR 107.3, 608.2h, 611.2c: "Exile the top X cards of your library, where X is .... You may play those cards this turn."', () => {
  const RUSH = card('Test Rush', 'Sorcery', 'Exile the top X cards of your library, where X is the number of Elves you control. You may play those cards this turn.');
  it('is understood: X is substituted into the top-cards count and the permission names what the move exiled', () => {
    expect(noManual(RUSH)).toBe(true);
    const steps = JSON.stringify(RUSH.faces[0]!.abilities[0]);
    expect(steps).toContain('"count":{"q":"count"');
    expect(steps).toContain('"s":"permit"');
  });
  it('X is the number of Elves as the spell resolves: two Elves exile two cards, and both may be played this turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rush'], battlefield: ['Test Elf', 'Test Elf'], library: ['Test Bear', 'Test Ogre', 'Test Rock'] }, defs: [RUSH, ELF, BEAR, OGRE, ROCK] });
    const s = resolveAll(cast(s0, 'Test Rush'));
    expect(sorted(exiled(s))).toEqual(['Test Bear', 'Test Ogre']);
    expect(lib(s)[0]).toBe('Test Rock');
    expect(castable(s, exiledIds(s, 'Test Bear')[0]!)).toBe(true);
    expect(castable(s, exiledIds(s, 'Test Ogre')[0]!)).toBe(true);
  });
});

describe('CR 107.3, 608.2h: "Target player exiles the top X cards of their library, where X is the number of cards in your hand."', () => {
  const MILL = card('Test Erasure', 'Sorcery', 'Target player exiles the top X cards of their library, where X is the number of cards in your hand.');
  it('the target player\'s top cards are exiled, as many as the cards in your hand as it resolves', () => {
    expect(noManual(MILL)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Erasure', 'Test Rock', 'Test Rock', 'Test Rock'] }, p2: { library: ['Test Bear', 'Test Ogre', 'Test Elf', 'Test Trail'] }, defs: [MILL, ROCK, BEAR, OGRE, ELF, TRAIL] });
    const s = resolveAll(cast(s0, 'Test Erasure', { targets: [[player('p2')]] }));
    expect(sorted(exiled(s))).toEqual(['Test Bear', 'Test Elf', 'Test Ogre']);
    expect(lib(s, 'p2')[0]).toBe('Test Trail');
  });
});

describe('CR 608.2c, 611.2c, 608.2h: "Then you may sacrifice it. If you do, exile the top X cards ..., where X is the number of +1/+1 counters on ~. You may play those cards this turn."', () => {
  const ROAST = card('Test Roaster', 'Creature — Elemental', 'Whenever ~ attacks, put a +1/+1 counter on ~. Then you may sacrifice it. If you do, exile the top X cards of your library, where X is the number of +1/+1 counters on ~. You may play those cards this turn.', { pt: ['1', '1'] });
  it('is understood: the permission joins the "If you do" branch (the cards exist only if the creature was sacrificed)', () => {
    expect(noManual(ROAST)).toBe(true);
    const json = JSON.stringify(ROAST.faces[0]!.abilities);
    expect(json).toMatch(/"op":"if".*"then":\[.*"op":"move".*"s":"permit"/);
  });
  it('CR 608.2h: sacrificed, X is the counters it had as it left (last known information): one card is exiled and may be played', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Roaster'], library: ['Test Bear', 'Test Ogre'] }, defs: [ROAST, BEAR, OGRE] });
    const s = attackWith(s0, ['Test Roaster'], { answers: [yes] });
    const done = resolveAll(s, { answers: [yes] });
    expect(battlefieldNames(done, 'p1')).not.toContain('Test Roaster');
    expect(exiled(done)).toEqual(['Test Bear']);
    expect(castable(done, exiledIds(done, 'Test Bear')[0]!)).toBe(false); // combat: a creature spell only at sorcery speed (CR 307.1, 601.3)
  });
  it('CR 608.2c: declined, nothing is exiled and no permission is created', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Roaster'], library: ['Test Bear', 'Test Ogre'] }, defs: [ROAST, BEAR, OGRE] });
    const done = resolveAll(attackWith(s0, ['Test Roaster'], { answers: [no] }), { answers: [no] });
    expect(battlefieldNames(done, 'p1')).toContain('Test Roaster');
    expect(exiled(done)).toEqual([]);
  });
});

describe('CR 701.17a, 603.2: "Whenever a player loses life, that player mills that many cards."', () => {
  const LAKE = card('Test Lakewarden', 'Creature — Human', 'Whenever a player loses life, that player mills that many cards.', { pt: ['1', '1'] });
  it('the player who lost 2 life mills two cards', () => {
    expect(noManual(LAKE)).toBe(true);
    const SPIKE = card('Test Spike', 'Sorcery', 'Target player loses 2 life.');
    const s0 = scenario([], { p1: { hand: ['Test Spike'], battlefield: ['Test Lakewarden'] }, p2: { library: ['Test Bear', 'Test Ogre', 'Test Elf'] }, defs: [LAKE, SPIKE, BEAR, OGRE, ELF] });
    const s = resolveAll(cast(s0, 'Test Spike', { targets: [[player('p2')]] }));
    expect(life(s, 'p2')).toBe(18);
    expect(sorted(yard(s, 'p2'))).toEqual(['Test Bear', 'Test Ogre']);
    expect(lib(s, 'p2')[0]).toBe('Test Elf');
  });
});

describe('CR 701.20a-b, 107.3, 401.4: "Reveal cards ... until you reveal X permanent cards, where X is .... Put any number of those permanent cards onto the battlefield, then put the rest of the revealed cards on the bottom ..."', () => {
  const WAKE = card('Test Awakening', 'Sorcery', 'Reveal cards from the top of your library until you reveal X permanent cards, where X is the number of Elves you control. Put any number of those permanent cards onto the battlefield, then put the rest of the revealed cards on the bottom of your library in a random order.');
  it('is understood: one revealUntil with a computed count', () => {
    expect(noManual(WAKE)).toBe(true);
    expect(JSON.stringify(WAKE.faces[0]!.abilities)).toContain('"op":"revealUntil"');
  });
  it('two Elves: the reveal stops at the second permanent card; the chosen ones enter, the rest of the revealed cards go to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Awakening'], battlefield: ['Test Elf', 'Test Elf'], library: ['Test Shock', 'Test Rock', 'Test Bear', 'Test Ogre'] }, defs: [WAKE, ELF, SHOCK, ROCK, BEAR, OGRE] });
    let s = cast(s0, 'Test Awakening');
    s = settle(pass(pass(s)));
    expect(s.pending?.kind).toBe('chooseObjects');
    const bear = find(s, 'Test Bear', 'library', 'p1');
    s = resolveAll(settle(s, { picks: [[bear]] }));
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Rock');
    expect(lib(s)[0]).toBe('Test Ogre'); // never revealed: the reveal stopped at the bear
    expect(sorted(lib(s).slice(-2))).toEqual(['Test Rock', 'Test Shock']);
  });
});

describe('CR 608.2c, 611.2c: "Exile the top two cards of your library. Choose one of them. Until end of turn, you may play that card."', () => {
  const PICK = card('Test Pick', 'Sorcery', 'Exile the top two cards of your library. Choose one of them. Until end of turn, you may play that card.');
  it('only the chosen card may be played', () => {
    const s0 = scenario([], { p1: { hand: ['Test Pick'], library: ['Test Bear', 'Test Ogre'] }, defs: [PICK, BEAR, OGRE] });
    let s = settle(pass(pass(cast(s0, 'Test Pick'))));
    const ogre = exiledIds(s, 'Test Ogre')[0]!;
    s = resolveAll(settle(s, { picks: [[ogre]] }));
    expect(castable(s, ogre)).toBe(true);
    expect(castable(s, exiledIds(s, 'Test Bear')[0]!)).toBe(false);
  });
});

describe('CR 701.23a, 201.2: "Search your library for a card named A or B, reveal it, put it into your hand, then shuffle."', () => {
  const CALL = card('Test Call', 'Sorcery', 'Search your library for a card named Test Bear or Test Ogre, reveal it, put it into your hand, then shuffle.');
  it('only a card with one of the two names can be found', () => {
    expect(noManual(CALL)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Call'], library: ['Test Elf', 'Test Ogre', 'Test Bear'] }, defs: [CALL, ELF, OGRE, BEAR] });
    let s = settle(pass(pass(cast(s0, 'Test Call'))));
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = (s.pending as { options?: ObjectId[]; candidates?: ObjectId[] }).options ?? (s.pending as { candidates?: ObjectId[] }).candidates ?? [];
    expect(sorted(options.map((id) => s.objects[id]!.defId))).toEqual(['Test Bear', 'Test Ogre']);
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Ogre', 'library', 'p1')]] }));
    expect(hand(s)).toEqual(['Test Ogre']);
  });
});

describe('CR 701.23a, 205.3i, 305.6: "Search your library for a land card with a basic land type, reveal it, put it into your hand, then shuffle."', () => {
  const GARDEN = card('Test Gardening', 'Sorcery', 'Search your library for a land card with a basic land type, reveal it, put it into your hand, then shuffle.');
  it('a land with a basic land type can be found, a land with none cannot', () => {
    expect(noManual(GARDEN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Gardening'], library: ['Test Trail', 'Test Forest', 'Test Dunes'] }, defs: [GARDEN, TRAIL, FOREST, DUNES] });
    const s = settle(pass(pass(cast(s0, 'Test Gardening'))));
    const options = (s.pending as { options?: ObjectId[] }).options ?? [];
    const names = options.map((id) => s.objects[id]!.defId);
    expect(names).toContain('Test Forest');
    expect(names).not.toContain('Test Trail');
    expect(names).not.toContain('Test Dunes');
  });
});

describe('CR 701.23a, 701.24a, 401.4: "Search your library for a basic land card or a Desert card, reveal it, then shuffle and put it on top."', () => {
  const TOP = card('Test Prospect', 'Sorcery', 'Search your library for a Forest card or a Desert card, reveal it, then shuffle and put it on top.');
  it('the found card is on top of the library after the shuffle', () => {
    expect(noManual(TOP)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Prospect'], library: ['Test Trail', 'Test Bear', 'Test Dunes', 'Test Ogre'] }, defs: [TOP, TRAIL, BEAR, DUNES, OGRE] });
    let s = settle(pass(pass(cast(s0, 'Test Prospect'))));
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Dunes', 'library', 'p1')]] }));
    expect(lib(s)[0]).toBe('Test Dunes');
  });
});

describe('CR 611.2c, 400.7: "Whenever ~ attacks, exile the top card of your library. You may play that card from exile this turn."', () => {
  const RAID = card('Test Raider', 'Creature — Human', 'Whenever ~ attacks, exile the top card of your library. You may play that card from exile this turn.', { pt: ['2', '2'] });
  it('the exiled card may be played this turn (a land, after combat in the second main phase)', () => {
    expect(noManual(RAID)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Raider'], library: ['Test Trail', 'Test Bear'] }, defs: [RAID, TRAIL, BEAR] });
    let s = resolveAll(attackWith(s0, ['Test Raider']));
    const trail = exiledIds(s, 'Test Trail')[0]!;
    expect(trail).toBeDefined();
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(legal(s, 'p1').some((a) => (a.action as { card?: ObjectId }).card === trail)).toBe(true);
  });
});

describe('CR 701.20a: "Whenever ~ attacks, reveal the top card of your library and put it into your hand."', () => {
  const SCOUT = card('Test Scout', 'Creature — Human', 'Whenever ~ attacks, reveal the top card of your library and put it into your hand.', { pt: ['2', '2'] });
  it('the top card goes to the hand (the revealed card, never the attacking creature)', () => {
    expect(noManual(SCOUT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Scout'], library: ['Test Ogre', 'Test Bear'] }, defs: [SCOUT, OGRE, BEAR] });
    const s = resolveAll(attackWith(s0, ['Test Scout']));
    expect(hand(s)).toEqual(['Test Ogre']);
    expect(battlefieldNames(s, 'p1')).toContain('Test Scout');
  });
});

describe('CR 701.20a, 701.20e, 401.4: "Look at the top four cards .... You may reveal up to two creature cards from among them and put them into your hand. Put the rest ..."', () => {
  const DIG = card('Test Pictures', 'Sorcery', 'Look at the top four cards of your library. You may reveal up to two creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.');
  it('two creature cards go to the hand, the other two to the bottom', () => {
    expect(noManual(DIG)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Pictures'], library: ['Test Bear', 'Test Rock', 'Test Ogre', 'Test Trail', 'Test Elf'] }, defs: [DIG, BEAR, ROCK, OGRE, TRAIL, ELF] });
    let s = settle(pass(pass(cast(s0, 'Test Pictures'))));
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Bear', 'library', 'p1'), find(s, 'Test Ogre', 'library', 'p1')]] }));
    expect(sorted(hand(s))).toEqual(['Test Bear', 'Test Ogre']);
    expect(lib(s)[0]).toBe('Test Elf');
    expect(sorted(lib(s).slice(-2))).toEqual(['Test Rock', 'Test Trail']);
  });
});

describe('CR 701.20e, 608.2d: "Look at the top five cards .... Put up to two artifact cards from among them onto the battlefield. Put the rest ..."', () => {
  const FRONT = card('Test Front', 'Sorcery', 'Look at the top five cards of your library. Put up to two noncreature, nonland permanent cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.');
  it('a creature card cannot be chosen; the chosen artifact enters under your control', () => {
    expect(noManual(FRONT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Front'], library: ['Test Bear', 'Test Rock', 'Test Trail'] }, defs: [FRONT, BEAR, ROCK, TRAIL] });
    let s = settle(pass(pass(cast(s0, 'Test Front'))));
    const options = ((s.pending as { options?: ObjectId[] }).options ?? []).map((id) => s.objects[id]!.defId);
    expect(options).toEqual(['Test Rock']);
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Rock', 'library', 'p1')]] }));
    expect(battlefieldNames(s, 'p1')).toContain('Test Rock');
  });
});

describe('CR 701.17a, 608.2d: "Mill four cards. You may put up to two creature and/or land cards from among the milled cards into your hand."', () => {
  const SURPRISE = card('Test Surprise', 'Sorcery', 'Mill four cards. You may put up to two creature and/or land cards from among the milled cards into your hand.');
  it('a creature card and a land card milled go to the hand; the artifact stays in the graveyard', () => {
    expect(noManual(SURPRISE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Surprise'], library: ['Test Bear', 'Test Rock', 'Test Trail', 'Test Ogre'] }, defs: [SURPRISE, BEAR, ROCK, TRAIL, OGRE] });
    let s = settle(pass(pass(cast(s0, 'Test Surprise'))));
    const options = ((s.pending as { options?: ObjectId[] }).options ?? []).map((id) => s.objects[id]!.defId);
    expect(options).not.toContain('Test Rock');
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Bear', 'graveyard', 'p1'), find(s, 'Test Trail', 'graveyard', 'p1')]] }));
    expect(sorted(hand(s))).toEqual(['Test Bear', 'Test Trail']);
    expect(sorted(yard(s))).toEqual(['Test Ogre', 'Test Rock', 'Test Surprise']);
  });
});

describe('CR 404.1, 608.2d: "mill four cards, then you may return an artifact card or a creature card from your graveyard to your hand"', () => {
  const LORD = card('Test Overseer', 'Sorcery', 'Mill two cards, then you may return an artifact card or a land card from your graveyard to your hand.');
  it('an artifact or land card can be returned; a creature card cannot', () => {
    expect(noManual(LORD)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Overseer'], graveyard: ['Test Trail'], library: ['Test Bear', 'Test Rock'] }, defs: [LORD, BEAR, ROCK, TRAIL] });
    let s = settle(pass(pass(cast(s0, 'Test Overseer'))), { answers: [yes] });
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = ((s.pending as { options?: ObjectId[] }).options ?? []).map((id) => s.objects[id]!.defId);
    expect(sorted(options)).toEqual(['Test Rock', 'Test Trail']);
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Rock', 'graveyard', 'p1')]] }));
    expect(hand(s)).toEqual(['Test Rock']);
    expect(yard(s)).toContain('Test Bear');
  });
});

describe('CR 404.1, 406.1: "Surveil 2, then exile a card from a graveyard."', () => {
  const CLEAN = card('Test Cleanse', 'Sorcery', 'Exile a card from a graveyard.');
  it('a card of any graveyard can be exiled', () => {
    expect(noManual(CLEAN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Cleanse'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Ogre'] }, defs: [CLEAN, BEAR, OGRE] });
    let s = settle(pass(pass(cast(s0, 'Test Cleanse'))));
    const options = ((s.pending as { options?: ObjectId[] }).options ?? []).map((id) => s.objects[id]!.defId);
    expect(sorted(options)).toEqual(['Test Bear', 'Test Ogre']);
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Ogre', 'graveyard', 'p2')]] }));
    expect(exiled(s)).toEqual(['Test Ogre']);
  });
});

describe('CR 701.20a, 402.3, 608.2c: "When ~ enters, you may reveal a Wizard card from your hand. If you do, draw a card."', () => {
  const ADEPT = card('Test Adept', 'Creature — Human', 'When ~ enters, you may reveal a Wizard card from your hand. If you do, draw a card.', { pt: ['1', '1'] });
  it('with a Wizard card in hand, revealing it draws a card', () => {
    expect(noManual(ADEPT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Adept', 'Test Wizard'], library: ['Test Ogre'] }, defs: [ADEPT, WIZARD, OGRE] });
    let s = settle(pass(pass(cast(s0, 'Test Adept'))));
    s = resolveAll(s, { answers: [yes], picks: [[find(s, 'Test Wizard', 'hand', 'p1')]] });
    expect(sorted(hand(s))).toEqual(['Test Ogre', 'Test Wizard']);
  });
});

describe('CR 701.20a, 402.3, 107.3: "Target player reveals X cards from their hand, where X is the number of cards in your graveyard."', () => {
  const PEEK = card('Test Peek', 'Sorcery', 'Target player reveals X cards from their hand, where X is the number of cards in your graveyard.');
  it('is understood (the target player chooses X cards of their hand and reveals them)', () => {
    expect(noManual(PEEK)).toBe(true);
    const json = JSON.stringify(PEEK.faces[0]!.abilities);
    expect(json).toContain('"op":"chooseObjects"');
    expect(json).toContain('"op":"reveal"');
  });
});

describe('CR 701.8a, 608.2c: "Choose target creature. Mill two cards, then destroy the chosen creature if its mana value is less than or equal to the number of cards in your graveyard."', () => {
  const FEAST = card('Test Feast', 'Instant', 'Choose target creature. Mill two cards, then destroy the chosen creature if its mana value is less than or equal to the number of cards in your graveyard.');
  const BIG = card('Test Titan', 'Creature — Giant', '', { pt: ['6', '6'], cost: '{6}' });
  it('mana value 0 is destroyed (two cards in the graveyard)', () => {
    expect(noManual(FEAST)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Feast'], library: ['Test Rock', 'Test Rock'] }, p2: { battlefield: ['Test Bear'] }, defs: [FEAST, ROCK, BEAR] });
    const s = resolveAll(cast(s0, 'Test Feast', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }));
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Bear');
  });
  it('mana value 6 survives (only two cards in the graveyard)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Feast'], library: ['Test Rock', 'Test Rock'] }, p2: { battlefield: ['Test Titan'] }, defs: [FEAST, ROCK, BIG] });
    const s = resolveAll(cast(s0, 'Test Feast', { targets: [[obj(find(s0, 'Test Titan', 'battlefield', 'p2'))]] }));
    expect(battlefieldNames(s, 'p2')).toContain('Test Titan');
    expect(yard(s).filter((n) => n === 'Test Rock')).toHaveLength(2);
  });
});

describe('CR 701.20e, 406.3, 401.4: "look at the top four cards of target opponent\'s library, exile two of them face down, then put the rest on the bottom of their library in a random order"', () => {
  const CAT = card('Test Cat', 'Creature — Cat', "When ~ enters, look at the top four cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in a random order.", { pt: ['2', '2'] });
  it('two of the opponent\'s cards are exiled face down; the other two go to the bottom of that library', () => {
    expect(noManual(CAT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Cat'] }, p2: { library: ['Test Bear', 'Test Ogre', 'Test Elf', 'Test Rock', 'Test Trail'] }, defs: [CAT, BEAR, OGRE, ELF, ROCK, TRAIL] });
    let s = settle(pass(pass(cast(s0, 'Test Cat'))), { targets: [[player('p2')]] });
    s = settle(pass(pass(s)), { targets: [[player('p2')]] });
    s = resolveAll(settle(s, { picks: [[find(s, 'Test Bear', 'library', 'p2'), find(s, 'Test Elf', 'library', 'p2')]] }));
    expect(sorted(exiled(s))).toEqual(['Test Bear', 'Test Elf']);
    expect(s.zones.exile.every((id) => s.objects[id]!.faceDown)).toBe(true);
    expect(lib(s, 'p2')[0]).toBe('Test Trail');
    expect(sorted(lib(s, 'p2').slice(-2))).toEqual(['Test Ogre', 'Test Rock']);
  });
});

describe('CR 701.20a, 708.2, 701.34: "{0}: Reveal target face-down permanent. If it\'s a creature card, you may turn it face up."', () => {
  const SHRIEK = card('Test Shrieker', 'Creature — Beast', "{0}: Reveal target face-down permanent. If it's a creature card, you may turn it face up.", { pt: ['3', '3'] });
  const MANIFEST = card('Test Manifest', 'Sorcery', 'Manifest the top card of your library.');
  const activate = (s0: GameState, target: ObjectId, answers: DecisionAnswer[] = []): GameState => {
    const a = legal(s0, 'p1').find((x) => x.kind === 'activate' && (x.action as { source?: ObjectId }).source === find(s0, 'Test Shrieker', 'battlefield', 'p1'))!;
    return resolveAll(settle(act(s0, a.action as never), { targets: [[obj(target)]] }), { answers });
  };
  it('a manifested creature card is turned face up (the card is a creature card, CR 708.2: not its face-down characteristics)', () => {
    expect(noManual(SHRIEK)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Manifest'], battlefield: ['Test Shrieker'], library: ['Test Ogre'] }, defs: [SHRIEK, MANIFEST, OGRE] });
    const s1 = resolveAll(cast(s0, 'Test Manifest'));
    const fd = s1.zones.battlefield.find((id) => s1.objects[id]!.faceDown)!;
    expect(fd).toBeDefined();
    const s = activate(s1, fd, [yes]);
    expect(s.objects[fd]?.faceDown).toBe(false);
  });
  it('a manifested land card is not a creature card: it stays face down (CR 708.2, 701.34g)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Manifest'], battlefield: ['Test Shrieker'], library: ['Test Trail'] }, defs: [SHRIEK, MANIFEST, TRAIL] });
    const s1 = resolveAll(cast(s0, 'Test Manifest'));
    const fd = s1.zones.battlefield.find((id) => s1.objects[id]!.faceDown)!;
    const s = activate(s1, fd, [yes]);
    expect(s.objects[fd]?.faceDown).toBe(true);
  });
});

describe('CR 601.2a, 608.2n, 712.14a, 702.34a: "If this spell was cast from a graveyard, exile it, then put it onto the battlefield transformed under its owner\'s control with a finality counter on it."', () => {
  const FRONT = { name: 'Test Origins', mana_cost: '{0}', type_line: 'Sorcery', oracle_text: "Draw a card. If this spell was cast from a graveyard, exile it, then put it onto the battlefield transformed under its owner's control with a finality counter on it.\nFlashback {0}", colors: [] };
  const BACK = { name: 'Test Summoned', mana_cost: '', type_line: 'Enchantment Creature — Spirit', oracle_text: '', power: '2', toughness: '2', colors: [] };
  const ORIGINS: CardDef = compileCard({ name: 'Test Origins // Test Summoned', layout: 'transform', mana_cost: '{0}', type_line: 'Sorcery // Enchantment Creature — Spirit', colors: [], card_faces: [FRONT, BACK] } as unknown as OracleCard);
  it('is understood', () => expect(noManual(ORIGINS)).toBe(true));
  it('cast from the hand: the spell goes to the graveyard as it resolves (CR 608.2n)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Origins // Test Summoned'], library: ['Test Bear'] }, defs: [ORIGINS, BEAR] });
    const s = resolveAll(cast(s0, 'Test Origins // Test Summoned'));
    expect(yard(s)).toEqual(['Test Origins // Test Summoned']);
    expect(hand(s)).toEqual(['Test Bear']);
  });
  it('cast from the graveyard (flashback): it enters transformed with a finality counter, under its owner\'s control', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Origins // Test Summoned'], library: ['Test Bear'] }, defs: [ORIGINS, BEAR] });
    const id = find(s0, 'Test Origins // Test Summoned', 'graveyard', 'p1');
    const la = legal(s0, 'p1').find((a) => (a.action as { card?: ObjectId }).card === id)!;
    expect(la).toBeDefined();
    const s = resolveAll(settle(act(s0, la.action)));
    const bf = find(s, 'Test Origins // Test Summoned', 'battlefield', 'p1');
    expect(s.objects[bf]!.face).toBe(1);
    expect(s.objects[bf]!.counters['finality']).toBe(1);
    expect(s.objects[bf]!.controller).toBe('p1');
    expect(hand(s)).toEqual(['Test Bear']);
    expect(yard(s)).toEqual([]);
  });
});

describe('CR 115.1, 601.2c, 701.25a: "Choose target spell. Surveil 1, then counter the chosen spell."', () => {
  const SWALLOW = card('Test Swallow', 'Instant', 'Choose target spell. Surveil 1, then counter the chosen spell.');
  it('the spell chosen as a target is countered', () => {
    expect(noManual(SWALLOW)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Shock'] }, p2: { hand: ['Test Swallow'] }, defs: [SWALLOW, SHOCK] });
    let s = cast(s0, 'Test Shock', { targets: [[player('p2')]] });
    s = pass(s); // p1 passes; p2 may respond
    const shock = s.zones.stack[0]!;
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Swallow', 'hand', 'p2') }), { targets: [[obj(shock)]] });
    s = resolveAll(s, { picks: [[]] });
    expect(life(s, 'p2')).toBe(20);
    expect(yard(s)).toContain('Test Shock');
  });
});

describe('CR 701.23a, 201.2, 107.3m: "When ~ enters, search your library for up to X basic land cards with different names, reveal them, put them into your hand, then shuffle."', () => {
  const PLAINS = card('Test Plains', 'Basic Land — Plains', '');
  const ISLAND = card('Test Island', 'Basic Land — Island', '');
  const FINDER = card('Test Finder', 'Sorcery', 'Search your library for up to two basic land cards with different names, reveal them, put them into your hand, then shuffle.');
  it('two basic lands with different names are found; two of the same name cannot both be', () => {
    expect(noManual(FINDER)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Finder'], library: ['Test Plains', 'Test Plains', 'Test Island'] }, defs: [FINDER, PLAINS, ISLAND] });
    let s = settle(pass(pass(cast(s0, 'Test Finder'))));
    const ps = s.zones.library.p1!.filter((id) => s.objects[id]!.defId === 'Test Plains');
    // the cards are found one at a time (CR 701.23a); after a Plains, the other Plains is no longer one of the options (different names, CR 201.2)
    s = settle(s, { picks: [[ps[0]!]] });
    if (s.pending?.kind === 'chooseObjects') {
      const options = (s.pending as { options?: ObjectId[] }).options ?? [];
      expect(options).not.toContain(ps[1]);
      s = settle(s, { picks: [[find(s, 'Test Island', 'library', 'p1')]] });
    }
    s = resolveAll(s);
    expect(sorted(hand(s))).toEqual(['Test Island', 'Test Plains']);
  });
});
