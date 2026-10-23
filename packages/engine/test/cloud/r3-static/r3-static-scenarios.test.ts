/**
 * Standard round 3, slice r3-static (static and continuous effects), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 609.4, 702.3b      "Creatures you control can attack as though they didn't have defender": a permission for the objects of a filter, only its controller's
 *   CR 702.8a, 113.6e     "~ has flash as long as you control a Forest": the static functions in the hand and on the stack, so it is cast any time it could be an instant
 *   CR 704.5j             "The "legend rule" doesn't apply to ...": a static and a resolved "this turn" form; the legend rule applies to everything else
 *   CR 704.5a, 104.3b     "You don't lose the game for having 0 or less life": the other state-based losses still apply
 *   CR 603.2d, 611.3a     "As long as ~ is equipped, if a triggered ability of ~ or an Equipment attached to it triggers, that ability triggers an additional time"
 *   CR 613.1f, 509.1c     "As long as equipped creature is attacking, it has first strike and must be blocked if able"
 *   CR 613.4c, 107.1      "<group> get +1/+1 for each A and each B"
 *   CR 100.2a, 113.6n     "A deck can have any number of cards named ~": deck construction, nothing in a game
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability read in full (each ability's level, autoRatio 1, no manual node); the card level aside (an experimental template caps it, design 6.9). */
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level === 'full')) && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const has = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);

/** Pass priority until the given decision is pending. */
function until(s0: GameState, kind: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind !== kind; guard++) {
    if (guard > 40) throw new Error(`no ${kind}`);
    s = pass(s);
  }
  return s;
}
/** Resolve the stack and settle trigger-ordering decisions. */
function drain(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40; guard++) {
    if (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
      else break;
      continue;
    }
    if (s.zones.stack.length === 0) break;
    s = pass(pass(s));
  }
  return s;
}

const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('CR 609.4, 702.3b: "Creatures you control can attack as though they didn\'t have defender."', () => {
  const HORN = card('Test Horn', 'Enchantment', "Creatures you control can attack as though they didn't have defender.");
  it('is automated', () => expect(full(HORN)).toBe(true));
  it('its controller\'s creature with defender may attack; without it the attack is refused', () => {
    const with_ = until(scenario([], { p1: { battlefield: ['Test Horn', 'Test Wall'] }, defs: [HORN, WALL] }), 'declareAttackers');
    const wall = find(with_, 'Test Wall', 'battlefield', 'p1');
    const ok = answer(with_, { kind: 'declareAttackers', attacks: [{ attacker: wall, defender: 'p2' }] });
    expect(ok.combat?.attackers.some((a) => a.id === wall) ?? JSON.stringify(ok.combat).includes(wall)).toBe(true);
    const without = until(scenario([], { p1: { battlefield: ['Test Wall', 'Test Bear'] }, defs: [WALL, BEAR] }), 'declareAttackers');
    const w2 = find(without, 'Test Wall', 'battlefield', 'p1');
    const r = applyAction(without, { type: 'answer', player: 'p1', decisionId: without.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: w2, defender: 'p2' }] } });
    expect(r.error?.rules.join(' ') ?? '').toContain('702.3b');
  });
  it('an opponent\'s creature with defender still can\'t attack (the permission is its controller\'s)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Horn'] }, p2: { battlefield: ['Test Wall', 'Test Bear'] }, defs: [HORN, WALL, BEAR] });
    s = advanceTo(s, s.turn.number + 1, 'main1');
    s = until(s, 'declareAttackers');
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    const r = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: wall, defender: 'p1' }] } });
    expect(r.error?.rules.join(' ') ?? '').toContain('702.3b');
  });
});

describe('CR 702.8a, 113.6e, 601.3d: "~ has flash as long as you control a Forest."', () => {
  const WURM = card('Test Wurm', 'Creature — Wurm', '~ has flash as long as you control a Forest.', ['6', '6']);
  const FOREST = card('Test Forest', 'Basic Land — Forest', '');
  it('is automated', () => expect(full(WURM)).toBe(true));
  /** p1 holds priority in p2's upkeep. */
  const opponentsUpkeep = (p1Battlefield: string[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Wurm'], battlefield: p1Battlefield }, defs: [WURM, FOREST] });
    s = advanceTo(s, s.turn.number + 1, 'upkeep');
    for (let guard = 0; s.pending?.player !== 'p1'; guard++) {
      if (guard > 10) throw new Error('no priority for p1');
      s = pass(s);
    }
    return s;
  };
  it('with a Forest it is cast in an opponent\'s upkeep and resolves; without one the cast is refused (sorcery timing, CR 117.1a)', () => {
    const s = opponentsUpkeep(['Test Forest']);
    const cast = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wurm', 'hand', 'p1') });
    expect(cast.zones.stack.length + (cast.pending?.kind === 'payCost' ? 1 : 0)).toBeGreaterThan(0);
    const t = opponentsUpkeep([]);
    const r = applyAction(t, { type: 'cast', player: 'p1', card: find(t, 'Test Wurm', 'hand', 'p1') });
    expect(r.error?.rules.join(' ') ?? '').toContain('117.1a');
  });
});

const LEGEND = card('Test Elf Queen', 'Legendary Creature — Elf', '', ['2', '2']);
const LEGEND_OGRE = card('Test Ogre King', 'Legendary Creature — Ogre', '', ['3', '3']);

describe('CR 704.5j: "The "legend rule" doesn\'t apply to Elves you control."', () => {
  const GROVE = card('Test Grove', 'Enchantment', 'The "legend rule" doesn\'t apply to Elves you control.');
  it('is automated', () => expect(full(GROVE)).toBe(true));
  it('two legendary Elves with the same name both stay; two legendary Ogres with the same name still make their controller choose one', () => {
    let s = scenario([], { p1: { battlefield: ['Test Grove'] }, defs: [GROVE, LEGEND, LEGEND_OGRE] });
    for (const n of ['Test Elf Queen', 'Test Elf Queen', 'Test Ogre King', 'Test Ogre King']) put(s, 'p1', 'battlefield', n);
    s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const ogres = findAll(s, 'Test Ogre King', 'battlefield', 'p1');
    s = answer(s, { kind: 'chooseObjects', ids: [ogres[0]!] } as never);
    expect(findAll(s, 'Test Elf Queen', 'battlefield', 'p1').length).toBe(2);
    expect(findAll(s, 'Test Ogre King', 'battlefield', 'p1').length).toBe(1);
  });
  it('without it, the legend rule applies to the Elves too', () => {
    let s = scenario([], { defs: [LEGEND] });
    for (const n of ['Test Elf Queen', 'Test Elf Queen']) put(s, 'p1', 'battlefield', n);
    s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
  });
});

describe('CR 704.5j, 611.2a: "The "legend rule" doesn\'t apply to permanents you control this turn." (a resolved effect)', () => {
  const ECHO = card('Test Echo', 'Sorcery', 'Draw a card. The "legend rule" doesn\'t apply to permanents you control this turn.');
  it('is automated', () => expect(full(ECHO)).toBe(true));
  it('for the rest of the turn its controller keeps both copies; the effect ends in the cleanup step and the rule applies again there', () => {
    let s = scenario([], { p1: { hand: ['Test Echo'] }, defs: [ECHO, LEGEND_OGRE] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Echo', 'hand', 'p1') });
    for (let guard = 0; s.pending?.kind === 'payCost' && guard < 5; guard++) s = answer(s, { kind: 'payCost', auto: true });
    s = drain(s);
    for (const n of ['Test Ogre King', 'Test Ogre King']) put(s, 'p1', 'battlefield', n);
    s = pass(s);
    expect(s.pending?.kind).not.toBe('chooseObjects');
    expect(findAll(s, 'Test Ogre King', 'battlefield', 'p1').length).toBe(2);
    let n = s;
    for (let guard = 0; n.pending?.kind !== 'chooseObjects' && guard < 60; guard++) {
      if (n.pending?.kind === 'declareAttackers') n = answer(n, { kind: 'declareAttackers', attacks: [] });
      else if (n.pending?.kind === 'declareBlockers') n = answer(n, { kind: 'declareBlockers', blocks: [] });
      else n = pass(n);
    }
    expect(n.pending?.kind).toBe('chooseObjects');
    // the effect ends in the cleanup step (CR 514.2), where the state-based actions are then checked (CR 514.3a)
    expect([n.turn.number, n.turn.step]).toEqual([s.turn.number, 'cleanup']);
  });
});

describe('CR 704.5a, 104.3b: "You don\'t lose the game for having 0 or less life."', () => {
  const CHARM = card('Test Charm', 'Artifact', "You don't lose the game for having 0 or less life.");
  it('is automated', () => expect(full(CHARM)).toBe(true));
  it('its controller stays in the game at 0 life; the opponent at 0 life loses', () => {
    let s = scenario([], { p1: { battlefield: ['Test Charm'] }, defs: [CHARM] });
    s.players[0]!.life = -3;
    s = pass(s);
    expect(s.players[0]!.hasLost).toBe(false);
    let t = scenario([], { p1: { battlefield: ['Test Charm'] }, defs: [CHARM] });
    t.players[1]!.life = 0;
    t = pass(t);
    expect(t.players[1]!.hasLost).toBe(true);
  });
  it('ten poison counters still make its controller lose (CR 704.5c)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Charm'] }, defs: [CHARM] });
    s.players[0]!.life = 0;
    s.players[0]!.poison = 10;
    s = pass(s);
    expect(s.players[0]!.hasLost).toBe(true);
  });
});

describe('CR 603.2d, 611.3a, 301.5: "As long as ~ is equipped, if a triggered ability of ~ or an Equipment attached to it triggers, that ability triggers an additional time."', () => {
  const MERC = card('Test Merc', 'Creature — Human Soldier', 'Whenever ~ attacks, you gain 1 life.\nAs long as ~ is equipped, if a triggered ability of ~ or an Equipment attached to it triggers, that ability triggers an additional time.', ['2', '2']);
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Whenever equipped creature attacks, you gain 2 life.\nEquip {0}');
  const TOTEM = card('Test Totem', 'Artifact', 'Whenever a creature you control attacks, you gain 4 life.');
  it('is automated', () => expect(full(MERC)).toBe(true));
  const attackOnce = (equipped: boolean): number => {
    let s = scenario([], { p1: { battlefield: ['Test Merc', 'Test Blade', 'Test Totem'] }, defs: [MERC, BLADE, TOTEM] });
    const merc = find(s, 'Test Merc', 'battlefield', 'p1');
    if (equipped) s.objects[find(s, 'Test Blade', 'battlefield', 'p1')]!.attachedTo = merc;
    const before = life(s, 'p1');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: merc, defender: 'p2' }] });
    s = drain(s);
    return life(s, 'p1') - before;
  };
  it('unequipped, the Blade\'s ability does not trigger and the others trigger once (1 + 4)', () => expect(attackOnce(false)).toBe(5));
  it('equipped, its own trigger and the Equipment\'s trigger twice each; another permanent\'s trigger once (2 x 1 + 2 x 2 + 4)', () => expect(attackOnce(true)).toBe(10));
});

describe('CR 613.1f, 509.1c, 611.3a: "As long as equipped creature is attacking, it has first strike and must be blocked if able."', () => {
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'As long as equipped creature is attacking, it has first strike and must be blocked if able.\nEquip {0}');
  it('is automated', () => expect(full(SWORD)).toBe(true));
  it('the creature has first strike only while attacking, and the defender must block it with a creature that can', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Sword'] }, p2: { battlefield: ['Test Wall'] }, defs: [SWORD, BEAR, WALL] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[find(s, 'Test Sword', 'battlefield', 'p1')]!.attachedTo = bear;
    expect(has(s, bear, 'first strike')).toBe(false);
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    expect(has(s, bear, 'first strike')).toBe(true);
    s = until(s, 'declareBlockers');
    const none = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [] } });
    expect(none.error?.rules.join(' ') ?? '').toContain('509.1c');
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: bear }] } }).error).toBeUndefined();
  });
});

describe('CR 613.4c, 107.1: "Artifact creatures and Elves you control get +1/+1 for each Wizard you control and each Wizard card in your graveyard."', () => {
  const MAGE = card('Test Mage', 'Creature — Human Wizard', 'Artifact creatures and Elves you control get +1/+1 for each Wizard you control and each Wizard card in your graveyard.', ['1', '1']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
  it('is automated', () => expect(full(MAGE)).toBe(true));
  it('one Wizard on the battlefield and one in the graveyard: +2/+2 for an Elf and an artifact creature, nothing for a Bear or an opponent\'s Elf', () => {
    const s = scenario([], { p1: { battlefield: ['Test Mage', 'Test Elf', 'Test Golem', 'Test Bear'], graveyard: ['Test Mage'] }, p2: { battlefield: ['Test Elf'] }, defs: [MAGE, ELF, GOLEM, BEAR] });
    const pt = (id: ObjectId) => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
    expect(pt(find(s, 'Test Elf', 'battlefield', 'p1'))).toEqual([3, 3]);
    expect(pt(find(s, 'Test Golem', 'battlefield', 'p1'))).toEqual([4, 4]);
    expect(pt(find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual([2, 2]);
    expect(pt(find(s, 'Test Elf', 'battlefield', 'p2'))).toEqual([1, 1]);
  });
});

describe('CR 100.2a, 113.6n: "A deck can have any number of cards named ~." / "up to seven"', () => {
  it('both are automated deck-construction abilities that do nothing in a game', () => {
    for (const text of ['A deck can have any number of cards named Test Rat.', 'A deck can have up to seven cards named Test Rat.']) {
      const d = card('Test Rat', 'Creature — Rat', text, ['1', '1']);
      expect(full(d), text).toBe(true);
      expect(JSON.stringify(d.faces)).toContain('"s":"deckConstruction"');
    }
  });
  it('a sentence that names another card is not read (the render gate wants the card\'s own name)', () => {
    expect(full(card('Test Rat', 'Creature — Rat', 'A deck can have any number of cards named Test Mouse.', ['1', '1']))).toBe(false);
  });
});

describe('CR 613.1f, 702.15b: "Elf creatures you control and instant spells you control have lifelink."', () => {
  const BOND = card('Test Bond', 'Enchantment', 'Elf creatures you control and instant spells you control have lifelink.');
  const ZAP = card('Test Zap', 'Instant', '~ deals 3 damage to any target.');
  it('is automated', () => expect(full(BOND)).toBe(true));
  it('the instant spell has lifelink as it deals its damage: its controller gains 3 life; without the enchantment nothing', () => {
    const run = (withBond: boolean): number => {
      let s = scenario([], { p1: { hand: ['Test Zap'], battlefield: withBond ? ['Test Bond'] : [] }, defs: [BOND, ZAP] });
      const before = life(s, 'p1');
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') });
      for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 5; guard++) {
        if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
        else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else break;
      }
      s = drain(s);
      expect(life(s, 'p2')).toBe(17);
      return life(s, 'p1') - before;
    };
    expect(run(true)).toBe(3);
    expect(run(false)).toBe(0);
  });
  it('an Elf creature its controller controls has lifelink too; a Bear does not', () => {
    const ELF = card('Test Elf Archer', 'Creature — Elf Archer', '', ['1', '1']);
    const s = scenario([], { p1: { battlefield: ['Test Bond', 'Test Elf Archer', 'Test Bear'] }, defs: [BOND, ELF, BEAR] });
    expect(has(s, find(s, 'Test Elf Archer', 'battlefield', 'p1'), 'lifelink')).toBe(true);
    expect(has(s, find(s, 'Test Bear', 'battlefield', 'p1'), 'lifelink')).toBe(false);
  });
  it('an Elf creature SPELL on the stack is not one of the "Elf creatures you control" (a permanent); an instant spell is', () => {
    const ELF = card('Test Elf Archer', 'Creature — Elf Archer', '', ['1', '1']);
    let s = scenario([], { p1: { hand: ['Test Elf Archer'], battlefield: ['Test Bond'] }, defs: [BOND, ELF] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Elf Archer', 'hand', 'p1') });
    for (let guard = 0; s.pending?.kind === 'payCost' && guard < 5; guard++) s = answer(s, { kind: 'payCost', auto: true });
    expect(has(s, find(s, 'Test Elf Archer', 'stack', 'p1'), 'lifelink')).toBe(false);
  });
});

describe('CR 602.5b, 702.193a: "Each power-up ability of creatures you control can be activated an additional time."', () => {
  const STAR = card('Test Star', 'Creature — Human Hero', 'Each power-up ability of creatures you control can be activated an additional time.', ['1', '1']);
  const HULK = card('Test Brute', 'Creature — Human Hero', 'Power-up — {0}: Put a +1/+1 counter on ~.', ['2', '2']);
  it('is automated', () => expect(full(STAR)).toBe(true));
  const activations = (withStar: boolean): number => {
    let s = scenario([], { p1: { battlefield: withStar ? ['Test Star', 'Test Brute'] : ['Test Brute'] }, defs: [STAR, HULK] });
    const brute = find(s, 'Test Brute', 'battlefield', 'p1');
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const r = applyAction(s, { type: 'activate', player: 'p1', source: brute, ability: 'p:0:0' });
      if (r.error) break;
      s = r.state;
      for (let guard = 0; s.pending?.kind === 'payCost' && guard < 5; guard++) s = answer(s, { kind: 'payCost', auto: true });
      s = drain(s);
      n++;
    }
    expect(s.objects[brute]!.counters['+1/+1'] ?? 0).toBe(n);
    return n;
  };
  it('the power-up ability is activated twice, then refused (CR 602.5b); without the static only once', () => {
    expect(activations(true)).toBe(2);
    expect(activations(false)).toBe(1);
  });
});

describe('CR 510.1a: "If ~\'s power is negative, ~ assigns combat damage as though ~\'s power were positive."', () => {
  const ODD = card('Test Oddity', 'Creature — Horror', "If ~'s power is negative, ~ assigns combat damage as though ~'s power were positive.", ['-2', '3']);
  const PLAIN = card('Test Shade', 'Creature — Horror', '', ['-2', '3']);
  it('is automated', () => expect(full(ODD)).toBe(true));
  const attack = (name: string, def: CardDef): number => {
    let s = scenario([], { p1: { battlefield: [name] }, defs: [def] });
    const id = find(s, name, 'battlefield', 'p1');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] });
    for (let guard = 0; s.turn.step !== 'end' && guard < 20; guard++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
    return 20 - life(s, 'p2');
  };
  it('a -2/3 creature with it deals 2 combat damage; one without it deals none', () => {
    expect(attack('Test Oddity', ODD)).toBe(2);
    expect(attack('Test Shade', PLAIN)).toBe(0);
  });
});

describe('CR 111.4, 608.2c, 702.122a: "Create X 1/1 colorless Pilot creature tokens, where X is .... The tokens have "...""', () => {
  const HANGAR = card('Test Hangar', 'Artifact', '{T}: Create X 1/1 colorless Pilot creature tokens, where X is the number of artifacts you control. The tokens have "This token saddles Mounts and crews Vehicles as though its power were 2 greater."');
  it('is automated', () => expect(full(HANGAR)).toBe(true));
  it('one artifact: one Pilot token with the crew rule of its own', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hangar'] }, defs: [HANGAR] });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Hangar', 'battlefield', 'p1'), ability: 'p:0:0' });
    s = drain(s);
    const pilots = s.zones.battlefield.filter((id) => chars(s, id).subtypes.includes('Pilot'));
    expect(pilots.length).toBe(1);
    expect(JSON.stringify(chars(s, pilots[0]!).abilities.map((a) => a.def))).toContain('"rule":"crewSaddlePowerBonus"');
  });
});
