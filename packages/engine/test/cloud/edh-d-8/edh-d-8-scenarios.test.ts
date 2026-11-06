/**
 * Commander coordinator D, round edh-d-8 (EDHREC ranks 11,251-12,500, second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 303.4a, 301.5, 613.4b     "As long as ~ is enchanted by exactly two Auras, it has base power and toughness 5/5 and vigilance." (Timber Paladin)
 *   CR 303.4, 109.1, 611.3a      "As long as another Aura is attached to enchanted creature, it has first strike and lifelink." (Face of Divinity)
 *   CR 614.1a, 120.3             "If a source would deal damage to ~, it deals double that damage to ~ instead." (Goldnight Castigator)
 *   CR 614.1c, 122.6             "~ enters with a +1/+1 counter on it for each +1/+1 counter among other creatures you control." (Ascendant Acolyte)
 *   CR 603.7, 514.1, 514.3a      "Return ~ to its owner's hand at the beginning of the next cleanup step." (Thawing Glaciers)
 *   CR 608.2d                    "~ deals 3 damage to an opponent chosen at random." (Zaffai, Thunder Conductor)
 *   CR 603.4, 509.1b             "~ can't be blocked if you had another Cleric, Rogue, Warrior, or Wizard enter the battlefield under your control this turn." (Nimble Trapfinder)
 *   CR 205.4a                    "If it's a snow card, you may reveal it and put it into your hand." (Frost Augur)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { ruleDenial } from '../../../src/statics/hooks';
import { act, find, scenario } from '../../m3/scenario';
import { card, cast, counters, full, named, pt, resolveAll } from '../cmd3/helpers';
import { act as mpAct, find as mpFind, lifeOf as mpLife, mpScenario, resolveStack } from '../../m12/rules/helpers';

const colored = (name: string, type: string, text: string, pts: [string, string] | undefined, colors: string[], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pts ? { power: pts[0], toughness: pts[1] } : {}) } as OracleCard);
/** Put the Auras of p1's hand onto the battlefield attached to `host` (an Aura placed unattached is put into the graveyard by state-based actions, CR 704.5m), and attach the Equipment on the battlefield. */
const attachAll = (s0: GameState, host: ObjectId): GameState => {
  const s = structuredClone(s0);
  for (const id of [...s.zones.hand['p1']!]) {
    if (!s.defs[s.objects[id]!.defId]!.faces[0]!.typeLine.includes('Aura')) continue;
    s.zones.hand['p1'] = s.zones.hand['p1']!.filter((x) => x !== id);
    s.zones.battlefield.push(id);
    Object.assign(s.objects[id]!, { zone: 'battlefield', attachedTo: host, since: -1 });
  }
  for (const id of s.zones.battlefield) if (s.defs[s.objects[id]!.defId]!.faces[0]!.typeLine.includes('Equipment')) Object.assign(s.objects[id]!, { attachedTo: host });
  return s;
};
/** The keywords of the list that the object has after layer 6. */
const keywords = (s: GameState, id: ObjectId): string[] => ['vigilance', 'trample', 'first strike', 'lifelink', 'flying'].filter((k) => hasKeyword(getChars(s, id)!, k));

describe('CR 303.4a, 301.5, 613.4b: "As long as ~ is enchanted by exactly one Aura, it has base power and toughness 3/3." ... "three or more Auras" (Timber Paladin)', () => {
  const PALADIN = card('Test Bough Knight', 'Creature — Elf Knight', [
    'As long as ~ is enchanted by exactly one Aura, it has base power and toughness 3/3.',
    'As long as ~ is enchanted by exactly two Auras, it has base power and toughness 5/5 and vigilance.',
    'As long as ~ is enchanted by three or more Auras, it has base power and toughness 10/10, vigilance, and trample.',
  ].join('\n'), ['1', '1']);
  const BOON = card('Test Leaf Boon', 'Enchantment — Aura', 'Enchant creature');
  const RELIC = card('Test Twig Blade', 'Artifact — Equipment', 'Equip {1}');
  const game = (auras: number, relics = 0): GameState => {
    const s = scenario([], { defs: [PALADIN, BOON, RELIC], p1: { hand: Array(auras).fill('Test Leaf Boon') as string[], battlefield: ['Test Bough Knight', ...Array(relics).fill('Test Twig Blade') as string[]] }, p2: {} });
    return attachAll(s, named(s, 'Test Bough Knight')[0]!);
  };
  it('are full', () => expect(full(PALADIN)).toBe(true));
  it('no Aura: the printed 1/1; one Aura 3/3; two Auras 5/5 with vigilance; three Auras 10/10 with vigilance and trample', () => {
    const run = (n: number): [string, string[]] => { const s = game(n); const id = named(s, 'Test Bough Knight')[0]!; return [pt(s, id), keywords(s, id)]; };
    expect(run(0)).toEqual(['1/1', []]);
    expect(run(1)[0]).toBe('3/3');
    expect(run(2)).toEqual(['5/5', ['vigilance']]);
    const three = run(3);
    expect(three[0]).toBe('10/10');
    expect(three[1].sort()).toEqual(['trample', 'vigilance']);
    expect(run(4)[0]).toBe('10/10');
  });
  it('negative: an Equipment attached is no Aura (CR 303.4a): a creature with one Aura and two Equipment is still 3/3', () => {
    const s = game(1, 2);
    expect(pt(s, named(s, 'Test Bough Knight')[0]!)).toBe('3/3');
  });
});

describe('CR 303.4, 109.1, 611.3a: "As long as another Aura is attached to enchanted creature, it has first strike and lifelink." (Face of Divinity)', () => {
  const FACE = card('Test Halo Veil', 'Enchantment — Aura', 'Enchant creature\nAs long as another Aura is attached to enchanted creature, it has first strike and lifelink.');
  const BOON = card('Test Leaf Boon', 'Enchantment — Aura', 'Enchant creature');
  const RELIC = card('Test Twig Blade', 'Artifact — Equipment', 'Equip {1}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const game = (others: string[]): GameState => {
    const s = scenario([], { defs: [FACE, BOON, RELIC, BEAR], p1: { hand: ['Test Halo Veil', ...others.filter((n) => n === 'Test Leaf Boon')], battlefield: ['Test Plain Bear', ...others.filter((n) => n === 'Test Twig Blade')] }, p2: {} });
    return attachAll(s, named(s, 'Test Plain Bear')[0]!);
  };
  it('is full', () => expect(full(FACE)).toBe(true));
  it('with another Aura attached the creature has first strike and lifelink; the Aura of another player counts', () => {
    const s = game(['Test Leaf Boon']);
    expect(keywords(s, named(s, 'Test Plain Bear')[0]!).sort()).toEqual(['first strike', 'lifelink']);
  });
  it('negative: alone, or with only an Equipment, the Aura gives nothing (it is not "another" Aura than itself)', () => {
    for (const others of [[], ['Test Twig Blade']]) {
      const s = game(others);
      expect(keywords(s, named(s, 'Test Plain Bear')[0]!)).toEqual([]);
    }
  });
});

describe('CR 614.1a, 120.3: "If a source would deal damage to ~, it deals double that damage to ~ instead." (Goldnight Castigator)', () => {
  const CASTIGATOR = card('Test Dawn Guard', 'Creature — Angel', "Flying\nIf a source would deal damage to ~, it deals double that damage to ~ instead.", ['3', '9']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '9']);
  const BOLT = card('Test Spark', 'Instant', '~ deals 2 damage to target creature.');
  const damageOn = (s: GameState, name: string): number => { const id = named(s, name)[0]; return id === undefined ? -1 : s.objects[id]!.damage ?? 0; };
  const burn = (target: string): GameState => {
    const s0 = scenario([], { defs: [CASTIGATOR, BEAR, BOLT], p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Dawn Guard', 'Test Plain Bear'] } });
    return resolveAll(cast(s0, 'Test Spark', { targets: [{ kind: 'object', id: named(s0, target)[0]! }] }));
  };
  it('is full', () => expect(full(CASTIGATOR)).toBe(true));
  it('2 damage dealt to it is marked as 4', () => expect(damageOn(burn('Test Dawn Guard'), 'Test Dawn Guard')).toBe(4));
  it('negative: another creature takes the damage as dealt', () => expect(damageOn(burn('Test Plain Bear'), 'Test Plain Bear')).toBe(2));
});

describe('CR 614.1c, 122.6: "~ enters with a +1/+1 counter on it for each +1/+1 counter among other creatures you control." (Ascendant Acolyte)', () => {
  const ACOLYTE = card('Test Cub Mystic', 'Creature — Human Monk', '~ enters with a +1/+1 counter on it for each +1/+1 counter among other creatures you control.', ['0', '0']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const run = (mine: Record<string, number>[], theirs: Record<string, number> | null = null): number => {
    const s0 = scenario([], { defs: [ACOLYTE, BEAR], p1: { hand: ['Test Cub Mystic'], battlefield: mine.map((c) => ({ name: 'Test Plain Bear', counters: c })) }, p2: { battlefield: theirs ? [{ name: 'Test Plain Bear', counters: theirs }] : [] } });
    const s = resolveAll(cast(s0, 'Test Cub Mystic'));
    return counters(s, named(s, 'Test Cub Mystic')[0]!, '+1/+1');
  };
  it('is full', () => expect(full(ACOLYTE)).toBe(true));
  it('counts every +1/+1 counter on the other creatures you control (2 and 1: three)', () => expect(run([{ '+1/+1': 2 }, { '+1/+1': 1 }])).toBe(3));
  it('negative: no counters, an opponent\'s counters and counters of another kind give none', () => {
    expect(run([{}])).toBe(0);
    expect(run([{ 'charge': 4 }], { '+1/+1': 5 })).toBe(0);
  });
});

describe('CR 603.7, 514.1, 514.3a: "Return ~ to its owner\'s hand at the beginning of the next cleanup step." (Thawing Glaciers)', () => {
  const GLACIER = colored('Test Frost Field', 'Land', '{T}: You gain 1 life. Return ~ to its owner\'s hand at the beginning of the next cleanup step.', undefined, []);
  it('is full', () => expect(full(GLACIER)).toBe(true));
  it('stays on the battlefield through the turn and goes back to its owner\'s hand in the cleanup step', () => {
    let s = scenario([], { defs: [GLACIER], p1: { battlefield: ['Test Frost Field'] }, p2: {} });
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Frost Field', 'battlefield'), ability: 'p:0:0' }));
    expect(named(s, 'Test Frost Field').length).toBe(1);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Frost Field')).toBe(false);
    for (let i = 0; i < 80 && named(s, 'Test Frost Field').length > 0; i++) {
      if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else if (s.pending?.kind === 'declareAttackers') s = act(s, { type: 'answer', player: s.pending.player, answer: { kind: 'declareAttackers', attacks: [] } } as never);
      else break;
    }
    expect(named(s, 'Test Frost Field').length).toBe(0);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Frost Field')).toBe(true);
  });
});

describe('CR 608.2d: "~ deals 3 damage to an opponent chosen at random." (Zaffai, Thunder Conductor)', () => {
  const ZAP = card('Test Storm Singer', 'Creature — Elf', 'Whenever you cast a spell, ~ deals 3 damage to an opponent chosen at random.', ['1', '1']);
  const FREE = card('Test Free Plan', 'Sorcery', '');
  it('is full', () => expect(full(ZAP)).toBe(true));
  it('exactly one of the three opponents loses 3 life, and you lose none (Commander has several opponents)', () => {
    const lost = (s: ReturnType<typeof mpScenario>): number[] => ['p2', 'p3', 'p4'].map((p) => 20 - mpLife(s, p as 'p2'));
    const hits = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s0 = mpScenario({ players: 4, seed: `edh-d-8-${seed}`, defs: [ZAP, FREE], zones: { p1: { hand: ['Test Free Plan'], battlefield: ['Test Storm Singer'] } } });
      const s = resolveStack(mpAct(s0, { type: 'cast', player: 'p1', card: mpFind(s0, 'Test Free Plan', 'hand', 'p1') } as never));
      const l = lost(s);
      expect(l.filter((x) => x === 3).length).toBe(1);
      expect(l.filter((x) => x === 0).length).toBe(2);
      expect(mpLife(s, 'p1')).toBe(20);
      hits.add(l.join());
    }
    expect(hits.size).toBeGreaterThan(1); // the pick is random: more than one opponent is hit over the seeds
  });
});

describe('CR 603.4, 509.1b: "~ can\'t be blocked if you had another Cleric, Rogue, Warrior, or Wizard enter the battlefield under your control this turn." (Nimble Trapfinder)', () => {
  const TRAP = card('Test Wily Scout', 'Creature — Human Rogue', "~ can't be blocked if you had another Cleric, Rogue, Warrior, or Wizard enter the battlefield under your control this turn.", ['2', '2']);
  const ROGUE = card('Test Quiet Rogue', 'Creature — Human Rogue', '', ['1', '1']);
  const OGRE = card('Test Dull Ogre', 'Creature — Ogre', '', ['1', '1']);
  const WALL = card('Test Gate Wall', 'Creature — Wall', '', ['0', '4']);
  const blocked = (s: GameState, a: ObjectId): boolean => ruleDenial(s, { action: 'beBlocked', subject: a, other: find(s, 'Test Gate Wall', 'battlefield') }) === null;
  const game = (): GameState => scenario([], { defs: [TRAP, ROGUE, OGRE, WALL], p1: { hand: ['Test Quiet Rogue', 'Test Dull Ogre'], battlefield: ['Test Wily Scout'] }, p2: { battlefield: ['Test Gate Wall'] } });
  it('is full', () => expect(full(TRAP)).toBe(true));
  it('can be blocked until another Rogue enters under your control this turn; then it can\'t', () => {
    const s0 = game();
    const scout = named(s0, 'Test Wily Scout')[0]!;
    expect(blocked(s0, scout)).toBe(true);
    const s1 = resolveAll(cast(s0, 'Test Quiet Rogue'));
    expect(blocked(s1, scout)).toBe(false);
  });
  it('negative: a creature of none of the four types entering does not make it unblockable', () => {
    const s0 = game();
    const s1 = resolveAll(cast(s0, 'Test Dull Ogre'));
    expect(blocked(s1, named(s1, 'Test Wily Scout')[0]!)).toBe(true);
  });
});

describe('CR 205.4a: "Look at the top card of your library. If it\'s a snow card, you may reveal it and put it into your hand." (Frost Augur)', () => {
  const AUGUR = card('Test Ice Seer', 'Creature — Human Wizard', '{T}: Look at the top card of your library. If it\'s a snow card, you may reveal it and put it into your hand.', ['1', '1']);
  const SNOW = card('Test Snow Plain', 'Basic Snow Land — Plains', '');
  const PLAIN = card('Test Plain Plain', 'Basic Land — Plains', '');
  const run = (top: string): GameState => {
    const s0 = scenario([], { defs: [AUGUR, SNOW, PLAIN], p1: { battlefield: ['Test Ice Seer'], library: [top, 'Test Plain Plain'] }, p2: {} });
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Ice Seer', 'battlefield'), ability: 'p:0:0' }), { yes: true });
  };
  it('is full', () => expect(full(AUGUR)).toBe(true));
  it('a snow card on top goes to your hand; a nonsnow card stays on top of the library', () => {
    const a = run('Test Snow Plain');
    expect(a.zones.hand['p1']!.some((id) => a.objects[id]!.defId === 'Test Snow Plain')).toBe(true);
    const b = run('Test Plain Plain');
    expect(b.zones.hand['p1']!.some((id) => b.objects[id]!.defId === 'Test Plain Plain')).toBe(false);
    expect(b.objects[b.zones.library['p1']![0]!]!.defId).toBe('Test Plain Plain');
  });
});
