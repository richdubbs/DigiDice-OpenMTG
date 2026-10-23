/**
 * Standard round 3, slice r3-dig (library digs and impulse play, tuning half): the templates of parser/templates/zz-cloud/r3-dig.json and the parser, renderer and
 * engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10).
 * Each test is named after the rule it checks.
 *
 *   CR 701.20a-b, 401.4, 608.2c  "Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom
 *                                of your library in a random order." (op revealUntil; also onto the battlefield tapped, and "two ... cards" / "those cards")
 *   CR 701.20a, 110.2            "... until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest ..." (hole TypedThose)
 *   CR 608.2c, 701.20a           "Whenever another nontoken creature you control dies, you may reveal cards ... Put that card into your hand ...": "that card" is the card
 *                                revealed, never the creature that died (the focus rule), and a declined option names nothing
 *   CR 608.2c, 608.2b, 611.2c    "Whenever ~ attacks, you may exile the top card of your library. You may play that card this turn." (the option's name is bound to
 *                                nothing when it is declined)
 *   CR 608.2d, 406.1, 400.7      "Exile a card at random from your graveyard. You may play that card this turn."
 *   CR 701.20e, 608.2d, 202.3    "Look at the top N cards ... Put up to two creature cards with total mana value 5 or less from among them onto the battlefield and the
 *                                rest on the bottom of your library in a random order."
 *   CR 701.20e, 608.2d, 701.24a  "Look at the top N cards of your library, put any number of land cards from among them onto the battlefield tapped, then shuffle."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, battlefieldNames, find, legal, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
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
/** Can p1 cast (or play) this card from where it is now? */
const castable = (s: GameState, id: ObjectId): boolean => legal(s, 'p1').some((a) => (a.action as { card?: ObjectId }).card === id);
const sorted = (xs: string[]): string[] => [...xs].sort();

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{2}{R}' });
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{4}{R}' });
const ROCK = card('Test Rock', 'Artifact', '', { cost: '{1}' });
const TRAIL = card('Test Trail', 'Land', '');

describe('CR 701.20a-b, 401.4, 608.2c: "Reveal cards ... until you reveal a creature card. Put that card into your hand and the rest on the bottom ..." (op revealUntil)', () => {
  const DIG = card('Test Seek', 'Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.');
  it('is understood: one revealUntil step, then the move of the card it stopped at and the move of the rest', () => {
    expect(noManual(DIG)).toBe(true);
    const steps = (DIG.faces[0]!.abilities[0] as { effect: { steps: { op: string; what?: unknown }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['revealUntil', 'move', 'move']);
    expect(steps[1]!.what).toEqual({ ref: 'bound', name: 'hit' });
    expect(JSON.stringify(steps[2]!.what)).toContain('"not":{"is":{"ref":"bound","name":"hit"}}');
  });
  it('CR 701.20a, 401.4: the first creature card goes to the hand, the cards revealed before it to the bottom; the cards below it stay on top', () => {
    const s0 = scenario([], { p1: { hand: ['Test Seek'], library: ['Test Rock', 'Test Trail', 'Test Bear', 'Test Ogre'] }, defs: [DIG, ROCK, TRAIL, BEAR, OGRE] });
    const n = lib(s0).length;
    const s = resolveAll(cast(s0, 'Test Seek'));
    expect(hand(s)).toEqual(['Test Bear']);
    expect(lib(s)[0]).toBe('Test Ogre'); // never revealed: the reveal stopped at the bear
    expect(sorted(lib(s).slice(-2))).toEqual(['Test Rock', 'Test Trail']);
    expect(lib(s)).toHaveLength(n - 1);
    expect(s.log.some((l) => l.text.includes('reveals') && l.text.includes('Test Rock'))).toBe(true); // revealed to every player (CR 701.20a)
  });
  it('CR 608.2b: with no creature card in the library, nothing goes to the hand and every revealed card goes to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Seek'], library: ['Test Rock', 'Test Trail'] }, defs: [DIG, ROCK, TRAIL] });
    const n = lib(s0).length;
    const s = resolveAll(cast(s0, 'Test Seek'));
    expect(hand(s)).toEqual([]);
    expect(lib(s)).toHaveLength(n);
    expect(sorted(lib(s))).toEqual(sorted(lib(s0)));
  });
});

describe('CR 701.20a, 110.2: "... until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom ..."', () => {
  const RAMP = card('Test Ramp', 'Sorcery', 'Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.');
  it('the first land card enters tapped under your control; the cards above it go to the bottom', () => {
    expect(noManual(RAMP)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Ramp'], library: ['Test Bear', 'Test Trail', 'Test Rock'] }, defs: [RAMP, BEAR, TRAIL, ROCK] });
    const s = resolveAll(cast(s0, 'Test Ramp'));
    const trail = find(s, 'Test Trail', 'battlefield', 'p1');
    expect(s.objects[trail]?.tapped).toBe(true);
    expect(s.objects[trail]?.controller).toBe('p1');
    expect(lib(s)[0]).toBe('Test Rock');
    expect(lib(s).at(-1)).toBe('Test Bear');
  });
});

describe('CR 701.20a, 608.2c: "... until you reveal two creature cards. Put those cards into your hand and the rest ..." (count 2)', () => {
  const PAIR = card('Test Pair', 'Sorcery', 'Reveal cards from the top of your library until you reveal two creature cards. Put those cards into your hand and the rest on the bottom of your library in a random order.');
  it('both creature cards go to the hand, the noncreature cards between them to the bottom', () => {
    expect(noManual(PAIR)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Pair'], library: ['Test Bear', 'Test Rock', 'Test Ogre', 'Test Giant'] }, defs: [PAIR, BEAR, ROCK, OGRE, GIANT] });
    const s = resolveAll(cast(s0, 'Test Pair'));
    expect(sorted(hand(s))).toEqual(['Test Bear', 'Test Ogre']);
    expect(lib(s)[0]).toBe('Test Giant');
    expect(lib(s).at(-1)).toBe('Test Rock');
  });
});

describe('CR 701.20a, 110.2: "... until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest ..." (TypedThose)', () => {
  const SCOUT = card('Test Scout', 'Sorcery', 'Reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order.');
  it('is understood: "those land cards" names the two land cards revealed', () => {
    expect(noManual(SCOUT)).toBe(true);
    expect(JSON.stringify(SCOUT.faces)).toContain('"count":2');
  });
  it('both land cards enter tapped; the card between them goes to the bottom; the card below the second one stays on top', () => {
    const s0 = scenario([], { p1: { hand: ['Test Scout'], library: ['Test Trail', 'Test Bear', 'Test Trail', 'Test Rock'] }, defs: [SCOUT, TRAIL, BEAR, ROCK] });
    const s = resolveAll(cast(s0, 'Test Scout'));
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Test Trail')).toHaveLength(2);
    for (const id of s.zones.battlefield) if (s.defs[s.objects[id]!.defId]!.name === 'Test Trail') expect(s.objects[id]!.tapped).toBe(true);
    expect(lib(s)[0]).toBe('Test Rock');
    expect(lib(s).at(-1)).toBe('Test Bear');
  });
});

describe('CR 608.2c, 701.20a: an optional reveal in a dies trigger: "that card" is the card revealed, never the creature that died', () => {
  const SPIN = card('Test Weaver', 'Creature — Spider', 'Whenever another nontoken creature you control dies, you may reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.', { pt: ['2', '3'] });
  const KILL = card('Test Doom', 'Sorcery', 'Destroy target creature.');
  it('is understood (the focus rule picks the revealed card over the creature card that died)', () => {
    expect(noManual(SPIN)).toBe(true);
    const steps = (SPIN.faces[0]!.abilities[0] as { effect: { steps: { op: string; do?: { op: string; as?: string }[] }[] } }).effect.steps;
    expect(steps[0]!.op).toBe('may');
    expect(steps[0]!.do![0]!.op).toBe('revealUntil');
    expect(JSON.stringify(steps[1])).toContain(`{"ref":"bound","name":"${steps[0]!.do![0]!.as}"}`);
  });
  const setup = (): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { p1: { hand: ['Test Doom'], battlefield: ['Test Weaver', 'Test Bear'], library: ['Test Rock', 'Test Ogre', 'Test Giant'] }, defs: [SPIN, KILL, BEAR, OGRE, GIANT, ROCK] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    return { s: cast(s0, 'Test Doom', { targets: [[obj(bear)]] }), bear };
  };
  it('CR 608.2c: taken: the revealed creature card goes to the hand; the creature that died stays in the graveyard', () => {
    const s = resolveAll(setup().s, { answers: [yes] });
    expect(hand(s)).toEqual(['Test Ogre']);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
    expect(lib(s)[0]).toBe('Test Giant');
    expect(lib(s).at(-1)).toBe('Test Rock');
  });
  it('CR 608.2b: declined: nothing is revealed or moved (the names of the option name nothing)', () => {
    const before = setup().s;
    const libBefore = lib(before);
    const s = resolveAll(before, { answers: [no] });
    expect(hand(s)).toEqual([]);
    expect(lib(s)).toEqual(libBefore);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
  });
});

describe('CR 608.2c, 611.2c: "Whenever ~ attacks, you may exile the top card of your library. You may play that card this turn."', () => {
  const RISK = card('Test Gambler', 'Creature — Human', 'Whenever this creature attacks, you may exile the top card of your library. You may play that card this turn.', { pt: ['2', '2'] });
  it('is understood: the permission follows the optional exile (bound to nothing when it is declined)', () => {
    expect(noManual(RISK)).toBe(true);
  });
  it('CR 611.2c: taken: the exiled card may be played this turn (here in the main phase after combat)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Gambler', 'Plains'], library: ['Test Rock'] }, defs: [RISK, ROCK] });
    let s = attackWith(s0, ['Test Gambler'], { answers: [yes] });
    s = resolveAll(s, { answers: [yes] });
    const rock = find(s, 'Test Rock', 'exile');
    for (let i = 0; i < 30 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(s.turn.step).toBe('main2');
    expect(castable(s, rock)).toBe(true);
  });
  it('CR 608.2b: declined: nothing is exiled, and the permission names no card', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Gambler'], library: ['Test Rock'] }, defs: [RISK, ROCK] });
    let s = attackWith(s0, ['Test Gambler'], { answers: [no] });
    s = resolveAll(s, { answers: [no] });
    expect(s.zones.exile).toEqual([]);
    expect(lib(s)[0]).toBe('Test Rock');
  });
});

describe('CR 608.2d, 406.1, 400.7: "Exile a card at random from your graveyard. You may play that card this turn."', () => {
  const ECHO = card('Test Echo', 'Artifact', '{T}: Exile a card at random from your graveyard. You may play that card this turn.');
  it('is understood', () => expect(noManual(ECHO)).toBe(true));
  it('CR 406.1, 611.2c: the only card of the graveyard is exiled and may be cast from exile this turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo', 'Plains'], graveyard: ['Test Rock'] }, defs: [ECHO, ROCK] });
    const echo = find(s0, 'Test Echo', 'battlefield', 'p1');
    const ability = legal(s0, 'p1').find((a) => a.action.type === 'activate' && (a.action as { source?: ObjectId }).source === echo)!;
    const s = resolveAll(settle(act(s0, ability.action)));
    const rock = find(s, 'Test Rock', 'exile');
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(castable(s, rock)).toBe(true);
  });
});

describe('CR 701.20e, 608.2d, 202.3: "Look at the top seven cards ... Put up to two creature cards with total mana value 5 or less from among them onto the battlefield and the rest ..."', () => {
  const CALL = card('Test Call', 'Sorcery', 'Look at the top four cards of your library. Put up to two creature cards with total mana value 5 or less from among them onto the battlefield and the rest on the bottom of your library in a random order.');
  it('is understood: a choice with a total limit (groupLimit), the move, the rest', () => {
    expect(noManual(CALL)).toBe(true);
    expect(JSON.stringify(CALL.faces)).toContain('"groupLimit":{"stat":"manaValue","cmp":{"op":"<=","value":5}}');
  });
  it('CR 608.2d: the two creature cards chosen (total mana value 5) enter; the other cards go to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Call'], library: ['Test Bear', 'Test Ogre', 'Test Rock', 'Test Giant'] }, defs: [CALL, BEAR, OGRE, ROCK, GIANT] });
    const bear = find(s0, 'Test Bear', 'library', 'p1');
    const ogre = find(s0, 'Test Ogre', 'library', 'p1');
    const s = resolveAll(cast(s0, 'Test Call'), { picks: [[bear, ogre]] });
    expect(sorted(battlefieldNames(s, 'p1'))).toEqual(['Test Bear', 'Test Ogre']);
    expect(sorted(lib(s).slice(-2))).toEqual(['Test Giant', 'Test Rock']);
  });
});

describe('CR 701.20e, 608.2d, 701.24a: "Look at the top N cards of your library, put any number of land cards from among them onto the battlefield tapped, then shuffle."', () => {
  const GATE = card('Test Gate', 'Sorcery', 'Look at the top four cards of your library, put any number of land cards from among them onto the battlefield tapped, then shuffle.');
  it('is understood', () => expect(noManual(GATE)).toBe(true));
  it('CR 608.2d: the land cards chosen among the four enter tapped; the library is shuffled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gate'], library: ['Test Trail', 'Test Bear', 'Test Trail', 'Test Rock'] }, defs: [GATE, TRAIL, BEAR, ROCK] });
    const trails = zoneNames(s0, 'library', 'p1').flatMap((n, i) => (n === 'Test Trail' ? [s0.zones.library.p1![i]!] : []));
    const s = resolveAll(cast(s0, 'Test Gate'), { picks: [trails] });
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Test Trail')).toHaveLength(2);
    for (const id of s.zones.battlefield) if (s.defs[s.objects[id]!.defId]!.name === 'Test Trail') expect(s.objects[id]!.tapped).toBe(true);
    expect(s.log.some((l) => /shuffles/i.test(l.text))).toBe(true);
  });
});
