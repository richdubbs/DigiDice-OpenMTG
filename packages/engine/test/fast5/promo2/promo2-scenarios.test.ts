/**
 * FAST5 PROMO2: the promotion review (design 6.9) of the experimental templates of parser/templates/zz-fast3 and zz-fast4. Every index card a promotion
 * makes full was read against its Oracle text next to its compiled and rendered abilities; the readings the earlier scenario files of T13-T34 did not
 * already play are played here with synthetic cards that use the same sentences (design 6.10: invented names), compiled by the game's default compiler.
 *
 *   CR 603.10a, 608.2h   "When enchanted creature dies, ~ deals X damage ..., where X is the number of fuse counters on ~" and "draw a card for each page
 *                        counter on ~": the Aura is in the graveyard when the trigger resolves; its counters are read as it last existed
 *   CR 602.2, 608.2h     "{0}, Sacrifice ~: It deals X damage ..., where X is the number of verse counters on ~"; "Draw a card for each charge counter on ~";
 *                        "Target player loses X life, where X is ~'s power": the sacrificed source as it last existed
 *   CR 608.2h, 701.17a   "Destroy target nonartifact creature. Its controller mills cards equal to that creature's power."
 *   CR 107.1b            "loses X life, where X is 3 minus the number of cards in their hand": a negative X loses no life (and never gains)
 *   CR 702.3b, 609.4     "As long as ~ has a counter on it, it can attack as though it didn't have defender" waives only its own defender
 *   CR 608.2d, 406.3     "Target opponent exiles two cards from their hand" with one card in hand exiles that one
 *   CR 120.3, 702.15b    "Whenever a Dragon you control enters, it deals X damage ..." (the entering Dragon is the source: its lifelink applies)
 *   CR 406.3, 102.2      "Exile all opponents' graveyards." leaves your own graveyard alone
 *   CR 608.2c, 701.19a   "Put a -1/-1 counter on target creature. Then if that creature's toughness is 1 or greater, regenerate it." (eff.t34.thenIf,
 *                        reviewed and played; held experimental by PROMO2, promoted by cloud std-blb: evidence.ts)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, life, pass, put, scenario, zoneNames } from '../../m3/scenario';
import { toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card compiles fully automated and plays at level full (its templates are stable now). */
const full = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });

/** Answer the decisions that come up: target groups from `targets` (one list per group, in order), then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), targets, answers);
const castWith = (s0: GameState, name: string, targets: TargetChoice[][] = []): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
function activate(s: GameState, name: string, targets: TargetChoice[][] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const ROCK = card('Test Rock', 'Artifact', '');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 603.10a, 608.2h: an Aura\'s "when enchanted creature dies" reads the counters the Aura had', () => {
  const FUSE = card('Test Fuse Aura', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, this Aura deals X damage to any target, where X is the number of fuse counters on this Aura.');
  const PAGE = card('Test Page Aura', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, draw a card for each page counter on this Aura.');
  function withAura(name: string, counters: Record<string, number>): GameState {
    const s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Bear'] }, defs: [FUSE, PAGE, BEAR, KILL] });
    s.objects[put(s, 'p1', 'battlefield', { name, counters })]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p1'); // test setup (CR 303.4)
    return s;
  }
  it('both are full', () => {
    expect(full(FUSE)).toBe(true);
    expect(full(PAGE)).toBe(true);
  });
  it('"deals X damage, where X is the number of fuse counters on this Aura": three counters, three damage, though the Aura is in the graveyard', () => {
    let s = withAura('Test Fuse Aura', { fuse: 3 });
    s = resolve(castWith(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]]), [[player('p2')]]);
    expect(findAll(s, 'Test Fuse Aura', 'graveyard', 'p1')).toHaveLength(1);
    s = resolve(s);
    expect(life(s, 'p2')).toBe(17);
  });
  it('"draw a card for each page counter on this Aura": two counters, two cards', () => {
    let s = withAura('Test Page Aura', { page: 2 });
    s = resolve(castWith(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]]));
    const hand = zoneNames(s, 'hand', 'p1').length;
    s = resolve(s);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand + 2);
  });
});

describe('CR 602.2, 608.2h: a sacrificed source is read as it last existed', () => {
  const SONG = card('Test Torch Hymn', 'Enchantment', '{0}, Sacrifice this enchantment: It deals X damage to any target, where X is the number of verse counters on this enchantment.');
  const DAIS = card('Test Culling Plinth', 'Artifact', '{1}, Sacrifice this artifact: Draw a card for each charge counter on this artifact.');
  const LIMBS = card('Test Limb Wall', 'Creature — Zombie Wall', 'Defender\n{0}, Sacrifice this creature: Target player loses X life, where X is this creature\'s power.', ['0', '3']);
  it('all three are full', () => {
    for (const d of [SONG, DAIS, LIMBS]) expect(full(d), d.name).toBe(true);
  });
  it('"where X is the number of verse counters on this enchantment": four counters, four damage', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Torch Hymn', counters: { verse: 4 } }] }, defs: [SONG] });
    const s = resolve(activate(s0, 'Test Torch Hymn', [[player('p2')]]));
    expect(life(s, 'p2')).toBe(16);
  });
  it('"draw a card for each charge counter on this artifact": two counters, two cards', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Culling Plinth', counters: { charge: 2 } }, 'Plains'] }, defs: [DAIS] });
    const before = zoneNames(s0, 'hand', 'p1').length;
    const s = resolve(activate(s0, 'Test Culling Plinth'));
    expect(zoneNames(s, 'hand', 'p1').length).toBe(before + 2);
  });
  it('"loses X life, where X is this creature\'s power": a 0/3 with three +1/+1 counters makes the target lose 3', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Limb Wall', counters: { '+1/+1': 3 } }] }, defs: [LIMBS] });
    const s = resolve(activate(s0, 'Test Limb Wall', [[player('p2')]]));
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 608.2h, 701.17a: "Destroy target nonartifact creature. Its controller mills cards equal to that creature\'s power."', () => {
  const SPECTACLE = card('Test Grim Show', 'Instant', "Destroy target nonartifact creature. Its controller mills cards equal to that creature's power.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
  it('is full; the opponent\'s 3/3 dies and its controller mills three', () => {
    expect(full(SPECTACLE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Grim Show'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SPECTACLE, OGRE] });
    const lib = s.zones.library['p2']!.length;
    s = resolve(castWith(s, 'Test Grim Show', [[obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]]));
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.library['p2']!.length).toBe(lib - 3);
    expect(s.zones.graveyard['p2']!.length).toBe(4);
  });
});

describe('CR 107.1b: "Target player loses X life, where X is 3 minus the number of cards in their hand"', () => {
  const VISE = card('Test Vise Idol', 'Artifact', '{0}: Target player loses X life, where X is 3 minus the number of cards in their hand.');
  it('one card: loses 2; five cards: loses nothing and gains nothing', () => {
    expect(full(VISE)).toBe(true);
    const one = scenario([], { p1: { battlefield: ['Test Vise Idol'] }, p2: { hand: ['Test Rock'] }, defs: [VISE, ROCK] });
    expect(life(resolve(activate(one, 'Test Vise Idol', [[player('p2')]])), 'p2')).toBe(18);
    const five = scenario([], { p1: { battlefield: ['Test Vise Idol'] }, p2: { hand: ['Test Rock', 'Test Rock', 'Test Rock', 'Test Rock', 'Test Rock'] }, defs: [VISE, ROCK] });
    expect(life(resolve(activate(five, 'Test Vise Idol', [[player('p2')]])), 'p2')).toBe(20);
  });
});

describe('CR 702.3b, 609.4: "As long as this creature has a counter on it, it can attack as though it didn\'t have defender"', () => {
  const DEMON_WALL = card('Test Demon Rampart', 'Artifact Creature — Demon Wall', "Defender\nAs long as this creature has a counter on it, it can attack as though it didn't have defender.", ['3', '3']);
  const PLAIN_WALL = card('Test Plain Wall', 'Creature — Wall', 'Defender', ['0', '4']);
  const candidates = (s: GameState): string[] => {
    let t: GameState;
    try { t = toDeclareAttackers(s); } catch { return []; }
    return (t.pending as unknown as { candidates: { id: string }[] }).candidates.map((c) => c.id);
  };
  it('waives the defender of the creature with the counter only, never of another defender its controller has', () => {
    expect(full(DEMON_WALL)).toBe(true);
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Demon Rampart', counters: { '+1/+1': 1 } }, 'Test Plain Wall'] }, defs: [DEMON_WALL, PLAIN_WALL] });
    const ids = candidates(s);
    expect(ids).toContain(find(s, 'Test Demon Rampart', 'battlefield', 'p1'));
    expect(ids).not.toContain(find(s, 'Test Plain Wall', 'battlefield', 'p1'));
  });
});

describe('CR 608.2d, 406.3: "Target opponent exiles two cards from their hand"', () => {
  const VESSEL = card('Test Malign Urn', 'Artifact', '{0}: Target opponent exiles two cards from their hand.');
  it('with one card in hand, that card is exiled (as many as possible)', () => {
    expect(full(VESSEL)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Malign Urn'] }, p2: { hand: ['Test Rock'] }, defs: [VESSEL, ROCK] });
    s = resolve(activate(s, 'Test Malign Urn', [[player('p2')]]));
    expect(zoneNames(s, 'hand', 'p2')).toEqual([]);
    expect(findAll(s, 'Test Rock', 'exile', 'p2')).toHaveLength(1);
  });
  it('with three cards, that player chooses two of them', () => {
    let s = scenario([], { p1: { battlefield: ['Test Malign Urn'] }, p2: { hand: ['Test Rock', 'Test Bear', 'Test Kill'] }, defs: [VESSEL, ROCK, BEAR, KILL] });
    s = resolve(activate(s, 'Test Malign Urn', [[player('p2')]]));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p2');
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: options.slice(0, 2) } as DecisionAnswer);
    expect(zoneNames(s, 'hand', 'p2')).toHaveLength(1);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2')).toHaveLength(2);
  });
});

describe('CR 120.3, 702.15b: "Whenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control"', () => {
  const TEMPEST = card('Test Dragon Squall', 'Enchantment', 'Whenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.');
  const DRAGON = card('Test Life Dragon', 'Creature — Dragon', 'Lifelink', ['2', '2']);
  it('is full; with one Dragon already there the new one deals 2, and its lifelink shows it is the source', () => {
    expect(full(TEMPEST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Life Dragon'], battlefield: ['Test Dragon Squall', 'Test Life Dragon'] }, defs: [TEMPEST, DRAGON] });
    s = resolve(castWith(s, 'Test Life Dragon'), [[player('p2')]]);
    s = resolve(s);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 406.3: "Exile all opponents\' graveyards."', () => {
  const GUILE = card('Test Graveyard Purge', 'Sorcery', "Exile all opponents' graveyards.");
  it('the opponent\'s graveyard is exiled, yours stays', () => {
    expect(full(GUILE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Graveyard Purge'], graveyard: ['Test Rock'] }, p2: { graveyard: ['Test Rock', 'Test Bear'] }, defs: [GUILE, ROCK, BEAR] });
    s = resolve(castWith(s, 'Test Graveyard Purge'));
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Rock', 'Test Graveyard Purge']);
  });
});

describe('CR 608.2c, 701.19a: "Put a -1/-1 counter on target creature. Then if that creature\'s toughness is 1 or greater, regenerate it."', () => {
  const VASSAL = card('Test Gore Hound', 'Creature — Dog', "Sacrifice this creature: Put a -1/-1 counter on target creature. Then if that creature's toughness is 1 or greater, regenerate it.", ['2', '2']);
  const ONE = card('Test Mite', 'Creature — Insect', '', ['1', '1']);
  it('is automated (eff.t34.thenIf, promoted by Cloud std-fin and cloud std-blb: the card is full); a 2/2 gets a regeneration shield (it survives a destroy as a tapped 1/1), a 1/1 does not (its toughness is 0 when the condition is checked)', () => {
    expect(JSON.stringify(VASSAL.faces)).not.toContain('"op":"manual"');
    expect(VASSAL.automation.level).toBe('full');
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Gore Hound', 'Test Gore Hound'] }, p2: { battlefield: ['Test Bear', 'Test Mite'] }, defs: [VASSAL, BEAR, ONE, KILL] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolve(activate(s, 'Test Gore Hound', [[obj(bear)]]));
    s = resolve(castWith(s, 'Test Kill', [[obj(bear)]]));
    expect(s.zones.battlefield).toContain(bear);
    expect(s.objects[bear]!.tapped).toBe(true);
    const mite = find(s, 'Test Mite', 'battlefield', 'p2');
    s = resolve(activate(s, 'Test Gore Hound', [[obj(mite)]]));
    expect(findAll(s, 'Test Mite', 'graveyard', 'p2')).toHaveLength(1);
    void tweak;
  });
});
