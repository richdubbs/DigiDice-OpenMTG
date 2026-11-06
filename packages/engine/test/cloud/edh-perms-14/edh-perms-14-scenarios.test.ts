/**
 * Commander lane edh-perms, round edh-perms-14: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Rules text: Comprehensive Rules of 2026-09-25 (media.wizards.com), each cite below checked against it.
 *
 *   CR 601.2h, 106.3, 614.12, 122.6  "Other creatures you control enter with an additional +1/+1 counter on them for each mana from a Treasure spent to cast them." (Kalain)
 *   CR 601.2h, 205.2a, 614.12        "Each creature you control enters with an additional +1/+1 counter on it for each mana from an artifact source spent to cast it." (Coin of Mastery)
 *   CR 122.1, 122.6, 614.17         "Players can't get counters." "Counters can't be put on artifacts, creatures, enchantments, or lands." (Solemnity)
 *   CR 707.2, 707.9b, 205.1b, 603.6c "... you may exile it. If you do, create a token that's a copy of that creature, except it's 1/1 and it's a Nightmare in addition to its other types." (Nightmare Shepherd)
 *   CR 707.9b, 613.1f, 613.4b        "Create a token that's a copy of target permanent, except it's a 4/4 Dragon creature with flying in addition to its other types." (Will of the Temur)
 *   CR 122.1, 608.2c, 701.14a        "Put a +1/+1 counter on target creature you control if it's legendary. Then it fights target creature an opponent controls." (Ancient Animus)
 *   CR 603.2, 107.3, 202.3           "Put X +1/+1 counters on it, where X is that spell's mana value" after "create a Fractal token" (Deekah, Fractal Theorist)
 *   CR 701.3a, 301.5                 "create a 1/1 Monk token with prowess. You may attach this Equipment to it." (Cori-Steel Cutter)
 *   CR 702.89a, 613.1f, 301.5, 303.4 "Auras attached to permanents you control have umbra armor." (Umbra Mystic)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; supertypes?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const plusCounters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;
const onField = (s: GameState, name: string, p?: PlayerId): ObjectId[] => findAll(s, name, 'battlefield', p);

interface Driver { yes?: boolean; pick?: (options: ObjectId[], s: GameState, who: PlayerId) => ObjectId[]; targets?: (ObjectId | PlayerId)[][]; modes?: number[] }
/** Answer every decision: yes/no by `yes`, objects by `pick` (default: the first allowed), targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Driver = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s, p.player) : p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: (o.modes ?? [0]).map(String) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Driver = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s: GameState, name: string, player: PlayerId = 'p1', o: Driver = {}): GameState => resolveAll(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}' });
const CHEST = card('Test Chest', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');
const ROCK = card('Test Rock', 'Artifact', '{T}: Add {G}.');

// ---- Kalain ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2h, 106.3, 614.12: "Other creatures you control enter with an additional +1/+1 counter on them for each mana from a Treasure spent to cast them."', () => {
  const PAINTER = card('Test Painter', 'Legendary Creature — Human', 'Other creatures you control enter with an additional +1/+1 counter on them for each mana from a Treasure spent to cast them.', { pt: ['3', '3'], cost: '{2}' });
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const defs = [PAINTER, BEAR, CHEST, ROCK, RAISE];
  const run = (bf: string[], name = 'Test Bear'): GameState => cast(scenario([], { defs, p1: { battlefield: ['Test Painter', ...bf], hand: [name] } }), name);
  it('is fully automated', () => expect(full(PAINTER)).toBe(true));
  it('two Treasures pay for a creature spell: it enters with two +1/+1 counters', () => {
    const s = run(['Test Chest', 'Test Chest']);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(2);
  });
  it('one Treasure and one Plains are one mana from a Treasure: one counter', () => {
    const s = run(['Test Chest', 'Plains']);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(1);
  });
  it('the negative case: two Plains are no mana from a Treasure, and a nonTreasure artifact is not a Treasure: no counter', () => {
    expect(plusCounters(run(['Plains', 'Plains']), find(run(['Plains', 'Plains']), 'Test Bear', 'battlefield', 'p1'))).toBe(0);
    const s = run(['Test Rock', 'Test Rock']);
    expect(onField(s, 'Test Bear', 'p1').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
  it('"other": the creature itself gets none when Treasures cast it', () => {
    const d = scenario([], { defs, p1: { battlefield: ['Test Chest', 'Test Chest'], hand: ['Test Painter'] } });
    const s = cast(d, 'Test Painter');
    expect(plusCounters(s, find(s, 'Test Painter', 'battlefield', 'p1'))).toBe(0);
  });
  it('a creature that is put onto the battlefield without being cast spent no mana: no counter', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Painter'], hand: ['Test Raise'], graveyard: ['Test Bear'] } });
    s = cast(s, 'Test Raise', 'p1', { targets: [[find(s, 'Test Bear', 'graveyard', 'p1')]] });
    expect(onField(s, 'Test Bear', 'p1').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
  it('an opponent\'s Painter does not help your creature: "creatures you control" are the Painter\'s controller\'s', () => {
    const s = cast(scenario([], { defs, p1: { battlefield: ['Test Chest', 'Test Chest'], hand: ['Test Bear'] }, p2: { battlefield: ['Test Painter'] } }), 'Test Bear');
    expect(onField(s, 'Test Bear', 'p1').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
});

// ---- Coin of Mastery ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2h, 205.2a, 614.12: "Each creature you control enters with an additional +1/+1 counter on it for each mana from an artifact source spent to cast it."', () => {
  const COIN = card('Test Coin', 'Artifact', 'Each creature you control enters with an additional +1/+1 counter on it for each mana from an artifact source spent to cast it.');
  const defs = [COIN, BEAR, CHEST, ROCK];
  const run = (bf: string[], name = 'Test Bear'): GameState => cast(scenario([], { defs, p1: { battlefield: ['Test Coin', ...bf], hand: [name] } }), name);
  it('is fully automated', () => expect(full(COIN)).toBe(true));
  it('two artifacts tapped for mana: two counters', () => {
    const s = run(['Test Rock', 'Test Rock']);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(2);
  });
  it('a Treasure is an artifact source too: one Treasure and one Plains are one counter', () => {
    const s = run(['Test Chest', 'Plains']);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(1);
  });
  it('the negative case: lands are no artifact source', () => {
    const s = run(['Plains', 'Plains']);
    expect(onField(s, 'Test Bear', 'p1').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
});

// ---- Solemnity -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 122.1, 122.6, 614.17: "Players can\'t get counters." "Counters can\'t be put on artifacts, creatures, enchantments, or lands."', () => {
  const STASIS = card('Test Stasis', 'Enchantment', "Players can't get counters.\nCounters can't be put on artifacts, creatures, enchantments, or lands.");
  const BOOST = card('Test Boost', 'Instant', 'Put a +1/+1 counter on target creature.');
  const CHARGE = card('Test Charge', 'Instant', 'Put a charge counter on target artifact.');
  const TOXIN = card('Test Toxin', 'Instant', 'Target player gets two poison counters.');
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Planeswalker — Testy', loyalty: '3', colors: [], keywords: [], oracle_text: '+1: You gain 1 life.' } as unknown as OracleCard);
  const defs = [STASIS, BOOST, CHARGE, TOXIN, WALKER, BEAR, ROCK];
  const start = (stasis: boolean): GameState => scenario([], { defs, p1: { battlefield: [...(stasis ? ['Test Stasis'] : []), 'Test Bear', 'Test Rock'], hand: ['Test Boost', 'Test Charge', 'Test Toxin', 'Test Walker'] } });
  it('is fully automated', () => expect(full(STASIS)).toBe(true));
  it('the control case: with no Stasis a creature gets the +1/+1 counter, an artifact the charge counter and a player the poison counters', () => {
    let s = start(false);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const rock = find(s, 'Test Rock', 'battlefield', 'p1');
    s = cast(s, 'Test Boost', 'p1', { targets: [[bear]] });
    s = cast(s, 'Test Charge', 'p1', { targets: [[rock]] });
    s = cast(s, 'Test Toxin', 'p1', { targets: [['p2']] });
    expect(plusCounters(s, bear)).toBe(1);
    expect(s.objects[rock]!.counters['charge'] ?? 0).toBe(1);
    expect(s.players.find((p) => p.id === 'p2')!.poison).toBe(2);
  });
  it('with Stasis: no counter on the creature, none on the artifact, no poison counters for a player', () => {
    let s = start(true);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const rock = find(s, 'Test Rock', 'battlefield', 'p1');
    s = cast(s, 'Test Boost', 'p1', { targets: [[bear]] });
    s = cast(s, 'Test Charge', 'p1', { targets: [[rock]] });
    s = cast(s, 'Test Toxin', 'p1', { targets: [['p2']] });
    expect(plusCounters(s, bear)).toBe(0);
    expect(s.objects[rock]!.counters['charge'] ?? 0).toBe(0);
    expect(s.players.find((p) => p.id === 'p2')!.poison).toBe(0);
  });
  it('the negative case: a planeswalker is none of artifacts, creatures, enchantments or lands, so it enters with its loyalty counters', () => {
    const s = cast(start(true), 'Test Walker');
    expect(s.objects[find(s, 'Test Walker', 'battlefield', 'p1')]!.counters['loyalty']).toBe(3);
  });
  it('a creature that enters with counters (a replacement) gets none either', () => {
    const MAGE = card('Test Grower', 'Creature — Druid', 'This creature enters with two +1/+1 counters on it.', { pt: ['1', '1'] });
    const s = cast(scenario([], { defs: [...defs, MAGE], p1: { battlefield: ['Test Stasis'], hand: ['Test Grower'] } }), 'Test Grower');
    expect(onField(s, 'Test Grower', 'p1').length).toBe(1);
    expect(plusCounters(s, find(s, 'Test Grower', 'battlefield', 'p1'))).toBe(0);
  });
});

// ---- Nightmare Shepherd ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.6c, 707.2, 707.9b, 205.1b: "Whenever another nontoken creature you control dies, you may exile it. If you do, create a token that\'s a copy of that creature, except it\'s 1/1 and it\'s a Nightmare in addition to its other types."', () => {
  const SHEPHERD = card('Test Nightherd', 'Enchantment Creature — Demon', "Whenever another nontoken creature you control dies, you may exile it. If you do, create a token that's a copy of that creature, except it's 1/1 and it's a Nightmare in addition to its other types.", { pt: ['4', '4'] });
  const WOLF = card('Test Wolf', 'Creature — Wolf', 'Menace', { pt: ['3', '3'] });
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const defs = [SHEPHERD, WOLF, BEAR, SMITE];
  const kill = (name: string, yes: boolean, owner: 'p1' | 'p2' = 'p1'): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Nightherd', ...(owner === 'p1' ? [name] : [])], hand: ['Test Smite', 'Test Smite'] }, p2: { battlefield: owner === 'p2' ? [name] : [] } });
    return cast(s0, 'Test Smite', 'p1', { targets: [[find(s0, name, 'battlefield', owner)]], yes });
  };
  it('is fully automated', () => expect(full(SHEPHERD)).toBe(true));
  it('the creature dies, you exile it, and a 1/1 Nightmare token that is a copy of it enters (with its abilities)', () => {
    const s = kill('Test Wolf', true);
    expect(s.zones.exile.some((id) => chars(s, id).name === 'Test Wolf')).toBe(true);
    expect(s.zones.graveyard.p1!.some((id) => chars(s, id).name === 'Test Wolf')).toBe(false);
    const tok = onField(s, 'Test Wolf', 'p1');
    expect(tok.length).toBe(1);
    const c = chars(s, tok[0]!);
    expect([Number(c.power), Number(c.toughness)]).toEqual([1, 1]);
    expect(c.subtypes).toContain('Wolf');
    expect(c.subtypes).toContain('Nightmare');
    expect(c.keywords.map((k) => k.keyword)).toContain('menace');
    expect(s.objects[tok[0]!]!.kind).toBe('token');
  });
  it('the negative case: declining to exile it leaves the card in the graveyard and makes no token', () => {
    const s = kill('Test Wolf', false);
    expect(s.zones.graveyard.p1!.some((id) => chars(s, id).name === 'Test Wolf')).toBe(true);
    expect(onField(s, 'Test Wolf', 'p1').length).toBe(0);
  });
  it('an opponent\'s creature is not "a creature you control": no trigger, no token', () => {
    const s = kill('Test Wolf', true, 'p2');
    expect(onField(s, 'Test Wolf').length).toBe(0);
    expect(s.zones.exile.length).toBe(0);
  });
  it('ruling 2020-01-24: a creature that was copying another creature is copied as what it copied, not as the card it is in the graveyard', () => {
    const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', { pt: ['0', '0'], cost: '{0}' });
    const s0 = scenario([], { defs: [...defs, SHIFTER], p1: { battlefield: ['Test Nightherd', 'Test Wolf'], hand: ['Test Shifter', 'Test Smite'] } });
    let s = cast(s0, 'Test Shifter', 'p1', { yes: true, pick: (opts) => [opts.find((id) => chars(s0, id).name === 'Test Wolf') ?? opts[0]!] });
    const shifter = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Shifter')[0]!;
    expect(chars(s, shifter).name).toBe('Test Wolf');
    s = cast(s, 'Test Smite', 'p1', { targets: [[shifter]], yes: true });
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks.length).toBe(1);
    expect(chars(s, toks[0]!).name).toBe('Test Wolf');
    expect(chars(s, toks[0]!).keywords.map((k) => k.keyword)).toContain('menace');
  });
  it('a token that dies is not "nontoken": the 1/1 Nightmare dying again makes nothing', () => {
    let s = kill('Test Wolf', true);
    const tok = onField(s, 'Test Wolf', 'p1')[0]!;
    s = cast(s, 'Test Smite', 'p1', { targets: [[tok]], yes: true });
    expect(onField(s, 'Test Wolf').length).toBe(0);
    expect(s.zones.exile.filter((id) => chars(s, id).name === 'Test Wolf').length).toBe(1);
  });
});

// ---- Will of the Temur ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 707.9b, 613.1f, 613.4b, 205.1b: "Create a token that\'s a copy of target permanent, except it\'s a 4/4 Dragon creature with flying in addition to its other types."', () => {
  const WILL = card('Test Tide Rite', 'Sorcery', "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Create a token that's a copy of target permanent, except it's a 4/4 Dragon creature with flying in addition to its other types.\n• Target player draws cards equal to the greatest mana value among permanents you control.");
  const defs = [WILL, ROCK, BEAR];
  it('is fully automated', () => expect(full(WILL)).toBe(true));
  it('a noncreature artifact is copied as a 4/4 Dragon artifact creature with flying and its own mana ability', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rock'], hand: ['Test Tide Rite'] } });
    const s = cast(s0, 'Test Tide Rite', 'p1', { modes: [0], targets: [[find(s0, 'Test Rock', 'battlefield', 'p1')]] });
    const rocks = onField(s, 'Test Rock', 'p1');
    expect(rocks.length).toBe(2);
    const tok = rocks.find((id) => s.objects[id]!.kind === 'token')!;
    const c = chars(s, tok);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toContain('Dragon');
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(c.keywords.map((k) => k.keyword)).toContain('flying');
    expect(c.abilities.length).toBeGreaterThan(0); // the copied mana ability
  });
  it('the negative case: a creature copy keeps its other types and loses its own power and toughness (4/4); the original is unchanged', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Bear'], hand: ['Test Tide Rite'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Tide Rite', 'p1', { modes: [0], targets: [[bear]] });
    const tok = onField(s, 'Test Bear', 'p1').find((id) => s.objects[id]!.kind === 'token')!;
    expect(chars(s, tok).subtypes).toEqual(expect.arrayContaining(['Bear', 'Dragon']));
    expect([Number(chars(s, tok).power), Number(chars(s, tok).toughness)]).toEqual([4, 4]);
    expect([Number(chars(s, bear).power), Number(chars(s, bear).toughness)]).toEqual([2, 2]);
    expect(chars(s, bear).keywords.map((k) => k.keyword)).not.toContain('flying');
  });
});

// ---- Ancient Animus -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 122.1, 608.2c, 701.14a: "Put a +1/+1 counter on target creature you control if it\'s legendary. Then it fights target creature an opponent controls."', () => {
  const ANIMUS = card('Test Rage', 'Instant', "Put a +1/+1 counter on target creature you control if it's legendary. Then it fights target creature an opponent controls.");
  const LEGEND = card('Test Legend', 'Legendary Creature — Elder', '', { pt: ['2', '2'] });
  const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['2', '4'] });
  const defs = [ANIMUS, LEGEND, BEAR, OX];
  const run = (mine: string): { s: GameState; mine: ObjectId; ox: ObjectId } => {
    const s0 = scenario([], { defs, p1: { battlefield: [mine], hand: ['Test Rage'] }, p2: { battlefield: ['Test Ox'] } });
    const m = find(s0, mine, 'battlefield', 'p1');
    const ox = find(s0, 'Test Ox', 'battlefield', 'p2');
    return { s: cast(s0, 'Test Rage', 'p1', { targets: [[m], [ox]] }), mine: m, ox };
  };
  it('is fully automated', () => expect(full(ANIMUS)).toBe(true));
  it('a legendary creature gets the counter first (3/3 now), then fights: it takes 2 and survives, and deals 3 (not 2) to the Ox', () => {
    const { s, mine, ox } = run('Test Legend');
    expect(plusCounters(s, mine)).toBe(1);
    expect(s.zones.battlefield).toContain(mine);
    expect(s.objects[mine]!.damage).toBe(2);
    expect(s.objects[ox]!.damage).toBe(3);
  });
  it('the negative case: a creature that is not legendary gets no counter, but it still fights (it deals 2, not 3, and dies to the Ox)', () => {
    const { s, mine, ox } = run('Test Bear');
    expect(s.zones.battlefield).not.toContain(mine);
    expect(s.zones.graveyard.p1!.some((id) => chars(s, id).name === 'Test Bear')).toBe(true);
    expect(s.objects[ox]!.damage).toBe(2);
  });
});

// ---- Deekah, Fractal Theorist -------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.2, 107.3, 202.3: "Whenever you cast or copy an instant or sorcery spell, create a 0/0 Fractal creature token. Put X +1/+1 counters on it, where X is that spell\'s mana value."', () => {
  const DEEKAH = card('Test Fractalist', 'Legendary Creature — Human Wizard', "Whenever you cast or copy an instant or sorcery spell, create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on it, where X is that spell's mana value.", { pt: ['2', '2'] });
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', { cost: '{2}' });
  const defs = [DEEKAH, SIP, BEAR];
  it('is fully automated', () => expect(full(DEEKAH)).toBe(true));
  it('casting a mana value 2 instant makes a Fractal with two +1/+1 counters (2/2): the counters go on the new token, not on the spell', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Fractalist', 'Plains', 'Plains'], hand: ['Test Sip'] } });
    const s = cast(s0, 'Test Sip');
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.length).toBe(1);
    const t = tok[0]!;
    expect(plusCounters(s, t)).toBe(2);
    expect([Number(chars(s, t).power), Number(chars(s, t).toughness)]).toEqual([2, 2]);
  });
  it('the negative case: a creature spell is not an instant or sorcery, so no Fractal is made', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Fractalist', 'Plains', 'Plains'], hand: ['Test Bear'] } });
    const s = cast(s0, 'Test Bear');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
  });
});

// ---- Cori-Steel Cutter ---------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.3a, 301.5, 603.2: "Whenever you cast your second spell each turn, create a 1/1 Monk creature token with prowess. You may attach this Equipment to it."', () => {
  const CUTTER = card('Test Cutter', 'Artifact — Equipment', 'Whenever you cast your second spell each turn, create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it.\nEquip {1}', { cost: '{2}' });
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
  const defs = [CUTTER, SIP];
  const run = (casts: number, yes: boolean): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Cutter'], hand: ['Test Sip', 'Test Sip'] } });
    for (let i = 0; i < casts; i++) s = cast(s, 'Test Sip', 'p1', { yes });
    return s;
  };
  const monks = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('is fully automated', () => expect(full(CUTTER)).toBe(true));
  it('the second spell makes the Monk and you may attach the Equipment to it (the token, not the spell)', () => {
    const s = run(2, true);
    expect(monks(s).length).toBe(1);
    expect(s.objects[find(s, 'Test Cutter', 'battlefield', 'p1')]!.attachedTo).toBe(monks(s)[0]);
  });
  it('declining the "may" leaves the Equipment unattached', () => {
    const s = run(2, false);
    expect(monks(s).length).toBe(1);
    expect(s.objects[find(s, 'Test Cutter', 'battlefield', 'p1')]!.attachedTo).toBeUndefined();
  });
  it('the negative case: the first spell of the turn makes no Monk', () => {
    expect(monks(run(1, true)).length).toBe(0);
  });
});

// ---- Umbra Mystic ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.89a, 613.1f, 301.5, 303.4: "Auras attached to permanents you control have umbra armor."', () => {
  const MYSTIC = card('Test Mystic', 'Creature — Wizard', 'Auras attached to permanents you control have umbra armor.', { pt: ['1', '1'] });
  const AURA = card('Test Plain Aura', 'Enchantment — Aura', 'Enchant creature');
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const defs = [MYSTIC, AURA, SMITE, BEAR];
  const keywords = (s: GameState, id: ObjectId): string[] => chars(s, id).keywords.map((k) => k.keyword);
  const setup = (hostOwner: 'p1' | 'p2', mystic = true): { s: GameState; bear: ObjectId; aura: ObjectId } => {
    const s0 = scenario([], { defs, p1: { battlefield: [...(mystic ? ['Test Mystic'] : []), ...(hostOwner === 'p1' ? ['Test Bear'] : [])], hand: ['Test Plain Aura', 'Test Smite'] }, p2: { battlefield: hostOwner === 'p2' ? ['Test Bear'] : [] } });
    const bear = find(s0, 'Test Bear', 'battlefield', hostOwner);
    const s = cast(s0, 'Test Plain Aura', 'p1', { targets: [[bear]] });
    return { s, bear, aura: find(s, 'Test Plain Aura', 'battlefield', 'p1') };
  };
  it('is fully automated', () => expect(full(MYSTIC)).toBe(true));
  it('an Aura on your creature has umbra armor: the creature is not destroyed and the Aura is', () => {
    const { s: s0, bear, aura } = setup('p1');
    expect(s0.objects[aura]!.attachedTo).toBe(bear);
    expect(keywords(s0, aura)).toContain('umbra armor');
    const s = cast(s0, 'Test Smite', 'p1', { targets: [[bear]] });
    expect(s.zones.battlefield).toContain(bear);
    expect(s.zones.battlefield).not.toContain(aura);
  });
  it('the negative case: your Aura on an opponent\'s creature has no umbra armor (its host is not a permanent you control), and that creature is destroyed', () => {
    const { s: s0, bear, aura } = setup('p2');
    expect(s0.objects[aura]!.attachedTo).toBe(bear);
    expect(keywords(s0, aura)).not.toContain('umbra armor');
    const s = cast(s0, 'Test Smite', 'p1', { targets: [[bear]] });
    expect(s.zones.battlefield).not.toContain(bear);
  });
  it('without the Mystic an Aura has no umbra armor: the enchanted creature is destroyed', () => {
    const { s: s0, bear, aura } = setup('p1', false);
    expect(keywords(s0, aura)).not.toContain('umbra armor');
    const s = cast(s0, 'Test Smite', 'p1', { targets: [[bear]] });
    expect(s.zones.battlefield).not.toContain(bear);
  });
});
