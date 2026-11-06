/**
 * Must-finish round edh-next-119 (code edhn119, control changes and searches): the new engine pieces played with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked on the Comprehensive Rules of 2026-09-25 (media.wizards.com text).
 *
 *   CR 723.2, 723.4, 723.5, 701.23a   "You control each opponent while they're searching their libraries." (Opposition Agent): the decisions of an opponent's search of their own library name the
 *                                     controller (`decidedBy`), who sees the cards; nothing before or after the search; not the controller's own search; not another player's library
 *   CR 614.1a, 609.4b, 611.2b, 400.7  "While an opponent is searching their library, they exile the cards they find. You may play those cards for as long as they remain exiled, and you may
 *                                     spend mana as though it were mana of any color to cast them.": the found card is exiled, not put into the hand; the controller casts it with mana of
 *                                     another color, plays a land only with a land play, keeps the permission after the source leaves; the effect can't see the exiled card
 *   CR 701.23b, 701.23d               a stated quality lets the controller find nothing; "a card" must be found
 *   CR 723.1a, 616.1                  two such sources: the newest one's controller decides and chooses whose exile applies
 *   CR 723.1, 723.1b, 500.7, 113.6k   "When you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn."
 *                                     (Emrakul, the Promised End): the cast trigger resolves first; Bob's next turn is Alice's to decide, the extra turn after it is Bob's own; two such
 *                                     effects on one turn make two extra turns; a player who leaves the game during the controlled turn takes none
 */
import { describe, expect, it } from 'vitest';
import { legalActions, mayActAs, viewFor, type Action, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { card, full } from '../r3-cost/support';
import { mpScenario, concede } from '../../m12/rules/helpers';
import { settle as settleAny } from '../cmd3/helpers';

const AGENT = card('Test Snoop', 'Creature — Human Rogue', "Flash\nYou control each opponent while they're searching their libraries.\nWhile an opponent is searching their library, they exile the cards they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them.", '{0}', ['3', '2']);
const SEEK = card('Test Seek', 'Instant', 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.');
const ANY = card('Test Any Seek', 'Instant', 'Search your library for a card, put that card into your hand, then shuffle.');
const RAMP = card('Test Ramp', 'Instant', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
const PEEK = card('Test Peek', 'Instant', "Search target opponent's library for a creature card and exile it. Then that player shuffles.");
const ELK = card('Test Green Elk', 'Creature — Elk', '', '{G}', ['2', '2'], ['G']);
const DEFS = [AGENT, SEEK, ANY, RAMP, PEEK, ELK];

const inZone = (s: GameState, zone: 'exile' | 'battlefield', name: string): ObjectId[] => s.zones[zone].filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
const libNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);

/** Alice (p1) controls the Agent; Bob (p2) holds the search spells, his library has the Elk. Alice passes in her main phase: Bob has priority. */
function bobToAct(extra: { p1?: Record<string, unknown>; p2?: Record<string, unknown> } = {}): GameState {
  const s = scenario([], { p1: { battlefield: ['Test Snoop', 'Plains', 'Plains'], ...extra.p1 }, p2: { hand: ['Test Seek', 'Test Any Seek', 'Test Ramp', 'Test Peek'], library: ['Test Green Elk'], ...extra.p2 }, defs: DEFS });
  return act(s, { type: 'pass', player: 'p1' });
}
/** Bob casts a spell; both pass; the stack resolves until a decision of the search comes up. */
function bobCasts(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p2', card: find(s0, name, 'hand', 'p2') });
  while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  for (let i = 0; i < 4 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
  return s;
}
/** Answer every decision until priority (the first options; `pick` for a chooseObjects of the search). */
function settle(s0: GameState, pick?: (s: GameState) => ObjectId[]): GameState {
  let s = s0;
  for (let i = 0; i < 20 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending;
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(s) : d.options.slice(0, Math.max(d.min, 1)) });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: d.options.slice(0, Math.max(d.min, 1)).map((o) => o.id) });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`settle: ${d.kind}`);
  }
  return s;
}

describe('edh-next-119: the synthetic search-control card is automated', () => {
  it('Test Snoop compiles full (sta.edhn119.controlSearching, sta.edhn119.searchFoundExiled)', () => {
    expect(full(AGENT)).toBe(true);
    expect(JSON.stringify(AGENT.faces)).toContain('"rule":"controlSearching"');
    expect(JSON.stringify(AGENT.faces)).toContain('"rule":"searchFoundExiled"');
  });
});

describe('CR 723.2, 723.4, 723.5, 701.23a: "You control each opponent while they\'re searching their libraries."', () => {
  it('the search decision of the opponent names the controller, who may answer it; the opponent\'s own seat may not; the controller sees the library', () => {
    const s = bobCasts(bobToAct(), 'Test Seek');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', decidedBy: 'p1' });
    const elk = s.zones.library.p2!.find((id) => s.objects[id]!.defId === 'Test Green Elk')!;
    expect((s.pending as { options: ObjectId[] }).options).toContain(elk);
    const a: Action = { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: [elk] } };
    expect(mayActAs(s, 'p1', a)).toBe(true);
    expect(mayActAs(s, 'p2', a)).toBe(false);
    // CR 723.4: Alice sees the card of Bob's library while she decides; Carol-free two-player game: nobody else
    const seen = viewFor(s, 'p1').objects[elk] as { defId?: string } | undefined;
    expect(seen?.defId).toBe('Test Green Elk');
    // the control ends with the search: no record is left
    const t = settle(s, () => [elk]);
    expect(t.playerControl).toBeUndefined();
  });

  it('negative: before the search (casting the spell, priority) and after it, Bob decides for himself', () => {
    const s0 = bobToAct();
    expect(s0.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(s0.pending!.decidedBy).toBeUndefined();
    const t = settle(bobCasts(s0, 'Test Seek'));
    expect(t.pending?.decidedBy).toBeUndefined();
  });

  it('negative: the controller\'s own search is not controlled and its card goes where the effect says', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Snoop'], hand: ['Test Seek'], library: ['Test Green Elk'] }, defs: DEFS });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Seek', 'hand', 'p1') });
    for (let i = 0; i < 4 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    expect(s.pending!.decidedBy).toBeUndefined();
    const t = settle(s);
    expect(handNames(t, 'p1')).toContain('Test Green Elk');
    expect(inZone(t, 'exile', 'Test Green Elk')).toEqual([]);
  });

  it('negative: an opponent searching ANOTHER player\'s library ("search target opponent\'s library") is not "searching their library": not controlled, nothing exiled by the rule', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Snoop'], library: ['Test Green Elk'] }, p2: { hand: ['Test Peek'] }, defs: DEFS });
    let u = settle(bobCasts(act(s0, { type: 'pass', player: 'p1' }), 'Test Peek')); // the target: Alice
    for (let i = 0; i < 4 && u.pending?.kind === 'priority' && u.zones.stack.length > 0; i++) u = act(u, { type: 'pass', player: u.pending.player });
    expect(u.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    expect(u.pending!.decidedBy).toBeUndefined(); // Bob's own choice
    const t = settle(u);
    // the Elk is exiled by the spell itself, with no permission for Alice
    expect(inZone(t, 'exile', 'Test Green Elk')).toHaveLength(1);
    const elk = inZone(t, 'exile', 'Test Green Elk')[0]!;
    expect(legalActions(t, 'p1').some((a) => a.action.type === 'cast' && (a.action as { card?: ObjectId }).card === elk)).toBe(false);
  });
});

describe('CR 614.1a, 609.4b, 611.2b: "they exile the cards they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color"', () => {
  it('the found creature card is exiled, not put into Bob\'s hand; Alice may cast it with white mana; Bob may not', () => {
    const s = settle(bobCasts(bobToAct(), 'Test Seek'));
    expect(handNames(s, 'p2')).not.toContain('Test Green Elk');
    const [elk] = inZone(s, 'exile', 'Test Green Elk');
    expect(elk).toBeDefined();
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // Alice's main phase, the stack empty
    expect(legalActions(s, 'p1').some((a) => a.action.type === 'cast' && (a.action as { card?: ObjectId }).card === elk)).toBe(true);
    expect(legalActions(s, 'p2').some((a) => a.action.type === 'cast' && (a.action as { card?: ObjectId }).card === elk)).toBe(false);
    let t = act(s, { type: 'cast', player: 'p1', card: elk! });
    while (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    for (let i = 0; i < 4 && t.zones.stack.length > 0 && t.pending?.kind === 'priority'; i++) t = act(t, { type: 'pass', player: t.pending.player });
    const onField = inZone(t, 'battlefield', 'Test Green Elk');
    expect(onField).toHaveLength(1);
    expect(t.objects[onField[0]!]!.controller).toBe('p1');
  });

  it('the rest of the effect still happens (Bob shuffles) and can\'t see the exiled card (nothing reaches his hand)', () => {
    const s = settle(bobCasts(bobToAct(), 'Test Seek'));
    expect(s.log.some((l) => /Bob shuffles their library/.test(l.text))).toBe(true);
    expect(libNames(s, 'p2')).not.toContain('Test Green Elk');
  });

  it('the permission lasts while the card stays exiled, also after the source has left the battlefield', () => {
    const s = settle(bobCasts(bobToAct(), 'Test Seek'));
    const [elk] = inZone(s, 'exile', 'Test Green Elk');
    const agent = inZone(s, 'battlefield', 'Test Snoop')[0]!;
    const gone = structuredClone(s);
    gone.zones.battlefield = gone.zones.battlefield.filter((id) => id !== agent);
    gone.objects[agent]!.zone = 'graveyard';
    gone.zones.graveyard.p1!.push(agent);
    expect(legalActions(gone, 'p1').some((a) => a.action.type === 'cast' && (a.action as { card?: ObjectId }).card === elk)).toBe(true);
  });

  it('a land found ("onto the battlefield tapped") is exiled instead; Alice may play it only while she has a land play', () => {
    const s0 = bobToAct({ p2: { library: ['Plains'] } });
    const s = settle(bobCasts(s0, 'Test Ramp'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p2')).toEqual([]);
    const lands = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.owner === 'p2');
    expect(lands).toHaveLength(1);
    expect(legalActions(s, 'p1').some((a) => a.action.type === 'playLand' && (a.action as { card?: ObjectId }).card === lands[0])).toBe(true);
    // negative: with her land play used, no
    const used = structuredClone(s);
    used.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn = 1;
    const usedOk = legalActions(used, 'p1').some((a) => a.action.type === 'playLand' && (a.action as { card?: ObjectId }).card === lands[0]);
    expect(usedOk).toBe(false);
  });
});

describe('CR 701.23b, 701.23d: what the controller may have the opponent find', () => {
  it('a stated quality ("a creature card"): the controller may have them find nothing (min 0); then nothing is exiled', () => {
    const s = bobCasts(bobToAct(), 'Test Seek');
    expect((s.pending as { min: number }).min).toBe(0);
    const t = settle(s, () => []);
    expect(inZone(t, 'exile', 'Test Green Elk')).toEqual([]);
    expect(libNames(t, 'p2')).toContain('Test Green Elk');
  });
  it('"a card" (no quality): the controller must have them find one (min 1), and it is exiled', () => {
    const s = bobCasts(bobToAct(), 'Test Any Seek');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', decidedBy: 'p1', min: 1 });
    const t = settle(s);
    expect(t.zones.exile.filter((id) => t.objects[id]!.owner === 'p2')).toHaveLength(1);
    expect(handNames(t, 'p2').filter((n) => n !== 'Test Seek' && n !== 'Test Ramp' && n !== 'Test Peek')).toEqual([]);
  });
});

describe('CR 723.1a, 616.1: two sources in a four-player game', () => {
  it('the controller of the newest source decides the search and chooses whose exile applies; the other source\'s controller gets nothing', () => {
    let s = mpScenario({ players: 4, defs: DEFS, zones: { p1: { battlefield: ['Test Snoop'] }, p3: { battlefield: ['Test Snoop'] }, p2: { hand: ['Test Seek'], library: ['Test Green Elk'] } } });
    // p3's source entered last (put after p1's): p3 controls Bob's search
    const snoops = inZone(s, 'battlefield', 'Test Snoop');
    expect(s.objects[snoops.find((id) => s.objects[id]!.controller === 'p3')!]!.timestamp).toBeGreaterThan(s.objects[snoops.find((id) => s.objects[id]!.controller === 'p1')!]!.timestamp);
    s = act(s, { type: 'pass', player: 'p1' });
    s = bobCasts(s, 'Test Seek');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', decidedBy: 'p3' });
    const elk = s.zones.library.p2!.find((id) => s.objects[id]!.defId === 'Test Green Elk')!;
    s = answer(s, { kind: 'chooseObjects', ids: [elk] });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2', decidedBy: 'p3' });
    const mine = (s.pending as { options: { id: string; label: string }[] }).options.find((o) => /\(Carol\)|p3/.test(o.label)) ?? (s.pending as { options: { id: string }[] }).options[1]!;
    s = settle(answer(s, { kind: 'chooseOption', ids: [mine.id] }));
    const [ex] = inZone(s, 'exile', 'Test Green Elk');
    expect(ex).toBeDefined();
    const perms = s.continuousEffects.filter((r) => r.effect.s === 'permit');
    expect(perms.map((r) => r.controller)).toEqual(['p3']);
  });
});

// ---- Emrakul, the Promised End ---------------------------------------------------------------------------------------------------------------------------
const PROMISED = card('Test Promised Titan', 'Legendary Creature — Eldrazi', "When you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.\nFlying", '{0}', ['13', '13']);
const PROMISED_TOO = card('Test Promised Echo', 'Sorcery', "You gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.");
const TDEFS = [PROMISED, PROMISED_TOO];

/** Pass every priority and answer the simplest way (no attackers, no blockers), until `stop`; every state on the way is kept. */
function runUntil(s0: GameState, stop: (s: GameState) => boolean, seen: GameState[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 600 && !stop(s); i++) {
    seen.push(s);
    const d = s.pending!;
    if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = settleAny(s);
  }
  if (!stop(s)) throw new Error('runUntil: the condition never held');
  return s;
}
const turnIs = (n: number) => (s: GameState): boolean => s.turn.number === n;
const bob = { kind: 'player', id: 'p2' } as const;

/** Alice casts the titan targeting Bob; the cast trigger resolves while the spell waits on the stack, then the spell resolves. */
function titanCast(s0: GameState): { afterTrigger: GameState; resolved: GameState } {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Promised Titan', 'hand', 'p1') });
  while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [bob] });
  for (let i = 0; i < 4 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [bob] });
  // the trigger is on top of the spell (CR 603.3, 113.6k): both pass once, the trigger resolves
  let t = s;
  for (let i = 0; i < 2 && t.pending?.kind === 'priority'; i++) t = act(t, { type: 'pass', player: t.pending.player });
  for (let i = 0; i < 4 && t.pending?.kind === 'chooseTargets'; i++) t = answer(t, { kind: 'chooseTargets', targets: [bob] });
  const afterTrigger = t;
  let r = t;
  for (let i = 0; i < 4 && r.zones.stack.length > 0 && r.pending?.kind === 'priority'; i++) r = act(r, { type: 'pass', player: r.pending.player });
  return { afterTrigger, resolved: r };
}

describe('CR 723.1, 500.7, 113.6k: "When you cast this spell, you gain control of target opponent during that player\'s next turn. After that turn, that player takes an extra turn."', () => {
  it('the synthetic titan and the sorcery are automated (eff.edhn119.gainControlPlayer.nextTurn.thenExtraTurn, a cast trigger on the stack)', () => {
    expect(full(PROMISED)).toBe(true);
    expect(full(PROMISED_TOO)).toBe(true);
    expect(JSON.stringify(PROMISED.faces)).toContain('"thenExtraTurn":true');
  });

  it('the cast trigger resolves before the spell: the control effect waits while the titan is still on the stack', () => {
    const s0 = scenario([], { p1: { hand: ['Test Promised Titan'] }, defs: TDEFS });
    const { afterTrigger, resolved } = titanCast(s0);
    expect(afterTrigger.playerControl).toEqual([expect.objectContaining({ controller: 'p1', player: 'p2', during: 'turn', thenExtraTurn: true })]);
    expect(afterTrigger.zones.stack.some((id) => afterTrigger.objects[id]!.defId === 'Test Promised Titan')).toBe(true);
    expect(resolved.zones.battlefield.some((id) => resolved.objects[id]!.defId === 'Test Promised Titan')).toBe(true);
  });

  it('turn 2 is Bob\'s, decided by Alice; turn 3 is Bob\'s extra turn, decided by Bob; turn 4 is Alice\'s', () => {
    const s0 = scenario([], { p1: { hand: ['Test Promised Titan'] }, defs: TDEFS });
    const seen: GameState[] = [];
    const end = runUntil(titanCast(s0).resolved, turnIs(4), seen);
    const t2 = seen.filter((s) => s.turn.number === 2);
    const t3 = seen.filter((s) => s.turn.number === 3);
    expect(t2.every((s) => s.turn.activePlayer === 'p2')).toBe(true);
    expect(t3.every((s) => s.turn.activePlayer === 'p2' && s.turn.extra === true)).toBe(true);
    for (const s of t2.filter((x) => x.pending!.player === 'p2')) expect(s.pending!.decidedBy, `${s.turn.step}`).toBe('p1');
    const bobsT3 = t3.filter((x) => x.pending!.player === 'p2');
    expect(bobsT3.length).toBeGreaterThan(0);
    for (const s of bobsT3) expect(s.pending!.decidedBy).toBeUndefined();
    expect(end.turn.activePlayer).toBe('p1');
    expect(end.turn.extra).toBeUndefined();
  });

  it('negative: without the extra-turn sentence (the plain control effect) turn 3 is Alice\'s again', () => {
    const PLAIN = card('Test Plain Whip', 'Sorcery', "You control target opponent during that player's next turn.");
    const s0 = scenario([], { p1: { hand: ['Test Plain Whip'] }, defs: [PLAIN] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Plain Whip', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [bob] });
    const end = runUntil(s, turnIs(3));
    expect(end.turn.activePlayer).toBe('p1');
  });

  it('two such effects on the same turn make two extra turns (ruling 2025-01-24), each Bob\'s own', () => {
    const s0 = scenario([], { p1: { hand: ['Test Promised Echo', 'Test Promised Echo'] }, defs: TDEFS });
    let s = s0;
    for (let k = 0; k < 2; k++) {
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Promised Echo', 'hand', 'p1') });
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [bob] });
      for (let i = 0; i < 4 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    }
    expect(s.playerControl).toHaveLength(2);
    const seen: GameState[] = [];
    const end = runUntil(s, turnIs(5), seen);
    for (const n of [2, 3, 4]) expect(seen.filter((x) => x.turn.number === n).every((x) => x.turn.activePlayer === 'p2'), `turn ${n}`).toBe(true);
    for (const x of seen.filter((y) => (y.turn.number === 3 || y.turn.number === 4) && y.pending!.player === 'p2')) expect(x.pending!.decidedBy).toBeUndefined();
    expect(end.turn.activePlayer).toBe('p1');
  });

  it('negative (multiplayer, ruling 2025-01-24): the controlled player leaves the game during that turn: the extra turn never begins', () => {
    let s = mpScenario({ players: 3, defs: TDEFS, zones: { p1: { hand: ['Test Promised Echo'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Promised Echo', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [bob] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    s = runUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(s.turn.activePlayer).toBe('p2');
    s = concede(s, 'p2').state;
    const end = runUntil(s, (x) => x.turn.number === 3);
    expect(end.turn.activePlayer).toBe('p3');
    expect(end.turn.extra).toBeUndefined();
  });
});

// ---- review fixes (Opus review of edh-next-119) -----------------------------------------------------------------------------------------------------------
describe('CR 723.4, 723.5b (Emrakul ruling 2025-01-24): a controlled search of "your library and/or outside the game" offers no card from outside the game', () => {
  const TURTLES = card('Test Shell Seek', 'Instant', 'Search your library and/or outside the game for exactly three creature cards you own with different names, then reveal those cards. An opponent chooses one of them. Put the chosen cards into your hand and shuffle the rest into your library.');
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '5']);
  const setup = (agent: boolean): GameState => {
    let s = scenario([], { p1: { battlefield: agent ? ['Test Snoop'] : [] }, p2: { hand: ['Test Shell Seek'], library: ['Test Green Elk'] }, defs: [...DEFS, TURTLES, OX] });
    s = { ...s, outside: { p1: [], p2: [OX.id] } };
    s = act(s, { type: 'pass', player: 'p1' });
    return bobCasts(s, 'Test Shell Seek');
  };
  const offered = (s: GameState): string[] => (s.pending as { options: { id: string }[] }).options.map((o) => o.id);
  it('under the Agent: the decision is Alice\'s and lists the library card only', () => {
    const s = setup(true);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2', decidedBy: 'p1' });
    expect(offered(s).some((o) => o.startsWith('card:'))).toBe(false);
    expect(offered(s).some((o) => o.startsWith('obj:'))).toBe(true);
  });
  it('negative: without the Agent, Bob\'s own decision offers his card outside the game', () => {
    const s = setup(false);
    expect(s.pending!.decidedBy).toBeUndefined();
    expect(offered(s)).toContain(`card:${OX.id}`);
  });
});

describe('CR 723.9, 500.7: "You gain control of target player ..." aimed at yourself still gives the extra turn after your next turn', () => {
  it('Alice targets herself: turn 2 is Bob\'s, turn 3 Alice\'s (her own decisions), turn 4 Alice\'s extra turn', () => {
    const SELF = card('Test Self Echo', 'Sorcery', "You gain control of target player during that player's next turn. After that turn, that player takes an extra turn.");
    const s0 = scenario([], { p1: { hand: ['Test Self Echo'] }, defs: [SELF] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Self Echo', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] });
    for (let i = 0; i < 4 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    const seen: GameState[] = [];
    runUntil(s, turnIs(5), seen);
    const who = (n: number) => seen.find((x) => x.turn.number === n)!.turn.activePlayer;
    expect([who(2), who(3), who(4)]).toEqual(['p2', 'p1', 'p1']);
    expect(seen.find((x) => x.turn.number === 4)!.turn.extra).toBe(true);
    for (const x of seen.filter((y) => y.turn.number === 3 && y.pending!.player === 'p1')) expect(x.pending!.decidedBy).toBeUndefined();
  });
});
