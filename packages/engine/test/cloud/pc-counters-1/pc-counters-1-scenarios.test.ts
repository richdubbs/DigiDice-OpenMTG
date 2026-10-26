/**
 * Precon lane pc-counters, round pc-counters-1, played through the engine with synthetic cards compiled by the game's default compiler (invented names, design
 * 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 107.14, 122.1, 608.2h       "You get an amount of {E} equal to the greatest power among creatures you control.": the amount is counted as the ability resolves
 *   CR 119.3, 120.3a, 608.2h       "... for each player who lost life this turn": every player who lost life (damage and loss), you too; the plural after "the number of"
 *   CR 614.1c, 614.12, 122.6       "Colorless creatures you control enter with two additional +1/+1 counters on them.": your colorless creatures only
 *   CR 614.12, 107.3, 122.6        "Each other creature you control enters with an additional X +1/+1 counters on it, where X is ...": the count is read as it enters; not the source
 *   CR 113.6, 614.12               "As long as ~ is in your graveyard, each Human creature you control enters with an additional +1/+1 counter on it.": the graveyard only
 *   CR 614.1c, 122.1b              "~ enters with a +1/+1 counter, a flying counter, a deathtouch counter, and a shield counter on it."
 *   CR 400.7, 603.6c, 700.4        "Whenever a creature is exiled from the battlefield, ...", "Whenever a permanent you control is put into a graveyard, ...": from the battlefield only
 *   CR 613.4c, 613.1d, 122.1       "Enchanted creature gets +1/+1 for each charge counter on ~ and is an Assassin in addition to its other types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
/** How many objects of this name are in the zone (an object that changes zone is a new object, CR 400.7: ids do not follow it). */
const inZone = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'exile' | 'hand', who?: PlayerId): number => findAll(s, name, zone, who).length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => s.objects[id]!.counters;
const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

/** Answer every decision: yes/no by `yes`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; targets?: ObjectId[][]; players?: PlayerId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const pq = [...(o.players ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') {
      const objs = (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id }));
      const plrs = (pq.shift() ?? []).map((id) => ({ kind: 'player' as const, id }));
      s = answer(s, { kind: 'chooseTargets', targets: [...objs, ...plrs] });
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'] });
const HUMAN = card('Test Human', 'Creature — Human', '', { pt: ['1', '1'], colors: ['W'] });
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['5', '4'], colors: ['R'] });
const RELIC = card('Test Relic', 'Artifact', '');

// ---- CR 107.14, 122.1: an amount of energy equal to a count ----------------------------------------------------------------------------------------------

describe('CR 107.14, 122.1, 608.2h: "you get an amount of {E} equal to the greatest power among creatures you control"', () => {
  const SEER = card('Test Seer', 'Creature — Elf Druid', 'When this creature enters, you get an amount of {E} equal to the greatest power among creatures you control.', { pt: ['1', '1'] });
  const defs = [SEER, BRUTE, BEAR];
  it('is fully automated', () => expect(full(SEER)).toBe(true));
  it('the greatest power among your creatures (not their sum), the new creature included; an opponent\'s bigger creature is not counted', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seer'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    s = cast(s, 'Test Seer');
    expect(energy(s, 'p1')).toBe(2);
    expect(energy(s, 'p2')).toBe(0);
  });
  it('the creature itself counts: with no other creature the amount is its own power', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seer'] } });
    s = cast(s, 'Test Seer');
    expect(energy(s, 'p1')).toBe(1);
  });
  it('the amount is the greatest power, not the number of creatures', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Seer'], battlefield: ['Test Brute', 'Test Bear', 'Test Bear'] } });
    s = cast(s, 'Test Seer');
    expect(energy(s, 'p1')).toBe(5);
  });
});

// ---- CR 119.3, 120.3a: players who lost life this turn ------------------------------------------------------------------------------------------------

describe('CR 119.3, 120.3a, 608.2h: "put a charge counter on <creature> for each player who lost life this turn", "for each opponent who lost life this turn"', () => {
  const DRAIN = card('Test Drain', 'Sorcery', 'Each opponent loses 2 life.');
  const BACKLASH = card('Test Backlash', 'Sorcery', 'You lose 1 life.');
  const TALLY = card('Test Tally', 'Sorcery', 'Put a charge counter on target creature for each player who lost life this turn.');
  const OPPOSITION = card('Test Opposition', 'Sorcery', 'Put a charge counter on target creature for each opponent who lost life this turn.');
  const defs = [DRAIN, BACKLASH, TALLY, OPPOSITION, BEAR];
  const charge = (s: GameState, id: ObjectId): number => counters(s, id)['charge'] ?? 0;
  it('are fully automated', () => { for (const d of [TALLY, OPPOSITION]) expect(full(d)).toBe(true); });
  it('nobody lost life: no counter, whichever the group', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Tally', 'Test Opposition'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Tally', { targets: [[bear]] });
    s = cast(s, 'Test Opposition', { targets: [[bear]] });
    expect(charge(s, bear)).toBe(0);
  });
  it('an opponent lost life: one counter for each player and one for each opponent', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Drain', 'Test Tally', 'Test Opposition'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Drain');
    expect(lifeOf(s, 'p2')).toBe(18);
    s = cast(s, 'Test Tally', { targets: [[bear]] });
    expect(charge(s, bear)).toBe(1);
    s = cast(s, 'Test Opposition', { targets: [[bear]] });
    expect(charge(s, bear)).toBe(2);
  });
  it('only you lost life: "each player" counts you (one counter), "each opponent" does not (none)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Backlash', 'Test Tally', 'Test Opposition'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Backlash');
    s = cast(s, 'Test Tally', { targets: [[bear]] });
    expect(charge(s, bear)).toBe(1);
    s = cast(s, 'Test Opposition', { targets: [[bear]] });
    expect(charge(s, bear)).toBe(1);
  });
  it('both of you lost life: two counters for each player (a player counts once however often they lost life)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Drain', 'Test Drain', 'Test Backlash', 'Test Tally'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Drain');
    s = cast(s, 'Test Drain');
    s = cast(s, 'Test Backlash');
    s = cast(s, 'Test Tally', { targets: [[bear]] });
    expect(charge(s, bear)).toBe(2);
  });
});

// ---- CR 614.1c, 614.12, 122.6: other permanents enter with more counters --------------------------------------------------------------------------------

describe('CR 614.1c, 614.12, 122.6: "Colorless creatures you control enter with two additional +1/+1 counters on them."', () => {
  const IDOL = card('Test Idol', 'Artifact', 'Colorless creatures you control enter with two additional +1/+1 counters on them.');
  const FLASH_GOLEM = card('Test Flash Golem', 'Artifact Creature — Golem', 'Flash', { pt: ['3', '3'] });
  const defs = [IDOL, GOLEM, BEAR, FLASH_GOLEM];
  it('is fully automated', () => expect(full(IDOL)).toBe(true));
  it('a colorless creature of yours enters with two +1/+1 counters; a green one with none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Golem', 'Test Bear'], battlefield: ['Test Idol'] } });
    s = cast(s, 'Test Golem');
    s = cast(s, 'Test Bear');
    expect(counters(s, find(s, 'Test Golem', 'battlefield', 'p1'))['+1/+1']).toBe(2);
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
  });
  it('a colorless creature an opponent controls enters without them (only "creatures you control")', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Idol'] }, p2: { hand: ['Test Flash Golem'] } });
    s = pass(s); // p1 passes in the main phase with an empty stack: p2 gets priority
    expect(s.pending?.kind).toBe('priority');
    expect((s.pending as { player: PlayerId }).player).toBe('p2');
    s = cast(s, 'Test Flash Golem', {}, 'p2');
    expect(counters(s, find(s, 'Test Flash Golem', 'battlefield', 'p2'))['+1/+1'] ?? 0).toBe(0);
  });
  it('without the Idol on the battlefield a colorless creature enters without counters', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Golem', 'Test Idol'] } });
    s = cast(s, 'Test Golem');
    expect(counters(s, find(s, 'Test Golem', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 614.12, 107.3, 122.6: "Each other creature you control enters with an additional X +1/+1 counters on it, where X is the number of +1/+1 counters on this creature."', () => {
  const HIVE = card('Test Hive', 'Creature — Insect', 'Each other creature you control enters with an additional X +1/+1 counters on it, where X is the number of +1/+1 counters on this creature.', { pt: ['2', '2'] });
  const defs = [HIVE, BEAR];
  it('is fully automated', () => expect(full(HIVE)).toBe(true));
  it('X is read as the creature enters: three counters on the Hive, three more on the Bear; the Hive itself gets none, and a later Bear gets the new total', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear', 'Test Bear'], battlefield: [{ name: 'Test Hive', counters: { '+1/+1': 3 } }] } });
    const hive = find(s, 'Test Hive', 'battlefield', 'p1');
    s = cast(s, 'Test Bear');
    const first = findAll(s, 'Test Bear', 'battlefield', 'p1')[0]!;
    expect(counters(s, first)['+1/+1']).toBe(3);
    expect(counters(s, hive)['+1/+1']).toBe(3);
    s.objects[hive]!.counters['+1/+1'] = 5; // (test setup) the Hive grows
    s = cast(s, 'Test Bear');
    const second = findAll(s, 'Test Bear', 'battlefield', 'p1').find((id) => id !== first)!;
    expect(counters(s, second)['+1/+1']).toBe(5);
    expect(counters(s, first)['+1/+1']).toBe(3);
  });
  it('a Hive with no counters adds none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Hive'] } });
    s = cast(s, 'Test Bear');
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 614.12, 107.3, 122.6: "Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~\'s toughness."', () => {
  const WARDEN = card('Test Warden', 'Creature — Elf', 'Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~\'s toughness.', { pt: ['1', '5'] });
  const defs = [WARDEN, BEAR];
  it('is fully automated', () => expect(full(WARDEN)).toBe(true));
  it('the Warden\'s toughness (5) in counters on another creature, none on the Warden', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Warden'] } });
    s = cast(s, 'Test Bear');
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'))['+1/+1']).toBe(5);
    expect(counters(s, find(s, 'Test Warden', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 614.12, 616.1: creatures that enter at the same time as the source of "other creatures enter with ..." do not get the counters (either order)', () => {
  const WARDEN = card('Test Warden', 'Creature — Elf', 'Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~\'s toughness.', { pt: ['1', '5'] });
  const REVIVE = card('Test Revive', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield.');
  const defs = [WARDEN, BEAR, REVIVE];
  for (const order of [['Test Warden', 'Test Bear'], ['Test Bear', 'Test Warden']]) {
    it(`graveyard order ${order.join(', ')}: the Bear enters with no counters, the Warden's later arrivals do`, () => {
      let s = scenario([], { defs, p1: { hand: ['Test Revive', 'Test Bear'], graveyard: order } });
      s = cast(s, 'Test Revive');
      expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
      s = cast(s, 'Test Bear');
      const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
      expect(bears.map((id) => counters(s, id)['+1/+1'] ?? 0).sort()).toEqual([0, 5]);
    });
  }
});

describe('CR 614.12, 616.1: token copies created together do not apply each other\'s "other creatures enter with ..." replacement', () => {
  const WARDEN = card('Test Warden', 'Creature — Elf', 'Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~\'s toughness.', { pt: ['1', '5'] });
  const TWINS = card('Test Twins', 'Sorcery', 'Create two tokens that are copies of target creature you control.');
  const defs = [WARDEN, TWINS];
  it('two copies of the Warden each enter with the original\'s 5 counters only (not 10 or 15)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Twins'], battlefield: ['Test Warden'] } });
    s = cast(s, 'Test Twins', { targets: [[find(s, 'Test Warden', 'battlefield', 'p1')]] });
    const all = findAll(s, 'Test Warden', 'battlefield', 'p1');
    expect(all.length).toBe(3);
    expect(all.map((id) => counters(s, id)['+1/+1'] ?? 0).sort()).toEqual([0, 5, 5]);
  });
});

describe('CR 113.6, 614.12: "As long as ~ is in your graveyard, each Human creature you control enters with an additional +1/+1 counter on it."', () => {
  const SHADE = card('Test Shade', 'Creature — Spirit', 'As long as this creature is in your graveyard, each Human creature you control enters with an additional +1/+1 counter on it.', { pt: ['2', '2'] });
  const defs = [SHADE, HUMAN, BEAR];
  it('is fully automated', () => expect(full(SHADE)).toBe(true));
  it('in your graveyard: a Human enters with a counter, a Bear (not a Human) with none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Human', 'Test Bear'], graveyard: ['Test Shade'] } });
    s = cast(s, 'Test Human');
    s = cast(s, 'Test Bear');
    expect(counters(s, find(s, 'Test Human', 'battlefield', 'p1'))['+1/+1']).toBe(1);
    expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
  });
  it('on the battlefield, in your hand or in the other player\'s graveyard it does nothing', () => {
    for (const zones of [{ p1: { hand: ['Test Human'], battlefield: ['Test Shade'] } }, { p1: { hand: ['Test Human', 'Test Shade'] } }, { p1: { hand: ['Test Human'] }, p2: { graveyard: ['Test Shade'] } }]) {
      let s = scenario([], { defs, ...zones });
      s = cast(s, 'Test Human');
      expect(counters(s, find(s, 'Test Human', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
    }
  });
});

describe('CR 614.1c, 122.1b: "~ enters with a +1/+1 counter, a flying counter, a deathtouch counter, and a shield counter on it."', () => {
  const KIT = card('Test Kit', 'Artifact', 'This artifact enters with a +1/+1 counter, a flying counter, a deathtouch counter, and a shield counter on it.');
  const defs = [KIT];
  it('is fully automated', () => expect(full(KIT)).toBe(true));
  it('one counter of each kind named, none of another kind', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Kit'] } });
    s = cast(s, 'Test Kit');
    expect(counters(s, find(s, 'Test Kit', 'battlefield', 'p1'))).toEqual({ '+1/+1': 1, flying: 1, deathtouch: 1, shield: 1 });
  });
});

// ---- CR 400.7, 603.6c, 700.4: leaves-the-battlefield events --------------------------------------------------------------------------------------------

describe('CR 400.7, 603.6c, 700.4: "Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature."', () => {
  const HERDER = card('Test Herder', 'Creature — Spirit', 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
  const BANISH = card('Test Banish', 'Sorcery', 'Exile target creature.');
  const PURGE = card('Test Purge', 'Sorcery', 'Exile target card from a graveyard.');
  const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
  const defs = [HERDER, BANISH, PURGE, SLAY, BEAR];
  it('is fully automated', () => expect(full(HERDER)).toBe(true));
  it('a creature exiled from the battlefield (yours or not) gives a counter; one destroyed or a card exiled from a graveyard does not', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Banish', 'Test Banish', 'Test Slay', 'Test Purge'], battlefield: ['Test Herder', 'Test Bear'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const herder = find(s, 'Test Herder', 'battlefield', 'p1');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    const inYard = find(s, 'Test Bear', 'graveyard', 'p1');
    s = cast(s, 'Test Banish', { targets: [[theirs]] });
    expect(inZone(s, 'Test Bear', 'exile')).toBe(1);
    expect(inZone(s, 'Test Bear', 'battlefield', 'p2')).toBe(0);
    expect(counters(s, herder)['+1/+1']).toBe(1);
    s = cast(s, 'Test Purge', { targets: [[inYard]] });
    expect(inZone(s, 'Test Bear', 'exile')).toBe(2);
    expect(counters(s, herder)['+1/+1']).toBe(1);
    s = cast(s, 'Test Slay', { targets: [[mine]] });
    expect(inZone(s, 'Test Bear', 'graveyard', 'p1')).toBe(1);
    expect(counters(s, herder)['+1/+1']).toBe(1);
    s = cast(s, 'Test Banish', { targets: [[herder]] });
    expect(inZone(s, 'Test Herder', 'exile')).toBe(1); // it sees itself leave: no counter to put anywhere, and no error
  });
});

describe('CR 700.4, 603.6c: "Whenever a permanent you control is put into a graveyard, you get {E}."', () => {
  const MARVEL = card('Test Marvel', 'Artifact', 'Whenever a permanent you control is put into a graveyard, you get {E}.');
  const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
  const DISCARD = card('Test Purge Hand', 'Sorcery', 'Discard a card.');
  const defs = [MARVEL, SLAY, DISCARD, BEAR, RELIC];
  it('is fully automated', () => expect(full(MARVEL)).toBe(true));
  it('your permanent destroyed: one energy', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Slay'], battlefield: ['Test Marvel', 'Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Slay', { targets: [[mine]] });
    expect(inZone(s, 'Test Bear', 'graveyard', 'p1')).toBe(1);
    expect(energy(s, 'p1')).toBe(1);
  });
  it('the opponent\'s permanent destroyed: no energy ("a permanent you control")', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Slay'], battlefield: ['Test Marvel'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Slay', { targets: [[find(s, 'Test Bear', 'battlefield', 'p2')]] });
    expect(inZone(s, 'Test Bear', 'graveyard', 'p2')).toBe(1);
    expect(energy(s, 'p1')).toBe(0);
  });
  it('a card discarded from your hand is put into a graveyard but was never a permanent: no energy', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Purge Hand', 'Test Relic'], battlefield: ['Test Marvel'] } });
    s = cast(s, 'Test Purge Hand');
    expect(inZone(s, 'Test Relic', 'graveyard', 'p1')).toBe(1);
    expect(energy(s, 'p1')).toBe(0);
  });
});

// ---- CR 613.4c, 613.1d, 122.1: an Aura counting the counters on itself --------------------------------------------------------------------------------

describe('CR 613.4c, 613.1d, 122.1: "Enchanted creature gets +1/+1 for each charge counter on ~ and is an Assassin in addition to its other types."', () => {
  const MARK = card('Test Mark', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each charge counter on this Aura and is an Assassin in addition to its other types.');
  const defs = [MARK, BEAR];
  it('is fully automated', () => expect(full(MARK)).toBe(true));
  it('each charge counter on the Aura is +1/+1 (counters of another kind are not counted); the creature keeps its types and gains Assassin', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mark'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Mark', { targets: [[bear]] });
    const mark = find(s, 'Test Mark', 'battlefield', 'p1');
    expect(Number(chars(s, bear).power)).toBe(2);
    expect(chars(s, bear).subtypes).toContain('Assassin');
    expect(chars(s, bear).subtypes).toContain('Bear');
    s.objects[mark]!.counters['charge'] = 3;
    s.objects[mark]!.counters['soul'] = 4;
    expect(Number(chars(s, bear).power)).toBe(5);
    expect(Number(chars(s, bear).toughness)).toBe(5);
  });
});
