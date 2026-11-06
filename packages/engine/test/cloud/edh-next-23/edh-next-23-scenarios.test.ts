/**
 * Commander lane edh-next, round edh-next-23 (EDHREC ranks 7,251 to 8,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler, in 4-player games (Alice, p1, is the active player of turn 1). Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25
 * (media.wizards.com), read in the session.
 *
 *   CR 120.3, 109.2, 608.2c      "When ~ enters, it deals X damage to each player and each other creature."
 *   CR 205.3m, 613.4c, 109.2     "Saproling creatures and other Treefolk creatures get +1/+1."
 *   CR 611.2a, 611.2c            "Creatures you control gain indestructible." (no duration: the creatures that are there, for good)
 *   CR 208.1, 613.4a-b           "Whenever another creature you control with base power 1 enters, it gains haste until end of turn."
 *   CR 608.2d, 701.21a           "Whenever ~ attacks, defending player sacrifices a creature with the least power among creatures they control."
 *   CR 122.1, 509.1b             "~ can't be blocked as long as defending player has a rad counter."
 *   CR 303.4, 120.1              "Whenever a creature deals damage to enchanted planeswalker, destroy that creature."
 *   CR 508.1b, 303.4             "Creatures attacking enchanted player have trample."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; options?: string[] }
/** Answer what comes up: targets, object choices, option labels, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseOption' && o.options && o.options.length > 0) {
      const label = o.options.shift()!;
      const opt = p.options.find((x) => x.label === label);
      if (!opt) throw new Error(`no option ${label} among ${p.options.map((x) => x.label).join(', ')}`);
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])], options: [...(o.options ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), q), q);
}
/** Pass (declaring nothing when asked) until the first main phase of turn `n`. */
function toMain(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    else s = settle(s, {});
  }
  return s;
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
/** The zones the objects with this name are in now (a card that changes zones is a new object, CR 400.7). */
const zonesOf = (s: GameState, name: string, owner?: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name && (owner === undefined || o.owner === owner)).map((o) => o.zone);
const countersOf = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;


const SPORE = card('Test Spore', 'Creature — Fungus', 'When this creature enters, it deals 3 damage to each player and each other creature.', ['5', '5']);
const ELDER = card('Test Elder', 'Creature — Treefolk', 'Saproling creatures and other Treefolk creatures get +1/+1.', ['3', '3']);
const TREE = card('Test Sapling', 'Creature — Treefolk', '', ['1', '1']);
const SAPRO = card('Test Fungling', 'Creature — Saproling', '', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
const GLORY = card('Test Glory', 'Sorcery', 'Creatures you control gain indestructible.');
const AUGMENT = card('Test Augmenter', 'Creature — Otter', 'Whenever another creature you control with base power 1 enters, it gains haste until end of turn.', ['2', '2']);
const SCOUT = card('Test Scout', 'Creature — Elf', '', ['1', '1']);
const ANTHEM = card('Test Banner', 'Enchantment', 'Creatures you control get +1/+1.');
const KING = card('Test Wraith King', 'Creature — Wraith', 'Whenever this creature attacks, defending player sacrifices a creature with the least power among creatures they control.', ['3', '3']);
const AMBUSH = card('Test Ambusher', 'Creature — Mutant', "This creature can't be blocked as long as defending player has a rad counter.", ['2', '2']);
const TALENT = card('Test Talent', 'Enchantment — Aura', 'Enchant planeswalker\nWhenever a creature deals damage to enchanted planeswalker, destroy that creature.');
const WALKER = card('Test Walker', 'Planeswalker — Test', '', undefined, '{0}', '5');
const POKER = card('Test Poker', 'Creature — Imp', '{0}: This creature deals 1 damage to target planeswalker.', ['1', '1']);
const SMITH = card('Test Smith', 'Creature — Dwarf', 'Creatures you control with a legendary Equipment attached to them get +1/+1.', ['1', '1']);
const LEGEND_SWORD = card('Test Legend Sword', 'Legendary Artifact — Equipment', 'Equip {0}');
const PLAIN_SWORD = card('Test Plain Sword', 'Artifact — Equipment', 'Equip {0}');
const CURSE = card('Test Curse', 'Enchantment — Aura Curse', 'Enchant player\nCreatures attacking enchanted player have trample.');

const ALL = [SPORE, ELDER, TREE, SAPRO, ELF, BEAR, OGRE, GLORY, AUGMENT, SCOUT, ANTHEM, KING, AMBUSH, TALENT, WALKER, POKER, SMITH, LEGEND_SWORD, PLAIN_SWORD, CURSE];
describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of ALL) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 120.3, 109.2, 608.2c: "it deals X damage to each player and each other creature"', () => {
  const game = (): GameState => mpScenario({ defs: [SPORE, BEAR, OGRE], zones: { p1: { hand: ['Test Spore'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] } } });
  it('every player loses 3 and every creature but the source is dealt 3 (the small one dies, the big one survives marked)', () => {
    const s0 = game();
    const before = s0.players.map((p) => p.life);
    const s = cast(s0, 'Test Spore');
    expect(s.players.map((p) => p.life)).toEqual(before.map((l) => l - 3));
    expect(zonesOf(s, 'Test Bear')).toEqual(['graveyard']);
    expect(s.objects[byName(s, 'Test Ogre')]!.damage).toBe(3);
  });
  it('negative: the source itself is not dealt damage', () => {
    const s = cast(game(), 'Test Spore');
    expect(s.objects[byName(s, 'Test Spore')]!.damage).toBe(0);
  });
});

describe('CR 205.3m, 613.4c, 109.2: "Saproling creatures and other Treefolk creatures get +1/+1."', () => {
  const game = (): GameState => mpScenario({ defs: [ELDER, TREE, SAPRO, ELF], zones: { p1: { battlefield: ['Test Elder', 'Test Sapling', 'Test Fungling', 'Test Elf'] }, p2: { battlefield: ['Test Sapling', 'Test Fungling'] } } });
  it('Saprolings and the other Treefolk get it, on every side of the table', () => {
    const s = game();
    expect(stat(s, byName(s, 'Test Sapling', 'battlefield', 'p1'))).toBe('2/2');
    expect(stat(s, byName(s, 'Test Fungling', 'battlefield', 'p1'))).toBe('2/2');
    expect(stat(s, byName(s, 'Test Sapling', 'battlefield', 'p2'))).toBe('2/2');
    expect(stat(s, byName(s, 'Test Fungling', 'battlefield', 'p2'))).toBe('2/2');
  });
  it('negative: the source (a Treefolk) is "other" and does not get it, and an Elf does not', () => {
    const s = game();
    expect(stat(s, byName(s, 'Test Elder'))).toBe('3/3');
    expect(stat(s, byName(s, 'Test Elf'))).toBe('1/1');
  });
});

describe('CR 611.2a, 611.2c: "Creatures you control gain indestructible." with no duration', () => {
  const game = (): GameState => mpScenario({ defs: [GLORY, BEAR, ELF], zones: { p1: { hand: ['Test Glory', 'Test Elf'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('the creatures you control now gain indestructible, after the end of the turn too', () => {
    let s = cast(game(), 'Test Glory');
    expect(kw(s, byName(s, 'Test Bear', 'battlefield', 'p1'))).toContain('indestructible');
    s = toMain(s, 5);
    expect(kw(s, byName(s, 'Test Bear', 'battlefield', 'p1'))).toContain('indestructible');
  });
  it('negative: an opponent\'s creature, and a creature that enters afterwards, do not get it (611.2c)', () => {
    const s0 = game();
    const s1 = cast(s0, 'Test Glory');
    expect(kw(s1, byName(s1, 'Test Bear', 'battlefield', 'p2'))).not.toContain('indestructible');
    const s2 = cast(s1, 'Test Elf');
    expect(kw(s2, byName(s2, 'Test Elf'))).not.toContain('indestructible');
  });
});

describe('CR 208.1, 613.4a-b: "another creature you control with base power 1" (base power, not power)', () => {
  const game = (): GameState => mpScenario({ defs: [AUGMENT, SCOUT, BEAR, ANTHEM], zones: { p1: { hand: ['Test Scout', 'Test Bear'], battlefield: ['Test Augmenter'] } } });
  it('a 1/1 enters and gains haste until end of turn', () => {
    const s = cast(game(), 'Test Scout');
    expect(kw(s, byName(s, 'Test Scout'))).toContain('haste');
  });
  it('negative: a creature with base power 2 does not; a base 1 creature made bigger by an anthem still does; the source is not "another"', () => {
    const s0 = game();
    const s = cast(s0, 'Test Bear');
    expect(kw(s, byName(s, 'Test Bear'))).not.toContain('haste');
    const withBanner = mpScenario({ defs: [AUGMENT, SCOUT, ANTHEM], zones: { p1: { hand: ['Test Scout'], battlefield: ['Test Augmenter', 'Test Banner'] } } });
    const s2 = cast(withBanner, 'Test Scout');
    expect(stat(s2, byName(s2, 'Test Scout'))).toBe('2/2');
    expect(kw(s2, byName(s2, 'Test Scout'))).toContain('haste');
    expect(kw(s2, byName(s2, 'Test Augmenter'))).not.toContain('haste');
  });
});

/** p1 attacks p2 with `attacker` and passes until blockers are asked or the combat has no more to ask. */
function attack(s0: GameState, attacker: ObjectId): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' as never }] });
  return drain(settle(s, {}), {});
}
describe('CR 608.2d, 701.21a: "defending player sacrifices a creature with the least power among creatures they control"', () => {
  const game = (): GameState => mpScenario({ defs: [KING, BEAR, ELF, OGRE], zones: { p1: { battlefield: ['Test Wraith King'] }, p2: { battlefield: ['Test Ogre', 'Test Bear', 'Test Elf'] } } });
  it('the defending player sacrifices the creature with the least power (the 1/1), not the bigger ones', () => {
    const s0 = game();
    const s = attack(s0, byName(s0, 'Test Wraith King'));
    expect(zonesOf(s, 'Test Elf')).toEqual(['graveyard']);
    expect(zonesOf(s, 'Test Bear')).toEqual(['battlefield']);
    expect(zonesOf(s, 'Test Ogre')).toEqual(['battlefield']);
  });
  it('negative: with a tie the defender chooses among the tied creatures only (not the bigger one); another player\'s creatures are not touched', () => {
    const s0 = mpScenario({ defs: [KING, BEAR, ELF, OGRE], zones: { p1: { battlefield: ['Test Wraith King', 'Test Elf'] }, p2: { battlefield: ['Test Ogre', 'Test Elf', 'Test Elf'] }, p3: { battlefield: ['Test Elf'] } } });
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: byName(s0, 'Test Wraith King'), defender: 'p2' as never }] });
    for (let guard = 0; guard < 10 && s.pending?.kind === 'priority'; guard++) s = pass(s);
    const d = s.pending;
    expect(d?.kind).toBe('chooseObjects');
    const options = (d as { options: ObjectId[] }).options;
    const p2Elves = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Elf' && o.owner === 'p2').map((o) => o.id);
    expect([...options].sort()).toEqual([...p2Elves].sort());
    s = answer(s, { kind: 'chooseObjects', ids: [options[0]!] });
    s = drain(s, {});
    expect(zonesOf(s, 'Test Elf', 'p2').filter((z) => z === 'graveyard').length).toBe(1);
    expect(zonesOf(s, 'Test Elf', 'p1')).toEqual(['battlefield']);
    expect(zonesOf(s, 'Test Elf', 'p3')).toEqual(['battlefield']);
    expect(zonesOf(s, 'Test Ogre')).toEqual(['battlefield']);
  });
});

describe('CR 122.1, 509.1b: "can\'t be blocked as long as defending player has a rad counter"', () => {
  const blocked = (rad: number): boolean => {
    const s0 = mpScenario({ defs: [AMBUSH, BEAR], zones: { p1: { battlefield: ['Test Ambusher'] }, p2: { battlefield: ['Test Bear'] } }, setup: (s) => { if (rad > 0) s.players.find((p) => p.id === 'p2')!.counters = { rad } as never; } });
    let s = s0;
    const attacker = byName(s0, 'Test Ambusher');
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' as never }] });
    for (let guard = 0; guard < 40 && s.pending?.kind === 'priority' && s.turn.step !== 'end'; guard++) s = act(s, { type: 'pass', player: s.pending.player });
    const d = s.pending;
    if (!d || d.kind !== 'declareBlockers') return false;
    return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Bear', 'battlefield', d.player), attacker }] } }).error === undefined;
  };
  it('with a rad counter on the defending player it can not be blocked', () => expect(blocked(1)).toBe(false));
  it('negative: with none it can be blocked', () => expect(blocked(0)).toBe(true));
});

describe('CR 303.4, 120.1: "Whenever a creature deals damage to enchanted planeswalker, destroy that creature."', () => {
  const game = (): GameState => mpScenario({
    defs: [TALENT, WALKER, POKER],
    zones: { p1: { battlefield: ['Test Poker'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 5 } }, { name: 'Test Walker', counters: { loyalty: 5 } }, 'Test Talent'] } },
    setup: (s) => {
      const walkers = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Walker');
      Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Talent')!.attachedTo = walkers[0]!.id;
    },
  });
  const walkers = (s: GameState): ObjectId[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Walker').map((o) => o.id);
  it('a creature that damages the enchanted planeswalker is destroyed', () => {
    const s0 = game();
    const enchanted = walkers(s0).find((id) => Object.values(s0.objects).some((o) => o.attachedTo === id))!;
    const s = activate(s0, byName(s0, 'Test Poker'), { targets: [[obj(enchanted)]] });
    expect(zonesOf(s, 'Test Poker')).toEqual(['graveyard']);
  });
  it('negative: damage to a planeswalker that is not enchanted does nothing to the creature', () => {
    const s0 = game();
    const plain = walkers(s0).find((id) => !Object.values(s0.objects).some((o) => o.attachedTo === id))!;
    const s = activate(s0, byName(s0, 'Test Poker'), { targets: [[obj(plain)]] });
    expect(zonesOf(s, 'Test Poker')).toEqual(['battlefield']);
    expect(s.objects[plain]!.counters['loyalty']).toBe(4);
  });
});

describe('CR 508.1b, 303.4, 506.3: "Creatures attacking enchanted player have trample."', () => {
  const trampleWhenAttacking = (defender: string): boolean => {
    const s0 = mpScenario({ defs: [CURSE, BEAR], zones: { p1: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Curse'] } }, setup: (s) => { Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Curse')!.attachedTo = 'p2' as never; } });
    let s = s0;
    const attacker = byName(s0, 'Test Bear');
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: defender as never }] });
    return kw(s, attacker).includes('trample');
  };
  it('a creature attacking the enchanted player has trample', () => expect(trampleWhenAttacking('p2')).toBe(true));
  it('negative: a creature attacking another player does not', () => expect(trampleWhenAttacking('p4')).toBe(false));
});

describe('CR 205.4a, 301.5: "with a legendary Equipment attached to them" needs a legendary attachment', () => {
  const game = (): GameState => mpScenario({
    defs: [SMITH, BEAR, LEGEND_SWORD, PLAIN_SWORD],
    zones: { p1: { battlefield: ['Test Smith', 'Test Bear', 'Test Bear', 'Test Legend Sword', 'Test Plain Sword'] } },
    setup: (s) => {
      const bears = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Bear');
      Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Legend Sword')!.attachedTo = bears[0]!.id;
      Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Plain Sword')!.attachedTo = bears[1]!.id;
    },
  });
  it('the creature wearing the legendary Equipment gets +1/+1', () => {
    const s = game();
    const legendBearer = Object.values(s.objects).find((o) => s.defs[s.objects[o.id]!.defId]?.name === 'Test Legend Sword')!.attachedTo as ObjectId;
    expect(stat(s, legendBearer)).toBe('3/3');
  });
  it('negative: the one wearing a non-legendary Equipment, and the unequipped Smith, do not', () => {
    const s = game();
    const plainBearer = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Plain Sword')!.attachedTo as ObjectId;
    expect(stat(s, plainBearer)).toBe('2/2');
    expect(stat(s, byName(s, 'Test Smith'))).toBe('1/1');
  });
});
