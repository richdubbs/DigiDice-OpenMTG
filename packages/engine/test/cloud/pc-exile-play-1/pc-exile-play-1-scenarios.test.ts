/**
 * pc-exile-play-1 (precon lane pc-exile-play): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 609.4b, 107.4c, 601.3   "Until end of turn, you may cast spells from among those cards, and you may spend mana as though it were mana of any color to
 *                              cast those spells." (eff.pcep1.cast.spellsFromGroup.durFirst.anyColor, permit.anyManaColor): Plains pay {R}{R}; colorless
 *                              costs stay colorless; nothing of the kind without the rider; the permission ends with the turn
 *   CR 601.3, 400.7            "Until end of turn, you may cast spells from among them." (eff.pcep1.cast.spellsFromGroup.durFirst): only the exiled cards
 *   CR 118.9, 202.3, 305.9     "You may cast a spell from your hand with mana value 2 or less without paying its mana cost." (eff.pcep1.cast.fromHand.free.mvOrLess.after)
 *                              and "..., where X is ..." (eff.pcep1.cast.fromHand.free.mvX.whereX)
 *   CR 601.3, 113.6b           "You may cast ~ from your graveyard or from exile." (eff.pcep1.self.cast.graveyardOrExile)
 *   CR 707.10, 707.10c         "Copy target instant spell twice." (eff.pcep1.copy.spell.twice)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const THIEF = card('Test Pilferer', 'Artifact', "{T}: Exile the top two cards of target opponent's library. Until end of turn, you may cast spells from among those cards, and you may spend mana as though it were mana of any color to cast those spells.");
const PLAIN = card('Test Peeker', 'Artifact', "{T}: Exile the top two cards of target opponent's library. Until end of turn, you may cast spells from among those cards.");
const RAIDER = card('Test Raider', 'Artifact', '{T}: Exile the top two cards of your library. Until end of turn, you may cast spells from among them.');
const FREER = card('Test Freer', 'Artifact', '{T}: You may cast a spell from your hand with mana value 2 or less without paying its mana cost.');
const SCALER = card('Test Scaler', 'Creature — Wizard', '{T}: You may cast a spell with mana value X or less from your hand without paying its mana cost, where X is the number of creatures you control.', ['1', '1']);
const SQUEE = card('Test Revenant', 'Creature — Spirit', 'You may cast Test Revenant from your graveyard or from exile.', ['2', '2'], '{1}{W}');
const TWIN = card('Test Twin', 'Instant', 'Copy target instant spell twice. You may choose new targets for the copies.', undefined, '{0}');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3'], '{R}{R}');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2'], '{2}');
const IMP = card('Test Imp', 'Creature — Imp', '', ['1', '1'], '{R}');
const ECHO = card('Test Echo', 'Instant', 'You may cast Test Echo from your graveyard or from exile.\nYou gain 1 life.', undefined, '{0}');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', undefined, '{0}');
const BREW = card('Test Brew', 'Sorcery', 'You gain 2 life.', undefined, '{3}');
const WISP = card('Test Wisp', 'Artifact', '', undefined, '{C}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{0}');
const MUGGER = card('Test Mugger', 'Artifact', "{T}: Exile the top two cards of target opponent's library. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.");
const DEFS = [ECHO, MUGGER, WISP, THIEF, PLAIN, RAIDER, FREER, SCALER, SQUEE, TWIN, BRUTE, GOLEM, IMP, SIP, BREW, BEAR];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS.filter((x) => x !== MUGGER)) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const castAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const activations = (s: GameState, name: string): Action[] =>
  legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object !== undefined && nameOf(s, a.object) === name).map((a) => a.action);
const inExile = (s: GameState, name: string): ObjectId | undefined => s.zones.exile.find((id) => nameOf(s, id) === name);
const opp = { targets: [{ kind: 'player' as const, id: 'p2' }] };
const activate = (s: GameState, name: string, picks = {}): GameState => resolveAll(act(s, activations(s, name)[0]!), picks);

describe('CR 609.4b, 107.4c: "you may spend mana as though it were mana of any color to cast those spells"', () => {
  it('the exiled {R}{R} creature is cast with two Plains; the same ability without the rider cannot pay it', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pilferer', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Test Imp'] } });
    const s = activate(s0, 'Test Pilferer', opp);
    expect(inExile(s, 'Test Brute')).toBeDefined();
    expect(castAction(s, 'Test Brute')).toBeDefined();
    const cast = resolveAll(settle(act(s, castAction(s, 'Test Brute')!)));
    expect(cast.zones.battlefield.some((id) => nameOf(cast, id) === 'Test Brute')).toBe(true); // paid with the two Plains
    const p0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Peeker', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Test Imp'] } });
    const p = activate(p0, 'Test Peeker', opp);
    expect(inExile(p, 'Test Brute')).toBeDefined();
    expect(castAction(p, 'Test Brute')).toBeUndefined();
  });
  it('with one Plains the {R} creature is cast but the {R}{R} one is not; the card under the two exiled ones stays in the library', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pilferer', 'Plains'] }, p2: { library: ['Test Brute', 'Test Imp', 'Test Sip'] } });
    const s = activate(s0, 'Test Pilferer', opp);
    expect(castAction(s, 'Test Imp')).toBeDefined();
    expect(castAction(s, 'Test Brute')).toBeUndefined();
    expect(castAction(s, 'Test Sip')).toBeUndefined();
    expect(s.zones.library['p2']!.some((id) => nameOf(s, id) === 'Test Sip')).toBe(true);
  });
  it('a {C} symbol still needs colorless mana (CR 107.4c): a {C} artifact is not cast with Plains; a {2} one is cast with two Plains (generic)', () => {
    const w0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pilferer', 'Plains'] }, p2: { library: ['Test Wisp', 'Test Bear'] } });
    expect(castAction(activate(w0, 'Test Pilferer', opp), 'Test Wisp')).toBeUndefined();
    const g0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pilferer', 'Plains', 'Plains'] }, p2: { library: ['Test Golem', 'Test Bear'] } });
    expect(castAction(activate(g0, 'Test Pilferer', opp), 'Test Golem')).toBeDefined();
  });
  it('the permission ends with the turn: on your next turn (you hold priority in your main phase) the exiled card cannot be cast', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pilferer', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Test Imp'] } });
    const s = activate(s0, 'Test Pilferer', opp);
    expect(castAction(s, 'Test Brute')).toBeDefined();
    const later = advanceTo(s, 3, 'main1');
    expect(later.pending?.player).toBe('p1');
    expect(inExile(later, 'Test Brute')).toBeDefined();
    expect(castAction(later, 'Test Brute')).toBeUndefined();
  });
  it('an opponent cannot cast the exiled card (the permission is yours): with priority, p2 casts its own instant but not the exiled one', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pilferer'] }, p2: { library: ['Test Sip'], hand: ['Test Sip'], battlefield: ['Plains'] } });
    const s = act(activate(s0, 'Test Pilferer', opp), { type: 'pass', player: 'p1' });
    expect(inExile(s, 'Test Sip')).toBeDefined();
    expect(s.pending?.player).toBe('p2');
    const casts = legalActions(s, 'p2').filter((a) => a.kind === 'cast' && a.object !== undefined);
    expect(casts.length).toBe(1); // the Test Sip in its hand only
    expect(s.objects[casts[0]!.object!]!.zone).toBe('hand');
  });
});

describe('CR 609.4b, 107.4c: the same rider on "You may play those cards this turn" (an experimental template, played here)', () => {
  it('the exiled cards are played this turn with mana of any color; a land among them is played as a land', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mugger', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Plains', 'Test Bear'] } });
    const s = activate(s0, 'Test Mugger', opp);
    expect(castAction(s, 'Test Brute')).toBeDefined();
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand')).toBe(true);
    expect(castAction(s, 'Test Bear')).toBeUndefined();
    const plain = scenario([], { defs: DEFS, p1: { battlefield: ['Test Peeker', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Plains', 'Test Bear'] } });
    expect(castAction(activate(plain, 'Test Peeker', opp), 'Test Brute')).toBeUndefined();
  });
});

describe('CR 601.3, 400.7: "Until end of turn, you may cast spells from among them." names the exiled cards only', () => {
  it('both exiled spells are castable (the {0} ones), a spell in your hand is unaffected, a land among them is not a spell', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Raider'], library: ['Test Sip', 'Plains', 'Test Bear'], hand: ['Test Sip'] } });
    const s = activate(s0, 'Test Raider');
    expect(inExile(s, 'Test Sip')).toBeDefined();
    expect(castAction(s, 'Test Sip')).toBeDefined();
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand')).toBe(false);
    // the card below them was not exiled and cannot be cast
    expect(castAction(s, 'Test Bear')).toBeUndefined();
  });
});

describe('CR 118.9, 202.3, 305.9: "You may cast a spell from your hand with mana value 2 or less without paying its mana cost."', () => {
  it('a mana value 1 spell is cast with no mana (the {3} sorcery stays in hand)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Freer'], hand: ['Test Imp', 'Test Brew', 'Plains'] } });
    const before = life(s, 'p1');
    s = activate(s, 'Test Freer', { objects: [find(s, 'Test Imp', 'hand', 'p1')] });
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Imp')).toBe(true);
    expect(life(s, 'p1')).toBe(before);
    expect(s.zones.hand['p1']!.map((id) => nameOf(s, id)).sort()).toEqual(['Plains', 'Test Brew']);
  });
  it('a hand holding only a {3} spell offers nothing; nothing is cast', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Freer'], hand: ['Test Brew'] } });
    s = activate(s, 'Test Freer');
    expect(s.zones.stack.length).toBe(0);
    expect(s.zones.graveyard['p1']!.some((id) => nameOf(s, id) === 'Test Brew')).toBe(false);
  });
});

describe('CR 107.3, 202.3: "..., where X is the number of creatures you control" bounds the mana value', () => {
  it('with one creature X is 1: the {R} creature is cast free, the {2} golem is not offered; with two creatures the golem is', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Scaler', 'Test Bear'], hand: ['Test Golem'] } });
    const two = activate(s0, 'Test Scaler', { objects: [find(s0, 'Test Golem', 'hand', 'p1')] });
    expect(two.zones.battlefield.some((id) => nameOf(two, id) === 'Test Golem')).toBe(true);
    const lone = scenario([], { defs: DEFS, p1: { battlefield: ['Test Scaler'], hand: ['Test Golem'] } });
    expect(activate(lone, 'Test Scaler', { objects: [find(lone, 'Test Golem', 'hand', 'p1')] }).zones.battlefield.some((id) => nameOf(lone, id) === 'Test Golem')).toBe(false);
  });
});

describe('CR 601.3, 113.6b: "You may cast ~ from your graveyard or from exile."', () => {
  it('castable from your graveyard and from exile; not from your library; an opponent cannot cast it from your graveyard', () => {
    const grave = scenario([], { defs: DEFS, p1: { graveyard: ['Test Revenant'], battlefield: ['Plains', 'Plains'] } });
    expect(castAction(grave, 'Test Revenant')).toBeDefined();
    const exile = scenario([], { defs: DEFS, p1: { exile: ['Test Revenant'], battlefield: ['Plains', 'Plains'] } });
    expect(castAction(exile, 'Test Revenant')).toBeDefined();
    const lib = scenario([], { defs: DEFS, p1: { library: ['Test Revenant'], battlefield: ['Plains', 'Plains'] } });
    expect(castAction(lib, 'Test Revenant')).toBeUndefined();
    // an instant, so timing is no excuse: p2 holds priority and casts its own from its graveyard and from exile, never p1's from p1's graveyard
    const mine = scenario([], { defs: DEFS, p1: { graveyard: ['Test Echo'] }, p2: { graveyard: ['Test Echo'], exile: ['Test Echo'] } });
    const theirs = act(mine, { type: 'pass', player: 'p1' });
    expect(theirs.pending?.player).toBe('p2');
    const zones = legalActions(theirs, 'p2').filter((a) => a.kind === 'cast' && a.object !== undefined).map((a) => `${theirs.objects[a.object!]!.zone}:${theirs.objects[a.object!]!.owner}`).sort();
    expect(zones).toEqual(['exile:p2', 'graveyard:p2']);
  });
});

describe('CR 707.10, 707.10c: "Copy target instant spell twice." puts two copies on the stack', () => {
  it('a {0} instant that gains 1 life resolves three times (the spell and two copies)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sip', 'Test Twin'] } });
    const before = life(s, 'p1');
    s = settle(act(s, castAction(s, 'Test Sip')!));
    const sip = s.zones.stack.at(-1)!;
    s = settle(act(s, castAction(s, 'Test Twin')!), { targets: [{ kind: 'object', id: sip }] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before + 3);
    expect(find(s, 'Test Sip', 'graveyard', 'p1')).toBeDefined();
  });
});
