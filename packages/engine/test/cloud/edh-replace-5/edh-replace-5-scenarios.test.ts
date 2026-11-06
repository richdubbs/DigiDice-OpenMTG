/**
 * Commander lane edh-replace, round edh-replace-5: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (media.wizards.com) by the review, except 602.5b (restrictions; the std-rB convention).
 *
 *   CR 118.12, 608.2d, 603.12   "When this creature dies, you may pay any amount of {R}. When you do, it deals that much damage to any target." (pay.anyAmount)
 *   CR 603.2c, 120.2, 102.3     "Whenever one or more Pirates you control deal damage to your opponents, you create a Treasure token for each opponent dealt damage."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { act as mact, answer as manswer, find as mfind, lifeOf, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

describe('CR 118.12, 608.2d, 603.12: "When this creature dies, you may pay any amount of {R}. When you do, it deals that much damage to any target."', () => {
  const DRAGON = card('Test Ember Dragon', 'Creature — Dragon', 'When this creature dies, you may pay any amount of {R}. When you do, it deals that much damage to any target.', ['1', '1']);
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [DRAGON, SMITE, BEAR];
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  /** p1 destroys their own Dragon with `lands` Mountains; `pay` is the number chosen for the payment (undefined: the payment must not be offered), `target` the reflexive trigger's target. */
  function dies(lands: number, pay: number | undefined, target: 'p2' | 'bear' | 'none'): { s: GameState; bear: ObjectId; offered: { max: number } | undefined } {
    let s = scenario(['Plains', 'Mountain'], { p1: { hand: ['Test Smite'], battlefield: ['Test Ember Dragon', ...Array<string>(lands).fill('Mountain')] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p2');
    const dragon = find(s, 'Test Ember Dragon', 'battlefield', 'p1');
    let offered: { max: number } | undefined;
    let chosen = 0; // the first target choice is Test Smite's (the Dragon), the second the reflexive trigger's
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') });
    for (let i = 0; i < 60 && s.pending; i++) {
      const p = s.pending as { kind: string; max?: number };
      if (p.kind === 'chooseTargets') {
        s = answer(s, { kind: 'chooseTargets', targets: [chosen++ === 0 ? { kind: 'object', id: dragon } : target === 'bear' ? { kind: 'object', id: bear } : { kind: 'player', id: 'p2' }] } as never);
      } else if (p.kind === 'chooseNumber') { offered = { max: p.max! }; s = answer(s, { kind: 'chooseNumber', n: pay ?? 0 }); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else throw new Error(`unexpected ${p.kind}`);
    }
    return { s, bear, offered };
  }
  it('CR 118.12, 608.2d: paying R twice with two Mountains deals 2 damage to the chosen target (the opponent), and the Mountains are tapped', () => {
    const { s, offered } = dies(2, 2, 'p2');
    expect(offered).toEqual({ max: 2 });
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Mountain' && s.objects[id]!.tapped)).toHaveLength(2);
  });
  it('CR 608.2d: paying only once with two Mountains deals 1 damage and leaves one Mountain untapped (any amount, not all)', () => {
    const { s } = dies(2, 1, 'p2');
    expect(life(s, 'p2')).toBe(19);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Mountain' && !s.objects[id]!.tapped)).toHaveLength(1);
  });
  it('CR 118.12: paying zero times is declining: no damage and no trigger', () => {
    const { s } = dies(2, 0, 'p2');
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Mountain' && s.objects[id]!.tapped)).toHaveLength(0);
  });
  it('CR 118.3: with no red mana available the payment is not offered at all', () => {
    const { s, offered } = dies(0, undefined, 'none');
    expect(offered).toBeUndefined();
    expect(life(s, 'p2')).toBe(20);
  });
  it('CR 120.3, 608.2h: the damage goes to the chosen target, a creature too, as much as was paid: 1 does not kill a 2/2, 2 does', () => {
    const one = dies(2, 1, 'bear');
    expect(one.s.zones.battlefield).toContain(one.bear);
    expect(one.s.objects[one.bear]!.damage).toBe(1);
    const two = dies(2, 2, 'bear');
    expect((two.s.zones.graveyard['p2'] ?? []).some((id) => two.s.objects[id]!.defId === 'Test Plain Bear')).toBe(true); // (a new object once it died)
  });
});

describe('CR 603.2c, 120.2, 102.3: "Whenever one or more Pirates you control deal damage to your opponents, you create a Treasure token for each opponent dealt damage."', () => {
  const NAV = card('Test Navigator', 'Legendary Creature — Siren Pirate', 'Whenever one or more Pirates you control deal damage to your opponents, you create a Treasure token for each opponent dealt damage.', ['1', '1']);
  const CORSAIR = card('Test Corsair', 'Creature — Human Pirate', '', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const PINGER = card('Test Pirate Pinger', 'Creature — Goblin Pirate', '{0}: This creature deals 1 damage to each opponent.', ['1', '1']);
  const defs = [NAV, CORSAIR, BEAR, PINGER];
  it('is automated', () => expect(full(NAV)).toBe(true));
  const treasures = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token' && s.objects[id]!.defId.includes('Treasure')).length;
  function fight(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): GameState {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = manswer(s, { kind: 'declareAttackers', attacks });
    for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = manswer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = mpass(s);
      else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
    }
    return s;
  }
  const board = (extra: string[]) => mpScenario({ defs, zones: { p1: { battlefield: ['Test Navigator', ...extra] } } });
  it('CR 102.3, 603.2c: two Pirates attacking two different opponents make two Treasures (one trigger, one for each opponent dealt damage)', () => {
    let s = board(['Test Corsair', 'Test Corsair']);
    const [a, b] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Corsair');
    s = fight(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p3' }]);
    expect(treasures(s)).toBe(2);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 18, 20]);
  });
  it('the Scryfall ruling of 2020-11-10: damage to only one opponent, even from two Pirates, is a single Treasure', () => {
    let s = board(['Test Corsair', 'Test Corsair']);
    const [a, b] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Corsair');
    s = fight(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }]);
    expect(treasures(s)).toBe(1);
  });
  it('negative: a creature that is no Pirate dealing damage makes none', () => {
    let s = board(['Test Plain Bear']);
    s = fight(s, [{ attacker: mfind(s, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p2' }]);
    expect(treasures(s)).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('the ruling: noncombat damage counts too, and one effect hitting all three opponents is ONE trigger making three Treasures', () => {
    let s = board(['Test Pirate Pinger']);
    const pinger = mfind(s, 'Test Pirate Pinger', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === pinger);
    if (a === undefined) throw new Error('no activation');
    s = mact(s, a.action);
    for (let i = 0; i < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) s = s.pending?.kind === 'priority' ? mpass(s) : manswer(s, { kind: 'payCost', auto: true } as never);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([19, 19, 19]);
    expect(treasures(s)).toBe(3);
  });
  it('negative: damage dealt to you by an opponent\'s Pirate (not to your opponents) makes none', () => {
    const OPP = card('Test Raider', 'Creature — Human Pirate', '', ['2', '2']);
    let s = mpScenario({ defs: [...defs, OPP], zones: { p1: { battlefield: ['Test Navigator'] }, p2: { battlefield: ['Test Raider'] } } });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'p2 attacks');
    s = manswer(s, { kind: 'declareAttackers', attacks: [{ attacker: mfind(s, 'Test Raider', 'battlefield', 'p2'), defender: 'p1' }] });
    for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = manswer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = mpass(s);
      else throw new Error(`unexpected ${d.kind}`);
    }
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(treasures(s)).toBe(0);
  });
});

describe('CR 107.14, 614.1a, 602.5b: "If you would get one or more {E}, you get that many plus one {E} instead." and "Activate only if you\'ve paid or lost four or more {E} this turn."', () => {
  const ENGINE = card('Test Spark Engine', 'Artifact', "If you would get one or more {E} (energy counters), you get that many plus one {E} instead.\n{T}: Draw a card. Activate only if you've paid or lost four or more {E} this turn.");
  const SPRITE = card('Test Glow Sprite', 'Creature — Faerie', 'Whenever you gain life, you get that many {E}.\n{T}, Pay {E}{E}{E}{E}: You gain 1 life.', ['1', '1']);
  const MINI = card('Test Mini Sprite', 'Creature — Faerie', '{T}, Pay {E}{E}{E}: You gain 2 life.', ['1', '1']);
  const BALM = card('Test Balm', 'Instant', 'You gain 3 life.');
  const defs = [ENGINE, SPRITE, MINI, BALM];
  const energy = (s: GameState, p = 0): number => ((s.players[p]! as unknown as { counters?: Record<string, number> }).counters?.['energy'] ?? 0);
  const settle = (s0: GameState): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending; guard++) {
      if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else throw new Error(`unexpected ${s.pending.kind}`);
    }
    return s;
  };
  const castBalm = (s: GameState): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Balm', 'hand', 'p1') }));
  it('is automated', () => { for (const d of [ENGINE, SPRITE, MINI, BALM]) expect(full(d), d.name).toBe(true); });
  it('CR 614.1a: getting 3 {E} with the Engine gives 4; without it 3; an opponent\'s Engine changes nothing for you', () => {
    const mine = castBalm(scenario([], { defs, p1: { hand: ['Test Balm'], battlefield: ['Test Glow Sprite', 'Test Spark Engine'] } }));
    expect(energy(mine)).toBe(4);
    const none = castBalm(scenario([], { defs, p1: { hand: ['Test Balm'], battlefield: ['Test Glow Sprite'] } }));
    expect(energy(none)).toBe(3);
    const theirs = castBalm(scenario([], { defs, p1: { hand: ['Test Balm'], battlefield: ['Test Glow Sprite'] }, p2: { battlefield: ['Test Spark Engine'] } }));
    expect(energy(theirs)).toBe(3);
  });
  const sprite = (s: GameState): ObjectId => find(s, 'Test Glow Sprite', 'battlefield', 'p1');
  const engine = (s: GameState): ObjectId => find(s, 'Test Spark Engine', 'battlefield', 'p1');
  const abilityOf = (s: GameState, id: ObjectId, label: string) => legal(s, 'p1', 'activate').find((x) => x.object === id && x.label.includes(label));
  it('CR 602.5b, 107.14: the draw cannot be activated before four {E} have been paid this turn, and can after paying four (the payment is the loss)', () => {
    let s = castBalm(castBalm(scenario([], { defs, p1: { hand: ['Test Balm', 'Test Balm'], battlefield: ['Test Glow Sprite', 'Test Spark Engine'] } })));
    expect(energy(s)).toBe(8); // 3 + 1 twice
    expect(abilityOf(s, engine(s), 'Draw')).toBeUndefined();
    s = settle(act(s, abilityOf(s, sprite(s), 'gain 1')!.action)); // pay four {E}: gain 1 life (which gives {E} back: the Sprite and the Engine)
    expect(abilityOf(s, engine(s), 'Draw')).toBeDefined();
    const hand = s.zones.hand['p1']!.length;
    s = settle(act(s, abilityOf(s, engine(s), 'Draw')!.action));
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
  it('negative: paying only three {E} this turn is not enough', () => {
    const s0 = castBalm(castBalm(scenario([], { defs, p1: { hand: ['Test Balm', 'Test Balm'], battlefield: ['Test Glow Sprite', 'Test Mini Sprite', 'Test Spark Engine'] } })));
    const mini = find(s0, 'Test Mini Sprite', 'battlefield', 'p1');
    const s = settle(act(s0, abilityOf(s0, mini, 'gain 2')!.action));
    expect(energy(s)).toBe(8 - 3 + 2 + 1); // 3 paid, then the 2 life gained give 2 {E} (the Sprite) and 1 more (the Engine)
    expect(abilityOf(s, engine(s), 'Draw')).toBeUndefined();
  });
  it('negative: the restriction is judged for the turn: a new turn starts again at zero', () => {
    let s = castBalm(castBalm(scenario([], { defs, p1: { hand: ['Test Balm', 'Test Balm'], battlefield: ['Test Glow Sprite', 'Test Spark Engine'] } })));
    s = settle(act(s, abilityOf(s, sprite(s), 'gain 1')!.action));
    expect(abilityOf(s, engine(s), 'Draw')).toBeDefined();
    s = settle(s);
    const next = s.turn.number + 2; // (p2's turn between)
    for (let guard = 0; guard < 400 && !(s.turn.number === next && s.turn.step === 'main1'); guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, Math.max(1, d.min)) });
      else if (d?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d?.kind}`);
    }
    expect(abilityOf(s, engine(s), 'Draw')).toBeUndefined();
  });
});
