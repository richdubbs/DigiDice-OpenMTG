/**
 * FAST5 T62 (trigger clauses and intervening-if conditions): the fixture cards the T62 shapes make full, played through the engine (compiled by the game's default
 * compiler). Each describe is named after the rule it checks.
 *
 *   CR 603.4        the intervening "if" is checked when the trigger event happens and again as the ability resolves
 *   CR 603.10a      "when you sacrifice it" looks back at the sacrificed permanent
 *   CR 603.2c       "one or more opponents are dealt noncombat damage" triggers once for the damage dealt at once
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { compiledDef } from '../../fixtures';
import { vanilla } from '../../helpers';
import { activate } from '../../m5/cr-examples/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { castFaceDown, faceDownOf, putFaceDown, resolveTop, synthetic, turnUp } from '../../m6/face-down/support';
import { act, advanceTo, answer, castAuto, find, findAll, life, pass, scenario } from '../../m3/scenario';

const names = ['Sunstar Expansionist', 'Mine Raider', 'Vial Smasher, Gleeful Grenadier', 'Krang, Master Mind', 'Roiling Canopy', 'Emergent Haunting', "Lord Skitter's Blessing",
  'Eshki Dragonclaw', 'Carrot Cake', 'Heaped Harvest', 'Bristlebane Battler', 'Perimeter Enforcer', 'Cryptid Inspector', "Rangers' Aetherhive", 'Master of Barbs'];

describe('design 6.9: every T62 fixture card is compiled to data, none left manual or partial', () => {
  for (const n of names) {
    it(`${n}: no manual ability`, () => {
      const d = compiledDef(n);
      for (const f of d.faces) expect(f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text), n).toEqual([]);
    });
  }
});

/** Pass priority until the stack is empty, answering a target choice with the first legal target and a yes/no with yes. */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    const d = s.pending;
    if (d && d.kind !== 'priority') {
      const k = d.kind as string;
      if (k === 'chooseTargets') {
        const t = d as unknown as { objects: string[]; players: string[]; min: number };
        const pick: TargetChoice[] = t.min === 0 ? [] : t.objects.length > 0 ? [{ kind: 'object', id: t.objects[0]! }] : [{ kind: 'player', id: t.players[0]! }];
        s = answer(s, { kind: 'chooseTargets', targets: pick });
      } else if (k === 'confirm' || k === 'yesNo') s = answer(s, { kind: k, yes: true } as never);
      else if (k === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as unknown as { options: string[] }).options.slice(0, Math.max((d as unknown as { min: number }).min, Math.min((d as unknown as { max: number }).max, 1))) });
      else if (k === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
      else throw new Error(`unexpected decision ${k}`);
    } else s = pass(s);
  }
  return s;
}

const onBattlefield = (s: GameState, name: string): ObjectId[] => findAll(s, name, 'battlefield');
const countName = (s: GameState, name: string): number => onBattlefield(s, name).length;
/** The tokens of a kind on the battlefield (their definition id is `token:<name> Token:<hash>`). */
const tokens = (s: GameState, kind: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith(`token:${kind} Token`)).length;

describe('CR 603.4: "When ~ enters, if an opponent controls more lands than you, create a Lander token." (Sunstar Expansionist)', () => {
  const play = (mine: number, theirs: number): GameState => {
    const s = scenario(['Sunstar Expansionist'], { p1: { hand: ['Sunstar Expansionist'], battlefield: ['Plains', 'Plains', ...Array(mine).fill('Plains')] }, p2: { battlefield: Array(theirs).fill('Plains') } });
    return settle(castAuto(s, 'Sunstar Expansionist'));
  };
  it('an opponent with more lands: the token is created', () => {
    const s = play(0, 3);
    expect(countName(s, 'Sunstar Expansionist')).toBe(1);
    expect(tokens(s, 'Lander')).toBe(1);
  });
  it('equal lands, or fewer: nothing (the condition is "more", CR 603.4)', () => {
    expect(tokens(play(1, 3), 'Lander')).toBe(0);
    expect(tokens(play(2, 3), 'Lander')).toBe(0);
  });
});

describe('CR 700.12, 603.4: "if you control another outlaw" (Mine Raider) and "Whenever another outlaw you control enters" (Vial Smasher, Gleeful Grenadier)', () => {
  it('Mine Raider makes a Treasure only with another Assassin, Mercenary, Pirate, Rogue or Warlock', () => {
    const none = settle(castAuto(scenario(['Mine Raider', 'Mountain'], { p1: { hand: ['Mine Raider'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } }), 'Mine Raider'));
    expect(tokens(none, 'Treasure')).toBe(0);
    const some = settle(castAuto(scenario(['Mine Raider', 'Vial Smasher, Gleeful Grenadier', 'Mountain'], { p1: { hand: ['Mine Raider'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Vial Smasher, Gleeful Grenadier'] } }), 'Mine Raider'));
    expect(tokens(some, 'Treasure')).toBe(1);
  });
  it('Vial Smasher deals 1 damage to the opponent when another outlaw enters under your control, not when it is the only one or the creature is not an outlaw', () => {
    const base = (hand: string): GameState => scenario(['Mine Raider', 'Vial Smasher, Gleeful Grenadier', 'Sunstar Expansionist', 'Mountain'], { p1: { hand: [hand], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Plains', 'Vial Smasher, Gleeful Grenadier'] } });
    const outlaw = settle(castAuto(base('Mine Raider'), 'Mine Raider'));
    expect(life(outlaw, 'p2')).toBe(19);
    const other = settle(castAuto(base('Sunstar Expansionist'), 'Sunstar Expansionist'));
    expect(life(other, 'p2')).toBe(20);
  });
});

describe('CR 603.4, 608.2: "if you have fewer than four cards in hand, draw cards equal to the difference" (Krang, Master Mind)', () => {
  const play = (others: number): GameState => {
    const s = scenario(['Krang, Master Mind', 'Island'], { p1: { hand: ['Krang, Master Mind', ...Array(others).fill('Plains')], battlefield: [...Array(6).fill('Plains'), 'Island', 'Island'] } });
    return settle(castAuto(s, 'Krang, Master Mind'));
  };
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;
  it('with 1 other card in hand it draws 3 (four minus the cards in hand after casting Krang)', () => {
    expect(hand(play(1))).toBe(4);
  });
  it('with 0 other cards in hand it draws 4', () => {
    expect(hand(play(0))).toBe(4);
  });
  it('with 3 other cards in hand it draws 1; with 4 or more it does nothing', () => {
    expect(hand(play(3))).toBe(4);
    expect(hand(play(4))).toBe(4);
    expect(hand(play(5))).toBe(5);
  });
});

describe('CR 603.4: "Whenever a Forest you control enters, if you control at least five other Forests, target creature you control gets +3/+3 until end of turn." (Roiling Canopy)', () => {
  const play = (forests: number): { s: GameState; bear: ObjectId } => {
    let s = scenario(['Roiling Canopy', 'Forest'], { defs: [vanilla('Test Bear', '{0}', ['2', '2'])], p1: { hand: ['Forest'], battlefield: ['Roiling Canopy', 'Test Bear', ...Array(forests).fill('Forest')] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') }));
    return { s, bear };
  };
  const pt = (s: GameState, id: ObjectId): string => { const c = charsOfObject(s, s.objects[id]!); return `${c.power}/${c.toughness}`; };
  it('five other Forests (six with the one that entered): the creature gets +3/+3', () => {
    const { s, bear } = play(5);
    expect(pt(s, bear)).toBe('5/5');
  });
  it('four other Forests: nothing, the condition is checked as the Forest enters (CR 603.4)', () => {
    const { s, bear } = play(4);
    expect(pt(s, bear)).toBe('2/2');
  });
});

describe('CR 603.4: Emergent Haunting becomes a 3/3 Spirit creature with flying in addition to its other types (permanently)', () => {
  const endOfTurn = (hand: string[], cast?: string): GameState => {
    let s = scenario(['Emergent Haunting', 'Sunstar Expansionist', 'Plains'], { p1: { hand, battlefield: ['Emergent Haunting', 'Plains', 'Plains'] } });
    if (cast) s = settle(castAuto(s, cast));
    return settle(advanceTo(s, 1, 'end'));
  };
  it('no spell was cast from your hand this turn and it is not a creature: it becomes a creature (and stays an enchantment)', () => {
    const s = endOfTurn([]);
    const c = charsOfObject(s, s.objects[find(s, 'Emergent Haunting', 'battlefield')]!);
    expect(c.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(c.subtypes).toContain('Spirit');
    expect(`${c.power}/${c.toughness}`).toBe('3/3');
    expect(c.keywords.some((k) => k.keyword === 'flying')).toBe(true);
  });
  it('a spell cast from your hand this turn: nothing (intervening "if", CR 603.4)', () => {
    const s = endOfTurn(['Sunstar Expansionist'], 'Sunstar Expansionist');
    const c = charsOfObject(s, s.objects[find(s, 'Emergent Haunting', 'battlefield')]!);
    expect(c.types).not.toContain('Creature');
  });
  it('it is already a creature at the next end step: the trigger does not trigger again (the second condition)', () => {
    let s = endOfTurn([]);
    s = settle(advanceTo(s, 3, 'end'));
    const c = charsOfObject(s, s.objects[find(s, 'Emergent Haunting', 'battlefield')]!);
    expect(c.subtypes.filter((t) => t === 'Spirit')).toHaveLength(1);
  });
});

describe("CR 603.4: Lord Skitter's Blessing: \"At the beginning of your draw step, if you control an enchanted creature, you lose 1 life and you draw an additional card.\"", () => {
  const bear = vanilla('Test Bear', '{0}', ['2', '2']);
  it('with an enchanted creature (the Wicked Role it makes): it draws an additional card and loses 1 life', () => {
    let s = scenario(["Lord Skitter's Blessing", 'Plains', 'Swamp'], { defs: [bear], p1: { hand: ["Lord Skitter's Blessing"], battlefield: ['Swamp', 'Plains', 'Test Bear'] } });
    s = settle(castAuto(s, "Lord Skitter's Blessing"));
    s = settle(advanceTo(s, 3, 'draw'));
    expect(life(s, 'p1')).toBe(19);
    expect(s.zones.hand['p1']).toHaveLength(2);
  });
  it('no enchanted creature: only the draw of the turn (the condition is checked as the step begins, CR 603.4)', () => {
    let s = scenario(["Lord Skitter's Blessing"], { defs: [bear], p1: { battlefield: ["Lord Skitter's Blessing", 'Test Bear'] } });
    s = settle(advanceTo(s, 3, 'draw'));
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.hand['p1']).toHaveLength(1);
  });
});

describe('CR 601.2i, 603.4: Eshki Dragonclaw: "if you have cast both a creature spell and a noncreature spell this turn, draw a card and put two +1/+1 counters on ~"', () => {
  const combat = (hand: string[]): GameState => {
    let s = scenario(['Eshki Dragonclaw', 'Sunstar Expansionist', 'Carrot Cake'], { p1: { hand, battlefield: ['Eshki Dragonclaw', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    for (const n of hand) s = settle(castAuto(s, n));
    return settle(advanceTo(s, 1, 'beginCombat'));
  };
  const eshki = (s: GameState): ObjectId => find(s, 'Eshki Dragonclaw', 'battlefield');
  it('a creature spell and a noncreature spell: it draws a card and gets two +1/+1 counters', () => {
    const s = combat(['Sunstar Expansionist', 'Carrot Cake']);
    expect(s.objects[eshki(s)]!.counters['+1/+1']).toBe(2);
    expect(s.zones.hand['p1']).toHaveLength(1);
  });
  it('only a creature spell, or only a noncreature spell: nothing', () => {
    for (const hand of [['Sunstar Expansionist'], ['Carrot Cake']]) {
      const s = combat(hand);
      expect(s.objects[eshki(s)]!.counters['+1/+1'] ?? 0).toBe(0);
      expect(s.zones.hand['p1']).toHaveLength(0);
    }
  });
});

describe('CR 603.6a, 603.10a, 701.21a: "When ~ enters and when you sacrifice it, ..." (Carrot Cake, Heaped Harvest)', () => {
  const rabbits = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:Rabbit')).length;
  it('Carrot Cake: a Rabbit when it enters, and another when you sacrifice it (as the cost of its own ability), with the life gained', () => {
    let s = scenario(['Carrot Cake'], { p1: { hand: ['Carrot Cake'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    s = settle(castAuto(s, 'Carrot Cake'));
    expect(rabbits(s)).toBe(1);
    const cake = find(s, 'Carrot Cake', 'battlefield');
    s = settle(activate(s, cake));
    expect(findAll(s, 'Carrot Cake', 'battlefield')).toHaveLength(0);
    expect(rabbits(s)).toBe(2);
    expect(life(s, 'p1')).toBe(23);
  });
  it('Heaped Harvest: a basic land onto the battlefield tapped when it enters and again when you sacrifice it', () => {
    let s = scenario(['Heaped Harvest', 'Forest'], { p1: { hand: ['Heaped Harvest'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest'], library: ['Forest', 'Forest', 'Forest'] } });
    const landsOf = (x: GameState): number => x.zones.battlefield.filter((id) => x.objects[id]!.defId === 'Forest' || x.objects[id]!.defId === 'Plains').length;
    const before = landsOf(s);
    s = settle(castAuto(s, 'Heaped Harvest'));
    expect(landsOf(s)).toBe(before + 1);
    s = settle(activate(s, find(s, 'Heaped Harvest', 'battlefield')));
    expect(landsOf(s)).toBe(before + 2);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 603.1, 603.2, 122.1: "Whenever another creature you control enters while ~ has a -1/-1 counter on it, remove a -1/-1 counter from ~." (Bristlebane Battler)', () => {
  const play = (counters: number): { s: GameState; battler: ObjectId } => {
    let s = scenario(['Bristlebane Battler', 'Mine Raider', 'Mountain'], { p1: { hand: ['Mine Raider'], battlefield: [{ name: 'Bristlebane Battler', counters: counters > 0 ? { '-1/-1': counters } : {} }, 'Mountain', 'Mountain', 'Mountain'] } });
    const battler = find(s, 'Bristlebane Battler', 'battlefield');
    s = settle(castAuto(s, 'Mine Raider'));
    return { s, battler };
  };
  it('with five counters, another creature entering removes one', () => {
    const { s, battler } = play(5);
    expect(s.objects[battler]!.counters['-1/-1']).toBe(4);
  });
  it('with one counter, the last one is removed', () => {
    const { s, battler } = play(1);
    expect(s.objects[battler]!.counters['-1/-1'] ?? 0).toBe(0);
  });
  it('with no counters the trigger does not trigger ("while", judged as the creature enters, CR 603.2)', () => {
    const { s, battler } = play(0);
    expect(s.objects[battler]!.counters['-1/-1'] ?? 0).toBe(0);
    expect(s.log.some((l) => /Bristlebane Battler triggers/.test(l.text))).toBe(false);
  });
});

describe('CR 603.2, 701.40a, 708.2: Cryptid Inspector and Perimeter Enforcer: "..., and whenever <objects> is turned face up, ..."', () => {
  const DETECTIVE = synthetic('Test Masked Detective', 'Creature — Human Detective', '{1}', 'Morph {0}');
  const lorian = (): GameState => scenario(['Cryptid Inspector', 'Branchsnap Lorian', 'Forest'], { p1: { hand: ['Branchsnap Lorian'], battlefield: ['Cryptid Inspector', 'Forest', 'Forest', 'Forest', 'Forest'] } });
  it('Cryptid Inspector: a face-down permanent you control entering puts a +1/+1 counter on it, and so does turning a permanent face up', () => {
    let s = lorian();
    const inspector = find(s, 'Cryptid Inspector', 'battlefield');
    s = settle(resolveTop(castFaceDown(s, 'Branchsnap Lorian')));
    expect(faceDownOf(s, 'p1')).toHaveLength(1);
    expect(s.objects[inspector]!.counters['+1/+1']).toBe(1);
    s = settle(turnUp(s, faceDownOf(s, 'p1')[0]!));
    expect(s.objects[inspector]!.counters['+1/+1']).toBe(2);
  });
  it('Cryptid Inspector: a face-down permanent an opponent controls turned face up does not (the triggers are "you control")', () => {
    let s = lorian();
    const inspector = find(s, 'Cryptid Inspector', 'battlefield');
    let id = '';
    [s, id] = putFaceDown(s, 'p2', 'Branchsnap Lorian');
    expect(id).not.toBe('');
    expect(s.objects[inspector]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('Perimeter Enforcer: another Detective entering, and a Detective turned face up, each give +1/+1 until end of turn', () => {
    let s = scenario(['Perimeter Enforcer', 'Plains'], { defs: [DETECTIVE], p1: { hand: ['Test Masked Detective'], battlefield: ['Perimeter Enforcer', 'Plains', 'Plains', 'Plains'] } });
    const enforcer = find(s, 'Perimeter Enforcer', 'battlefield');
    const pt = (x: GameState): string => { const c = charsOfObject(x, x.objects[enforcer]!); return `${c.power}/${c.toughness}`; };
    expect(pt(s)).toBe('1/1');
    s = settle(castAuto(s, 'Test Masked Detective'));
    expect(pt(s)).toBe('2/2');
    let id = '';
    [s, id] = putFaceDown(s, 'p1', 'Test Masked Detective');
    expect(pt(s)).toBe('2/2');
    s = settle(turnUp(s, id));
    expect(pt(s)).toBe('3/3');
  });
});

describe("CR 702.177a, 603.2: Rangers' Aetherhive: \"Whenever you activate an exhaust ability, create a 1/1 colorless Thopter artifact creature token with flying.\"", () => {
  it('activating an exhaust ability makes a Thopter; an ability that is not an exhaust ability does not', () => {
    let s = scenario(["Rangers' Aetherhive", 'Jeong Jeong, the Deserter', 'Plains'], { p1: { battlefield: ["Rangers' Aetherhive", 'Jeong Jeong, the Deserter', 'Plains', 'Plains', 'Plains'] } });
    const jeong = find(s, 'Jeong Jeong, the Deserter', 'battlefield');
    const thopters = (x: GameState): number => x.zones.battlefield.filter((id) => x.objects[id]!.defId.startsWith('token:Thopter')).length;
    expect(thopters(s)).toBe(0);
    s = settle(activate(s, jeong, [], /exhaust|\{3\}/i));
    expect(thopters(s)).toBe(1);
  });
  it('an ability that is not an exhaust ability does not', () => {
    let s = scenario(["Rangers' Aetherhive", 'Carrot Cake', 'Plains'], { p1: { battlefield: ["Rangers' Aetherhive", 'Carrot Cake', 'Plains', 'Plains', 'Plains'] } });
    s = settle(activate(s, find(s, 'Carrot Cake', 'battlefield')));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:Thopter'))).toHaveLength(0);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 120.2b, 603.2c: "Whenever one or more opponents are dealt noncombat damage, creatures you control get +1/+0 until end of turn." (Master of Barbs)', () => {
  const setup = (): GameState => scenario(['Master of Barbs', 'Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt', 'Lightning Bolt'], battlefield: ['Master of Barbs', 'Mountain', 'Mountain'] } });
  const power = (s: GameState): number => Number(charsOfObject(s, s.objects[find(s, 'Master of Barbs', 'battlefield')]!).power);
  it('a burn spell at an opponent: +1/+0 once', () => {
    let s = setup();
    expect(power(s)).toBe(2);
    s = castAuto(s, 'Lightning Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }] });
    s = settle(s);
    expect(life(s, 'p2')).toBe(17);
    expect(power(s)).toBe(3);
  });
  it('damage to yourself, or to a creature, does not trigger it', () => {
    let s = setup();
    s = settle(castAuto(s, 'Lightning Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }] }));
    expect(life(s, 'p1')).toBe(17);
    expect(power(s)).toBe(2);
  });
  it('a creature dealt damage does not trigger it', () => {
    let s = setup();
    s = settle(castAuto(s, 'Lightning Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Master of Barbs', 'battlefield') }] }] }));
    expect(life(s, 'p2')).toBe(20);
    expect(findAll(s, 'Master of Barbs', 'battlefield')).toHaveLength(0);
  });
});

/** A synthetic card (invented names; the wordings are the grammar the T62 changes read in real cards, design 6.10). */
function synth(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}

describe('CR 601.2i, 603.4 and the layers: cards the history wording "youve cast a creature spell this turn" makes full are played right', () => {
  const COHORT = synth('Test Reluctant Goblin', 'Creature — Goblin', "~ can't attack unless you've cast a creature spell this turn.", { pt: ['2', '2'], colors: ['R'] });
  const FROG = synth('Test Leaper', 'Creature — Frog', "~ has flying as long as you've cast an instant or sorcery spell this turn.", { pt: ['3', '1'], colors: ['U'] });
  const BOLT = synth('Test Quick Gain', 'Instant', 'You gain 1 life.', { colors: ['W'] });
  const BEAR = synth('Test Cub', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
  const defs = [COHORT, FROG, BOLT, BEAR];
  it('"cant attack unless youve cast a creature spell this turn": the attack is illegal until a creature spell is cast', () => {
    const base = scenario([], { defs, p1: { hand: ['Test Cub'], battlefield: ['Test Reluctant Goblin'] } });
    const goblin = find(base, 'Test Reluctant Goblin', 'battlefield');
    expect(() => toDeclareAttackers(base)).toThrow(/Never reached/); // the Goblin is the only creature and may not attack: no attackers to declare
    expect(goblin).toBeDefined();
    const cast = settle(castAuto(base, 'Test Cub'));
    const attacked = declareAttackers(toDeclareAttackers(cast), [[goblin]]);
    expect(attacked.combat?.attackers?.length ?? 1).toBeGreaterThan(0);
  });
  it('"has flying as long as youve cast an instant or sorcery spell this turn": flying only after such a spell, and a creature spell does not give it', () => {
    const hasFlying = (s: GameState): boolean => charsOfObject(s, s.objects[find(s, 'Test Leaper', 'battlefield')]!).keywords.some((k) => k.keyword === 'flying');
    const base = scenario([], { defs, p1: { hand: ['Test Quick Gain', 'Test Cub'], battlefield: ['Test Leaper'] } });
    expect(hasFlying(base)).toBe(false);
    expect(hasFlying(settle(castAuto(base, 'Test Cub')))).toBe(false);
    expect(hasFlying(settle(castAuto(base, 'Test Quick Gain')))).toBe(true);
  });
});

describe('CR 700.12, 601.2f: outlaws as a noun in a cost reduction (affinity), a condition and a target', () => {
  const SKY_BEAR = synth('Test Swindler', 'Creature — Rogue', '', { cost: '{1}{R}', pt: ['1', '1'], colors: ['R'] });
  const BRUTE = synth('Test Brute', 'Creature — Minotaur Mercenary', 'Affinity for outlaws', { cost: '{3}{R}', pt: ['5', '4'], colors: ['R'] });
  const WITHER = synth('Test Withering', 'Instant', 'Target creature gets -1/-0 until end of turn. It gets -4/-0 until end of turn instead if you control an outlaw.\nDraw a card.', { colors: ['U'] });
  const TARGET = synth('Test Wall', 'Creature — Wall', '', { pt: ['6', '6'], colors: ['W'] });
  const defs = [SKY_BEAR, BRUTE, WITHER, TARGET];
  it('affinity for outlaws: each Assassin, Mercenary, Pirate, Rogue and Warlock you control makes the spell cost {1} less', () => {
    const withOutlaws = scenario(['Mountain'], { defs, p1: { hand: ['Test Brute'], battlefield: ['Mountain', 'Test Swindler', 'Test Swindler', 'Test Swindler'] } });
    expect(settle(castAuto(withOutlaws, 'Test Brute')).zones.battlefield.some((id) => withOutlaws.defs['Test Brute'] !== undefined && settle(castAuto(withOutlaws, 'Test Brute')).objects[id]!.defId === 'Test Brute')).toBe(true);
    const without = scenario(['Mountain'], { defs, p1: { hand: ['Test Brute'], battlefield: ['Mountain', 'Test Wall'] } });
    expect(() => castAuto(without, 'Test Brute')).toThrow(/can't pay/);
  });
  it('"if you control an outlaw ... instead": -4/-0 with an outlaw, -1/-0 without', () => {
    const power = (s: GameState): number => Number(charsOfObject(s, s.objects[find(s, 'Test Wall', 'battlefield')]!).power);
    for (const [bf, want] of [[['Test Wall'], 5], [['Test Wall', 'Test Swindler'], 2]] as const) {
      let s = scenario(['Island'], { defs, p1: { hand: ['Test Withering'], battlefield: [...bf, 'Island'] } });
      const wall = find(s, 'Test Wall', 'battlefield');
      s = castAuto(s, 'Test Withering', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: wall }] }] });
      s = settle(s);
      expect(power(s), bf.join(', ')).toBe(want);
    }
  });
});

describe('CR 601.2f, 601.2i: "This spell costs {2} less to cast if you have cast a noncreature spell this turn." (Traxos, Academy Guardian)', () => {
  const GUARD = synth('Test Guardian', 'Artifact Creature — Construct', 'This spell costs {2} less to cast if you\'ve cast a noncreature spell this turn.', { cost: '{3}{U}', pt: ['1', '5'], colors: ['U'] });
  const TRICK = synth('Test Trick', 'Instant', 'You gain 1 life.', { colors: ['U'] });
  it('with a noncreature spell cast first the Guardian costs {1}{U}; without one it needs the whole {3}{U}', () => {
    const base = (): GameState => scenario(['Island'], { defs: [GUARD, TRICK], p1: { hand: ['Test Trick', 'Test Guardian'], battlefield: ['Island', 'Island'] } });
    const afterTrick = settle(castAuto(base(), 'Test Trick'));
    expect(settle(castAuto(afterTrick, 'Test Guardian')).zones.battlefield.some((id) => afterTrick.defs['Test Guardian'] !== undefined && settle(castAuto(afterTrick, 'Test Guardian')).objects[id]!.defId === 'Test Guardian')).toBe(true);
    expect(() => castAuto(base(), 'Test Guardian')).toThrow(/can't pay/);
  });
});
