/**
 * edh-next-134 (MUST-FINISH round, group control): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, the cards' own wordings), in four-player games. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.47a, 603.12, 603.3d, 613.1b   "When ~ enters, amass Orcs 2. When you do, until end of turn, gain control of target nonlegendary creature an opponent controls
 *                                        with power less than or equal to the amassed Army's power. Untap that creature. It gains haste until end of turn."
 *                                        (Grishnákh, Brash Instigator: the target is chosen as the reflexive trigger is put on the stack, after the amass)
 *   CR 602.5, 108.3, 603.4, 603.10a, 102.1  "{1}: Draw a card. Gain control of this creature and put a -1/-1 counter on it. Only your opponents may activate this ability and only as a
 *                                        sorcery. When this creature dies, if it had one or more -1/-1 counters on it, its owner draws that many cards and each other player loses
 *                                        that much life." (Oft-Nabbed Goat: "each other player" is other than the OWNER; ruling 2025-11-17: the controller's opponents activate it)
 *   CR 510.2, 120.1, 400.7, 613.1b       "At the beginning of your end step, gain control of target nonland permanent controlled by a player who was dealt combat damage by three or
 *                                        more Pirates this turn." (Admiral Beckett Brass; rulings 2017-09-29: different Pirates, double strike counts once, lasts indefinitely)
 *   CR 701.60a-b, 701.15a-b, 611.2b,     "When this enchantment enters, suspect target creature an opponent controls. As long as this enchantment remains on the battlefield, that
 *   104.3, 800.4a, 611.2c               creature is also goaded. At the beginning of combat on your turn, if two or more players have lost the game, gain control of all goaded
 *                                        and/or suspected creatures until end of turn. Untap them. They gain haste until end of turn." (Hot Pursuit; rulings 2024-02-02)
 *   CR 701.12a-b, 115.7d, 702.61a        "Split second. Exchange control of target noncreature spell and target creature. Then the spell's controller may choose new targets for it."
 *                                        (Sudden Substitution; rulings 2019-08-23: no exchange when one player controls both, the spell's controller may still choose new targets)
 *   CR 603.3d, 601.2c, 701.12a, 205.2a   "Whenever an artifact, creature, or enchantment enters, its controller chooses target permanent another player controls that shares a card
 *                                        type with it. Exchange control of those permanents." (Confusion in the Ranks; rulings 2004-12-01: it triggers on itself; the exchange is
 *                                        not optional)
 *   CR 701.55a-b, 508.4, 613.1b          "Whenever this Vehicle attacks, defending player faces a villainous choice -- That player sacrifices a creature of their choice, or you
 *                                        gain control of a creature of your choice that player controls until end of turn. If you gain control of a creature this way, tap it,
 *                                        and it's attacking that player." (Midnight Crusader Shuttle; rulings 2023-10-13: the creature was not declared as an attacker)
 *   CR 714.2, 611.2b, 101.4, 608.2d      The Horus Heresy: "I -- For each opponent, gain control of up to one target nonlegendary creature that player controls for as long as this
 *                                        Saga remains on the battlefield. II -- Draw a card for each creature you control but don't own. III -- Starting with you, each player
 *                                        chooses a creature. Destroy each creature chosen this way."
 *   CR 603.7, 603.3d, 613.1b             "Whenever this creature or another Dinosaur you control with flying enters, gain control of target creature an opponent controls until end of
 *                                        turn. Untap that creature. It gains flying and haste until end of turn. At the beginning of the next end step, target land deals 3 damage to
 *                                        that creature." (Swooping Pteranodon; ruling 2023-11-10: the land is chosen as the delayed triggered ability triggers)
 *   CR 701.38a, 701.38d, 608.2f, 613.1b, "Secret council -- When Elrond enters, each player secretly votes for fellowship or aid, then those votes are revealed. For each fellowship
 *   508.1c, 108.3                        vote, the voter chooses a creature they control. You gain control of each creature chosen this way, and they gain "This creature can't
 *                                        attack its owner." Then for each aid vote, put a +1/+1 counter on each creature you control." (Elrond of the White Council; rulings 2023-06-16)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { concede, mpScenario, passUntil } from '../../m12/rules/helpers';
import { staticGoadersOf } from '../../../src/statics/rule-sources';
import { controllerOf, getChars, hasKeyword, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; numbers?: number[]; pick?: (options: readonly string[], min: number, max: number) => string[]; seen?: { objects: string[]; text: string }[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.pick ? script.pick(p.options, p.min, p.max) : p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      script.seen?.push({ objects: [...p.objects], text: p.targetText });
      s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);

// ---- Grishnákh, Brash Instigator: amass, then a reflexive steal bounded by the amassed Army's power ---------------------------------------------------------------

const INSTIGATOR = card('Test Orc Instigator', 'Legendary Creature — Goblin Soldier',
  "When this creature enters, amass Orcs 2. When you do, until end of turn, gain control of target nonlegendary creature an opponent controls with power less than or equal to the amassed Army's power. Untap that creature. It gains haste until end of turn.",
  { pt: ['1', '1'] });
const BEAR = card('Test Field Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Hill Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
const LORD = card('Test Small Lord', 'Legendary Creature — Human', '', { pt: ['1', '1'] });
const ARMY = card('Test Old Army', 'Creature — Orc Army', '', { pt: ['0', '0'] });

describe('CR 701.47a, 603.12, 603.3d, 613.1b: "amass Orcs 2. When you do, until end of turn, gain control of target nonlegendary creature an opponent controls with power less than or equal to the amassed Army\'s power"', () => {
  const setup = (mine: (string | { name: string; counters: Record<string, number> })[] = []): GameState => mpScenario({
    defs: [INSTIGATOR, BEAR, OGRE, LORD, ARMY],
    zones: {
      p1: { hand: ['Test Orc Instigator'], battlefield: mine },
      p2: { battlefield: [{ name: 'Test Field Bear', tapped: true }, 'Test Hill Ogre', 'Test Small Lord'] },
      p3: { battlefield: ['Test Field Bear'] },
    },
  });
  it('is automated', () => expect(full(INSTIGATOR)).toBe(true));
  it('a new 2/2 Army: only the opponents\' nonlegendary creatures of power 2 or less are legal; the stolen tapped creature is untapped and has haste, until end of turn', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    const seen: { objects: string[]; text: string }[] = [];
    const s = cast(s0, 'Test Orc Instigator', { targets: [[obj(bear)]], seen });
    expect(seen.length).toBe(1);
    expect(seen[0]!.objects).toContain(bear);
    expect(seen[0]!.objects).toContain(find(s0, 'Test Field Bear', 'battlefield', 'p3'));
    // negative: power 3 is more than the Army's 2; a legendary creature; a creature of your own
    expect(seen[0]!.objects).not.toContain(find(s0, 'Test Hill Ogre', 'battlefield', 'p2'));
    expect(seen[0]!.objects).not.toContain(find(s0, 'Test Small Lord', 'battlefield', 'p2'));
    const army = Object.values(s.objects).find((o) => o.zone === 'battlefield' && getChars(s, o.id).subtypes.includes('Army'))!;
    expect(ptNumbers(getChars(s, army.id))).toEqual({ power: 2, toughness: 2 });
    expect(controllerOf(s, bear)).toBe('p1');
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(hasKeyword(getChars(s, bear), 'haste')).toBe(true);
  });
  it('CR 701.47a: an Army you already control grows first, so its new power is the bound (a 1/1 Army becomes 3/3: the 3/3 is legal)', () => {
    const s0 = setup([{ name: 'Test Old Army', counters: { '+1/+1': 1 } }]);
    const ogre = find(s0, 'Test Hill Ogre', 'battlefield', 'p2');
    const seen: { objects: string[]; text: string }[] = [];
    const s = cast(s0, 'Test Orc Instigator', { targets: [[obj(ogre)]], seen });
    expect(seen[0]!.objects).toContain(ogre);
    expect(controllerOf(s, ogre)).toBe('p1');
  });
  it('CR 611.2a, 514.2: the control change ends at end of turn', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Orc Instigator', { targets: [[obj(bear)]] });
    expect(controllerOf(s, bear)).toBe('p1');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', "p2's turn");
    expect(controllerOf(s, bear)).toBe('p2');
  });
});

// ---- Oft-Nabbed Goat: opponents steal it; when it dies with -1/-1 counters, its owner draws that many and each other player loses that much --------------------------

const GOAT = card('Test Restless Goat', 'Creature — Goat',
  '{1}: Draw a card. Gain control of this creature and put a -1/-1 counter on it. Only your opponents may activate this ability and only as a sorcery.\nWhen this creature dies, if it had one or more -1/-1 counters on it, its owner draws that many cards and each other player loses that much life.',
  { pt: ['0', '5'] });
const DOOM = card('Test Doom Rite', 'Sorcery', 'Destroy target creature.');

describe('CR 602.5, 108.3, 603.4, 603.10a, 102.1: "Only your opponents may activate this ability ... When this creature dies, if it had one or more -1/-1 counters on it, its owner draws that many cards and each other player loses that much life"', () => {
  const setup = (counters: number): GameState => mpScenario({
    defs: [GOAT, DOOM],
    zones: {
      p1: { battlefield: [{ name: 'Test Restless Goat', counters: counters > 0 ? { '-1/-1': counters } : {} }], hand: ['Test Doom Rite'] },
      p2: { battlefield: ['Plains', 'Plains'] },
    },
  });
  const lives = (s: GameState): number[] => s.players.map((p) => p.life);
  const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  it('is automated', () => expect(full(GOAT)).toBe(true));
  it('ruling 2025-11-17: its controller (the owner here) can\'t activate it; an opponent can, on their own turn, and gains control of it', () => {
    let s = setup(0);
    const goat = find(s, 'Test Restless Goat', 'battlefield', 'p1');
    expect(applyAction(s, { type: 'activate', player: 'p1', source: goat, ability: 'p:0:0' } as never).error).toBeDefined();
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's main phase");
    const h = hand(s, 'p2');
    s = settle(drive(act(s, { type: 'activate', player: 'p2', source: goat, ability: 'p:0:0' } as never)));
    expect(controllerOf(s, goat)).toBe('p2');
    expect(hand(s, 'p2')).toBe(h + 1);
    expect(s.objects[goat]!.counters?.['-1/-1']).toBe(1);
    // negative: now p2 controls it, so p2 is no longer an opponent of its controller; p1 is
    expect(applyAction(s, { type: 'activate', player: 'p2', source: goat, ability: 'p:0:0' } as never).error).toBeDefined();
  });
  it('CR 603.10a, 102.1: it dies under an opponent\'s control with five -1/-1 counters: its OWNER draws five, every other player (the controller too) loses 5, the owner loses nothing', () => {
    let s = setup(4);
    const goat = find(s, 'Test Restless Goat', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's main phase");
    const before = lives(s);
    const h1 = hand(s, 'p1');
    const h2 = hand(s, 'p2');
    s = settle(drive(act(s, { type: 'activate', player: 'p2', source: goat, ability: 'p:0:0' } as never)));
    expect(s.objects[goat]?.zone ?? 'gone').not.toBe('battlefield');
    expect(s.zones.graveyard.p1!.length).toBe(1); // its owner's graveyard
    expect(hand(s, 'p1')).toBe(h1 + 5);
    expect(hand(s, 'p2')).toBe(h2 + 1); // the activation's own draw only
    expect(lives(s)).toEqual([before[0]!, before[1]! - 5, before[2]! - 5, before[3]! - 5]);
  });
  it('negative (CR 603.4): with no -1/-1 counter on it as it dies, nothing happens', () => {
    const s0 = setup(0);
    const goat = find(s0, 'Test Restless Goat', 'battlefield', 'p1');
    const before = lives(s0);
    const h1 = hand(s0, 'p1');
    const s = cast(s0, 'Test Doom Rite', { targets: [[obj(goat)]] });
    expect(s.zones.graveyard.p1!.length).toBe(2);
    expect(hand(s, 'p1')).toBe(h1 - 1); // the Rite was cast; nothing drawn
    expect(lives(s)).toEqual(before);
  });
});

// ---- Admiral Beckett Brass: a player dealt combat damage by three or more Pirates this turn ---------------------------------------------------------------------------

const ADMIRAL = card('Test Pirate Admiral', 'Legendary Creature — Human Pirate',
  'Other Pirates you control get +1/+1.\nAt the beginning of your end step, gain control of target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn.',
  { pt: ['3', '3'] });
const DECKHAND = card('Test Deckhand', 'Creature — Human Pirate', '', { pt: ['1', '1'] });
const DUELIST = card('Test Twin-Blade Pirate', 'Creature — Human Pirate', 'Double strike', { pt: ['1', '1'] });
const RELIC = card('Test Brass Relic', 'Artifact', '');

describe('CR 510.2, 120.1, 400.7: "gain control of target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn"', () => {
  const setup = (attackers: string[]): GameState => mpScenario({
    defs: [ADMIRAL, DECKHAND, DUELIST, RELIC],
    zones: {
      p1: { battlefield: ['Test Pirate Admiral', ...attackers] },
      p2: { battlefield: ['Test Brass Relic', 'Plains'] },
      p3: { battlefield: ['Test Brass Relic'] },
    },
  });
  /** Attack: the creatures named go at the players given (in order), then on to p1's end step, where the trigger asks for its target. */
  const attackThenEnd = (s0: GameState, at: [string, PlayerId][]): { s: GameState; options: string[] } => {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    const ids = new Map<string, string[]>();
    const attacks = at.map(([name, d]) => {
      const all = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && s.defs[o.defId]!.name === name).map((o) => o.id).filter((id) => !(ids.get(name) ?? []).includes(id));
      ids.set(name, [...(ids.get(name) ?? []), all[0]!]);
      return { attacker: all[0]!, defender: d };
    });
    s = answer(s, { kind: 'declareAttackers', attacks });
    for (let guard = 0; guard < 300 && s.pending?.kind !== 'chooseTargets' && s.turn.activePlayer === 'p1'; guard++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    return { s, options: s.pending?.kind === 'chooseTargets' ? [...s.pending.objects] : [] };
  };
  it('is automated', () => expect(full(ADMIRAL)).toBe(true));
  it('three different Pirates hit p2: only p2\'s nonland permanents are legal (not p3\'s, hit by two; not a land); the control change lasts past the turn', () => {
    const s0 = setup(['Test Deckhand', 'Test Deckhand', 'Test Deckhand']);
    const relic2 = find(s0, 'Test Brass Relic', 'battlefield', 'p2');
    const { s: s1, options } = attackThenEnd(s0, [['Test Pirate Admiral', 'p2'], ['Test Deckhand', 'p2'], ['Test Deckhand', 'p2'], ['Test Deckhand', 'p3']]);
    expect(s1.turn.step).toBe('end');
    expect(options).toContain(relic2);
    expect(options).not.toContain(find(s0, 'Test Brass Relic', 'battlefield', 'p3'));
    expect(options).not.toContain(find(s0, 'Plains', 'battlefield', 'p2'));
    let s = settle(drive(s1, { targets: [[obj(relic2)]] }));
    expect(controllerOf(s, relic2)).toBe('p1');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', "p2's turn");
    expect(controllerOf(s, relic2)).toBe('p1'); // ruling 2017-09-29: indefinitely
  });
  it('negative (ruling 2017-09-29): a Pirate with double strike counts once: two Pirates, three hits, no legal target', () => {
    const s0 = setup(['Test Twin-Blade Pirate']);
    const { s, options } = attackThenEnd(s0, [['Test Pirate Admiral', 'p2'], ['Test Twin-Blade Pirate', 'p2']]);
    expect(options).toEqual([]);
    expect(s.turn.activePlayer === 'p1' ? s.zones.stack.length : 0).toBe(0);
    expect(controllerOf(s, find(s0, 'Test Brass Relic', 'battlefield', 'p2'))).toBe('p2');
  });
});

// ---- Hot Pursuit: suspect and goad while it stays; once two players have lost, take every goaded and/or suspected creature ------------------------------------------------

const PURSUIT = card('Test Hue and Cry', 'Enchantment',
  'When this enchantment enters, suspect target creature an opponent controls. As long as this enchantment remains on the battlefield, that creature is also goaded.\nAt the beginning of combat on your turn, if two or more players have lost the game, gain control of all goaded and/or suspected creatures until end of turn. Untap them. They gain haste until end of turn.');
const SCRUB = card('Test Scrub Away', 'Instant', 'Destroy target enchantment.');

describe('CR 701.60a-b, 701.15a-b, 611.2b, 104.3, 611.2c: "suspect target creature ... As long as this enchantment remains on the battlefield, that creature is also goaded ... if two or more players have lost the game, gain control of all goaded and/or suspected creatures"', () => {
  const setup = (): GameState => mpScenario({
    defs: [PURSUIT, BEAR, OGRE, SCRUB],
    zones: {
      p1: { hand: ['Test Hue and Cry', 'Test Scrub Away'] },
      p2: { battlefield: [{ name: 'Test Field Bear', tapped: true }, 'Test Hill Ogre'] },
      p3: { battlefield: ['Test Hill Ogre'] },
    },
  });
  const suspected = (s: GameState, id: ObjectId): boolean => typeof s.objects[id]?.suspected === 'number';
  it('is automated', () => expect(full(PURSUIT)).toBe(true));
  it('CR 701.60b, 701.15b: the target is suspected (menace, can\'t block) and goaded by you while the enchantment stays; once it leaves, still suspected, no longer goaded (ruling 2024-02-02)', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Hue and Cry', { targets: [[obj(bear)]] });
    expect(suspected(s, bear)).toBe(true);
    expect(hasKeyword(getChars(s, bear), 'menace')).toBe(true);
    expect(staticGoadersOf(s, bear)).toEqual(['p1']);
    const pursuit = find(s, 'Test Hue and Cry', 'battlefield', 'p1');
    s = cast(s, 'Test Scrub Away', { targets: [[obj(pursuit)]] });
    expect(staticGoadersOf(s, bear)).toEqual([]);
    expect(suspected(s, bear)).toBe(true);
  });
  it('CR 104.3, 611.2c: with two players lost, at your beginning of combat you gain control of every goaded and/or suspected creature, untapped and hasty; only those', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Hue and Cry', { targets: [[obj(bear)]] });
    s = concede(s, 'p3').state;
    s = concede(s, 'p4').state;
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'beginCombat' && x.zones.stack.length > 0, "p1's next beginning of combat, the trigger on the stack");
    s = settle(s);
    expect(controllerOf(s, bear)).toBe('p1');
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(hasKeyword(getChars(s, bear), 'haste')).toBe(true);
    expect(controllerOf(s, find(s0, 'Test Hill Ogre', 'battlefield', 'p2'))).toBe('p2'); // neither goaded nor suspected
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', "p2's turn");
    expect(controllerOf(s, bear)).toBe('p2'); // until end of turn
  });
  it('negative (CR 603.4): with one player lost, nothing changes control', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Hue and Cry', { targets: [[obj(bear)]] });
    s = concede(s, 'p4').state;
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'main1', "p1's next main phase");
    expect(controllerOf(s, bear)).toBe('p2');
  });
});

// ---- Sudden Substitution: exchange control of a spell and a creature, then the spell's (new) controller may choose new targets ----------------------------------------

const SUBSTITUTION = card('Test Swift Switch', 'Instant',
  "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nExchange control of target noncreature spell and target creature. Then the spell's controller may choose new targets for it.",
  { cost: '{0}' });
const HEX_BOLT = card('Test Hex Bolt', 'Instant', 'This spell deals 3 damage to any target.');

describe('CR 701.12a-b, 115.7d, 702.61a: "Exchange control of target noncreature spell and target creature. Then the spell\'s controller may choose new targets for it."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SUBSTITUTION, HEX_BOLT, BEAR],
    zones: {
      p1: { hand: ['Test Swift Switch', 'Test Hex Bolt'], battlefield: ['Test Field Bear'] },
      p2: { hand: ['Test Hex Bolt'], battlefield: ['Test Field Bear'] },
    },
  });
  const pl = (p: PlayerId): TargetChoice => ({ kind: 'player', id: p }) as TargetChoice;
  it('is automated', () => expect(full(SUBSTITUTION)).toBe(true));
  it('an opponent\'s spell aimed at you: you gain control of it (they get your creature) and you choose a new target for it: the damage goes to them', () => {
    let s = setup();
    const myBear = find(s, 'Test Field Bear', 'battlefield', 'p1');
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hex Bolt', 'hand', 'p2') }), { targets: [[pl('p1')]] });
    const bolt = s.zones.stack[s.zones.stack.length - 1]!;
    const life = s.players.map((p) => p.life);
    for (let guard = 0; guard < 4 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); guard++) s = act(s, { type: 'pass', player: s.pending!.player }); // CR 117.3c: the caster first
    expect(s.zones.stack).toContain(bolt);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Swift Switch', 'hand', 'p1') }), { targets: [[obj(bolt)], [obj(myBear)]] });
    // the substitution resolves first: the yes/no to choose new targets, then the new target (p2)
    s = settle(s, { yes: [true], targets: [[pl('p2')]] });
    expect(controllerOf(s, myBear)).toBe('p2');
    expect(s.players.map((p) => p.life)).toEqual([life[0], life[1]! - 3, life[2], life[3]]);
  });
  it('negative (CR 701.12b; ruling 2019-08-23): your own spell and your own creature are not exchanged, but you may still choose new targets', () => {
    let s = setup();
    const myBear = find(s, 'Test Field Bear', 'battlefield', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hex Bolt', 'hand', 'p1') }), { targets: [[pl('p3')]] });
    const bolt = s.zones.stack[s.zones.stack.length - 1]!;
    const life = s.players.map((p) => p.life);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Swift Switch', 'hand', 'p1') }), { targets: [[obj(bolt)], [obj(myBear)]] });
    s = settle(s, { yes: [true], targets: [[pl('p4')]] });
    expect(controllerOf(s, myBear)).toBe('p1');
    expect(s.players.map((p) => p.life)).toEqual([life[0], life[1], life[2], life[3]! - 3]);
  });
  it('CR 702.61a: while it is on the stack, no player can cast a spell', () => {
    let s = setup();
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hex Bolt', 'hand', 'p1') }), { targets: [[pl('p3')]] });
    const bolt = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Swift Switch', 'hand', 'p1') }), { targets: [[obj(bolt)], [obj(find(s, 'Test Field Bear', 'battlefield', 'p2'))]] });
    s = act(s, { type: 'pass', player: 'p1' });
    expect(applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hex Bolt', 'hand', 'p2') }).error).toBeDefined();
  });
});

// ---- Confusion in the Ranks: the entering permanent's controller chooses a permanent of another player sharing a card type; the two are exchanged ---------------------------

const CONFUSION = card('Test Muddled Ranks', 'Enchantment',
  'Whenever an artifact, creature, or enchantment enters, its controller chooses target permanent another player controls that shares a card type with it. Exchange control of those permanents.');
const SHRINE = card('Test Quiet Shrine', 'Enchantment', '');

describe('CR 603.3d, 601.2c, 701.12a, 205.2a: "its controller chooses target permanent another player controls that shares a card type with it. Exchange control of those permanents."', () => {
  const setup = (): GameState => mpScenario({
    defs: [CONFUSION, BEAR, OGRE, SHRINE, RELIC],
    zones: {
      p1: { hand: ['Test Muddled Ranks', 'Test Field Bear'], battlefield: ['Test Hill Ogre'] },
      p2: { hand: ['Test Field Bear'], battlefield: ['Test Hill Ogre', 'Test Quiet Shrine', 'Plains'] },
      p3: { battlefield: ['Test Brass Relic'] },
    },
  });
  it('is automated', () => expect(full(CONFUSION)).toBe(true));
  it('ruling 2004-12-01: it triggers on itself: you choose an enchantment of another player and the two are exchanged', () => {
    const s0 = setup();
    const shrine = find(s0, 'Test Quiet Shrine', 'battlefield', 'p2');
    const seen: { objects: string[]; text: string }[] = [];
    const s = cast(s0, 'Test Muddled Ranks', { targets: [[obj(shrine)]], seen });
    expect(seen[0]!.objects).toEqual([shrine]); // the one enchantment another player controls
    const ranks = find(s, 'Test Muddled Ranks', 'battlefield', 'p1'); // owned by p1
    expect(controllerOf(s, ranks)).toBe('p2');
    expect(controllerOf(s, shrine)).toBe('p1');
  });
  it('CR 603.3d: an opponent\'s creature enters: THAT player chooses (never their own permanents), a creature of another player; the exchange happens', () => {
    const s0 = setup();
    let s = cast(s0, 'Test Muddled Ranks', { targets: [[obj(find(s0, 'Test Quiet Shrine', 'battlefield', 'p2'))]] });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's main phase");
    const myOgre = find(s, 'Test Hill Ogre', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Field Bear', 'hand', 'p2') });
    for (let guard = 0; guard < 20 && s.pending?.kind !== 'chooseTargets'; guard++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(s.pending!.player).toBe('p2');
    const p = s.pending as { objects: string[] };
    expect(p.objects).toContain(myOgre);
    expect(p.objects).not.toContain(find(s, 'Test Hill Ogre', 'battlefield', 'p2')); // their own
    expect(p.objects).not.toContain(find(s, 'Test Brass Relic', 'battlefield', 'p3')); // no shared card type
    const bear2 = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.owner === 'p2' && s.defs[o.defId]!.name === 'Test Field Bear')!.id;
    s = settle(answer(s, { kind: 'chooseTargets', targets: [obj(myOgre)] }));
    expect(controllerOf(s, myOgre)).toBe('p2');
    expect(controllerOf(s, bear2)).toBe('p1');
  });
  it('negative (CR 603.3d): with no permanent of another player sharing a card type, the ability is removed and nothing is exchanged', () => {
    const s0 = mpScenario({ defs: [CONFUSION, RELIC], zones: { p1: { hand: ['Test Muddled Ranks'] }, p2: { battlefield: ['Test Brass Relic'] } } });
    const seen: { objects: string[]; text: string }[] = [];
    const s = cast(s0, 'Test Muddled Ranks', { seen });
    expect(seen).toEqual([]);
    expect(controllerOf(s, find(s, 'Test Muddled Ranks', 'battlefield', 'p1'))).toBe('p1');
  });
});

// ---- Midnight Crusader Shuttle: villainous choice, sacrifice a creature or the attacker's controller takes one, tapped and attacking that player ------------------------

const SHUTTLE = card('Test Night Shuttle', 'Artifact Creature — Vehicle',
  "Whenever this Vehicle attacks, defending player faces a villainous choice — That player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn. If you gain control of a creature this way, tap it, and it's attacking that player.\nCrew 2",
  { pt: ['3', '3'] });

describe('CR 701.55a-b, 508.4, 613.1b: "defending player faces a villainous choice -- That player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn. If you gain control of a creature this way, tap it, and it\'s attacking that player."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SHUTTLE, BEAR, OGRE],
    zones: { p1: { battlefield: ['Test Night Shuttle'] }, p2: { battlefield: ['Test Field Bear', 'Test Hill Ogre'] }, p3: { battlefield: ['Test Field Bear'] } },
  });
  const attack = (first: boolean): GameState => {
    let s = passUntil(setup(), (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Night Shuttle', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'yesNo'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending?.kind === 'yesNo' && s.pending.player).toBe('p2'); // the defending player chooses (CR 701.55a)
    return drive(answer(s, { kind: 'yesNo', yes: first }), { pick: (o) => [o.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Hill Ogre') ?? o[0]!] });
  };
  it('is automated', () => expect(full(SHUTTLE)).toBe(true));
  it('second option: you take the creature you choose of that player\'s; it is tapped and attacking that player (never declared), for the turn', () => {
    const s0 = setup();
    const ogre = find(s0, 'Test Hill Ogre', 'battlefield', 'p2');
    let s = attack(false);
    expect(controllerOf(s, ogre)).toBe('p1');
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(s.combat?.attackers.find((a) => a.id === ogre)?.defender).toBe('p2');
    const life2 = s.players.find((p) => p.id === 'p2')!.life;
    s = passUntil(s, (x) => x.turn.step === 'main2' || x.turn.step === 'end', 'after combat');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life2 - 6); // the Shuttle (3) and the Ogre (3)
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', "p2's turn");
    expect(controllerOf(s, ogre)).toBe('p2');
  });
  it('first option: that player sacrifices a creature of their choice; nobody changes control', () => {
    const s0 = setup();
    const ogre = find(s0, 'Test Hill Ogre', 'battlefield', 'p2');
    const s = attack(true);
    expect(s.objects[ogre]?.zone === 'battlefield' ? 1 : 0).toBe(0);
    expect(s.zones.graveyard.p2!.length).toBe(1);
    expect(controllerOf(s, find(s, 'Test Field Bear', 'battlefield', 'p2'))).toBe('p2');
  });
});

// ---- The Horus Heresy: steal one creature of each opponent while the Saga stays; draw for them; each player in turn chooses a creature to destroy ---------------------

const HERESY = card('Test Great Betrayal', 'Enchantment — Saga',
  "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — For each opponent, gain control of up to one target nonlegendary creature that player controls for as long as this Saga remains on the battlefield.\nII — Draw a card for each creature you control but don't own.\nIII — Starting with you, each player chooses a creature. Destroy each creature chosen this way.");

describe('CR 714.2, 611.2b, 101.4, 608.2d: The Horus Heresy\'s three chapters', () => {
  it('is automated', () => expect(full(HERESY)).toBe(true));
  it('I: up to one target nonlegendary creature of EACH opponent (not two of one, not a legendary one) is yours while the Saga stays; II: a card for each of them', () => {
    const s0 = mpScenario({
      defs: [HERESY, BEAR, OGRE, LORD],
      zones: { p1: { hand: ['Test Great Betrayal'], battlefield: ['Test Field Bear'] }, p2: { battlefield: ['Test Field Bear', 'Test Hill Ogre', 'Test Small Lord'] }, p3: { battlefield: ['Test Hill Ogre'] } },
    });
    const bear2 = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    const ogre3 = find(s0, 'Test Hill Ogre', 'battlefield', 'p3');
    const seen: { objects: string[]; text: string }[] = [];
    let s = cast(s0, 'Test Great Betrayal', { targets: [[obj(bear2), obj(ogre3)]], seen });
    expect(seen[0]!.objects).not.toContain(find(s0, 'Test Small Lord', 'battlefield', 'p2'));
    expect(seen[0]!.objects).not.toContain(find(s0, 'Test Field Bear', 'battlefield', 'p1'));
    expect(controllerOf(s, bear2)).toBe('p1');
    expect(controllerOf(s, ogre3)).toBe('p1');
    const hand = s.zones.hand.p1!.length;
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'main1' && x.zones.stack.length > 0, 'chapter II on the stack');
    s = settle(s);
    expect(s.zones.hand.p1!.length).toBe(hand + 1 /* draw step */ + 2 /* the two creatures you control but don't own */);
    expect(controllerOf(s, bear2)).toBe('p1'); // still on the battlefield
  });
  it('III: starting with you, each player in turn chooses a creature (any player\'s); each one chosen is destroyed; then the Saga is sacrificed', () => {
    const s0 = mpScenario({
      defs: [HERESY, BEAR, OGRE],
      zones: { p1: { battlefield: [{ name: 'Test Great Betrayal', counters: { lore: 2 } }, 'Test Field Bear'] }, p2: { battlefield: ['Test Hill Ogre', 'Test Field Bear'] }, p3: { battlefield: ['Test Hill Ogre'] } },
    });
    // the Saga's third lore counter is put on it in your first precombat main phase (CR 714.3c), so chapter III is on the stack already
    let s = s0;
    expect(s.zones.stack.length > 0 || s.pending?.kind === 'chooseObjects').toBe(true);
    const order: string[] = [];
    const ogre2 = find(s0, 'Test Hill Ogre', 'battlefield', 'p2');
    const bear1 = find(s0, 'Test Field Bear', 'battlefield', 'p1');
    for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) {
      const p = s.pending!;
      if (p.kind === 'chooseObjects') {
        order.push(p.player);
        // p1 and p2 both pick p2's Ogre (a creature may be chosen again), p3 and p4 pick p1's Bear
        const want = p.player === 'p1' || p.player === 'p2' ? ogre2 : bear1;
        s = answer(s, { kind: 'chooseObjects', ids: [p.options.includes(want) ? want : p.options[0]!] });
      } else if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else s = drive(s);
    }
    expect(order).toEqual(['p1', 'p2', 'p3', 'p4']); // CR 101.4: starting with you, in turn order
    expect(s.objects[ogre2]?.zone === 'battlefield').toBe(false);
    expect(s.objects[bear1]?.zone === 'battlefield').toBe(false);
    expect(find(s, 'Test Field Bear', 'battlefield', 'p2')).toBeDefined(); // not chosen
    expect(find(s, 'Test Hill Ogre', 'battlefield', 'p3')).toBeDefined();
    expect(Object.values(s.objects).some((o) => o.zone === 'battlefield' && s.defs[o.defId]!.name === 'Test Great Betrayal')).toBe(false); // CR 714.4: sacrificed after III
  });
});

// ---- Swooping Pteranodon: steal, untap, flying and haste; at the next end step a target land (chosen then) deals 3 damage to it -------------------------------------

const PTERANODON = card('Test Diving Wing', 'Creature — Dinosaur',
  'Flying, haste\nWhenever this creature or another Dinosaur you control with flying enters, gain control of target creature an opponent controls until end of turn. Untap that creature. It gains flying and haste until end of turn. At the beginning of the next end step, target land deals 3 damage to that creature.',
  { pt: ['2', '2'] });
const WALKER = card('Test Ground Dinosaur', 'Creature — Dinosaur', '', { pt: ['4', '4'] });

describe('CR 603.7, 603.3d, 613.1b: "... gain control of target creature an opponent controls until end of turn ... At the beginning of the next end step, target land deals 3 damage to that creature."', () => {
  const setup = (): GameState => mpScenario({
    defs: [PTERANODON, WALKER, OGRE],
    zones: { p1: { hand: ['Test Diving Wing', 'Test Ground Dinosaur'] }, p2: { battlefield: [{ name: 'Test Hill Ogre', tapped: true }, 'Plains'] } },
  });
  it('is automated', () => expect(full(PTERANODON)).toBe(true));
  it('the stolen creature is untapped with flying and haste; at the next end step the land is chosen THEN and deals 3 damage to that creature (it dies)', () => {
    const s0 = setup();
    const ogre = find(s0, 'Test Hill Ogre', 'battlefield', 'p2');
    const seen: { objects: string[]; text: string }[] = [];
    let s = cast(s0, 'Test Diving Wing', { targets: [[obj(ogre)]], seen });
    expect(seen.length).toBe(1); // only the creature: no land is asked for now
    expect(controllerOf(s, ogre)).toBe('p1');
    expect(s.objects[ogre]!.tapped).toBe(false);
    expect(hasKeyword(getChars(s, ogre), 'flying') && hasKeyword(getChars(s, ogre), 'haste')).toBe(true);
    s = passUntil(s, (x) => x.pending?.kind === 'chooseTargets' || x.turn.activePlayer !== 'p1', 'the end step trigger');
    expect(s.turn.step).toBe('end');
    expect((s.pending as { objects: string[] }).objects).toContain(find(s, 'Plains', 'battlefield', 'p2'));
    s = settle(answer(s, { kind: 'chooseTargets', targets: [obj(find(s, 'Plains', 'battlefield', 'p2'))] }));
    expect(s.objects[ogre]?.zone === 'battlefield').toBe(false);
    expect(s.zones.graveyard.p2!.length).toBe(1);
  });
  it('negative: another Dinosaur WITHOUT flying entering does not trigger it', () => {
    let s = cast(setup(), 'Test Diving Wing', { targets: [[obj(find(setup(), 'Test Hill Ogre', 'battlefield', 'p2'))]] });
    const seen: { objects: string[]; text: string }[] = [];
    s = cast(s, 'Test Ground Dinosaur', { seen });
    expect(seen).toEqual([]);
  });
});

// ---- Elrond of the White Council: secret votes; each fellowship voter gives you a creature (it can't attack its owner); a +1/+1 counter on each of yours per aid vote ----

const ELROND = card('Test Council Elder', 'Legendary Creature — Elf Noble',
  'Secret council — When this creature enters, each player secretly votes for fellowship or aid, then those votes are revealed. For each fellowship vote, the voter chooses a creature they control. You gain control of each creature chosen this way, and they gain "This creature can\'t attack its owner." Then for each aid vote, put a +1/+1 counter on each creature you control.',
  { pt: ['3', '3'] });

describe('CR 701.38a, 701.38d, 608.2f, 613.1b, 508.1c: Elrond of the White Council\'s secret council', () => {
  const setup = (): GameState => mpScenario({
    defs: [ELROND, BEAR, OGRE],
    zones: { p1: { hand: ['Test Council Elder'] }, p2: { battlefield: ['Test Field Bear'] }, p3: { battlefield: ['Test Hill Ogre'] }, p4: { battlefield: ['Test Field Bear'] } },
  });
  const votes: Record<string, string> = { p1: 'aid', p2: 'fellowship', p3: 'fellowship', p4: 'aid' };
  const play = (): GameState => {
    let s = act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Council Elder', 'hand', 'p1') });
    for (let guard = 0; guard < 120 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) {
      const p = s.pending!;
      if (p.kind === 'chooseOption') {
        const want = p.options.find((o) => o.label.toLowerCase().includes(votes[p.player]!)) ?? p.options[0]!;
        s = answer(s, { kind: 'chooseOption', ids: [want.id] });
      } else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [p.options[0]!] });
      else if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else s = drive(s);
    }
    return s;
  };
  it('is automated', () => expect(full(ELROND)).toBe(true));
  it('two fellowship voters each give you one of their creatures, for good; two aid votes put two +1/+1 counters on each creature you control (the new ones too)', () => {
    const s0 = setup();
    const s = play();
    const bear2 = find(s0, 'Test Field Bear', 'battlefield', 'p2');
    const ogre3 = find(s0, 'Test Hill Ogre', 'battlefield', 'p3');
    expect(controllerOf(s, bear2)).toBe('p1');
    expect(controllerOf(s, ogre3)).toBe('p1');
    expect(controllerOf(s, find(s0, 'Test Field Bear', 'battlefield', 'p4'))).toBe('p4'); // an aid voter keeps theirs
    const elder = find(s, 'Test Council Elder', 'battlefield', 'p1');
    for (const id of [elder, bear2, ogre3]) expect(s.objects[id]!.counters?.['+1/+1'], id).toBe(2);
    expect(s.objects[find(s0, 'Test Field Bear', 'battlefield', 'p4')]!.counters?.['+1/+1'] ?? 0).toBe(0);
  });
  it('CR 508.1c, 108.3: the creature can\'t attack its owner, but may attack another player', () => {
    let s = play();
    const bear2 = find(setup(), 'Test Field Bear', 'battlefield', 'p2');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.pending?.kind === 'declareAttackers', "p1's next attack");
    const refused = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear2, defender: 'p2' }] } } as never);
    expect(refused.error?.message ?? '').toMatch(/attack/i);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear2, defender: 'p3' }] });
    expect(s.combat?.attackers.some((a) => a.id === bear2 && a.defender === 'p3')).toBe(true);
  });
});
