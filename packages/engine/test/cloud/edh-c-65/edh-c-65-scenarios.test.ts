/**
 * Commander effort, coordinator C, round edh-c-65 (EDHREC ranks 21,001-21,500, second pass): the round's readings played through the engine with synthetic cards (invented
 * names and wordings, design 6.10), compiled by the game's default compiler, in 4-player games, each with its negative cases. CR cites are from the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 701.17a, 122.1, 608.2h   "{T}: Put a gnaw counter on ~. Then mill a card for each gnaw counter on ~."
 *   CR 205.1b, 303.4, 613.1d    "Enchanted land is a 4/4 Elemental creature with reach and haste. It's still a land." (and the named basic land type, with a color)
 *   CR 115.1, 608.2b, 111.2     "Each player other than target player creates a 3/3 Wurm creature token."
 *   CR 508.1c, 509.1c, 506.2    "~ can't attack unless you control more creatures than defending player." / "~ can't block unless you control more creatures than attacking player."
 *   CR 611.2c, 301.5, 702.2     "Each equipped creature and Equipment you control gains menace until end of turn."
 *   CR 701.8a, 701.19c          "Destroy all creatures except for ~. Those creatures can't be regenerated."
 *   CR 608.2c, 608.2d, 701.2    "you may pay {1}{U}. If you do, choose a color, then return all creatures of that color to their owners' hands."
 *   CR 400.2, 608.2c-d          "Mill two cards, then return an artifact card and a Goblin card from your graveyard to your hand."
 *   CR 701.20a, 401.4, 608.2c   "Then put the rest of the cards revealed this way on the bottom of your library in any order."
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, mpScenario, pass, passUntil, step } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { card, full } from '../cmd3/helpers';

/** A colored creature (the color indicator is the card's `colors`, CR 105.2). */
const colored = (name: string, type: string, text: string, pt: [string, string], color: 'U' | 'G' | 'R', cost: string): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [color], power: pt[0], toughness: pt[1] } as OracleCard);

const bf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.defs[s.objects[id]!.defId]!.name);
const handOf = (s: GameState, p: PlayerId): string[] => (s.zones.hand[p] ?? []).map((id) => s.defs[s.objects[id]!.defId]!.name).filter((n) => n !== 'Plains'); // (the Plains of a drawn card are not what the tests look at)
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const keywordsOf = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => String(k.keyword));

/** Answers whatever is asked (first legal target, auto payment, yes, first minimum choices, the order given) and passes priority until the stack is empty. */
function run(s0: GameState, o: { color?: string; yes?: boolean; greedy?: boolean } = {}): GameState {
  let s = s0;
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; options?: ({ id: string } | string)[]; objects?: ObjectId[] };
    if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: (d.objects ?? []).slice(0, Math.max(d.min ?? 1, 1)).map((id) => ({ kind: 'object', id })) } as DecisionAnswer;
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: o.yes ?? true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: ((d.options ?? []) as ObjectId[]).slice(0, Math.max(d.min ?? 0, o.greedy === true ? 1 : 0)) };
    else if (p.kind === 'chooseOption') {
      const opts = (d.options ?? []).map((x) => (typeof x === 'string' ? x : x.id));
      a = { kind: 'chooseOption', ids: [opts.find((x) => x === o.color) ?? opts[0]!] } as DecisionAnswer;
    } else if (p.kind === 'chooseColor') a = { kind: 'chooseColor', color: o.color ?? 'W' } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    else throw new Error(`unexpected ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
const abilityKey = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
const activate = (s: GameState, p: PlayerId, source: ObjectId): GameState => act(s, { type: 'activate', player: p, source, ability: abilityKey(s, source) });

describe('CR 701.17a, 122.1, 608.2h: "Put a gnaw counter on ~. Then mill a card for each gnaw counter on ~."', () => {
  const IDOL = card('Test Gnaw Idol', 'Artifact Creature — Construct', '{T}: Put a gnaw counter on ~. Then mill a card for each gnaw counter on ~.', ['1', '1']);
  const start = (counters: number): GameState => mpScenario({ defs: [IDOL], zones: { p1: { battlefield: [{ name: 'Test Gnaw Idol', counters: counters > 0 ? { gnaw: counters } : {} }] } } });
  it('is automated', () => { expect(full(IDOL)).toBe(true); });
  it('with two gnaw counters already on it, the new one makes three and three cards are milled (the count is read after the counter is put)', () => {
    let s = start(2);
    s = run(activate(s, 'p1', bf(s, 'Test Gnaw Idol')[0]!));
    expect(s.objects[bf(s, 'Test Gnaw Idol')[0]!]!.counters['gnaw']).toBe(3);
    expect(yard(s, 'p1')).toHaveLength(3);
  });
  it('negative: with no counter it gets one and mills exactly one card; no other player mills anything', () => {
    let s = start(0);
    s = run(activate(s, 'p1', bf(s, 'Test Gnaw Idol')[0]!));
    expect(yard(s, 'p1')).toHaveLength(1);
    for (const p of ['p2', 'p3', 'p4'] as const) expect(yard(s, p)).toHaveLength(0);
  });
});

describe('CR 205.1b, 303.4, 613.1d-e, 613.4b: "Enchanted land is a 4/4 Elemental creature with reach and haste. It\'s still a land." / "Enchanted Mountain is a 6/6 red Troll creature with trample. It\'s still a land."', () => {
  const BRAND = card('Test Wild Brand', 'Enchantment — Aura', "Enchant land\nEnchanted land is a 4/4 Elemental creature with reach and haste. It's still a land.");
  const TORCH = card('Test Ember Torch', 'Enchantment — Aura', "Enchant Mountain\nEnchanted Mountain is a 6/6 red Troll creature with trample. It's still a land.");
  const attached = (aura: string, land: string): GameState => mpScenario({
    defs: [BRAND, TORCH], cards: ['Forest', 'Mountain'], zones: { p1: { battlefield: [aura, land, 'Mountain'] } },
    setup: (x) => { x.objects[find(x, aura, 'battlefield', 'p1')]!.attachedTo = find(x, land, 'battlefield', 'p1'); },
  });
  it('are automated', () => { expect(full(BRAND)).toBe(true); expect(full(TORCH)).toBe(true); });
  it('a Forest enchanted by the Brand is a land and a 4/4 Elemental creature with reach and haste, in addition to its types', () => {
    const s = attached('Test Wild Brand', 'Forest');
    const id = find(s, 'Forest', 'battlefield', 'p1');
    const c = getChars(s, id)!;
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Elemental']));
    expect([c.power, c.toughness]).toEqual(['4', '4']);
    expect(keywordsOf(s, id)).toEqual(expect.arrayContaining(['reach', 'haste']));
  });
  it('the Mountain enchanted by the Torch is a red 6/6 Troll creature with trample and still a Mountain land', () => {
    const s = attached('Test Ember Torch', 'Mountain');
    const c = getChars(s, find(s, 'Mountain', 'battlefield', 'p1'))!;
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Mountain', 'Troll']));
    expect(c.colors).toEqual(['R']);
    expect([c.power, c.toughness]).toEqual(['6', '6']);
  });
  it('negative: a land with no Aura on it, and the other land beside the enchanted one, stay plain lands', () => {
    const s = attached('Test Wild Brand', 'Forest');
    const m = getChars(s, find(s, 'Mountain', 'battlefield', 'p1'))!;
    expect(m.types).not.toContain('Creature');
    expect(m.subtypes).not.toContain('Elemental');
  });
  it('negative: the Torch cannot enchant a Forest (its "Enchant Mountain" restriction, CR 303.4a)', () => {
    let s = mpScenario({ defs: [TORCH], cards: ['Forest'], zones: { p1: { hand: ['Test Ember Torch'], battlefield: ['Forest'] } } });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main');
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Torch', 'hand', 'p1') })).toThrow();
  });
});

describe('CR 115.1, 608.2b, 111.2: "Each player other than target player creates a 3/3 green Wurm creature token with trample."', () => {
  const EDICT = card('Test Wurm Edict', 'Sorcery', 'Each player other than target player creates a 3/3 green Wurm creature token with trample.');
  const cast = (target: PlayerId): GameState => {
    let s = mpScenario({ defs: [EDICT], zones: { p1: { hand: ['Test Wurm Edict'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wurm Edict', 'hand', 'p1') });
    return answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] } as DecisionAnswer);
  };
  it('is automated', () => { expect(full(EDICT)).toBe(true); });
  it('targeting p2: p1, p3 and p4 each create one Wurm and p2 creates none', () => {
    const s = run(cast('p2'));
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => tokensOf(s, p as PlayerId).length)).toEqual([1, 0, 1, 1]);
  });
  it('negative: targeting yourself, you create none and the three opponents one each', () => {
    const s = run(cast('p1'));
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => tokensOf(s, p as PlayerId).length)).toEqual([0, 1, 1, 1]);
  });
  it('negative: when the targeted player has left the game, the spell does not resolve and nobody creates a token (ruling 2011-09-22)', () => {
    let s = cast('p2');
    s = step(s, { type: 'concede', player: 'p2' }).state;
    s = run(s);
    expect(['p1', 'p3', 'p4'].map((p) => tokensOf(s, p as PlayerId).length)).toEqual([0, 0, 0]);
  });
});

describe('CR 508.1c, 509.1c, 506.2: "~ can\'t attack unless you control more creatures than defending player." / "~ can\'t block unless you control more creatures than attacking player."', () => {
  const BULLY = card('Test Hill Bully', 'Creature — Goblin', "This creature can't attack unless you control more creatures than defending player.\nThis creature can't block unless you control more creatures than attacking player.", ['3', '3']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [BULLY, BEAR];
  const bears = (n: number): string[] => Array(n).fill('Test Plain Bear');
  const attackGame = (p2: number, p3: number, p4: number): GameState => mpScenario({
    defs, zones: { p1: { battlefield: ['Test Hill Bully', ...bears(2)] }, p2: { battlefield: bears(p2) }, p3: { battlefield: bears(p3) }, p4: { battlefield: bears(p4) } },
  });
  const attackAt = (s: GameState, defender: PlayerId): GameState => declareAttackers(toDeclareAttackers(s), [[bf(s, 'Test Hill Bully', 'p1')[0]!, defender]]);
  it('is automated', () => { expect(full(BULLY)).toBe(true); });
  it('p1 controls 3 creatures: it may attack p2 (2 creatures) and p4 (none)', () => {
    const s = attackGame(2, 3, 0);
    expect(attackAt(s, 'p2').pending?.kind).not.toBe('declareAttackers');
    expect(attackAt(s, 'p4').pending?.kind).not.toBe('declareAttackers');
  });
  it('negative: it may not attack p3, who controls as many creatures (3 is not more than 3); nor p2 with 4', () => {
    const s = attackGame(4, 3, 0);
    expect(() => attackAt(s, 'p3')).toThrow();
    expect(() => attackAt(s, 'p2')).toThrow();
  });
  const blockGame = (p2: number): GameState => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: bears(2) }, p2: { battlefield: ['Test Hill Bully', ...bears(p2 - 1)] } } });
    return declareAttackers(toDeclareAttackers(s), [[bf(s, 'Test Plain Bear', 'p1')[0]!, 'p2']]);
  };
  const tryBlock = (s: GameState): boolean => {
    let t = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    try {
      t = answer(t, { kind: 'declareBlockers', blocks: [{ blocker: bf(t, 'Test Hill Bully', 'p2')[0]!, attacker: bf(t, 'Test Plain Bear', 'p1')[0]! }] } as DecisionAnswer);
      return true;
    } catch { return false; }
  };
  it('p2 controls 3 creatures against the attacking p1\'s 2: the Bully may block', () => { expect(tryBlock(blockGame(3))).toBe(true); });
  it('negative: p2 controls 2 creatures against p1\'s 2: the Bully may not block', () => { expect(tryBlock(blockGame(2))).toBe(false); });
});

describe('CR 611.2c, 301.5, 702.2: "Each equipped creature and Equipment you control gains menace until end of turn."', () => {
  const FLASK = card('Test Venom Flask', 'Artifact', '{B}, {T}, Sacrifice this artifact: Each equipped creature and Equipment you control gains menace until end of turn.');
  const BRACE = card('Test Iron Brace', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const start = (): GameState => mpScenario({
    defs: [FLASK, BRACE, BEAR], cards: ['Swamp'],
    zones: { p1: { battlefield: ['Test Venom Flask', 'Test Iron Brace', 'Test Plain Bear', 'Test Plain Bear', 'Swamp'] }, p2: { battlefield: ['Test Iron Brace', 'Test Plain Bear'] } },
    setup: (x) => {
      const mine = bf(x, 'Test Plain Bear', 'p1');
      x.objects[find(x, 'Test Iron Brace', 'battlefield', 'p1')]!.attachedTo = mine[0]!;
      x.objects[find(x, 'Test Iron Brace', 'battlefield', 'p2')]!.attachedTo = bf(x, 'Test Plain Bear', 'p2')[0]!;
    },
  });
  it('is automated', () => { expect(full(FLASK)).toBe(true); });
  it('the equipped creature and the Equipment you control gain menace; your unequipped creature and the opponent\'s equipped creature and Equipment do not', () => {
    let s = start();
    s = run(activate(s, 'p1', find(s, 'Test Venom Flask', 'battlefield', 'p1')));
    const [equipped, bare] = bf(s, 'Test Plain Bear', 'p1');
    expect(keywordsOf(s, equipped!)).toContain('menace');
    expect(keywordsOf(s, find(s, 'Test Iron Brace', 'battlefield', 'p1'))).toContain('menace');
    expect(keywordsOf(s, bare!)).not.toContain('menace');
    expect(keywordsOf(s, bf(s, 'Test Plain Bear', 'p2')[0]!)).not.toContain('menace');
    expect(keywordsOf(s, find(s, 'Test Iron Brace', 'battlefield', 'p2'))).not.toContain('menace');
  });
  it('negative: a creature that becomes equipped after the ability resolved does not gain menace (ruling 2024-07-05, CR 611.2c)', () => {
    let s = start();
    s = run(activate(s, 'p1', find(s, 'Test Venom Flask', 'battlefield', 'p1')));
    const [, bare] = bf(s, 'Test Plain Bear', 'p1');
    s.objects[find(s, 'Test Iron Brace', 'battlefield', 'p1')]!.attachedTo = bare!;
    expect(keywordsOf(s, bare!)).not.toContain('menace');
  });
});

describe('CR 701.8a, 701.19c, 608.2c: "Destroy all creatures except for ~. Those creatures can\'t be regenerated."', () => {
  const MAGE = card('Test Dust Mage', 'Creature — Wizard', "{T}: Destroy all creatures except for ~. Those creatures can't be regenerated.", ['2', '2']);
  const TROLL = card('Test Mend Troll', 'Creature — Troll', '{0}: Regenerate ~.', ['3', '3']);
  const start = (): GameState => mpScenario({ defs: [MAGE, TROLL], zones: { p1: { battlefield: ['Test Dust Mage', 'Test Mend Troll'] }, p2: { battlefield: ['Test Mend Troll'] } } });
  it('is automated', () => { expect(full(MAGE)).toBe(true); });
  it('every other creature dies, its controller\'s included, and the Mage survives', () => {
    let s = start();
    s = run(activate(s, 'p1', bf(s, 'Test Dust Mage')[0]!));
    expect(bf(s, 'Test Dust Mage')).toHaveLength(1);
    expect(bf(s, 'Test Mend Troll')).toHaveLength(0);
    expect(yard(s, 'p1')).toContain('Test Mend Troll');
    expect(yard(s, 'p2')).toContain('Test Mend Troll');
  });
  it('negative: a regeneration shield made before does not save a creature (CR 701.19c)', () => {
    let s = start();
    const troll = bf(s, 'Test Mend Troll', 'p1')[0]!;
    s = run(act(s, { type: 'activate', player: 'p1', source: troll, ability: abilityKey(s, troll) }));
    s = run(activate(s, 'p1', bf(s, 'Test Dust Mage')[0]!));
    expect(bf(s, 'Test Mend Troll', 'p1')).toHaveLength(0);
  });
});

describe('CR 608.2c, 608.2d, 701.2: "Whenever ~ deals combat damage to a player, you may pay {1}{U}. If you do, choose a color, then return all creatures of that color to their owners\' hands."', () => {
  const DRAKE = colored('Test Tide Drake', 'Creature — Drake', "Flying\nWhenever this creature deals combat damage to a player, you may pay {1}{U}. If you do, choose a color, then return all creatures of that color to their owners' hands.", ['2', '2'], 'U', '{U}');
  const GREEN = colored('Test Green Bear', 'Creature — Bear', '', ['2', '2'], 'G', '{G}');
  const RED = colored('Test Red Imp', 'Creature — Imp', '', ['1', '1'], 'R', '{R}');
  const start = (): GameState => mpScenario({ defs: [DRAKE, GREEN, RED], cards: ['Island'], zones: { p1: { battlefield: ['Test Tide Drake', 'Island', 'Island', 'Test Green Bear'] }, p2: { battlefield: ['Test Green Bear', 'Test Red Imp'] } } });
  const attack = (yes: boolean, color = 'G'): GameState => {
    const s = start();
    const t = passUntil(declareAttackers(toDeclareAttackers(s), [[bf(s, 'Test Tide Drake')[0]!, 'p4']]), (x) => x.zones.stack.length > 0 || (x.pending !== null && x.pending !== undefined && x.pending.kind !== 'priority'), 'the damage trigger');
    return run(t, { yes, color });
  };
  it('is automated', () => { expect(full(DRAKE)).toBe(true); });
  it('paying and choosing green returns every green creature (its controller\'s and the opponent\'s) to hand; the red creature and the Drake stay', () => {
    const s = attack(true, 'G');
    expect(handOf(s, 'p1')).toContain('Test Green Bear');
    expect(handOf(s, 'p2')).toContain('Test Green Bear');
    expect(bf(s, 'Test Red Imp', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Tide Drake', 'p1')).toHaveLength(1);
  });
  it('negative: declining to pay returns nothing', () => {
    const s = attack(false);
    expect(handOf(s, 'p1')).not.toContain('Test Green Bear');
    expect(bf(s, 'Test Green Bear')).toHaveLength(2);
  });
});

describe('CR 400.2, 608.2c-d: "Mill two cards, then return an artifact card and a Goblin card from your graveyard to your hand."', () => {
  const RECALL = card('Test Scrap Recall', 'Sorcery', 'Mill two cards, then return an artifact card and a Goblin card from your graveyard to your hand.');
  const ROD = card('Test Gleam Rod', 'Artifact', '');
  const GOBLIN = card('Test Pit Goblin', 'Creature — Goblin', '', ['1', '1']);
  const start = (yard1: string[]): GameState => mpScenario({ defs: [RECALL, ROD, GOBLIN], zones: { p1: { hand: ['Test Scrap Recall'], graveyard: yard1 }, p2: { graveyard: ['Test Gleam Rod'] } } });
  it('is automated', () => { expect(full(RECALL)).toBe(true); });
  it('one card of each kind is returned to hand; the milled Plains and the opponent\'s Rod stay where they are', () => {
    let s = start(['Test Gleam Rod', 'Test Pit Goblin']);
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrap Recall', 'hand', 'p1') }));
    expect(handOf(s, 'p1').sort()).toEqual(['Test Gleam Rod', 'Test Pit Goblin']);
    expect(yard(s, 'p1').filter((n) => n === 'Plains')).toHaveLength(2);
    expect(yard(s, 'p2')).toEqual(['Test Gleam Rod']);
  });
  it('negative: with no Goblin card in the graveyard the artifact card is still returned and nothing else (ruling 2014-11-24)', () => {
    let s = start(['Test Gleam Rod']);
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrap Recall', 'hand', 'p1') }));
    expect(handOf(s, 'p1')).toEqual(['Test Gleam Rod']);
  });
  it('negative: a card that is both kinds is returned once, not twice (the second choice excludes the first)', () => {
    const BOTH = card('Test Scrap Goblin', 'Artifact Creature — Goblin', '', ['1', '1']);
    let s = mpScenario({ defs: [RECALL, BOTH], zones: { p1: { hand: ['Test Scrap Recall'], graveyard: ['Test Scrap Goblin'] } } });
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrap Recall', 'hand', 'p1') }));
    expect(handOf(s, 'p1')).toEqual(['Test Scrap Goblin']);
  });
});

describe('CR 701.20a, 401.4, 608.2c: "Then put the rest of the cards revealed this way on the bottom of your library in any order."', () => {
  const DIG = card('Test Dusk Dig', 'Sorcery', 'Reveal the top three cards of your library. You may put a creature card from among them onto the battlefield. It gains haste until end of turn. Then put the rest of the cards revealed this way on the bottom of your library in any order.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const start = (): GameState => mpScenario({ defs: [DIG, BEAR], zones: { p1: { hand: ['Test Dusk Dig'], library: ['Plains', 'Test Plain Bear', 'Plains'] } } });
  it('is automated', () => { expect(full(DIG)).toBe(true); });
  it('the creature among the three revealed cards enters with haste; the other two go to the bottom of the library (it holds the same number of cards less one)', () => {
    let s = start();
    const before = s.zones.library['p1']!.length;
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dusk Dig', 'hand', 'p1') }), { greedy: true });
    expect(bf(s, 'Test Plain Bear', 'p1')).toHaveLength(1);
    expect(keywordsOf(s, bf(s, 'Test Plain Bear', 'p1')[0]!)).toContain('haste');
    expect(s.zones.library['p1']).toHaveLength(before - 1);
    const lib = s.zones.library['p1']!;
    expect(lib.slice(-2).map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Plains', 'Plains']);
  });
  it('negative: with no creature among the cards revealed all three go to the bottom and nothing enters', () => {
    let s = mpScenario({ defs: [DIG, BEAR], zones: { p1: { hand: ['Test Dusk Dig'], library: ['Plains', 'Plains', 'Plains'] } } });
    const before = s.zones.library['p1']!.length;
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dusk Dig', 'hand', 'p1') }));
    expect(s.zones.library['p1']).toHaveLength(before);
    expect(bf(s, 'Test Plain Bear', 'p1')).toHaveLength(0);
  });
});
