/**
 * Coordinator A, round edh-next-116 (THIRD PASS 4 over top-rank-t4): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1; Bob (p2) defends. CR cites are from memory unless noted (unverified in the record).
 *
 *   CR 608.2c, 608.2h, 701.8a   "Exile up to N target permanents. For each permanent exiled this way, its controller creates a token" (Will, Scholar of Frost)
 *   CR 101.4, 110.4, 701.21a    "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest" (Cataclysm)
 *   CR 205.2a, 205.4a           "Return target artifact, enchantment, or legendary card from your graveyard to your hand" (Rob the Hoard)
 *   CR 601.3, 602.5, 606.1      "Your opponents can't cast spells or activate planeswalkers' loyalty abilities this turn" (Revel in Silence)
 *   CR 208.1, 608.2h            "the greatest power among other Dragons you control and Dragon cards in your graveyard" (Skanos Dragonheart)
 *   CR 122.1, 701.8a, 608.2c    "Put two loyalty counters on it for each planeswalker destroyed this way" (The Elderspell)
 *   CR 400.7, 506.1             "target creature card in your graveyard that wasn't put there this combat" (Storrev, Devkarin Lich)
 *   CR 603.4, 607.2a, 601.2a    "Whenever a creature enters, if it was cast, exile it, then return all other permanent cards exiled with ~" (Mirror of Life Trapping)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, pass, put, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const bf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).filter((n) => n !== 'Plains').sort();
const yard = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).filter((n) => n !== 'Plains').sort();
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

interface Script { targets?: ObjectId[]; pick?: (options: ObjectId[], who: PlayerId, s: GameState) => ObjectId[]; seen?: { targetOptions?: ObjectId[] } }
/** Answers what is asked until the stack is empty and a player has priority. */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending as unknown as { kind: string; player: PlayerId; options?: ObjectId[]; min?: number; max?: number; objects?: ObjectId[] } | null;
    if (p === null || p === undefined) break;
    if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    let a: DecisionAnswer;
    if (p.kind === 'chooseTargets') {
      if (sc.seen !== undefined) sc.seen.targetOptions = p.objects ?? [];
      a = { kind: 'chooseTargets', targets: targets.splice(0, targets.length).map((id) => ({ kind: 'object', id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: true } as DecisionAnswer;
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: sc.pick !== undefined ? sc.pick(p.options ?? [], p.player, s) : (p.options ?? []).slice(0, p.min ?? 0) } as DecisionAnswer;
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) } as unknown as DecisionAnswer;
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
    s = answer(s, a);
  }
  return s;
}
const cast = (s: GameState, player: PlayerId, name: string, sc: Script = {}): GameState => run(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), sc);
const idOf = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'hand' | 'exile', p?: PlayerId): ObjectId => find(s, name, zone, p);

// ---- Will, Scholar of Frost -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 608.2h, 701.8a: "Exile up to three target permanents. For each permanent exiled this way, its controller creates a Knight token."', () => {
  const BURST = card('Test Knightly Exile', 'Sorcery', 'Exile up to three target permanents. For each permanent exiled this way, its controller creates a 4/4 blue and red Elemental creature token.');
  const BEAR = card('Test Ash Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const start = (): GameState => scenario(['Mountain'], { defs: [BURST, BEAR], p1: { hand: ['Test Knightly Exile'], battlefield: ['Test Ash Bear', 'Mountain'] }, p2: { battlefield: ['Test Ash Bear'] } });
  it('is automated', () => { expect(noManual(BURST)).toBe(true); });
  it('each exiled permanent gives its own controller one Elemental: one for Alice (her Mountain) and one for Bob (his Bear)', () => {
    const s0 = start();
    const targets = [idOf(s0, 'Mountain', 'battlefield', 'p1'), idOf(s0, 'Test Ash Bear', 'battlefield', 'p2')];
    const s = cast(s0, 'p1', 'Test Knightly Exile', { targets });
    const tokens = (p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token').length;
    expect(tokens('p1')).toBe(1);
    expect(tokens('p2')).toBe(1);
    expect(find(s, 'Mountain', 'exile')).toBeDefined();
    expect(bf(s, 'p2')).not.toContain('Test Ash Bear');
  });
  it('negative: with no target chosen (up to three) nothing is exiled and no token is made', () => {
    const s = cast(start(), 'p1', 'Test Knightly Exile', { targets: [] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
    expect(bf(s, 'p2')).toContain('Test Ash Bear');
  });
});

// ---- Cataclysm ---------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 110.4, 701.21a: "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest."', () => {
  const CATA = card('Test Levelling Wave', 'Sorcery', 'Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest.');
  const ART = card('Test Trinket', 'Artifact', '');
  const GOLEM = card('Test Brass Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const BEAR = card('Test Wood Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const AURA = card('Test Wall Banner', 'Enchantment', '');
  const WALKER = card('Test Idle Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
  const defs = [CATA, ART, GOLEM, BEAR, AURA, WALKER];
  const base = (extra1: string[] = [], extra2: string[] = []): GameState => {
    const s = scenario(['Mountain', 'Island'], { defs, p1: { hand: ['Test Levelling Wave'], battlefield: ['Test Trinket', 'Test Wood Bear', 'Test Wall Banner', 'Mountain', ...extra1] }, p2: { battlefield: ['Island', ...extra2] } });
    return tweak(s, (x) => { for (const id of x.zones.battlefield) if (x.defs[x.objects[id]!.defId]!.name === 'Test Idle Walker') x.objects[id]!.counters['loyalty'] = 3; });
  };
  it('is automated', () => { expect(noManual(CATA)).toBe(true); });
  it('each player keeps one permanent of each of the four types and sacrifices everything else, planeswalkers too (first offered chosen each time)', () => {
    const s = cast(base(['Test Trinket', 'Test Wood Bear', 'Mountain', 'Test Idle Walker'], ['Test Wood Bear', 'Test Wood Bear', 'Island']), 'p1', 'Test Levelling Wave', { pick: (o) => [o[0]!] });
    expect(bf(s, 'p1')).toEqual(['Mountain', 'Test Trinket', 'Test Wall Banner', 'Test Wood Bear']);
    expect(bf(s, 'p2')).toEqual(['Island', 'Test Wood Bear']);
    expect(yard(s, 'p1')).toEqual(expect.arrayContaining(['Test Idle Walker', 'Test Trinket', 'Test Wood Bear', 'Mountain']));
  });
  it('an artifact creature may be chosen for both the artifact and the creature (Scryfall ruling 2004-10-04): the other creature and artifact go', () => {
    const s = cast(base(['Test Brass Golem']), 'p1', 'Test Levelling Wave', { pick: (o, _w, st) => { const g = o.find((id) => nameOf(st, id) === 'Test Brass Golem'); return [g ?? o[0]!]; } });
    expect(bf(s, 'p1')).toEqual(['Mountain', 'Test Brass Golem', 'Test Wall Banner']);
  });
  it('negative: a player with exactly one permanent of a type keeps it with no choice; a planeswalker is never among the choices', () => {
    const s = cast(base(['Test Idle Walker']), 'p1', 'Test Levelling Wave', { pick: (o) => [o[0]!] });
    expect(bf(s, 'p1')).not.toContain('Test Idle Walker');
    expect(bf(s, 'p2')).toEqual(['Island']);
    expect(bf(s, 'p1')).toEqual(['Mountain', 'Test Trinket', 'Test Wall Banner', 'Test Wood Bear']);
  });
});

// ---- Rob the Hoard ----------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 205.2a, 205.4a: "Return target artifact, enchantment, or legendary card from your graveyard to your hand."', () => {
  const RAID = card('Test Hoard Raid', 'Sorcery', 'Return target artifact, enchantment, or legendary card from your graveyard to your hand.');
  const ART = card('Test Old Trinket', 'Artifact', '');
  const ENCH = card('Test Old Banner', 'Enchantment', '');
  const LEGEND = card('Test Old Hero', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
  const BEAR = card('Test Old Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const LAND = card('Test Old Legend Land', 'Legendary Land', '');
  const SORC = card('Test Old Rite', 'Sorcery', 'You gain 1 life.');
  const defs = [RAID, ART, ENCH, LEGEND, BEAR, LAND, SORC];
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Hoard Raid'], graveyard: ['Test Old Trinket', 'Test Old Banner', 'Test Old Hero', 'Test Old Bear', 'Test Old Legend Land', 'Test Old Rite'] }, p2: { graveyard: ['Test Old Trinket'] } });
  it('is automated', () => { expect(noManual(RAID)).toBe(true); });
  it('the legal targets are the artifact, the enchantment and the legendary cards of your own graveyard; the plain creature and the sorcery, and the opponent\'s artifact, are not', () => {
    const seen: Script['seen'] = {};
    const s0 = start();
    const hero = idOf(s0, 'Test Old Hero', 'graveyard', 'p1');
    const s = cast(s0, 'p1', 'Test Hoard Raid', { targets: [hero], seen });
    expect(seen.targetOptions!.map((id) => nameOf(s0, id)).sort()).toEqual(['Test Old Banner', 'Test Old Hero', 'Test Old Legend Land', 'Test Old Trinket']);
    expect(hand(s, 'p1')).toEqual(['Test Old Hero']);
  });
  it('negative: a card that is none of the three (the plain creature) cannot be chosen as the target', () => {
    const s0 = start();
    const seen: Script['seen'] = {};
    cast(s0, 'p1', 'Test Hoard Raid', { targets: [idOf(s0, 'Test Old Banner', 'graveyard', 'p1')], seen });
    expect(seen.targetOptions!.map((id) => nameOf(s0, id))).not.toContain('Test Old Bear');
    expect(seen.targetOptions!.map((id) => nameOf(s0, id))).not.toContain('Test Old Rite');
  });
});

// ---- Revel in Silence ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.3, 602.5, 606.1: "Your opponents can\'t cast spells or activate planeswalkers\' loyalty abilities this turn."', () => {
  const HUSH = card('Test Hushing Word', 'Instant', 'Your opponents can\'t cast spells or activate planeswalkers\' loyalty abilities this turn. Exile Test Hushing Word.');
  const WALKER = card('Test Quiet Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
  const STONE = card('Test Calm Stone', 'Artifact', '{T}: You gain 1 life.');
  const RITE = card('Test Small Rite', 'Sorcery', 'You gain 1 life.');
  const defs = [HUSH, WALKER, STONE, RITE];
  const withWalker = (s: GameState): GameState => tweak(s, (x) => { x.objects[put(x, 'p1', 'battlefield', 'Test Quiet Walker')]!.counters['loyalty'] = 5; });
  const start = (): GameState => withWalker(scenario([], { defs, p1: { hand: ['Test Small Rite'], battlefield: ['Test Calm Stone'] }, p2: { hand: ['Test Hushing Word'] } }));
  it('is automated', () => { expect(noManual(HUSH)).toBe(true); });
  it('after Bob casts it, Alice can\'t cast a spell or activate her planeswalker\'s loyalty ability, but can still activate an artifact\'s ability; the spell exiles itself', () => {
    let s = pass(start()); // Alice passes with an empty stack: Bob may cast an instant
    s = run(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hushing Word', 'hand', 'p2') } as never));
    expect(s.pending?.kind).toBe('priority');
    expect(find(s, 'Test Hushing Word', 'exile')).toBeDefined();
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Rite', 'hand', 'p1') } as never).rules.join()).toMatch(/601|101/);
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Quiet Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).rules.join()).toMatch(/602|606|101/);
    const l0 = lifeOf(s, 'p1');
    s = run(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Calm Stone', 'battlefield', 'p1'), ability: 'p:0:0' }));
    expect(lifeOf(s, 'p1')).toBe(l0 + 1);
  });
  it('negative: without the spell Alice casts her sorcery and activates the loyalty ability', () => {
    let s = start();
    const l0 = lifeOf(s, 'p1');
    s = run(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Quiet Walker', 'battlefield', 'p1'), ability: 'p:0:0' }));
    s = cast(s, 'p1', 'Test Small Rite');
    expect(lifeOf(s, 'p1')).toBe(l0 + 2);
  });
});

// ---- Skanos Dragonheart ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 208.1, 608.2h: "it gets +X/+X until end of turn, where X is the greatest power among other Dragons you control and Dragon cards in your graveyard."', () => {
  const LORD = card('Test Wyrm Lord', 'Legendary Creature — Dragon', 'Whenever this creature attacks, it gets +X/+X until end of turn, where X is the greatest power among other Dragons you control and Dragon cards in your graveyard.', { pt: ['2', '2'] });
  const D3 = card('Test Small Drake', 'Creature — Dragon', '', { pt: ['3', '3'] });
  const D5 = card('Test Dead Drake', 'Creature — Dragon', '', { pt: ['5', '5'] });
  const D7 = card('Test Enemy Drake', 'Creature — Dragon', '', { pt: ['7', '7'] });
  const B9 = card('Test Dead Giant', 'Creature — Giant', '', { pt: ['9', '9'] });
  const defs = [LORD, D3, D5, D7, B9];
  const attackPower = (s0: GameState): number => {
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Wyrm Lord', 'battlefield', 'p1')]]);
    s = run(s);
    return Number(getChars(s, find(s, 'Test Wyrm Lord', 'battlefield', 'p1'))!.power!);
  };
  it('is automated', () => { expect(noManual(LORD)).toBe(true); });
  it('counts the Dragons on the battlefield and the Dragon cards in your own graveyard: max(3, 5) = 5, so 2 + 5 = 7; an opponent\'s Dragon card (7) and a non-Dragon card (9) do not count', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Wyrm Lord', 'Test Small Drake'], graveyard: ['Test Dead Drake', 'Test Dead Giant'] }, p2: { graveyard: ['Test Enemy Drake'] } });
    expect(attackPower(s)).toBe(7);
  });
  it('the Dragon in the graveyard can be the greater, and the attacker itself is not counted: alone it gets +0', () => {
    expect(attackPower(scenario([], { defs, p1: { battlefield: ['Test Wyrm Lord'], graveyard: ['Test Dead Drake'] } }))).toBe(7);
    expect(attackPower(scenario([], { defs, p1: { battlefield: ['Test Wyrm Lord'] } }))).toBe(2);
    expect(attackPower(scenario([], { defs, p1: { battlefield: ['Test Wyrm Lord', 'Test Small Drake'] } }))).toBe(5);
  });
});

// ---- The Elderspell ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.8a, 122.1, 608.2c: "Destroy any number of target planeswalkers. Choose a planeswalker you control. Put two loyalty counters on it for each planeswalker destroyed this way."', () => {
  const SPELL = card('Test Walker Purge', 'Sorcery', 'Destroy any number of target planeswalkers. Choose a planeswalker you control. Put two loyalty counters on it for each planeswalker destroyed this way.');
  const W = (n: string, extra = ''): CardDef => card(n, 'Legendary Planeswalker — Testa', `${extra}+1: You gain 1 life.`);
  const A = W('Test Walker Alpha'); const B = W('Test Walker Beta'); const C = W('Test Walker Gamma');
  const STURDY = card('Test Walker Sturdy', 'Legendary Planeswalker — Testa', 'Test Walker Sturdy has indestructible.\n+1: You gain 1 life.');
  const defs = [SPELL, A, B, C, STURDY];
  const L3 = (name: string): { name: string; counters: Record<string, number> } => ({ name, counters: { loyalty: 3 } });
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Walker Purge'], battlefield: [L3('Test Walker Alpha')] }, p2: { battlefield: [L3('Test Walker Beta'), L3('Test Walker Gamma'), L3('Test Walker Sturdy')] } });
  const loyalty = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters['loyalty'] ?? 0;
  it('is automated', () => { expect(noManual(SPELL)).toBe(true); });
  it('two destroyed planeswalkers give your planeswalker four loyalty counters: 3 + 4 = 7', () => {
    const s0 = start();
    const s = cast(s0, 'p1', 'Test Walker Purge', { targets: [find(s0, 'Test Walker Beta', 'battlefield'), find(s0, 'Test Walker Gamma', 'battlefield')] });
    expect(loyalty(s, 'Test Walker Alpha')).toBe(7);
    expect(bf(s, 'p2')).toEqual(['Test Walker Sturdy']);
  });
  it('negatives: an indestructible planeswalker is not destroyed and gives no counters; with no target nothing is added', () => {
    const s0 = start();
    const s = cast(s0, 'p1', 'Test Walker Purge', { targets: [find(s0, 'Test Walker Sturdy', 'battlefield'), find(s0, 'Test Walker Beta', 'battlefield')] });
    expect(loyalty(s, 'Test Walker Alpha')).toBe(5);
    expect(bf(s, 'p2')).toEqual(['Test Walker Gamma', 'Test Walker Sturdy']);
    expect(loyalty(cast(start(), 'p1', 'Test Walker Purge', { targets: [] }), 'Test Walker Alpha')).toBe(3);
  });
});

// ---- Storrev ----------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 400.7, 506.1: "return to your hand target creature or planeswalker card in your graveyard that wasn\'t put there this combat."', () => {
  const LICH = card('Test Grave Lich', 'Legendary Creature — Zombie', 'Whenever this creature deals combat damage to a player or planeswalker, return to your hand target creature or planeswalker card in your graveyard that wasn\'t put there this combat.', { pt: ['2', '2'] });
  const OLD = card('Test Elder Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DOOMED = card('Test Doomed Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
  const WALL = card('Test Big Wall', 'Creature — Wall', '', { pt: ['3', '3'] });
  const defs = [LICH, OLD, DOOMED, WALL];
  it('is automated', () => { expect(noManual(LICH)).toBe(true); });
  it('a creature that died in this combat is not a legal target; the one that was in the graveyard before is', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grave Lich', 'Test Doomed Bear'], graveyard: ['Test Elder Bear'] }, p2: { battlefield: ['Test Big Wall'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Grave Lich', 'battlefield', 'p1')], [find(s0, 'Test Doomed Bear', 'battlefield', 'p1')]]);
    s = declareBlockers(toDeclareBlockers(s), [[find(s, 'Test Big Wall', 'battlefield', 'p2'), find(s, 'Test Doomed Bear', 'battlefield', 'p1')]]);
    const seen: Script['seen'] = {};
    // pass until the trigger asks for its target
    for (let i = 0; i < 20 && s.pending?.kind !== 'chooseTargets'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(yard(s, 'p1')).toContain('Test Doomed Bear');
    const options = (s.pending as unknown as { objects: ObjectId[] }).objects.map((id) => nameOf(s, id));
    expect(options).toEqual(['Test Elder Bear']);
    expect(seen.targetOptions).toBeUndefined();
  });
  it('negative: the same card is a legal target once the combat is over (the history is of this combat only)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grave Lich'], graveyard: ['Test Elder Bear'] }, p2: { battlefield: [] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Grave Lich', 'battlefield', 'p1')]]);
    for (let i = 0; i < 20 && s.pending?.kind !== 'chooseTargets'; i++) s = pass(s);
    const t = (s.pending as unknown as { objects: ObjectId[] }).objects;
    s = run(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: t[0]! }] } as DecisionAnswer));
    expect(hand(s, 'p1')).toContain('Test Elder Bear');
  });
});

// ---- Mirror of Life Trapping ---------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.4, 607.2a, 601.2a: "Whenever a creature enters, if it was cast, exile it, then return all other permanent cards exiled with ~ to the battlefield under their owners\' control."', () => {
  const MIRROR = card('Test Trap Glass', 'Artifact', 'Whenever a creature enters, if it was cast, exile it, then return all other permanent cards exiled with this artifact to the battlefield under their owners\' control.');
  const ONE = card('Test First Guest', 'Creature — Human', '', { pt: ['1', '1'] });
  const TWO = card('Test Second Guest', 'Creature — Human', '', { pt: ['2', '2'] });
  const RAISE = card('Test Raise Rite', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const defs = [MIRROR, ONE, TWO, RAISE];
  it('is automated', () => { expect(noManual(MIRROR)).toBe(true); });
  it('the first cast creature is exiled; the second cast creature is exiled and the first returns', () => {
    let s = scenario([], { defs, p1: { hand: ['Test First Guest', 'Test Second Guest'], battlefield: ['Test Trap Glass'] } });
    s = cast(s, 'p1', 'Test First Guest');
    expect(bf(s, 'p1')).toEqual(['Test Trap Glass']);
    expect(find(s, 'Test First Guest', 'exile')).toBeDefined();
    s = cast(s, 'p1', 'Test Second Guest');
    expect(bf(s, 'p1')).toEqual(['Test First Guest', 'Test Trap Glass']);
    expect(find(s, 'Test Second Guest', 'exile')).toBeDefined();
  });
  it('negative: a creature that entered without being cast (returned from the graveyard) is not exiled and returns nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test First Guest', 'Test Raise Rite'], battlefield: ['Test Trap Glass'], graveyard: ['Test Second Guest'] } });
    s = cast(s, 'p1', 'Test First Guest');
    s = cast(s, 'p1', 'Test Raise Rite', { targets: [find(s, 'Test Second Guest', 'graveyard', 'p1')] });
    expect(bf(s, 'p1')).toEqual(['Test Second Guest', 'Test Trap Glass']);
    expect(find(s, 'Test First Guest', 'exile')).toBeDefined();
  });
});
