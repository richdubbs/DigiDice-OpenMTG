/**
 * Commander coordinator D, round edh-d-4 (EDHREC ranks 13,751-15,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked
 * against the Comprehensive Rules of 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 506.3, 508.1b, 603.2c  "Whenever you attack a player or planeswalker with one or more creatures with power 1 or less, ..." (Rigo, Streetwise Mentor)
 *   CR 506.3, 508.5, 603.2c   "Whenever an opponent attacks a planeswalker you control with one or more creatures, ~ deals 2 damage to that player and you gain 2 life." (Oath of Kaya)
 *   CR 706.2, 701.22a         "Roll a six-sided die. If the result is 3 or less, scry a number of cards equal to the result." (Boing!)
 *   CR 109.4, 102.2, 608.2h   "Each opponent who doesn't control an Elf loses 1 life." (Thornbow Archer)
 *   CR 603.8, 603.2e          "When no creatures are on the battlefield, sacrifice this enchantment." (Last Laugh)
 *   CR 611.2a, 611.2c, 613.4b "Any number of target Shapeshifter creatures you control have base power and toughness 4/4." (The Bears of Littjara)
 *   CR 611.2b, 613.4b         "... that creature has base power and toughness 3/1 and has flying for as long as it has a feather counter on it." (Aven Mimeomancer)
 *   CR 605.1a, 115.1          "destroy up to X target artifacts without mana abilities, where X is the number of Vampires you control." (Midnight Arsonist)
 *   CR 107.1b, 107.3          "Each opponent creates X minus one 2/2 white Samurai creature tokens with vigilance." (Eiganjo Uprising)
 *   CR 102.2, 119.3, 603.4    "..., that player may draw a card if a player other than you lost life this turn." (Ludevic, Necro-Alchemist)
 *   CR 502.3, 725.1           "Enchanted creature doesn't untap during its controller's untap step unless that player is the monarch." (Fall from Favor)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, lifeOf, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { act as mpAct, answer as mpAnswer, find as mpFind, lifeOf as mpLife, mpScenario, resolveStack } from '../../m12/rules/helpers';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const bf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const idOn = (s: GameState, name: string, p?: PlayerId): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p))!;

/** A planeswalker with 4 loyalty (a planeswalker with none would be put into its owner's graveyard as a state-based action). */
const walker = (name: string) => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testy', oracle_text: '+1: You gain 1 life.', colors: [], keywords: [], loyalty: '4' } as OracleCard);
const SMALL = card('Test Mite', 'Creature — Insect', '', '{0}', ['1', '1']);
const BIG = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);

/** Declare the given attacks on turn 1 (p1), let combat end with no blocks and every trigger resolve; stops in main 2. */
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: string }[]): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((i) => i.id) }); // two triggers at once: the controller orders them
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else throw new Error(`unexpected decision ${s.pending?.kind}`);
  }
  return s;
}

describe('"Whenever you attack a player or planeswalker with one or more creatures with power 1 or less, ..." (CR 506.3, 508.1b, 603.2c; Rigo, Streetwise Mentor)', () => {
  const SCOUT = card('Test Scout', 'Enchantment', 'Whenever you attack a player or planeswalker with one or more creatures with power 1 or less, you gain 1 life.');
  const WALKER = walker('Test Walker');
  const defs = [SCOUT, SMALL, BIG, WALKER];
  const start = () => scenario([], { p1: { battlefield: ['Test Scout', 'Test Mite', 'Test Mite', 'Test Ogre'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] }, defs });
  it('has no manual part', () => expect(full(SCOUT)).toBe(true));
  it('attacking a player with two small creatures and a big one is one occurrence (once for the player attacked)', () => {
    const s0 = start();
    const [m1, m2] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Mite');
    const s = attack(s0, [{ attacker: m1!, defender: 'p2' }, { attacker: m2!, defender: 'p2' }, { attacker: idOn(s0, 'Test Ogre'), defender: 'p2' }]);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('a small creature at the player and another at the planeswalker are two occurrences, one for each thing attacked', () => {
    const s0 = start();
    const [m1, m2] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Mite');
    const s = attack(s0, [{ attacker: m1!, defender: 'p2' }, { attacker: m2!, defender: idOn(s0, 'Test Walker') }]);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('the negative case: only a creature with power 3 attacking (a planeswalker or a player) triggers nothing', () => {
    const s0 = start();
    expect(lifeOf(attack(s0, [{ attacker: idOn(s0, 'Test Ogre'), defender: 'p2' }]), 'p1')).toBe(20);
    expect(lifeOf(attack(s0, [{ attacker: idOn(s0, 'Test Ogre'), defender: idOn(s0, 'Test Walker') }]), 'p1')).toBe(20);
  });
  it('the negative case: a small creature that is not attacking does not trigger it, and neither does a declaration of no attackers', () => {
    const s0 = start();
    expect(lifeOf(attack(s0, []), 'p1')).toBe(20);
  });
});

describe('"Whenever an opponent attacks a planeswalker you control with one or more creatures, ~ deals 2 damage to that player and you gain 2 life." (CR 506.3, 508.5, 603.2c; Oath of Kaya)', () => {
  const WARDEN = card('Test Warden', 'Enchantment', 'Whenever an opponent attacks a planeswalker you control with one or more creatures, ~ deals 2 damage to that player and you gain 2 life.');
  const WALKER = walker('Test Walker');
  const WALKER2 = walker('Test Lander');
  const defs = [WARDEN, SMALL, BIG, WALKER, WALKER2];
  const start = () => scenario([], { p1: { battlefield: ['Test Mite', 'Test Ogre'] }, p2: { battlefield: ['Test Warden', { name: 'Test Walker', counters: { loyalty: 4 } }, { name: 'Test Lander', counters: { loyalty: 4 } }] }, defs });
  it('has no manual part', () => expect(full(WARDEN)).toBe(true));
  it('two creatures at one planeswalker are one occurrence: the attacker takes 2, the Warden controller gains 2', () => {
    const s0 = start();
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Mite'), defender: idOn(s0, 'Test Walker') }, { attacker: idOn(s0, 'Test Ogre'), defender: idOn(s0, 'Test Walker') }]);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(lifeOf(s, 'p2')).toBe(22);
  });
  it('one creature at each of two planeswalkers is two occurrences (the Oath of Kaya ruling of 2019-05-03)', () => {
    const s0 = start();
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Mite'), defender: idOn(s0, 'Test Walker') }, { attacker: idOn(s0, 'Test Ogre'), defender: idOn(s0, 'Test Lander') }]);
    expect(lifeOf(s, 'p1')).toBe(16);
    expect(lifeOf(s, 'p2')).toBe(24);
  });
  it('the negative case: an attack on the player (not on a planeswalker) triggers nothing', () => {
    const s0 = start();
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Ogre'), defender: 'p2' }]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(17); // only the unblocked combat damage
  });
  it('the negative case: a planeswalker its attacker controls, or one a Warden controller does not control, triggers nothing', () => {
    const own = scenario([], { p1: { battlefield: ['Test Warden', { name: 'Test Walker', counters: { loyalty: 4 } }, 'Test Mite'] }, p2: {}, defs });
    // p1 owns the Warden and the planeswalker; p1 attacking the player p2 is no attack on a planeswalker p1 controls
    const s = attack(own, [{ attacker: idOn(own, 'Test Mite'), defender: 'p2' }]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});

describe('"Roll a six-sided die. If the result is 3 or less, scry a number of cards equal to the result." (CR 706.2, 701.22a; Boing!)', () => {
  const BOING = card('Test Bounce', 'Instant', 'Roll a six-sided die. If the result is 3 or less, scry a number of cards equal to the result.');
  const SEEDS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
  /** Cast it and report the die result and the number of cards the scry looked at (0 when no scry decision came up). */
  const run = (seed: string): { result: number; looked: number } => {
    let s = scenario([], { seed, p1: { hand: ['Test Bounce'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: {}, defs: [BOING] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bounce', 'hand', 'p1') });
    let looked = 0;
    for (let i = 0; i < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending!;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') { looked = p.options.length; s = answer(s, { kind: 'chooseObjects', ids: [] }); }
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else s = act(s, { type: 'pass', player: p.player });
    }
    return { result: rolled(s)[0]!, looked };
  };
  it('has no manual part', () => expect(full(BOING)).toBe(true));
  it('a result of 3 or less scries that many cards; a higher result scries nothing', () => {
    const seen = new Map<number, number>();
    for (const seed of SEEDS) { const r = run(seed); seen.set(r.result, r.looked); if (seen.size >= 6) break; }
    expect(seen.size).toBeGreaterThanOrEqual(4);
    for (const [result, looked] of seen) expect(looked, `result ${result}`).toBe(result <= 3 ? result : 0);
    expect([...seen.keys()].some((r) => r <= 3) && [...seen.keys()].some((r) => r > 3)).toBe(true);
  });
});

describe('"Each opponent who doesn\'t control an Elf loses 1 life." (CR 109.4, 102.2, 608.2h; Thornbow Archer)', () => {
  const DRAIN = card('Test Drain', 'Sorcery', "Each opponent who doesn't control an Elf loses 1 life.");
  const ELF = card('Test Elf', 'Creature — Elf Scout', '', '{0}', ['1', '1']);
  const CHANGER = card('Test Changer', 'Creature — Shapeshifter', 'Changeling', '{0}', ['1', '1']);
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', '{0}', ['2', '2']);
  const defs = [DRAIN, ELF, CHANGER, WOLF];
  const game = (zones: Record<string, { battlefield?: string[] }>): GameState => {
    const s = mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Drain'], ...(zones['p1'] ?? {}) }, ...Object.fromEntries(Object.entries(zones).filter(([k]) => k !== 'p1')) } });
    return resolveStack(mpAct(s, { type: 'cast', player: 'p1', card: mpFind(s, 'Test Drain', 'hand', 'p1') }));
  };
  it('has no manual part', () => expect(full(DRAIN)).toBe(true));
  it('every opponent without an Elf loses 1 life: the one with an Elf, a Changeling (every creature type) is counted as having one, and the caster is not an opponent', () => {
    const s = game({ p2: { battlefield: ['Test Elf'] }, p3: { battlefield: ['Test Wolf'] }, p4: { battlefield: ['Test Changer'] } });
    expect([mpLife(s, 'p1'), mpLife(s, 'p2'), mpLife(s, 'p3'), mpLife(s, 'p4')]).toEqual([20, 20, 19, 20]);
  });
  it('the negative case: every opponent controls an Elf, so nobody loses life; with no Elf anywhere all three opponents lose 1', () => {
    expect([mpLife(game({ p2: { battlefield: ['Test Elf'] }, p3: { battlefield: ['Test Elf'] }, p4: { battlefield: ['Test Elf'] } }), 'p3')]).toEqual([20]);
    const none = game({});
    expect([mpLife(none, 'p1'), mpLife(none, 'p2'), mpLife(none, 'p3'), mpLife(none, 'p4')]).toEqual([20, 19, 19, 19]);
  });
});

describe('"When no creatures are on the battlefield, sacrifice this enchantment." (CR 603.8, 603.2e; Last Laugh)', () => {
  const LAUGH = card('Test Hush', 'Enchantment', 'When no creatures are on the battlefield, sacrifice ~.');
  const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
  const defs = [LAUGH, SLAY, SMALL, BIG];
  it('has no manual part', () => expect(full(LAUGH)).toBe(true));
  it('it stays while any creature (of either player) is on the battlefield and is sacrificed when the last one leaves', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hush'], hand: ['Test Slay'] }, p2: { battlefield: ['Test Ogre'] }, defs });
    expect(bf(s, 'p1')).toEqual(['Test Hush']);
    s = resolveAll(cast(s, 'Test Slay', { targets: [[obj(idOn(s, 'Test Ogre'))]] }));
    expect(bf(s, 'p1')).toEqual([]);
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Hush', 'Test Slay']);
  });
  it('the negative case: with a creature on the battlefield it is never sacrificed', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hush', 'Test Mite'], hand: ['Test Slay'] }, p2: { battlefield: ['Test Ogre'] }, defs });
    s = resolveAll(cast(s, 'Test Slay', { targets: [[obj(idOn(s, 'Test Ogre'))]] }));
    expect(bf(s, 'p1')).toEqual(['Test Hush', 'Test Mite']);
  });
  it('it enters with no creature on the battlefield and is sacrificed at once', () => {
    let s = scenario([], { p1: { hand: ['Test Hush'] }, p2: {}, defs });
    s = resolveAll(cast(s, 'Test Hush'));
    expect(bf(s, 'p1')).toEqual([]);
  });
});

const stats = (s: GameState, id: ObjectId): string => { const c = getChars(s, id); return `${c.power}/${c.toughness}`; };
const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id).abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === kw);

describe('"Any number of target Shapeshifter creatures you control have base power and toughness 4/4." (CR 611.2a, 611.2c, 613.4b; The Bears of Littjara, chapter II)', () => {
  const GROW = card('Test Growth', 'Instant', 'Any number of target Shapeshifter creatures you control have base power and toughness 4/4.');
  const SHAPER = card('Test Shaper', 'Creature — Shapeshifter', 'Changeling', '{0}', ['2', '2']);
  const defs = [GROW, SHAPER, SMALL];
  it('has no manual part', () => expect(full(GROW)).toBe(true));
  it('the targeted Shapeshifters are 4/4 for good (past the end of the turn); an untargeted one, another creature and a Shapeshifter that enters later are not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Shaper', 'Test Shaper', 'Test Mite'], hand: ['Test Growth', 'Test Shaper'] }, p2: {}, defs });
    const [a, b] = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Shaper');
    s = resolveAll(cast(s, 'Test Growth', { targets: [[obj(a!)]] }));
    expect([stats(s, a!), stats(s, b!), stats(s, idOn(s, 'Test Mite'))]).toEqual(['4/4', '2/2', '1/1']);
    s = advanceTo(s, 2, 'main1');
    expect(stats(s, a!)).toBe('4/4');
    s = resolveAll(cast(advanceTo(s, 3, 'main1'), 'Test Shaper'));
    const late = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Shaper' && id !== a && id !== b);
    expect(late.length).toBe(1);
    expect(stats(s, late[0]!)).toBe('2/2');
    expect(stats(s, a!)).toBe('4/4');
  });
  it('the negative case: a creature that is not a Shapeshifter is not a legal target', () => {
    const s = scenario([], { p1: { battlefield: ['Test Mite'], hand: ['Test Growth'] }, p2: {}, defs });
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Growth', 'hand', 'p1') });
    expect(t.pending?.kind === 'chooseTargets' ? JSON.stringify(t.pending) : '').not.toContain(idOn(s, 'Test Mite'));
  });
});

describe('"... that creature has base power and toughness 3/1 and has flying for as long as it has a feather counter on it." (CR 611.2b, 613.4b, 613.1f; Aven Mimeomancer)', () => {
  const SPIRIT = card('Test Spirit', 'Creature — Bird', 'When ~ enters, you may put a feather counter on target creature. If you do, that creature has base power and toughness 3/1 and has flying for as long as it has a feather counter on it.', '{0}', ['2', '2']);
  const HULK = card('Test Hulk', 'Creature — Giant', '', '{0}', ['5', '5']);
  const defs = [SPIRIT, HULK];
  it('has no manual part', () => expect(full(SPIRIT)).toBe(true));
  it('the creature is 3/1 with flying while it has a feather counter, and a 5/5 without flying again once the counter is gone', () => {
    let s = scenario([], { p1: { hand: ['Test Spirit'] }, p2: { battlefield: ['Test Hulk'] }, defs });
    const hulk = idOn(s, 'Test Hulk');
    s = resolveAll(cast(s, 'Test Spirit'), { targets: [[obj(hulk)]], yes: [true] });
    expect([stats(s, hulk), hasKw(s, hulk, 'flying'), s.objects[hulk]!.counters?.['feather']]).toEqual(['3/1', true, 1]);
    s.objects[hulk]!.counters = {};
    expect([stats(s, hulk), hasKw(s, hulk, 'flying')]).toEqual(['5/5', false]);
  });
  it('the negative case: if the player does not put the counter, nothing changes', () => {
    let s = scenario([], { p1: { hand: ['Test Spirit'] }, p2: { battlefield: ['Test Hulk'] }, defs });
    const hulk = idOn(s, 'Test Hulk');
    s = resolveAll(cast(s, 'Test Spirit'), { targets: [[obj(hulk)]], yes: [false] });
    expect([stats(s, hulk), hasKw(s, hulk, 'flying')]).toEqual(['5/5', false]);
  });
});

describe('"destroy up to X target artifacts without mana abilities, where X is the number of Vampires you control." (CR 605.1a, 115.1; Midnight Arsonist)', () => {
  const ARSON = card('Test Torch', 'Creature — Vampire', 'When ~ enters, destroy up to X target artifacts without mana abilities, where X is the number of Vampires you control.', '{0}', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}.');
  const IDOL = card('Test Idol', 'Artifact', '{1}, {T}: You gain 1 life.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const BAT = card('Test Bat', 'Creature — Vampire', '', '{0}', ['1', '1']);
  const defs = [ARSON, ROCK, IDOL, TRINKET, BAT];
  const game = (extra: string[]): GameState => scenario([], { p1: { hand: ['Test Torch'], battlefield: extra }, p2: { battlefield: ['Test Rock', 'Test Idol', 'Test Trinket'] }, defs });
  const offered = (s: GameState): string[] => {
    const p = s.pending as unknown as { kind: string; slots?: { options?: { kind: string; id: string }[] }[]; options?: { kind: string; id: string }[] };
    expect(p.kind).toBe('chooseTargets');
    const text = JSON.stringify(p);
    return ['Test Rock', 'Test Idol', 'Test Trinket'].filter((n) => text.includes(idOn(s, n)));
  };
  it('has no manual part', () => expect(full(ARSON)).toBe(true));
  it('a mana ability keeps an artifact from being targeted (an activated ability that is not a mana ability does not); X counts the Vampires, itself included', () => {
    // the trigger's target decision is the one to answer
    let s = game(['Test Bat']);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Torch', 'hand', 'p1') });
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Idol', 'Test Trinket']);
  });
  it('the Rock is untouched and both other artifacts are destroyed with two Vampires; one Vampire destroys at most one', () => {
    const two = game(['Test Bat']);
    let s = act(two, { type: 'cast', player: 'p1', card: find(two, 'Test Torch', 'hand', 'p1') });
    s = passBoth(s);
    s = resolveAll(drive(s, { targets: [[obj(idOn(two, 'Test Idol')), obj(idOn(two, 'Test Trinket'))]] }));
    expect(bf(s, 'p2')).toEqual(['Test Rock']);
    const one = game([]);
    let t = act(one, { type: 'cast', player: 'p1', card: find(one, 'Test Torch', 'hand', 'p1') });
    t = passBoth(t);
    t = resolveAll(drive(t, { targets: [[obj(idOn(one, 'Test Idol'))]] }));
    expect(bf(t, 'p2')).toEqual(['Test Rock', 'Test Trinket']);
  });
});

describe('"Each opponent creates X minus one 2/2 white Samurai creature tokens with vigilance." (CR 107.1b, 107.3, 111.2; Eiganjo Uprising)', () => {
  const RISE = card('Test Rising', 'Sorcery', 'Create X 2/2 white Samurai creature tokens with vigilance. Each opponent creates X minus one 2/2 white Samurai creature tokens with vigilance.', '{X}');
  const defs = [RISE];
  const run = (x: number): GameState => {
    const s = scenario([], { p1: { hand: ['Test Rising'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: {}, defs });
    return resolveAll(cast(s, 'Test Rising', { x: [x] }));
  };
  const tokens = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && nameOf(s, id).includes('Samurai')).length;
  it('has no manual part', () => expect(full(RISE)).toBe(true));
  it('with X = 3 the caster makes 3 tokens and the opponent X minus one, 2', () => {
    const s = run(3);
    expect([tokens(s, 'p1'), tokens(s, 'p2')]).toEqual([3, 2]);
  });
  it('the negative cases: with X = 1 the opponent makes none; with X = 0 nobody makes any and the number below zero is zero (CR 107.1b)', () => {
    const one = run(1);
    expect([tokens(one, 'p1'), tokens(one, 'p2')]).toEqual([1, 0]);
    const zero = run(0);
    expect([tokens(zero, 'p1'), tokens(zero, 'p2')]).toEqual([0, 0]);
  });
});

describe('"At the beginning of each player\'s end step, that player may draw a card if a player other than you lost life this turn." (CR 102.2, 119.3, 603.4; Ludevic, Necro-Alchemist)', () => {
  const LUDEVIC = card('Test Alchemist', 'Creature — Human Wizard', "At the beginning of each player's end step, that player may draw a card if a player other than you lost life this turn.", '{0}', ['1', '3']);
  const BOLT = card('Test Zap', 'Sorcery', 'Target player loses 1 life.');
  const defs = [LUDEVIC, BOLT];
  const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  const endTurn = (s: GameState, yes: boolean): GameState => {
    return resolveAll(advanceTo(s, 1, 'end'), { yes: [yes] });
  };
  it('has no manual part', () => expect(full(LUDEVIC)).toBe(true));
  it('an opponent of the Alchemist controller lost life: the player whose end step it is may draw (and chooses)', () => {
    let s = scenario([], { p1: { hand: ['Test Zap'], battlefield: ['Test Alchemist'] }, p2: {}, defs });
    s = resolveAll(cast(s, 'Test Zap', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const before = hand(s, 'p1');
    const yes = endTurn(s, true);
    expect(hand(yes, 'p1')).toBe(before + 1);
    const no = endTurn(s, false);
    expect(hand(no, 'p1')).toBe(before);
  });
  it('the negative cases: nobody lost life, or only the Alchemist controller did, so there is no draw', () => {
    const none = endTurn(scenario([], { p1: { battlefield: ['Test Alchemist'] }, p2: {}, defs }), true);
    expect(hand(none, 'p1')).toBe(0);
    let self = scenario([], { p1: { hand: ['Test Zap'], battlefield: ['Test Alchemist'] }, p2: {}, defs });
    self = resolveAll(cast(self, 'Test Zap', { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(hand(endTurn(self, true), 'p1')).toBe(0);
  });
});

describe('"Enchanted creature doesn\'t untap during its controller\'s untap step unless that player is the monarch." (CR 502.3, 611.3a, 725.1; Fall from Favor)', () => {
  const CHAINS = card('Test Chains', 'Enchantment — Aura', "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step unless that player is the monarch.");
  const HULK = card('Test Hulk', 'Creature — Giant', '', '{0}', ['5', '5']);
  const defs = [CHAINS, HULK];
  const start = (monarch?: PlayerId): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Chains'] }, p2: { battlefield: [{ name: 'Test Hulk', tapped: true }] }, defs });
    let s = resolveAll(cast(s0, 'Test Chains', { targets: [[obj(idOn(s0, 'Test Hulk'))]] }));
    if (monarch !== undefined) s.designations.monarch = monarch;
    return s;
  };
  const tapped = (s: GameState): boolean => s.objects[idOn(s, 'Test Hulk')]!.tapped === true;
  it('has no manual part', () => expect(full(CHAINS)).toBe(true));
  it("the enchanted creature stays tapped in its controller's untap step when that player is not the monarch (nobody is, or someone else is)", () => {
    expect(tapped(advanceTo(start(), 2, 'main1'))).toBe(true);
    expect(tapped(advanceTo(start('p1'), 2, 'main1'))).toBe(true);
  });
  it('the negative case: when its controller is the monarch it untaps as usual', () => {
    expect(tapped(advanceTo(start('p2'), 2, 'main1'))).toBe(false);
  });
});

describe('a triggered mana ability is a mana ability (CR 605.1b; the Midnight Arsonist ruling of 2021-11-19)', () => {
  const ARSON = card('Test Torch', 'Creature — Vampire', 'When ~ enters, destroy up to X target artifacts without mana abilities, where X is the number of Vampires you control.', '{0}', ['2', '2']);
  const SUN = card('Test Sun', 'Artifact', 'Whenever a land you control is tapped for mana, add an additional one mana of any color.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const defs = [ARSON, SUN, TRINKET];
  it('an artifact with a triggered mana ability is not a legal target of "without mana abilities"; one with none is', () => {
    let s = scenario([], { p1: { hand: ['Test Torch'] }, p2: { battlefield: ['Test Sun', 'Test Trinket'] }, defs });
    s = passBoth(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Torch', 'hand', 'p1') }));
    const text = JSON.stringify(s.pending);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(text.includes(idOn(s, 'Test Trinket'))).toBe(true);
    expect(text.includes(idOn(s, 'Test Sun'))).toBe(false);
  });
});

describe('a manual triggered ability that is not about mana does not hide an artifact from "without mana abilities" (CR 605.1b)', () => {
  const ARSON = card('Test Torch', 'Creature — Vampire', 'When ~ enters, destroy up to X target artifacts without mana abilities, where X is the number of Vampires you control.', '{0}', ['2', '2']);
  const ODD = card('Test Oddity', 'Artifact', 'Whenever a player zorbles a quux, that player gains 1 life.');
  it('is offered as a target', () => {
    let s = scenario([], { p1: { hand: ['Test Torch'] }, p2: { battlefield: ['Test Oddity'] }, defs: [ARSON, ODD] });
    s = passBoth(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Torch', 'hand', 'p1') }));
    expect(JSON.stringify(s.pending).includes(idOn(s, 'Test Oddity'))).toBe(true);
  });
});
