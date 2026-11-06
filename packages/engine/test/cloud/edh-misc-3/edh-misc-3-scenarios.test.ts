/**
 * Commander lane edh-misc, round edh-misc-3, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). Each new reading with its negative case. CR cites from the Comprehensive Rules of 2026-09-25 (fetched in the round) unless a record lists them as unverified.
 *
 *   CR 400.3, 608.2b, 205.3m    "return all creatures to their owners' hands except for Krakens, Leviathans, and Serpents"
 *   CR 400.3, 110.2, 903.3      "return target commander you own from the battlefield to your hand"
 *   CR 701.37a, 107.3a, 122.1   "monstrosity X, where X is the number of counters among creatures you control"
 *   promoted narrow wordings (6.9 deviation, named in the record), each played with its negative case:
 *   CR 506.1, 604.1, 701.15a    "Your opponents can't cast spells during combat" + goad each creature that player controls (Marisi)
 *   CR 903.3, 604.1, 613.1f     Lieutenant: "As long as you control your commander, ~ gets +2/+2 and creatures you control have vigilance" (Angelic Field Marshal)
 *   CR 508.4, 111.2, 603.2      "Whenever you attack a player, create a token that's tapped and attacking that player" (Soaring Lightbringer)
 *   CR 614.1c, 614.12, 122.6    Master Chef: commander creatures you own have "enters with an additional +1/+1 counter" and "Other creatures you control enter with an additional +1/+1 counter"
 *   CR 608.2d, 110.2, 107.1c    "Put any number of land cards from your hand onto the battlefield tapped" (Wrenn and Seven); "-3: create a Treefolk token ... equal to the number of lands you control"
 *   CR 106.6, 101.2, 702.1     "If that mana is spent on an instant or sorcery spell, that spell can't be countered" (Boseiju)
 *   CR 611.2a, 508.1h, 714      chapters of a Saga creature: exile a tapped creature; X Treasures for the opponents who control a creature with power 4 or greater (Summon: Yojimbo)
 *   CR 608.2c, 119.3            "Exile all creature cards from target player's graveyard. You gain 3 life for each card exiled this way" (Crypt Incursion)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, getChars, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, put, scenario } from '../../m3/scenario';
import { answerUntilPriority, card as cmdCard, commanderOnBattlefield, commanderScenario, inCommand, legend } from '../../m11/rules/helpers';
import { runCombat, toDeclareAttackers, declareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

export function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, owner?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (!owner || s.objects[id]!.controller === owner));
const inHand = (s: GameState, name: string, owner: 'p1' | 'p2'): number => s.zones.hand[owner]!.filter((id) => chars(s, id).name === name).length;
const pt = (s: GameState, id: ObjectId): [string, string] => [chars(s, id).power!, chars(s, id).toughness!];

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
export function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d$/.test(id) ? { kind: 'player' as const, id: id as 'p1' | 'p2' } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'commanderZone') s = answer(s, { kind: 'commanderZone', command: o.yes ?? true }); // CR 903.9b: the commander's owner may put it into the command zone instead
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
export function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
export const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const lifeOf = (s: GameState, p: 'p1' | 'p2' | 'p3' | 'p4'): number => s.players.find((x) => x.id === p)!.life;

describe('CR 400.3, 608.2b, 205.3m: "return all creatures to their owners\' hands except for Krakens, Leviathans, Octopuses, and Serpents"', () => {
  const WAVE = card('Test Tide', 'Sorcery', "Return all creatures to their owners' hands except for Krakens, Leviathans, Octopuses, and Serpents.");
  const KRAKEN = card('Test Kraken', 'Creature — Kraken', '', { pt: ['5', '5'] });
  const SERPENT = card('Test Serpent', 'Creature — Serpent', '', { pt: ['3', '3'] });
  const OCTOPUS = card('Test Octopus', 'Creature — Octopus', '', { pt: ['1', '1'] });
  const defs = [WAVE, KRAKEN, SERPENT, OCTOPUS, BEAR];
  it('is fully automated', () => expect(full(WAVE)).toBe(true));
  it('every creature but the listed types goes to its owner\'s hand (both players\'), the listed types stay', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Tide'], battlefield: ['Test Bear', 'Test Kraken'] }, p2: { battlefield: ['Test Bear', 'Test Serpent', 'Test Octopus'] } });
    s = cast(s, 'Test Tide');
    expect(onField(s, 'Test Bear').length).toBe(0);
    expect(inHand(s, 'Test Bear', 'p1')).toBe(1);
    expect(inHand(s, 'Test Bear', 'p2')).toBe(1);
    expect(onField(s, 'Test Kraken', 'p1').length).toBe(1);
    expect(onField(s, 'Test Serpent', 'p2').length).toBe(1);
    expect(onField(s, 'Test Octopus', 'p2').length).toBe(1);
  });
  it('the negative case: with no creature of a listed type, every creature returns', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Tide'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Tide');
    expect(s.zones.battlefield.filter((id) => chars(s, id).types.includes('Creature')).length).toBe(0);
  });
});

describe('CR 400.3, 110.2, 903.3: "return target commander you own from the battlefield to your hand" (Sanctum of Eternity)', () => {
  const SANCTUM = cmdCard('Test Sanctum', '{3}', 'Artifact', '{T}: Add {C}.\n{0}, {T}: Return target commander you own from the battlefield to your hand. Activate only during your turn.');
  const KING = legend('Test Commander King', '{1}{G}', ['3', '3'], ['G']);
  const OTHER = legend('Test Other Commander', '{G}', ['1', '1'], ['G']);
  const GUARD = cmdCard('Test Guard', '{G}', 'Creature — Soldier', '', ['2', '2']);
  const start = (): GameState => commanderOnBattlefield(commanderScenario({ p1Commanders: [KING], p2Commanders: [OTHER], defs: [SANCTUM, GUARD], p1: { battlefield: ['Test Sanctum', 'Test Commander King', 'Test Guard'] } }), 'Test Commander King');
  const returnKey = (s: GameState): string => activatedAbilities(s, s.objects[find(s, 'Test Sanctum', 'battlefield', 'p1')]!).find((i) => i.def.isMana !== true)!.key;
  it('is fully automated', () => expect(full(SANCTUM)).toBe(true));
  it('returns your commander from the battlefield to your hand (declining the command zone), and only a commander: the plain creature is not offered', () => {
    let s = start();
    const king = find(s, 'Test Commander King', 'battlefield', 'p1');
    const guard = find(s, 'Test Guard', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Sanctum', 'battlefield', 'p1'), ability: returnKey(s) });
    expect(s.pending!.kind).toBe('chooseTargets');
    const p = s.pending as { kind: 'chooseTargets'; specs?: { options?: { id: ObjectId }[] }[] };
    const offered = JSON.stringify(p);
    expect(offered).toContain(king);
    expect(offered).not.toContain(guard);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: king }] }), { yes: false });
    expect(s.zones.hand.p1!.some((id) => chars(s, id).name === 'Test Commander King')).toBe(true);
    expect(s.zones.battlefield.includes(guard)).toBe(true);
  });
  it('the negative case: an opponent\'s commander on the battlefield is not "a commander you own"', () => {
    let s = commanderOnBattlefield(commanderScenario({ p1Commanders: [KING], p2Commanders: [OTHER], defs: [SANCTUM, GUARD], p1: { battlefield: ['Test Sanctum'] }, p2: { battlefield: ['Test Other Commander'] } }), 'Test Other Commander');
    expect(() => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Sanctum', 'battlefield', 'p1'), ability: returnKey(s) })).toThrow(/no legal one/); // CR 602.2b
  });
});

describe('CR 701.37a, 107.3a, 122.1: "monstrosity X, where X is the number of counters among creatures you control" (Maester Seymour)', () => {
  const SAGE = card('Test Sage', 'Creature — Wizard', '{0}: Monstrosity X, where X is the number of counters among creatures you control.', { pt: ['2', '2'] });
  const defs = [SAGE, BEAR];
  const key = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
  it('is fully automated', () => expect(full(SAGE)).toBe(true));
  it('X counts every counter among creatures you control as the ability resolves: three counters make three +1/+1 counters', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Sage', counters: { charge: 1 } }, { name: 'Test Bear', counters: { shield: 2 } }] } });
    const sage = find(s, 'Test Sage', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: sage, ability: key(s, sage) }));
    expect(s.objects[sage]!.counters['+1/+1']).toBe(3);
    expect(pt(s, sage)).toEqual(['5', '5']);
  });
  it('the negative case: an opponent\'s counters are not counted ("creatures you control")', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Sage', counters: { charge: 1 } }] }, p2: { battlefield: [{ name: 'Test Bear', counters: { shield: 4 } }] } });
    const sage = find(s, 'Test Sage', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: sage, ability: key(s, sage) }));
    expect(s.objects[sage]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 506.1, 604.1, 701.15a: "Your opponents can\'t cast spells during combat." and "Whenever a creature you control deals combat damage to a player, goad each creature that player controls." (Marisi)', () => {
  const CAT = card('Test Coil Cat', 'Legendary Creature — Cat Warrior', "Your opponents can't cast spells during combat.\nWhenever a creature you control deals combat damage to a player, goad each creature that player controls.", { pt: ['2', '2'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const defs = [CAT, BEAR, ZAP];
  it('is fully automated', () => expect(full(CAT)).toBe(true));
  it('a creature of yours dealing combat damage to a player goads every creature that player controls (and not yours); a creature that was not there is untouched', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Coil Cat', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    const cat = find(s, 'Test Coil Cat', 'battlefield', 'p1');
    s = runCombat(s, { attack: [[cat]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(theirs.length).toBe(2);
    for (const id of theirs) expect(s.objects[id]!.goaded).toEqual([{ by: 'p1' }]);
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.controller === 'p1')) expect(s.objects[id]!.goaded).toBeUndefined();
  });
  it('the negative case: blocked, no combat damage to a player, nobody is goaded', () => {
    let s = scenario([], { defs: [...defs, ELF], p1: { battlefield: ['Test Coil Cat'] }, p2: { battlefield: ['Test Bear', 'Test Elf'] } });
    const cat = find(s, 'Test Coil Cat', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = runCombat(s, { attack: [[cat]], block: [[bear, cat]], assign: { [cat]: [{ id: bear, amount: 2 }] } });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.objects[find(s, 'Test Elf', 'battlefield', 'p2')]!.goaded).toBeUndefined();
  });
  it('an opponent can\'t cast an instant in the beginning of combat step, while the controller can (CR 506.1: the whole combat phase)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Zap'], battlefield: ['Test Coil Cat'] }, p2: { hand: ['Test Zap'] } });
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(() => act(combat, { type: 'cast', player: 'p1', card: find(combat, 'Test Zap', 'hand', 'p1') })).not.toThrow();
    const theirs = pass(combat);
    expect(() => act(theirs, { type: 'cast', player: 'p2', card: find(theirs, 'Test Zap', 'hand', 'p2') })).toThrow(/cast/i);
  });
});

describe('CR 903.3, 604.1, 613.1f: Lieutenant "As long as you control your commander, ~ gets +2/+2 and creatures you control have vigilance." (Angelic Field Marshal)', () => {
  const MARSHAL = cmdCard('Test Lieutenant Angel', '{2}{W}', 'Creature — Angel', 'Flying\nLieutenant — As long as you control your commander, this creature gets +2/+2 and creatures you control have vigilance.', ['2', '2']);
  const KING = legend('Test Commander King', '{1}{G}', ['3', '3'], ['G']);
  const OTHER = legend('Test Other Commander', '{G}', ['1', '1'], ['G']);
  const GUARD = cmdCard('Test Guard', '{G}', 'Creature — Soldier', '', ['2', '2']);
  const defs = [MARSHAL, GUARD];
  const hasVigilance = (s: GameState, id: ObjectId): boolean => chars(s, id).keywords.some((x) => x.keyword === 'vigilance');
  it('is fully automated', () => expect(full(MARSHAL)).toBe(true));
  it('with your commander on the battlefield: the Angel is 4/4 and every creature you control, itself included, has vigilance; an opponent\'s creature does not', () => {
    const s = commanderOnBattlefield(commanderScenario({ p1Commanders: [KING], p2Commanders: [OTHER], defs, p1: { battlefield: ['Test Lieutenant Angel', 'Test Commander King', 'Test Guard'] }, p2: { battlefield: ['Test Guard'] } }), 'Test Commander King');
    const angel = find(s, 'Test Lieutenant Angel', 'battlefield', 'p1');
    expect(pt(s, angel)).toEqual(['4', '4']);
    expect(hasVigilance(s, angel)).toBe(true);
    expect(hasVigilance(s, find(s, 'Test Guard', 'battlefield', 'p1'))).toBe(true);
    expect(hasVigilance(s, find(s, 'Test Guard', 'battlefield', 'p2'))).toBe(false);
  });
  it('the negative case: without your commander on the battlefield (it is in the command zone) it is a 2/2 and nobody has vigilance; an opponent\'s commander does not count', () => {
    const s = commanderOnBattlefield(commanderScenario({ p1Commanders: [KING], p2Commanders: [OTHER], defs, p1: { battlefield: ['Test Lieutenant Angel', 'Test Guard'] }, p2: { battlefield: ['Test Other Commander'] } }), 'Test Other Commander');
    const angel = find(s, 'Test Lieutenant Angel', 'battlefield', 'p1');
    expect(pt(s, angel)).toEqual(['2', '2']);
    expect(hasVigilance(s, find(s, 'Test Guard', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('CR 508.4, 111.2, 603.2: "Whenever you attack a player, create a 1/1 ... token that\'s tapped and attacking that player." (Soaring Lightbringer)', () => {
  const BIRD = card('Test Glimmer Bird', 'Enchantment Creature — Bird Glimmer', "Flying\nOther enchantment creatures you control have flying.\nWhenever you attack a player, create a 1/1 white Glimmer enchantment creature token that's tapped and attacking that player.", { pt: ['3', '3'] });
  const GLIM = card('Test Plain Glimmer', 'Enchantment Creature — Glimmer', '', { pt: ['1', '1'] });
  const defs = [BIRD, GLIM, BEAR];
  const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  /** Order the triggers as asked, pass priority until the stack is empty and `n` tokens are on the battlefield. */
  const settle = (s0: GameState, n: number): GameState => {
    let s = s0;
    for (let i = 0; i < 40; i++) {
      if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
      else if (s.pending?.kind === 'priority' && s.zones.stack.length === 0 && tokens(s).length >= n) return s;
      else if (s.pending?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${s.pending?.kind}`);
    }
    throw new Error('the tokens never appeared');
  };
  it('is fully automated', () => expect(full(BIRD)).toBe(true));
  it('one token for each player you attack: attacking two opponents makes two tokens, each tapped and attacking the player that was attacked; they deal damage to those players', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Glimmer Bird'] } } });
    const bears = s.zones.battlefield.filter((id) => chars(s, id).name === 'Test Bear');
    s = declareAttackers(toDeclareAttackers(s), [[bears[0]!, 'p2'], [bears[1]!, 'p3']]);
    s = settle(s, 2);
    const toks = tokens(s);
    expect(toks.length).toBe(2);
    expect(new Set(toks.map((t) => JSON.stringify(s.combat?.attackers.find((a) => a.id === t)?.defender))).size).toBe(2);
    for (const t of toks) {
      expect(s.objects[t]!.tapped).toBe(true);
      expect(pt(s, t)).toEqual(['1', '1']);
    }
  });
  it('attacking only one player makes exactly one token', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Glimmer Bird'] } } });
    const bears = s.zones.battlefield.filter((id) => chars(s, id).name === 'Test Bear');
    s = declareAttackers(toDeclareAttackers(s), [[bears[0]!, 'p2'], [bears[1]!, 'p2']]);
    s = settle(s, 1);
    expect(tokens(s).length).toBe(1);
  });
  it('other enchantment creatures you control have flying; a plain creature and an opponent\'s enchantment creature do not', () => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Glimmer Bird', 'Test Plain Glimmer', 'Test Bear'] }, p2: { battlefield: ['Test Plain Glimmer'] } } });
    const flies = (id: ObjectId): boolean => chars(s, id).keywords.some((k) => k.keyword === 'flying');
    expect(flies(find(s, 'Test Plain Glimmer', 'battlefield', 'p1'))).toBe(true);
    expect(flies(find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(false);
    expect(flies(find(s, 'Test Plain Glimmer', 'battlefield', 'p2'))).toBe(false);
  });
});

describe('CR 608.2c, 119.3: "Exile all creature cards from target player\'s graveyard. You gain 3 life for each card exiled this way." (Crypt Incursion)', () => {
  const SPELL = card('Test Grave Tide', 'Instant', "Exile all creature cards from target player's graveyard. You gain 3 life for each card exiled this way.");
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  const defs = [SPELL, BEAR, ZAP];
  const exiledNames = (s: GameState): string[] => s.zones.exile.map((id) => chars(s, id).name).sort();
  it('is fully automated', () => expect(full(SPELL)).toBe(true));
  it('three life for each creature card exiled: two creature cards and an instant in the target\'s graveyard make 6 life, and only the creature cards are exiled', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Grave Tide'] }, p2: { graveyard: ['Test Bear', 'Test Bear', 'Test Zap'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grave Tide', { targets: [['p2']] });
    expect(exiledNames(s)).toEqual(['Test Bear', 'Test Bear']);
    expect(life(s, 'p1') - before).toBe(6);
    expect(s.zones.graveyard.p2!.map((id) => chars(s, id).name)).toEqual(['Test Zap']);
  });
  it('the negative case: your own graveyard is untouched when an opponent is the target, and a graveyard with no creature card gains nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Grave Tide'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Zap'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grave Tide', { targets: [['p2']] });
    expect(exiledNames(s)).toEqual([]);
    expect(life(s, 'p1')).toBe(before);
    expect(s.zones.graveyard.p1!.map((id) => chars(s, id).name).sort()).toEqual(['Test Bear', 'Test Grave Tide']); // the spell itself, and the untouched creature card
  });
  it('the target may be yourself: your own creature cards are exiled and counted', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Grave Tide'], graveyard: ['Test Bear'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grave Tide', { targets: [['p1']] });
    expect(exiledNames(s)).toEqual(['Test Bear']);
    expect(life(s, 'p1') - before).toBe(3);
  });
});

describe('CR 614.1c, 614.12, 122.6: "Commander creatures you own have \'This creature enters with an additional +1/+1 counter on it\' and \'Other creatures you control enter with an additional +1/+1 counter on them.\'" (Master Chef)', () => {
  const CHEF = cmdCard('Test Sous Chef', '{2}{G}', 'Legendary Enchantment — Background', "Commander creatures you own have \"This creature enters with an additional +1/+1 counter on it\" and \"Other creatures you control enter with an additional +1/+1 counter on them.\"");
  const HERO = legend('Test Commander Hero', '{G}', ['1', '1'], ['G']);
  const OTHER = legend('Test Other Commander', '{G}', ['1', '1'], ['G']);
  const CUB = cmdCard('Test Cub', '{G}', 'Creature — Bear', '', ['1', '1']);
  const defs = [CHEF, CUB];
  const plusOnes = (s: GameState, name: string, owner: 'p1' | 'p2' = 'p1'): number => Number(s.objects[find(s, name, 'battlefield', owner)]!.counters['+1/+1'] ?? 0);
  const castFromHand = (s0: GameState, name: string): GameState => resolveAll(answerUntilPriority(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') })));
  it('is fully automated', () => expect(full(CHEF)).toBe(true));
  it('your commander creature cast from the command zone enters with the extra counter (CR 614.12: the replacement of a granted ability functions as it enters)', () => {
    let s = commanderScenario({ p1Commanders: [HERO], p2Commanders: [OTHER], defs, p1: { battlefield: ['Test Sous Chef', 'Forest', 'Forest'] } });
    s = resolveAll(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Commander Hero') })));
    expect(plusOnes(s, 'Test Commander Hero')).toBe(1);
  });
  it('while your commander creature is on the battlefield, your other creatures enter with a counter; an opponent\'s do not', () => {
    let s = commanderOnBattlefield(commanderScenario({ p1Commanders: [HERO], p2Commanders: [OTHER], defs, p1: { battlefield: ['Test Sous Chef', 'Test Commander Hero', 'Forest'], hand: ['Test Cub'] } }), 'Test Commander Hero');
    s = castFromHand(s, 'Test Cub');
    expect(plusOnes(s, 'Test Cub')).toBe(1);
  });
  it('the negative case: without your commander creature on the battlefield, a creature you cast enters with no counter (the second ability is granted to the commander only)', () => {
    let s = commanderScenario({ p1Commanders: [HERO], p2Commanders: [OTHER], defs, p1: { battlefield: ['Test Sous Chef', 'Forest'], hand: ['Test Cub'] } });
    s = castFromHand(s, 'Test Cub');
    expect(plusOnes(s, 'Test Cub')).toBe(0);
  });
  it('the negative case: only a commander creature YOU own is given the abilities: with just an opponent\'s commander on the battlefield your creature enters with no counter', () => {
    let s = commanderOnBattlefield(commanderScenario({ p1Commanders: [HERO], p2Commanders: [OTHER], defs, p1: { battlefield: ['Test Sous Chef', 'Forest'], hand: ['Test Cub'] }, p2: { battlefield: ['Test Other Commander'] } }), 'Test Other Commander');
    s = castFromHand(s, 'Test Cub');
    expect(plusOnes(s, 'Test Cub')).toBe(0);
  });
});

describe('CR 608.2d, 110.2, 107.1c: Wrenn and Seven\'s "0: Put any number of land cards from your hand onto the battlefield tapped." and "-3: Create a green Treefolk creature token with reach ..."', () => {
  const SEVEN = compileCard({
    name: 'Test Seven Wrenn', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Wrenn', loyalty: '5', colors: [],
    oracle_text: '+1: Reveal the top four cards of your library. Put all land cards revealed this way into your hand and the rest into your graveyard.\n0: Put any number of land cards from your hand onto the battlefield tapped.\n-3: Create a green Treefolk creature token with reach and "This token\'s power and toughness are each equal to the number of lands you control."',
  } as OracleCard);
  const defs = [SEVEN, BEAR];
  const keys = (s: GameState): string[] => activatedAbilities(s, s.objects[find(s, 'Test Seven Wrenn', 'battlefield', 'p1')]!).filter((i) => i.def.isMana !== true).map((i) => i.key);
  const lands = (s: GameState, owner: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).types.includes('Land') && s.objects[id]!.controller === owner);
  it('is parsed with all abilities understood', () => expect(JSON.stringify(SEVEN.faces[0]!.abilities)).not.toContain('"op":"manual"'));
  it('the 0 ability puts the lands you choose (any number, here two of three) onto the battlefield tapped, and leaves the rest and nonland cards in hand', () => {
    let s = scenario(['Forest'], { defs, p1: { battlefield: [{ name: 'Test Seven Wrenn', counters: { loyalty: 5 } }], hand: ['Plains', 'Plains', 'Forest', 'Test Bear'] } });
    const seven = find(s, 'Test Seven Wrenn', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: seven, ability: keys(s)[1]! });
    s = resolveAll(s, { pick: (options) => options.filter((id) => chars(s, id).name !== 'Forest').slice(0, 2) });
    expect(lands(s).length).toBe(2);
    expect(lands(s).every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.zones.hand.p1!.map((id) => chars(s, id).name).sort()).toEqual(['Forest', 'Test Bear']);
    expect(s.objects[seven]!.counters['loyalty']).toBe(5);
  });
  it('choosing none is allowed (any number includes zero)', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Seven Wrenn', counters: { loyalty: 5 } }], hand: ['Plains'] } });
    const seven = find(s, 'Test Seven Wrenn', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: seven, ability: keys(s)[1]! });
    s = resolveAll(s, { pick: () => [] });
    expect(lands(s).length).toBe(0);
    expect(s.zones.hand.p1!.length).toBe(1);
  });
  it('the +1 ability (reveal the top four, lands to hand, the rest to the graveyard) sends exactly the top four: no card under them moves', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Seven Wrenn', counters: { loyalty: 5 } }], library: ['Test Bear', 'Plains', 'Test Bear', 'Plains', 'Test Bear'] } });
    const top = s.zones.library.p1!.slice(0, 4).map((id) => chars(s, id).name); // the first card of the list is the top of the library
    const under = s.zones.library.p1![4]!;
    const seven = find(s, 'Test Seven Wrenn', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: seven, ability: keys(s)[0]! }));
    expect(top).toEqual(['Test Bear', 'Plains', 'Test Bear', 'Plains']);
    expect(s.zones.hand.p1!.map((id) => chars(s, id).name)).toEqual(['Plains', 'Plains']);
    expect(s.zones.graveyard.p1!.map((id) => chars(s, id).name)).toEqual(['Test Bear', 'Test Bear']);
    expect(s.zones.library.p1![0]).toBe(under);
  });
  it('the -3 ability creates a green Treefolk with reach whose power and toughness equal the lands YOU control now (an opponent\'s lands do not count), and it changes as lands arrive', () => {
    let s = scenario(['Forest'], { defs, p1: { battlefield: [{ name: 'Test Seven Wrenn', counters: { loyalty: 5 } }, 'Plains', 'Plains', 'Forest'], hand: ['Plains'] }, p2: { battlefield: ['Plains', 'Plains'] } });
    const seven = find(s, 'Test Seven Wrenn', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: seven, ability: keys(s)[2]! }));
    const tree = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(chars(s, tree).keywords.some((k) => k.keyword === 'reach')).toBe(true);
    expect(chars(s, tree).colors).toEqual(['G']);
    expect(pt(s, tree)).toEqual(['3', '3']);
    expect(s.objects[seven]!.counters['loyalty']).toBe(2);
    // a fourth land of yours makes it 4/4 (a characteristic-defining ability, CR 604.3, 613.4a)
    put(s, 'p1', 'battlefield', 'Plains');
    expect(pt(s, tree)).toEqual(['4', '4']);
  });
});

describe('CR 106.6, 101.2: "If that mana is spent on an instant or sorcery spell, that spell can\'t be countered." (Boseiju)', () => {
  const SHELTER = card('Test Shelter Grove', 'Legendary Land', "{T}, Pay 2 life: Add {C}. If that mana is spent on an instant or sorcery spell, that spell can't be countered.");
  const PLAIN_ZAP = card('Test Little Zap', 'Instant', 'You gain 1 life.', { cost: '{1}' });
  const WISP = card('Test Cheap Wisp', 'Creature — Spirit', '', { pt: ['1', '1'], cost: '{1}' });
  const HUSH = card('Test Hush', 'Instant', 'Counter target spell.');
  const defs = [SHELTER, PLAIN_ZAP, WISP, HUSH];
  const tap = (s: GameState, id: ObjectId): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === id);
    if (!a) throw new Error('no mana ability');
    return resolveAll(act(s, a.action));
  };
  /** p1 casts `name` with the Grove\'s mana (when `grove`) and p2 answers it with Test Hush. */
  const countered = (name: string, grove: boolean): { s: GameState; spellResolved: boolean } => {
    let s = scenario([], { defs, p1: { hand: [name], battlefield: ['Test Shelter Grove', 'Plains'] }, p2: { hand: ['Test Hush'] } });
    s = tap(s, find(s, grove ? 'Test Shelter Grove' : 'Plains', 'battlefield', 'p1'));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(s); // p2 has priority with the spell on the stack
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hush', 'hand', 'p2') });
    s = drive(s, { targets: [[s.zones.stack[0]!]] });
    for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    const resolved = name === 'Test Cheap Wisp' ? s.zones.battlefield.some((id) => chars(s, id).name === name) : life(s, 'p1') === 20 - 2 + 1;
    return { s, spellResolved: resolved };
  };
  it('is fully automated', () => expect(full(SHELTER)).toBe(true));
  it('an instant paid with the land\'s mana is not countered: the counterspell resolves and does nothing, the instant\'s effect happens', () => {
    expect(countered('Test Little Zap', true).spellResolved).toBe(true);
  });
  it('the negative case: the same instant paid with another land\'s mana is countered', () => {
    expect(countered('Test Little Zap', false).spellResolved).toBe(false);
  });
  it('the negative case: a creature spell paid with the land\'s mana is not covered ("instant or sorcery spell") and is countered', () => {
    expect(countered('Test Cheap Wisp', true).spellResolved).toBe(false);
  });
});

describe('CR 714, 611.2a, 508.1h: a Saga creature\'s chapters (Summon: Yojimbo)', () => {
  const YOJIMBO = card('Test Summon Samurai', 'Enchantment Creature — Saga Samurai', "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI — Exile target artifact, enchantment, or tapped creature an opponent controls.\nII, III — Until your next turn, creatures can't attack you unless their controller pays {2} for each of those creatures.\nIV — Create X Treasure tokens, where X is the number of opponents who control a creature with power 4 or greater.\nVigilance", { pt: ['3', '3'] });
  const BIG = card('Test Big Brute', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const SMALL = card('Test Small Brute', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const defs = [YOJIMBO, BIG, SMALL, BEAR];
  const treasures = (s: GameState): number => s.zones.battlefield.filter((id) => chars(s, id).name === 'Treasure Token' && s.objects[id]!.controller === 'p1').length;
  it('is fully automated', () => expect(full(YOJIMBO)).toBe(true));
  it('chapter I (as it enters): exiles a TAPPED creature an opponent controls; an untapped creature and your own creature are not legal targets', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Summon Samurai'], battlefield: [{ name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Big Brute', tapped: true }, 'Test Small Brute'] } });
    const tappedBrute = find(s, 'Test Big Brute', 'battlefield', 'p2');
    const untappedBrute = find(s, 'Test Small Brute', 'battlefield', 'p2');
    const own = find(s, 'Test Bear', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Summon Samurai', 'hand', 'p1') });
    s = resolveAll(s, { targets: [[tappedBrute]] });
    expect(s.zones.exile.map((id) => chars(s, id).name)).toEqual(['Test Big Brute']);
    expect(s.zones.battlefield.includes(untappedBrute)).toBe(true);
    expect(s.zones.battlefield.includes(own)).toBe(true);
  });
  it('chapter IV: one Treasure for each opponent who controls a creature with power 4 or greater (here two of three opponents), then the Saga is sacrificed', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Summon Samurai', counters: { lore: 3 } }] }, p2: { battlefield: ['Test Big Brute', 'Test Big Brute'] }, p3: { battlefield: ['Test Small Brute'] }, p4: { battlefield: ['Test Big Brute'] } } });
    s = resolveAll(s); // the scenario starts in the precombat main phase of turn 1: the Saga already got its lore counter (3 -> 4) and chapter IV is on the stack
    expect(treasures(s)).toBe(2); // two opponents, not three creatures
    expect(s.zones.battlefield.some((id) => chars(s, id).name === 'Test Summon Samurai')).toBe(false);
  });
  it('chapter II ("can\'t attack you unless their controller pays {2} for each"): an attack on you costs {2} per attacker (rejected without the mana), and attacking your planeswalker is free ("you" only)', () => {
    const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Planeswalker — Test', loyalty: '4', oracle_text: '+1: You gain 1 life.', colors: [] } as OracleCard);
    const build = (): GameState => {
      let s = scenario([], { defs: [...defs, WALKER], p1: { battlefield: [{ name: 'Test Summon Samurai', counters: { lore: 1 } }, { name: 'Test Walker', counters: { loyalty: 4 } }] }, p2: { battlefield: ['Test Bear'] } });
      s = resolveAll(s); // the scenario starts in the precombat main phase: lore 1 -> 2, chapter II resolves
      s = advanceTo(s, 2, 'main1');
      return toDeclareAttackers(s);
    };
    const bear = (s: GameState): ObjectId => find(s, 'Test Bear', 'battlefield', 'p2');
    const s = build();
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear(s), defender: 'p1' }] })).toThrow(/costs \{2\}/); // no mana to pay it: rejected (CR 508.1h)
    const t = build();
    const free = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: bear(t), defender: find(t, 'Test Walker', 'battlefield', 'p1') }] });
    expect(free.pending?.kind).not.toBe('yesNo'); // accepted with no mana: the planeswalker is not "you"
  });
  it('the negative case: no opponent controls a creature with power 4 or greater: no Treasure (X is 0)', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Summon Samurai', counters: { lore: 3 } }, 'Test Big Brute'] }, p2: { battlefield: ['Test Small Brute'] } } });
    s = resolveAll(s);
    expect(treasures(s)).toBe(0);
  });
});
