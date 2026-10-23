/**
 * Standard round 3, slice r3-mech (set mechanics and words the lexicon lacks): the mechanisms of parser/templates/zz-cloud/r3-mech.json and the engine
 * support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10) and
 * fixture cards. Each test is named after the rule it checks.
 *
 *   CR 705.1-705.2, 608.2c       "Flip a coin. If you win the flip, X. If you lose the flip, Y." (the result sentences fold into the flip)
 *   CR 702.187a-c, 305.1, 400.7  mayhem with no cost on a land: play it from the graveyard on the turn it was discarded (Oscorp Industries)
 *   CR 702.143a-b, 116.2h, 406.3 foretell: pay {2} and exile the card face down during your turn; cast it on a later turn for its foretell cost
 *   CR 614.12a, 607.2d, 613.1f   Sieges: "As ~ enters, choose Abzan or Mardu." and "• Abzan -- [Ability]": the permanent has the chosen word's ability only
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type Action, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { canSee } from '../../../src/core/view';
import { getCard } from '../../fixtures';
import { act, answer, cast, drive, find, lands, onField, pick, resolveTop, scenario, until } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const names = (s: GameState, zone: 'hand' | 'graveyard', p: 'p1' | 'p2' = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
const labels = (s: GameState, player: 'p1' | 'p2' = 'p1'): string[] => legalActions(s, player).map((a) => a.label);
const special = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'special' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name)?.action;
const castVia = (s: GameState, name: string, method: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name && (a.action as { method?: string }).method === method)?.action;
const playLand = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'playLand' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name)?.action;
const tappedCount = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => until(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
/** Answer every option choice with `ids` in order; payments automatic. */
const options = (...ids: string[]): DecisionAnswer[] => ids.map((id) => ({ kind: 'chooseOption', ids: [id] }));

// ---- CR 705: coin flips -------------------------------------------------------------------------------------------------------------------------------------

describe('CR 705.1-705.2, 608.2c: "Flip a coin. If you win the flip, X. If you lose the flip, Y."', () => {
  const COIN = card('Test Lucky Coin', 'Artifact', '{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, you lose 1 life.');
  it('is automated, and the result sentences are the branches of the flip (no step of their own)', () => {
    expect(full(COIN)).toBe(true);
    const a = COIN.faces[0]!.abilities[0] as { effect: { steps: { op: string; onWin?: unknown[]; onLose?: unknown[] }[] } };
    expect(a.effect.steps.map((x) => x.op)).toEqual(['flipCoin']);
    expect(a.effect.steps[0]!.onWin).toEqual([{ op: 'draw', who: { ref: 'you' }, count: 1 }]);
    expect(a.effect.steps[0]!.onLose).toEqual([{ op: 'loseLife', who: { ref: 'you' }, amount: 1 }]);
  });
  it('the controller calls the flip (CR 705.2); winning draws a card, losing loses 1 life, never both; the two calls of the same flip give the two outcomes', () => {
    const s0 = scenario([], { defs: [COIN], p1: { battlefield: ['Test Lucky Coin'] } });
    const coin = onField(s0, 'Test Lucky Coin');
    const activated = drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === coin)!.action));
    const outcomes = (['heads', 'tails'] as const).map((call) => {
      const s1 = resolveTop(activated);
      expect(s1.pending?.kind).toBe('chooseOption');
      const s = drive(answer(s1, { kind: 'chooseOption', ids: [call] }));
      const drew = s.zones.hand['p1']!.length - activated.zones.hand['p1']!.length;
      const lost = lifeOf(activated, 'p1') - lifeOf(s, 'p1');
      expect(drew + lost).toBe(1);
      expect(s.log.some((l) => /wins the flip|loses the flip/.test(l.text) && (l.rules ?? []).includes('CR 705.2'))).toBe(true);
      return drew === 1 ? 'won' : 'lost';
    });
    expect(new Set(outcomes)).toEqual(new Set(['won', 'lost'])); // the same seeded flip: one call wins, the other loses
  });
  it('fail closed: a result sentence with no flip right before it, or after a flip by another player, stays manual', () => {
    expect(full(card('Test Odd Luck', 'Sorcery', 'Draw a card. If you win the flip, draw two cards.'))).toBe(false);
    expect(full(card('Test Lonely Luck', 'Sorcery', 'If you lose the flip, you lose 3 life.'))).toBe(false);
  });
  it('CR 705.1-705.2: a flip whose only result sentence is not understood is not flipped uncalled: that flip sentence is manual too, the sentences before it stay', () => {
    const d = card('Test Sputter Coin', 'Artifact', '{T}: Draw a card. Then flip a coin. If you lose the flip, the next time a source would deal damage to you this turn, it deals double that damage instead.');
    const steps = (d.faces[0]!.abilities[0] as { effect: { steps: { op: string; text?: string }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['draw', 'manual', 'manual']);
    expect(steps[1]!.text).toMatch(/flip a coin/i);
  });
});

// ---- CR 702.187: mayhem with no cost (a land) ---------------------------------------------------------------------------------------------------------------

describe('CR 702.187a-c, 305.1, 400.7: mayhem on a land lets its owner play it from the graveyard on the turn they discarded it', () => {
  const OSCORP = 'Oscorp Industries'; // Land: enters tapped; when it enters from a graveyard, you lose 2 life; {T}: Add {U}, {B}, or {R}; Mayhem
  it('the permission is a capability and the card compiles full', () => {
    expect(ENGINE_CAPABILITIES.has('permit:play.discardedSelf')).toBe(true);
    expect(compileCard(getCard(OSCORP)).automation.level).toBe('full');
  });
  /** p1 casts Faithless Looting and discards Oscorp Industries and one drawn card (CR 701.9). */
  function loot(s0: GameState): GameState {
    let s = resolveTop(cast(s0, 'Faithless Looting'));
    const land = find(s, OSCORP, 'hand', 'p1');
    const other = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!;
    return drive(answer(s, pick(land, other)));
  }
  const board = (): GameState => scenario(['Faithless Looting', OSCORP, 'Mountain'], { p1: { hand: ['Faithless Looting', OSCORP], battlefield: lands('Mountain', 1) } });

  it('after the discard: played from the graveyard as the land play of the turn; it enters tapped and its owner loses 2 life (enters from a graveyard)', () => {
    let s = loot(board());
    expect(names(s, 'graveyard')).toContain(OSCORP);
    const play = playLand(s, OSCORP);
    expect(play).toBeDefined();
    s = drive(act(s, play!));
    s = s.zones.stack.length > 0 ? resolveTop(s) : s;
    const id = onField(s, OSCORP);
    expect(s.objects[id]!.tapped).toBe(true);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1); // CR 305.2a: it is the turn's land play
  });
  it('not for a card put into the graveyard another way, not on a later turn, and not once the land play is used (CR 702.187c, 305.2)', () => {
    const milled = scenario([OSCORP, 'Mountain'], { p1: { graveyard: [OSCORP], battlefield: lands('Mountain', 1) } });
    expect(playLand(milled, OSCORP)).toBeUndefined();
    const land = find(milled, OSCORP, 'graveyard', 'p1');
    expect(applyAction(milled, { type: 'playLand', player: 'p1', card: land }).error).toBeDefined();
    let s = loot(board());
    expect(playLand(s, OSCORP)).toBeDefined();
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(playLand(s, OSCORP)).toBeUndefined(); // only the turn it was discarded
    let t = loot(scenario(['Faithless Looting', OSCORP, 'Mountain'], { p1: { hand: ['Faithless Looting', OSCORP, 'Mountain'], battlefield: lands('Mountain', 1) } }));
    t = drive(act(t, playLand(t, 'Mountain')!));
    expect(playLand(t, OSCORP)).toBeUndefined(); // timing rules still apply: one land play
  });
  it('another land card discarded the same turn is not covered (the permission is the card\'s own, CR 113.6)', () => {
    let s = resolveTop(cast(scenario(['Faithless Looting', OSCORP, 'Mountain'], { p1: { hand: ['Faithless Looting', OSCORP, 'Mountain'], battlefield: lands('Mountain', 1) } }), 'Faithless Looting'));
    s = drive(answer(s, pick(find(s, 'Mountain', 'hand', 'p1'), s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!)));
    expect(names(s, 'graveyard')).toContain('Mountain');
    expect(playLand(s, 'Mountain')).toBeUndefined();
  });
});

// ---- CR 702.143: foretell -----------------------------------------------------------------------------------------------------------------------------------

describe('CR 702.143a-b, 116.2h, 406.3: foretell', () => {
  const COMET = card('Test Ember Comet', 'Sorcery', 'You gain 5 life.\nForetell {1}{R}', { cost: '{3}{R}{R}' });
  const FLARE = card('Test Ember Flare', 'Instant', 'You gain 2 life.\nForetell {R}', { cost: '{2}{R}' });
  const board = (): GameState => scenario(['Mountain'], { defs: [COMET, FLARE], p1: { hand: ['Test Ember Comet', 'Test Ember Flare'], battlefield: lands('Mountain', 4) }, p2: { battlefield: lands('Mountain', 2) } });

  it('the keyword is a capability and the cards compile full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:foretell')).toBe(true);
    expect(full(COMET)).toBe(true);
    expect(full(FLARE)).toBe(true);
  });
  it('foretelling: during your turn, pay {2} and exile the card from your hand face down; no stack, priority stays; only its owner may look at it', () => {
    let s = board();
    expect(labels(s)).toContain('Foretell Test Ember Comet ({2})');
    s = drive(act(s, special(s, 'Test Ember Comet')!));
    expect(tappedCount(s)).toBe(2);
    expect(s.zones.stack).toEqual([]);
    expect(s.pending?.kind).toBe('priority');
    expect(s.pending?.player).toBe('p1'); // CR 116.3
    const id = s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Ember Comet')!;
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(s.objects[id]!.chosen?.['foretold']).toBe(s.turn.number);
    expect(canSee(s, s.objects[id]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[id]!, 'p2')).toBe(false); // CR 406.3
    expect(s.log.some((l) => /Test Ember Comet/.test(l.text))).toBe(false); // the public log never names it
  });
  it('not on an opponent\'s turn, and not without {2} (CR 116.2h, 702.143a)', () => {
    const s = board();
    expect(special(s, 'Test Ember Comet', 'p2')).toBeUndefined();
    const poor = scenario(['Mountain'], { defs: [COMET], p1: { hand: ['Test Ember Comet'], battlefield: lands('Mountain', 1) } });
    expect(special(poor, 'Test Ember Comet')).toBeUndefined();
    const card0 = find(poor, 'Test Ember Comet', 'hand', 'p1');
    expect(applyAction(poor, { type: 'special', player: 'p1', kind: 'foretell', object: card0 }).error?.rules).toContain('CR 702.143a');
  });
  it('fail closed: foretell with no printed foretell cost (as another object would grant it) is not offered, so no card is exiled that could not be cast', () => {
    const bare = card('Test Costless Comet', 'Sorcery', 'You gain 5 life.\nForetell {1}{R}', { cost: '{3}{R}{R}' });
    for (const a of bare.faces[0]!.abilities) if (a.kind === 'keyword' && a.keyword === 'foretell') delete (a as { cost?: unknown }).cost;
    const s = scenario(['Mountain'], { defs: [bare], p1: { hand: ['Test Costless Comet'], battlefield: lands('Mountain', 4) } });
    expect(special(s, 'Test Costless Comet')).toBeUndefined();
  });
  it('cast from exile for its foretell cost, but only on a later turn; the spell resolves as itself', () => {
    let s = drive(act(board(), special(board(), 'Test Ember Comet')!));
    expect(castVia(s, 'Test Ember Comet', 'foretell')).toBeUndefined(); // the turn it was foretold
    s = mainOf(mainOf(s, 'p2'), 'p1');
    const via = castVia(s, 'Test Ember Comet', 'foretell');
    expect(via).toBeDefined();
    const before = tappedCount(s);
    s = drive(act(s, via!));
    expect(tappedCount(s) - before).toBe(2); // {1}{R}, not {3}{R}{R}
    const life = lifeOf(s, 'p1');
    s = resolveTop(s);
    expect(lifeOf(s, 'p1')).toBe(life + 5);
    expect(names(s, 'graveyard')).toContain('Test Ember Comet');
  });
  it('the card\'s own timing applies: a foretold instant may be cast on the opponent\'s turn; a sorcery may not', () => {
    let s = scenario(['Mountain'], { defs: [COMET, FLARE], p1: { hand: ['Test Ember Comet', 'Test Ember Flare'], battlefield: lands('Mountain', 6) } }); // 2 left untapped for p2's turn
    s = drive(act(s, special(s, 'Test Ember Flare')!));
    s = drive(act(s, special(s, 'Test Ember Comet')!));
    s = mainOf(s, 'p2');
    expect(castVia(s, 'Test Ember Flare', 'foretell', 'p2')).toBeUndefined(); // only its owner
    s = until(s, (t) => t.pending?.player === 'p1' && t.pending.kind === 'priority');
    expect(castVia(s, 'Test Ember Flare', 'foretell')).toBeDefined();
    expect(castVia(s, 'Test Ember Comet', 'foretell')).toBeUndefined();
  });
});

// ---- Sieges (CR 614.12a, 607.2d) ----------------------------------------------------------------------------------------------------------------------------

describe('CR 614.12a, 607.2d, 613.1f: a Siege has only the ability of the word chosen as it entered', () => {
  const SIEGE = card('Test Steppe Siege', 'Enchantment', 'As this enchantment enters, choose Abzan or Mardu.\n• Abzan — At the beginning of your end step, you gain 2 life.\n• Mardu — At the beginning of your end step, each opponent loses 2 life.');
  const GROVE = card('Test Grove Siege', 'Enchantment', 'As this enchantment enters, choose Temur or Sultai.\n• Temur — Creatures you control get +1/+0.\n• Sultai — You may play lands from your graveyard.');

  it('both compile full: the header and one static ability per word', () => {
    expect(full(SIEGE)).toBe(true);
    expect(full(GROVE)).toBe(true);
    const abilities = SIEGE.faces[0]!.abilities as { kind: string; chosenMode?: string; condition?: unknown }[];
    expect(abilities.map((a) => a.kind)).toEqual(['static', 'static', 'static']);
    expect(abilities[1]!.chosenMode).toBe('Abzan');
    expect(abilities[2]!.condition).toEqual({ cond: 'chosen', link: 'siege', equals: 'Mardu' });
  });
  it('the controller chooses as it enters; at the end step only the chosen ability triggers', () => {
    const run = (word: string): GameState => {
      let s = scenario([], { defs: [SIEGE], p1: { hand: ['Test Steppe Siege'] } });
      s = resolveTop(cast(s, 'Test Steppe Siege'));
      expect(s.pending?.kind).toBe('chooseOption');
      s = drive(answer(s, { kind: 'chooseOption', ids: [word] }));
      return until(s, (t) => t.turn.activePlayer === 'p2');
    };
    const abzan = run('Abzan');
    expect([lifeOf(abzan, 'p1'), lifeOf(abzan, 'p2')]).toEqual([22, 20]);
    const mardu = run('Mardu');
    expect([lifeOf(mardu, 'p1'), lifeOf(mardu, 'p2')]).toEqual([20, 18]);
  });
  it('a granted static ability works only for its word: "You may play lands from your graveyard" under Sultai, not under Temur', () => {
    const play = (word: string): Action | undefined => {
      let s = scenario(['Mountain'], { defs: [GROVE], p1: { hand: ['Test Grove Siege'], graveyard: ['Mountain'] } });
      s = resolveTop(cast(s, 'Test Grove Siege'));
      s = drive(s, options(word));
      return playLand(s, 'Mountain');
    };
    expect(play('Sultai')).toBeDefined();
    expect(play('Temur')).toBeUndefined();
  });
  it('fail closed: a bullet whose word is not one of the two choices, or an unknown choice word, stays manual', () => {
    expect(full(card('Test Odd Siege', 'Enchantment', 'As this enchantment enters, choose Abzan or Mardu.\n• Temur — Creatures you control get +1/+0.\n• Mardu — Creatures you control get +0/+1.'))).toBe(false);
    expect(full(card('Test Elf Siege', 'Enchantment', 'As this enchantment enters, choose Elves or Goblins.\n• Elves — Creatures you control get +1/+0.\n• Goblins — Creatures you control get +0/+1.'))).toBe(false);
  });
});

// ---- Cases: "To solve -- N or more sources you controlled dealt damage this turn" (CR 719.3a, 120.1, 400.7) ----------------------------------------------------

describe('CR 719.3a, 120.1, 400.7: "To solve -- Two or more sources you controlled dealt damage this turn."', () => {
  const CASE = card('Test Case of the Embers', 'Enchantment — Case', 'To solve — Two or more sources you controlled dealt damage this turn. (If unsolved, solve at the beginning of your end step.)\nSolved — At the beginning of your upkeep, you gain 1 life.');
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.');
  const isSolved = (s: GameState): boolean => {
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Case of the Embers')!;
    return (s.objects[id] as { solved?: boolean }).solved === true;
  };
  const endOfTurn = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p2');
  const sparkFace = (s0: GameState, n: number): GameState => {
    let s = s0;
    for (let i = 0; i < n; i++) {
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') });
      s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
      s = resolveTop(s);
    }
    return s;
  };
  it('the condition reads one way and the Case compiles full', () => {
    expect(full(CASE)).toBe(true);
    const c = CASE.faces[0]!.abilities[0] as { kind: string; solve?: unknown };
    expect(c.kind).toBe('case');
    expect(c.solve).toEqual({ cond: 'compare', left: { q: 'happenedDistinct', event: { ev: 'damage', source: { controller: 'you' } }, scope: 'turn', what: 'sources' }, op: '>=', right: 2 });
  });
  it('two different sources that dealt damage this turn: solved at the end step; one source, or none: not solved', () => {
    const board = (sparks: number): GameState => scenario([], { defs: [CASE, SPARK], p1: { battlefield: ['Test Case of the Embers'], hand: Array(sparks).fill('Test Spark') as string[] } });
    expect(isSolved(endOfTurn(sparkFace(board(2), 2)))).toBe(true);
    expect(isSolved(endOfTurn(sparkFace(board(1), 1)))).toBe(false);
    expect(isSolved(endOfTurn(board(0)))).toBe(false);
  });
  it('one source that dealt damage several times is one source (CR 120.1)', () => {
    const SPRAY = card('Test Ember Spray', 'Instant', 'Test Ember Spray deals 1 damage to each player.');
    let s = scenario([], { defs: [CASE, SPRAY], p1: { battlefield: ['Test Case of the Embers'], hand: ['Test Ember Spray'] } });
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Spray', 'hand', 'p1') })));
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([19, 19]);
    expect(isSolved(endOfTurn(s))).toBe(false);
  });
});

// ---- CR 702.142: boast ----------------------------------------------------------------------------------------------------------------------------------------

describe('CR 702.142a: "Boast -- [Cost]: [Effect]" (activate only if this creature attacked this turn and only once each turn)', () => {
  const BOASTER = card('Test Proud Skald', 'Creature — Human Warrior', 'Boast — {1}: You gain 2 life.', { pt: ['2', '2'] });
  const boastOf = (s: GameState): Action | undefined => legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === 'Test Proud Skald')?.action;
  const board = (): GameState => scenario(['Mountain'], { defs: [BOASTER], p1: { battlefield: ['Test Proud Skald', ...lands('Mountain', 2)] } });
  function attack(s0: GameState): GameState {
    let s = until(s0, (t) => t.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onField(s, 'Test Proud Skald'), defender: 'p2' }] });
    return until(s, (t) => t.turn.step === 'main2' && t.pending?.kind === 'priority');
  }
  it('the keyword is implemented and the card compiles full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:boast')).toBe(true);
    expect(full(BOASTER)).toBe(true);
  });
  it('not before the creature attacked this turn; after it attacked, once (CR 602.5b)', () => {
    let s = board();
    expect(boastOf(s)).toBeUndefined();
    s = attack(s);
    const via = boastOf(s);
    expect(via).toBeDefined();
    const life = lifeOf(s, 'p1');
    s = resolveTop(drive(act(s, via!)));
    expect(lifeOf(s, 'p1')).toBe(life + 2);
    expect(boastOf(s)).toBeUndefined(); // only once each turn
  });
  it('on a later turn in which it did not attack: not again', () => {
    let s = attack(board());
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(boastOf(s)).toBeUndefined();
  });
});

describe('CR 705.1-705.2: "Whenever you win a coin flip, ..." (event coinFlip)', () => {
  const WATCHER = card('Test Gambling Imp', 'Creature — Imp', 'Whenever you win a coin flip, you gain 3 life.\nWhenever you lose a coin flip, each opponent loses 1 life.', { pt: ['1', '1'] });
  const PLAIN = card('Test Plain Coin', 'Artifact', '{T}: Flip a coin.');
  // Tavern Scoundrel's shape: the object the flip is for has the coin-flip trigger itself
  const OWN = card('Test Coin Imp', 'Creature — Imp', 'Whenever you win a coin flip, you gain 3 life.\nWhenever you lose a coin flip, each opponent loses 1 life.\n{T}: Flip a coin.', { pt: ['1', '1'] });
  const flipOnce = (s0: GameState, name: string): GameState => {
    const src = onField(s0, name);
    return drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === src)!.action));
  };
  it('is automated', () => {
    expect(full(WATCHER)).toBe(true);
    expect(full(PLAIN)).toBe(true);
    expect(full(OWN)).toBe(true);
  });
  it('a flip for an object with its own coin-flip trigger is called; the trigger for the outcome fires, the other does not', () => {
    const activated = flipOnce(scenario([], { defs: [OWN], p1: { battlefield: ['Test Coin Imp'] } }), 'Test Coin Imp');
    const results = (['heads', 'tails'] as const).map((call) => {
      const s1 = resolveTop(activated);
      expect(s1.pending?.kind).toBe('chooseOption'); // CR 705.1: called
      let s = drive(answer(s1, { kind: 'chooseOption', ids: [call] }));
      for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = resolveTop(s);
      return [lifeOf(s, 'p1') - 20, lifeOf(s, 'p2') - 20].join('/');
    });
    expect(new Set(results)).toEqual(new Set(['3/0', '0/-1']));
  });
  it('CR 705.2: a flip for an object that does not care has no call and no winner, even beside another permanent\'s "whenever you win a coin flip"', () => {
    const s = resolveTop(flipOnce(scenario([], { defs: [WATCHER, PLAIN], p1: { battlefield: ['Test Gambling Imp', 'Test Plain Coin'] } }), 'Test Plain Coin'));
    expect(s.pending?.kind).toBe('priority'); // no call
    expect(s.zones.stack.length).toBe(0); // neither trigger
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([20, 20]);
  });
  it('with no card that cares, a plain flip is not called (no prompt)', () => {
    const s = resolveTop(flipOnce(scenario([], { defs: [PLAIN], p1: { battlefield: ['Test Plain Coin'] } }), 'Test Plain Coin'));
    expect(s.pending?.kind).toBe('priority');
  });
});

// ---- CR 400.11b: wishes ---------------------------------------------------------------------------------------------------------------------------------------

describe('CR 400.11b, 712.8a, 701.20a: a card you own from outside the game put into your hand', () => {
  const WISH = card('Test Grove Wish', 'Sorcery', 'You may reveal a creature or land card you own from outside the game and put it into your hand. Exile Test Grove Wish.');
  const SECRET = card('Test Secret Wish', 'Sorcery', 'You may put a card you own from outside the game into your hand.');
  const BEAR = card('Test Wish Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BOLT = card('Test Wish Bolt', 'Instant', 'Test Wish Bolt deals 3 damage to any target.');
  const board = (spell: string): GameState => {
    const s = scenario([], { defs: [WISH, SECRET, BEAR, BOLT], p1: { hand: [spell] } });
    return { ...s, outside: { p1: [BEAR.id, BOLT.id], p2: [BEAR.id] } };
  };
  it('both compile full', () => {
    expect(full(WISH)).toBe(true);
    expect(full(SECRET)).toBe(true);
  });
  it('reveal: only a card of the stated types is offered; it goes to the hand, revealed to every player; the wish exiles itself', () => {
    let s = resolveTop(cast(board('Test Grove Wish'), 'Test Grove Wish'));
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseOption');
    const opts = (s.pending as { options: { label: string }[] }).options.map((o) => o.label);
    expect(opts).toEqual(['Test Wish Bear']); // not the instant (CR 712.8a: its front face's characteristics)
    s = drive(answer(s, { kind: 'chooseOption', ids: [(s.pending as { options: { id: string }[] }).options[0]!.id] }));
    expect(names(s, 'hand')).toEqual(['Test Wish Bear']);
    const bear = find(s, 'Test Wish Bear', 'hand', 'p1');
    expect(canSee(s, s.objects[bear]!, 'p2')).toBe(true); // revealed (CR 701.20a)
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Grove Wish')).toBe(true);
  });
  it('not revealed: any card; only its owner sees it', () => {
    let s = resolveTop(cast(board('Test Secret Wish'), 'Test Secret Wish'));
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    const opts = (s.pending as { options: { id: string; label: string }[] }).options;
    expect(opts.map((o) => o.label)).toEqual(['Test Wish Bear', 'Test Wish Bolt']);
    s = drive(answer(s, { kind: 'chooseOption', ids: [opts[1]!.id] }));
    const bolt = find(s, 'Test Wish Bolt', 'hand', 'p1');
    expect(canSee(s, s.objects[bolt]!, 'p2')).toBe(false);
    expect(s.log.some((l) => /Test Wish Bolt/.test(l.text))).toBe(false);
  });
  it('with no such card outside the game (no sideboard), nothing happens', () => {
    let s = resolveTop(cast(scenario([], { defs: [WISH], p1: { hand: ['Test Grove Wish'] } }), 'Test Grove Wish'));
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('priority');
    expect(names(s, 'hand')).toEqual([]);
  });
});

describe('CR 702.143a, 607.2i: "If this spell was foretold, ..." reads the cast method of the spell itself', () => {
  const DRAFT = card('Test Bitter Draft', 'Instant', 'You gain 1 life. If this spell was foretold, you gain 3 life.\nForetell {1}', { cost: '{2}' });
  it('is automated, as wasCast via foretell', () => {
    expect(full(DRAFT)).toBe(true);
    expect(JSON.stringify(DRAFT.faces[0]!.abilities)).toContain('"cond":{"cond":"wasCast","via":"foretell"}');
  });
  it('cast from the hand: only the first gain; cast foretold on a later turn: both', () => {
    const board = (): GameState => scenario(['Mountain'], { defs: [DRAFT], p1: { hand: ['Test Bitter Draft'], battlefield: lands('Mountain', 4) } });
    const fromHand = resolveTop(cast(board(), 'Test Bitter Draft'));
    expect(lifeOf(fromHand, 'p1')).toBe(21);
    let s = drive(act(board(), special(board(), 'Test Bitter Draft')!));
    s = mainOf(mainOf(s, 'p2'), 'p1');
    s = resolveTop(drive(act(s, castVia(s, 'Test Bitter Draft', 'foretell')!)));
    expect(lifeOf(s, 'p1')).toBe(24);
  });
});

describe('CR 702.184a: "Each creature you control with toughness greater than its power stations permanents using its toughness rather than its power."', () => {
  const HULL = card('Test Drift Hull', 'Artifact — Spacecraft', 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)');
  const WARDEN = card('Test Loom Warden', 'Artifact Creature — Robot', 'Each creature you control with toughness greater than its power stations permanents using its toughness rather than its power.', { pt: ['3', '3'] });
  const WALL = card('Test Pale Wall', 'Creature — Wall', 'Defender', { pt: ['1', '4'] });
  const charge = (s: GameState): number => s.objects[onField(s, 'Test Drift Hull')]!.counters['charge'] ?? 0;
  function stationWithWall(withWarden: boolean): GameState {
    let s = scenario([], { defs: [HULL, WARDEN, WALL], p1: { battlefield: ['Test Drift Hull', 'Test Pale Wall', ...(withWarden ? ['Test Loom Warden'] : [])] } });
    const hull = onField(s, 'Test Drift Hull');
    const wall = onField(s, 'Test Pale Wall');
    s = act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === hull)!.action);
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending;
      if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [wall] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    expect(s.objects[wall]!.tapped).toBe(true);
    return resolveTop(s);
  }
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('a 1/4 stations for 4 under the rule, for 1 without it', () => {
    expect(charge(stationWithWall(true))).toBe(4);
    expect(charge(stationWithWall(false))).toBe(1);
  });
});

describe('CR 608.2c, 701.21a, 603.12: "Then sacrifice it if it has N or more <kind> counters on it. When you do, ..."', () => {
  const SPLATTER = card('Test Ink Splatter', 'Enchantment', 'At the beginning of your upkeep, put an ink counter on this enchantment. Then sacrifice it if it has two or more ink counters on it. When you do, you gain 5 life.');
  const inkOf = (s: GameState): number | undefined => {
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Ink Splatter');
    return id === undefined ? undefined : s.objects[id]!.counters['ink'] ?? 0;
  };
  const upkeepOfP1 = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'draw');
  it('is automated', () => expect(full(SPLATTER)).toBe(true));
  it('kept with one counter; sacrificed with the second, and only then the reflexive trigger gains life', () => {
    let s = scenario([], { defs: [SPLATTER], p1: { battlefield: ['Test Ink Splatter'] } });
    s = upkeepOfP1(mainOf(s, 'p2'));
    expect(inkOf(s)).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(20);
    s = upkeepOfP1(mainOf(s, 'p2'));
    expect(inkOf(s)).toBeUndefined();
    expect(names(s, 'graveyard')).toContain('Test Ink Splatter');
    expect(lifeOf(s, 'p1')).toBe(25);
  });
});

describe('CR 701.64: "Harness ~." and "∞ -- [Ability]" (the ability functions only while the permanent is harnessed)', () => {
  const STONE = card('Test Dawn Stone', 'Legendary Artifact — Infinity Stone', '{1}, {T}: Harness Test Dawn Stone. (Once harnessed, its ∞ ability is active.)\n∞ — At the beginning of your upkeep, you gain 2 life.');
  const harnessOf = (s: GameState): Action | undefined => legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === 'Test Dawn Stone' && !a.isMana)?.action;
  const nextUpkeep = (s: GameState): GameState => until(mainOf(s, 'p2'), (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'draw');
  const board = (): GameState => scenario(['Mountain'], { defs: [STONE], p1: { battlefield: ['Test Dawn Stone', ...lands('Mountain', 1)] } });
  it('is automated', () => expect(full(STONE)).toBe(true));
  it('not harnessed: no life at the upkeep; harnessed: the ∞ ability triggers', () => {
    expect(lifeOf(nextUpkeep(board()), 'p1')).toBe(20);
    let s = board();
    s = resolveTop(drive(act(s, harnessOf(s)!)));
    expect(s.objects[onField(s, 'Test Dawn Stone')]!.harnessed).toBe(true);
    expect(lifeOf(nextUpkeep(s), 'p1')).toBe(22);
  });
  it('a new object is not harnessed (CR 400.7)', () => {
    let s = board();
    s = resolveTop(drive(act(s, harnessOf(s)!)));
    const t = structuredClone(s);
    delete t.objects[onField(t, 'Test Dawn Stone')]!.harnessed;
    expect(lifeOf(nextUpkeep(t), 'p1')).toBe(20);
  });
});

describe('CR 122.1, 608.2h, 603.7: "return it to the battlefield with one fewer revival counter on it at the beginning of the next end step"', () => {
  const CAT = card('Test Many-Lives Cat', 'Creature — Cat', 'This creature enters with two revival counters on it if you cast it.\nWhen this creature dies, if it had a revival counter on it, return it to the battlefield with one fewer revival counter on it at the beginning of the next end step.', { pt: ['2', '2'] });
  const DOOM = card('Test Doom Word', 'Instant', 'Destroy target creature.');
  const revival = (s: GameState): number | undefined => {
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Many-Lives Cat');
    return id === undefined ? undefined : s.objects[id]!.counters['revival'] ?? 0;
  };
  const kill = (s0: GameState): GameState => {
    const cat = onField(s0, 'Test Many-Lives Cat');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Doom Word', 'hand', 'p1') });
    s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: cat }] }]);
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = resolveTop(s);
    return s;
  };
  const toNextMain = (s: GameState): GameState => mainOf(mainOf(s, 'p2'), 'p1');
  it('is automated (once the template is reviewed)', () => {
    expect(CAT.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    expect(JSON.stringify(CAT.faces[0]!.abilities)).toContain('"count":{"q":"math","op":"max","args":[0,{"q":"math","op":"-","args":[{"q":"counters","on":{"ref":"event","role":"subject"},"kind":"revival"},1]}]}');
  });
  it('cast: two counters; it dies and returns at the end step with one; again with none; then it stays dead', () => {
    let s = scenario([], { defs: [CAT, DOOM], p1: { hand: ['Test Many-Lives Cat', 'Test Doom Word', 'Test Doom Word', 'Test Doom Word'] } });
    s = resolveTop(cast(s, 'Test Many-Lives Cat'));
    expect(revival(s)).toBe(2);
    s = kill(s);
    expect(revival(s)).toBeUndefined();
    s = toNextMain(s); // the end step of this turn returns it
    expect(revival(s)).toBe(1);
    s = toNextMain(kill(s));
    expect(revival(s)).toBe(0);
    s = toNextMain(kill(s));
    expect(revival(s)).toBeUndefined(); // it had no revival counter: no return (CR 603.4)
    expect(names(s, 'graveyard')).toContain('Test Many-Lives Cat');
  });
});

describe('CR 702.187b, 118.9, 613.1f: "Each nonland card in your graveyard has mayhem. The mayhem cost is equal to its mana cost."', () => {
  const PATRON = card('Test Goblin Patron', 'Creature — Goblin', 'Each nonland card in your graveyard has mayhem. The mayhem cost is equal to its mana cost.', { pt: ['2', '2'] });
  const BOLT = card('Test Patron Bolt', 'Instant', 'Test Patron Bolt deals 2 damage to any target.', { cost: '{1}{R}' });
  it('is automated (once the template is reviewed)', () => {
    expect(PATRON.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    expect(JSON.stringify(PATRON.faces[0]!.abilities)).toContain('"keyword":"mayhem","text":"mayhem","costIsManaCost":true');
  });
  it('a nonland card discarded this turn is cast from the graveyard for its own mana cost; not one put there another way, not on a later turn', () => {
    const board = (graveyard: string[] = []): GameState => scenario(['Faithless Looting', 'Mountain'], {
      defs: [PATRON, BOLT], p1: { hand: ['Faithless Looting', 'Test Patron Bolt'], graveyard, battlefield: ['Test Goblin Patron', ...lands('Mountain', 3)] },
    });
    let s = resolveTop(cast(board(), 'Faithless Looting'));
    const bolt = find(s, 'Test Patron Bolt', 'hand', 'p1');
    s = drive(answer(s, pick(bolt, s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!)));
    const via = castVia(s, 'Test Patron Bolt', 'mayhem');
    expect(via).toBeDefined();
    const before = tappedCount(s);
    s = drive(act(s, via!), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(tappedCount(s) - before).toBe(2); // {1}{R}: its mana cost
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(castVia(board(['Test Patron Bolt']), 'Test Patron Bolt', 'mayhem')).toBeUndefined(); // not discarded this turn
  });
});

describe('CR 701.50a, 701.50d, 608.2h: "Target creature you control connives X, where X is ..." (X fixed once for the draw and the discard)', () => {
  const VAULT = card('Test Spy Vault', 'Artifact', '{T}: Target creature you control connives X, where X is the number of artifacts you control.');
  const BEAR = card('Test Vault Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const TRINKET = card('Test Vault Trinket', 'Artifact', '');
  it('is automated (once the template is reviewed)', () => {
    expect(VAULT.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
  });
  it('two artifacts: draw two, discard two, a +1/+1 counter for each nonland card discarded', () => {
    let s = scenario([], { defs: [VAULT, BEAR, TRINKET], p1: { battlefield: ['Test Spy Vault', 'Test Vault Trinket', 'Test Vault Bear'], hand: ['Test Vault Bear'] } });
    const vault = onField(s, 'Test Spy Vault');
    const bear = onField(s, 'Test Vault Bear');
    const handBefore = s.zones.hand['p1']!.length;
    s = drive(act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === vault)!.action), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }]);
    s = resolveTop(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const inHand = s.zones.hand['p1']!;
    expect(inHand.length).toBe(handBefore + 2);
    const nonland = inHand.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Vault Bear')!;
    const land = inHand.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!;
    s = drive(answer(s, pick(nonland, land)));
    expect(s.zones.hand['p1']!.length).toBe(handBefore);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
  });
});
