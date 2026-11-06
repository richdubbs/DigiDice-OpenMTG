/**
 * Commander effort, coordinator C, round edh-c-96 (EDHREC ranks 27,001-27,500, third pass): the round's readings played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler, in 4-player games, each with its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 701.9a, 122.1, 608.2h    "{T}, Sacrifice ~: Target player discards a card for each charge counter on ~."
 *   CR 305.7, 613.1d            "{T}: Target land becomes a Forest."
 *   CR 608.2d, 611.2c, 702.1    "{T}: Target creature loses your choice of flying, first strike, or trample until end of turn."
 *   CR 120.3, 603.2, 608.2c     "Whenever ~ deals combat damage to a player, you may sacrifice it. If you do, ~ deals 3 damage to that player."
 *   CR 122.1f, 120.3a, 608.2h   "Target player loses all poison counters. ~ deals that much damage to that player."
 *   CR 701.13a, 404.1, 608.2d   "Mill N cards. At the beginning of the next end step, exile N cards from your graveyard."
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, mpScenario, pass, passUntil } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, full } from '../cmd3/helpers';
import { getChars as chars } from '../../../src/rules/characteristics';

const bf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.defs[s.objects[id]!.defId]!.name);
const handSize = (s: GameState, p: PlayerId): number => (s.zones.hand[p] ?? []).length;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

/** Answers whatever is asked (first legal target, auto payment, yes/no as given, first minimum choices, the option given) and passes priority until the stack is empty. */
function run(s0: GameState, o: { option?: string; yes?: boolean } = {}): GameState {
  let s = s0;
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; options?: ({ id: string; label?: string } | string)[]; objects?: ObjectId[] };
    if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: (d.objects ?? []).slice(0, Math.max(d.min ?? 1, 1)).map((id) => ({ kind: 'object', id })) } as DecisionAnswer;
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: o.yes ?? true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: ((d.options ?? []) as ObjectId[]).slice(0, d.min ?? 0) };
    else if (p.kind === 'chooseOption') {
      const opts = (d.options ?? []).map((x) => (typeof x === 'string' ? { id: x, label: x } : (x as { id: string; label: string })));
      a = { kind: 'chooseOption', ids: [(opts.find((x) => x.label.toLowerCase() === o.option) ?? opts[0]!).id] } as DecisionAnswer;
    } else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    else throw new Error(`unexpected ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
const abilityKey = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
const activateAt = (s: GameState, source: ObjectId, target: { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId } | null): GameState => {
  const t = act(s, { type: 'activate', player: 'p1', source, ability: abilityKey(s, source) });
  return t.pending?.kind === 'chooseTargets' && target !== null ? answer(t, { kind: 'chooseTargets', targets: [target] } as DecisionAnswer) : t;
};

describe('CR 701.9a, 122.1, 608.2h: "{T}, Sacrifice ~: Target player discards a card for each charge counter on ~."', () => {
  const URN = card('Test Charge Urn', 'Artifact', '{T}, Sacrifice ~: Target player discards a card for each charge counter on ~.');
  const play = (counters: number): GameState => {
    const s = mpScenario({ defs: [URN], zones: { p1: { battlefield: [{ name: 'Test Charge Urn', counters: counters > 0 ? { charge: counters } : {} }] }, p2: { hand: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } } });
    return run(activateAt(s, bf(s, 'Test Charge Urn')[0]!, { kind: 'player', id: 'p2' }));
  };
  it('is automated', () => { expect(full(URN)).toBe(true); });
  it('with three charge counters (read as the cost sacrifices it, last known information, CR 608.2h) the target discards three cards of five; the Urn is gone', () => {
    const s = play(3);
    expect(handSize(s, 'p2')).toBe(2);
    expect(bf(s, 'Test Charge Urn')).toHaveLength(0);
    expect(handSize(s, 'p3')).toBe(0);
  });
  it('negative: with one counter, exactly one card; with none, nothing is discarded', () => {
    expect(handSize(play(1), 'p2')).toBe(4);
    expect(handSize(play(0), 'p2')).toBe(5);
  });
});

describe('CR 305.7, 613.1d: "{T}: Target land becomes a Forest." (no duration)', () => {
  const MONK = card('Test Grove Monk', 'Creature — Monk', '{T}: Target land becomes a Forest.', ['1', '1']);
  const play = (): GameState => {
    const s = mpScenario({ defs: [MONK], cards: ['Mountain'], zones: { p1: { battlefield: ['Test Grove Monk'] }, p2: { battlefield: ['Mountain', 'Mountain'] } } });
    const land = bf(s, 'Mountain', 'p2')[0]!;
    return run(activateAt(s, bf(s, 'Test Grove Monk')[0]!, { kind: 'object', id: land }));
  };
  it('is automated', () => { expect(full(MONK)).toBe(true); });
  it('the Mountain becomes a Forest: it has the land type Forest and no longer Mountain (its old land type is gone), and stays that way into the next turn', () => {
    let s = play();
    const lands = bf(s, 'Mountain', 'p2');
    const changed = lands.find((id) => getChars(s, id)!.subtypes.includes('Forest'));
    expect(changed).toBeDefined();
    expect(getChars(s, changed!)!.subtypes).not.toContain('Mountain');
    s = passUntil(s, (x) => x.turn.number > 1 && x.turn.activePlayer === 'p2' && x.pending?.kind === 'priority', 'the next turn');
    expect(getChars(s, changed!)!.subtypes).toContain('Forest');
  });
  it('negative: the other Mountain stays a Mountain; the target is a land, so a nonland permanent is not a legal target', () => {
    const s = play();
    const lands = bf(s, 'Mountain', 'p2');
    expect(lands.filter((id) => getChars(s, id)!.subtypes.includes('Mountain'))).toHaveLength(1);
    const t = mpScenario({ defs: [MONK], zones: { p1: { battlefield: ['Test Grove Monk'] } } });
    expect(() => act(t, { type: 'activate', player: 'p1', source: bf(t, 'Test Grove Monk')[0]!, ability: abilityKey(t, bf(t, 'Test Grove Monk')[0]!) })).toThrow(/no legal one/);
  });
});

describe('CR 608.2d, 611.2c, 702.1: "{T}: Target creature loses your choice of flying, first strike, or trample until end of turn."', () => {
  const SPONGE = card('Test Dull Sponge', 'Creature — Ooze', '{T}: Target creature loses your choice of flying, first strike, or trample until end of turn.', ['1', '1']);
  const BEAST = card('Test Swift Beast', 'Creature — Beast', 'Flying, first strike, trample', ['3', '3']);
  const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => String(k.keyword)).sort();
  const play = (option: string): { s: GameState; beast: ObjectId } => {
    const s = mpScenario({ defs: [SPONGE, BEAST], zones: { p1: { battlefield: ['Test Dull Sponge'] }, p2: { battlefield: ['Test Swift Beast'] } } });
    const beast = bf(s, 'Test Swift Beast')[0]!;
    return { s: run(activateAt(s, bf(s, 'Test Dull Sponge')[0]!, { kind: 'object', id: beast }), { option }), beast };
  };
  it('is automated', () => { expect(full(SPONGE)).toBe(true); });
  it('choosing first strike removes only first strike (ruling 2004-10-04): flying and trample stay', () => {
    const { s, beast } = play('first strike');
    expect(kw(s, beast)).toEqual(['flying', 'trample']);
  });
  it('choosing trample removes only trample; choosing flying only flying', () => {
    const a = play('trample');
    expect(kw(a.s, a.beast)).toEqual(['first strike', 'flying']);
    const b = play('flying');
    expect(kw(b.s, b.beast)).toEqual(['first strike', 'trample']);
  });
  it('negative: until end of turn only, the keyword is back on the next turn', () => {
    let { s, beast } = play('flying');
    s = passUntil(s, (x) => x.turn.number > 1 && x.pending?.kind === 'priority', 'the next turn');
    expect(kw(s, beast)).toEqual(['first strike', 'flying', 'trample']);
  });
});

describe('CR 120.3, 603.2, 608.2c: "Whenever ~ deals combat damage to a player, you may sacrifice it. If you do, ~ deals 3 damage to that player."', () => {
  const SCAMP = card('Test Spark Scamp', 'Creature — Beast', 'Whenever ~ deals combat damage to a player, you may sacrifice it. If you do, ~ deals 3 damage to that player.', ['2', '2']);
  const play = (yes: boolean): GameState => {
    const s = mpScenario({ defs: [SCAMP], zones: { p1: { battlefield: ['Test Spark Scamp'] } } });
    let t = declareAttackers(toDeclareAttackers(s), [[bf(s, 'Test Spark Scamp')[0]!, 'p3']]);
    t = passUntil(t, (x) => lifeOf(x, 'p3') < 20 && x.pending !== null, 'combat damage');
    return run(t, { yes });
  };
  it('is automated', () => { expect(full(SCAMP)).toBe(true); });
  it('sacrificing it: the defending player (p3, not the sacrificed creature) takes 2 combat and then 3 more; others are untouched', () => {
    const s = play(true);
    expect(lifeOf(s, 'p3')).toBe(15);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(bf(s, 'Test Spark Scamp')).toHaveLength(0);
  });
  it('negative: declining the sacrifice, only the 2 combat damage is dealt and the creature stays', () => {
    const s = play(false);
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(bf(s, 'Test Spark Scamp')).toHaveLength(1);
  });
});

describe('CR 122.1f, 120.3a, 608.2h: "Target player loses all poison counters. ~ deals that much damage to that player."', () => {
  const LEECH = card('Test Draining Leech', 'Sorcery', 'Target player loses all poison counters. ~ deals that much damage to that player.');
  const play = (poison: number, target: PlayerId = 'p2'): GameState => {
    let s = mpScenario({ defs: [LEECH], zones: { p1: { hand: ['Test Draining Leech'] } }, setup: (x) => { x.players.find((p) => p.id === 'p2')!.poison = poison; x.players.find((p) => p.id === 'p3')!.poison = 2; } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Draining Leech', 'hand', 'p1') });
    return run(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] } as DecisionAnswer));
  };
  const poisonOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.poison;
  it('is automated', () => { expect(full(LEECH)).toBe(true); });
  it('with 6 poison counters the target loses all six and takes 6 damage; another player\'s poison is untouched', () => {
    const s = play(6);
    expect(poisonOf(s, 'p2')).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(14);
    expect(poisonOf(s, 'p3')).toBe(2);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
  it('negative: with no poison counters no damage is dealt (that much is 0); the caster is never damaged', () => {
    const s = play(0);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 701.13a, 404.1, 608.2d: "Mill N cards. At the beginning of the next end step, exile N cards from your graveyard."', () => {
  const MEM = card('Test Fading Memory', 'Sorcery', 'Mill three cards. At the beginning of the next end step, exile three cards from your graveyard.');
  const BRIEF = card('Test Brief Memory', 'Sorcery', 'Mill one card. At the beginning of the next end step, exile three cards from your graveyard.');
  const exiled = (s: GameState, p: PlayerId): number => s.zones.exile.filter((id) => s.objects[id]!.owner === p).length;
  const play = (name: string): GameState => {
    let s = mpScenario({ defs: [MEM, BRIEF], zones: { p1: { hand: [name] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
    s = run(s);
    s = passUntil(s, (x) => x.turn.step === 'end' && x.pending !== null, 'the end step');
    return run(s);
  };
  it('are automated', () => { expect(full(MEM)).toBe(true); expect(full(BRIEF)).toBe(true); });
  it('three milled cards and the spell make four in the graveyard; at the end step three are exiled and one stays', () => {
    const s = play('Test Fading Memory');
    expect(exiled(s, 'p1')).toBe(3);
    expect(yard(s, 'p1')).toHaveLength(1);
    expect(exiled(s, 'p2')).toBe(0);
  });
  it('negative: with only two cards in the graveyard (one milled and the spell) both are exiled, not an error; and nothing is exiled before the end step', () => {
    const s = play('Test Brief Memory');
    expect(exiled(s, 'p1')).toBe(2);
    expect(yard(s, 'p1')).toHaveLength(0);
    let t = mpScenario({ defs: [MEM], zones: { p1: { hand: ['Test Fading Memory'] } } });
    t = run(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Fading Memory', 'hand', 'p1') }));
    expect(exiled(t, 'p1')).toBe(0);
  });
});

describe('CR 609.3, 608.2d, 205.1a: the same "exile N cards" reading beside "If you can\'t" and a creature type', () => {
  it('negative (Egon ruling 2021-02-05): "exile two cards from your graveyard. If you can\'t, sacrifice ~ and draw a card." is not fully automated (one card left exiles nothing and sacrifices; the reading would exile it)', () => {
    expect(full(card('Test Grave God', 'Creature — God', "At the beginning of your upkeep, exile two cards from your graveyard. If you can't, sacrifice ~ and draw a card.", ['3', '3']))).toBe(false);
  });
  it('"target creature becomes a Coward" replaces only creature types (ruling 2024-11-08)', () => {
    const CURSE = card('Test Shame Rite', 'Creature — Shaman', '{T}: Target creature becomes a Coward.', ['1', '1']);
    const BEAR = card('Test Goblin Warrior', 'Artifact Creature — Goblin Warrior', '', ['2', '2']);
    const s0 = mpScenario({ defs: [CURSE, BEAR], zones: { p1: { battlefield: ['Test Shame Rite'] }, p2: { battlefield: ['Test Goblin Warrior'] } } });
    const bear = bf(s0, 'Test Goblin Warrior')[0]!;
    const s = run(activateAt(s0, bf(s0, 'Test Shame Rite')[0]!, { kind: 'object', id: bear }));
    const c = chars(s, bear)!;
    expect(c.subtypes).toEqual(['Coward']);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
  });
});
