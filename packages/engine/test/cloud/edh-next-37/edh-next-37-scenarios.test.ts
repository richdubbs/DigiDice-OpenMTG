/**
 * Commander EDHREC ranks 18,751-20,000, round edh-next-37: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 613.4c, 506.5, 508.1c     "Enchanted creature gets +3/+0 and can only attack alone."
 *   CR 615.5, 615.7, 120.3       "Prevent the next X damage that would be dealt to you and/or permanents you control this turn. If damage is prevented this way, ~ deals that much damage to any target."
 *   CR 615.5, 107.3              "Prevent the next X damage that would be dealt to target creature this turn, where X is ... If damage is prevented this way, ~ deals that much damage to any target."
 *   CR 601.2i, 505.1, 603.4      "When this Aura enters, if you cast it during your main phase, enchanted creature gains lifelink until end of turn."
 *   CR 601.2b, 601.2i, 118.8     "As an additional cost to cast this spell, you may reveal a Dragon card from your hand. ... If you revealed a Dragon card or controlled a Dragon as you cast this spell, ..."
 *   CR 509.1h, 701.8a, 603.2     "Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures."
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';
import { synthetic } from '../../m6/costs/support';
import { card, cast, full, named, pt, resolveAll, settle } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const idOf = (s: GameState, name: string, player = 'p1'): ObjectId => find(s, name, 'battlefield', player);
const FOREST = card('Test Forest', 'Basic Land — Forest', '({T}: Add {G}.)');
const ZAP = card('Test Zap Two', 'Instant', '~ deals 2 damage to target creature.');
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '6']);
/** Cast a spell and answer each target decision in turn with the next of `targets`, X with `x`. */
function castWith(s0: GameState, name: string, targets: ObjectId[], x = 0): GameState {
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  let next = 0;
  for (let i = 0; i < 20 && t.pending?.kind !== 'priority'; i++) {
    if (t.pending?.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: x });
    else if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: targets[next++]! }] });
    else t = settle(t);
  }
  return resolveAll(t);
}

describe('CR 506.5, 508.1c: "Enchanted creature gets +3/+0 and can only attack alone."', () => {
  const LONE = card('Test Lone Banner', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+0 and can only attack alone.');
  it('is full', () => expect(full(LONE)).toBe(true));
  it('pumps the enchanted creature; it may attack alone but not together with another creature; the other creature is free', () => {
    const s0 = scenario([], { defs: [LONE, BEAR], p1: { hand: ['Test Lone Banner'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
    const [a, b] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Lone Banner', { targets: [{ kind: 'object', id: a! }] }));
    expect(pt(s1, a!)).toBe('5/6');
    expect(pt(s1, b!)).toBe('2/6');
    expect(() => declareAttackers(toDeclareAttackers(s1), [[a!], [b!]])).toThrow(); // together: refused
    expect(declareAttackers(toDeclareAttackers(s1), [[a!]]).combat?.attackers.length).toBe(1); // alone: allowed
    expect(declareAttackers(toDeclareAttackers(s1), [[b!]]).combat?.attackers.length).toBe(1); // negative: the other creature attacks freely
  });
});

describe('CR 615.5, 615.7, 120.3: prevent the next X damage, then ~ deals that much damage to a target', () => {
  const DEFLECT = card('Test Turn Aside', 'Instant', 'Prevent the next X damage that would be dealt to you and/or permanents you control this turn. If damage is prevented this way, ~ deals that much damage to any target.', undefined, '{X}');
  const SHIELD = card('Test Pale Reward', 'Instant', 'Prevent the next X damage that would be dealt to target creature this turn, where X is your devotion to white. If damage is prevented this way, ~ deals that much damage to any target.');
  const PRIEST = card('Test White Priest', 'Creature — Cleric', '', ['1', '1'], '{W}{W}');
  const BIGZAP = card('Test Zap Four', 'Instant', '~ deals 4 damage to target creature.');
  it('are full', () => { expect(full(DEFLECT)).toBe(true); expect(full(SHIELD)).toBe(true); });
  it('X = 2: 2 of the 4 damage dealt to my creature is prevented and the spell deals 2 to the target; the rest is dealt', () => {
    const s0 = scenario([], { defs: [DEFLECT, BIGZAP, BEAR, FOREST], p1: { hand: ['Test Turn Aside', 'Test Zap Four'], battlefield: ['Test Plain Bear', 'Test Forest', 'Test Forest'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const mine = idOf(s0, 'Test Plain Bear', 'p1');
    const foe = idOf(s0, 'Test Plain Bear', 'p2');
    const s1 = castWith(s0, 'Test Turn Aside', [foe], 2);
    const s2 = resolveAll(cast(s1, 'Test Zap Four', { targets: [{ kind: 'object', id: mine }] }));
    expect(s2.objects[mine]!.damage).toBe(2); // 4 dealt, 2 prevented
    expect(s2.objects[foe]!.damage).toBe(2); // that much damage to the target
  });
  it('negative: damage to the opponent\'s creature is not prevented and nothing is dealt back', () => {
    const s0 = scenario([], { defs: [DEFLECT, BIGZAP, BEAR, FOREST], p1: { hand: ['Test Turn Aside', 'Test Zap Four'], battlefield: ['Test Plain Bear', 'Test Forest', 'Test Forest'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const mine = idOf(s0, 'Test Plain Bear', 'p1');
    const foe = idOf(s0, 'Test Plain Bear', 'p2');
    const s1 = castWith(s0, 'Test Turn Aside', [foe], 2);
    const s2 = resolveAll(cast(s1, 'Test Zap Four', { targets: [{ kind: 'object', id: foe }] }));
    expect(s2.objects[foe]!.damage).toBe(4);
    expect(s2.objects[mine]!.damage).toBe(0);
  });
  it('devotion 2 (one {W}{W} permanent): prevents 2 of 4 damage to the target creature and deals 2 to the chosen target', () => {
    const s0 = scenario([], { defs: [SHIELD, BIGZAP, BEAR, PRIEST], p1: { hand: ['Test Pale Reward', 'Test Zap Four'], battlefield: ['Test Plain Bear', 'Test White Priest'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const mine = idOf(s0, 'Test Plain Bear', 'p1');
    const foe = idOf(s0, 'Test Plain Bear', 'p2');
    const s1 = castWith(s0, 'Test Pale Reward', [mine, foe]);
    const s2 = resolveAll(cast(s1, 'Test Zap Four', { targets: [{ kind: 'object', id: mine }] }));
    expect(s2.objects[mine]!.damage).toBe(2);
    expect(s2.objects[foe]!.damage).toBe(2);
    expect(lifeOf(s2, 'p2')).toBe(20);
  });
});

describe('CR 601.2i, 505.1, 603.4: "When this Aura enters, if you cast it during your main phase, enchanted creature gains lifelink until end of turn."', () => {
  const MARK = synthetic('Test Quick Mark', 'Enchantment — Aura', '{0}', 'Flash\nEnchant creature\nEnchanted creature gets +1/+2 and has vigilance.\nAddendum — When this Aura enters, if you cast it during your main phase, enchanted creature gains lifelink until end of turn.');
  const lifelinkOf = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id), 'lifelink');
  it('is full', () => expect(full(MARK)).toBe(true));
  it('cast in your main phase: the creature gets +1/+2, vigilance and lifelink until end of turn', () => {
    const s0 = scenario([], { defs: [MARK, BEAR], p1: { hand: ['Test Quick Mark'], battlefield: ['Test Plain Bear'] } });
    const bear = idOf(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Quick Mark', { targets: [{ kind: 'object', id: bear }] }));
    expect(pt(s1, bear)).toBe('3/8');
    expect(lifelinkOf(s1, bear)).toBe(true);
  });
  it('negative: cast with flash outside a main phase (beginning of combat): no lifelink, the rest of the Aura applies', () => {
    const s0 = scenario([], { defs: [MARK, BEAR], p1: { hand: ['Test Quick Mark'], battlefield: ['Test Plain Bear'] } });
    const bear = idOf(s0, 'Test Plain Bear');
    const s1 = toStep(s0, 'beginCombat');
    const s2 = resolveAll(cast(s1, 'Test Quick Mark', { targets: [{ kind: 'object', id: bear }] }));
    expect(pt(s2, bear)).toBe('3/8');
    expect(lifelinkOf(s2, bear)).toBe(false);
  });
});

describe('CR 601.2b, 601.2i, 118.8: "If you revealed a Dragon card or controlled a Dragon as you cast this spell"', () => {
  const ROAR = synthetic('Test Wyrm Roar', 'Instant', '{0}', 'As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\n~ deals 3 damage to target creature. If you revealed a Dragon card or controlled a Dragon as you cast ~, ~ deals 3 damage to that creature\'s controller.');
  const WYRM = synthetic('Test Small Wyrm', 'Creature — Dragon', '{0}', '', { power: '1', toughness: '1' });
  const VICTIM = card('Test Victim', 'Creature — Bear', '', ['2', '6']);
  /** Cast the Roar at the Victim; `reveal` answers the optional additional cost. */
  const roar = (battlefield: string[], hand: string[], reveal: boolean): GameState => {
    const s0 = scenario([], { defs: [ROAR, WYRM, VICTIM], p1: { hand: ['Test Wyrm Roar', ...hand], battlefield }, p2: { battlefield: ['Test Victim'] } });
    const foe = idOf(s0, 'Test Victim', 'p2');
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wyrm Roar', 'hand', 'p1') });
    for (let i = 0; i < 20 && t.pending?.kind !== 'priority'; i++) {
      const d = t.pending;
      if (d?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: foe }] });
      else if (d?.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes: reveal });
      else if (d?.kind === 'chooseOption') t = answer(t, { kind: 'chooseOption', ids: [reveal ? (d as { options: { id: string }[] }).options.at(-1)!.id : (d as { options: { id: string }[] }).options[0]!.id] });
      else t = settle(t);
    }
    return resolveAll(t);
  };
  it('is full', () => expect(full(ROAR)).toBe(true));
  it('controlling a Dragon as it is cast: 3 damage to the creature and 3 to its controller', () => {
    const s = roar(['Test Small Wyrm'], [], false);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('revealing a Dragon card from the hand: 3 damage to its controller too', () => {
    const s = roar([], ['Test Small Wyrm'], true);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative: neither a Dragon on the battlefield nor a reveal: only the creature is dealt damage', () => {
    const s = roar([], ['Test Small Wyrm'], false);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.objects[idOf(s, 'Test Victim', 'p2')]!.damage).toBe(3);
  });
});

describe('CR 509.1h, 701.8a, 603.2: "Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures."', () => {
  const SLEDGE = synthetic('Test Ruin Sledge', 'Artifact — Equipment', '{0}', 'Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures.\nEquip {0}');
  const MINE = card('Test Carrier', 'Creature — Bear', '', ['2', '2']);
  const FOE = card('Test Foe', 'Creature — Bear', '', ['2', '2']);
  const BYSTANDER = card('Test Bystander', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(SLEDGE)).toBe(true));
  it('the equipped creature attacks and is blocked: both it and the blocker are destroyed, a bystander is not', () => {
    const s0 = scenario([], { defs: [SLEDGE, MINE, FOE, BYSTANDER], p1: { battlefield: ['Test Ruin Sledge', 'Test Carrier'] }, p2: { battlefield: ['Test Foe', 'Test Bystander'] } });
    const carrier = idOf(s0, 'Test Carrier');
    const sledge = idOf(s0, 'Test Ruin Sledge');
    const eq = tweak(s0, (x) => { x.objects[sledge]!.attachedTo = carrier; });
    const s1 = declareAttackers(toDeclareAttackers(eq), [[carrier]]);
    const s2 = passUntil(s1, (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const s3 = resolveAll(declareBlockers(s2, [[idOf(s0, 'Test Foe', 'p2'), carrier]]));
    expect(s3.zones.battlefield.includes(carrier)).toBe(false);
    expect(s3.zones.battlefield.includes(idOf(s0, 'Test Foe', 'p2'))).toBe(false);
    expect(s3.zones.battlefield.includes(idOf(s0, 'Test Bystander', 'p2'))).toBe(true);
  });
  it('negative: not attached, nothing triggers (the blocked attacker and the blocker both survive the destroy-both trigger)', () => {
    const s0 = scenario([], { defs: [SLEDGE, MINE, FOE, BYSTANDER], p1: { battlefield: ['Test Ruin Sledge', 'Test Carrier'] }, p2: { battlefield: ['Test Foe', 'Test Bystander'] } });
    const carrier = idOf(s0, 'Test Carrier');
    const s1 = declareAttackers(toDeclareAttackers(s0), [[carrier]]);
    const s2 = passUntil(s1, (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const s3 = declareBlockers(s2, [[idOf(s0, 'Test Bystander', 'p2'), carrier]]);
    expect(s3.zones.stack.length).toBe(0);
  });
});

describe('CR 601.2i, 603.4, 614.12: the same reveal-or-control condition on an enters trigger and an "enters with" replacement (Orator of Ojutai, Scaleguard Sentinels)', () => {
  const REVEAL = 'As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\n';
  const ORATOR = synthetic('Test Orator', 'Creature — Human Monk', '{0}', `${REVEAL}When this creature enters, if you revealed a Dragon card or controlled a Dragon as you cast this spell, draw a card.`, { power: '1', toughness: '3' });
  const SENTRY = synthetic('Test Sentry', 'Creature — Human Soldier', '{0}', `${REVEAL}~ enters with a +1/+1 counter on it if you revealed a Dragon card or controlled a Dragon as you cast this spell.`, { power: '2', toughness: '2' });
  const WYRM = synthetic('Test Small Wyrm', 'Creature — Dragon', '{0}', '', { power: '1', toughness: '1' });
  const play = (name: string, battlefield: string[], hand: string[], reveal: boolean): GameState => {
    const s0 = scenario(['Forest', 'Forest', 'Forest'], { defs: [ORATOR, SENTRY, WYRM], p1: { hand: [name, ...hand], battlefield } });
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let i = 0; i < 20 && t.pending?.kind !== 'priority'; i++) {
      const d = t.pending;
      if (d?.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes: reveal });
      else if (d?.kind === 'chooseOption') t = answer(t, { kind: 'chooseOption', ids: [reveal ? (d as { options: { id: string }[] }).options.at(-1)!.id : (d as { options: { id: string }[] }).options[0]!.id] });
      else t = settle(t);
    }
    return resolveAll(t);
  };
  const hand = (s: GameState): number => (s.zones.hand.p1 ?? []).length;
  it('are full', () => { expect(full(ORATOR)).toBe(true); expect(full(SENTRY)).toBe(true); });
  it('a Dragon controlled as it is cast: the enters trigger draws a card and the creature enters with a counter', () => {
    const o = play('Test Orator', ['Test Small Wyrm'], [], false);
    expect(hand(o)).toBe(1); // the drawn card
    const s = play('Test Sentry', ['Test Small Wyrm'], [], false);
    expect(s.objects[idOf(s, 'Test Sentry')]!.counters['+1/+1']).toBe(1);
  });
  it('negative: no Dragon controlled and nothing revealed: no card, no counter', () => {
    const o = play('Test Orator', [], [], false);
    expect(hand(o)).toBe(0);
    const s = play('Test Sentry', [], [], false);
    expect(s.objects[idOf(s, 'Test Sentry')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 707.10, 601.2i: a copy of a spell was not cast, so "controlled a Dragon as you cast" does not hold for it (ruling 2015-02-25)', () => {
  const ROAR = synthetic('Test Wyrm Roar', 'Instant', '{0}', 'As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\n~ deals 3 damage to target creature. If you revealed a Dragon card or controlled a Dragon as you cast ~, ~ deals 3 damage to that creature\'s controller.');
  const TWIN = synthetic('Test Twin', 'Instant', '{0}', 'Copy target instant or sorcery spell. You may choose new targets for the copy.');
  const WYRM = synthetic('Test Small Wyrm', 'Creature — Dragon', '{0}', '', { power: '1', toughness: '1' });
  const VICTIM = card('Test Victim', 'Creature — Bear', '', ['2', '20']);
  const run = (reveal: boolean): GameState => {
    const s0 = scenario([], { defs: [ROAR, WYRM, VICTIM, TWIN], p1: { hand: ['Test Wyrm Roar', 'Test Twin', ...(reveal ? ['Test Small Wyrm'] : [])], battlefield: reveal ? [] : ['Test Small Wyrm'] }, p2: { battlefield: ['Test Victim'] } });
    const foe = idOf(s0, 'Test Victim', 'p2');
    let first = true; // the first yes/no is the Roar's optional reveal; later ones (new targets for the copy) are declined
    const handle = (t0: GameState, pick: ObjectId): GameState => {
      let t = t0;
      for (let i = 0; i < 30 && t.pending?.kind !== 'priority'; i++) {
        const d = t.pending;
        if (d?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: pick }] });
        else if (d?.kind === 'yesNo') { t = answer(t, { kind: 'yesNo', yes: first ? reveal : false }); first = false; }
        else if (d?.kind === 'chooseOption') t = answer(t, { kind: 'chooseOption', ids: [reveal ? (d as { options: { id: string }[] }).options.at(-1)!.id : (d as { options: { id: string }[] }).options[0]!.id] });
        else t = settle(t);
      }
      return t;
    };
    let t = handle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wyrm Roar', 'hand', 'p1') }), foe);
    const roarId = t.zones.stack[t.zones.stack.length - 1]!;
    t = handle(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Twin', 'hand', 'p1') }), roarId);
    for (let i = 0; i < 8 && !t.zones.stack.some((id) => t.objects[id]!.kind === 'spellCopy'); i++) t = handle(pass(t), foe);
    return resolveAll(t, { yes: false });
  };
  it('negative: copied while only a Dragon was controlled: only the original deals 3 to the controller (17), the copy does not', () => {
    expect(lifeOf(run(false), 'p2')).toBe(17);
  });
  it('a revealed Dragon card is copied with the spell: the copy deals 3 to the controller too (14)', () => {
    expect(lifeOf(run(true), 'p2')).toBe(14);
  });
});
