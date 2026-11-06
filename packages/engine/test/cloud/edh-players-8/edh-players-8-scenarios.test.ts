/**
 * edh-players-8 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The rulings of the cards were fetched from Scryfall in the cloud session;
 * the CR cites are from memory (unverified).
 *
 *   CR 101.4, 608.2d, 701.21a      "At the beginning of each opponent's end step, that player chooses up to two creatures they control, then sacrifices the rest."
 *   CR 603.7, 108.3, 400.7         "... at the beginning of that player's next end step" (the owner of the card exiled)
 *   CR 607.2d, 608.2h, 702.11d     "Choose a color. ... gains hexproof from that color ... can't be blocked by creatures of that color"
 *   CR 119.1, 608.2d               "Choose a player with the most life or tied for most life."
 *   CR 404.1, 608.2c               "If a graveyard has twenty or more cards in it, draw three cards instead."
 *   CR 603.2, 603.2c, 508.1a, 121.2  "Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, ..."
 *   CR 608.2c, 611.2a, 702.26b     "If the gift was promised, all permanents you control phase out, and until your next turn, your life total can't change and you gain protection from everything."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, life, pass, passBoth, put, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

interface Script {
  yes?: boolean[];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  targets?: TargetChoice[][];
  colors?: string[];
  options?: string[][];
  attackers?: ObjectId[];
  defender?: PlayerId;
  blocks?: { blocker: ObjectId; attacker: ObjectId }[];
}
/** Answer the decisions that come up until a player has priority; the decisions asked are listed in `asked`. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (script.colors?.shift() ?? p.options[0]) as never });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: (script.attackers ?? []).map((attacker) => ({ attacker, defender: script.defender ?? ('p2' as const) })) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: script.blocks ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 40; guard++) s = drive(passBoth(s), script, asked);
  return s;
}
const castFree = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
/** p2's cast of `name` at `target`, as far as choosing the target: a throw means the target is not legal. */
const castAt = (s: GameState, name: string, target: TargetChoice) => answer(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }), { kind: 'chooseTargets', targets: [target] });
const toP2 = (s: GameState): GameState => {
  const t = act(s, { type: 'pass', player: 'p1' });
  expect(t.pending?.player).toBe('p2');
  return t;
};
/** The attacker attacks p2 and p2 tries to block it with `blocker`: did the engine accept the block? */
const blockAccepted = (s0: GameState, attacker: ObjectId, blocker: ObjectId): boolean => {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' as const }] });
  // no creature able to block the attacker: the engine asks for no blocks at all (CR 509.1a)
  for (let guard = 0; guard < 40 && s.pending?.kind === 'priority' && s.turn.number === 1; guard++) s = pass(s);
  const d = s.pending;
  if (!d || d.kind !== 'declareBlockers') return false;
  return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker }] } }).error === undefined;
};
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';
const nameOn = (s: GameState, name: string, owner?: PlayerId): ObjectId[] => findAll(s, name, 'battlefield', owner);

// ---- Archfiend of Depravity ---------------------------------------------------------------------------------------------------------------------------------------------

const FIEND = card('Test Rot Fiend', 'Creature — Demon', "At the beginning of each opponent's end step, that player chooses up to two creatures they control, then sacrifices the rest.", { pt: ['4', '4'] });
const BEAR = (n: string): CardDef => card(`Test Bear ${n}`, 'Creature — Bear', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');

describe('CR 101.4, 608.2d, 701.21a: "At the beginning of each opponent\'s end step, that player chooses up to two creatures they control, then sacrifices the rest."', () => {
  const defs = [FIEND, BEAR('A'), BEAR('B'), BEAR('C'), BEAR('Own'), RELIC];
  const setup = (p2: string[] = ['Test Bear A', 'Test Bear B', 'Test Bear C']): GameState => scenario([], { defs, p1: { battlefield: ['Test Rot Fiend', 'Test Bear Own'] }, p2: { battlefield: p2 } });
  const keep = (...names: string[]) => (o: ObjectId[], s: GameState): ObjectId[] => o.filter((id) => names.includes(s.defs[s.objects[id]!.defId]!.name));
  it('is automated', () => expect(full(FIEND)).toBe(true));
  it("the opponent chooses two creatures at their own end step and sacrifices the rest; the Fiend's controller's creatures are not touched", () => {
    const asked: string[] = [];
    const s0 = advanceTo(setup(), 2, 'end');
    const s = settle(s0, { objects: [keep('Test Bear A', 'Test Bear B')] }, asked);
    expect(asked).toEqual(['chooseObjects:p2']);
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Test Bear A', 'Test Bear B']);
    expect(battlefieldNames(s, 'p1').sort()).toEqual(['Test Bear Own', 'Test Rot Fiend']);
    expect(zoneOf(s, find(s, 'Test Bear C', 'graveyard', 'p2'))).toBe('graveyard');
  });
  it('the opponent may spare one creature, or none: the ruling says all of their creatures are then sacrificed (CR 608.2d)', () => {
    expect(battlefieldNames(settle(advanceTo(setup(), 2, 'end'), { objects: [keep('Test Bear B')] }), 'p2')).toEqual(['Test Bear B']);
    expect(battlefieldNames(settle(advanceTo(setup(), 2, 'end'), { objects: [[]] }), 'p2')).toEqual([]);
  });
  it('with two or fewer creatures nothing needs to go: the choice keeps them', () => {
    const s = settle(advanceTo(setup(['Test Bear A', 'Test Bear B']), 2, 'end'), { objects: [keep('Test Bear A', 'Test Bear B')] });
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Test Bear A', 'Test Bear B']);
  });
  it('only creatures are sacrificed: an artifact the opponent controls stays (the negative case)', () => {
    const s = settle(advanceTo(setup(['Test Bear A', 'Test Bear B', 'Test Bear C', 'Test Relic']), 2, 'end'), { objects: [keep('Test Bear A')] });
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Test Bear A', 'Test Relic']);
  });
  it("it does not happen at its controller's own end step, nor asks anything (the negative case)", () => {
    const asked: string[] = [];
    const s = settle(advanceTo(setup(), 1, 'end'), {}, asked);
    expect(asked).toEqual([]);
    expect(battlefieldNames(s, 'p2')).toHaveLength(3);
    expect(battlefieldNames(s, 'p1')).toHaveLength(2);
  });
});

// ---- The Eternal Wanderer -----------------------------------------------------------------------------------------------------------------------------------------------

const HOURGLASS = card('Test Hourglass', 'Sorcery', "Exile up to one target artifact or creature. Return that card to the battlefield under its owner's control at the beginning of that player's next end step.");

describe('CR 603.7, 108.3, 400.7: "Exile up to one target artifact or creature. Return that card to the battlefield under its owner\'s control at the beginning of that player\'s next end step."', () => {
  const defs = [HOURGLASS, BEAR('Own'), BEAR('A')];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Hourglass'], battlefield: ['Test Bear Own'] }, p2: { battlefield: ['Test Bear A'] } });
  it('is automated', () => expect(full(HOURGLASS)).toBe(true));
  it("an opponent's creature stays exiled through your end step and returns at the beginning of ITS OWNER's next end step, under its owner's control", () => {
    let s = setup();
    const bear = find(s, 'Test Bear A', 'battlefield', 'p2');
    s = castFree(s, 'Test Hourglass', { targets: [[obj(bear)]] });
    expect(findAll(s, 'Test Bear A', 'exile')).toHaveLength(1);
    s = settle(advanceTo(s, 1, 'end'));
    expect(nameOn(s, 'Test Bear A')).toHaveLength(0);
    expect(findAll(s, 'Test Bear A', 'exile')).toHaveLength(1);
    s = settle(advanceTo(s, 2, 'main1'));
    expect(nameOn(s, 'Test Bear A')).toHaveLength(0);
    s = settle(advanceTo(s, 2, 'end'));
    expect(nameOn(s, 'Test Bear A', 'p2')).toHaveLength(1);
    expect(s.objects[nameOn(s, 'Test Bear A')[0]!]!.controller).toBe('p2');
  });
  it("your own creature returns at the beginning of YOUR next end step: this turn's", () => {
    let s = setup();
    const bear = find(s, 'Test Bear Own', 'battlefield', 'p1');
    s = castFree(s, 'Test Hourglass', { targets: [[obj(bear)]] });
    expect(nameOn(s, 'Test Bear Own')).toHaveLength(0);
    s = settle(advanceTo(s, 1, 'end'));
    expect(nameOn(s, 'Test Bear Own', 'p1')).toHaveLength(1);
  });
  it("a creature you control but do not own returns under its owner's control at its owner's end step (CR 108.3)", () => {
    let s = setup();
    const stolen = put(s, 'p2', 'battlefield', 'Test Bear A');
    s.objects[stolen]!.controller = 'p1';
    s = castFree(s, 'Test Hourglass', { targets: [[obj(stolen)]] });
    expect(findAll(s, 'Test Bear A', 'exile')).toHaveLength(1);
    s = settle(advanceTo(s, 1, 'end'));
    expect(findAll(s, 'Test Bear A', 'exile')).toHaveLength(1);
    s = settle(advanceTo(s, 2, 'end'));
    const back = nameOn(s, 'Test Bear A');
    expect(back.map((id) => s.objects[id]!.controller)).toContain('p2');
    expect(back.map((id) => s.objects[id]!.controller)).not.toContain('p1');
  });
  it('up to one: with no target nothing is exiled and nothing returns later (the negative case)', () => {
    let s = setup();
    s = castFree(s, 'Test Hourglass', { targets: [[]] });
    s = settle(advanceTo(s, 2, 'end'));
    expect(nameOn(s, 'Test Bear A', 'p2')).toHaveLength(1);
    expect(nameOn(s, 'Test Bear Own', 'p1')).toHaveLength(1);
  });
});

// ---- Visions of Beyond --------------------------------------------------------------------------------------------------------------------------------------------------

const VISIONS = card('Test Vision', 'Instant', 'Draw a card. If a graveyard has twenty or more cards in it, draw three cards instead.');

describe('CR 404.1, 608.2c: "Draw a card. If a graveyard has twenty or more cards in it, draw three cards instead."', () => {
  const fill = (s: GameState, owner: PlayerId, n: number): GameState => {
    for (let i = 0; i < n; i++) put(s, owner, 'graveyard', 'Plains');
    return s;
  };
  const drawn = (s0: GameState): number => {
    const before = s0.zones.hand.p1!.length - 1; // the spell leaves the hand
    return castFree(s0, 'Test Vision').zones.hand.p1!.length - before;
  };
  const setup = (): GameState => scenario([], { defs: [VISIONS], p1: { hand: ['Test Vision'] } });
  it('is automated', () => expect(full(VISIONS)).toBe(true));
  it('nineteen cards in every graveyard: one card; twenty in your own: three', () => {
    expect(drawn(fill(setup(), 'p1', 19))).toBe(1);
    expect(drawn(fill(setup(), 'p1', 20))).toBe(3);
  });
  it("a graveyard is anyone's: twenty cards in an opponent's graveyard are enough, nineteen and nineteen are not (each judged alone)", () => {
    expect(drawn(fill(setup(), 'p2', 20))).toBe(3);
    expect(drawn(fill(fill(setup(), 'p1', 19), 'p2', 19))).toBe(1);
  });
});

// ---- The Black Gate -----------------------------------------------------------------------------------------------------------------------------------------------------

const GATE = card('Test Gate', 'Artifact', '{0}: Choose a player with the most life or tied for most life. Target creature can\'t be blocked by creatures that player controls this turn.');

describe('CR 119.1, 608.2d: "Choose a player with the most life or tied for most life. Target creature can\'t be blocked by creatures that player controls this turn."', () => {
  const defs = [GATE, BEAR('Own'), BEAR('A'), BEAR('B')];
  const activate = (s: GameState, script: Script, asked: string[] = []): GameState => {
    const gate = find(s, 'Test Gate', 'battlefield', 'p1');
    return settle(drive(act(s, { type: 'activate', player: 'p1', source: gate, ability: 'p:0:0' }), script, asked), script, asked);
  };
  const setup = (life2 = 20): GameState => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Gate', 'Test Bear Own'] }, p2: { battlefield: ['Test Bear A'] } });
    s.players.find((p) => p.id === 'p2')!.life = life2;
    return s;
  };
  it('is automated', () => expect(full(GATE)).toBe(true));
  it('tied for the most life: both players are offered, and the chosen one is the player whose creatures can not block the target', () => {
    const asked: string[] = [];
    const s0 = setup();
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear A', 'battlefield', 'p2');
    const s = activate(s0, { targets: [[obj(own)]], options: [['p2']] }, asked);
    expect(asked.filter((k) => k.startsWith('chooseOption'))).toEqual(['chooseOption:p1']);
    expect(blockAccepted(s, own, theirs)).toBe(false);
  });
  it('choosing yourself instead: the opponent\'s creatures can still block (the negative case: only the chosen player\'s creatures are shut out)', () => {
    const s0 = setup();
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    const s = activate(s0, { targets: [[obj(own)]], options: [['p1']] });
    expect(blockAccepted(s, own, find(s, 'Test Bear A', 'battlefield', 'p2'))).toBe(true);
  });
  it('one player has more life than the rest: that player is the only one offered, so nothing is asked, and the opponent with less life is not the chosen one', () => {
    const asked: string[] = [];
    const s0 = setup(15);
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    const s = activate(s0, { targets: [[obj(own)]] }, asked);
    expect(asked.filter((k) => k.startsWith('chooseOption'))).toEqual([]);
    expect(blockAccepted(s, own, find(s, 'Test Bear A', 'battlefield', 'p2'))).toBe(true); // p1 has the most life: p1's creatures are the ones that cannot block
  });
  it('the opponent has more life: p2 is the only choice, and its creatures (also ones that enter later this turn) can not block (ruling 2023-06-16)', () => {
    const asked: string[] = [];
    const s0 = setup(25);
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    let s = activate(s0, { targets: [[obj(own)]] }, asked);
    expect(asked.filter((k) => k.startsWith('chooseOption'))).toEqual([]);
    const late = put(s, 'p2', 'battlefield', 'Test Bear B');
    expect(blockAccepted(s, own, late)).toBe(false);
    expect(blockAccepted(s, own, find(s, 'Test Bear A', 'battlefield', 'p2'))).toBe(false);
  });
  it('in a game of three players: the two with the most life are offered, the one with less life is not', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { battlefield: ['Test Gate', 'Test Bear Own'] } }, setup: (g) => { g.players.find((p) => p.id === 'p1')!.life = 18; g.players.find((p) => p.id === 'p2')!.life = 25; g.players.find((p) => p.id === 'p3')!.life = 25; } });
    let offered: string[] = [];
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    let s = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Gate', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(own)]] });
    for (let guard = 0; guard < 20; guard++) {
      if (s.pending?.kind === 'chooseOption') { offered = s.pending.options.map((o) => o.id); s = answer(s, { kind: 'chooseOption', ids: ['p3'] }); }
      else if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else break;
    }
    expect(offered.sort()).toEqual(['p2', 'p3']);
  });
});

// ---- Skrelv, Defector Mite ----------------------------------------------------------------------------------------------------------------------------------------------

const MITE = card('Test Mite', 'Artifact Creature — Phyrexian Mite', "{0}: Choose a color. Another target creature you control gains toxic 1 and hexproof from that color until end of turn. It can't be blocked by creatures of that color this turn.\nSacrifice ~: Draw a card.", { pt: ['1', '1'] });
const RED_BEAR = card('Test Red Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['R'] });
const GREEN_BEAR = card('Test Green Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const GREEN_SHOCK = card('Test Green Shock', 'Instant', 'Test Green Shock deals 2 damage to any target.', { colors: ['G'] });
const RED_SHOCK = card('Test Red Shock', 'Instant', 'Test Red Shock deals 2 damage to any target.', { colors: ['R'] });

describe('CR 607.2d, 608.2h, 702.11d, 509.1b: "Choose a color. Another target creature you control gains toxic 1 and hexproof from that color until end of turn. It can\'t be blocked by creatures of that color this turn."', () => {
  const defs = [MITE, BEAR('Own'), BEAR('Two'), RED_BEAR, GREEN_BEAR, RED_SHOCK, GREEN_SHOCK];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Mite', 'Test Bear Own', 'Test Bear Two'] }, p2: { battlefield: ['Test Red Bear', 'Test Green Bear'], hand: ['Test Red Shock', 'Test Green Shock'] } });
  const give = (s: GameState, target: ObjectId, color: string, asked: string[] = []): GameState =>
    settle(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Mite', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(target)]], colors: [color] }, asked), { colors: [color] }, asked);
  it('is automated', () => expect(full(MITE)).toBe(true));
  it('the color is chosen as the ability resolves, after the target: the target gains toxic 1, and spells and abilities of that color can not target it, other colors can', () => {
    const s0 = setup();
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    const asked: string[] = [];
    const s = toP2(give(s0, own, 'R', asked));
    expect(asked.filter((k) => k.startsWith('chooseColor'))).toEqual(['chooseColor:p1']);
    expect(hasKeyword(getChars(s, own), 'toxic')).toBe(true);
    expect(hasKeyword(getChars(s, find(s, 'Test Bear Two', 'battlefield', 'p1')), 'toxic')).toBe(false);
    expect(() => castAt(s, 'Test Red Shock', obj(own))).toThrow();
    expect(castAt(s, 'Test Green Shock', obj(own)).zones.stack).toHaveLength(1);
    expect(castAt(s, 'Test Red Shock', obj(find(s, 'Test Bear Two', 'battlefield', 'p1'))).zones.stack).toHaveLength(1); // the other creature is not affected
  });
  it('creatures of that color can not block it, creatures of another color can (CR 509.1b)', () => {
    const s0 = setup();
    const own = find(s0, 'Test Bear Own', 'battlefield', 'p1');
    const s = give(s0, own, 'R');
    expect(blockAccepted(s, own, find(s, 'Test Red Bear', 'battlefield', 'p2'))).toBe(false);
    expect(blockAccepted(s, own, find(s, 'Test Green Bear', 'battlefield', 'p2'))).toBe(true);
  });
  it('each effect keeps the color chosen as it began: a second activation for another creature with another color does not change the first (CR 608.2h)', () => {
    let s = setup();
    const own = find(s, 'Test Bear Own', 'battlefield', 'p1');
    const two = find(s, 'Test Bear Two', 'battlefield', 'p1');
    s = give(s, own, 'R');
    s = give(s, two, 'G');
    expect(blockAccepted(s, own, find(s, 'Test Red Bear', 'battlefield', 'p2'))).toBe(false);
    expect(blockAccepted(s, own, find(s, 'Test Green Bear', 'battlefield', 'p2'))).toBe(true);
    expect(blockAccepted(s, two, find(s, 'Test Green Bear', 'battlefield', 'p2'))).toBe(false);
    expect(blockAccepted(s, two, find(s, 'Test Red Bear', 'battlefield', 'p2'))).toBe(true);
    s = toP2(s);
    expect(() => castAt(s, 'Test Red Shock', obj(own))).toThrow();
    expect(castAt(s, 'Test Green Shock', obj(own)).zones.stack).toHaveLength(1);
    expect(() => castAt(s, 'Test Green Shock', obj(two))).toThrow();
    expect(castAt(s, 'Test Red Shock', obj(two)).zones.stack).toHaveLength(1);
  });
  it('the effects go on when the Mite has left the battlefield (CR 611.2a)', () => {
    let s = setup();
    const own = find(s, 'Test Bear Own', 'battlefield', 'p1');
    s = give(s, own, 'R');
    s = settle(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Mite', 'battlefield', 'p1'), ability: 'p:0:1' })));
    expect(nameOn(s, 'Test Mite')).toHaveLength(0);
    expect(blockAccepted(s, own, find(s, 'Test Red Bear', 'battlefield', 'p2'))).toBe(false);
    expect(() => castAt(toP2(s), 'Test Red Shock', obj(own))).toThrow();
  });
  it('the effects end with the turn (the negative case)', () => {
    let s = setup();
    const own = find(s, 'Test Bear Own', 'battlefield', 'p1');
    s = give(s, own, 'R');
    s = advanceTo(s, 2, 'main1');
    expect(hasKeyword(getChars(s, own), 'toxic')).toBe(false);
    expect(castAt(s, 'Test Red Shock', obj(own)).zones.stack).toHaveLength(1);
  });
});

// ---- Trouble in Pairs ---------------------------------------------------------------------------------------------------------------------------------------------------

const WATCH = card('Test Pair Watch', 'Enchantment', 'Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, you draw a card.');
const CANTRIP = card('Test Cantrip', 'Instant', 'Draw a card.');

describe('CR 603.2, 603.2c, 508.1a, 121.2: "Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, you draw a card."', () => {
  const defs = [WATCH, CANTRIP, BEAR('A'), BEAR('B'), BEAR('Own')];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Pair Watch'], hand: ['Test Cantrip', 'Test Cantrip'] }, p2: { battlefield: ['Test Bear A', 'Test Bear B'], hand: ['Test Cantrip', 'Test Cantrip'] } });
  const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  /** p2's turn: pass to the declaration of attackers, attack p1 with the creatures, let the triggers resolve. */
  const attackP1 = (s0: GameState, attackers: ObjectId[]): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
    s = drive(answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p1' as const })) }));
    return settle(s);
  };
  const cantrip = (s: GameState): GameState => castFree(s, 'Test Cantrip', {}, 'p2');
  it('is automated', () => expect(full(WATCH)).toBe(true));
  it('the second card an opponent draws in a turn triggers it (their draw step draw is the first), the third does not', () => {
    let s = advanceTo(setup(), 2, 'main1');
    const before = hand(s, 'p1');
    s = cantrip(s); // p2 casts their first spell and draws their second card
    expect(hand(s, 'p1')).toBe(before + 1);
    s = cantrip(s); // their second spell (triggers) and their third card (does not)
    expect(hand(s, 'p1')).toBe(before + 2);
  });
  it('the second spell an opponent casts in a turn triggers it, the first does not', () => {
    // a draw-less pair of spells: two do-nothing instants
    const NOTHING = card('Test Nothing', 'Instant', 'You gain 1 life.');
    let s = advanceTo(scenario([], { defs: [WATCH, NOTHING, CANTRIP], p1: { battlefield: ['Test Pair Watch'] }, p2: { hand: ['Test Nothing', 'Test Nothing', 'Test Nothing'] } }), 2, 'main1');
    const before = hand(s, 'p1');
    s = castFree(s, 'Test Nothing', {}, 'p2');
    expect(hand(s, 'p1')).toBe(before);
    s = castFree(s, 'Test Nothing', {}, 'p2');
    expect(hand(s, 'p1')).toBe(before + 1);
    s = castFree(s, 'Test Nothing', {}, 'p2');
    expect(hand(s, 'p1')).toBe(before + 1); // the third spell: no
  });
  it('attacking you with two creatures triggers it ONCE (not once for each creature); attacking with one creature does not', () => {
    let s = advanceTo(setup(), 2, 'main1');
    const before = hand(s, 'p1');
    const a = find(s, 'Test Bear A', 'battlefield', 'p2');
    const b = find(s, 'Test Bear B', 'battlefield', 'p2');
    const one = attackP1(s, [a]);
    expect(hand(one, 'p1')).toBe(before);
    const two = attackP1(s, [a, b]);
    expect(hand(two, 'p1')).toBe(before + 1);
  });
  it('one turn can trigger it three times: the attack, the second draw and the second spell (ruling 2024-02-02)', () => {
    let s = advanceTo(setup(), 2, 'main1');
    const before = hand(s, 'p1');
    s = attackP1(s, [find(s, 'Test Bear A', 'battlefield', 'p2'), find(s, 'Test Bear B', 'battlefield', 'p2')]);
    expect(hand(s, 'p1')).toBe(before + 1);
    s = advanceTo(s, 2, 'main2');
    s = cantrip(s); // their first spell, their second card: one trigger
    expect(hand(s, 'p1')).toBe(before + 2);
    s = cantrip(s); // their second spell: one trigger
    expect(hand(s, 'p1')).toBe(before + 3);
  });
  it("the Watch's controller's own attacks, draws and spells do not trigger it (the negative case)", () => {
    const own = scenario([], { defs, p1: { battlefield: ['Test Pair Watch', 'Test Bear Own'], hand: ['Test Cantrip', 'Test Cantrip'] }, p2: {} });
    const before = hand(own, 'p1');
    let s = castFree(own, 'Test Cantrip');
    s = castFree(s, 'Test Cantrip');
    expect(hand(s, 'p1')).toBe(before - 2 + 2);
  });
  it('the draw and cast counts are per player and per turn: the next turn starts again at the first', () => {
    let s = advanceTo(setup(), 2, 'main1');
    s = cantrip(s);
    s = advanceTo(s, 4, 'main1'); // p2's next turn
    const before = hand(s, 'p1');
    s = cantrip(s); // their first spell, second card of THIS turn
    expect(hand(s, 'p1')).toBe(before + 1);
  });
});

// ---- Perch Protection ---------------------------------------------------------------------------------------------------------------------------------------------------

const PERCH = card('Test Perch', 'Instant', 'Gift a card\nCreate two 1/1 white Spirit creature tokens with flying. If the gift was promised, all permanents you control phase out, and until your next turn, your life total can\'t change and you gain protection from everything.\nExile ~.');
const RAIN = card('Test Rain', 'Instant', 'Test Rain deals 3 damage to each player.');

describe('CR 608.2c, 611.2a, 702.26b, 702.16b: "If the gift was promised, all permanents you control phase out, and until your next turn, your life total can\'t change and you gain protection from everything."', () => {
  const defs = [PERCH, BEAR('Own'), RAIN, RED_SHOCK];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Perch'], battlefield: ['Test Bear Own'] }, p2: { hand: ['Test Rain', 'Test Red Shock'] } });
  const phased = (s: GameState, name: string): boolean[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name).map((id) => s.objects[id]!.phasedOut);
  it('is automated', () => expect(full(PERCH)).toBe(true));
  it('promised: two Spirits are created, all permanents you control (the Spirits too) phase out, the opponent draws the gift card, and the spell is exiled, not put into the graveyard', () => {
    const s0 = setup();
    const before = s0.zones.hand.p2!.length;
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Perch', 'hand', 'p1') }), { yes: [true] }), {});
    expect(s.zones.hand.p2!.length).toBe(before + 1);
    expect(phased(s, 'Test Bear Own')).toEqual([true]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && !s.objects[id]!.phasedOut)).toEqual([]);
    expect(findAll(s, 'Test Perch', 'exile')).toHaveLength(1);
    expect(findAll(s, 'Test Perch', 'graveyard')).toHaveLength(0);
  });
  it('your life total can not change and you can not be targeted or dealt damage until your next turn; the opponent still can', () => {
    let s = settle(drive(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Perch', 'hand', 'p1') }), { yes: [true] }), {});
    s = toP2(s);
    expect(() => castAt(s, 'Test Red Shock', pl('p1'))).toThrow();
    s = settle(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Rain', 'hand', 'p2') })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 17]);
  });
  it('the permanents phase in as your next turn begins, and your life total can change again', () => {
    let s = settle(drive(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Perch', 'hand', 'p1') }), { yes: [true] }), {});
    s = advanceTo(s, 3, 'main1');
    expect(phased(s, 'Test Bear Own')).toEqual([false]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && !s.objects[id]!.phasedOut)).toHaveLength(3);
  });
  it('not promised: the Spirits are created and stay phased in, nothing else happens, and the spell is still exiled (the negative case)', () => {
    const s0 = setup();
    const before = s0.zones.hand.p2!.length;
    let s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Perch', 'hand', 'p1') }), { yes: [false] }), {});
    expect(s.zones.hand.p2!.length).toBe(before);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && !s.objects[id]!.phasedOut)).toHaveLength(3);
    expect(findAll(s, 'Test Perch', 'exile')).toHaveLength(1);
    s = toP2(s);
    expect(castAt(s, 'Test Red Shock', pl('p1')).zones.stack).toHaveLength(1);
  });
});
