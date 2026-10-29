/**
 * Commander lane edh-cast, round edh-cast-1: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not
 * in the cloud checkout).
 *
 *   CR 601.2f, 118.7, 105.2     "Each spell you cast that's red or green costs {1} less to cast.": a red or green spell is cheaper, a blue one is not
 *   CR 601.2f, 208.1            "Creature spells you cast with power 4 or greater cost {2} less to cast.": power 4 is cheaper, power 3 is not
 *   CR 118.9, 202.3, 401.5      "You may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value ...": life, not mana
 *   CR 305.1, 601.3, 700.6      "You may play historic lands and cast historic spells from the top of your library."
 *   CR 611.2c, 613.1f           "Each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.": the set is fixed when the effect resolves
 *   CR 702.85a, 601.2           "Spells you cast with mana value 6 or greater have cascade."
 *   CR 101.2, 701.6a            "Creature spells you cast this turn can't be countered."
 *   CR 115.7, 115.7a            "Change a target of target spell or ability to ~." and the single-target form
 *   CR 707.10, 707.10c, 400.3   "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy."
 *   CR 707.12, 707.10a, 607.2a  "You may copy the exiled card. If you do, you may cast the copy without paying its mana cost."
 *   CR 115.9b, 701.6a           "Counter target spell or ability that targets you or a creature you control."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { pt, resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? (type.includes('Land') ? '' : '{0}'), type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const give = (s: GameState, player: 'p1' | 'p2', mana: string): void => { for (const t of mana) s.players[player === 'p1' ? 0 : 1]!.manaPool.push({ type: t } as never); };
const castFrom = (s: GameState, id: ObjectId, player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: id }));
const canCast = (s: GameState, id: ObjectId, player = 'p1'): boolean => {
  try { return settle(act(s, { type: 'cast', player, card: id })).zones.stack.length > 0; } catch { return false; }
};

describe('CR 601.2f, 118.7, 105.2: "Each spell you cast that\'s red or green costs {1} less to cast."', () => {
  const LORD = card('Test Hue Lord', 'Creature — Goblin', "Each spell you cast that's red or green costs {1} less to cast.", { pt: ['1', '1'] });
  const RED = card('Test Red Spell', 'Sorcery', '', { cost: '{1}{R}', colors: ['R'] });
  const GREEN = card('Test Green Spell', 'Sorcery', '', { cost: '{1}{G}', colors: ['G'] });
  const BLUE = card('Test Blue Spell', 'Sorcery', '', { cost: '{1}{U}', colors: ['U'] });
  const defs = [LORD, RED, GREEN, BLUE];
  it('is automated; a red and a green spell cost one less, a blue spell does not', () => {
    expect(full(LORD)).toBe(true);
    const mk = (n: string, mana: string) => { const s = scenario([], { p1: { battlefield: ['Test Hue Lord'], hand: [n] }, defs }); give(s, 'p1', mana); return canCast(s, find(s, n, 'hand', 'p1')); };
    expect(mk('Test Red Spell', 'R')).toBe(true);
    expect(mk('Test Green Spell', 'G')).toBe(true);
    expect(mk('Test Blue Spell', 'U')).toBe(false);
    expect(mk('Test Blue Spell', 'UU')).toBe(true);
  });
  it('without the lord the same spell costs its full price', () => {
    const s = scenario([], { p1: { hand: ['Test Red Spell'] }, defs });
    give(s, 'p1', 'R');
    expect(canCast(s, find(s, 'Test Red Spell', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 601.2f, 208.1: "Creature spells you cast with power 4 or greater cost {2} less to cast."', () => {
  const CALLER = card('Test Giant Caller', 'Creature — Giant', 'Creature spells you cast with power 4 or greater cost {2} less to cast.', { pt: ['1', '1'] });
  const BIG = card('Test Big Beast', 'Creature — Beast', '', { pt: ['4', '4'], cost: '{3}{G}', colors: ['G'] });
  const SMALL = card('Test Small Beast', 'Creature — Beast', '', { pt: ['3', '3'], cost: '{3}{G}', colors: ['G'] });
  const NONCREATURE = card('Test Big Charm', 'Sorcery', '', { cost: '{3}{G}', colors: ['G'] });
  const defs = [CALLER, BIG, SMALL, NONCREATURE];
  it('is automated; power 4 costs {1}{G}; power 3 and a noncreature spell cost the full {3}{G}', () => {
    expect(full(CALLER)).toBe(true);
    const mk = (n: string, mana: string) => { const s = scenario([], { p1: { battlefield: ['Test Giant Caller'], hand: [n] }, defs }); give(s, 'p1', mana); return canCast(s, find(s, n, 'hand', 'p1')); };
    expect(mk('Test Big Beast', 'GG')).toBe(true);
    expect(mk('Test Small Beast', 'GG')).toBe(false);
    expect(mk('Test Small Beast', 'GGGG')).toBe(true);
    expect(mk('Test Big Charm', 'GG')).toBe(false);
  });
});

describe('CR 118.9, 202.3, 401.5: "You may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost."', () => {
  const CITADEL = card('Test Top Citadel', 'Artifact', 'You may look at the top card of your library any time.\nYou may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.');
  const SPELL = card('Test Top Sorcery', 'Sorcery', '', { cost: '{2}{R}', colors: ['R'] });
  const LAND = card('Test Top Land', 'Land', '');
  const defs = [CITADEL, SPELL, LAND];
  const lifeOf = (s: GameState, p = 0): number => s.players[p]!.life;
  it('is automated; the top spell is cast for life equal to its mana value with an empty mana pool', () => {
    expect(full(CITADEL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Top Citadel'], library: ['Test Top Sorcery'] }, defs });
    const id = find(s0, 'Test Top Sorcery', 'library', 'p1');
    const before = lifeOf(s0);
    const s = castFrom(s0, id);
    expect(s.zones.stack.length).toBe(1);
    expect(s.defs[s.objects[s.zones.stack[0]!]!.defId]!.name).toBe('Test Top Sorcery');
    expect(lifeOf(s)).toBe(before - 3);
  });
  it('the top land is played; a card that is not on top, and an opponent\'s library, are not offered', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Top Citadel'], library: ['Test Top Land', 'Test Top Sorcery'] }, p2: { library: ['Test Top Sorcery'] }, defs });
    const land = find(s0, 'Test Top Land', 'library', 'p1');
    const s = settle(act(s0, { type: 'playLand', player: 'p1', card: land }));
    expect(find(s, 'Test Top Land', 'battlefield', 'p1')).toBeDefined();
    const s1 = scenario([], { p1: { battlefield: ['Test Top Citadel'], library: ['Test Top Land', 'Test Top Sorcery'] }, defs });
    expect(canCast(s1, find(s1, 'Test Top Sorcery', 'library', 'p1'))).toBe(false); // second from the top
    const s2 = scenario([], { p1: { battlefield: ['Test Top Citadel'] }, p2: { library: ['Test Top Sorcery'] }, defs });
    expect(canCast(s2, find(s2, 'Test Top Sorcery', 'library', 'p2'))).toBe(false);
  });
  it('without the artifact the top card cannot be cast', () => {
    const s0 = scenario([], { p1: { library: ['Test Top Sorcery'] }, defs });
    expect(canCast(s0, find(s0, 'Test Top Sorcery', 'library', 'p1'))).toBe(false);
  });
});

describe('CR 305.1, 601.3, 700.6: "You may play historic lands and cast historic spells from the top of your library."', () => {
  const SKULL = card('Test Historic Skull', 'Artifact', 'You may look at the top card of your library any time.\nYou may play historic lands and cast historic spells from the top of your library.');
  const RELIC = card('Test Top Relic', 'Artifact', '', { cost: '{2}' });
  const KING = card('Test Top King', 'Legendary Creature — Human', '', { pt: ['2', '2'], cost: '{2}' });
  const BEAR = card('Test Top Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}' });
  const SHRINE = card('Test Top Shrine', 'Legendary Land', '');
  const FIELD = card('Test Top Field', 'Land', '');
  const defs = [SKULL, RELIC, KING, BEAR, SHRINE, FIELD];
  const top = (name: string, mana = 'CC') => { const s = scenario([], { p1: { battlefield: ['Test Historic Skull'], library: [name] }, defs }); give(s, 'p1', mana); return s; };
  it('is automated; an artifact and a legendary spell on top can be cast, a plain creature cannot', () => {
    expect(full(SKULL)).toBe(true);
    for (const n of ['Test Top Relic', 'Test Top King']) { const s = top(n); expect(canCast(s, find(s, n, 'library', 'p1')), n).toBe(true); }
    const s = top('Test Top Bear');
    expect(canCast(s, find(s, 'Test Top Bear', 'library', 'p1'))).toBe(false);
  });
  it('a legendary land on top can be played, a plain land cannot', () => {
    const ok = top('Test Top Shrine');
    expect(find(settle(act(ok, { type: 'playLand', player: 'p1', card: find(ok, 'Test Top Shrine', 'library', 'p1') })), 'Test Top Shrine', 'battlefield', 'p1')).toBeDefined();
    const no = top('Test Top Field');
    expect(() => act(no, { type: 'playLand', player: 'p1', card: find(no, 'Test Top Field', 'library', 'p1') })).toThrow();
  });
});

describe('CR 611.2c, 613.1f: "Each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn."', () => {
  const SURGE = card('Test Mighty Surge', 'Sorcery', 'Each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn.');
  const PUMP = card('Test Small Pump', 'Sorcery', 'Target creature gets +1/+0 until end of turn.');
  const BIG = card('Test Surge Giant', 'Creature — Giant', '', { pt: ['4', '4'] });
  const SMALL = card('Test Surge Cub', 'Creature — Bear', '', { pt: ['3', '3'] });
  const THEIRS = card('Test Surge Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
  const defs = [SURGE, PUMP, BIG, SMALL, THEIRS];
  const board = (): GameState => scenario([], { p1: { hand: ['Test Mighty Surge', 'Test Small Pump'], battlefield: ['Test Surge Giant', 'Test Surge Cub'] }, p2: { battlefield: ['Test Surge Ogre'] }, defs });
  it('is automated; the 4-power creature gets +1/+1 and trample, the 3-power one and an opponent\'s do not', () => {
    expect(full(SURGE)).toBe(true);
    const s = resolveAll(castFrom(board(), find(board(), 'Test Mighty Surge', 'hand', 'p1')));
    const giant = find(s, 'Test Surge Giant', 'battlefield', 'p1');
    const cub = find(s, 'Test Surge Cub', 'battlefield', 'p1');
    expect(pt(s, giant)).toBe('5/5');
    expect(pt(s, cub)).toBe('3/3');
    expect(pt(s, find(s, 'Test Surge Ogre', 'battlefield', 'p2'))).toBe('5/5');
  });
  it('the creatures are fixed as the effect resolves: a creature that reaches power 4 afterwards gets nothing (CR 611.2c)', () => {
    const b = board();
    let s = resolveAll(castFrom(b, find(b, 'Test Mighty Surge', 'hand', 'p1')));
    const cub = find(s, 'Test Surge Cub', 'battlefield', 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Pump', 'hand', 'p1') }), { targets: [{ kind: 'object', id: cub }] }));
    expect(pt(s, cub)).toBe('4/3');
  });
});

describe('CR 702.85a, 601.2: "Spells you cast with mana value 6 or greater have cascade."', () => {
  const BOSS = card('Test Cascade Boss', 'Creature — Giant', 'Spells you cast with mana value 6 or greater have cascade.', { pt: ['1', '1'] });
  const SIX = card('Test Six Drop', 'Sorcery', '', { cost: '{6}' });
  const FIVE = card('Test Five Drop', 'Sorcery', '', { cost: '{5}' });
  const CHEAP = card('Test Cheap Spell', 'Instant', '', { cost: '{1}' });
  const defs = [BOSS, SIX, FIVE, CHEAP];
  const run = (spell: string, mana: string, boss = true): GameState => {
    const s = scenario([], { p1: { battlefield: boss ? ['Test Cascade Boss'] : [], hand: [spell], library: ['Test Cheap Spell'] }, defs });
    give(s, 'p1', mana);
    return castFrom(s, find(s, spell, 'hand', 'p1'));
  };
  it('is automated; a spell of mana value 6 triggers cascade as it is cast; one of mana value 5 does not; nor does it without the creature', () => {
    expect(full(BOSS)).toBe(true);
    expect(run('Test Six Drop', 'CCCCCC').zones.stack.length).toBe(2);
    expect(run('Test Five Drop', 'CCCCC').zones.stack.length).toBe(1);
    expect(run('Test Six Drop', 'CCCCCC', false).zones.stack.length).toBe(1);
  });
});

describe('CR 101.2, 701.6a: "Creature spells you cast this turn can\'t be countered."', () => {
  const WALKER = card('Test Ward Sorcery', 'Sorcery', "Creature spells you cast this turn can't be countered.");
  const BEAR = card('Test Warded Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const CHARM = card('Test Warded Charm', 'Sorcery', '');
  const CANCEL = card('Test Plain Cancel', 'Instant', 'Counter target spell.', { cost: '{U}', colors: ['U'] });
  const defs = [WALKER, BEAR, CHARM, CANCEL];
  const cancelled = (spell: string, ward: boolean): boolean => {
    let s = scenario([], { p1: { hand: ['Test Ward Sorcery', spell] }, p2: { hand: ['Test Plain Cancel'] }, defs });
    if (ward) s = resolveAll(castFrom(s, find(s, 'Test Ward Sorcery', 'hand', 'p1')));
    s = castFrom(s, find(s, spell, 'hand', 'p1'));
    const onStack = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s); // p1 passes; p2 has priority
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Plain Cancel', 'hand', 'p2') }), { targets: [{ kind: 'object', id: onStack }] });
    s = resolveAll(s);
    return s.zones.battlefield.every((id) => s.objects[id]!.defId !== spell) && !s.zones.stack.length && (s.zones.graveyard['p1'] ?? []).some((id) => s.objects[id]!.defId === spell);
  };
  it('is automated; after it resolves a creature spell you cast cannot be countered, a noncreature spell still can', () => {
    expect(full(WALKER)).toBe(true);
    expect(cancelled('Test Warded Bear', false)).toBe(true);
    expect(cancelled('Test Warded Bear', true)).toBe(false);
    expect(cancelled('Test Warded Charm', true)).toBe(true);
  });
});

/** The activations `player` is offered for `source`. */
const activations = (s: GameState, source: ObjectId, player: 'p1' | 'p2'): ReturnType<typeof legalActions> => legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === source);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
/** Cast a card of the hand and answer its target questions in order, one target each. */
function castTargeting(s0: GameState, name: string, targets: (ObjectId | TargetChoice)[], player: 'p1' | 'p2' = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  const rest = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [((t) => (typeof t === 'string' ? obj(t) : t))(rest.shift()!)] });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  return s;
}

describe('CR 115.7, 115.7a: "Change a target of target spell or ability to ~." (Spellskite) and the single-target form (Hydroelectric Specimen)', () => {
  const SKITE = card('Test Skite', 'Artifact Creature — Horror', '{U}: Change a target of target spell or ability to ~.', { pt: ['0', '4'] });
  const FLASH = card('Test Flash Reflector', 'Creature — Wizard', 'Flash\nWhen this creature enters, you may change the target of target instant or sorcery spell with a single target to this creature.', { pt: ['1', '1'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target creature.');
  const RAZE = card('Test Raze', 'Sorcery', 'Destroy target land.');
  const PAIR = card('Test Pair Zap', 'Instant', 'Test Pair Zap deals 1 damage to target creature and 1 damage to target creature you don\'t control.');
  const VICTIM = card('Test Victim', 'Creature — Bear', '', { pt: ['5', '5'] });
  const FARM = card('Test Farm', 'Land', '');
  const defs = [SKITE, FLASH, ZAP, RAZE, PAIR, VICTIM, FARM];
  it('are automated', () => { expect(full(SKITE) && full(FLASH)).toBe(true); });
  it('the controller of the ability changes the one target to the source: the spell then hits it and the original target is untouched', () => {
    let s = scenario([], { p1: { hand: ['Test Zap'], battlefield: ['Test Victim'] }, p2: { battlefield: ['Test Skite'] }, defs });
    const victim = find(s, 'Test Victim', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') }), { targets: [obj(victim)] });
    const zap = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    const skite = find(s, 'Test Skite', 'battlefield', 'p2');
    const a = activations(s, skite, 'p2')[0];
    expect(a).toBeDefined();
    s = resolveAll(settle(act(s, a!.action), { targets: [obj(zap)] }));
    expect(dmg(s, find(s, 'Test Skite', 'battlefield', 'p2'))).toBe(3);
    expect(dmg(s, find(s, 'Test Victim', 'battlefield', 'p1'))).toBe(0);
  });
  it('a target the source cannot legally become stays: a spell that targets a land is not redirected to a creature', () => {
    let s = scenario([], { p1: { hand: ['Test Raze'], battlefield: ['Test Farm'] }, p2: { battlefield: ['Test Skite'] }, defs });
    const farm = find(s, 'Test Farm', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raze', 'hand', 'p1') }), { targets: [obj(farm)] });
    const raze = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    const a = activations(s, find(s, 'Test Skite', 'battlefield', 'p2'), 'p2')[0];
    s = resolveAll(settle(act(s, a!.action), { targets: [obj(raze)] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Farm')).toBe(false); // destroyed
    expect(dmg(s, find(s, 'Test Skite', 'battlefield', 'p2'))).toBe(0);
  });
  it('a spell with two targets: one of them, chosen by the player, becomes the source', () => {
    let s = scenario([], { p1: { hand: ['Test Pair Zap'], battlefield: ['Test Victim'] }, p2: { battlefield: ['Test Skite', 'Test Victim'] }, defs });
    const mine = find(s, 'Test Victim', 'battlefield', 'p1');
    const theirs = find(s, 'Test Victim', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Pair Zap', [mine, theirs]);
    const pair = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    const a = activations(s, find(s, 'Test Skite', 'battlefield', 'p2'), 'p2')[0];
    s = settle(act(s, a!.action), { targets: [obj(pair)] });
    // the next decision asks which target to change; answer with the opponent's Victim (the second one)
    expect(s.pending?.kind).toBe('priority');
    s = resolveAll(s, { targets: [obj(theirs)] });
    expect(dmg(s, find(s, 'Test Victim', 'battlefield', 'p1'))).toBe(1);
    expect(dmg(s, find(s, 'Test Victim', 'battlefield', 'p2'))).toBe(0);
    expect(dmg(s, find(s, 'Test Skite', 'battlefield', 'p2'))).toBe(1);
  });
  it('a target tied to another ("another target creature") is not changed to the creature the first one already targets (CR 115.3, 115.7a)', () => {
    const CONE = card('Test Cone Zap', 'Instant', 'Test Cone Zap deals 1 damage to target creature and 3 damage to another target creature.');
    let s = scenario([], { p1: { hand: ['Test Cone Zap'], battlefield: ['Test Victim'] }, p2: { battlefield: ['Test Skite'] }, defs: [...defs, CONE] });
    const mine = find(s, 'Test Victim', 'battlefield', 'p1');
    const skite = find(s, 'Test Skite', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Cone Zap', [skite, mine]);
    const cone = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    const a = activations(s, skite, 'p2')[0]!;
    s = resolveAll(settle(act(s, a.action), { targets: [obj(cone)] }), { targets: [obj(mine)] });
    expect(dmg(s, find(s, 'Test Victim', 'battlefield', 'p1'))).toBe(3); // the second target is unchanged
  });
  it('"change the target of target instant or sorcery spell with a single target to this creature": the entering creature takes the one target; a two-target spell is no choice', () => {
    let s = scenario([], { p1: { hand: ['Test Zap', 'Test Flash Reflector'], battlefield: ['Test Victim'] }, defs });
    const victim = find(s, 'Test Victim', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') }), { targets: [obj(victim)] });
    const zap = s.zones.stack[0]!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flash Reflector', 'hand', 'p1') }));
    s = resolveAll(settle(pass(pass(s)), { targets: [obj(zap)], yes: true }), { targets: [obj(zap)], yes: true }); // both pass: the creature resolves, its trigger targets the Zap
    expect(dmg(s, find(s, 'Test Victim', 'battlefield', 'p1'))).toBe(0);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Flash Reflector')).toBe(false); // 1/1 took 3
    const t = scenario([], { p1: { hand: ['Test Pair Zap', 'Test Flash Reflector'], battlefield: ['Test Victim'] }, p2: { battlefield: ['Test Victim'] }, defs });
    const mine = find(t, 'Test Victim', 'battlefield', 'p1');
    const theirs = find(t, 'Test Victim', 'battlefield', 'p2');
    let u = castTargeting(t, 'Test Pair Zap', [mine, theirs]);
    u = settle(act(u, { type: 'cast', player: 'p1', card: find(u, 'Test Flash Reflector', 'hand', 'p1') }));
    u = settle(pass(pass(u)), { yes: true });
    expect(u.zones.stack.filter((id) => u.objects[id]!.kind === 'ability').length).toBe(0); // no legal target for the enters trigger: it is not put on the stack
  });
});

describe('CR 707.10, 707.10c, 400.3: "Copy target instant or sorcery spell, then return it to its owner\'s hand. You may choose new targets for the copy."', () => {
  const REVERSAL = card('Test Reversal', 'Instant', "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy.");
  const CHARM = card('Test Gain Charm', 'Instant', 'You gain 3 life.');
  const BEAR = card('Test Reversal Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [REVERSAL, CHARM, BEAR];
  const lifeOf = (s: GameState, p = 0): number => s.players[p]!.life;
  it('is automated; the copy resolves once, the original spell never resolves and is back in its owner\'s hand', () => {
    expect(full(REVERSAL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Gain Charm', 'Test Reversal'] }, defs });
    const before = lifeOf(s);
    s = castTargeting(s, 'Test Gain Charm', []);
    const charm = s.zones.stack[0]!;
    s = castTargeting(s, 'Test Reversal', [charm]);
    s = resolveAll(s, { yes: true });
    expect(lifeOf(s)).toBe(before + 3); // the copy resolved, the original did not
    expect(find(s, 'Test Gain Charm', 'hand', 'p1')).toBeDefined(); // back in its owner's hand
    expect((s.zones.graveyard['p1'] ?? []).some((id) => s.objects[id]!.defId === 'Test Gain Charm')).toBe(false);
  });
  it('without the Reversal the spell resolves and goes to the graveyard (the control case)', () => {
    let s = scenario([], { p1: { hand: ['Test Gain Charm'] }, defs });
    const before = lifeOf(s);
    s = resolveAll(castTargeting(s, 'Test Gain Charm', []));
    expect(lifeOf(s)).toBe(before + 3);
    expect(() => find(s, 'Test Gain Charm', 'hand', 'p1')).toThrow();
  });
  it('a creature spell is not a legal target', () => {
    const s = scenario([], { p1: { hand: ['Test Reversal Bear', 'Test Reversal'] }, defs });
    const t = castTargeting(s, 'Test Reversal Bear', []);
    expect(() => castTargeting(t, 'Test Reversal', [t.zones.stack[0]!])).toThrow();
  });
});

describe('CR 707.12, 707.10a, 607.2a: "You may copy the exiled card. If you do, you may cast the copy without paying its mana cost." (imprint)', () => {
  const ROD = card('Test Imprint Rod', 'Artifact', 'Imprint — When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.\n{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.');
  const CHARM = card('Test Rod Charm', 'Instant', 'You gain 3 life.', { cost: '{1}' });
  const BIG = card('Test Rod Big Charm', 'Instant', 'You gain 5 life.', { cost: '{3}' });
  const defs = [ROD, CHARM, BIG];
  const lifeOf = (s: GameState): number => s.players[0]!.life;
  const withRod = (exile: string | null): GameState => {
    const s = scenario([], { p1: { hand: ['Test Imprint Rod', 'Test Rod Charm', 'Test Rod Big Charm'] }, defs });
    let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Imprint Rod', 'hand', 'p1') }));
    t = pass(pass(t)); // the Rod resolves; its imprint trigger goes on the stack
    t = settle(t, exile !== null ? { objects: [find(t, exile, 'hand', 'p1')], yes: true } : { yes: false });
    return resolveAll(t, exile !== null ? { objects: [find(t, exile, 'hand', 'p1')], yes: true } : { yes: false });
  };
  const activate = (s0: GameState): GameState => {
    const s = structuredClone(s0);
    give(s, 'p1', 'CC');
    const rod = find(s, 'Test Imprint Rod', 'battlefield', 'p1');
    const a = activations(s, rod, 'p1')[0];
    expect(a).toBeDefined();
    return resolveAll(settle(act(s, a!.action), { yes: true }), { yes: true });
  };
  it('is automated; the copy of the exiled card is cast for free, the card stays exiled, and the ability can be used again', () => {
    expect(full(ROD)).toBe(true);
    const s = withRod('Test Rod Charm');
    expect(find(s, 'Test Rod Charm', 'exile')).toBeDefined();
    const before = lifeOf(s);
    const t = activate(s);
    expect(lifeOf(t)).toBe(before + 3);
    expect(find(t, 'Test Rod Charm', 'exile')).toBeDefined(); // the card itself is still exiled
    const u = (() => { const x = structuredClone(t); x.turn.number += 0; for (const o of Object.values(x.objects)) if (o.defId === 'Test Imprint Rod') o.tapped = false; return x; })();
    expect(lifeOf(activate(u))).toBe(before + 6);
  });
  it('declining the cast does nothing; with nothing exiled the ability does nothing', () => {
    const s = withRod('Test Rod Charm');
    const before = lifeOf(s);
    const s2 = structuredClone(s);
    give(s2, 'p1', 'CC');
    const a = activations(s2, find(s2, 'Test Imprint Rod', 'battlefield', 'p1'), 'p1')[0]!;
    const t = resolveAll(settle(act(s2, a.action), { yes: false }), { yes: false });
    expect(lifeOf(t)).toBe(before);
    const none = withRod(null);
    expect(lifeOf(activate(none))).toBe(lifeOf(none));
  });
});

describe('CR 115.9b, 701.6a: "Counter target spell or ability that targets you or a creature you control."', () => {
  const SIREN = card('Test Siren', 'Creature — Siren', 'Flying\n{U}, Sacrifice this creature: Counter target spell or ability that targets you or a creature you control.', { pt: ['1', '1'] });
  const ZAP = card('Test Siren Zap', 'Instant', 'Test Siren Zap deals 3 damage to target creature.');
  const BURN = card('Test Siren Burn', 'Instant', 'Test Siren Burn deals 2 damage to target player.');
  const BEAR = card('Test Siren Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  const defs = [SIREN, ZAP, BURN, BEAR];
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Siren Zap', 'Test Siren Burn'], battlefield: ['Test Siren Bear'] }, p2: { battlefield: ['Test Siren', 'Test Siren Bear'] }, defs });
  const sirenAction = (s: GameState) => activations(s, find(s, 'Test Siren', 'battlefield', 'p2'), 'p2')[0];
  it('is automated; a spell aimed at a creature you control can be countered by sacrificing the Siren', () => {
    expect(full(SIREN)).toBe(true);
    let s = setup();
    const mine = find(s, 'Test Siren Bear', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Siren Zap', [mine]);
    const zap = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    expect(sirenAction(s)).toBeDefined();
    s = resolveAll(settle(act(s, sirenAction(s)!.action), { targets: [obj(zap)] }));
    expect(dmg(s, find(s, 'Test Siren Bear', 'battlefield', 'p2'))).toBe(0);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Siren')).toBe(false); // sacrificed
  });
  it('a spell aimed at you (a player) can be countered too', () => {
    let s = setup();
    s = castTargeting(s, 'Test Siren Burn', [{ kind: 'player', id: 'p2' }]);
    const burn = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    expect(sirenAction(s)).toBeDefined();
    s = resolveAll(settle(act(s, sirenAction(s)!.action), { targets: [obj(burn)] }));
    expect(s.players[1]!.life).toBe(20);
  });
  it('a spell aimed at the opponent\'s creature is no target for the Siren', () => {
    let s = setup();
    const theirs = find(s, 'Test Siren Bear', 'battlefield', 'p1');
    s = castTargeting(s, 'Test Siren Zap', [theirs]);
    give(s, 'p2', 'U');
    s = pass(s);
    const a = sirenAction(s);
    if (a !== undefined) expect(() => resolveAll(settle(act(s, a.action), { targets: [obj(s.zones.stack[0]!)] }))).toThrow(/legal|target/i);
    else expect(a).toBeUndefined();
  });
});

describe('CR 115.9b, 110.1: "a permanent you control" as what a spell targets is on the battlefield, never a spell on the stack', () => {
  const LIGHT = card('Test Hindering Light', 'Instant', 'Counter target spell that targets you or a permanent you control.\nYou gain 1 life.', { cost: '{0}' });
  const CANCEL = card('Test Cancel Two', 'Instant', 'Counter target spell.');
  const BEAR = card('Test Light Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BOLT = card('Test Light Zap', 'Instant', 'Test Light Zap deals 2 damage to target creature.');
  const defs = [LIGHT, CANCEL, BEAR, BOLT];
  it('an opponent\'s spell that targets my spell on the stack is not a legal target; one that targets my permanent is', () => {
    expect(full(LIGHT)).toBe(true);
    // p2's Cancel targets p1's Bear spell: Light (cast by p1) may not target the Cancel
    let s = scenario([], { p1: { hand: ['Test Light Bear', 'Test Hindering Light'] }, p2: { hand: ['Test Cancel Two'] }, defs });
    s = castTargeting(s, 'Test Light Bear', []);
    const bear = s.zones.stack[0]!;
    give(s, 'p2', 'U');
    s = pass(s);
    s = pass(castTargeting(s, 'Test Cancel Two', [bear], 'p2')); // p2 passes: p1 may respond
    expect(() => castTargeting(s, 'Test Hindering Light', [s.zones.stack[0]!])).toThrow(/no legal one/);
    // p2's Zap targets p1's Bear on the battlefield: legal, it is countered and p1 gains 1 life
    let t = scenario([], { p1: { hand: ['Test Hindering Light'], battlefield: ['Test Light Bear'] }, p2: { hand: ['Test Light Zap'] }, defs });
    const mine = find(t, 'Test Light Bear', 'battlefield', 'p1');
    t = pass(t); // p1 passes with an empty stack: p2 has priority in p1's main phase
    t = pass(castTargeting(t, 'Test Light Zap', [mine], 'p2'));
    const handBefore = t.zones.hand['p1']!.length;
    t = resolveAll(castTargeting(t, 'Test Hindering Light', [t.zones.stack[0]!]));
    expect(dmg(t, find(t, 'Test Light Bear', 'battlefield', 'p1'))).toBe(0);
    expect(t.zones.hand['p1']!.length).toBe(handBefore - 1); // Light left the hand
  });
});
