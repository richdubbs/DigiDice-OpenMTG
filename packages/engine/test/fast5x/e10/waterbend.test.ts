/**
 * FAST5X E10: waterbend (CR 701.67) as a cost, played through applyAction with synthetic cards compiled by the game's default compiler (invented wordings,
 * design 6.10). "Waterbend [cost]" means "Pay [cost]. For each generic mana in that cost, you may tap an untapped artifact or creature you control rather than
 * pay that mana." (701.67a); in a total cost only the waterbend cost's generic mana may be paid that way (701.67b); "whenever you waterbend" triggers whenever
 * a waterbend cost is paid, however it was paid (701.67c). Each test is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, passBoth, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"') || JSON.stringify(a).includes('"kind":"manual"'));

const SHAPER = card('Test Tide Shaper', 'Creature — Human Warrior', 'Waterbend {3}: Draw a card.', '{1}{U}', ['2', '2']);
const WARDEN = card('Test Ice Warden', 'Creature — Human Soldier', 'Waterbend {2}, {T}: Draw a card.', '{1}{U}', ['1', '3']);
const COG = card('Test Brass Cog', 'Artifact', '{T}: You gain 1 life.', '{1}');
const PUP = card('Test Otter Pup', 'Creature — Otter', '', '{1}', ['1', '1']);
const WAVE = card('Test Rising Wave', 'Sorcery', 'As an additional cost to cast this spell, waterbend {2}.\nDraw two cards.', '{1}{U}');
const SPIRIT = card('Test River Guardian', 'Creature — Spirit', 'Ward—Waterbend {2}.', '{U}', ['2', '2']);
const PING = card('Test Pebble Toss', 'Instant', 'Tap target creature.', '{0}');
const SAGE = card('Test Tide Sage', 'Creature — Human Monk', 'Whenever you waterbend, you gain 2 life.', '{1}{U}', ['1', '1']);
const SURGE = card('Test Tidal Surge', 'Sorcery', 'As an additional cost to cast this spell, you may waterbend {3}.\nDraw a card.', '{U}');
const DEFS = [SHAPER, WARDEN, COG, PUP, WAVE, SPIRIT, PING, SAGE, SURGE];

const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const activateAction = (s: GameState, source: ObjectId) => legal(s, 'p1', 'activate').find((a) => a.object === source)?.action;
const sorted = (xs: readonly string[]): string[] => [...xs].sort();
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };

describe('the capabilities: waterbend is a cost the engine pays', () => {
  it('cost:action.waterbend is advertised (and no `action:waterbend` is needed: waterbend is only a cost), and every synthetic card here is fully automated', () => {
    expect(ENGINE_CAPABILITIES.has('cost:action.waterbend')).toBe(true);
    for (const d of DEFS) {
      expect(manualParts(d), d.name).toEqual([]);
      // "whenever you waterbend" is an experimental template (no printed card has it alone): capped at partial (design 6.9)
      expect(d.automation.level, d.name).toBe(d === SAGE ? 'partial' : 'full');
    }
  });
});

describe('CR 701.67a: "Waterbend {3}: Draw a card." may be paid by tapping untapped artifacts and creatures, each paying {1}', () => {
  it('with no land, three other untapped artifacts and creatures pay for the whole cost (a creature that just came under your control too, CR 302.6)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Shaper', 'Test Brass Cog', 'Test Otter Pup', 'Test Otter Pup'] }, defs: DEFS });
    for (const id of s.zones.battlefield) if (s.objects[id]!.controller === 'p1') s.objects[id]!.controlledSinceTurn = s.turn.number; // summoning sick
    const shaper = find(s, 'Test Tide Shaper', 'battlefield', 'p1');
    const action = activateAction(s, shaper);
    expect(action, 'listed: the cost can be paid by tapping (CR 118.3)').toBeDefined();
    const before = handSize(s, 'p1');
    s = act(s, action!);
    // four untapped artifacts and creatures (the source too: waterbend has no {T}) and three must be tapped: the player chooses three
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 3, max: 3 });
    expect(sorted((s.pending as { options: string[] }).options)).toEqual(sorted(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name !== 'Plains')));
    const cog = find(s, 'Test Brass Cog', 'battlefield', 'p1');
    const pups = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Otter Pup');
    s = answer(s, { kind: 'chooseObjects', ids: [cog, ...pups] });
    expect([cog, ...pups].map((id) => s.objects[id]!.tapped)).toEqual([true, true, true]);
    expect(s.objects[shaper]!.tapped).toBe(false);
    s = passBoth(s);
    expect(handSize(s, 'p1')).toBe(before + 1);
  });

  it('with lands, the player taps as many as they like (none to pay all the mana) and pays the rest with mana', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Shaper', 'Test Otter Pup', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const shaper = find(s, 'Test Tide Shaper', 'battlefield', 'p1');
    const pup = find(s, 'Test Otter Pup', 'battlefield', 'p1');
    s = act(s, activateAction(s, shaper)!);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 2 });
    s = answer(s, { kind: 'chooseObjects', ids: [pup] });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{2}' });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[pup]!.tapped).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped)).toHaveLength(2);
  });

  it('choosing none pays the whole {3} with mana', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Shaper', 'Test Otter Pup', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    s = act(s, activateAction(s, find(s, 'Test Tide Shaper', 'battlefield', 'p1'))!);
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{3}' });
  });

  it('CR 118.3: with too few untapped artifacts, creatures and lands together, the ability is not listed', () => {
    const s = scenario([], { p1: { battlefield: ['Test Tide Shaper', 'Test Otter Pup'] }, defs: DEFS });
    expect(activateAction(s, find(s, 'Test Tide Shaper', 'battlefield', 'p1'))).toBeUndefined();
  });

  it('tapped artifacts and creatures and the opponent\'s ones can\'t pay', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Shaper', { name: 'Test Otter Pup', tapped: true }, { name: 'Test Brass Cog', tapped: true }] }, p2: { battlefield: ['Test Otter Pup', 'Test Otter Pup'] }, defs: DEFS });
    expect(activateAction(s, find(s, 'Test Tide Shaper', 'battlefield', 'p1'))).toBeUndefined();
    put(s, 'p1', 'battlefield', 'Plains');
    put(s, 'p1', 'battlefield', 'Plains');
    s = act(s, activateAction(s, find(s, 'Test Tide Shaper', 'battlefield', 'p1'))!);
    // two lands and the source: the source must be tapped (at least one), and it is the only object that may be
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{2}' }); // the only option was taken without a question
    expect(s.objects[find(s, 'Test Tide Shaper', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
});

describe('CR 701.67a, 602.2b: "Waterbend {2}, {T}: ..." — the permanent tapped for {T} can\'t also pay for the waterbend cost', () => {
  it('the source is not offered; with one other creature and no land the ability is not listed', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ice Warden', 'Test Otter Pup'] }, defs: DEFS });
    expect(activateAction(s, find(s, 'Test Ice Warden', 'battlefield', 'p1'))).toBeUndefined();
    put(s, 'p1', 'battlefield', 'Test Brass Cog');
    const warden = find(s, 'Test Ice Warden', 'battlefield', 'p1');
    s = act(s, activateAction(s, warden)!);
    // the cog and the pup must both be tapped (the only two that may): no question; the warden is tapped for {T}
    const pup = find(s, 'Test Otter Pup', 'battlefield', 'p1');
    const cog = find(s, 'Test Brass Cog', 'battlefield', 'p1');
    expect([s.objects[warden]!.tapped, s.objects[pup]!.tapped, s.objects[cog]!.tapped]).toEqual([true, true, true]);
    expect(s.zones.stack.length).toBe(1);
  });
});

describe('CR 701.67b, 601.2b, 601.2f: "As an additional cost to cast this spell, waterbend {2}." — only the waterbend cost\'s generic mana may be paid by tapping', () => {
  it('a {1}{U} spell with waterbend {2}: three creatures and an Island-less board can\'t cast it (its own {1}{U} needs mana)', () => {
    const s = scenario([], { p1: { hand: ['Test Rising Wave'], battlefield: ['Test Otter Pup', 'Test Otter Pup', 'Test Otter Pup'] }, defs: DEFS });
    expect(legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Rising Wave', 'hand', 'p1'))).toBe(false);
  });

  it('with mana for {1}{U} and two creatures: up to two are tapped (never three), and the spell resolves', () => {
    let s = scenario([], { p1: { hand: ['Test Rising Wave'], battlefield: ['Test Otter Pup', 'Test Otter Pup', 'Test Brass Cog'] }, defs: DEFS });
    s.players.find((p) => p.id === 'p1')!.manaPool.push({ type: 'U' } as never, { type: 'C' } as never);
    const before = handSize(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rising Wave', 'hand', 'p1') });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 2, max: 2 });
    const pups = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Otter Pup');
    s = answer(s, { kind: 'chooseObjects', ids: pups });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(pups.map((id) => s.objects[id]!.tapped)).toEqual([true, true]);
    expect(s.objects[find(s, 'Test Brass Cog', 'battlefield', 'p1')]!.tapped).toBe(false);
    s = passBoth(s);
    expect(handSize(s, 'p1')).toBe(before - 1 + 2);
  });
});

describe('CR 601.2b, 701.67a: "As an additional cost to cast this spell, you may waterbend {3}." — an optional additional cost, paid partly by tapping', () => {
  it('declined: only {U} is paid; paid: the player taps up to three artifacts and creatures', () => {
    let s = scenario([], { p1: { hand: ['Test Tidal Surge', 'Test Tidal Surge'], battlefield: ['Test Otter Pup', 'Test Otter Pup', 'Test Brass Cog'] }, defs: DEFS });
    mana(s, 'U', 'U');
    const [first, second] = s.zones.hand.p1!.filter((id) => s.objects[id]!.defId === 'Test Tidal Surge');
    s = act(s, { type: 'cast', player: 'p1', card: first! });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: false });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped)).toEqual([]);
    s = passBoth(s);
    s = act(s, { type: 'cast', player: 'p1', card: second! });
    s = answer(s, { kind: 'yesNo', yes: true });
    // {U} + waterbend {3}: no mana for the {3}, so all three must be tapped (taken without a question)
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped)).toHaveLength(3);
    expect(s.zones.stack).toHaveLength(1);
  });
});

describe('CR 702.21a: "Ward—Waterbend {2}" — the opponent may pay the ward cost by tapping their own artifacts and creatures', () => {
  const setup = (): { s: GameState; guardian: ObjectId } => {
    let s = scenario([], { p2: { battlefield: ['Test River Guardian'] }, p1: { hand: ['Test Pebble Toss'], battlefield: ['Test Otter Pup', 'Test Brass Cog'] }, defs: DEFS });
    const guardian = find(s, 'Test River Guardian', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pebble Toss', 'hand', 'p1') });
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: guardian }] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = passBoth(s); // the ward trigger goes on the stack and resolves first
    return { s, guardian };
  };
  it('the targeting player taps both of their untapped permanents to pay, and the spell is not countered', () => {
    let { s, guardian } = setup();
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 1) s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((s.pending as { prompt: string }).prompt).toBe('Test River Guardian: pay Waterbend {2}?'); // the cost is written once (rules/cost.ts#costText)
    s = answer(s, { kind: 'yesNo', yes: true });
    // the pup and the cog are the only way to pay {2} (no land): taken without a question
    expect(s.objects[find(s, 'Test Otter Pup', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(s.objects[find(s, 'Test Brass Cog', 'battlefield', 'p1')]!.tapped).toBe(true);
    s = passBoth(s);
    expect(s.objects[guardian]!.tapped).toBe(true);
  });
  it('declining counters the spell', () => {
    let { s, guardian } = setup();
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 1) s = passBoth(s);
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.zones.stack.length).toBe(0);
    expect(s.objects[guardian]!.tapped).toBe(false);
  });
});

describe('CR 701.67c: "Whenever you waterbend" triggers whenever a waterbend cost is paid, regardless of how', () => {
  it('paid all with mana, it still triggers', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Shaper', 'Test Tide Sage', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const life = lifeOf(s, 'p1');
    s = act(s, activateAction(s, find(s, 'Test Tide Shaper', 'battlefield', 'p1'))!);
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = answer(s, { kind: 'payCost', auto: true });
    // the trigger goes on the stack above the ability
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
  it('paid partly by tapping the creature that has the trigger, it still triggers once', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Sage', 'Test Tide Shaper', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const life = lifeOf(s, 'p1');
    s = act(s, activateAction(s, find(s, 'Test Tide Shaper', 'battlefield', 'p1'))!);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Tide Sage', 'battlefield', 'p1')] });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.length).toBe(2); // the ability and the trigger above it
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
  it('the player who pays is the one who waterbends: an opponent paying a ward—waterbend cost doesn\'t trigger "whenever you waterbend" of the ward\'s controller', () => {
    let s = scenario([], { p2: { battlefield: ['Test River Guardian', 'Test Tide Sage'] }, p1: { hand: ['Test Pebble Toss'], battlefield: ['Test Otter Pup', 'Test Brass Cog'] }, defs: DEFS });
    const life = lifeOf(s, 'p2');
    const guardian = find(s, 'Test River Guardian', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pebble Toss', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: guardian }] });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 1) s = passBoth(s);
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.zones.stack.length).toBe(1); // only the spell: no trigger of p2's Sage
    s = passBoth(s);
    expect(lifeOf(s, 'p2')).toBe(life);
    expect(s.objects[guardian]!.tapped).toBe(true);
  });
});
