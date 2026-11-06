/**
 * Commander coordinator D, round edh-d-97 (EDHREC band 5,001-10,000, group graveyard-exile-cast part 2): the pieces of this round played through the engine with synthetic
 * cards (invented names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1; Bob (p2) is the opponent. Each test is named after
 * the rule it checks, with its negative case.
 *
 *   CR 107.3f, 603.3d, 608.2b   "When ~ dies, you may pay {X}. If you do, return another target Zombie creature card with mana value X from your graveyard to the battlefield."
 *                               (Relentless Dead): the target is chosen before X, X is chosen as the ability resolves and the target is checked with it
 *   CR 609.4b, 107.4c, 601.3     "Exile target nonland permanent. You may cast that card for as long as it remains exiled, and you may spend colorless mana as though it were mana of any
 *                               color to cast that spell." (Abstruse Appropriation): colorless mana pays the spell's colored symbols; other colors still don't
 *   CR 113.6k, 603.2, 406.2      "When you cast this spell, you may exile your hand. If you do, draw three cards." (Herigast): an empty hand is still exiled (ruling 2024-06-07)
 *   CR 702.119a, 613.1f, 118.9   "Each creature spell you cast has emerge. The emerge cost is equal to its mana cost." (Herigast)
 *   CR 608.2d, 101.4, 608.2c     "Reveal the top card of your library. Any opponent may have you put that card into your graveyard. If a player does, ~ deals damage to that player equal
 *                               to that card's mana value. Otherwise, put that card into your hand." (Sin Prodder; ruling 2016-04-08), four players
 *   CR 603.7c, 400.7, 404.1      "Sacrifice ~: When target creature is put into your graveyard this turn, return that card to the battlefield." (Saffi Eriksdotter; rulings 2021-03-19)
 *   CR 104.3, 119.3, 406.2       "You can't lose the game." / "Whenever you lose life, for each 1 life you lost, exile a permanent you control or a card from your hand or graveyard."
 *                               (Lich's Mastery; rulings 2018-04-27)
 *   CR 400.7a, 400.7h, 608.2g    "You may cast that card without paying its mana cost. If you cast a creature spell this way, it gains haste and "At the beginning of the end step, sacrifice
 *                               this creature."" (Strago and Relm; rulings 2025-06-06)
 *   CR 613.1f, 607.2a, 702.16    "Whenever equipped creature dies, exile it." / "As long as a card exiled with ~ has flying, equipped creature has flying. The same is true for ..."
 *                               (Eater of Virtue; rulings 2022-02-18)
 *   CR 611.2b, 613.1f, 601.3     "Exile the top card of your library. For as long as it remains exiled, it has "You may cast this card from exile as long as you've cast another spell this
 *                               turn."" (Monk Class level 3)
 *   CR 702.85b, 110.2a, 305.2    "As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped." (Averna, the Chaos Bloom; rulings 2020-11-10)
 * CR cites were checked against the Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt).
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { labels } from '../../m5/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { castCard } from '../../m5/announce/support';
import { act, answer, card, cast, drive, find, full, legal, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';

describe('"When ~ dies, you may pay {X}. If you do, return another target Zombie creature card with mana value X from your graveyard to the battlefield." (CR 107.3f, 603.3d, 608.2b; Relentless Dead)', () => {
  const LORD = card('Test Grave Lord', 'Creature — Zombie', 'When this creature dies, you may pay {X}. If you do, return another target Zombie creature card with mana value X from your graveyard to the battlefield.', '{0}', ['2', '2']);
  const KILL = card('Test Snuff', 'Instant', 'Destroy target creature.');
  const Z2 = card('Test Shambler', 'Creature — Zombie', '', '{1}{B}', ['2', '2'], ['B']);
  const Z3 = card('Test Ghoul', 'Creature — Zombie', '', '{2}{B}', ['3', '3'], ['B']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const defs = [LORD, KILL, Z2, Z3, BEAR];
  const start = (lands = 4): GameState => scenario(['Swamp'], {
    p1: { hand: ['Test Snuff'], battlefield: ['Test Grave Lord', ...Array<string>(lands).fill('Swamp')], graveyard: ['Test Shambler', 'Test Ghoul', 'Test Bear'] },
    p2: { graveyard: ['Test Ghoul'] }, defs,
  } as never);
  /** Kill the Lord; answer the trigger's target with `pick` (offered ids recorded), then pay (yes) and X. */
  function play(s0: GameState, pick: string | null, pay: boolean, x?: number): { s: GameState; offered: string[] } {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Snuff', 'hand', 'p1') });
    let offered: string[] = [];
    for (let guard = 0; guard < 40; guard++) {
      const p = s.pending;
      if (p?.kind === 'chooseTargets' && p.targetText.includes('Zombie')) {
        offered = p.objects.map((id) => `${s.objects[id]!.defId}@${s.objects[id]!.owner}`).sort();
        const id = pick === null ? undefined : p.objects.find((o) => s.objects[o]!.defId === pick);
        s = answer(s, { kind: 'chooseTargets', targets: id === undefined ? [] : [{ kind: 'object', id }] });
      } else if (p?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Grave Lord', 'battlefield', 'p1') }] });
      else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: pay });
      else if (p?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x ?? p.max });
      else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = passBoth(s);
      else break;
    }
    return { s, offered };
  }
  const onField = (s: GameState, name: string) => s.zones.battlefield.some((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === 'p1');
  const untapped = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Swamp' && !s.objects[id]!.tapped).length;

  it('is fully automated', () => expect(full(LORD)).toBe(true));
  it('CR 603.3d, 107.3f: the target is chosen before X has a value: every other Zombie creature card in YOUR graveyard is offered, whatever its mana value (not the Bear, not the Lord itself, not the opponent\'s Zombie)', () => {
    const { offered } = play(start(), 'Test Ghoul', false);
    expect(offered).toEqual(['Test Ghoul@p1', 'Test Shambler@p1']);
  });
  it('paying X equal to the target\'s mana value (3) returns it to the battlefield under your control', () => {
    const { s } = play(start(), 'Test Ghoul', true, 3);
    expect(onField(s, 'Test Ghoul')).toBe(true);
    expect(untapped(s)).toBe(1); // 3 of the 4 Swamps paid X
  });
  it('the negative case (CR 608.2b): paying an X the target\'s mana value is not (2 for the 3) leaves the target in the graveyard (the mana is still spent)', () => {
    const { s } = play(start(), 'Test Ghoul', true, 2);
    expect(onField(s, 'Test Ghoul')).toBe(false);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Ghoul')).toBe(true);
    expect(untapped(s)).toBe(2);
  });
  it('the negative case: declining to pay returns nothing', () => {
    const { s } = play(start(), 'Test Shambler', false);
    expect(onField(s, 'Test Shambler')).toBe(false);
    expect(untapped(s)).toBe(4);
  });
  it('the negative case: with too little mana (1 Swamp) the most X offered is 1 and the 2-mana Zombie does not return', () => {
    const { s } = play(start(1), 'Test Shambler', true);
    expect(onField(s, 'Test Shambler')).toBe(false);
  });
});

describe('"You may cast that card for as long as it remains exiled, and you may spend colorless mana as though it were mana of any color to cast that spell." (CR 609.4b, 107.4c, 601.3; Abstruse Appropriation)', () => {
  const TAKE = card('Test Void Taking', 'Instant', 'Exile target nonland permanent. You may cast that card for as long as it remains exiled, and you may spend colorless mana as though it were mana of any color to cast that spell.');
  const PLAIN = card('Test Plain Taking', 'Instant', 'Exile target nonland permanent. You may cast that card for as long as it remains exiled.');
  const ELK = card('Test Elk', 'Creature — Elk', '', '{1}{G}{G}', ['3', '3'], ['G']);
  const WASTE = card('Test Waste', 'Land', '{T}: Add {C}.');
  const defs = [TAKE, PLAIN, ELK, WASTE];
  const start = (spell: string, lands: string[]): GameState => scenario(['Mountain'], { p1: { hand: [spell], battlefield: lands }, p2: { battlefield: ['Test Elk'] }, defs } as never);
  const take = (s0: GameState, spell: string): GameState => resolveAll(cast(s0, spell, { targets: [[obj(find(s0, 'Test Elk', 'battlefield', 'p2'))]] }));
  const canCastElk = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Elk', 'exile', 'p2'));
  it('is fully automated', () => expect(full(TAKE)).toBe(true));
  it('three colorless mana pay {1}{G}{G}: the exiled creature card is cast and enters under your control', () => {
    const s1 = take(start('Test Void Taking', ['Test Waste', 'Test Waste', 'Test Waste']), 'Test Void Taking');
    expect(canCastElk(s1)).toBe(true);
    const s2 = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Elk', 'exile', 'p2') })));
    const elk = s2.zones.battlefield.find((id) => s2.objects[id]!.defId === 'Test Elk');
    expect(elk !== undefined && s2.objects[elk]!.controller === 'p1').toBe(true);
  });
  it('the negative case: without the rider, three colorless mana can\'t pay {G}{G}', () => {
    const s1 = take(start('Test Plain Taking', ['Test Waste', 'Test Waste', 'Test Waste']), 'Test Plain Taking');
    expect(canCastElk(s1)).toBe(false);
  });
  it('the negative case (review): in a legal cast, an answer that pays {G}{G} with red mana is refused; colorless or green mana pays it', () => {
    const s1 = take(start('Test Void Taking', ['Test Waste', 'Test Waste', 'Mountain', 'Mountain', 'Mountain']), 'Test Void Taking');
    const s2 = act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Elk', 'exile', 'p2') });
    const p = s2.pending as unknown as { kind: string; manaSources: { objectId: string; abilityKey: string }[] };
    expect(p.kind).toBe('payCost');
    const mountains = p.manaSources.filter((m) => s2.objects[m.objectId]!.defId === 'Mountain');
    let refused = false;
    let s3 = s2;
    try { s3 = answer(s2, { kind: 'payCost', auto: false, activations: mountains.map((m) => ({ objectId: m.objectId, abilityKey: m.abilityKey })) }); } catch { refused = true; }
    expect(refused || !s3.zones.stack.some((id) => s3.objects[id]!.defId === 'Test Elk')).toBe(true);
  });
  it('the negative case: the rider is about colorless mana only: red mana still can\'t pay {G}', () => {
    const s1 = take(start('Test Void Taking', ['Mountain', 'Mountain', 'Mountain']), 'Test Void Taking');
    expect(canCastElk(s1)).toBe(false);
  });
});

describe('"When you cast this spell, you may exile your hand. If you do, draw three cards." (CR 113.6k, 603.2, 406.2; Herigast, ruling 2024-06-07)', () => {
  const KITE = card('Test Ash Kite', 'Creature — Dragon', 'When you cast this spell, you may exile your hand. If you do, draw three cards.', '{0}', ['4', '4']);
  const defs = [KITE];
  const start = (hand: string[]): GameState => scenario([], { p1: { hand: ['Test Ash Kite', ...hand] }, defs } as never);
  const hand = (s: GameState) => s.zones.hand.p1!.length;
  it('is fully automated', () => expect(full(KITE)).toBe(true));
  it('choosing to: the two other cards in hand are exiled and three cards are drawn, before the spell resolves', () => {
    const s = drive(act(start(['Plains', 'Plains']), { type: 'cast', player: 'p1', card: find(start(['Plains', 'Plains']), 'Test Ash Kite', 'hand', 'p1') }), { yes: [true] });
    const r = drive(passBoth(s), { yes: [true] });
    expect(r.zones.exile.length).toBe(2);
    expect(hand(r)).toBe(3);
    expect(r.zones.stack.some((id) => r.objects[id]!.defId === 'Test Ash Kite')).toBe(true); // the trigger resolved first (CR 603.3)
  });
  it('ruling 2024-06-07: with no other card in hand you may still exile your hand, and you still draw three', () => {
    const s0 = start([]);
    const r = drive(passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ash Kite', 'hand', 'p1') }))), { yes: [true] });
    expect(hand(r)).toBe(3);
  });
  it('the negative case: declining leaves the hand and draws nothing', () => {
    const s0 = start(['Plains', 'Plains']);
    const r = drive(passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ash Kite', 'hand', 'p1') }))), { yes: [false] });
    expect(r.zones.exile.length).toBe(0);
    expect(hand(r)).toBe(2);
  });
});

describe('"Each creature spell you cast has emerge. The emerge cost is equal to its mana cost." (CR 702.119a, 613.1f, 118.9; Herigast)', () => {
  const GIVER = card('Test Rift Kite', 'Creature — Eldrazi Dragon', 'Flying\nEach creature spell you cast has emerge. The emerge cost is equal to its mana cost.', '{3}{R}', ['4', '4'], ['R']);
  const ELK = card('Test Great Elk', 'Creature — Elk', '', '{4}{G}', ['5', '5'], ['G']);
  const TWIN = card('Test Twin Elk', 'Creature — Elk', '', '{2}{G}{G}', ['4', '4'], ['G']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}{G}', ['2', '2'], ['G']);
  const WYRM = card('Test Wyrm', 'Creature — Wyrm', '', '{5}{G}', ['5', '5'], ['G']);
  const RITE = card('Test Growth Rite', 'Sorcery', 'You gain 5 life.', '{4}{G}');
  const defs = [GIVER, ELK, TWIN, BEAR, WYRM, RITE];
  const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
  const onField = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name);
  const board = (who: 'p1' | 'p2', mine: string[], hand: string, lands: number): GameState => scenario(['Forest'], {
    p1: { hand: [hand], battlefield: [...(who === 'p1' ? ['Test Rift Kite'] : []), ...mine, ...Array<string>(lands).fill('Forest')] }, p2: { battlefield: who === 'p2' ? ['Test Rift Kite'] : [] }, defs,
  } as never);
  const manaPaid = (s: GameState): number => s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.length;
  it('is fully automated', () => expect(full(GIVER)).toBe(true));
  it('a creature spell of yours can be cast for its emerge cost {4}{G} by sacrificing a mana value 3 creature: {1}{G} is paid', () => {
    let s = board('p1', ['Test Bear'], 'Test Great Elk', 2);
    expect(labels(s, 'p1')).toContain('Cast Test Great Elk (emerge)');
    s = castCard(s, 'Test Great Elk', { method: 'emerge' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Bear')!] });
    s = drive(s);
    expect(s.zones.stack.map((id) => nameOf(s, id))).toContain('Test Great Elk');
    expect(onField(s, 'Test Bear')).toBeUndefined();
    expect(manaPaid(s)).toBe(2);
  });
  it('the colored mana of the emerge cost is not reduced (ruling): sacrificing mana value 6 for {2}{G}{G} still pays {G}{G}', () => {
    let s = board('p1', ['Test Wyrm'], 'Test Twin Elk', 2);
    s = castCard(s, 'Test Twin Elk', { method: 'emerge' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Wyrm')!] });
    s = drive(s);
    expect(manaPaid(s)).toBe(2);
  });
  it('ruling 2024-06-07: the giver itself may be the creature sacrificed for the emerge cost it grants', () => {
    let s = board('p1', [], 'Test Great Elk', 1);
    s = castCard(s, 'Test Great Elk', { method: 'emerge' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Rift Kite')!] });
    s = drive(s);
    expect(s.zones.stack.map((id) => nameOf(s, id))).toContain('Test Great Elk');
    expect(manaPaid(s)).toBe(1); // {4}{G} less the giver's mana value 4: {G}
  });
  it('the negative cases: a noncreature spell has no emerge, and an opponent\'s giver gives your spells nothing', () => {
    expect(labels(board('p1', ['Test Bear'], 'Test Growth Rite', 5), 'p1')).not.toContain('Cast Test Growth Rite (emerge)');
    expect(labels(board('p2', ['Test Bear'], 'Test Great Elk', 5), 'p1')).not.toContain('Cast Test Great Elk (emerge)');
  });
});

describe('"As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped." (CR 702.85b, 110.2a, 305.2; Averna, the Chaos Bloom)', () => {
  const BLOOM = card('Test Chaos Bud', 'Creature — Elemental', 'As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped.', '{0}', ['2', '2']);
  const SPELL = card('Test Cascading Rite', 'Sorcery', 'Cascade\nYou gain 1 life.', '{3}');
  const SPARK = card('Test Spark', 'Instant', 'You gain 2 life.', '{1}');
  const defs = [BLOOM, SPELL, SPARK];
  const start = (bloom: boolean, library: string[]): GameState => scenario(['Forest', 'Island'], { p1: { hand: ['Test Cascading Rite'], battlefield: [...(bloom ? ['Test Chaos Bud'] : []), 'Plains', 'Plains', 'Plains', 'Plains'], library }, defs } as never);
  /** Cast the cascade spell and resolve the cascade: `land` the land card chosen (null: none), then whether to cast the spark. */
  function play(s0: GameState, land: string | null, castIt: boolean): { s: GameState; offered: string[] | null } {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cascading Rite', 'hand', 'p1') });
    let offered: string[] | null = null;
    for (let guard = 0; guard < 40; guard++) {
      const p = s.pending;
      if (p?.kind === 'chooseObjects' && p.prompt.startsWith('As you cascade')) {
        offered = p.options.map((id) => s.objects[id]!.defId).sort();
        const id = land === null ? undefined : p.options.find((o) => s.objects[o]!.defId === land);
        s = answer(s, { kind: 'chooseObjects', ids: id === undefined ? [] : [id] });
      } else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: castIt });
      else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = passBoth(s);
      else break;
    }
    return { s, offered };
  }
  const land = (s: GameState, name: string) => s.zones.battlefield.find((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === 'p1');
  it('is fully automated', () => expect(full(BLOOM)).toBe(true));
  it('CR 702.85b: after the exiling stops at the 1-mana card, one of the exiled LAND cards may be put onto the battlefield tapped; then the card may still be cast', () => {
    const { s, offered } = play(start(true, ['Forest', 'Island', 'Test Spark']), 'Island', true);
    expect(offered).toEqual(['Forest', 'Island']);
    const isl = land(s, 'Island');
    expect(isl).toBeDefined();
    expect(s.objects[isl!]!.tapped).toBe(true);
    expect(land(s, 'Forest')).toBeUndefined(); // only one land
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Spark')).toBe(true); // cast and resolved
    expect(s.zones.exile.length).toBe(0); // the rest went to the bottom
  });
  it('ruling 2020-11-10: it is not a land play (the land play of the turn is still there)', () => {
    const { s } = play(start(true, ['Forest', 'Test Spark']), 'Forest', false);
    expect(land(s, 'Forest')).toBeDefined();
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(0);
  });
  it('ruling 2020-11-10: with no nonland card of lesser mana value exiled, a land may still be put onto the battlefield', () => {
    const { s } = play(start(true, ['Forest']), 'Forest', false);
    expect(land(s, 'Forest')).toBeDefined();
  });
  it('the negative case: without the ability no land is offered and every exiled card goes to the bottom', () => {
    const { s, offered } = play(start(false, ['Forest', 'Island', 'Test Spark']), 'Island', false);
    expect(offered).toBeNull();
    expect(land(s, 'Island')).toBeUndefined();
  });
  it('the negative case: declining puts no land onto the battlefield', () => {
    const { s } = play(start(true, ['Forest', 'Test Spark']), null, false);
    expect(land(s, 'Forest')).toBeUndefined();
  });
});

describe('"Any opponent may have you put that card into your graveyard. If a player does, ~ deals damage to that player equal to that card\'s mana value. Otherwise, put that card into your hand." (CR 608.2d, 101.4, 608.2c; Sin Prodder ruling 2016-04-08)', () => {
  const PRODDER = card('Test Sin Goad', 'Creature — Devil', "Menace\nAt the beginning of your end step, reveal the top card of your library. Any opponent may have you put that card into your graveyard. If a player does, this creature deals damage to that player equal to that card's mana value. Otherwise, put that card into your hand.", '{0}', ['3', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}{R}', ['4', '3'], ['R']);
  const defs = [PRODDER, OGRE];
  // a four-player game: the starting player draws on turn 1 (CR 103.8a skips it only in a two-player game), so the first Ogre is drawn and the second is revealed
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Sin Goad'], library: ['Test Ogre', 'Test Ogre'] } } });
  /** Go to the end step and resolve the trigger; `yes` says which players choose to have it put into the graveyard. Returns the state and the players asked, in order. */
  function play(yes: Set<string>): { s: GameState; asked: string[] } {
    let s = start();
    const asked: string[] = [];
    for (let guard = 0; guard < 200; guard++) {
      const p = s.pending;
      if (!p) break;
      if (p.kind === 'yesNo') { asked.push(p.player); s = answer(s, { kind: 'yesNo', yes: yes.has(p.player) }); continue; }
      if (p.kind === 'order') { s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) }); continue; }
      if (p.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      if (p.kind === 'declareBlockers') { s = answer(s, { kind: 'declareBlockers', blocks: [] } as never); continue; }
      if (p.kind !== 'priority') throw new Error(`unexpected ${p.kind}`);
      if (s.turn.step === 'end' && s.zones.stack.length === 0 && asked.length > 0) break;
      if (s.turn.step === 'end' && s.zones.stack.length === 0 && s.log.some((l) => /Sin Goad/.test(l.text) && /reveal/i.test(l.text))) break;
      s = act(s, { type: 'pass', player: p.player });
      if (s.turn.number > 1) break;
    }
    return { s, asked };
  }
  const life = (s: GameState, p: string) => s.players.find((x) => x.id === p)!.life;
  const where = (s: GameState) => (s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Ogre') ? 'graveyard' : s.zones.hand.p1!.filter((id) => s.objects[id]!.defId === 'Test Ogre').length === 2 ? 'hand' : 'library');
  it('is fully automated', () => expect(full(PRODDER)).toBe(true));
  it('ruling 2016-04-08: the opponents are asked in turn order starting after you; the first who chooses to is dealt damage equal to the card\'s mana value (4) and no one else is asked', () => {
    const { s, asked } = play(new Set(['p3', 'p4']));
    expect(asked).toEqual(['p2', 'p3']);
    expect(where(s)).toBe('graveyard');
    expect(life(s, 'p3')).toBe(16);
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p4')).toBe(20);
  });
  it('the negative case: when no opponent chooses to, the card goes to your hand and no one is dealt damage', () => {
    const { s, asked } = play(new Set());
    expect(asked).toEqual(['p2', 'p3', 'p4']);
    expect(where(s)).toBe('hand');
    expect([life(s, 'p2'), life(s, 'p3'), life(s, 'p4')]).toEqual([20, 20, 20]);
  });
});

describe('"Sacrifice ~: When target creature is put into your graveyard this turn, return that card to the battlefield." (CR 603.7c, 400.7, 404.1; Saffi Eriksdotter rulings 2021-03-19)', () => {
  const SCOUT = card('Test Grave Scout', 'Creature — Human Scout', 'Sacrifice this creature: When target creature is put into your graveyard this turn, return that card to the battlefield.', '{0}', ['2', '2']);
  const KILL = card('Test Snuff', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const defs = [SCOUT, KILL, BEAR];
  const start = (bearOwner: 'p1' | 'p2'): GameState => scenario([], {
    p1: { hand: ['Test Snuff', 'Test Snuff'], battlefield: ['Test Grave Scout', ...(bearOwner === 'p1' ? ['Test Bear'] : [])] }, p2: { battlefield: bearOwner === 'p2' ? ['Test Bear'] : [] }, defs,
  } as never);
  const bearOn = (s: GameState) => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear');
  const sacrifice = (s0: GameState, owner: 'p1' | 'p2'): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Grave Scout', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action), { targets: [[obj(find(s0, 'Test Bear', 'battlefield', owner))]] }));
  };
  const snuff = (s: GameState): GameState => resolveAll(cast(s, 'Test Snuff', { targets: [[obj(bearOn(s)!)]] }));
  it('is fully automated', () => expect(full(SCOUT)).toBe(true));
  it('your creature that dies this turn comes back to the battlefield (a new object, CR 400.7)', () => {
    const s1 = sacrifice(start('p1'), 'p1');
    const before = bearOn(s1);
    const s2 = snuff(s1);
    const after = bearOn(s2);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(s2.objects[after!]!.controller).toBe('p1');
  });
  it('ruling 2021-03-19: it works only once: the returned creature is a new object, and when it dies again it stays in the graveyard', () => {
    const s2 = snuff(sacrifice(start('p1'), 'p1'));
    const s3 = snuff(s2);
    expect(bearOn(s3)).toBeUndefined();
  });
  it('the negative case (CR 404.1): an opponent\'s creature goes to its owner\'s graveyard, not yours, so it does not come back', () => {
    const s2 = snuff(sacrifice(start('p2'), 'p2'));
    expect(bearOn(s2)).toBeUndefined();
    expect(s2.zones.graveyard.p2!.some((id) => s2.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
});

describe('"You can\'t lose the game." and "Whenever you lose life, for each 1 life you lost, exile a permanent you control or a card from your hand or graveyard." (CR 104.3, 119.3, 406.2; Lich\'s Mastery rulings 2018-04-27)', () => {
  const LICH = card('Test Lich Pact', 'Legendary Enchantment', "You can't lose the game.\nWhenever you lose life, for each 1 life you lost, exile a permanent you control or a card from your hand or graveyard.\nWhen this enchantment leaves the battlefield, you lose the game.");
  const DRAIN = card('Test Blood Price', 'Instant', 'You lose 3 life.');
  const BIG = card('Test Bleed Out', 'Instant', 'You lose 25 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const defs = [LICH, DRAIN, BIG, BEAR];
  /** Cast the spell; answer the exile choice with the names in `pick` (by name, first match each). */
  function play(spell: string, zones: { battlefield?: string[]; hand?: string[]; graveyard?: string[] }, pick: string[]): { s: GameState; offered: number } {
    const s0 = scenario([], { p1: { hand: [spell, ...(zones.hand ?? [])], battlefield: ['Test Lich Pact', ...(zones.battlefield ?? [])], graveyard: zones.graveyard ?? [] }, defs } as never);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') });
    let offered = -1;
    for (let guard = 0; guard < 40; guard++) {
      const p = s.pending;
      if (p?.kind === 'chooseObjects') {
        offered = p.options.length;
        const ids: string[] = [];
        for (const n of pick) { const id = p.options.find((o) => s.objects[o]!.defId === n && !ids.includes(o)); if (id) ids.push(id); }
        s = answer(s, { kind: 'chooseObjects', ids: ids.slice(0, p.max) });
      } else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = passBoth(s);
      else break;
    }
    return { s, offered };
  }
  const exiled = (s: GameState) => s.zones.exile.map((id) => s.objects[id]!.defId).sort();
  it('is fully automated', () => expect(full(LICH)).toBe(true));
  it('losing 3 life: you exile three, from any mix of your permanents, hand and graveyard (ruling)', () => {
    const { s, offered } = play('Test Blood Price', { battlefield: ['Test Bear'], hand: ['Test Bear'], graveyard: ['Test Bear', 'Test Bear'] }, ['Test Bear', 'Test Bear', 'Test Bear']);
    expect(offered).toBe(6); // the Lich Pact and the Bear on the battlefield, one in hand, two in the graveyard and the spell, which has resolved into the graveyard
    expect(exiled(s)).toEqual(['Test Bear', 'Test Bear', 'Test Bear']);
  });
  it('ruling 2018-04-27: with fewer things than life lost you exile everything you can, the enchantment itself too, and then lose the game by its last ability', () => {
    const { s } = play('Test Blood Price', { battlefield: ['Test Bear'] }, []);
    expect(exiled(s)).toEqual(['Test Bear', 'Test Blood Price', 'Test Lich Pact']); // three things for 3 life: the Bear, the resolved spell in the graveyard and the enchantment
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true);
  });
  it('CR 104.3a (and the negative case): at 0 or less life you do not lose while it is on the battlefield', () => {
    const { s } = play('Test Bleed Out', { hand: Array<string>(30).fill('Test Bear') }, Array<string>(25).fill('Test Bear'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBeLessThanOrEqual(0);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Lich Pact')).toBe(true);
  });
});

describe('"Target opponent exiles cards ... until they exile an instant, sorcery, or creature card. You may cast that card without paying its mana cost. If you cast a creature spell this way, it gains haste and "At the beginning of the end step, sacrifice this creature."" (CR 400.7a, 400.7h, 608.2g; Strago and Relm)', () => {
  const SKETCH = card('Test Sketch Painter', 'Creature — Human Wizard', '{T}: Target opponent exiles cards from the top of their library until they exile an instant, sorcery, or creature card. You may cast that card without paying its mana cost. If you cast a creature spell this way, it gains haste and "At the beginning of the end step, sacrifice this creature." Activate only as a sorcery.', '{0}', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}{R}', ['4', '3'], ['R']);
  const BOLT = card('Test Zap', 'Instant', 'You gain 2 life.', '{R}');
  const defs = [SKETCH, OGRE, BOLT];
  const start = (top: string): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Sketch Painter', since: -1 } as never] }, p2: { library: ['Plains', top] }, defs } as never);
  const activate = (s0: GameState, yes: boolean): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Sketch Painter', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action), { targets: [[{ kind: 'player', id: 'p2' }]] }), { yes: [yes] });
  };
  const ogre = (s: GameState) => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Ogre');
  it('is fully automated', () => expect(full(SKETCH)).toBe(true));
  it('CR 400.7a: the opponent\'s creature card cast this way enters under your control with haste and the end-step sacrifice ability, and is sacrificed at the beginning of the end step', () => {
    let s = activate(start('Test Ogre'), true);
    const id = ogre(s)!;
    expect(id).toBeDefined();
    expect(s.objects[id]!.controller).toBe('p1');
    const c = getChars(s, id);
    expect(c.keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect(c.abilities.some((a) => a.def.kind === 'triggered' && a.def.text.startsWith('At the beginning of the end step'))).toBe(true);
    for (let guard = 0; guard < 60 && s.turn.number === 1 && ogre(s) !== undefined; guard++) {
      const p = s.pending!;
      if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else throw new Error(`unexpected ${p.kind}`);
    }
    expect(ogre(s)).toBeUndefined();
    expect(s.zones.graveyard.p2!.some((i) => s.objects[i]!.defId === 'Test Ogre')).toBe(true); // to its owner's graveyard
  });
  it('the negative case: an instant cast this way is not a creature spell and gains nothing (the cast still happens)', () => {
    const s = activate(start('Test Zap'), true);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
  it('the negative case: declining the cast leaves the card in exile and nothing gains haste', () => {
    const s = activate(start('Test Ogre'), false);
    expect(ogre(s)).toBeUndefined();
    expect(s.zones.exile.some((i) => s.objects[i]!.defId === 'Test Ogre')).toBe(true);
  });
});

describe('"As long as a card exiled with ~ has flying, equipped creature has flying. The same is true for first strike, ..., protection, reach, trample, and vigilance." (CR 613.1f, 607.2a, 702.16; Eater of Virtue rulings 2022-02-18)', () => {
  const EATER = card('Test Virtue Eater', 'Legendary Artifact — Equipment', 'Whenever equipped creature dies, exile it.\nEquipped creature gets +2/+0.\nAs long as a card exiled with this Equipment has flying, equipped creature has flying. The same is true for first strike, double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample, and vigilance.\nEquip {0}');
  const FLYER = card('Test Red Ward Bird', 'Creature — Bird', 'Flying\nProtection from red\nWard {2}', '{0}', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const KILL = card('Test Snuff', 'Instant', 'Destroy target creature.');
  const EXILE = card('Test Banish', 'Instant', 'Exile target creature.');
  const defs = [EATER, FLYER, BEAR, KILL, EXILE];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Snuff', 'Test Banish'], battlefield: ['Test Virtue Eater', { name: 'Test Red Ward Bird', since: -1 }, { name: 'Test Bear', since: -1 }] }, defs } as never);
  const equip = (s0: GameState, to: string): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Virtue Eater', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action), { targets: [[obj(find(s0, to, 'battlefield', 'p1'))]] }));
  };
  const kw = (s: GameState, name: string) => getChars(s, find(s, name, 'battlefield', 'p1')).keywords.map((k) => k.keyword === 'protection' ? `protection:${String((k as { quality?: string }).quality)}` : k.keyword).sort();
  it('is fully automated', () => expect(full(EATER)).toBe(true));
  it('the equipped creature that dies is exiled with it; the next equipped creature has its flying and its protection from red (ruling: protection abilities too), not its ward', () => {
    let s = equip(start(), 'Test Red Ward Bird');
    s = resolveAll(cast(s, 'Test Snuff', { targets: [[obj(find(s, 'Test Red Ward Bird', 'battlefield', 'p1'))]] }));
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Red Ward Bird')).toBe(true);
    expect(kw(s, 'Test Bear')).toEqual([]);
    s = equip(s, 'Test Bear');
    expect(kw(s, 'Test Bear')).toEqual(['flying', 'protection:color:R']);
    expect(Number(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1')).power)).toBe(4);
  });
  it('the negative case (CR 607.2a): a card exiled some other way is not exiled with it and gives nothing', () => {
    let s = start();
    s = resolveAll(cast(s, 'Test Banish', { targets: [[obj(find(s, 'Test Red Ward Bird', 'battlefield', 'p1'))]] }));
    s = equip(s, 'Test Bear');
    expect(kw(s, 'Test Bear')).toEqual([]);
  });
});

describe('"Exile the top card of your library. For as long as it remains exiled, it has "You may cast this card from exile as long as you\'ve cast another spell this turn."" (CR 611.2b, 613.1f, 601.3; Monk Class level 3)', () => {
  const MONK = card('Test Monk Shrine', 'Artifact', '{T}: Exile the top card of your library. For as long as it remains exiled, it has "You may cast this card from exile as long as you\'ve cast another spell this turn."');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 2 life.', '{0}');
  const defs = [MONK, BEAR, SPARK];
  const start = (): GameState => scenario(['Forest'], { p1: { hand: ['Test Spark'], battlefield: ['Test Monk Shrine', 'Forest', 'Forest'], library: ['Test Bear'] }, defs } as never);
  const activate = (s0: GameState): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Monk Shrine', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action)));
  };
  const canCastBear = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => a.object === s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Bear'));
  it('is fully automated', () => expect(full(MONK)).toBe(true));
  it('the negative case: before you have cast another spell this turn the exiled card can\'t be cast', () => {
    const s = activate(start());
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(canCastBear(s)).toBe(false);
  });
  it('once you have cast another spell this turn, the exiled card has the ability and you may cast it from exile', () => {
    let s = activate(start());
    s = resolveAll(cast(s, 'Test Spark'));
    expect(canCastBear(s)).toBe(true);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Bear')! })));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
});
