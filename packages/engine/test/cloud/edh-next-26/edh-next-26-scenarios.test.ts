/**
 * Commander lane edh-next, round edh-next-26: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 110.4, 205.2a, 701.8a       "Destroy target legendary permanent that's an artifact, creature, or enchantment." (Bounty Agent)
 *   CR 701.26a, 701.15a, 608.2c    "Tap up to one target creature and goad it." (Killian, Decisive Mentor)
 *   CR 303.4b, 508.1m, 603.2c      "Whenever one or more creatures that are enchanted by an Aura you control attack, draw a card." (Killian)
 *   CR 122.1, 111.1, 608.2h        "Create X 2/2 black Zombie Mutant creature tokens, where X is the total number of rad counters among players." (Vault 12: The Necropolis)
 *   CR 111.10p, 303.4f, 303.7      "Create a Virtuous Role token attached to another target creature you control." (Ellivere of the Wild Court)
 *   CR 706.1, 706.2, 701.24        "Roll a d10. Put target creature into its owner's library just beneath the top X cards of that library, where X is the result." (Underdark Rift)
 *   CR 702.45a, 107.3, 608.2h      "~ has bushido X, where X is the number of attacking creatures." (Fumiko the Lowblood)
 *   CR 607.2a, 603.4, 608.2g       "Whenever ~ attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost." (Smirking Spelljacker)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';
import { advanceTo } from '../../m3/scenario';
import { attackUnblocked, declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

interface Picks { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: TargetChoice[][]; offered?: ObjectId[][] }
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; objects?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options!, s) : p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') { o.offered?.push([...(p.objects ?? [])]); s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) } as DecisionAnswer);
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Picks = {}, player: 'p1' | 'p2' = 'p1'): GameState => resolveAll(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), o);
const activate = (s0: GameState, source: ObjectId, o: Picks = {}): GameState => resolveAll(act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' } as never), o);
const onBf = (s: GameState, defId: string, controller: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && s.objects[id]!.defId === defId);

describe('CR 110.4, 205.2a, 701.8a: "Destroy target legendary permanent that\'s an artifact, creature, or enchantment."', () => {
  const HUNTER = card('Test Bounty Hunter', 'Creature — Human Soldier', "{T}, Sacrifice this creature: Destroy target legendary permanent that's an artifact, creature, or enchantment.", { pt: ['2', '2'] });
  const KNIGHT = card('Test Legend Knight', 'Legendary Creature — Knight', '', { pt: ['2', '2'] });
  const RELIC = card('Test Legend Relic', 'Legendary Artifact', '');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WILDS = card('Test Legend Wilds', 'Legendary Land', '');
  const defs = [HUNTER, KNIGHT, RELIC, BEAR, WILDS];
  const setup = (): GameState => scenario([], { p1: { battlefield: ['Test Bounty Hunter'] }, p2: { battlefield: ['Test Legend Knight', 'Test Legend Relic', 'Test Plain Bear', 'Test Legend Wilds'] }, defs });
  it('is automated', () => expect(full(HUNTER)).toBe(true));
  it('offers only legendary artifacts, creatures and enchantments, and destroys the one chosen (the Hunter is sacrificed as a cost)', () => {
    const s0 = setup();
    const offered: ObjectId[][] = [];
    const relic = find(s0, 'Test Legend Relic', 'battlefield', 'p2');
    const r = activate(s0, find(s0, 'Test Bounty Hunter', 'battlefield', 'p1'), { targets: [[obj(relic)]], offered });
    const names = offered[0]!.map((id) => s0.objects[id]!.defId).sort();
    expect(names).toEqual(['Test Legend Knight', 'Test Legend Relic']);
    expect(r.zones.battlefield).not.toContain(relic);
    expect(onBf(r, 'Test Bounty Hunter', 'p1')).toHaveLength(0);
    expect(onBf(r, 'Test Legend Knight', 'p2')).toHaveLength(1);
  });
  it('negative: a nonlegendary creature and a legendary land are not targets (the permanents stay)', () => {
    const s0 = setup();
    const s1 = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Bounty Hunter', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    const pend = s1.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(pend.kind).toBe('chooseTargets');
    const names = pend.objects.map((id) => s0.objects[id]!.defId);
    for (const n of ['Test Plain Bear', 'Test Legend Wilds']) expect(names).not.toContain(n);
    expect(names.length).toBe(2);
  });
});

describe('CR 701.26a, 701.15a, 608.2c: "Tap up to one target creature and goad it."', () => {
  const ROUSE = card('Test Rouse', 'Sorcery', 'Tap up to one target creature and goad it.', { cost: '{0}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [ROUSE, BEAR];
  it('is automated', () => expect(full(ROUSE)).toBe(true));
  it('taps the target and it is goaded by the caster', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rouse'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const r = cast(s0, 'Test Rouse', { targets: [[obj(bear)]] });
    expect(r.objects[bear]!.tapped).toBe(true);
    expect(r.objects[bear]!.goaded?.map((g) => g.by)).toEqual(['p1']);
  });
  it('negative: choosing no target taps and goads nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rouse'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const r = cast(s0, 'Test Rouse', { targets: [[]] });
    expect(r.objects[bear]!.tapped).toBe(false);
    expect(r.objects[bear]!.goaded).toBeUndefined();
  });
});

describe('CR 303.4b, 508.1m, 603.2c: "Whenever one or more creatures that are enchanted by an Aura you control attack, draw a card."', () => {
  const MENTOR = card('Test Aura Mentor', 'Creature — Advisor', 'Whenever one or more creatures that are enchanted by an Aura you control attack, draw a card.', { pt: ['1', '1'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const AURA = card('Test Quiet Aura', 'Enchantment — Aura', 'Enchant creature');
  const defs = [MENTOR, BEAR, AURA];
  const handSize = (s: GameState): number => s.zones.hand.p1!.length;
  const play = (auraOwner: 'p1' | 'p2', bears = 1): { s: GameState; before: number } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Aura Mentor', ...Array(bears).fill('Test Plain Bear')], library: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, defs });
    const bearIds = findAll(s0, 'Test Plain Bear', 'battlefield', 'p1');
    for (const b of bearIds) { const aura = put(s0, auraOwner, 'battlefield', 'Test Quiet Aura'); s0.objects[aura]!.attachedTo = b; }
    const before = handSize(s0);
    return { s: drive(attackUnblocked(s0, bearIds), {}), before };
  };
  it('is automated', () => expect(full(MENTOR)).toBe(true));
  it('draws one card when an enchanted creature attacks, and once when two enchanted creatures attack together', () => {
    const one = play('p1');
    expect(handSize(one.s)).toBe(one.before + 1);
    const two = play('p1', 2);
    expect(handSize(two.s)).toBe(two.before + 1);
  });
  it("negative: an Aura an opponent controls doesn't count; an unenchanted attacker doesn't draw", () => {
    const opp = play('p2');
    expect(handSize(opp.s)).toBe(opp.before);
    const s0 = scenario([], { p1: { battlefield: ['Test Aura Mentor', 'Test Plain Bear'], library: ['Test Plain Bear', 'Test Plain Bear'] }, defs });
    const before = handSize(s0);
    const r = attackUnblocked(s0, [find(s0, 'Test Plain Bear', 'battlefield', 'p1')]);
    expect(handSize(r)).toBe(before);
  });
});

describe('CR 122.1, 111.1, 608.2h: "Create X 2/2 black Zombie Mutant creature tokens, where X is the total number of rad counters among players."', () => {
  const BLOOM = card('Test Rad Bloom', 'Sorcery', 'Create X 2/2 black Zombie Mutant creature tokens, where X is the total number of rad counters among players.', { cost: '{0}' });
  const defs = [BLOOM];
  const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token').length;
  it('is automated', () => expect(full(BLOOM)).toBe(true));
  it('adds up the rad counters of every player (2 + 3 = 5 tokens), each a 2/2 black Zombie Mutant', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rad Bloom'] }, defs });
    s0.players[0]!.counters['rad'] = 2;
    s0.players[1]!.counters['rad'] = 3;
    const r = cast(s0, 'Test Rad Bloom');
    expect(tokens(r)).toBe(5);
    const t = r.zones.battlefield.find((id) => r.objects[id]!.kind === 'token')!;
    expect([Number(chars(r, t).power), Number(chars(r, t).toughness), chars(r, t).subtypes.slice().sort().join(',')]).toEqual([2, 2, 'Mutant,Zombie']);
  });
  it('negative: counters of another kind (poison) are not counted, and no rad counters make no tokens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rad Bloom'] }, defs });
    s0.players[1]!.poison = 4;
    s0.players[1]!.counters['experience'] = 2;
    expect(tokens(cast(s0, 'Test Rad Bloom'))).toBe(0);
  });
});

describe('CR 111.10p, 303.4f, 303.7: "Create a Virtuous Role token attached to another target creature you control."', () => {
  const ENVOY = card('Test Role Envoy', 'Creature — Noble', 'When this creature enters, create a Virtuous Role token attached to another target creature you control.', { pt: ['1', '1'], cost: '{0}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [ENVOY, BEAR];
  it('is automated', () => expect(full(ENVOY)).toBe(true));
  it('the Role is attached to the other creature, which gets +1/+1 for each enchantment you control (the Role itself)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Role Envoy'], battlefield: ['Test Plain Bear'] }, defs });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const r = cast(s0, 'Test Role Envoy', { targets: [[obj(bear)]] });
    const role = r.zones.battlefield.find((id) => r.objects[id]!.kind === 'token')!;
    expect(r.objects[role]!.attachedTo).toBe(bear);
    expect([Number(chars(r, bear).power), Number(chars(r, bear).toughness)]).toEqual([3, 3]);
  });
  it('negative: the Envoy cannot target itself ("another"), so with no other creature no Role is made', () => {
    const s0 = scenario([], { p1: { hand: ['Test Role Envoy'] }, defs });
    const r = cast(s0, 'Test Role Envoy');
    expect(r.zones.battlefield.some((id) => r.objects[id]!.kind === 'token')).toBe(false);
  });
});

describe('CR 706.1, 706.2, 701.24: "Roll a d10. Put target creature into its owner\'s library just beneath the top X cards of that library, where X is the result."', () => {
  const RIFT = card('Test Chaos Rift', 'Artifact', "{T}, Exile this artifact: Roll a d10. Put target creature into its owner's library just beneath the top X cards of that library, where X is the result.");
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const FILL = card('Test Filler Card', 'Artifact', '');
  const defs = [RIFT, BEAR, FILL];
  it('is automated', () => expect(full(RIFT)).toBe(true));
  it('puts the creature beneath exactly as many cards as the die shows', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const s0 = scenario([], { p1: { battlefield: ['Test Chaos Rift'] }, p2: { battlefield: ['Test Plain Bear'], library: Array(12).fill('Test Filler Card') }, defs, seed });
      const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
      const r = activate(s0, find(s0, 'Test Chaos Rift', 'battlefield', 'p1'), { targets: [[obj(bear)]] });
      const x = Number(r.log.map((l) => /rolls a d10: (\d+)\./.exec(l.text)?.[1]).find((v) => v !== undefined));
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(10);
      const moved = r.zones.library.p2!.findIndex((id) => r.defs[r.objects[id]!.defId]?.name === 'Test Plain Bear');
      expect(moved).toBe(x);
    }
  });
  it('negative: a d10 never shows more than 10 (the creature is never deeper than 11th), and it leaves the battlefield', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Chaos Rift'] }, p2: { battlefield: ['Test Plain Bear'], library: Array(12).fill('Test Filler Card') }, defs, seed: 'z' });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const r = activate(s0, find(s0, 'Test Chaos Rift', 'battlefield', 'p1'), { targets: [[obj(bear)]] });
    expect(r.zones.battlefield).not.toContain(bear);
    expect(r.zones.library.p2!.findIndex((id) => r.defs[r.objects[id]!.defId]?.name === 'Test Plain Bear')).toBeLessThanOrEqual(10);
  });
});

describe('Underdark Rift ruling 2021-07-23: a library with fewer than X cards takes the creature on the bottom', () => {
  const RIFT = card('Test Chaos Rift', 'Artifact', "{T}, Exile this artifact: Roll a d10. Put target creature into its owner's library just beneath the top X cards of that library, where X is the result.");
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const FILL = card('Test Filler Card', 'Artifact', '');
  it('with two cards in the library the creature ends third (the bottom), whatever the die shows (1, 2 or more)', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const s0 = scenario([], { p1: { battlefield: ['Test Chaos Rift'] }, p2: { battlefield: ['Test Plain Bear'], library: ['Test Filler Card', 'Test Filler Card'] }, defs: [RIFT, BEAR, FILL], seed });
      s0.zones.library.p2 = s0.zones.library.p2!.slice(0, 2); // the scenario pads the library; only two cards stay
      const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
      const r = activate(s0, find(s0, 'Test Chaos Rift', 'battlefield', 'p1'), { targets: [[obj(bear)]] });
      const x = Number(r.log.map((l) => /rolls a d10: (\d+)\./.exec(l.text)?.[1]).find((v) => v !== undefined));
      const at = r.zones.library.p2!.findIndex((id) => r.defs[r.objects[id]!.defId]?.name === 'Test Plain Bear');
      expect(at).toBe(Math.min(x, 2));
    }
  });
});

describe('CR 702.45a, 107.3, 608.2h: "~ has bushido X, where X is the number of attacking creatures."', () => {
  const SAMURAI = card('Test Rising Samurai', 'Creature — Human Samurai', 'This creature has bushido X, where X is the number of attacking creatures.', { pt: ['1', '1'] });
  const ALLY = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WALL = card('Test Plain Wall', 'Creature — Wall', '', { pt: ['0', '9'] });
  const defs = [SAMURAI, ALLY, WALL];
  it('is automated', () => expect(full(SAMURAI)).toBe(true));
  it('blocked while two creatures attack: +2/+2 until end of turn (X counted as the trigger resolves)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Rising Samurai', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Wall'] }, defs });
    const sam = find(s0, 'Test Rising Samurai', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[sam], [find(s0, 'Test Plain Bear', 'battlefield', 'p1')]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[find(s0, 'Test Plain Wall', 'battlefield', 'p2'), sam]]);
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority' && x.log.some((l) => /bushido|gets \+/i.test(l.text)), 'the trigger resolved', 10);
    expect([Number(chars(s, sam).power), Number(chars(s, sam).toughness)]).toEqual([3, 3]);
  });
  it('negative: unblocked, the creature gets nothing (bushido triggers on blocks / becomes blocked only)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Rising Samurai', 'Test Plain Bear'] }, p2: {}, defs });
    const sam = find(s0, 'Test Rising Samurai', 'battlefield', 'p1');
    const s = declareAttackers(toDeclareAttackers(s0), [[sam], [find(s0, 'Test Plain Bear', 'battlefield', 'p1')]]);
    expect([Number(chars(s, sam).power), Number(chars(s, sam).toughness)]).toEqual([1, 1]);
  });
});

describe('CR 607.2a, 603.4, 608.2g: "Whenever ~ attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost."', () => {
  const JACKER = card('Test Spell Thief', 'Creature — Rogue', 'Flash\nWhen this creature enters, exile target spell an opponent controls.\nWhenever this creature attacks, if a card is exiled with it, you may cast the exiled card without paying its mana cost.', { pt: ['1', '1'], cost: '{0}' });
  const ZAP = card('Test Quick Mend', 'Instant', 'You gain 3 life.', { cost: '{0}' });
  const defs = [JACKER, ZAP];
  it('is automated', () => expect(full(JACKER)).toBe(true));
  it('exiles the opponent\'s spell on entering, then on attacking casts that card for free (its controller, the Thief\'s, gains the life)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Quick Mend'] }, p2: { hand: ['Test Spell Thief'] }, defs });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quick Mend', 'hand', 'p1') });
    s = drive(s);
    s = pass(s); // p1 passes; p2 gets priority with the spell on the stack
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spell Thief', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: s.zones.stack[0]! }]] });
    expect(findAll(s, 'Test Quick Mend', 'exile').length).toBe(1);
    expect(s.players[0]!.life).toBe(20); // the spell was exiled, not resolved
    const thief = find(s, 'Test Spell Thief', 'battlefield', 'p2');
    s.objects[thief]!.controlledSinceTurn = 0;
    s = advanceTo(s, 2, 'declareAttackers');
    s = resolveAll(declareAttackers(s, [[thief]]), { yes: true });
    expect(s.players[1]!.life).toBe(23);
  });
  it('negative: with no card exiled with it (the ETB had no spell to exile) the attack trigger does nothing', () => {
    const s0 = scenario([], { p2: { hand: ['Test Spell Thief'] }, defs });
    const s00 = pass(s0); // p1 passes with an empty stack; p2 gets priority
    let s = resolveAll(act(s00, { type: 'cast', player: 'p2', card: find(s00, 'Test Spell Thief', 'hand', 'p2') }), {});
    const thief = find(s, 'Test Spell Thief', 'battlefield', 'p2');
    s.objects[thief]!.controlledSinceTurn = 0;
    s = advanceTo(s, 2, 'declareAttackers');
    s = resolveAll(declareAttackers(s, [[thief]]), { yes: true });
    expect(s.players[1]!.life).toBe(20);
  });
});
