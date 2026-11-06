/**
 * Commander EDHREC ranks 6,251-7,500, round edh-next-31: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each group is named after the rule it checks and has its negative case. CR cites are from the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com, fetched in the session); Scryfall rulings were fetched 2026-11-01.
 *
 *   CR 104.3b, 104.2a, 101.2     "You can't win the game and your opponents can't lose the game." (Abyssal Persecutor)
 *   CR 105.1, 105.2, 608.2h      "Destroy target creature. You gain 1 life for each of its colors." (Breathe Your Last)
 *   CR 500.7, 508.1d             "~ can't attack during extra turns." (Medomai the Ageless)
 *   CR 701.43a, 603.12, 508.1    "You may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls." (Glorybringer)
 *   CR 700.4, 603.4, 109.2       "Destroy target creature. If another creature died this turn, draw a card." (Chain Assassination; ruling 2024-07-05)
 *   CR 109.2, 608.2c, 611.2c     "Whenever ~ attacks, all other attacking creatures you control get +1/+1 ... Other red attacking creatures you control gain trample ... Untap each other white attacking creature ..." (Tori D'Avenant)
 *   CR 109.2, 122.1, 608.2c      "Whenever ~ enters or attacks, put a +1/+1 counter on each other creature you control. You gain 1 life for each other creature you control." (Aragorn and Arwen, Wed)
 *   CR 608.2c, 120.3             "~ deals 1 damage to each creature with flying your opponents control. Tap those creatures." (Thundermaw Hellkite; ruling 2017-11-17)
 *   CR 700.4, 119.1, 400.7       "When ~ dies, you may gain 1 life for each creature card in your graveyard. If you do, exile ~ from your graveyard." (Skyfisher Spider)
 *   CR 701.53a, 109.5, 608.2h    "Exile target nonland permanent. Its controller incubates X, where X is its mana value." (Excise the Imperfect)
 *   CR 614.1c, 614.12, 700.4     "Nontoken creatures you control enter with an additional +1/+1 counter on them for each creature that died under your control this turn." (Gorma, the Gullet)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { full, named, resolveAll, settle } from '../cmd3/helpers';

const card = (name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const attackAnswer = (ids: ObjectId[]) => ({ kind: 'declareAttackers' as const, attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) });
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const castSpell = (s: GameState, name: string, targets?: TargetChoice[]): GameState =>
  resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never), targets ? { targets } : {});
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
const gone = (s: GameState, id: ObjectId): boolean => !s.zones.battlefield.includes(id);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [PERSECUTOR, LOSER, LEECH, CHAIN, MOON, GLORY, TORI, ARAGORN, HELLKITE, SPIDER, EXCISE, GORMA]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const PERSECUTOR = card('Test Grim Persecutor', 'Creature — Demon', "Flying\nYou can't win the game and your opponents can't lose the game.", { pt: ['6', '6'] });
const LOSER = card('Test Quick Cantrip', 'Instant', 'You gain 1 life.');
describe('CR 104.3b, 104.2a, 101.2: "You can\'t win the game and your opponents can\'t lose the game."', () => {
  const lost = (s: GameState, p: string): boolean => s.players.find((x) => x.id === p)!.hasLost === true;
  it('an opponent at 0 life does not lose while the creature is on the battlefield; the controller can still lose', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grim Persecutor'], hand: ['Test Quick Cantrip'] }, defs: [PERSECUTOR, LOSER] });
    const s1 = castSpell(tweak(s0, (t) => { t.players.find((x) => x.id === 'p2')!.life = 0; }), 'Test Quick Cantrip');
    expect(lost(s1, 'p2')).toBe(false);
    const s2 = castSpell(tweak(s0, (t) => { t.players.find((x) => x.id === 'p1')!.life = -3; }), 'Test Quick Cantrip');
    expect(lost(s2, 'p1'), 'the ban protects only the opponents').toBe(true);
  });
  it('negative: without the creature the opponent at 0 life loses', () => {
    const s0 = scenario([], { p1: { hand: ['Test Quick Cantrip'] }, defs: [PERSECUTOR, LOSER] });
    const s1 = castSpell(tweak(s0, (t) => { t.players.find((x) => x.id === 'p2')!.life = 0; }), 'Test Quick Cantrip');
    expect(lost(s1, 'p2')).toBe(true);
  });
  it('negative: an opponent\'s own copy protects only the controller\'s opponents, which is p1 here', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Grim Persecutor'] }, p1: { hand: ['Test Quick Cantrip'] }, defs: [PERSECUTOR, LOSER] });
    const s1 = castSpell(tweak(s0, (t) => { t.players.find((x) => x.id === 'p1')!.life = 0; }), 'Test Quick Cantrip');
    expect(lost(s1, 'p1'), 'p1 is an opponent of the controller').toBe(false);
  });
});

const LEECH = card('Test Soul Leech', 'Instant', 'Destroy target creature. You gain 1 life for each of its colors.');
describe('CR 105.1, 105.2, 608.2h: "Destroy target creature. You gain 1 life for each of its colors."', () => {
  const GOLD = card('Test Gold Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['W', 'U'] });
  const IRON = card('Test Iron Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });
  const SHIELD = card('Test Shield Bear', 'Creature — Bear', 'Indestructible', { pt: ['2', '2'], colors: ['R', 'G'] });
  const game = (target: string): GameState => scenario([], { p1: { hand: ['Test Soul Leech'] }, p2: { battlefield: [target] }, defs: [LEECH, GOLD, IRON, SHIELD] });
  it('a two-colored creature is destroyed and gives two life', () => {
    const s0 = game('Test Gold Bear');
    const t = find(s0, 'Test Gold Bear', 'battlefield', 'p2');
    const s = castSpell(s0, 'Test Soul Leech', [obj(t)]);
    expect(gone(s, t)).toBe(true);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('negative: a colorless creature gives no life', () => {
    const s0 = game('Test Iron Golem');
    const s = castSpell(s0, 'Test Soul Leech', [obj(find(s0, 'Test Iron Golem', 'battlefield', 'p2'))]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('a creature that is not destroyed still gives its colors (the life gain does not depend on the destruction)', () => {
    const s0 = game('Test Shield Bear');
    const t = find(s0, 'Test Shield Bear', 'battlefield', 'p2');
    const s = castSpell(s0, 'Test Soul Leech', [obj(t)]);
    expect(gone(s, t)).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

const MOON = card('Test Moon Drake', 'Creature — Drake', "Flying\nTest Moon Drake can't attack during extra turns.", { pt: ['3', '3'] });
describe('CR 500.7, 508.1d: "~ can\'t attack during extra turns."', () => {
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const game = (extra: boolean): GameState => tweak(scenario([], { p1: { battlefield: ['Test Moon Drake', 'Test Plain Bear'] }, defs: [MOON, BEAR] }), (t) => { if (extra) t.turn.extra = true; });
  const candidates = (s: GameState): ObjectId[] => { const d = toDeclareAttackers(s).pending; if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers'); return d.candidates.map((c) => c.id); };
  it('in an extra turn it cannot be declared as an attacker while another creature can', () => {
    const s = game(true);
    const ids = candidates(s);
    expect(ids).toEqual([find(s, 'Test Plain Bear', 'battlefield', 'p1')]);
  });
  it('negative: in an ordinary turn it can attack', () => {
    const s = game(false);
    expect(candidates(s)).toContain(find(s, 'Test Moon Drake', 'battlefield', 'p1'));
  });
});

const GLORY = card('Test Fire Wyrm', 'Creature — Dragon', 'Flying, haste\nYou may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls.', { pt: ['4', '4'] });
describe('CR 701.43a, 603.12, 508.1: "You may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls."', () => {
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', { pt: ['3', '5'] });
  const WYRM = card('Test Other Wyrm', 'Creature — Dragon', '', { pt: ['3', '5'] });
  const game = (): GameState => scenario([], { p1: { battlefield: ['Test Fire Wyrm'] }, p2: { battlefield: ['Test Big Ogre', 'Test Other Wyrm'] }, defs: [GLORY, OGRE, WYRM] });
  it('exerted, it deals 4 damage to the chosen non-Dragon creature (the Dragon is no legal target)', () => {
    const s0 = game();
    const wyrm = find(s0, 'Test Fire Wyrm', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Big Ogre', 'battlefield', 'p2');
    let s = answer(toDeclareAttackers(s0), attackAnswer([wyrm]));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [wyrm] });
    if (s.pending?.kind === 'chooseTargets') {
      const opts = JSON.stringify(s.pending);
      expect(opts).toContain(ogre);
      expect(opts).not.toContain(find(s0, 'Test Other Wyrm', 'battlefield', 'p2'));
      s = answer(s, { kind: 'chooseTargets', targets: [obj(ogre)] });
    }
    s = resolveAll(s);
    expect(s.objects[ogre]!.damage).toBe(4);
  });
  it('negative: not exerted, no damage is dealt', () => {
    const s0 = game();
    const wyrm = find(s0, 'Test Fire Wyrm', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Big Ogre', 'battlefield', 'p2');
    let s = answer(toDeclareAttackers(s0), attackAnswer([wyrm]));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' || x.pending?.kind === 'declareBlockers', 'blockers');
    expect(s.objects[ogre]!.damage).toBe(0);
  });
});

const CHAIN = card('Test Chain Strike', 'Instant', 'Destroy target creature. If another creature died this turn, draw a card.');
describe('CR 700.4, 603.4, 109.2: "Destroy target creature. If another creature died this turn, draw a card." (rulings of 2024-07-05)', () => {
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WARD = card('Test Hard Bear', 'Creature — Bear', 'Indestructible', { pt: ['2', '2'] });
  const KILL = card('Test Early Kill', 'Instant', 'Destroy target creature.');
  const defs = [CHAIN, BEAR, WARD, KILL];
  it('negative: the destroyed creature is the only one that died: no card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chain Strike'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const t = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const before = handSize(s0);
    const s = castSpell(s0, 'Test Chain Strike', [obj(t)]);
    expect(gone(s, t)).toBe(true);
    expect(handSize(s)).toBe(before - 1);
  });
  it('another creature died earlier this turn: a card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Early Kill', 'Test Chain Strike'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] }, defs });
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Plain Bear');
    const s1 = castSpell(s0, 'Test Early Kill', [obj(a!)]);
    const before = handSize(s1);
    const s2 = castSpell(s1, 'Test Chain Strike', [obj(b!)]);
    expect(handSize(s2)).toBe(before);
    expect(handSize(s2) - (before - 1)).toBe(1);
  });
  it('the target is not destroyed (indestructible) but another creature died: a card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Early Kill', 'Test Chain Strike'] }, p2: { battlefield: ['Test Plain Bear', 'Test Hard Bear'] }, defs });
    const s1 = castSpell(s0, 'Test Early Kill', [obj(find(s0, 'Test Plain Bear', 'battlefield', 'p2'))]);
    const hard = find(s1, 'Test Hard Bear', 'battlefield', 'p2');
    const before = handSize(s1);
    const s2 = castSpell(s1, 'Test Chain Strike', [obj(hard)]);
    expect(gone(s2, hard)).toBe(false);
    expect(handSize(s2)).toBe(before);
  });
  it('negative: the target is not destroyed and nothing else died: no card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chain Strike'] }, p2: { battlefield: ['Test Hard Bear'] }, defs });
    const before = handSize(s0);
    const s = castSpell(s0, 'Test Chain Strike', [obj(find(s0, 'Test Hard Bear', 'battlefield', 'p2'))]);
    expect(handSize(s)).toBe(before - 1);
  });
});

const TORI = card('Test Flame Knight', 'Creature — Human Knight', 'Whenever this creature attacks, all other attacking creatures you control get +1/+1 until end of turn. Other red attacking creatures you control gain trample until end of turn. Untap each other white attacking creature you control.', { pt: ['3', '3'], colors: ['R', 'W'] });
describe('CR 109.2, 608.2c, 611.2c: "all other attacking creatures you control get +1/+1 ... Other red attacking creatures ... gain trample ... Untap each other white attacking creature you control."', () => {
  const RED = card('Test Red Goblin', 'Creature — Goblin', '', { pt: ['2', '2'], colors: ['R'] });
  const WHITE = card('Test White Knight', 'Creature — Knight', '', { pt: ['2', '2'], colors: ['W'] });
  const BLUE = card('Test Blue Wizard', 'Creature — Wizard', '', { pt: ['2', '2'], colors: ['U'] });
  const IDLE = card('Test Idle Goblin', 'Creature — Goblin', '', { pt: ['2', '2'], colors: ['R'] });
  const defs = [TORI, RED, WHITE, BLUE, IDLE];
  it('every other attacker gets +1/+1, the red one gains trample, the white one untaps; the source and a non-attacker are unchanged', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Flame Knight', 'Test Red Goblin', 'Test White Knight', 'Test Blue Wizard', 'Test Idle Goblin'] }, defs });
    const id = (n: string): ObjectId => find(s0, n, 'battlefield', 'p1');
    let s = answer(toDeclareAttackers(s0), attackAnswer([id('Test Flame Knight'), id('Test Red Goblin'), id('Test White Knight'), id('Test Blue Wizard')]));
    s = resolveAll(s);
    expect(pt(s, id('Test Red Goblin'))).toBe('3/3');
    expect(pt(s, id('Test White Knight'))).toBe('3/3');
    expect(pt(s, id('Test Blue Wizard'))).toBe('3/3');
    expect(pt(s, id('Test Flame Knight')), 'the source is not "other"').toBe('3/3');
    expect(pt(s, id('Test Idle Goblin')), 'not attacking').toBe('2/2');
    expect(hasKeyword(getChars(s, id('Test Red Goblin'))!, 'trample'), 'the red attacker gains trample').toBe(true);
    expect(hasKeyword(getChars(s, id('Test Blue Wizard'))!, 'trample'), 'a blue attacker gains no trample').toBe(false);
    expect(s.objects[id('Test White Knight')]!.tapped, 'the white attacker untaps').toBe(false);
    expect(s.objects[id('Test Blue Wizard')]!.tapped, 'the blue attacker stays tapped').toBe(true);
    expect(s.objects[id('Test Flame Knight')]!.tapped, 'the source is white too but is not "other"').toBe(true);
  });
});

const ARAGORN = card('Test Wedded King', 'Legendary Creature — Human Noble', 'Vigilance\nWhenever this creature enters or attacks, put a +1/+1 counter on each other creature you control. You gain 1 life for each other creature you control.', { pt: ['4', '4'] });
describe('CR 109.2, 122.1, 608.2c: "put a +1/+1 counter on each other creature you control. You gain 1 life for each other creature you control."', () => {
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const FOE = card('Test Foe Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('enters: each other creature you control gets a counter and you gain 1 life for each; the source and an opponent\'s creature are untouched', () => {
    const s0 = scenario([], { p1: { hand: ['Test Wedded King'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] }, p2: { battlefield: ['Test Foe Bear'] }, defs: [ARAGORN, BEAR, FOE] });
    const s = castSpell(s0, 'Test Wedded King');
    for (const b of named(s, 'Test Plain Bear')) expect(s.objects[b]!.counters['+1/+1']).toBe(1);
    expect(s.objects[named(s, 'Test Wedded King')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(s.objects[named(s, 'Test Foe Bear')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

const HELLKITE = card('Test Storm Drake', 'Creature — Dragon', 'Flying, haste\nWhen this creature enters, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.', { pt: ['5', '5'] });
describe('CR 608.2c, 120.3: "it deals 1 damage to each creature with flying your opponents control. Tap those creatures." (ruling 2017-11-17)', () => {
  const FLIER = card('Test Sky Bat', 'Creature — Bat', 'Flying', { pt: ['2', '3'] });
  const GROUND = card('Test Ground Bear', 'Creature — Bear', '', { pt: ['2', '3'] });
  const MINE = card('Test My Bat', 'Creature — Bat', 'Flying', { pt: ['2', '3'] });
  it('the opponent\'s fliers are damaged and tapped; their ground creature and your own flier are not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Storm Drake'], battlefield: ['Test My Bat'] }, p2: { battlefield: ['Test Sky Bat', 'Test Ground Bear'] }, defs: [HELLKITE, FLIER, GROUND, MINE] });
    const s = castSpell(s0, 'Test Storm Drake');
    const bat = named(s, 'Test Sky Bat')[0]!;
    expect(s.objects[bat]!.damage).toBe(1);
    expect(s.objects[bat]!.tapped).toBe(true);
    expect(s.objects[named(s, 'Test Ground Bear')[0]!]!.tapped).toBe(false);
    expect(s.objects[named(s, 'Test My Bat')[0]!]!.tapped).toBe(false);
    expect(s.objects[named(s, 'Test My Bat')[0]!]!.damage).toBe(0);
  });
});

const SPIDER = card('Test Hollow Spider', 'Creature — Spider', 'Reach\nWhen this creature dies, you may gain 1 life for each creature card in your graveyard. If you do, exile this card from your graveyard.', { pt: ['1', '1'] });
describe('CR 700.4, 119.1, 400.7: "When ~ dies, you may gain 1 life for each creature card in your graveyard. If you do, exile ~ from your graveyard."', () => {
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const KILL = card('Test Early Kill', 'Instant', 'Destroy target creature.');
  const defs = [SPIDER, BEAR, KILL];
  const yard = (s: GameState, defId: string): boolean => (s.zones.graveyard['p1'] ?? []).some((id) => s.objects[id]!.defId === defId);
  const kill = (s0: GameState, yes: boolean): GameState => {
    const spider = find(s0, 'Test Hollow Spider', 'battlefield', 'p1');
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Early Kill', 'hand', 'p1') } as never), { targets: [obj(spider)], yes });
  };
  it('it counts itself and the other creature card, gains that much, and is exiled from the graveyard', () => {
    const s0 = put0(scenario([], { p1: { battlefield: ['Test Hollow Spider'], hand: ['Test Early Kill'] }, defs }));
    const s = kill(s0, true);
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(yard(s, 'Test Hollow Spider')).toBe(false);
    expect(yard(s, 'Test Plain Bear')).toBe(true);
  });
  it('negative: declined, no life is gained and the card stays in the graveyard', () => {
    const s0 = put0(scenario([], { p1: { battlefield: ['Test Hollow Spider'], hand: ['Test Early Kill'] }, defs }));
    const s = kill(s0, false);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(yard(s, 'Test Hollow Spider')).toBe(true);
  });
  function put0(s: GameState): GameState { return tweak(s, (t) => { put(t, 'p1', 'graveyard', 'Test Plain Bear'); }); }
});

const EXCISE = card('Test Exile Rite', 'Instant', "Exile target nonland permanent. Its controller incubates X, where X is its mana value.");
describe('CR 701.53a, 109.5, 608.2h: "Exile target nonland permanent. Its controller incubates X, where X is its mana value."', () => {
  const PRICEY = card('Test Pricey Ogre', 'Creature — Ogre', '', { pt: ['4', '4'], cost: '{3}{R}' });
  const TOKENISH = card('Test Free Relic', 'Artifact', '', { cost: '{0}' });
  it('the permanent\'s controller (not the caster) gets an Incubator token with counters equal to the mana value', () => {
    const s0 = scenario([], { p1: { hand: ['Test Exile Rite'] }, p2: { battlefield: ['Test Pricey Ogre'] }, defs: [EXCISE, PRICEY, TOKENISH] });
    const t = find(s0, 'Test Pricey Ogre', 'battlefield', 'p2');
    const s = castSpell(s0, 'Test Exile Rite', [obj(t)]);
    expect(gone(s, t)).toBe(true);
    const inc = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(inc.length).toBe(1);
    expect(s.objects[inc[0]!]!.controller).toBe('p2');
    expect(s.objects[inc[0]!]!.counters['+1/+1']).toBe(4);
  });
  it('mana value 0 still makes an Incubator token, with no counters (CR 701.53a: N counters, N = 0)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Exile Rite'] }, p2: { battlefield: ['Test Free Relic'] }, defs: [EXCISE, PRICEY, TOKENISH] });
    const s = castSpell(s0, 'Test Exile Rite', [obj(find(s0, 'Test Free Relic', 'battlefield', 'p2'))]);
    const inc = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p2');
    expect(inc.length).toBe(1);
    expect(s.objects[inc[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

const GORMA = card('Test Hungry Frog', 'Legendary Creature — Frog', 'Lifelink\nNontoken creatures you control enter with an additional +1/+1 counter on them for each creature that died under your control this turn.', { pt: ['2', '2'] });
describe('CR 614.1c, 614.12, 700.4: "Nontoken creatures you control enter with an additional +1/+1 counter on them for each creature that died under your control this turn."', () => {
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const NEWBIE = card('Test New Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
  const KILL = card('Test Early Kill', 'Instant', 'Destroy target creature.');
  const FOEBEAR = card('Test Foe Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [GORMA, BEAR, NEWBIE, KILL, FOEBEAR];
  it('it enters with one counter after one creature of yours died this turn, none before', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hungry Frog', 'Test Plain Bear'], hand: ['Test Early Kill', 'Test New Bear', 'Test New Bear'] }, defs });
    const s1 = castSpell(s0, 'Test New Bear');
    expect(s1.objects[named(s1, 'Test New Bear')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
    const s2 = castSpell(s1, 'Test Early Kill', [obj(find(s1, 'Test Plain Bear', 'battlefield', 'p1'))]);
    const s3 = castSpell(s2, 'Test New Bear');
    const fresh = named(s3, 'Test New Bear').map((id) => s3.objects[id]!.counters['+1/+1'] ?? 0).sort();
    expect(fresh).toEqual([0, 1]);
  });
  it('negative: only creatures that died under YOUR control count', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hungry Frog'], hand: ['Test Early Kill', 'Test New Bear'] }, p2: { battlefield: ['Test Foe Bear'] }, defs });
    const s1 = castSpell(s0, 'Test Early Kill', [obj(find(s0, 'Test Foe Bear', 'battlefield', 'p2'))]);
    const s2 = castSpell(s1, 'Test New Bear');
    expect(s2.objects[named(s2, 'Test New Bear')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
void settle;
