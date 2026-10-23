/**
 * std-exile-play-1-3 (lane std-exile-play-1: play or cast from exile): the round's readings played through the engine in three-player games (two opponents), with
 * synthetic cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2d, 101.4, 601.3   "When this creature enters, each opponent exiles a card from their hand and may play that card for as long as it remains exiled.
 *   601.2f, 614.1c            Each spell cast this way costs {1} more to cast. Each land played this way enters tapped." (eff.stdexile3.eachOpponent.exilesFromHand.mayPlay
 *                             and its riders): each opponent chooses a card of their own hand and exiles it; only that opponent may play it, a spell for {1} more,
 *                             a land enters tapped; you and the other opponent may not
 *   CR 601.3, 305.1, 400.3,   "Until your next turn, players may play cards they exiled this way, and they can't play cards from their hand."
 *   611.2a, 101.2             (eff.stdexile3.players.mayPlayOwnExiled.cantPlayFromHand): each player may play the cards they exiled, not another player's; no player
 *                             casts a spell or plays a land from their hand; both end as your next turn begins
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, mpScenario, passUntil, resolveStack, type MpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const INQUISITOR = card('Test Inquisitor', 'Creature — Angel Wizard',
  'When this creature enters, each opponent exiles a card from their hand and may play that card for as long as it remains exiled. Each spell cast this way costs {1} more to cast. Each land played this way enters tapped.',
  ['2', '2']);
const LENIENT = card('Test Lenient Inquisitor', 'Creature — Angel Wizard',
  'When this creature enters, each opponent exiles a card from their hand and may play that card for as long as it remains exiled.', ['2', '2']);
const VESSEL = card('Test Vessel', 'Artifact',
  "{T}, Exile this artifact: Each player exiles the top two cards of their library. Until your next turn, players may play cards they exiled this way, and they can't play cards from their hand. Activate only as a sorcery.");
const RITE = card('Test Rite', 'Instant', 'You gain 1 life.', undefined, '{W}');
const HYMN = card('Test Hymn', 'Sorcery', 'You gain 2 life.', undefined, '{0}');
const DEFS = [INQUISITOR, LENIENT, VESSEL, RITE, HYMN];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

const named = (s: GameState, zone: 'exile' | 'battlefield', name: string, owner: PlayerId): ObjectId | undefined =>
  s.zones[zone].find((id) => s.objects[id]!.owner === owner && s.defs[s.objects[id]!.defId]!.name === name);
const casts = (s: GameState, player: PlayerId, id: ObjectId): boolean => legalActions(s, player).some((a) => a.kind === 'cast' && a.object === id);
const plays = (s: GameState, player: PlayerId, id: ObjectId): boolean => legalActions(s, player).some((a) => a.kind === 'playLand' && a.object === id);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const untapped = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && !s.objects[id]!.tapped).length;

/** p1 casts the creature; each opponent exiles the card of their hand named in `picks` (p2's first, then p3's). */
function enter(creature: string, picks: Record<string, string>, zones: MpScenario['zones'] = {}): GameState {
  let s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: [creature] }, ...zones } });
  s = act(s, { type: 'cast', player: 'p1', card: find(s, creature, 'hand', 'p1') });
  for (let i = 0; i < 200 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    const p = s.pending!;
    if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') {
      const want = picks[p.player];
      const id = p.options.find((o) => s.defs[s.objects[o]!.defId]!.name === want) ?? p.options[0]!;
      s = answer(s, { kind: 'chooseObjects', ids: [id] });
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}

describe('CR 608.2d, 101.4, 601.3: each opponent exiles a card from their own hand and only that opponent may play it', () => {
  const zones = { p2: { hand: ['Test Rite', 'Test Hymn'], battlefield: ['Plains', 'Plains'] }, p3: { hand: ['Test Hymn', 'Plains'], battlefield: ['Plains'] } };
  it('each opponent exiles the card they chose from their own hand; the other cards stay', () => {
    const s = enter('Test Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, zones);
    expect(named(s, 'exile', 'Test Rite', 'p2')).toBeDefined();
    expect(named(s, 'exile', 'Plains', 'p3')).toBeDefined();
    expect(s.zones.hand['p2']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Hymn']);
    expect(s.zones.hand['p3']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Hymn']);
  });
  it('the opponent who exiled a card may cast it; you and the other opponent may not', () => {
    const s = enter('Test Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, zones);
    const rite = named(s, 'exile', 'Test Rite', 'p2')!;
    expect(casts(s, 'p1', rite)).toBe(false);
    const s2 = act(s, { type: 'pass', player: 'p1' });
    expect(s2.pending?.player).toBe('p2');
    expect(casts(s2, 'p2', rite)).toBe(true);
    const s3 = act(s2, { type: 'pass', player: 'p2' });
    expect(s3.pending?.player).toBe('p3');
    expect(casts(s3, 'p3', rite)).toBe(false);
  });
  it('CR 601.2f: a spell cast this way costs {1} more: the opponent pays {1}{W} for a {W} instant (both lands tapped)', () => {
    let s = enter('Test Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, zones);
    const rite = named(s, 'exile', 'Test Rite', 'p2')!;
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    s = act(s, { type: 'cast', player: 'p2', card: rite });
    s = resolveStack(s);
    expect(life(s, 'p2')).toBe(21);
    expect(untapped(s, 'p2')).toBe(0);
  });
  it('without the rider the same permission costs only {W} (one land left untapped)', () => {
    let s = enter('Test Lenient Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, zones);
    const rite = named(s, 'exile', 'Test Rite', 'p2')!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'cast', player: 'p2', card: rite });
    s = resolveStack(s);
    expect(life(s, 'p2')).toBe(21);
    expect(untapped(s, 'p2')).toBe(1);
  });
  it('CR 601.2f: with one land the opponent cannot pay {1}{W} for the exiled instant', () => {
    let s = enter('Test Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, { ...zones, p2: { hand: ['Test Rite'], battlefield: ['Plains'] } });
    const rite = named(s, 'exile', 'Test Rite', 'p2')!;
    s = act(s, { type: 'pass', player: 'p1' });
    let failed = false;
    try {
      s = act(s, { type: 'cast', player: 'p2', card: rite });
      s = resolveStack(s);
      failed = life(s, 'p2') === 20;
    } catch { failed = true; }
    expect(failed).toBe(true);
  });
  it('CR 614.1c, 305.1: a land played this way enters tapped, on its owner\'s turn; a land played from the hand does not', () => {
    let s = enter('Test Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, { ...zones, p3: { hand: ['Plains', 'Plains'] } });
    const land = named(s, 'exile', 'Plains', 'p3')!;
    expect(plays(s, 'p3', land)).toBe(false); // not p3's turn (CR 305.1)
    s = passUntil(s, (t) => t.turn.activePlayer === 'p3' && t.turn.step === 'main1' && t.pending?.player === 'p3', "p3's main phase", 600);
    expect(plays(s, 'p2', land)).toBe(false);
    expect(plays(s, 'p3', land)).toBe(true);
    s = act(s, { type: 'playLand', player: 'p3', card: land });
    const played = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p3');
    expect(played.length).toBe(1);
    expect(s.objects[played[0]!]!.tapped).toBe(true);
    // the next turn's land from the hand enters untapped
    s = passUntil(s, (t) => t.turn.activePlayer === 'p3' && t.turn.number > 3 && t.turn.step === 'main1' && t.pending?.player === 'p3', "p3's next main phase", 900);
    s = act(s, { type: 'playLand', player: 'p3', card: s.zones.hand['p3']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')! });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p3' && !s.objects[id]!.tapped).length).toBeGreaterThanOrEqual(1);
  });
  it('CR 611.2b: the permission lasts across turns while the card remains exiled', () => {
    let s = enter('Test Inquisitor', { p2: 'Test Rite', p3: 'Plains' }, zones);
    const rite = named(s, 'exile', 'Test Rite', 'p2')!;
    s = passUntil(s, (t) => t.turn.number === 4 && t.turn.step === 'main1' && t.pending?.player === 'p1', 'turn 4', 900);
    expect(casts(s, 'p2', rite)).toBe(false); // p2 has no priority now; ask with p2 holding it
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    expect(casts(s, 'p2', rite)).toBe(true);
  });
});

describe('CR 601.3, 400.3, 101.2: until your next turn, players may play the cards they exiled this way and can\'t play cards from their hand', () => {
  const zones = {
    p1: { battlefield: ['Test Vessel'], hand: ['Test Hymn', 'Plains'], library: ['Test Rite', 'Test Hymn'] }, // p1 draws the Rite on turn 1 (CR 103.8a: only in a two-player game does the starting player skip it)
    p2: { hand: ['Test Hymn', 'Plains'], library: ['Test Hymn', 'Plains'] },
    p3: { hand: ['Test Hymn'], library: ['Test Hymn', 'Test Rite'] },
  };
  const activate = (): GameState => {
    // the named library cards on top (the helper adds 20 Plains above them), a Plains right under them
    const setup = (g: GameState): void => {
      for (const p of ['p1', 'p2', 'p3']) g.zones.library[p] = [...g.zones.library[p]!].sort((a, b) => Number(g.defs[g.objects[a]!.defId]!.name === 'Plains') - Number(g.defs[g.objects[b]!.defId]!.name === 'Plains'));
    };
    let s = mpScenario({ players: 3, defs: DEFS, zones, setup });
    const vessel = find(s, 'Test Vessel', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: vessel, ability: 'p:0:0' });
    for (let i = 0; i < 50 && s.pending && s.pending.kind !== 'priority'; i++) s = answer(s, { kind: 'payCost', auto: true });
    return resolveStack(s);
  };
  it('each player exiles the top two cards of their library', () => {
    const s = activate();
    for (const p of ['p1', 'p2', 'p3'] as const) expect(s.zones.exile.filter((id) => s.objects[id]!.owner === p && s.defs[s.objects[id]!.defId]!.name !== 'Test Vessel').length).toBe(2);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Vessel')).toBe(true);
  });
  it('CR 400.3: you may play the cards you exiled, not those another player exiled', () => {
    const s = activate();
    const mine = named(s, 'exile', 'Test Hymn', 'p1')!;
    const theirs = named(s, 'exile', 'Test Hymn', 'p2')!;
    expect(casts(s, 'p1', mine)).toBe(true);
    expect(casts(s, 'p1', theirs)).toBe(false);
    expect(plays(s, 'p1', named(s, 'exile', 'Plains', 'p1')!)).toBe(true);
    expect(plays(s, 'p1', named(s, 'exile', 'Plains', 'p2')!)).toBe(false);
  });
  it("CR 101.2: you can't cast a spell or play a land from your hand", () => {
    const s = activate();
    const hymn = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Hymn')!;
    const plains = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!;
    expect(casts(s, 'p1', hymn)).toBe(false);
    expect(plays(s, 'p1', plains)).toBe(false);
  });
  it('an opponent on their turn plays what they exiled and not from their hand; an instant they exiled is theirs at instant speed', () => {
    let s = activate();
    s = passUntil(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.player === 'p2', "p2's main phase", 600);
    const handLand = s.zones.hand['p2']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!;
    const handHymn = s.zones.hand['p2']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Hymn')!;
    expect(plays(s, 'p2', handLand)).toBe(false);
    expect(casts(s, 'p2', handHymn)).toBe(false);
    expect(plays(s, 'p2', named(s, 'exile', 'Plains', 'p2')!)).toBe(true);
    expect(casts(s, 'p2', named(s, 'exile', 'Test Hymn', 'p2')!)).toBe(true);
    expect(casts(s, 'p2', named(s, 'exile', 'Test Hymn', 'p3')!)).toBe(false);
  });
  it('CR 611.2a: both end as your next turn begins: the hand is playable again and the exiled cards are not', () => {
    let s = activate();
    s = passUntil(s, (t) => t.turn.number === 4 && t.turn.step === 'main1' && t.pending?.player === 'p1', 'turn 4', 900);
    const hymn = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Hymn')!;
    expect(casts(s, 'p1', hymn)).toBe(true);
    expect(casts(s, 'p1', named(s, 'exile', 'Test Hymn', 'p1')!)).toBe(false);
  });
});
