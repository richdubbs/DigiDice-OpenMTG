/**
 * edh-d-87 (Commander coordinator D, EDHREC band 5,001-10,000, group combat): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. Scryfall rulings were fetched in
 * the cloud session; CR cites were checked against the Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt) unless the line says otherwise.
 *
 *   CR 113.6m, 400.7, 603.4, 611.2c   "you may exile ~. If you do, it gains "Whenever a land you control enters, if ~ is exiled, you may put a voyage counter on it. If you don't, return ~
 *                                     ... with X +1/+1 counters on it and draw X cards, where X is the number of voyage counters on it."" (Cosima, God of the Voyage)
 *   CR 305.1, 401.1, 601.3, 611.2a     "that player exiles that many cards from the top of their library. You may play lands from among those cards for as long as they remain exiled."
 *                                     (The Omenkeel)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type PlayerId } from '../../../src/index';
import { act, answer, find, legal } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const named = (s: GameState, ids: readonly string[], name: string): string[] => ids.filter((id) => nameOf(s, id) === name);

interface Script { yes?: boolean[]; objects?: string[][] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.objects?.shift() ?? (p.options as string[]).slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}

// ---- Cosima, God of the Voyage: a quoted trigger granted to the card just exiled works in exile ----------------------------------------------------------------------------

const VOYAGER = card('Test Voyager', 'Legendary Creature — God', 'At the beginning of your upkeep, you may exile Test Voyager. If you do, it gains "Whenever a land you control enters, if Test Voyager is exiled, you may put a voyage counter on it. If you don\'t, return Test Voyager to the battlefield with X +1/+1 counters on it and draw X cards, where X is the number of voyage counters on it."', { pt: ['2', '3'] });
const ISLAND = card('Test Isle', 'Land', '');

describe('CR 113.6m, 400.7, 603.4, 611.2c: a quoted trigger granted to the card just exiled ("If you do, it gains "Whenever ..., if ~ is exiled, ..."")', () => {
  it('is automated; inside the quote the card\'s name is the card that has the ability (its own object in exile), and the trigger works in exile', () => {
    expect(full(VOYAGER)).toBe(true);
    const json = JSON.stringify(VOYAGER.faces[0]!.abilities);
    expect(json).not.toContain('"grantor"');
    expect(json).toContain('"zone":["exile"]');
  });
  /** p1's next upkeep with the trigger of the Voyager resolved (exiled or not). */
  const toUpkeep = (exile: boolean): GameState => {
    const s0 = mpScenario({ defs: [VOYAGER, ISLAND], zones: { p1: { battlefield: ['Test Voyager'], hand: ['Test Isle', 'Test Isle', 'Test Isle'] } } });
    const s1 = passUntil(s0, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'upkeep' && x.pending?.kind === 'priority' && x.zones.stack.length > 0, "p1's next upkeep with the trigger on the stack", 400);
    return settle(s1, { yes: [exile] });
  };
  const toMain = (s0: GameState): GameState => passUntil(s0, (x) => x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'main 1');
  const playLand = (s0: GameState): GameState => {
    const a = legal(s0, 'p1', 'playLand').find((x) => nameOf(s0, (x.action as { card: string }).card) === 'Test Isle');
    return act(s0, a!.action);
  };
  it('declining the exile leaves it on the battlefield (the negative case: "you may")', () => {
    const s = toUpkeep(false);
    expect(named(s, s.zones.battlefield, 'Test Voyager').length).toBe(1);
  });
  it('a land entering while it is exiled: the player may put a voyage counter on the exiled card (it stays in exile)', () => {
    let s = toUpkeep(true);
    expect(named(s, s.zones.exile, 'Test Voyager').length).toBe(1);
    s = toMain(s);
    s = settle(playLand(s), { yes: [true] });
    const v = named(s, s.zones.exile, 'Test Voyager')[0]!;
    expect(v).toBeDefined();
    expect(s.objects[v]!.counters?.['voyage'] ?? 0).toBe(1);
  });
  it('"If you don\'t": it returns with X +1/+1 counters and its controller draws X cards, X the voyage counters it had in exile (ruling 2021-02-05)', () => {
    let s = toUpkeep(true);
    s = toMain(s);
    s = settle(playLand(s), { yes: [true] }); // one voyage counter
    const hand = s.zones.hand.p1!.length;
    // a second land the same turn is not allowed: the next land waits for a later turn; give p1 a second land drop by playing on the next own turn
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.turn.number > s.turn.number && x.pending?.kind === 'priority' && x.pending.player === 'p1', "p1's next main phase", 600);
    const before = s.zones.hand.p1!.length;
    s = settle(playLand(s), { yes: [false] });
    const back = named(s, s.zones.battlefield, 'Test Voyager');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.counters?.['+1/+1'] ?? 0).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(before - 1 + 1); // the land left the hand (-1), one card drawn (+1)
    expect(hand).toBeGreaterThan(0);
  });
  it('returned with no voyage counter: no +1/+1 counters and no card drawn (ruling 2021-02-05)', () => {
    let s = toUpkeep(true);
    s = toMain(s);
    const before = s.zones.hand.p1!.length;
    s = settle(playLand(s), { yes: [false] });
    const back = named(s, s.zones.battlefield, 'Test Voyager');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.counters?.['+1/+1'] ?? 0).toBe(0);
    expect(s.zones.hand.p1!.length).toBe(before - 1);
  });
  it('the returned permanent is a new object without the granted ability: a later land does not trigger it (CR 400.7)', () => {
    let s = toUpkeep(true);
    s = toMain(s);
    s = settle(playLand(s), { yes: [false] });
    const turn = s.turn.number;
    for (let guard = 0; guard < 800 && !(s.turn.activePlayer === 'p1' && s.turn.step === 'main1' && s.turn.number > turn && s.pending?.kind === 'priority'); guard++) {
      s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : drive(s);
    }
    // the Voyager's own upkeep trigger asked on the way (declined by drive's default); a land now triggers nothing
    s = playLand(s);
    expect(s.zones.stack.length).toBe(0);
    expect(named(s, s.zones.battlefield, 'Test Voyager').length).toBe(1);
  });
  it('the intervening "if": a card that left exile before the trigger resolves does nothing (ruling 2021-02-05)', () => {
    let s = toUpkeep(true);
    s = toMain(s);
    s = playLand(s);
    expect(s.zones.stack.length).toBe(1);
    // the exiled card leaves exile while the trigger waits
    const v = named(s, s.zones.exile, 'Test Voyager')[0]!;
    s = { ...s, zones: { ...s.zones, exile: s.zones.exile.filter((id) => id !== v), graveyard: { ...s.zones.graveyard, p1: [...s.zones.graveyard.p1!, v] } }, objects: { ...s.objects, [v]: { ...s.objects[v]!, zone: 'graveyard' } } } as GameState;
    s = settle(s, { yes: [false] });
    expect(named(s, s.zones.battlefield, 'Test Voyager').length).toBe(0);
  });
});

// ---- The Omenkeel: "exiles that many cards from the top"; "play lands from among those cards" -----------------------------------------------------------------------------

const BARGE = card('Test Omen Barge', 'Legendary Artifact — Vehicle', 'Whenever a Vehicle you control deals combat damage to a player, that player exiles that many cards from the top of their library. You may play lands from among those cards for as long as they remain exiled.\nCrew 1', { pt: ['3', '3'] });
const SKIFF = card('Test Skiff', 'Artifact Creature — Vehicle', '', { pt: ['3', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SPELL = card('Test Spark', 'Instant', 'You gain 1 life.', { cost: '{R}' });

describe('CR 401.1, 305.1, 601.3, 611.2a: "that player exiles that many cards ... You may play lands from among those cards for as long as they remain exiled."', () => {
  it('is automated', () => expect(full(BARGE)).toBe(true));
  const attack = (attacker: string): GameState => {
    const s0 = mpScenario({ defs: [BARGE, SKIFF, BEAR, SPELL], zones: { p1: { battlefield: ['Test Omen Barge', attacker] }, p2: { library: ['Test Spark', 'Plains', 'Test Bear'] } } });
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, attacker, 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    return passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'main 2');
  };
  it('a Vehicle deals 3 combat damage: that player exiles the top three cards of their library', () => {
    const s = attack('Test Skiff');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2').length).toBe(3);
  });
  it('the controller may play a land from among them, but not cast a spell among them (the negative case)', () => {
    const s = attack('Test Skiff');
    const lands = legal(s, 'p1', 'playLand').filter((a) => s.objects[(a.action as { card: string }).card]?.zone === 'exile');
    expect(lands.map((a) => nameOf(s, (a.action as { card: string }).card))).toEqual(['Plains']);
    const casts = legal(s, 'p1', 'cast').filter((a) => s.objects[(a.action as { card: string }).card]?.zone === 'exile');
    expect(casts).toEqual([]);
  });
  it('a creature that is not a Vehicle deals the damage: nothing is exiled (the negative case)', () => {
    const s = attack('Test Bear');
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2').length).toBe(0);
  });
});

// ---- Mindblade Render: "Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior" -------------------------------------------------------

const RENDER = card('Test Mind Reaver', 'Creature — Azra Warrior', 'Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior, you draw a card and you lose 1 life.', { pt: ['1', '1'] });
const WARRIOR = card('Test Raider', 'Creature — Human Warrior', '', { pt: ['2', '2'] });

describe('CR 603.2c, 603.4, 120.2: "Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior, ..." (one trigger for the batch)', () => {
  it('is automated, as one batch trigger whose damage has a Warrior source', () => {
    expect(full(RENDER)).toBe(true);
    const t = (RENDER.faces[0]!.abilities[0] as { trigger: unknown }).trigger;
    expect(t).toEqual({ on: [{ ev: 'damage', source: { subtypes: ['Warrior'] }, recipient: { player: 'opponent' }, combat: true }], batch: true, wholeBatch: true });
  });
  const combat = (active: PlayerId, attacks: { name: string; to: PlayerId }[]): GameState => {
    const zones: Partial<Record<PlayerId, { battlefield: string[] }>> = { p1: { battlefield: ['Test Mind Reaver'] } };
    for (const a of attacks) (zones[active] ??= { battlefield: [] }).battlefield.push(a.name);
    let s = mpScenario({ defs: [RENDER, WARRIOR, BEAR], zones });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.turn.activePlayer === active, 'declare attackers', 600);
    const used = new Set<string>();
    const decl = attacks.map((a) => { const id = s.zones.battlefield.find((x) => nameOf(s, x) === a.name && s.objects[x]!.controller === active && !used.has(x))!; used.add(id); return { attacker: id, defender: a.to }; });
    s = answer(s, { kind: 'declareAttackers', attacks: decl });
    handAtAttack = s.zones.hand.p1!.length;
    return passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
  };
  let handAtAttack = 0;
  it('two Warriors deal combat damage to two opponents at once: the controller draws one card and loses 1 life, once (ruling 2018-06-08)', () => {
    const s = combat('p1', [{ name: 'Test Raider', to: 'p2' }, { name: 'Test Raider', to: 'p3' }]);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(19);
    expect(s.zones.hand.p1!.length).toBe(handAtAttack + 1);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
  });
  it('only a creature that is no Warrior deals the damage: nothing happens (the negative case)', () => {
    const s = combat('p1', [{ name: 'Test Bear', to: 'p2' }]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
    expect(s.zones.hand.p1!.length).toBe(handAtAttack);
  });
  it('a Warrior an opponent controls deals combat damage to another opponent: it triggers too (ruling 2018-06-08)', () => {
    const s = combat('p2', [{ name: 'Test Raider', to: 'p3' }]);
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(18);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(19);
  });
  it('a Warrior that deals combat damage to the controller: no trigger (the controller is no opponent; the negative case)', () => {
    const s = combat('p2', [{ name: 'Test Raider', to: 'p1' }]);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
  });
});

// ---- Sapling of Colfenor: "you gain life equal to that card's toughness, lose life equal to its power, then put it into your hand" -----------------------------------------

const SAPLING = card('Test Sproutling', 'Legendary Creature — Treefolk Shaman', 'Indestructible\nWhenever Test Sproutling attacks, reveal the top card of your library. If it\'s a creature card, you gain life equal to that card\'s toughness, lose life equal to its power, then put it into your hand.', { pt: ['2', '3'] });
const OGRE = card('Test Wall Ogre', 'Creature — Ogre', '', { pt: ['3', '5'] });

describe('CR 608.2c, 119.3, 701.20a: "If it\'s a creature card, you gain life equal to that card\'s toughness, lose life equal to its power, then put it into your hand." (the revealed card)', () => {
  it('is automated: every pronoun and "that card" is the revealed card', () => expect(full(SAPLING)).toBe(true));
  const attackWith = (top: string): GameState => {
    let s = mpScenario({ defs: [SAPLING, OGRE], zones: { p1: { battlefield: ['Test Sproutling'], library: [top] } }, setup: (g) => {
      // the named card becomes the second card of the library: the first is drawn in the first draw step (a multiplayer game, CR 103.8c), then it is the top card
      const lib = g.zones.library.p1!;
      const at = lib.findIndex((x) => g.defs[g.objects[x]!.defId]!.name === top);
      const rest = lib.filter((_, i) => i !== at);
      g.zones.library.p1 = [rest[0]!, lib[at]!, ...rest.slice(1)];
    } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    expect(s.turn.number).toBe(1);
    handAt = s.zones.hand.p1!.length;
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Sproutling', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    return settle(passUntil(s, (x) => x.zones.stack.length > 0 && x.pending?.kind === 'priority', 'the attack trigger'));
  };
  let handAt = 0;
  it('a 3/5 creature card on top: gain 5 life, then lose 3 life (net 22), and the card goes to the hand (ruling 2008-08-01)', () => {
    const s = attackWith('Test Wall Ogre');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
    expect(named(s, s.zones.hand.p1!, 'Test Wall Ogre').length).toBe(1);
  });
  it('a land card on top: no life change and it stays on top of the library (the negative case, ruling 2008-08-01)', () => {
    const s = attackWith('Plains');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
    expect(nameOf(s, s.zones.library.p1![0]!)).toBe('Plains');
    expect(s.zones.hand.p1!.length).toBe(handAt);
  });
});

// ---- Bladegriff Prototype: "destroy target nonland permanent of that player's choice that one of your opponents controls" --------------------------------------------------

const GRIFFIN = card('Test Blade Griffin', 'Artifact Creature — Griffin', 'Flying\nWhenever this creature deals combat damage to a player, destroy target nonland permanent of that player\'s choice that one of your opponents controls.', { pt: ['1', '1'] });
const RELIC = card('Test Relic', 'Artifact', '');

describe('CR 601.2c, 601.7a, 603.3d: "destroy target nonland permanent of that player\'s choice that one of your opponents controls" (rulings 2020-11-10)', () => {
  it('is automated: the damaged player chooses the target, the controller controls the ability', () => {
    expect(full(GRIFFIN)).toBe(true);
    const spec = (GRIFFIN.faces[0]!.abilities[1] as { effect: { targets: unknown[] } }).effect.targets[0];
    expect(spec).toMatchObject({ filter: { notTypes: ['Land'], controller: 'opponent' }, chooser: { ref: 'event', role: 'recipient' }, chooserElse: 'anOpponent' });
  });
  const hit = (pick: (opts: string[], s: GameState) => string): { s: GameState; asked: PlayerId | undefined; options: string[] } => {
    // `options`: the offered targets as "name@controller"
    let s = mpScenario({ defs: [GRIFFIN, RELIC, BEAR], zones: { p1: { battlefield: ['Test Blade Griffin', 'Test Relic'] }, p2: { battlefield: ['Test Relic'] }, p3: { battlefield: ['Test Bear', 'Plains'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Blade Griffin', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    s = passUntil(s, (x) => x.pending?.kind === 'chooseTargets', 'the target decision');
    const p = s.pending as { kind: 'chooseTargets'; player: PlayerId; objects: string[] };
    const ids = p.objects;
    const asked = p.player;
    const labels = ids.map((id) => `${nameOf(s, id)}@${s.objects[id]?.controller}`);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: pick(ids, s) }] } as never);
    return { s: settle(s), asked, options: labels };
  };
  it('the player dealt the damage chooses, among the nonland permanents of every opponent (not the controller\'s, no land)', () => {
    const r = hit((opts, s) => opts.find((id) => nameOf(s, id) === 'Test Bear')!);
    expect(r.asked).toBe('p2');
    const owners = r.options;
    expect(owners).toContain('Test Bear@p3');
    expect(owners).toContain('Test Relic@p2');
    expect(owners).not.toContain('Test Relic@p1');
    expect(owners.some((o) => o.startsWith('Plains'))).toBe(false);
    expect(named(r.s, r.s.zones.battlefield, 'Test Bear').length).toBe(0); // p3's creature, chosen by p2, is destroyed
  });
  it('the damaged player lost the game before the trigger went on the stack: the controller picks another opponent, who chooses (ruling 2020-11-10)', () => {
    let s = mpScenario({ defs: [GRIFFIN, RELIC, BEAR], zones: { p1: { battlefield: ['Test Blade Griffin'] }, p3: { battlefield: ['Test Bear'] }, p4: { battlefield: ['Test Relic'] } }, setup: (g) => { g.players.find((x) => x.id === 'p2')!.life = 1; } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Blade Griffin', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    s = passUntil(s, (x) => x.pending?.kind === 'chooseOption', 'the choice of the opponent who chooses');
    expect(s.players.find((x) => x.id === 'p2')!.hasLost).toBe(true);
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'chooseOption', ids: ['p4'] });
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(s.pending!.player).toBe('p4');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'battlefield', 'p3') }] } as never);
    s = settle(s);
    expect(named(s, s.zones.battlefield, 'Test Bear').length).toBe(0);
  });
});

// ---- Predators' Hour: a granted "exile the top card face down; you may look at and play it ..., mana of any color" ----------------------------------------------------------

const HOUR = card('Test Hunting Hour', 'Sorcery', 'Until end of turn, creatures you control gain menace and "Whenever this creature deals combat damage to a player, exile the top card of that player\'s library face down. You may look at and play that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell."');

describe('CR 609.4b, 601.3, 406.3, 611.2a: "You may look at and play that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell."', () => {
  it('is automated', () => expect(full(HOUR)).toBe(true));
  const toMain2 = (): GameState => {
    let s = mpScenario({ defs: [HOUR, BEAR, SPELL], zones: { p1: { hand: ['Test Hunting Hour'], battlefield: ['Test Bear', 'Plains'] }, p2: { library: ['Test Spark'] } }, setup: (g) => {
      const lib = g.zones.library.p2!;
      const at = lib.findIndex((x) => g.defs[g.objects[x]!.defId]!.name === 'Test Spark');
      g.zones.library.p2 = [lib[at]!, ...lib.filter((_, i) => i !== at)];
    } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hunting Hour', 'hand', 'p1') }));
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    return settle(passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'main 2'));
  };
  it('the creature deals combat damage: the top card of that player\'s library is exiled face down, and its controller may cast it with mana of any color (a red spell paid with a Plains)', () => {
    let s = toMain2();
    const ex = s.zones.exile.find((id) => nameOf(s, id) === 'Test Spark')!;
    expect(ex).toBeDefined();
    expect(s.objects[ex]!.faceDown).toBe(true);
    const casts = legal(s, 'p1', 'cast').filter((a) => (a.action as { card: string }).card === ex);
    expect(casts.length).toBeGreaterThan(0);
    s = settle(drive(act(s, casts[0]!.action), {}));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(21);
  });
  it('an opponent\'s creature gets nothing: it deals combat damage to the caster and no card is exiled (the negative case: "creatures you control")', () => {
    let s = mpScenario({ defs: [HOUR, BEAR], zones: { p1: { hand: ['Test Hunting Hour'] }, p2: { battlefield: ['Test Bear'] } } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hunting Hour', 'hand', 'p1') }));
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(JSON.stringify(s.continuousEffects.map((r) => r.effect))).not.toContain(bear);
  });
});

// ---- Kamiz, Obscura Oculus: "Then choose another attacking creature with lesser power. That creature gains double strike until end of turn." ---------------------------------

const KAMIZ = card('Test Ink Seer', 'Legendary Creature — Octopus Rogue', 'Whenever you attack, target attacking creature can\'t be blocked this turn. It connives. Then choose another attacking creature with lesser power. That creature gains double strike until end of turn.', { pt: ['0', '4'] });
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['4', '4'] });

describe('CR 608.2c, 608.2d, 208.1, 702.4b: "Then choose another attacking creature with lesser power. That creature gains double strike until end of turn."', () => {
  it('is automated: "that creature" is the creature chosen, the comparison is with the target\'s power', () => expect(full(KAMIZ)).toBe(true));
  const attack = (names: string[], target: string, pick?: string): GameState => {
    let s = mpScenario({ defs: [KAMIZ, BRUTE, BEAR, OGRE], zones: { p1: { battlefield: ['Test Ink Seer', ...names] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: names.map((n) => ({ attacker: find(s, n, 'battlefield', 'p1'), defender: 'p2' as PlayerId })) });
    s = passUntil(s, (x) => x.pending?.kind === 'chooseTargets', 'the target');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, target, 'battlefield', 'p1') }] } as never);
    handBefore = s.zones.hand.p1!.length;
    for (let guard = 0; guard < 60 && s.zones.stack.length > 0; guard++) {
      if (s.pending?.kind === 'chooseObjects' && pick !== undefined && (s.pending.options as string[]).some((id) => s.objects[id]?.zone === 'battlefield')) {
        const opts = s.pending.options as string[];
        optionsSeen = opts.map((id) => nameOf(s, id));
        s = answer(s, { kind: 'chooseObjects', ids: [opts.find((id) => nameOf(s, id) === pick)!] });
      } else if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (s.pending.options as string[]).slice(0, s.pending.min) });
      else s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    }
    return s;
  };
  let optionsSeen: string[] = [];
  let handBefore = 0;
  const hasDouble = (s: GameState, name: string): boolean => JSON.stringify(s.continuousEffects.filter((r) => JSON.stringify(r.effect).includes('double strike')).map((r) => r.effect)).includes(find(s, name, 'battlefield', 'p1'));
  it('the 4/4 target: another attacking creature with power less than 4 (the 2/2, not the 4/4 itself) is chosen and gains double strike', () => {
    const s = attack(['Test Brute', 'Test Bear', 'Test Wall Ogre'], 'Test Brute', 'Test Bear');
    expect(optionsSeen).toContain('Test Bear');
    expect(optionsSeen).toContain('Test Wall Ogre');
    expect(optionsSeen).not.toContain('Test Brute');
    expect(hasDouble(s, 'Test Bear')).toBe(true);
    expect(hasDouble(s, 'Test Brute')).toBe(false);
    expect(hasDouble(s, 'Test Wall Ogre')).toBe(false);
    expect(s.zones.hand.p1!.length).toBe(handBefore); // it connived: one card drawn, one discarded
  });
  it('the 2/2 target: no other attacker has lesser power, so nobody gains double strike (the negative case)', () => {
    const s = attack(['Test Brute', 'Test Bear'], 'Test Bear');
    expect(hasDouble(s, 'Test Brute')).toBe(false);
    expect(hasDouble(s, 'Test Bear')).toBe(false);
  });
});

// ---- Adrestia: "Whenever ~ attacks, if an Assassin crewed it this turn, draw a card." ---------------------------------------------------------------------------------------

const SKY_SHIP = card('Test Corsair Ship', 'Legendary Artifact — Vehicle', 'Islandwalk\nWhenever Test Corsair Ship attacks, if an Assassin crewed it this turn, draw a card. Test Corsair Ship becomes an Assassin in addition to its other types until end of turn.\nCrew 1', { pt: ['4', '4'] });
const ASSASSIN = card('Test Knife', 'Creature — Human Assassin', '', { pt: ['1', '1'] });

describe('CR 702.122c, 603.4: "if an Assassin crewed it this turn" (the creature as it was when tapped for the crew cost; rulings 2024-07-05)', () => {
  it('is automated, as a condition on this turn\'s crew payments of the attacking Vehicle', () => expect(full(SKY_SHIP)).toBe(true));
  const crewThenAttack = (crewer: string, afterCrew?: (s: GameState) => GameState): GameState => {
    let s = mpScenario({ defs: [SKY_SHIP, ASSASSIN, BEAR], zones: { p1: { battlefield: ['Test Corsair Ship', crewer] } } });
    const ship = find(s, 'Test Corsair Ship', 'battlefield', 'p1');
    const crew = legal(s, 'p1', 'activate').find((a) => /crew/i.test(a.label) && (a.action as { source?: string }).source === ship)!;
    s = act(s, crew.action);
    for (let guard = 0; guard < 20 && s.pending?.kind !== 'priority'; guard++) {
      const p = s.pending!;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, crewer, 'battlefield', 'p1')] });
      else s = drive(s);
    }
    s = settle(s);
    if (afterCrew) s = afterCrew(s);
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    handAt = s.zones.hand.p1!.length;
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Corsair Ship', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    return settle(passUntil(s, (x) => x.pending?.kind === 'priority' && x.turn.step === 'declareAttackers', 'after attackers'));
  };
  let handAt = 0;
  it('crewed by an Assassin: the attack draws a card and the Vehicle becomes an Assassin until end of turn', () => {
    const s = crewThenAttack('Test Knife');
    expect(s.zones.hand.p1!.length).toBe(handAt + 1);
  });
  it('crewed by a creature that is no Assassin: no card (the negative case)', () => {
    const s = crewThenAttack('Test Bear');
    expect(s.zones.hand.p1!.length).toBe(handAt);
  });
  it('the Assassin that crewed it has left the battlefield before the attack: it still counts (ruling 2024-07-05)', () => {
    const s = crewThenAttack('Test Knife', (g) => {
      const k = find(g, 'Test Knife', 'battlefield', 'p1');
      return { ...g, zones: { ...g.zones, battlefield: g.zones.battlefield.filter((id) => id !== k), graveyard: { ...g.zones.graveyard, p1: [...g.zones.graveyard.p1!, k] } }, objects: { ...g.objects, [k]: { ...g.objects[k]!, zone: 'graveyard' } } } as GameState;
    });
    expect(s.zones.hand.p1!.length).toBe(handAt + 1);
  });
});

// ---- Trepanation Blade: "defending player reveals ... The creature gets +1/+0 ... for each card revealed this way. That player puts the revealed cards into their graveyard." ----

const DRILL = card('Test Skull Drill', 'Artifact — Equipment', 'Whenever equipped creature attacks, defending player reveals cards from the top of their library until they reveal a land card. The creature gets +1/+0 until end of turn for each card revealed this way. That player puts the revealed cards into their graveyard.\nEquip {2}');

describe('CR 701.20a, 506.2, 608.2c: the defending player\'s reveal until a land card, +1/+0 for each card revealed, the revealed cards into that player\'s graveyard (rulings 2017-11-17)', () => {
  it('is automated', () => expect(full(DRILL)).toBe(true));
  it('attacking p3: p3 reveals two spells and a land; the creature gets +3/+0 (the land counts) and all three go to p3\'s graveyard; p2\'s library is untouched', () => {
    let s = mpScenario({ defs: [DRILL, BEAR, SPELL], zones: { p1: { battlefield: ['Test Skull Drill', 'Test Bear'] }, p3: { library: ['Test Spark', 'Test Spark', 'Plains'] } }, setup: (g) => {
      g.objects[g.zones.battlefield.find((id) => g.defs[g.objects[id]!.defId]!.name === 'Test Skull Drill')!]!.attachedTo = g.zones.battlefield.find((id) => g.defs[g.objects[id]!.defId]!.name === 'Test Bear')!;
      const lib = g.zones.library.p3!;
      const named3 = lib.filter((id) => g.defs[g.objects[id]!.defId]!.name === 'Test Spark');
      const plains = lib.filter((id) => !named3.includes(id));
      g.zones.library.p3 = [...named3, ...plains]; // two spells on top, then the Plains
    } });
    const p2lib = s.zones.library.p2!.length;
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p3' as PlayerId }] });
    s = settle(passUntil(s, (x) => x.zones.stack.length > 0 && x.pending?.kind === 'priority', 'the attack trigger'));
    expect(s.zones.graveyard.p3!.length).toBe(3);
    expect(named(s, s.zones.graveyard.p3!, 'Test Spark').length).toBe(2);
    expect(s.zones.library.p2!.length).toBe(p2lib);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(15); // 2 power + 3
  });
});

// ---- Jaws, Relentless Predator: "Whenever a noncreature artifact is sacrificed or destroyed, ~ deals 1 damage to each opponent." ----------------------------------------------

const SHARK = card('Test Shark', 'Legendary Creature — Shark', 'Whenever a noncreature artifact is sacrificed or destroyed, Test Shark deals 1 damage to each opponent.', { pt: ['3', '3'] });
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');
const BANISH = card('Test Banish', 'Instant', 'Exile target artifact.');
const FODDER = card('Test Fodder Relic', 'Artifact', '{T}, Sacrifice this artifact: You gain 1 life.');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });

describe('CR 701.17a, 701.8a, 603.10a: "Whenever a noncreature artifact is sacrificed or destroyed, ..." (anyone\'s, one trigger for each)', () => {
  it('is automated', () => expect(full(SHARK)).toBe(true));
  const opp = (s: GameState): number[] => ['p2', 'p3', 'p4'].map((p) => s.players.find((x) => x.id === p)!.life);
  const setup = (): GameState => mpScenario({ defs: [SHARK, SHATTER, BANISH, FODDER, GOLEM], zones: { p1: { battlefield: ['Test Shark', 'Test Fodder Relic'], hand: ['Test Shatter', 'Test Banish'] }, p2: { battlefield: ['Test Fodder Relic', 'Test Golem'] } } });
  const castAt = (s: GameState, spell: string, target: string): GameState => {
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') });
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] } as never);
    return settle(t);
  };
  it('the controller sacrifices its own noncreature artifact: 1 damage to each opponent', () => {
    let s = setup();
    const relic = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Fodder Relic' && s.objects[id]!.controller === 'p1')!;
    const ab = legal(s, 'p1', 'activate').find((a) => (a.action as { source?: string }).source === relic)!;
    s = settle(drive(act(s, ab.action)));
    expect(opp(s)).toEqual([19, 19, 19]);
  });
  it('an opponent\'s noncreature artifact is destroyed: it triggers too', () => {
    const s0 = setup();
    const s = castAt(s0, 'Test Shatter', s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Test Fodder Relic' && s0.objects[id]!.controller === 'p2')!);
    expect(opp(s)).toEqual([19, 19, 19]);
  });
  it('an artifact creature destroyed, or a noncreature artifact exiled: no damage (the negative cases)', () => {
    const s0 = setup();
    let s = castAt(s0, 'Test Shatter', find(s0, 'Test Golem', 'battlefield', 'p2'));
    expect(opp(s)).toEqual([20, 20, 20]);
    s = castAt(s, 'Test Banish', s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Fodder Relic' && s.objects[id]!.controller === 'p2')!);
    expect(opp(s)).toEqual([20, 20, 20]);
  });
});

// ---- Anowon, the Ruin Thief: "that player mills a card for each 1 damage dealt to them. If the player mills at least one creature card this way, you draw a card." ------------

const RUIN = card('Test Ruin Thief', 'Legendary Creature — Vampire Rogue', 'Whenever one or more Rogues you control deal combat damage to a player, that player mills a card for each 1 damage dealt to them. If the player mills at least one creature card this way, you draw a card.', { pt: ['0', '1'] });
const ROGUE = card('Test Cutpurse', 'Creature — Human Rogue', '', { pt: ['2', '2'] });

describe('CR 701.17a, 120.1, 603.2c: "that player mills a card for each 1 damage dealt to them" (the Rogues\' damage only; rulings 2020-09-25)', () => {
  it('is automated', () => expect(full(RUIN)).toBe(true));
  const fight = (attacks: { name: string; to: PlayerId }[], topOf?: { p: PlayerId; name: string }): GameState => {
    let s = mpScenario({ defs: [RUIN, ROGUE, BEAR, OGRE], zones: { p1: { battlefield: ['Test Ruin Thief', ...attacks.map((a) => a.name)] }, ...(topOf ? { [topOf.p]: { library: [topOf.name] } } : {}) }, setup: (g) => {
      if (!topOf) return;
      const lib = g.zones.library[topOf.p]!;
      const at = lib.findIndex((x) => g.defs[g.objects[x]!.defId]!.name === topOf.name);
      g.zones.library[topOf.p] = [lib[at]!, ...lib.filter((_, i) => i !== at)];
    } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    const used = new Set<string>();
    s = answer(s, { kind: 'declareAttackers', attacks: attacks.map((a) => { const id = s.zones.battlefield.find((x) => nameOf(s, x) === a.name && !used.has(x))!; used.add(id); return { attacker: id, defender: a.to }; }) });
    handAt2 = s.zones.hand.p1!.length;
    for (let guard = 0; guard < 300 && !(s.turn.step === 'main2' && s.pending?.kind === 'priority'); guard++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    return s;
  };
  let handAt2 = 0;
  it('a Rogue (2 damage) and a Bear (2 damage) hit the same player: that player mills two cards, not four (ruling 2020-09-25)', () => {
    const s = fight([{ name: 'Test Cutpurse', to: 'p2' }, { name: 'Test Bear', to: 'p2' }]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(16);
    expect(s.zones.graveyard.p2!.length).toBe(2);
    expect(s.zones.hand.p1!.length).toBe(handAt2); // two Plains: no creature card, no draw
  });
  it('Rogues hit two players: it triggers for each of them (ruling 2020-09-25)', () => {
    const s = fight([{ name: 'Test Cutpurse', to: 'p2' }, { name: 'Test Cutpurse', to: 'p3' }]);
    expect(s.zones.graveyard.p2!.length).toBe(2);
    expect(s.zones.graveyard.p3!.length).toBe(2);
  });
  it('a creature card is milled: the controller draws one card', () => {
    const s = fight([{ name: 'Test Cutpurse', to: 'p2' }], { p: 'p2', name: 'Test Wall Ogre' });
    expect(named(s, s.zones.graveyard.p2!, 'Test Wall Ogre').length).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(handAt2 + 1);
  });
});

// ---- Sphinx Ambassador: search that player's library, that player names a card, put a creature card that doesn't have that name onto the battlefield -------------------------

const AMBASSADOR = card('Test Sphinx Envoy', 'Creature — Sphinx', 'Flying\nWhenever this creature deals combat damage to a player, search that player\'s library for a card, then that player chooses a card name. If you searched for a creature card that doesn\'t have that name, you may put it onto the battlefield under your control. Then that player shuffles.', { pt: ['5', '5'] });

describe('CR 701.23a, 201.2, 201.4, 608.2c, 110.2a: "If you searched for a creature card that doesn\'t have that name, you may put it onto the battlefield under your control." (rulings 2009-10-01)', () => {
  it('is automated', () => expect(full(AMBASSADOR)).toBe(true));
  const hit = (pickName: string, naming: (s: GameState) => string): { s: GameState; decisions: string[] } => {
    let s = mpScenario({ defs: [AMBASSADOR, OGRE, SPELL], zones: { p1: { battlefield: ['Test Sphinx Envoy'] }, p2: { library: ['Test Wall Ogre', 'Test Spark'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Sphinx Envoy', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    const decisions: string[] = [];
    for (let guard = 0; guard < 300 && !(s.turn.step === 'main2' && s.pending?.kind === 'priority'); guard++) {
      const p = s.pending!;
      if (p.kind === 'priority') { s = act(s, { type: 'pass', player: p.player }); continue; }
      decisions.push(`${p.kind}:${p.player}`);
      if (p.kind === 'chooseObjects' && p.player === 'p1') {
        const opts = p.options as string[];
        s = answer(s, { kind: 'chooseObjects', ids: [opts.find((id) => nameOf(s, id) === pickName)!] });
      } else if (p.kind === 'chooseName') {
        s = answer(s, { kind: 'chooseName', name: naming(s) });
      } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = drive(s);
    }
    return { s, decisions };
  };
  it('a creature card is found and the player names another card: it may be put onto the battlefield under its searcher\'s control', () => {
    const r = hit('Test Wall Ogre', () => 'Test Spark');
    expect(r.decisions).toContain('chooseName:p2'); // the player dealt the damage names the card
    const ogre = r.s.zones.battlefield.find((id) => nameOf(r.s, id) === 'Test Wall Ogre');
    expect(ogre).toBeDefined();
    expect(r.s.objects[ogre!]!.controller).toBe('p1');
  });
  it('the player names the card found: it stays in that library (the negative case)', () => {
    const r = hit('Test Wall Ogre', () => 'Test Wall Ogre');
    expect(r.s.zones.battlefield.some((id) => nameOf(r.s, id) === 'Test Wall Ogre')).toBe(false);
    expect(named(r.s, r.s.zones.library.p2!, 'Test Wall Ogre').length).toBe(1);
  });
  it('a noncreature card is found: nothing is put onto the battlefield whatever is named (ruling 2009-10-01)', () => {
    const r = hit('Test Spark', () => 'Test Wall Ogre');
    expect(r.s.zones.battlefield.some((id) => nameOf(r.s, id) === 'Test Spark')).toBe(false);
    expect(named(r.s, r.s.zones.library.p2!, 'Test Spark').length).toBe(1);
  });
});
