/**
 * audit-fix-1 (the audit of 2026-10-21, archive docs/coordination/audit-2026-10-21.md): three automations that played differently from their Oracle text,
 * each reproduced here with synthetic cards (invented names, design 6.10) compiled by the game's default compiler, then played through the engine. Each test is
 * named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 609.7a, 113.7a,    "a source of your choice" (New Way Forward, the Circle of Protection cycles, Righteous Aura): an ability on the stack stands for its
 *   400.7                 source, even after that source left the battlefield (a creature's dies trigger or sacrifice ability), a chosen permanent spell also
 *                         for the permanent it becomes, and the command zone's face-up objects are offered (effects/replacements.ts#standsForSource)
 *   CR 701.21a, 608.2h,   "Each player sacrifices ... If you sacrificed a permanent this way, you may return another permanent card from your graveyard to your
 *   400.7                 hand." (Deadly Brew): "another" leaves out only the permanent YOU sacrificed, not a card of yours another player sacrificed
 *                         (`{ref:'bound', which}`, effects/refs.ts)
 *   CR 107.3b, 118.9      "pay life equal to its mana value rather than pay its mana cost" (Gwenom, Remorseless; Valgavoth): the alternative cost has no {X}, so
 *                         X is 0 (statics/play-permits.ts#lifeCostOf)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer the decisions that come up until a player has priority (from the script in order, else the fewest allowed; yes to an option). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Resolve the stack, answering with one shared script (its queues are consumed across the resolutions). */
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  const shared: Script = { targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) {
    s = passBoth(s);
    for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: shared.objects!.shift() ?? p.options.slice(0, p.min) });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: shared.targets!.shift() ?? [] });
      else s = drive(s);
    }
  }
  return s;
};
const ofDef = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const inZone = (s: GameState, zone: 'hand' | 'graveyard', p: string, name: string): ObjectId[] => s.zones[zone][p]!.filter((id) => s.objects[id]!.defId === name);
const P1: TargetChoice = { kind: 'player', id: 'p1' };
const handOf = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
/** p1 casts the instant (it needs no target), then answers its source choice with the option `pick` selects, and the stack resolves down to `rest` objects. */
function castShield(s0: GameState, name: string, pick: (s: GameState, options: ObjectId[]) => ObjectId | undefined): { s: GameState; offered: ObjectId[] } {
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  const below = s.zones.stack.length - 1;
  let offered: ObjectId[] = [];
  for (let guard = 0; guard < 20 && s.zones.stack.length > below; guard++) {
    s = passBoth(s);
    if (s.pending?.kind === 'chooseObjects' && s.pending.player === 'p1') {
      offered = [...s.pending.options];
      const id = pick(s, offered);
      s = drive(answer(s, { kind: 'chooseObjects', ids: id === undefined ? offered.slice(0, 1) : [id] }));
    } else s = drive(s);
  }
  return { s, offered };
}
const abilityOn = (s: GameState): ObjectId | undefined => s.zones.stack.find((id) => s.objects[id]!.kind === 'ability');

// ---- New Way Forward: the source of your choice -------------------------------------------------------------------------------------------------------

describe('CR 609.7a, 113.7a, 400.7: a source of your choice is also the object an ability on the stack refers to, and the permanent a chosen permanent spell becomes', () => {
  const REBUKE = card('Test Mirror Rebuke', 'Instant', "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, Test Mirror Rebuke deals that much damage to that source's controller and you draw that many cards.");
  const FANATIC = card('Test Spark Zealot', 'Creature — Goblin', 'Sacrifice this creature: It deals 2 damage to any target.', ['1', '1']);
  const MYR = card('Test Ember Husk', 'Artifact Creature — Construct', 'When this creature dies, it deals 2 damage to any target.', ['1', '1']);
  const TITAN = card('Test Blaze Colossus', 'Creature — Giant', 'When this creature enters, it deals 3 damage to any target.', ['6', '6']);
  const SLAY = card('Test Quick End', 'Instant', 'Destroy target creature.');
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  const CIRCLE = card('Test Ruby Circle', 'Enchantment', '{0}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.');
  const REDZEAL = card('Test Red Zealot', 'Creature — Goblin', 'Sacrifice this creature: It deals 2 damage to any target.', ['1', '1'], '{R}', ['R']);
  const PUP = card('Test Red Pup', 'Creature — Dog', '', ['1', '1'], '{R}', ['R']);
  const defs = [REBUKE, FANATIC, MYR, TITAN, SLAY, MOTE, CIRCLE, REDZEAL, PUP];
  const library = ['Test Dust Mote', 'Test Dust Mote', 'Test Dust Mote', 'Test Dust Mote'];

  it('the synthetic cards are automated', () => {
    for (const d of defs) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
    expect(JSON.stringify(REBUKE.faces)).toContain('"zone":["battlefield","stack","command"]');
  });

  /** p2 sacrifices its Zealot (the ability targets p1), then p1 has priority with the ability on the stack. */
  const sacrificed = (zealot = 'Test Spark Zealot', p1: { hand?: string[]; battlefield?: string[] } = { hand: ['Test Mirror Rebuke'] }): GameState => {
    let s = advanceTo(scenario([], { defs, p1: { ...p1, library }, p2: { battlefield: [zealot, 'Test Spark Zealot'] } }), 1, 'main1');
    const z = ofDef(s, zealot)[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'activate', player: 'p2', source: z, ability: 'p:0:0' }), { targets: [[P1]] });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind === 'priority' && s.pending.player).toBe('p1');
    expect(s.objects[z], 'the Zealot was sacrificed as a cost').toBeUndefined();
    return s;
  };

  it('a sacrificed creature\'s damage ability on the stack: choosing it prevents the damage of the creature, now gone (Mogg Fanatic)', () => {
    const s0 = sacrificed();
    const hand = handOf(s0);
    const ability = abilityOn(s0)!;
    const { s: s1, offered } = castShield(s0, 'Test Mirror Rebuke', () => ability);
    expect(offered).toContain(ability);
    const s = resolveAll(s1);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(18); // the reflexive trigger: that much damage to the source's controller
    expect(handOf(s)).toBe(hand - 1 + 2);
  });

  it('the negative case: another source chosen (the other Zealot on the battlefield), the 2 damage is dealt and nothing triggers', () => {
    const s0 = sacrificed();
    const hand = handOf(s0);
    const other = ofDef(s0, 'Test Spark Zealot')[0]!;
    const { s: s1 } = castShield(s0, 'Test Mirror Rebuke', () => other);
    const s = resolveAll(s1);
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(20);
    expect(handOf(s)).toBe(hand - 1);
  });

  it('a creature\'s dies trigger on the stack: choosing it prevents the damage of the creature that died (Perilous Myr)', () => {
    let s = advanceTo(scenario([], { defs, p1: { hand: ['Test Quick End', 'Test Mirror Rebuke'], library }, p2: { battlefield: ['Test Ember Husk'] } }), 1, 'main1');
    const husk = ofDef(s, 'Test Ember Husk')[0]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick End', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: husk }]] });
    // the kill resolves; the dies trigger (p2's) targets p1
    for (let guard = 0; guard < 10 && abilityOn(s) === undefined; guard++) s = drive(passBoth(s), { targets: [[P1]] });
    const trigger = abilityOn(s)!;
    expect(trigger, 'the dies trigger is on the stack').toBeDefined();
    for (let guard = 0; guard < 6 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    const hand = handOf(s);
    const { s: s1, offered } = castShield(s, 'Test Mirror Rebuke', () => trigger);
    expect(offered).toContain(trigger);
    s = resolveAll(s1);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(18);
    expect(handOf(s)).toBe(hand - 1 + 2);
  });

  it('a creature spell chosen on the stack: the enters trigger of the permanent it becomes is prevented; a second source is not (CR 609.7a, 400.7)', () => {
    let s = advanceTo(scenario([], { defs, p1: { hand: ['Test Mirror Rebuke'], library }, p2: { hand: ['Test Blaze Colossus'], battlefield: ['Test Spark Zealot'] } }), 2, 'main1');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Blaze Colossus', 'hand', 'p2') }));
    const spell = s.zones.stack.find((id) => s.objects[id]!.defId === 'Test Blaze Colossus')!;
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind === 'priority' && s.pending.player).toBe('p1');
    const hand = handOf(s);
    const { s: s1, offered } = castShield(s, 'Test Mirror Rebuke', () => spell);
    expect(offered).toContain(spell);
    s = resolveAll(s1, { targets: [[P1]] });
    expect(ofDef(s, 'Test Blaze Colossus').length).toBe(1);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(17);
    expect(handOf(s)).toBe(hand - 1 + 3);
    // the negative case: the shield was used up and the Zealot is another source
    const z = ofDef(s, 'Test Spark Zealot')[0]!;
    s = drive(act(s, { type: 'activate', player: 'p2', source: z, ability: 'p:0:0' }), { targets: [[P1]] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(18);
  });

  it('a red source of your choice (the Circle cycle): the sacrificed red creature\'s ability stands for it; the colorless Zealot\'s is not offered', () => {
    const s0 = sacrificed('Test Red Zealot', { battlefield: ['Test Ruby Circle', 'Test Red Pup'] });
    const circle = ofDef(s0, 'Test Ruby Circle')[0]!;
    const ability = abilityOn(s0)!;
    let s = drive(act(s0, { type: 'activate', player: 'p1', source: circle, ability: 'p:0:0' }));
    let offered: ObjectId[] = [];
    for (let guard = 0; guard < 10 && s.zones.stack.length > 1; guard++) {
      s = passBoth(s);
      if (s.pending?.kind === 'chooseObjects' && s.pending.player === 'p1') {
        offered = [...s.pending.options];
        s = drive(answer(s, { kind: 'chooseObjects', ids: [ability] }));
      } else s = drive(s);
    }
    expect(offered).toContain(ability);
    expect(offered).toContain(ofDef(s0, 'Test Red Pup')[0]!);
    expect(offered.some((id) => s0.objects[id]?.defId === 'Test Spark Zealot')).toBe(false); // colorless: neither the permanent nor (were it on the stack) its ability
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---- Deadly Brew: "another" is other than what you sacrificed --------------------------------------------------------------------------------------

describe('CR 701.21a, 608.2h, 400.7: "another permanent card" after each player\'s sacrifice leaves out only the permanent you sacrificed', () => {
  const BREW = card('Test Grave Tonic', 'Sorcery', 'Each player sacrifices a creature of their choice. If you sacrificed a permanent this way, you may return another permanent card from your graveyard to your hand.');
  const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
  const WOLF = card('Test Gray Wolf', 'Creature — Wolf', '', ['2', '2']);
  const ELK = card('Test Old Elk', 'Creature — Elk', '', ['2', '2']);
  const GRAB = card('Test Mind Grab', 'Sorcery', 'Gain control of target creature.');
  const defs = [BREW, BEAR, WOLF, ELK, GRAB];

  it('is automated, the exclusion reading only what you controlled as it was sacrificed', () => {
    for (const d of defs) expect(full(d), d.name).toBe(true);
    expect(JSON.stringify(BREW.faces)).toContain('"not":{"is":{"ref":"bound","name":"sacrificed","which":{"controller":"you"}}}');
  });

  /**
   * p1 owns a Wolf the opponent stole on its turn (its only creature), controls a Bear and has an Elk card in its graveyard; on p1's next turn Tonic is cast and
   * p1 sacrifices the Bear, the opponent the Wolf, which goes to its owner's graveyard (CR 400.3).
   */
  const brew = (): { s: GameState; offered: string[] } => {
    let s = scenario([], { defs, p1: { hand: ['Test Grave Tonic'], battlefield: ['Test Brown Bear', 'Test Gray Wolf'], graveyard: ['Test Old Elk'] }, p2: { hand: ['Test Mind Grab'] } });
    const wolf = ofDef(s, 'Test Gray Wolf')[0]!;
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Mind Grab', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: wolf }]] }));
    expect(s.objects[wolf]?.controller, 'the Wolf is stolen').toBe('p2');
    s = advanceTo(s, 3, 'main1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Tonic', 'hand', 'p1') }));
    s = passBoth(s);
    let offered: string[] = [];
    for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects' && p.player === 'p1' && p.options.some((id) => s.zones.graveyard.p1!.includes(id))) {
        offered = p.options.map((id) => s.objects[id]!.defId).sort();
        s = answer(s, { kind: 'chooseObjects', ids: p.options.filter((id) => s.objects[id]!.defId === 'Test Gray Wolf') });
      } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true }); // one decision at a time, so the return's choice is seen
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else s = drive(s);
    }
    return { s, offered };
  };

  it('your creature card that the opponent sacrificed (it went to your graveyard) can be returned', () => {
    const { s, offered } = brew();
    expect(inZone(s, 'graveyard', 'p1', 'Test Brown Bear').length).toBe(1);
    expect(offered).toEqual(['Test Gray Wolf', 'Test Old Elk']);
    expect(inZone(s, 'hand', 'p1', 'Test Gray Wolf').length).toBe(1);
  });

  it('the negative case: the Bear you sacrificed is never offered', () => {
    const { s, offered } = brew();
    expect(offered).not.toContain('Test Brown Bear');
    expect(inZone(s, 'hand', 'p1', 'Test Brown Bear').length).toBe(0);
  });

  it('fail closed: "another" after a sacrifice by an opponent alone is not read (manual)', () => {
    const ODD = card('Test Odd Tonic', 'Sorcery', 'Target opponent sacrifices a creature of their choice. You may return another creature card from your graveyard to your hand.');
    expect(full(ODD)).toBe(false);
  });
});

// ---- Gwenom: X is 0 when the alternative cost has no {X} ---------------------------------------------------------------------------------------------

describe('CR 107.3b, 118.9: a spell cast for "life equal to its mana value rather than its mana cost" has X = 0', () => {
  const DRIFT = card('Test Tide Reverie', 'Sorcery', 'Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.');
  const FLOOD = card('Test Draw Flood', 'Sorcery', 'Draw X cards.', undefined, '{X}{U}{U}');
  const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
  const defs = [DRIFT, FLOOD, CUB];
  const start = (top: string): GameState => {
    const s = scenario([], { defs, p1: { hand: ['Test Tide Reverie'], library: [top, 'Test Cub', 'Test Cub', 'Test Cub'] } });
    return resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tide Reverie', 'hand', 'p1') }));
  };

  it('the X spell on top is cast with no X announced, for life equal to its mana value with X = 0, and draws no card', () => {
    let s = start('Test Draw Flood');
    const top = s.zones.library.p1![0]!;
    const casts = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === top);
    expect(casts.length).toBe(1);
    const [before, hand] = [life(s, 'p1'), handOf(s)];
    s = act(s, casts[0]!.action);
    expect(s.pending?.kind).not.toBe('chooseNumber');
    s = resolveAll(drive(s));
    expect(life(s, 'p1')).toBe(before - 2); // {0}{U}{U}: mana value 2
    expect(handOf(s)).toBe(hand);
  });

  it('the negative case: a spell with no X costs its whole mana value in life', () => {
    let s = start('Test Cub');
    const before = life(s, 'p1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.library.p1![0]! })));
    expect(life(s, 'p1')).toBe(before - 2);
    expect(ofDef(s, 'Test Cub').length).toBe(1);
  });
});
