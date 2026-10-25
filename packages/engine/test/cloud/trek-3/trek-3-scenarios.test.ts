/**
 * trek-3 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by
 * the game's default compiler. Nothing is mocked. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c, 611.2a     "... gets +1/+0 until end of turn. Then that creature gains menace until end of turn if creatures you control have total power 8 or
 *                         greater.": the condition is read after the +1/+0, as the ability resolves; false, the creature keeps only the +1/+0
 *   CR 701.23a, 201.2     "search your library and/or graveyard for a basic land card or a card named <name>, reveal it, and put it into your hand. If you search
 *                         your library this way, shuffle.": either card, in the zones the searcher picks; no other card
 *   CR 205.3g, 613.4c     "Spacecraft creatures you control get +3/+3.": a Spacecraft that is an artifact creature, not a noncreature Spacecraft, not another creature
 *   CR 701.20e, 406.1,    "look at target opponent's hand. You may choose a nonland card from it. If you do, that player exiles that card, then draws a card.";
 *   121.1, 608.2d         no choice, nothing happens
 *   CR 115.1, 608.2h,     "Exile target creature or Spacecraft. Its controller may search their library for a basic land card, reveal it, put it into their hand,
 *   701.23a, 701.24a      then shuffle.": a noncreature Spacecraft is a legal target; the controller it had (last known information) decides and searches
 *   CR 111.4, 205.3m      "create two 2/2 black Romulan creature tokens": Romulan tokens
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability automated and the card full (an experimental template would cap it at partial). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);
const hand = (s: GameState, p: string): ObjectId[] => s.zones.hand[p]!;
const lib = (s: GameState, p: string): ObjectId[] => s.zones.library[p]!;
const named = (s: GameState, ids: ObjectId[], name: string): ObjectId[] => ids.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
/** Answer what comes up: costs automatically, targets and the queued answers in order; stop at priority or at a decision nothing answers. */
function settle(s0: GameState, opts: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && (opts.targets ?? []).length > 0) s = answer(s, { kind: 'chooseTargets', targets: opts.targets!.shift()! });
    else if ((opts.answers ?? []).length > 0) s = answer(s, opts.answers!.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q: Opts = { targets: [...(opts.targets ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), q), q);
}
/** Pass priority (no attackers, no blockers) until `done`, answering what comes up. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
const SHUTTLE = card('Test Shuttle', 'Artifact Creature — Spacecraft', '', ['2', '2']);
const PROBE = card('Test Probe', 'Artifact — Spacecraft', '');
const ROCK = card('Test Rock', 'Artifact', '');
const STARSHIP = card('Test Starship', 'Artifact — Spacecraft', '');

describe('CR 608.2c, 611.2a: "... gets +1/+0 until end of turn. Then that creature gains menace until end of turn if creatures you control have total power 8 or greater."', () => {
  const SKIPPER = card('Test Skipper', 'Creature — Human Officer', 'At the beginning of combat on your turn, target creature you control gets +1/+0 until end of turn. Then that creature gains menace until end of turn if creatures you control have total power 8 or greater.', ['2', '3']);
  const atCombat = (x: GameState): boolean => x.turn.number === 1 && x.turn.step === 'beginCombat' && x.zones.stack.length > 0 && x.pending?.kind === 'priority';
  it('is automated', () => expect(full(SKIPPER)).toBe(true));
  it('total power 7 before the +1/+0, 8 after it: the condition is read after the first instruction, the creature gains menace until end of turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Skipper', 'Test Giant'] }, defs: [SKIPPER, GIANT] });
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    s = passTo(s, atCombat, { targets: [[obj(giant)]] });
    s = drain(s, {});
    expect(pt(s, giant)).toBe('6/5');
    expect(keywords(s, giant)).toContain('menace');
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1');
    expect(pt(s, giant)).toBe('5/5');
    expect(keywords(s, giant)).not.toContain('menace');
  });
  it('total power 7 after the +1/+0: no menace, the +1/+0 still applies', () => {
    let s = scenario([], { p1: { battlefield: ['Test Skipper', 'Test Ogre'] }, defs: [SKIPPER, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = passTo(s, atCombat, { targets: [[obj(ogre)]] });
    s = drain(s, {});
    expect(pt(s, ogre)).toBe('5/4');
    expect(keywords(s, ogre)).not.toContain('menace');
  });
  it('the opponent\'s creatures do not count toward the total', () => {
    let s = scenario([], { p1: { battlefield: ['Test Skipper', 'Test Ogre'] }, p2: { battlefield: ['Test Giant'] }, defs: [SKIPPER, OGRE, GIANT] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = drain(passTo(s, atCombat, { targets: [[obj(ogre)]] }), {});
    expect(keywords(s, ogre)).not.toContain('menace');
  });
});

describe('CR 701.23a, 201.2, 701.24a: "search your library and/or graveyard for a basic land card or a card named Test Starship, reveal it, and put it into your hand"', () => {
  const COMMODORE = card('Test Commodore', 'Legendary Creature — Human Officer', 'Vigilance\nSpacecraft creatures you control get +3/+3.\nWhenever Test Commodore enters or attacks, search your library and/or graveyard for a basic land card or a card named Test Starship, reveal it, and put it into your hand. If you search your library this way, shuffle.', ['3', '4']);
  const defs = [COMMODORE, STARSHIP, BEAR, SHUTTLE, PROBE];
  it('is automated', () => expect(full(COMMODORE)).toBe(true));
  it('the graveyard alone: the named card comes from there, the library is not shuffled; a basic land card is the other option, a card of neither description is none', () => {
    const s0 = scenario([], { p1: { hand: ['Test Commodore'], graveyard: ['Test Starship', 'Test Bear', 'Plains'] }, defs });
    const libBefore = [...lib(s0, 'p1')];
    const ship = find(s0, 'Test Starship', 'graveyard', 'p1');
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Commodore', 'hand', 'p1') }), {});
    s = settle(pass(pass(s)), {}); // the creature spell resolves; the trigger goes on the stack
    s = settle(pass(pass(s)), { answers: [{ kind: 'chooseOption', ids: ['graveyard'] }] });
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect([...options].sort()).toEqual([ship, find(s0, 'Plains', 'graveyard', 'p1')].sort());
    expect(options).not.toContain(bear);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [ship] }), {});
    expect(named(s, hand(s, 'p1'), 'Test Starship')).toHaveLength(1);
    expect(lib(s, 'p1')).toEqual(libBefore); // no new object ids: no shuffle (CR 400.7)
  });
  it('the library: a basic land card (Plains) comes to the hand and the library is shuffled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Commodore'] }, defs });
    const libBefore = [...lib(s0, 'p1')];
    const plains = lib(s0, 'p1')[0]!;
    const s = cast(s0, 'Test Commodore', { answers: [{ kind: 'chooseOption', ids: ['library', 'graveyard'] }, { kind: 'chooseObjects', ids: [plains] }] });
    expect(named(s, hand(s, 'p1'), 'Plains')).toHaveLength(1);
    expect(lib(s, 'p1').some((id) => libBefore.includes(id))).toBe(false); // shuffled: every card a new object (CR 400.7)
  });
  it('CR 205.3g, 613.4c: a Spacecraft artifact creature I control gets +3/+3; a noncreature Spacecraft, another creature and the opponent\'s Spacecraft do not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Commodore', 'Test Shuttle', 'Test Probe', 'Test Bear'] }, p2: { battlefield: ['Test Shuttle'] }, defs });
    expect(pt(s, find(s, 'Test Shuttle', 'battlefield', 'p1'))).toBe('5/5');
    expect(pt(s, find(s, 'Test Shuttle', 'battlefield', 'p2'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Commodore', 'battlefield', 'p1'))).toBe('3/4');
    expect(getChars(s, find(s, 'Test Probe', 'battlefield', 'p1'))!.types).not.toContain('Creature');
  });
});

describe('CR 701.20e, 406.1, 121.1, 608.2d: "look at target opponent\'s hand. You may choose a nonland card from it. If you do, that player exiles that card, then draws a card."', () => {
  const LEECH = card('Test Leech', 'Creature — Vampire', "Lifelink\nWhen this creature enters, look at target opponent's hand. You may choose a nonland card from it. If you do, that player exiles that card, then draws a card.", ['2', '2']);
  const defs = [LEECH, BEAR];
  it('is automated', () => expect(full(LEECH)).toBe(true));
  it('the chosen card is exiled and that player draws a card; a land is no option', () => {
    const s0 = scenario([], { p1: { hand: ['Test Leech'] }, p2: { hand: ['Test Bear', 'Plains'] }, defs });
    const bear = find(s0, 'Test Bear', 'hand', 'p2');
    const land = find(s0, 'Plains', 'hand', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Leech', 'hand', 'p1') }), {});
    s = settle(pass(pass(s)), { targets: [[player('p2')]] }); // the creature resolves; its trigger targets p2
    s = settle(pass(pass(s)), {});
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options).toContain(bear);
    expect(options).not.toContain(land);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [bear] }), {});
    expect(findAll(s, 'Test Bear', 'exile', 'p2')).toHaveLength(1);
    expect(hand(s, 'p2')).toHaveLength(2); // Plains, and the card drawn
    expect(named(s, hand(s, 'p2'), 'Test Bear')).toHaveLength(0);
    expect(hand(s, 'p1')).toHaveLength(0); // you draw nothing
  });
  it('no card chosen: nothing is exiled and nobody draws', () => {
    const s0 = scenario([], { p1: { hand: ['Test Leech'] }, p2: { hand: ['Test Bear', 'Plains'] }, defs });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Leech', 'hand', 'p1') }), {});
    s = settle(pass(pass(s)), { targets: [[player('p2')]] });
    s = settle(pass(pass(s)), { answers: [{ kind: 'chooseObjects', ids: [] }] });
    expect(s.zones.exile).toHaveLength(0);
    expect(hand(s, 'p2')).toHaveLength(2);
    expect(named(s, hand(s, 'p2'), 'Test Bear')).toHaveLength(1);
  });
});

describe('CR 115.1, 608.2h, 701.23a, 701.24a: "Exile target creature or Spacecraft. Its controller may search their library for a basic land card, reveal it, put it into their hand, then shuffle."', () => {
  const VOYAGE = card('Test Voyage', 'Sorcery', 'Exile target creature or Spacecraft. Its controller may search their library for a basic land card, reveal it, put it into their hand, then shuffle.');
  const defs = [VOYAGE, BEAR, PROBE, ROCK];
  /** The objects the spell's target decision offers (CR 601.2c: only legal choices are offered). */
  const targetsOf = (s: GameState): ObjectId[] => {
    const d = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Voyage', 'hand', 'p1') }).pending;
    return d?.kind === 'chooseTargets' ? d.objects : [];
  };
  it('is automated', () => expect(full(VOYAGE)).toBe(true));
  it('a noncreature Spacecraft is exiled; its controller (the opponent) searches: a basic land card into their hand, their library shuffled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Voyage'] }, p2: { battlefield: ['Test Probe'] }, defs });
    const probe = find(s0, 'Test Probe', 'battlefield', 'p2');
    expect(targetsOf(s0)).toContain(probe);
    const p2Lib = [...lib(s0, 'p2')];
    const p1Lib = [...lib(s0, 'p1')];
    const handBefore = hand(s0, 'p2').length;
    const s = cast(s0, 'Test Voyage', { targets: [[obj(probe)]], answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [p2Lib[0]!] }] });
    expect(findAll(s, 'Test Probe', 'exile', 'p2')).toHaveLength(1);
    expect(hand(s, 'p2')).toHaveLength(handBefore + 1);
    expect(named(s, hand(s, 'p2'), 'Plains')).toHaveLength(1);
    expect(lib(s, 'p2').some((id) => p2Lib.includes(id))).toBe(false); // shuffled (CR 400.7)
    expect(lib(s, 'p1')).toEqual(p1Lib); // the caster neither searches nor shuffles
    expect(named(s, hand(s, 'p1'), 'Plains')).toHaveLength(0);
  });
  it('the controller declines: the creature is still exiled, no card, no shuffle', () => {
    const s0 = scenario([], { p1: { hand: ['Test Voyage'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const p2Lib = [...lib(s0, 'p2')];
    const s = cast(s0, 'Test Voyage', { targets: [[obj(bear)]], answers: [{ kind: 'yesNo', yes: false }] });
    expect(findAll(s, 'Test Bear', 'exile', 'p2')).toHaveLength(1);
    expect(lib(s, 'p2')).toEqual(p2Lib);
  });
  it('a noncreature artifact that is no Spacecraft is no legal target', () => {
    const s0 = scenario([], { p1: { hand: ['Test Voyage'] }, p2: { battlefield: ['Test Rock', 'Test Probe', 'Test Bear'] }, defs });
    const offered = targetsOf(s0);
    expect(offered).not.toContain(find(s0, 'Test Rock', 'battlefield', 'p2'));
    expect(offered).toContain(find(s0, 'Test Probe', 'battlefield', 'p2'));
    expect(offered).toContain(find(s0, 'Test Bear', 'battlefield', 'p2'));
  });
});

describe('CR 111.4, 205.3m: "You may sacrifice an artifact or creature. If you do, create two 2/2 black Romulan creature tokens."', () => {
  const PLOT = card('Test Plot', 'Sorcery', 'You may sacrifice an artifact or creature. If you do, create two 2/2 black Romulan creature tokens.');
  it('is automated; two 2/2 black Romulan creature tokens after the sacrifice, none without it', () => {
    expect(full(PLOT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Plot', 'Test Plot'], battlefield: ['Test Rock'] }, defs: [PLOT, ROCK] });
    const rock = find(s0, 'Test Rock', 'battlefield', 'p1');
    let s = cast(s0, 'Test Plot', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [rock] }] });
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const t of tokens) {
      const c = getChars(s, t)!;
      expect(c.subtypes).toEqual(['Romulan']);
      expect(c.colors).toEqual(['B']);
      expect(`${c.power}/${c.toughness}`).toBe('2/2');
    }
    s = cast(s, 'Test Plot', { answers: [{ kind: 'yesNo', yes: false }] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });
});
