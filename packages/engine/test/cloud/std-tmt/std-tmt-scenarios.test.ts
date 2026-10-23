/**
 * Cloud batch 2, slice std-tmt (the Standard backlog of the Teenage Mutant Ninja Turtles set, tuning half): the templates of parser/templates/zz-cloud/std-tmt.json
 * and the parser, renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2d, 401.1, 608.2c   "You may put a card from your hand on the bottom of your library. If you do, draw a card."
 *   CR 106.4, 608.2h           "Whenever this creature is dealt damage, add that much {R}."
 *   CR 201.5, 120.3            "Whenever ~ deal combat damage to a player, ..." (a plural name)
 *   CR 506.2, 508.1b, 603.2c   "Whenever one or more of your opponents are attacked, ..."
 *   CR 508.4, 608.2c           "... onto the battlefield under your control. It enters tapped and attacking that player."
 *   CR 111.1, 701.21a          "Sacrifice another creature or token: ..."
 *   CR 115.1, 601.2c, 701.12b  "Exchange control of two target creatures controlled by different players."
 *   CR 205.2a, 608.2h          "Draw a card for each card type among spells you've cast this turn."
 *   CR 611.2c, 608.2c          "Gain control of all artifacts your opponents control until end of turn. Untap them. They gain haste until end of turn."
 *   CR 406.1, 400.7            "Exile up to one target artifact you control and up to one target creature you control. Return them to the battlefield ..."
 *   CR 607.2a, 608.2d, 400.3   "Return a creature card exiled with ~ to the battlefield under your control. Return each other card exiled with ~ to its owner's hand."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, pool, reject, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

type Targets = TargetChoice[][];
/** Answer the decisions that come up until priority (payments automatic; the targets `targets` in order; choices the first allowed; "yes" to may). */
function drive(s0: GameState, targets: Targets = [], pickNone = false): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pickNone ? p.options.slice(0, p.min) : p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) }); // CR 603.3b: triggers put on the stack in the order offered
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: Targets, pickNone = false): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, pickNone);
  return s;
}
const cast = (s: GameState, name: string, targets?: Targets): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);
function activate(s: GameState, name: string, targets: Targets = [], pickNone = false): GameState {
  const src = find(s, name, 'battlefield', 'p1');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), targets, pickNone), targets, pickNone);
}
/** Pass priority to the declare-attackers decision, declare `attackers` (at p2), and stop with the attack declared and its triggers resolved. */
function attack(s0: GameState, attackers: ObjectId[], targets?: Targets): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, targets);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  return resolveAll(drive(s, targets), targets);
}
/** Play on until combat damage has been dealt and its triggers resolved (blocks: none). */
function toDamage(s0: GameState, targets?: Targets): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.combat?.damageSteps !== 1; i++) {
    const d = s.pending;
    if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'priority') s = pass(s);
    else s = drive(s, targets);
  }
  return resolveAll(drive(s, targets), targets);
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');

describe('CR 608.2d, 401.1, 608.2c: "You may put a card from your hand on the bottom of your library. If you do, draw a card."', () => {
  const WELL = card('Test Well', 'Enchantment', '{0}: You may put a card from your hand on the bottom of your library. If you do, draw a card.');
  it('is understood', () => expect(noManual(WELL)).toBe(true));
  it('the chosen card goes to the bottom of your library and you draw a card (the hand keeps its size)', () => {
    const s0 = scenario([], { defs: [WELL, RELIC], p1: { battlefield: ['Test Well'], hand: ['Test Relic'] } });
    const relic = find(s0, 'Test Relic', 'hand', 'p1');
    const h0 = hand(s0, 'p1');
    const s = activate(s0, 'Test Well');
    expect(hand(s, 'p1')).toBe(h0);
    const moved = findAll(s, 'Test Relic', 'library', 'p1');
    expect(moved).toHaveLength(1);
    expect(s.objects[relic]?.zone ?? 'gone').not.toBe('hand');
  });
  it('CR 608.2c: putting nothing there draws nothing ("if you do")', () => {
    const s0 = scenario([], { defs: [WELL, RELIC], p1: { battlefield: ['Test Well'], hand: ['Test Relic'] } });
    const h0 = hand(s0, 'p1');
    const s = activate(s0, 'Test Well', [], true);
    expect(hand(s, 'p1')).toBe(h0);
    expect(findAll(s, 'Test Relic', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 106.4, 608.2h: "Whenever this creature is dealt damage, add that much {R}."', () => {
  const HOTHEAD = card('Test Hothead', 'Creature — Turtle', 'Whenever this creature is dealt damage, add that much {R}.', { pt: ['1', '5'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target creature.');
  it('is understood', () => expect(noManual(HOTHEAD)).toBe(true));
  it('three damage adds {R}{R}{R} to its controller\'s mana pool', () => {
    const s0 = scenario([], { defs: [HOTHEAD, ZAP], p1: { battlefield: ['Test Hothead'], hand: ['Test Zap'] } });
    const s = cast(s0, 'Test Zap', [[obj(find(s0, 'Test Hothead', 'battlefield'))]]);
    expect(pool(s, 'p1')).toBe('RRR');
  });
});

describe('CR 201.5, 120.3: a plural name, "Whenever ~ deal combat damage to a player, draw a card."', () => {
  const TWINS = card('Test Twins', 'Creature — Turtle', 'Whenever Test Twins deal combat damage to a player, draw a card.', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(TWINS)).toBe(true));
  it('its combat damage to the defending player draws a card', () => {
    const s0 = scenario([], { defs: [TWINS], p1: { battlefield: ['Test Twins'] } });
    const h0 = hand(s0, 'p1');
    const s = toDamage(attack(s0, [find(s0, 'Test Twins', 'battlefield')]));
    expect(life(s, 'p2')).toBe(18);
    expect(hand(s, 'p1')).toBe(h0 + 1);
  });
});

describe('CR 506.2, 508.1b, 603.2c: "Whenever one or more of your opponents are attacked, draw a card."', () => {
  const HORN = card('Test Horn', 'Enchantment', 'Whenever one or more of your opponents are attacked, draw a card.');
  it('is understood', () => expect(noManual(HORN)).toBe(true));
  it('two creatures attacking the opponent are one trigger: one card', () => {
    const s0 = scenario([], { defs: [HORN, BEAR], p1: { battlefield: ['Test Horn', 'Test Bear', 'Test Bear'] } });
    const h0 = hand(s0, 'p1');
    const s = attack(s0, findAll(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(hand(s, 'p1')).toBe(h0 + 1);
  });
  it('CR 603.2c: in a game of three, a creature at each opponent is still one trigger ("one or more of your opponents"), unlike "one or more creatures attack an opponent" (one for each opponent attacked)', () => {
    const STORM = card('Test Storm', 'Enchantment', 'Whenever one or more creatures attack an opponent, draw a card.');
    expect(noManual(STORM)).toBe(true);
    for (const [watcher, cards] of [['Test Horn', 1], ['Test Storm', 2]] as const) {
      const s0 = mpScenario({ players: 3, defs: [HORN, STORM, BEAR], zones: { p1: { battlefield: [watcher, { name: 'Test Bear', since: -1 }, { name: 'Test Bear', since: -1 }] } } });
      const [b1, b2] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
      const h0 = hand(s0, 'p1');
      let s = s0;
      for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
      s = resolveAll(drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: 'p2' }, { attacker: b2!, defender: 'p3' }] })));
      expect(hand(s, 'p1'), watcher).toBe(h0 + cards);
    }
  });
});

describe('CR 508.4, 608.2c: "... put up to one target creature card from that player\'s graveyard onto the battlefield under your control. It enters tapped and attacking that player."', () => {
  const CLONE = card('Test Clone', 'Creature — Shark Ninja', "Whenever this creature deals combat damage to a player, put up to one target creature card from that player's graveyard onto the battlefield under your control. It enters tapped and attacking that player.", { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(CLONE)).toBe(true));
  it('the card enters under your control, tapped and attacking the player who was dealt damage', () => {
    const s0 = scenario([], { defs: [CLONE, BEAR], p1: { battlefield: ['Test Clone'] }, p2: { graveyard: ['Test Bear'] } });
    const s1 = attack(s0, [find(s0, 'Test Clone', 'battlefield')]);
    const s = toDamage(s1, [[obj(find(s1, 'Test Bear', 'graveyard', 'p2'))]]);
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.combat?.attackers.find((a) => a.id === bear)).toMatchObject({ defendingPlayer: 'p2' });
  });
});

describe('CR 111.1, 701.21a: "{0}, Sacrifice another creature or token: Draw a card."', () => {
  const KITTY = card('Test Kitty', 'Artifact Creature — Food Cat', '{0}, Sacrifice another creature or token: Draw a card.', { pt: ['1', '1'] });
  const PICNIC = card('Test Picnic', 'Enchantment', '{0}: Create a Food token.');
  it('is understood', () => expect(noManual(KITTY)).toBe(true));
  it('a noncreature token pays it (a token of any type)', () => {
    let s = scenario([], { defs: [KITTY, PICNIC], p1: { battlefield: ['Test Kitty', 'Test Picnic'] } });
    s = activate(s, 'Test Picnic');
    expect(tokensOf(s, 'p1')).toHaveLength(1);
    const h0 = hand(s, 'p1');
    s = activate(s, 'Test Kitty');
    expect(tokensOf(s, 'p1')).toHaveLength(0);
    expect(hand(s, 'p1')).toBe(h0 + 1);
  });
  it('a nontoken noncreature artifact does not, and the Kitty never pays for itself ("another")', () => {
    const s = scenario([], { defs: [KITTY, RELIC], p1: { battlefield: ['Test Kitty', 'Test Relic'] } });
    const kitty = find(s, 'Test Kitty', 'battlefield');
    expect(legal(s, 'p1', 'activate').some((a) => a.object === kitty)).toBe(false);
  });
});

describe('CR 115.1, 601.2c, 701.12b: "Exchange control of two target creatures controlled by different players."', () => {
  const SWAP = card('Test Swap', 'Sorcery', 'Exchange control of two target creatures controlled by different players.');
  it('is understood', () => expect(noManual(SWAP)).toBe(true));
  it('two creatures of one controller are refused; one of each player exchange controllers', () => {
    let s = scenario([], { defs: [SWAP, BEAR], p1: { hand: ['Test Swap'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const [mine, mine2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Swap', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(mine!), obj(mine2!)] } });
    s = resolveAll(drive(answer(s, { kind: 'chooseTargets', targets: [obj(mine!), obj(theirs)] })));
    expect(s.objects[mine!]!.controller).toBe('p2');
    expect(s.objects[theirs]!.controller).toBe('p1');
    expect(s.objects[mine2!]!.controller).toBe('p1');
  });
});

describe('CR 205.2a, 608.2h: "{0}: Draw a card for each card type among spells you\'ve cast this turn."', () => {
  const ARCHIVE = card('Test Archive', 'Enchantment', "{0}: Draw a card for each card type among spells you've cast this turn.");
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const IDEA = card('Test Idea', 'Sorcery', 'You gain 1 life.');
  const IDEA2 = card('Test Notion', 'Sorcery', 'You gain 1 life.');
  it('is understood', () => expect(noManual(ARCHIVE)).toBe(true));
  it('an artifact creature spell and two sorceries are three card types: three cards', () => {
    let s = scenario([], { defs: [ARCHIVE, GOLEM, IDEA, IDEA2], p1: { battlefield: ['Test Archive'], hand: ['Test Golem', 'Test Idea', 'Test Notion'] } });
    s = cast(cast(cast(s, 'Test Golem'), 'Test Idea'), 'Test Notion');
    const h0 = hand(s, 'p1');
    s = activate(s, 'Test Archive');
    expect(hand(s, 'p1')).toBe(h0 + 3);
  });
  it('with no spell cast this turn it draws nothing', () => {
    const s0 = scenario([], { defs: [ARCHIVE], p1: { battlefield: ['Test Archive'] } });
    const h0 = hand(s0, 'p1');
    expect(hand(activate(s0, 'Test Archive'), 'p1')).toBe(h0);
  });
});

describe('CR 611.2c, 608.2c: "Gain control of all artifacts your opponents control until end of turn. Untap them. They gain haste until end of turn."', () => {
  const TAKEOVER = card('Test Takeover', 'Sorcery', 'Gain control of all artifacts your opponents control until end of turn. Untap them. They gain haste until end of turn.');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'] });
  it('is understood', () => expect(noManual(TAKEOVER)).toBe(true));
  it('the opponent\'s artifacts are yours, untapped, with haste; your own artifact and their creature are untouched; "them" is the set taken (not "artifacts your opponents control" read again)', () => {
    const s0 = scenario([], {
      defs: [TAKEOVER, GOLEM, RELIC, BEAR],
      p1: { hand: ['Test Takeover'], battlefield: ['Test Relic'] },
      p2: { battlefield: [{ name: 'Test Relic', tapped: true }, { name: 'Test Golem', tapped: true }, { name: 'Test Bear', tapped: true }] },
    });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p2');
    const golem = find(s0, 'Test Golem', 'battlefield', 'p2');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const mine = find(s0, 'Test Relic', 'battlefield', 'p1');
    const s = cast(s0, 'Test Takeover');
    for (const id of [relic, golem]) {
      expect(s.objects[id]!.controller, id).toBe('p1');
      expect(s.objects[id]!.tapped, id).toBe(false);
    }
    expect(hasKeyword(getChars(s, golem)!, 'haste')).toBe(true);
    expect(s.objects[mine]!.controller).toBe('p1');
    expect(s.objects[bear]!.controller).toBe('p2');
    expect(s.objects[bear]!.tapped).toBe(true);
  });
});

describe('CR 406.1, 400.7: "Exile up to one target artifact you control and up to one target creature you control. Return them to the battlefield under their owners\' control."', () => {
  const BLINKER = card('Test Blinker', 'Creature — Turtle', "When this creature enters, exile up to one target artifact you control and up to one target creature you control. Return them to the battlefield under their owners' control.", { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(BLINKER)).toBe(true));
  it('both targets leave and come back as new objects (CR 400.7); a tapped one comes back untapped', () => {
    const s0 = scenario([], { defs: [BLINKER, RELIC, BEAR], p1: { hand: ['Test Blinker'], battlefield: [{ name: 'Test Relic', tapped: true }, 'Test Bear'] } });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Blinker', [[obj(relic)], [obj(bear)]]);
    const relic2 = find(s, 'Test Relic', 'battlefield', 'p1');
    const bear2 = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(relic2).not.toBe(relic);
    expect(bear2).not.toBe(bear);
    expect(s.objects[relic2]!.tapped).toBe(false);
    expect(findAll(s, 'Test Relic', 'exile')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile')).toHaveLength(0);
  });
});

describe('CR 607.2a, 608.2d, 110.2, 400.3: "Return a creature card exiled with ~ to the battlefield under your control. Return each other card exiled with ~ to its owner\'s hand."', () => {
  const BARN = card('Test Barn', 'Land', "{T}: Add {C}.\n{0}: Exile target permanent you own.\n{0}, Sacrifice this land: Return a creature card exiled with this land to the battlefield under your control. Return each other card exiled with this land to its owner's hand.");
  it('is understood', () => expect(noManual(BARN)).toBe(true));
  it('after the land is sacrificed (CR 607.2a: the link survives), one exiled creature card returns to the battlefield and every other exiled card goes to its owner\'s hand', () => {
    let s = scenario([], { defs: [BARN, BEAR, RELIC], p1: { battlefield: ['Test Barn', 'Test Bear', 'Test Relic'] } });
    const barn = find(s, 'Test Barn', 'battlefield', 'p1');
    const exileAbility = (st: GameState) => legal(st, 'p1', 'activate').find((x) => x.object === barn && x.label.includes('Exile'))!;
    for (const name of ['Test Bear', 'Test Relic']) {
      const target = find(s, name, 'battlefield', 'p1');
      s = resolveAll(drive(act(s, exileAbility(s).action), [[obj(target)]]));
      expect(findAll(s, name, 'exile')).toHaveLength(1);
    }
    const h0 = hand(s, 'p1');
    const last = legal(s, 'p1', 'activate').find((x) => x.object === barn && x.label.includes('Return'))!;
    s = resolveAll(drive(act(s, last.action)));
    expect(findAll(s, 'Test Barn', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Relic', 'hand', 'p1')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h0 + 1);
    expect(s.zones.exile).toHaveLength(0);
  });
});
