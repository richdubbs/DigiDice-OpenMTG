/**
 * Commander lane edh-c, round edh-c-35 (EDHREC ranks 25,501-26,000): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler, in 4-player games (Alice p1 is the active player of turn 1). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 615.1a, 303.4        "Prevent all damage that would be dealt to and dealt by enchanted creature."
 *   CR 611.2a, 613.1e       "Target creature gets +1/+0, becomes black, and gains shadow until end of turn."
 *   CR 701.9b, 701.9a       "Target opponent discards a card at random, then discards a card."
 *   CR 608.2c               "discard a card if you don't control an Ogre" (checked as the ability resolves)
 *   CR 613.1d, 613.4b       "This artifact is a 5/5 Golem artifact creature as long as you control three or more artifacts."
 *   CR 604.1, 613.1f        "As long as enchanted permanent is a creature, it gets -3/-0 and loses flying."
 *   CR 509.1b, 611.3a       "Enchanted creature can't block if it's black."
 *   CR 303.4, 702.12a       "Enchanted land has indestructible and can't be enchanted by other Auras."
 *   CR 702.82c, 701.9a      "for each creature it devoured" (gain life; discard)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { lifeOf, mpScenario, passUntil } from '../../m12/rules/helpers';
import { hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
/** Answer what comes up: targets, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** The player casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);

const BEAR = card('Test Bear', 'Creature — Bear', '', [ '2', '2' ]);
const BLACK_BEAR = card('Test Black Bear', 'Creature — Bear', '', ['2', '2'], '{1}{B}', ['B']);
const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', ['2', '2']);

describe('CR 615.1a, 303.4: "Prevent all damage that would be dealt to and dealt by enchanted creature."', () => {
  const HEART = card('Test Warding Aura', 'Enchantment — Aura', 'Enchant creature\nPrevent all damage that would be dealt to and dealt by enchanted creature.');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target creature.', undefined, '{0}', ['R']);
  const BITE = card('Test Bite', 'Sorcery', "Target creature you control deals damage equal to its power to target creature you don't control.");
  const start = () => mpScenario({ defs: [HEART, ZAP, BITE, BEAR], zones: { p1: { hand: ['Test Warding Aura', 'Test Zap', 'Test Bite'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(HEART)).toBe(true));
  it('damage to the enchanted creature and damage it would deal are both prevented; another creature is unaffected', () => {
    let s = start();
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Warding Aura', { targets: [[obj(bears[0]!)]] });
    const hit = cast(s, 'Test Zap', { targets: [[obj(bears[0]!)]] });
    expect(hit.zones.battlefield.includes(bears[0]!)).toBe(true);
    expect(hit.objects[bears[0]!]!.damage).toBe(0);
    const other = cast(s, 'Test Zap', { targets: [[obj(bears[1]!)]] });
    expect(other.zones.battlefield.includes(bears[1]!)).toBe(false);
    const enemy = find(s, 'Test Bear', 'battlefield', 'p2');
    const bitten = cast(s, 'Test Bite', { targets: [[obj(bears[0]!)], [obj(enemy)]] });
    expect(bitten.objects[enemy]!.damage).toBe(0);
    const bitten2 = cast(s, 'Test Bite', { targets: [[obj(bears[1]!)], [obj(enemy)]] });
    expect(bitten2.zones.battlefield.includes(enemy)).toBe(false);
  });
});

describe('CR 611.2a, 613.1e, 613.1f: "Target creature gets +1/+0, becomes black, and gains shadow until end of turn."', () => {
  const CLUTCH = card('Test Dark Trick', 'Instant', 'Target creature gets +1/+0, becomes black, and gains shadow until end of turn.', undefined, '{0}', ['B']);
  const WHITE = card('Test White Knight', 'Creature — Knight', '', ['2', '2'], '{1}{W}', ['W']);
  it('is automated', () => expect(full(CLUTCH)).toBe(true));
  it('+1/+0, black only (no longer white) and shadow until end of turn; gone at the next turn', () => {
    const s0 = mpScenario({ defs: [CLUTCH, WHITE], zones: { p1: { hand: ['Test Dark Trick'], battlefield: ['Test White Knight'] } } });
    const k = find(s0, 'Test White Knight', 'battlefield', 'p1');
    const s = cast(s0, 'Test Dark Trick', { targets: [[obj(k)]] });
    expect(stat(s, k)).toBe('3/2');
    expect(getChars(s, k)!.colors).toEqual(['B']);
    expect(hasKeyword(getChars(s, k), 'shadow')).toBe(true);
    const later = passUntil(s, (x) => x.turn.number > 1 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'next turn');
    expect(stat(later, k)).toBe('2/2');
    expect(getChars(later, k)!.colors).toEqual(['W']);
    expect(hasKeyword(getChars(later, k), 'shadow')).toBe(false);
  });
});

describe('CR 701.9b, 701.9a: "Target opponent discards a card at random, then discards a card."', () => {
  const STUPOR = card('Test Dull Hex', 'Sorcery', 'Target opponent discards a card at random, then discards a card.');
  it('is automated', () => expect(full(STUPOR)).toBe(true));
  it('two cards leave a hand of three: one at random, one of their choice (they choose among the two left)', () => {
    const s0 = mpScenario({ defs: [STUPOR, BEAR, FLYER], zones: { p1: { hand: ['Test Dull Hex'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Flyer'] } } });
    expect(handSize(s0, 'p2')).toBe(3);
    const mid = cast(s0, 'Test Dull Hex', { targets: [[plr('p2')]] }); // stops at the second discard: the random one is already gone
    expect(mid.pending?.kind).toBe('chooseObjects');
    expect(mid.zones.graveyard.p2!.length).toBe(1);
    const options = (mid.pending as { options: ObjectId[] }).options;
    expect(options.length).toBe(2); // p2 chooses among the two cards left
    const s = answer(mid, { kind: 'chooseObjects', ids: [options[0]!] } as DecisionAnswer);
    expect(handSize(s, 'p2')).toBe(1);
    expect(s.zones.graveyard.p2!.length).toBe(2);
    expect(s.zones.hand.p2).toEqual([options[1]]);
  });
  it('a hand of one: the random discard empties it and the second discard does nothing', () => {
    const s0 = mpScenario({ defs: [STUPOR, BEAR], zones: { p1: { hand: ['Test Dull Hex'] }, p2: { hand: ['Test Bear'] } } });
    const s = cast(s0, 'Test Dull Hex', { targets: [[plr('p2')]] });
    expect(handSize(s, 'p2')).toBe(0);
    expect(s.zones.graveyard.p2!.length).toBe(1);
  });
  it('negative: only the target opponent discards; the caster keeps their cards', () => {
    const s0 = mpScenario({ defs: [STUPOR, BEAR], zones: { p1: { hand: ['Test Dull Hex', 'Test Bear'] }, p2: { hand: ['Test Bear'] }, p3: { hand: ['Test Bear'] } } });
    const s = cast(s0, 'Test Dull Hex', { targets: [[plr('p2')]] });
    expect(handSize(s, 'p2')).toBe(0);
    expect(handNames(s, 'p1').filter((n) => n === 'Test Bear')).toEqual(['Test Bear']);
    expect(handNames(s, 'p3').filter((n) => n === 'Test Bear')).toEqual(['Test Bear']);
  });
});

describe('CR 608.2c: "At the beginning of your upkeep, discard a card if you don\'t control an Ogre."', () => {
  const ONI = card('Test Grim Oni', 'Creature — Ogre', 'At the beginning of your upkeep, discard a card if you don\'t control a Wizard.', ['3', '3']);
  const WIZ = card('Test Wizard', 'Creature — Wizard', '', ['1', '1']);
  const toUpkeep = (s0: GameState): GameState => {
    let s = passUntil(s0, (x) => x.turn.number > 1 && x.turn.activePlayer === 'p1' && x.turn.step === 'upkeep' && x.zones.stack.length > 0, 'p1 upkeep with the trigger');
    for (let guard = 0; guard < 20 && s.zones.stack.length > 0; guard++) {
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [s.pending.options[0]!] });
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => expect(full(ONI)).toBe(true));
  it('without a Wizard it discards a card each upkeep; with one it discards nothing', () => {
    const base = (extra: string[]) => mpScenario({ defs: [ONI, WIZ, BEAR], zones: { p1: { hand: ['Test Bear', 'Test Bear'], battlefield: ['Test Grim Oni', ...extra] } } });
    const a = base([]);
    const handA = handSize(a, 'p1');
    const sa = toUpkeep(a);
    expect(handSize(sa, 'p1')).toBeLessThan(handA + 1); // one card left the hand (the draw step comes after the upkeep)
    expect(sa.zones.graveyard.p1!.length).toBe(1);
    const sb = toUpkeep(base(['Test Wizard']));
    expect(sb.zones.graveyard.p1!.length).toBe(0);
  });
});

describe('CR 613.1d, 613.4b, 205.1a: "This artifact is a 5/5 Golem artifact creature as long as you control three or more artifacts."', () => {
  const RELIC = card('Test Awakened Relic', 'Artifact', 'This artifact is a 5/5 Golem artifact creature as long as you control three or more artifacts.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  it('is automated', () => expect(full(RELIC)).toBe(true));
  it('with three artifacts (itself counts) it is a 5/5 Golem artifact creature; with two it is a plain artifact', () => {
    const three = mpScenario({ defs: [RELIC, TRINKET], zones: { p1: { battlefield: ['Test Awakened Relic', 'Test Trinket', 'Test Trinket'] } } });
    const r = find(three, 'Test Awakened Relic', 'battlefield', 'p1');
    const c = getChars(three, r)!;
    expect(c.types).toContain('Creature');
    expect(c.types).toContain('Artifact');
    expect(c.subtypes).toEqual(['Golem']);
    expect(stat(three, r)).toBe('5/5');
    const two = mpScenario({ defs: [RELIC, TRINKET], zones: { p1: { battlefield: ['Test Awakened Relic', 'Test Trinket'] }, p2: { battlefield: ['Test Trinket', 'Test Trinket'] } } });
    expect(getChars(two, find(two, 'Test Awakened Relic', 'battlefield', 'p1'))!.types).not.toContain('Creature');
  });
});

describe('CR 604.1, 613.1f: "As long as enchanted permanent is a creature, it gets -3/-0 and loses flying."', () => {
  const SHORT = card('Test Static Cling', 'Enchantment — Aura', 'Enchant artifact or creature\nAs long as enchanted permanent is a creature, it gets -3/-0 and loses flying.');
  const RELIC = card('Test Plain Relic', 'Artifact', '');
  it('is automated', () => expect(full(SHORT)).toBe(true));
  it('an enchanted creature gets -3/-0 and loses flying; an enchanted noncreature artifact is unchanged', () => {
    const s0 = mpScenario({ defs: [SHORT, FLYER, RELIC], zones: { p1: { hand: ['Test Static Cling', 'Test Static Cling'], battlefield: ['Test Flyer', 'Test Plain Relic'] } } });
    const f = find(s0, 'Test Flyer', 'battlefield', 'p1');
    const rel = find(s0, 'Test Plain Relic', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s0, f), 'flying')).toBe(true);
    const s1 = cast(s0, 'Test Static Cling', { targets: [[obj(f)]] });
    expect(stat(s1, f)).toBe('-1/2');
    expect(hasKeyword(getChars(s1, f), 'flying')).toBe(false);
    const s2 = cast(s0, 'Test Static Cling', { targets: [[obj(rel)]] });
    expect(getChars(s2, rel)!.types).not.toContain('Creature');
    expect(s2.objects[rel]!.attachedTo).toBeUndefined();
  });
});

describe('CR 509.1b, 611.3a: "Enchanted creature can\'t block if it\'s black."', () => {
  const HOBBLE = card('Test Leg Trap', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't block if it's black.");
  const canBlock = (s0: GameState, attacker: ObjectId, blocker: string): boolean => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' as PlayerId }] });
    for (let guard = 0; guard < 40 && s.pending?.kind === 'priority' && s.turn.step !== 'end'; guard++) s = act(s, { type: 'pass', player: s.pending.player });
    const d = s.pending;
    if (!d || d.kind !== 'declareBlockers') return false;
    return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, blocker, 'battlefield', d.player), attacker }] } }).error === undefined;
  };
  const start = (target: string) => {
    const s0 = mpScenario({ defs: [HOBBLE, BEAR, BLACK_BEAR], zones: { p1: { hand: ['Test Leg Trap'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Black Bear'] } } });
    return { s: cast(s0, 'Test Leg Trap', { targets: [[obj(find(s0, target, 'battlefield', 'p2'))]] }), attacker: find(s0, 'Test Bear', 'battlefield', 'p1') };
  };
  it('is automated', () => expect(full(HOBBLE)).toBe(true));
  it('an enchanted black creature can\'t block; an enchanted nonblack creature can; an unenchanted black one can', () => {
    const a = start('Test Black Bear');
    expect(canBlock(a.s, a.attacker, 'Test Black Bear')).toBe(false);
    expect(canBlock(a.s, a.attacker, 'Test Bear')).toBe(true);
    const b = start('Test Bear');
    expect(canBlock(b.s, b.attacker, 'Test Bear')).toBe(true);
    expect(canBlock(b.s, b.attacker, 'Test Black Bear')).toBe(true);
  });
});

describe('CR 303.4, 702.12a: "Enchanted land has indestructible and can\'t be enchanted by other Auras."', () => {
  const CONSECRATE = card('Test Hallowed Ground', 'Enchantment — Aura', "Enchant land\nEnchanted land has indestructible and can't be enchanted by other Auras.");
  const OTHER = card('Test Land Aura', 'Enchantment — Aura', 'Enchant land\nEnchanted land has hexproof.');
  const DEST = card('Test Demolish', 'Instant', 'Destroy target land.');
  const start = () => mpScenario({ defs: [CONSECRATE, OTHER, DEST], zones: { p1: { hand: ['Test Hallowed Ground', 'Test Land Aura', 'Test Demolish'], battlefield: ['Plains', 'Plains'] } } });
  it('is automated', () => expect(full(CONSECRATE)).toBe(true));
  it('the land is indestructible; another Aura can\'t be put on it, but can enchant another land', () => {
    const s0 = start();
    const [plains, forest] = findAll(s0, 'Plains', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s1 = cast(s0, 'Test Hallowed Ground', { targets: [[obj(plains)]] });
    expect(s1.objects[find(s1, 'Test Hallowed Ground', 'battlefield', 'p1')]!.attachedTo).toBe(plains);
    expect(hasKeyword(getChars(s1, plains), 'indestructible')).toBe(true);
    expect(cast(s1, 'Test Demolish', { targets: [[obj(plains)]] }).zones.battlefield.includes(plains)).toBe(true);
    // the Aura spell resolves but can't be attached to the land (CR 608.3e, 303.4i): it goes to its owner's graveyard
    const refused = cast(s1, 'Test Land Aura', { targets: [[obj(plains)]] });
    expect(refused.zones.battlefield.some((id) => refused.defs[refused.objects[id]!.defId]?.name === 'Test Land Aura')).toBe(false);
    expect(refused.zones.graveyard.p1!.map((id) => refused.objects[id]!.defId)).toContain('Test Land Aura');
    const s2 = cast(s1, 'Test Land Aura', { targets: [[obj(forest)]] });
    expect(s2.objects[find(s2, 'Test Land Aura', 'battlefield', 'p1')]!.attachedTo).toBe(forest);
  });
  it('an Aura already on the land when it comes in is put into the graveyard as a state-based action (CR 704.5m), while Consecrate Land itself stays', () => {
    const s0 = start();
    const plains = findAll(s0, 'Plains', 'battlefield', 'p1')[0]!;
    const s1 = cast(s0, 'Test Land Aura', { targets: [[obj(plains)]] });
    expect(s1.objects[find(s1, 'Test Land Aura', 'battlefield', 'p1')]!.attachedTo).toBe(plains);
    const s2 = cast(s1, 'Test Hallowed Ground', { targets: [[obj(plains)]] });
    expect(s2.objects[find(s2, 'Test Hallowed Ground', 'battlefield', 'p1')]!.attachedTo).toBe(plains);
    expect(s2.zones.battlefield.some((id) => s2.defs[s2.objects[id]!.defId]?.name === 'Test Land Aura')).toBe(false);
  });
});

describe('CR 702.82c, 701.9a, 608.2h: "for each creature it devoured"', () => {
  const GLUT = card('Test Gorger', 'Creature — Beast', 'Devour 1\nWhen this creature enters, you gain 2 life for each creature it devoured.', ['1', '1']);
  const FIEND = card('Test Maw Fiend', 'Creature — Horror', 'Devour 2\nWhen this creature enters, target player discards a card for each creature it devoured.', ['1', '1']);
  it('are automated', () => { expect(full(GLUT)).toBe(true); expect(full(FIEND)).toBe(true); });
  it('life: 2 for each creature sacrificed as it entered (the counters too); none devoured: nothing', () => {
    const s0 = mpScenario({ defs: [GLUT, BEAR], zones: { p1: { hand: ['Test Gorger'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const life0 = lifeOf(s0, 'p1');
    const s = cast(s0, 'Test Gorger', { answers: [{ kind: 'chooseObjects', ids: [bears[0]!, bears[1]!] } as DecisionAnswer] });
    expect(lifeOf(s, 'p1')).toBe(life0 + 4);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Bear').length).toBe(1);
    const none = cast(s0, 'Test Gorger', { answers: [{ kind: 'chooseObjects', ids: [] } as DecisionAnswer] });
    expect(lifeOf(none, 'p1')).toBe(life0);
  });
  it('a creature that enters as a copy of a devour creature keeps its own devour count for the copied trigger (links are renamed in a copy, CR 707.9)', () => {
    const CLONE = card('Test Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', ['0', '0']);
    const s0 = mpScenario({ defs: [FIEND, CLONE, BEAR], zones: { p1: { hand: ['Test Mimic'], battlefield: ['Test Maw Fiend', 'Test Bear', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
    const fiend = find(s0, 'Test Maw Fiend', 'battlefield', 'p1');
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Mimic', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [fiend] } as DecisionAnswer, { kind: 'chooseObjects', ids: [bears[0]!] } as DecisionAnswer, { kind: 'chooseObjects', ids: [s0.zones.hand.p2![0]!] } as DecisionAnswer] });
    expect(handSize(s, 'p2')).toBe(2);
  });
  it('discard: the target player discards a card for each creature devoured', () => {
    const s0 = mpScenario({ defs: [FIEND, BEAR], zones: { p1: { hand: ['Test Maw Fiend'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const h = s0.zones.hand.p2!;
    const s = cast(s0, 'Test Maw Fiend', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [bears[0]!] } as DecisionAnswer, { kind: 'chooseObjects', ids: [h[0]!] } as DecisionAnswer] });
    expect(handSize(s, 'p2')).toBe(2);
    const one = cast(s0, 'Test Maw Fiend', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [] } as DecisionAnswer] });
    expect(handSize(one, 'p2')).toBe(3);
  });
});
