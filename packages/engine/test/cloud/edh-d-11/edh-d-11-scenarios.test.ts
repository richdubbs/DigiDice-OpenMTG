/**
 * Commander lane edh-d, round edh-d-11 (EDHREC ranks 11,251-12,500): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), fetched in the session.
 *
 *   CR 205.4a, 205.3m, 613.4c     "Other snow and Zombie creatures you control get +1/+1."
 *   CR 702.16j-k, 607.2d, 506.4   "As this creature enters, choose a player. This creature has protection from the chosen player."
 *   CR 603.2c, 701.21a            "Whenever one or more players sacrifice one or more creatures, you create a tapped Treasure token. This ability triggers only once each turn."
 *   CR 120.3, 608.2h              "When this creature enters, it deals 1 damage to target opponent for each creature card in your graveyard." (eff.damage.foreach made stable)
 *   CR 607.2a, 110.2a, 400.3      "When this creature dies, put each permanent card exiled with it onto the battlefield under the control of that card's owner."
 *   CR 120.3, 122.1, 608.2h      "Whenever you cast a creature spell, put two +1/+1 counters on this creature. If that spell has mana value 5 or greater, this creature deals damage equal to the number of counters on it to each opponent."
 *   CR 701.50a, 120.2, 603.2        "Whenever this creature deals combat damage to a player, it connives X, where X is the amount of damage it dealt to that player."
 *   CR 701.20a, 608.2d, 110.2        "At the beginning of each player's upkeep, that player reveals the top card of their library. If it's an artifact, creature, enchantment, or land card, the player may put it onto the battlefield."
 *   CR 701.58a, 700.2             "{2}, Sacrifice this artifact: Choose one -- Cloak the top card of your library. / Goad target creature. / Draw a card." (eff.m6.cloak.top made stable)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { canBeTargeted, hasProtectionFrom } from '../../../src/rules/protection';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m3/scenario';
import { attackWith } from '../cmd3/helpers';
import { card, cast, counters, full, inYard, named, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

describe('CR 205.4a, 205.3m, 613.4c: "Other snow and Zombie creatures you control get +1/+1."', () => {
  const KING = card('Test Frost King', 'Legendary Snow Creature — Zombie Wizard', 'Other snow and Zombie creatures you control get +1/+1.', ['3', '3']);
  const SNOWMAN = card('Test Snowman', 'Snow Creature — Elemental', '', ['1', '1']);
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', ['2', '2']);
  const SOLDIER = card('Test Soldier', 'Creature — Human Soldier', '', ['2', '2']);
  const SNOWGHOUL = card('Test Snow Ghoul', 'Snow Creature — Zombie', '', ['1', '1']);
  const game = (): GameState => scenario([], {
    defs: [KING, SNOWMAN, GHOUL, SOLDIER, SNOWGHOUL],
    p1: { battlefield: ['Test Frost King', 'Test Snowman', 'Test Ghoul', 'Test Soldier', 'Test Snow Ghoul'] },
    p2: { battlefield: ['Test Ghoul', 'Test Snowman'] },
  });
  it('is full', () => expect(full(KING)).toBe(true));
  it('gives +1/+1 to your other snow creatures and your other Zombies, once to a snow Zombie', () => {
    const s = game();
    expect(pt(s, find(s, 'Test Snowman', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Ghoul', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Snow Ghoul', 'battlefield', 'p1'))).toBe('2/2');
  });
  it('negative: not the source itself, not a creature that is neither, not an opponent\'s', () => {
    const s = game();
    expect(pt(s, find(s, 'Test Frost King', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Soldier', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Ghoul', 'battlefield', 'p2'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Snowman', 'battlefield', 'p2'))).toBe('1/1');
  });
});

describe('CR 702.16j-k, 607.2d: "As this creature enters, choose a player. This creature has protection from the chosen player."', () => {
  const NEMESIS = card('Test Unnamed Foe', 'Creature — Merfolk Rogue', 'As this creature enters, choose a player.\nThis creature has protection from the chosen player.', ['3', '1']);
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const entered = (choose: 'p1' | 'p2'): GameState => resolveAll(cast(scenario([], { defs: [NEMESIS, BOLT, BEAR], p1: { hand: ['Test Unnamed Foe'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } }), 'Test Unnamed Foe', { option: choose }), { option: choose });
  it('is full', () => expect(full(NEMESIS)).toBe(true));
  it('chosen player p2: p2\'s permanents can neither target it nor are blocked/damage sources against it, p1\'s can', () => {
    const s = entered('p2');
    const foe = getChars(s, find(s, 'Test Unnamed Foe', 'battlefield', 'p1'))!;
    const mine = getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!;
    const theirs = getChars(s, find(s, 'Test Bear', 'battlefield', 'p2'))!;
    expect(hasProtectionFrom(foe, theirs)).toBe(true); // damage, blocking and enchanting go through the same check (CR 702.16e-f)
    expect(canBeTargeted(foe, 'p1', theirs, 'p2')).toBe(false); // CR 702.16b: a spell or ability p2 controls can't target it
    expect(hasProtectionFrom(foe, mine)).toBe(false);
    expect(canBeTargeted(foe, 'p1', mine, 'p1')).toBe(true);
  });
  it('negative: choosing p1 (its controller) leaves it unprotected from p2', () => {
    const s = entered('p1');
    const foe = getChars(s, find(s, 'Test Unnamed Foe', 'battlefield', 'p1'))!;
    const theirs = getChars(s, find(s, 'Test Bear', 'battlefield', 'p2'))!;
    expect(hasProtectionFrom(foe, theirs)).toBe(false);
    expect(canBeTargeted(foe, 'p1', theirs, 'p2')).toBe(true);
  });
  it('negative: with no choice made (put onto the battlefield some other way) it has no protection at all (CR 607.2d)', () => {
    const s = scenario([], { defs: [NEMESIS, BEAR], p1: { battlefield: ['Test Unnamed Foe'] }, p2: { battlefield: ['Test Bear'] } });
    const foe = getChars(s, find(s, 'Test Unnamed Foe', 'battlefield', 'p1'))!;
    const theirs = getChars(s, find(s, 'Test Bear', 'battlefield', 'p2'))!;
    expect(hasProtectionFrom(foe, theirs)).toBe(false);
  });
});

describe('CR 603.2c, 701.21a: "Whenever one or more players sacrifice one or more creatures, you create a tapped Treasure token. This ability triggers only once each turn."', () => {
  const IMP = card('Test Hoard Imp', 'Creature — Imp', 'Whenever one or more players sacrifice one or more creatures, you create a tapped Treasure token. This ability triggers only once each turn.', ['1', '1']);
  const CULL = card('Test Cull', 'Sorcery', 'Each player sacrifices a creature.');
  const SNIP = card('Test Snip', 'Sorcery', 'Each opponent sacrifices a creature.');
  const SHAVE = card('Test Shave', 'Sorcery', 'Each opponent sacrifices an artifact.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const game = (hand: string[], p1: string[], p2: string[]): GameState => scenario([], { defs: [IMP, CULL, SNIP, SHAVE, BEAR, TRINKET], p1: { hand, battlefield: p1 }, p2: { battlefield: p2 } });
  const treasures = (s: GameState): number => tokens(s, 'p1').filter((id) => s.objects[id]!.defId.includes('Treasure')).length;
  it('is full', () => expect(full(IMP)).toBe(true));
  it('both players sacrifice at once: one Treasure, not one for each player; the token enters tapped', () => {
    const s = resolveAll(cast(game(['Test Cull'], ['Test Hoard Imp'], ['Test Bear']), 'Test Cull'));
    expect(treasures(s)).toBe(1);
    const t = tokens(s, 'p1').find((id) => s.objects[id]!.defId.includes('Treasure'))!;
    expect(s.objects[t]!.tapped).toBe(true);
  });
  it('an opponent sacrifices a creature: a Treasure; a second sacrifice the same turn gives none (once each turn)', () => {
    let s = resolveAll(cast(game(['Test Snip', 'Test Snip'], ['Test Hoard Imp'], ['Test Bear', 'Test Bear']), 'Test Snip'));
    expect(treasures(s)).toBe(1);
    s = resolveAll(cast(s, 'Test Snip'));
    expect(treasures(s)).toBe(1);
    expect(named(s, 'Test Bear')).toHaveLength(0);
  });
  it('the whole batch is ONE occurrence even without the once-per-turn limit: both players sacrificing two creatures gains 1 life, not 2 or 4', () => {
    const ECHO = card('Test Echo Imp', 'Creature — Imp', 'Whenever one or more players sacrifice one or more creatures, you gain 1 life.', ['1', '1']);
    const SWEEP = card('Test Double Cull', 'Sorcery', 'Each player sacrifices two creatures.');
    const g = scenario([], { defs: [ECHO, SWEEP, BEAR], p1: { hand: ['Test Double Cull'], battlefield: ['Test Echo Imp', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    const s = resolveAll(cast(g, 'Test Double Cull'));
    expect(life(s, 'p1')).toBe(21);
  });
  it('negative: sacrificing an artifact (not a creature) makes no Treasure', () => {
    const s = resolveAll(cast(game(['Test Shave'], ['Test Hoard Imp'], ['Test Trinket']), 'Test Shave'));
    expect(treasures(s)).toBe(0);
    expect(inYard(s, 'Test Trinket', 'p2')).toBe(true);
  });
});

describe('CR 120.3, 608.2h: "When this creature enters, it deals 1 damage to target opponent for each creature card in your graveyard."', () => {
  const PIT = card('Test Pit Giant', 'Creature — Giant', 'When this creature enters, it deals 1 damage to target opponent for each creature card in your graveyard.', ['4', '4']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
  const game = (mine: string[], theirs: string[]): GameState => scenario([], { defs: [PIT, BEAR, RITE], p1: { hand: ['Test Pit Giant'], graveyard: mine }, p2: { graveyard: theirs } });
  it('is full', () => expect(full(PIT)).toBe(true));
  it('three creature cards and a sorcery in your graveyard: 3 damage to the opponent only', () => {
    const s = resolveAll(cast(game(['Test Bear', 'Test Bear', 'Test Bear', 'Test Rite'], ['Test Bear']), 'Test Pit Giant'), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: an empty graveyard (the opponent\'s creature cards do not count) deals 0', () => {
    const s = resolveAll(cast(game([], ['Test Bear', 'Test Bear']), 'Test Pit Giant'), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 701.58a, 700.2: "{2}, Sacrifice this artifact: Choose one -- Cloak the top card of your library. / Goad target creature. / Draw a card."', () => {
  const NOTE = card('Test Ransom Slip', 'Artifact — Clue', '{2}, Sacrifice this artifact: Choose one —\n• Cloak the top card of your library.\n• Goad target creature.\n• Draw a card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const TOP = card('Test Top Card', 'Sorcery', 'You gain 1 life.');
  const game = (): GameState => scenario(['Plains', 'Plains'], { defs: [NOTE, BEAR, TOP], p1: { battlefield: ['Test Ransom Slip', 'Plains', 'Plains'], library: ['Test Top Card'] }, p2: { battlefield: ['Test Bear'] } });
  const use = (label: string): GameState => {
    const s0 = game();
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Ransom Slip', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let g = 0; g < 12 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending as { kind: string; options?: { id: string; label: string }[] };
      if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [d.options!.find((o) => o.label.includes(label))!.id] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'battlefield', 'p2') }] });
      else break;
    }
    return resolveAll(s);
  };
  it('is full', () => expect(full(NOTE)).toBe(true));
  it('the cloak mode puts the top card of your library onto the battlefield face down as a 2/2 creature', () => {
    const s = use('Cloak');
    const cloaked = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown && s.objects[id]!.controller === 'p1');
    expect(cloaked).toHaveLength(1);
    expect(s.objects[cloaked[0]!]!.defId).toBe('Test Top Card');
    expect(pt(s, cloaked[0]!)).toBe('2/2');
  });
  it('negative: the draw mode cloaks nothing and draws the top card', () => {
    const s = use('Draw');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown)).toHaveLength(0);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Top Card')).toBe(true);
  });
});

describe('CR 607.2a, 110.2a, 400.3: "When this creature dies, put each permanent card exiled with it onto the battlefield under the control of that card\'s owner."', () => {
  const WARDEN = card('Test Crypt Warden', 'Creature — Zombie', 'Landfall — Whenever a land you control enters, exile target permanent card with mana value 3 or less from your graveyard.\nWhen this creature dies, put each permanent card exiled with it onto the battlefield under the control of that card\'s owner.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const game = (): GameState => scenario([], { defs: [WARDEN, BEAR, RITE, SMITE], p1: { hand: ['Plains', 'Test Smite'], battlefield: ['Test Crypt Warden'], graveyard: ['Test Bear', 'Test Rite'] } });
  it('is full', () => expect(full(WARDEN)).toBe(true));
  it('exiles a permanent card with landfall, then returns it to the battlefield (never the sorcery) when the Warden dies', () => {
    let s = settle(act(game(), { type: 'playLand', player: 'p1', card: find(game(), 'Plains', 'hand', 'p1') }), { targets: [{ kind: 'object', id: find(game(), 'Test Bear', 'graveyard', 'p1') }] });
    s = resolveAll(s, { targets: [{ kind: 'object', id: find(s, 'Test Bear', 'graveyard', 'p1') }] });
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(named(s, 'Test Bear')).toHaveLength(0);
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: find(s, 'Test Crypt Warden', 'battlefield', 'p1') }] }));
    expect(named(s, 'Test Bear')).toHaveLength(1);
    expect(s.objects[named(s, 'Test Bear')[0]!]!.controller).toBe('p1');
    expect(inYard(s, 'Test Rite')).toBe(true);
  });
  it('negative: with nothing exiled by it, its death returns nothing', () => {
    const s = resolveAll(cast(game(), 'Test Smite', { targets: [{ kind: 'object', id: find(game(), 'Test Crypt Warden', 'battlefield', 'p1') }] }));
    expect(named(s, 'Test Bear')).toHaveLength(0);
    expect(inYard(s, 'Test Bear')).toBe(true);
  });
});

describe('CR 120.3, 122.1, 608.2h: "Whenever you cast a creature spell, put two +1/+1 counters on this creature. If that spell has mana value 5 or greater, this creature deals damage equal to the number of counters on it to each opponent."', () => {
  const HERALD = card('Test Banner Herald', 'Creature — Giant', 'Trample\nWhenever you cast a creature spell, put two +1/+1 counters on this creature. If that spell has mana value 5 or greater, this creature deals damage equal to the number of counters on it to each opponent.', ['2', '2']);
  const BIG = card('Test Big Beast', 'Creature — Beast', '', ['5', '5'], '{5}');
  const SMALL = card('Test Small Beast', 'Creature — Beast', '', ['1', '1'], '{1}');
  const game = (): GameState => scenario([], { defs: [HERALD, BIG, SMALL], p1: { hand: ['Test Big Beast', 'Test Small Beast'], battlefield: ['Test Banner Herald', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  it('is full', () => expect(full(HERALD)).toBe(true));
  it('a mana value 5 creature spell: two counters, then damage equal to ALL its counters (2) to the opponent only', () => {
    const s = resolveAll(cast(game(), 'Test Big Beast'));
    expect(counters(s, find(s, 'Test Banner Herald', 'battlefield', 'p1'), '+1/+1')).toBe(2);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });
  it('the damage counts the counters present when it resolves: a second big spell deals 4 more', () => {
    const g = scenario([], { defs: [HERALD, BIG, SMALL], p1: { hand: ['Test Big Beast', 'Test Big Beast'], battlefield: ['Test Banner Herald', ...Array<string>(10).fill('Plains')] } });
    let s = resolveAll(cast(g, 'Test Big Beast'));
    expect(life(s, 'p2')).toBe(18);
    s = resolveAll(cast(s, 'Test Big Beast'));
    expect(counters(s, find(s, 'Test Banner Herald', 'battlefield', 'p1'), '+1/+1')).toBe(4);
    expect(life(s, 'p2')).toBe(14);
  });
  it('ruling 2024-02-02: if the Herald leaves before the ability resolves, the counters it last had on the battlefield set the damage', () => {
    const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
    const g = scenario([], { defs: [HERALD, BIG, SMALL, SMITE], p1: { hand: ['Test Big Beast', 'Test Smite'], battlefield: [{ name: 'Test Banner Herald', counters: { '+1/+1': 3 } }, ...Array<string>(6).fill('Plains')] } });
    let s = cast(g, 'Test Big Beast'); // its cast trigger is on the stack
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: find(s, 'Test Banner Herald', 'battlefield', 'p1') }] }));
    expect(life(s, 'p2')).toBe(17); // the 3 counters it had when it died, not the 5 it would have had
  });
  it('negative: a mana value 1 creature spell puts counters on but deals no damage', () => {
    const s = resolveAll(cast(game(), 'Test Small Beast'));
    expect(counters(s, find(s, 'Test Banner Herald', 'battlefield', 'p1'), '+1/+1')).toBe(2);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 701.50a, 120.2, 603.2: "Whenever this creature deals combat damage to a player, it connives X, where X is the amount of damage it dealt to that player."', () => {
  const SCHEMER = card('Test Sly Rogue', 'Creature — Rogue', 'Whenever this creature deals combat damage to a player, it connives X, where X is the amount of damage it dealt to that player.', ['2', '2']);
  const SPELL = card('Test Spell Card', 'Sorcery', 'You gain 1 life.');
  const game = (): GameState => scenario([], { defs: [SCHEMER, SPELL], p1: { battlefield: [{ name: 'Test Sly Rogue', since: 0 }], library: ['Test Spell Card', 'Test Spell Card'] } });
  it('is full', () => expect(full(SCHEMER)).toBe(true));
  it('deals 2 combat damage: connive 2 (draw two, discard two; a +1/+1 counter for each nonland card discarded)', () => {
    const g = game();
    const rogue = find(g, 'Test Sly Rogue', 'battlefield', 'p1');
    const handBefore = g.zones.hand['p1']!.length;
    let s = attackWith(g, [rogue]);
    for (let i = 0; i < 20 && !(s.turn.step === 'endCombat' || s.turn.step === 'main2'); i++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.hand['p1']!.length).toBe(handBefore);
    expect(counters(s, rogue, '+1/+1')).toBe(2); // both cards drawn were nonland and were discarded
    expect(inYard(s, 'Test Spell Card')).toBe(true);
  });
});

describe('CR 701.20a, 608.2d, 110.2: "At the beginning of each player\'s upkeep, that player reveals the top card of their library. If it\'s an artifact, creature, enchantment, or land card, the player may put it onto the battlefield."', () => {
  const GATE = card('Test Dream Gate', 'Enchantment', "At the beginning of each player's upkeep, that player reveals the top card of their library. If it's an artifact, creature, enchantment, or land card, the player may put it onto the battlefield.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
  const at = (top: string, yes: boolean): GameState => {
    const g = scenario([], { defs: [GATE, BEAR, RITE], p1: { battlefield: ['Test Dream Gate'] }, p2: { library: [top] } });
    return resolveAll(advanceTo(g, 2, 'upkeep'), { yes });
  };
  it('is full', () => expect(full(GATE)).toBe(true));
  it('the active player (p2, not the Gate\'s controller) may put a revealed creature card onto the battlefield under THEIR control', () => {
    const s = at('Test Bear', true);
    const bear = named(s, 'Test Bear');
    expect(bear).toHaveLength(1);
    expect(s.objects[bear[0]!]!.controller).toBe('p2');
  });
  it('negative: declining leaves the card on top of the library; a sorcery card is never offered', () => {
    expect(named(at('Test Bear', false), 'Test Bear')).toHaveLength(0);
    const s = at('Test Rite', true);
    expect(named(s, 'Test Rite')).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Rite')).toHaveLength(0);
  });
});
