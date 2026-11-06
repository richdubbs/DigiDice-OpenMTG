/**
 * Commander lane d-rank-4 (ranks 18,001-19,500), round edh-d-54: the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 614.1a, 119.3             "If a spell or ability would cause its controller to gain life, that player loses that much life instead."
 *   CR 614.12a, 400.3            "As ~ enters, you may put two cards your opponents own from exile into their owners' graveyards. If you do, ~ enters with four +1/+1 counters on it."
 *   CR 603.2, 400.3              "When you cast this spell, you may put a card an opponent owns from exile into that player's graveyard. If you do, you gain 5 life."
 *   CR 118.3, 400.3, 401.4       cost parts "Put a card an opponent owns from exile into that player's graveyard" and "Put a card from your hand on top of your library"
 *   CR 614.12a, 701.20a          "As ~ enters, you may reveal a Dragon card from your hand. If you do or if you control a Dragon, ~ enters with a +1/+1 counter on it."
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, mpScenario } from '../../m12/rules/helpers';
import { card, counters, full, named, resolveAll as settleAll, settle, tokens } from '../cmd3/helpers';
import { runCombat } from '../../m4/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const plr = (id: string) => ({ kind: 'player' as const, id });

describe('CR 614.1a, 119.3: "If a spell or ability would cause its controller to gain life, that player loses that much life instead."', () => {
  const RAIN = card('Test Gore Rain', 'Enchantment', 'If a spell or ability would cause its controller to gain life, that player loses that much life instead.');
  const HEAL = card('Test Mend', 'Instant', 'You gain 3 life.');
  const GIFT = card('Test Gift', 'Instant', 'Target player gains 3 life.');
  const LINK = card('Test Leech', 'Creature — Vampire', 'Lifelink', ['2', '2']);
  const defs = [RAIN, HEAL, GIFT, LINK];
  it('is automated', () => expect(full(RAIN)).toBe(true));
  it('a spell that gains its controller life makes the controller lose that much', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Mend'], battlefield: ['Test Gore Rain'] } } });
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mend', 'hand', 'p1') }));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3);
  });
  it('negative: a spell that makes ANOTHER player gain life is not replaced (that player is not its controller)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Gift'], battlefield: ['Test Gore Rain'] } } });
    const s = settleAll(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gift', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [plr('p2')] }));
    expect(life(s, 'p2')).toBe(life(s0, 'p2') + 3);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('negative: but a spell targeting its own controller is replaced', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Gift'], battlefield: ['Test Gore Rain'] } } });
    const s = settleAll(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gift', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [plr('p1')] }));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3);
  });
  it('an exchange of life totals that raises your life is a gain its spell causes for you: replaced too', () => {
    const SWAP = card('Test Swap', 'Instant', 'Exchange life totals with target player.');
    const s0 = mpScenario({ defs: [RAIN, SWAP], life: 20, zones: { p1: { hand: ['Test Swap'], battlefield: ['Test Gore Rain'] } }, setup: (st) => { st.players.find((x) => x.id === 'p2')!.life = 60; } });
    const s = settleAll(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Swap', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [plr('p2')] }));
    expect(life(s, 'p1')).toBeLessThan(20);
  });
  it('negative: lifelink is a result of damage, not a spell or ability, and still gains life (Rain of Gore ruling 2013-04-15)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Gore Rain', 'Test Leech'] } } });
    const leech = onBf(s0, 'p1', 'Test Leech')[0]!;
    const s = runCombat(s0, { attack: [[leech, 'p2']], block: [] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 2);
  });
});

const inExile = (st: GameState, p: string, defId: string): ObjectId[] => (st.zones.exile ?? []).filter((id) => st.objects[id]!.defId === defId && st.objects[id]!.owner === p);
const inYard = (st: GameState, p: string, defId: string): boolean => (st.zones.graveyard[p] ?? []).some((id) => st.objects[id]!.defId === defId);
const OPP_A = card('Test Exiled Alpha', 'Sorcery', '');
const OPP_B = card('Test Exiled Beta', 'Sorcery', '');
const MINE = card('Test Exiled Mine', 'Sorcery', '');

describe('CR 614.12a, 400.3: "As ~ enters, you may put two cards your opponents own from exile into their owners\' graveyards. If you do, ~ enters with four +1/+1 counters on it."', () => {
  const EATER = card('Test Grave Eater', 'Creature — Eldrazi', "As ~ enters, you may put two cards your opponents own from exile into their owners' graveyards. If you do, ~ enters with four +1/+1 counters on it.", ['2', '2']);
  const defs = [EATER, OPP_A, OPP_B, MINE];
  const start = (exile: Record<string, string[]>): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Grave Eater'], exile: exile['p1'] ?? [] }, p2: { exile: exile['p2'] ?? [] }, p3: { exile: exile['p3'] ?? [] } } });
  const play = (s0: GameState, yes: boolean): GameState => settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Eater', 'hand', 'p1') }), { yes });
  it('is automated', () => expect(full(EATER)).toBe(true));
  it('cards of two different opponents go to their own owners\' graveyards and it enters with four counters (ruling: different owners are fine)', () => {
    const s0 = start({ p2: ['Test Exiled Alpha'], p3: ['Test Exiled Beta'] });
    const s = play(s0, true);
    expect(inYard(s, 'p2', 'Test Exiled Alpha')).toBe(true);
    expect(inYard(s, 'p3', 'Test Exiled Beta')).toBe(true);
    const e = named(s, 'Test Grave Eater')[0]!;
    expect(counters(s, e, '+1/+1')).toBe(4);
  });
  it('negative: declining puts nothing into a graveyard and gives no counters', () => {
    const s0 = start({ p2: ['Test Exiled Alpha'], p3: ['Test Exiled Beta'] });
    const s = play(s0, false);
    expect(inExile(s, 'p2', 'Test Exiled Alpha').length).toBe(1);
    expect(counters(s, named(s, 'Test Grave Eater')[0]!, '+1/+1')).toBe(0);
  });
  it('negative: with only one card an opponent owns in exile nothing is asked and it enters without counters (all or none)', () => {
    const s0 = start({ p2: ['Test Exiled Alpha'] });
    const s = play(s0, true);
    expect(inExile(s, 'p2', 'Test Exiled Alpha').length).toBe(1);
    expect(counters(s, named(s, 'Test Grave Eater')[0]!, '+1/+1')).toBe(0);
  });
  it('negative: your own cards in exile are not cards your opponents own', () => {
    const s0 = start({ p1: ['Test Exiled Mine', 'Test Exiled Mine'], p2: ['Test Exiled Alpha'] });
    const s = play(s0, true);
    expect(inExile(s, 'p1', 'Test Exiled Mine').length).toBe(2);
    expect(counters(s, named(s, 'Test Grave Eater')[0]!, '+1/+1')).toBe(0);
  });
  it('DEVIATION (refuses a legal play, never allows an illegal one): face-down cards in exile are not offered; the rulings allow a random pick from a face-down group, which is not built', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Grave Eater'] }, p2: { exile: ['Test Exiled Alpha', 'Test Exiled Beta'] } }, setup: (st) => { for (const id of st.zones.exile) st.objects[id]!.faceDown = true; } });
    const s = play(s0, true);
    expect(inExile(s, 'p2', 'Test Exiled Alpha').length).toBe(1);
    expect(counters(s, named(s, 'Test Grave Eater')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 603.2, 400.3: "When you cast this spell, you may put a card an opponent owns from exile into that player\'s graveyard. If you do, you gain 5 life."', () => {
  const RUIN = card('Test Ruin Eater', 'Creature — Eldrazi', "When you cast this spell, you may put a card an opponent owns from exile into that player's graveyard. If you do, you gain 5 life.", ['2', '2']);
  const defs = [RUIN, OPP_A, MINE];
  it('is automated', () => expect(full(RUIN)).toBe(true));
  it('the card goes to its owner\'s graveyard and you gain 5 life', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Ruin Eater'] }, p2: { exile: ['Test Exiled Alpha'] } } });
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ruin Eater', 'hand', 'p1') }));
    expect(inYard(s, 'p2', 'Test Exiled Alpha')).toBe(true);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 5);
  });
  it('negative: declining gains no life and leaves the card in exile', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Ruin Eater'] }, p2: { exile: ['Test Exiled Alpha'] } } });
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ruin Eater', 'hand', 'p1') }), { yes: false });
    expect(inExile(s, 'p2', 'Test Exiled Alpha').length).toBe(1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('negative: with no card an opponent owns in exile (only your own) you gain nothing', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Ruin Eater'], exile: ['Test Exiled Mine'] } } });
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ruin Eater', 'hand', 'p1') }));
    expect(inExile(s, 'p1', 'Test Exiled Mine').length).toBe(1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

describe('CR 118.3, 400.3: the cost "Put a card an opponent owns from exile into that player\'s graveyard"', () => {
  const MAKER = card('Test Scion Maker', 'Creature — Eldrazi', 'Put a card an opponent owns from exile into that player\'s graveyard: Create a 1/1 colorless Eldrazi Scion creature token.', ['2', '2']);
  const defs = [MAKER, OPP_A, MINE];
  const activate = (s0: GameState): GameState => settleAll(act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'p1', 'Test Scion Maker')[0]!, ability: 'p:0:0' } as never));
  it('is automated', () => expect(full(MAKER)).toBe(true));
  it('pays with an opponent\'s exiled card, which goes to its owner\'s graveyard, and makes the token', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Scion Maker'] }, p3: { exile: ['Test Exiled Alpha'] } } });
    const s = activate(s0);
    expect(inYard(s, 'p3', 'Test Exiled Alpha')).toBe(true);
    expect(tokens(s).length).toBe(1);
  });
  it('negative: with no card an opponent owns in exile the ability can\'t be activated', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Scion Maker'], exile: ['Test Exiled Mine'] } } });
    expect(() => activate(s0)).toThrow();
    expect(inExile(s0, 'p1', 'Test Exiled Mine').length).toBe(1);
  });
});

describe('CR 118.3, 401.4: the cost "Put a card from your hand on top of your library"', () => {
  const RETREAT = card('Test Retreat', 'Enchantment', 'Put a card from your hand on top of your library: You gain 1 life.');
  const defs = [RETREAT, MINE];
  it('is automated', () => expect(full(RETREAT)).toBe(true));
  it('the chosen card from your hand goes on top of your library and the effect happens', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Retreat'], hand: ['Test Exiled Mine'] } } });
    const mine = s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Exiled Mine')!;
    const handBefore = s0.zones.hand['p1']!.length;
    const s = settleAll(act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'p1', 'Test Retreat')[0]!, ability: 'p:0:0' } as never), { objects: [mine] });
    const top = s.zones.library['p1']![0]!;
    expect(s.objects[top]!.defId).toBe('Test Exiled Mine');
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 1);
  });
  it('negative: with an empty hand it can\'t be activated', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Retreat'] } } });
    for (const id of s0.zones.hand['p1']!) delete s0.objects[id]; // (the draw step gave p1 a card)
    s0.zones.hand['p1'] = [];
    expect(s0.zones.hand['p1']!.length).toBe(0);
    expect(() => act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'p1', 'Test Retreat')[0]!, ability: 'p:0:0' } as never)).toThrow();
  });
});

describe('CR 614.12a, 701.20a: "As ~ enters, you may reveal a Dragon card from your hand. If you do or if you control a Dragon, ~ enters with a +1/+1 counter on it."', () => {
  const DISC = card('Test Disciple', 'Creature — Human Monk', 'As ~ enters, you may reveal a Dragon card from your hand. If you do or if you control a Dragon, ~ enters with a +1/+1 counter on it.', ['1', '1']);
  const DRAKE = card('Test Drake', 'Creature — Dragon', '', ['2', '2']);
  const defs = [DISC, DRAKE];
  const play = (s0: GameState, yes = true): GameState => settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Disciple', 'hand', 'p1') }), { yes });
  it('is automated', () => expect(full(DISC)).toBe(true));
  it('revealing a Dragon card from your hand gives the counter', () => {
    const s = play(mpScenario({ defs, zones: { p1: { hand: ['Test Disciple', 'Test Drake'] } } }));
    expect(counters(s, named(s, 'Test Disciple')[0]!, '+1/+1')).toBe(1);
  });
  it('controlling a Dragon gives the counter and nothing is asked; a Dragon in hand as well still gives only one', () => {
    const s = play(mpScenario({ defs, zones: { p1: { hand: ['Test Disciple', 'Test Drake'], battlefield: ['Test Drake'] } } }));
    expect(counters(s, named(s, 'Test Disciple')[0]!, '+1/+1')).toBe(1);
  });
  it('negative: declining the reveal with no Dragon in play gives no counter', () => {
    const s = play(mpScenario({ defs, zones: { p1: { hand: ['Test Disciple', 'Test Drake'] } } }), false);
    expect(counters(s, named(s, 'Test Disciple')[0]!, '+1/+1')).toBe(0);
  });
  it('negative: no Dragon card in hand and none in play gives no counter', () => {
    const s = play(mpScenario({ defs, zones: { p1: { hand: ['Test Disciple'] } } }));
    expect(counters(s, named(s, 'Test Disciple')[0]!, '+1/+1')).toBe(0);
  });
});
void settle;
void obj;
void runCombat;
void plr;

describe('CR 118.3, 601.2b, 400.3: "As an additional cost to cast ~, put a card an opponent owns from exile into that player\'s graveyard." (Processor Assault\'s wording, newly full)', () => {
  const ASSAULT = card('Test Processor Burn', 'Sorcery', "As an additional cost to cast ~, put a card an opponent owns from exile into that player's graveyard.\n~ deals 5 damage to target creature.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [ASSAULT, BEAR, OPP_A];
  it('is automated', () => expect(full(ASSAULT)).toBe(true));
  it('the card goes to its owner\'s graveyard as the spell is cast, and the damage is dealt', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Processor Burn'] }, p2: { battlefield: ['Test Bear'], exile: ['Test Exiled Alpha'] } } });
    const bear = onBf(s0, 'p2', 'Test Bear')[0]!;
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Processor Burn', 'hand', 'p1') }), { targets: [obj(bear)] });
    expect(inYard(s, 'p2', 'Test Exiled Alpha')).toBe(true);
    expect(s.zones.battlefield.includes(bear)).toBe(false);
  });
  it('negative: with no card an opponent owns in exile the spell can\'t be cast', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Processor Burn'] }, p2: { battlefield: ['Test Bear'] } } });
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Processor Burn', 'hand', 'p1') })).toThrow();
  });
});

describe('CR 603.3d, 400.3: "When ~ enters, you may put a card an opponent owns from exile into that player\'s graveyard. If you do, return target instant or sorcery card from your graveyard to your hand." (Ulamog\'s Reclaimer\'s wording, newly full)', () => {
  const RECLAIM = card('Test Reclaimer', 'Creature — Eldrazi', "When ~ enters, you may put a card an opponent owns from exile into that player's graveyard. If you do, return target instant or sorcery card from your graveyard to your hand.", ['2', '2']);
  const SPELL = card('Test Old Spell', 'Instant', '');
  const defs = [RECLAIM, SPELL, OPP_A];
  const go = (yes: boolean): { s0: GameState; s: GameState } => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Reclaimer'], graveyard: ['Test Old Spell'] }, p2: { exile: ['Test Exiled Alpha'] } } });
    const old = s0.zones.graveyard['p1']!.find((id) => s0.objects[id]!.defId === 'Test Old Spell')!;
    return { s0, s: settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reclaimer', 'hand', 'p1') }), { yes, targets: [obj(old)] }) };
  };
  it('the card goes to its owner\'s graveyard and the targeted instant returns to your hand', () => {
    const { s } = go(true);
    expect(inYard(s, 'p2', 'Test Exiled Alpha')).toBe(true);
    expect((s.zones.hand['p1'] ?? []).some((id) => s.objects[id]!.defId === 'Test Old Spell')).toBe(true);
  });
  it('negative: declining leaves the instant in the graveyard and the card in exile', () => {
    const { s } = go(false);
    expect(inExile(s, 'p2', 'Test Exiled Alpha').length).toBe(1);
    expect(inYard(s, 'p1', 'Test Old Spell')).toBe(true);
  });
});
