/**
 * Commander effort (coordinator C), round edh-c-83 (EDHREC ranks 22,001-22,500, third pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player. Each test is named after the rule it checks and has its negative case.
 *
 *   CR 615.1a, 510.1, 611.2a   "Prevent all combat damage non-Soldier creatures would deal this turn."
 *   CR 615.1a, 615.7, 112.1    "If a spell would deal damage to a permanent or player, prevent 1 damage that spell would deal to that permanent or player."
 *   CR 205.2a, 608.2d, 701.13a "Exile up to one card of each card type from defending player's graveyard. Put a +1/+1 counter on ~ for each card exiled this way."
 *   CR 208.1, 202.3, 604.1     "Each creature with the greatest mana value has protection from each color."
 *   CR 508.1, 603.2c           "Whenever all non-Wall creatures you control attack, enchanted creature gets +X/+0 until end of turn, where X is the number of attacking creatures."
 *   CR 706.2, 113.6, 400.3     "{3}{G}: Roll a d20. Activate only if ~ is in your graveyard. 1-9 | Put ~ on top of your library. 10-19 | Return ~ to your hand. 20 | Return ~ to the battlefield tapped."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, lifeOf, runCombat, tweak, toDeclareAttackers } from '../../m4/helpers';
import { cast, drive } from '../../m5/cr-examples/helpers';

/** Pass priority until the stack is empty; each choice of objects takes the first offered options (as many as it may take), costs are paid automatically. */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')); i++) {
    const d = s.pending;
    if (d === null) break;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.max) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const damageOf = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

describe('CR 615.1a, 510.1, 611.2a: "Prevent all combat damage non-Soldier creatures would deal this turn." (the creature type is checked as the damage would be dealt)', () => {
  const FOG = card('Test Soldier Fog', 'Sorcery', 'Prevent all combat damage non-Soldier creatures would deal this turn.');
  const SOLDIER = card('Test Pikeman', 'Creature — Human Soldier', '', ['3', '3']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
  it('is automated', () => expect(full(FOG)).toBe(true));
  it('the Ogre\'s combat damage is prevented and the Soldier\'s is dealt', () => {
    let s = scenario([], { defs: [FOG, SOLDIER, OGRE], p1: { hand: ['Test Soldier Fog'], battlefield: ['Test Pikeman', 'Test Ogre'] } });
    s = resolveAll(cast(s, 'Test Soldier Fog'));
    s = runCombat(s, { attack: [[find(s, 'Test Pikeman', 'battlefield'), 'p2'], [find(s, 'Test Ogre', 'battlefield'), 'p2']] });
    expect(lifeOf(s, 'p2')).toBe(20 - 3);
  });
  it('the negative case: without the spell both creatures deal their damage', () => {
    let s = scenario([], { defs: [FOG, SOLDIER, OGRE], p1: { hand: ['Test Soldier Fog'], battlefield: ['Test Pikeman', 'Test Ogre'] } });
    s = runCombat(s, { attack: [[find(s, 'Test Pikeman', 'battlefield'), 'p2'], [find(s, 'Test Ogre', 'battlefield'), 'p2']] });
    expect(lifeOf(s, 'p2')).toBe(20 - 7);
  });
});

describe('CR 615.1a, 615.7, 112.1: "If a spell would deal damage to a permanent or player, prevent 1 damage that spell would deal to that permanent or player." (each recipient, spells only)', () => {
  const PEGASUS = card('Test Plated Horse', 'Creature — Pegasus', 'If a spell would deal damage to a permanent or player, prevent 1 damage that spell would deal to that permanent or player.', ['1', '3']);
  const BURN = card('Test Burn', 'Sorcery', 'Test Burn deals 3 damage to target player.');
  const SWEEP = card('Test Sweep', 'Sorcery', 'Test Sweep deals 2 damage to each creature.');
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{T}: Test Pinger deals 3 damage to target player.', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
  it('is automated', () => expect(full(PEGASUS)).toBe(true));
  it('a spell dealing 3 damage to a player deals 2; a spell dealing 2 to each creature deals 1 to each of two creatures (the prevention is per recipient)', () => {
    let s = scenario([], { defs: [PEGASUS, BURN, SWEEP, BEAR], p1: { hand: ['Test Burn', 'Test Sweep'], battlefield: ['Test Plated Horse', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Burn', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]));
    expect(lifeOf(s, 'p2')).toBe(20 - 2);
    s = resolveAll(cast(s, 'Test Sweep'));
    expect(damageOf(s, find(s, 'Test Bear', 'battlefield'))).toBe(1);
    expect(damageOf(s, find(s, 'Test Plated Horse', 'battlefield'))).toBe(1);
  });
  it('the negative case: an ability of a permanent (not a spell) and combat damage are not reduced; neither is damage with no Pegasus around', () => {
    let s = scenario([], { defs: [PEGASUS, PINGER, BEAR], p1: { battlefield: ['Test Plated Horse', { name: 'Test Pinger', since: 0 }, 'Test Bear'] } });
    const pinger = find(s, 'Test Pinger', 'battlefield');
    s = resolveAll(activateOnP2(s, pinger));
    expect(lifeOf(s, 'p2')).toBe(20 - 3);
    s = runCombat(s, { attack: [[find(s, 'Test Bear', 'battlefield'), 'p2']] });
    expect(lifeOf(s, 'p2')).toBe(20 - 3 - 3);
    const bare = scenario([], { defs: [BURN], p1: { hand: ['Test Burn'] } });
    expect(lifeOf(resolveAll(cast(bare, 'Test Burn', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }])), 'p2')).toBe(20 - 3);
  });
});

/** Activate the first non-mana ability of `id`, target player p2, and pay automatically. */
function activateOnP2(s: GameState, id: ObjectId): GameState {
  const la = legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && !a.isMana && a.object === id)!;
  let t = act(s, la.action);
  if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
  return drive(t);
}

describe('CR 205.2a, 608.2d, 701.13a: "Exile up to one card of each card type from defending player\'s graveyard. Put a +1/+1 counter on ~ for each card exiled this way."', () => {
  const GORGER = card('Test Graveyard Ogre', 'Creature — Ogre', 'Whenever this creature attacks, exile up to one card of each card type from defending player\'s graveyard. Put a +1/+1 counter on this creature for each card exiled this way.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');
  it('is automated', () => expect(full(GORGER)).toBe(true));
  it('with two creature cards, a land, an instant and a sorcery in the graveyard: one card of each of the four types is exiled (one Bear stays) and four counters are put', () => {
    const SORC = card('Test Sorcery', 'Sorcery', 'Draw a card.');
    let s = scenario(['Forest'], { defs: [GORGER, BEAR, BOLT, SORC], p1: { battlefield: ['Test Graveyard Ogre'] }, p2: { graveyard: ['Test Bear', 'Test Bear', 'Forest', 'Test Bolt', 'Test Sorcery'] } });
    const ogre = find(s, 'Test Graveyard Ogre', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[ogre, 'p2']]);
    s = resolveAll(s);
    expect(s.zones.graveyard['p2']!.length).toBe(1);
    expect(s.zones.exile.length).toBe(4);
    expect(pt(s, ogre)).toBe('6/6');
  });
  it('the negative case: an empty graveyard exiles nothing and puts no counter', () => {
    let s = scenario([], { defs: [GORGER], p1: { battlefield: ['Test Graveyard Ogre'] } });
    const ogre = find(s, 'Test Graveyard Ogre', 'battlefield');
    s = resolveAll(declareAttackers(toDeclareAttackers(s), [[ogre, 'p2']]));
    expect(pt(s, ogre)).toBe('2/2');
  });
  it('the negative case: only the defending player\'s graveyard is used (your own graveyard keeps its cards)', () => {
    let s = scenario([], { defs: [GORGER, BEAR], p1: { battlefield: ['Test Graveyard Ogre'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear'] } });
    const ogre = find(s, 'Test Graveyard Ogre', 'battlefield');
    s = resolveAll(declareAttackers(toDeclareAttackers(s), [[ogre, 'p2']]));
    expect(s.zones.graveyard['p1']!.length).toBe(1);
    expect(pt(s, ogre)).toBe('3/3');
  });
});

describe('CR 208.1, 202.3, 604.1: "Each creature with the greatest mana value has protection from each color." (checked continuously; a tie gives it to all)', () => {
  const FAVOR = card('Test Favor', 'Enchantment', 'Each creature with the greatest mana value has protection from each color.');
  const big = (name: string, cost: string) => card(name, 'Creature — Giant', '', ['2', '2'], cost);
  const BIG = big('Test Big', '{4}');
  const BIG2 = big('Test Big Twin', '{4}');
  const SMALL = big('Test Small', '{1}');
  const protectedFrom = (s: GameState, id: ObjectId): boolean => JSON.stringify(getChars(s, id)).includes('protection');
  it('is automated', () => expect(full(FAVOR)).toBe(true));
  it('only the creature with the greatest mana value has protection; a tie gives it to both; a bigger arrival takes it away from the old one', () => {
    let s = scenario([], { defs: [FAVOR, BIG, BIG2, SMALL], p1: { battlefield: ['Test Favor', 'Test Big', 'Test Small'] }, p2: { battlefield: ['Test Small'] } });
    expect(protectedFrom(s, find(s, 'Test Big', 'battlefield'))).toBe(true);
    expect(findAll(s, 'Test Small', 'battlefield').some((id) => protectedFrom(s, id))).toBe(false);
    s = tweak(s, (t) => { put(t, 'p2', 'battlefield', 'Test Big Twin'); });
    expect(protectedFrom(s, find(s, 'Test Big', 'battlefield'))).toBe(true);
    expect(protectedFrom(s, find(s, 'Test Big Twin', 'battlefield'))).toBe(true);
  });
  it('the negative case: with no creature on the battlefield nothing has it, and a smaller creature never does', () => {
    const s = scenario([], { defs: [FAVOR, BIG, SMALL], p1: { battlefield: ['Test Favor', 'Test Small'] }, p2: { battlefield: ['Test Big'] } });
    expect(protectedFrom(s, find(s, 'Test Small', 'battlefield'))).toBe(false);
    expect(protectedFrom(s, find(s, 'Test Big', 'battlefield'))).toBe(true);
  });
});

describe('CR 508.1, 603.2c: "Whenever all non-Wall creatures you control attack, enchanted creature gets +X/+0 until end of turn, where X is the number of attacking creatures."', () => {
  const MOB = card('Test Mob Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has trample.\nWhenever all non-Wall creatures you control attack, enchanted creature gets +X/+0 until end of turn, where X is the number of attacking creatures.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '4']);
  const board = (): { s: GameState; bears: ObjectId[]; wall: ObjectId } => {
    const s0 = scenario([], { defs: [MOB, BEAR, WALL], p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Wall'] } });
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Mob Aura')]!.attachedTo = bears[0]!; });
    return { s, bears, wall: find(s, 'Test Wall', 'battlefield') };
  };
  it('is automated', () => expect(full(MOB)).toBe(true));
  it('all three Bears attack and the Wall stays home: the trigger gives the enchanted Bear +3/+0', () => {
    const { s: s0, bears } = board();
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), bears.map((b) => [b, 'p2'] as [ObjectId, string])));
    expect(pt(s, bears[0]!)).toBe('5/2');
    expect(pt(s, bears[1]!)).toBe('2/2');
  });
  it('CR 608.2h: X is counted once as the ability resolves; a Bear that leaves combat afterwards does not change it', () => {
    const { s: s0, bears } = board();
    let s = resolveAll(declareAttackers(toDeclareAttackers(s0), bears.map((b) => [b, 'p2'] as [ObjectId, string])));
    s = tweak(s, (t) => { const i = t.combat!.attackers.findIndex((a) => a.id === bears[2]!); t.combat!.attackers.splice(i, 1); });
    expect(pt(s, bears[0]!)).toBe('5/2');
  });
  it('CR 702.26b: a phased-out Bear does not exist, so it need not attack', () => {
    const { s: s0, bears } = board();
    const s1 = tweak(s0, (t) => { t.objects[bears[2]!]!.phasedOut = true; });
    const s = resolveAll(declareAttackers(toDeclareAttackers(s1), bears.slice(0, 2).map((b) => [b, 'p2'] as [ObjectId, string])));
    expect(pt(s, bears[0]!)).toBe('4/2');
  });
  it('the negative case: with one Bear staying home it does not trigger', () => {
    const { s: s0, bears } = board();
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), bears.slice(0, 2).map((b) => [b, 'p2'] as [ObjectId, string])));
    expect(pt(s, bears[0]!)).toBe('2/2');
  });
  it('the negative case: the Wall attacking too does not matter, but nobody attacking is no attack at all', () => {
    const { s: s0, bears, wall } = board();
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [...bears, wall].map((b) => [b, 'p2'] as [ObjectId, string])));
    expect(pt(s, bears[0]!)).toBe('6/2');
  });
});

describe('CR 706.2, 113.6, 400.3: "{3}{G}: Roll a d20. Activate only if ~ is in your graveyard." with its three result rows', () => {
  const TROLL = card('Test Gravel Troll', 'Creature — Troll', '{3}{G}: Roll a d20. Activate only if this card is in your graveyard.\n1-9 | Put this card on top of your library.\n10-19 | Return this card to your hand.\n20 | Return this card to the battlefield tapped.', ['4', '3'], '{2}{B}{G}');
  const where = (s: GameState): string[] => {
    const id = find(s, 'Test Gravel Troll', 'graveyard', 'p1');
    return [id];
  };
  it('is automated', () => expect(full(TROLL)).toBe(true));
  it('from the graveyard it is activated once and ends in the library, the hand or the battlefield tapped (exactly one place)', () => {
    let s = scenario(['Forest'], { defs: [TROLL], seed: 'troll-1', p1: { graveyard: ['Test Gravel Troll'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'] } });
    expect(where(s)).toHaveLength(1);
    s = resolveAll(activateOnP2(s, find(s, 'Test Gravel Troll', 'graveyard', 'p1')));
    const places = [s.zones.library['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gravel Troll'), s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gravel Troll'),
      s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gravel Troll'), s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gravel Troll')];
    expect(places.filter(Boolean)).toHaveLength(1);
    expect(places[3]).toBe(false);
  });
  it('over many seeds each row happens: 1-9 library top (your library), 10-19 your hand, 20 the battlefield tapped; the card is never left in the graveyard', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400 && seen.size < 3; i++) {
      let s = scenario(['Forest'], { defs: [TROLL], seed: `troll-${i}`, p1: { graveyard: ['Test Gravel Troll'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'] } });
      s = resolveAll(activateOnP2(s, find(s, 'Test Gravel Troll', 'graveyard', 'p1')));
      const name = (id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
      const top = s.zones.library['p1']![0];
      if (top !== undefined && name(top) === 'Test Gravel Troll') seen.add('library');
      else if (s.zones.hand['p1']!.some((id) => name(id) === 'Test Gravel Troll')) seen.add('hand');
      else { const bf = s.zones.battlefield.find((id) => name(id) === 'Test Gravel Troll'); if (bf !== undefined && s.objects[bf]!.tapped && s.objects[bf]!.controller === 'p1') seen.add('battlefield'); }
      expect(s.zones.graveyard['p1']!.some((id) => name(id) === 'Test Gravel Troll')).toBe(false);
    }
    expect([...seen].sort()).toEqual(['battlefield', 'hand', 'library']);
  });
  it('the negative case: from the hand or the battlefield it has no activation', () => {
    const inHand = scenario(['Forest'], { defs: [TROLL], p1: { hand: ['Test Gravel Troll'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'] } });
    expect(legalActions(inHand, 'p1').some((a) => a.kind === 'activate' && a.label.includes('Roll'))).toBe(false);
    const onField = scenario(['Forest'], { defs: [TROLL], p1: { battlefield: ['Test Gravel Troll', 'Forest', 'Forest', 'Forest', 'Forest'] } });
    expect(legalActions(onField, 'p1').some((a) => a.kind === 'activate' && a.label.includes('Roll'))).toBe(false);
  });
});
