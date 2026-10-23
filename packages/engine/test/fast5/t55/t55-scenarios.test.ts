/**
 * FAST5 T55 (tokens with quoted abilities, keyword-N riders and names): the quoted-ability lowering ("Activate only as a sorcery." inside the quotes,
 * "Landfall --" labels), the token renderer, the NamedToken hole and the Spirit "can't block or be blocked by non-Spirit creatures" static, played through the
 * engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 602.5d, 111.4   a token with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery." has that ability, at sorcery speed
 *   CR 509.1b          "can't block or be blocked by non-Spirit creatures" bans both halves; "can block only creatures with flying" bans the rest
 *   CR 702.122a        a Vehicle token "with crew 1" has the crew ability (a keyword with a parameter, said as words in the token's description)
 *   CR 111.4, 205.4a   a token given a name ("Mowu, a legendary 3/3 green Dog creature token") has that name, is legendary, and the legend rule applies to it
 *   CR 301.5, 702.6a   "a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}": the token is an Equipment with equip
 *   CR 201.5a, 603.2   the name inside a named token's quoted ability is the token ("Whenever Redwing attacks, ...", "Landfall -- ... put a counter on Zabu")
 *   CR 606.4, 113.1c   "[-2]: ..." inside quotes is a loyalty ability the planeswalkers have
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DeclareBlockersDecision, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { attackUnblocked, declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toStep, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const pt = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** No ability of the card left manual (an experimental template caps the card at partial, so this is what the parse alone is judged by). */
const parsed = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** ... and the card is full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && parsed(d);
const tokens = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);
const defOf = (s: GameState, id: ObjectId) => s.defs[s.objects[id]!.defId]!;
/** A token is not summoning sick any more (it has been under its controller's control since turn 0). */
const unsick = (s: GameState, ids: ObjectId[]): GameState => tweak(s, (t) => { for (const id of ids) t.objects[id]!.controlledSinceTurn = 0; });

/** Answer the decisions that come up: targets in order, costs automatically, yes to questions; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const groups = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: groups.shift() ?? [] });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = settle(s0, targets);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets);
  return s;
}
const cast = (s0: GameState, name: string, targets: TargetChoice[][] = [], player = 'p1'): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), targets), targets);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SPIRIT_CREATURE = card('Test Ghost', 'Creature — Spirit', '', ['2', '2']);

describe('CR 602.5d, 111.4: a Mercenary token with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery."', () => {
  const MAKER = card('Test Maker', 'Creature — Human', 'When Test Maker enters, create a 1/1 red Mercenary creature token with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery."', ['2', '2']);
  const POSSE = card('Test Posse', 'Sorcery', 'Create two 1/1 red Mercenary creature tokens with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery."');
  it('are full', () => {
    expect(full(MAKER)).toBe(true);
    expect(full(POSSE)).toBe(true);
  });
  it('the token has an activated ability with the sorcery restriction and the {T} cost', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Maker'] }, defs: [MAKER] }), 'Test Maker');
    const [merc] = tokens(s);
    expect(merc).toBeDefined();
    const d = defOf(s, merc!);
    expect(d.faces[0]!.subtypes).toEqual(['Mercenary']);
    const ab = d.faces[0]!.abilities.find((a) => a.kind === 'activated');
    expect(ab).toMatchObject({ kind: 'activated', sorcerySpeed: true, cost: { tap: true } });
  });
  it('can be activated in the controller\'s main phase with an empty stack (+1/+0 until end of turn) and not in the beginning of combat step or on the opponent\'s turn', () => {
    let s = cast(scenario([], { p1: { hand: ['Test Posse'], battlefield: ['Test Bear'] }, defs: [POSSE, BEAR] }), 'Test Posse');
    const [merc] = tokens(s);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = unsick(s, tokens(s));
    const activate = (x: GameState) => legal(x, 'p1', 'activate').filter((a) => a.object === merc);
    expect(activate(s).length).toBe(1);
    const after = resolveAll(act(s, activate(s)[0]!.action), [[obj(bear)]]);
    expect(pt(after, bear)).toBe('3/2');
    expect(after.objects[merc!]!.tapped).toBe(true);
    // CR 602.5d: not at instant speed
    const combat = toStep(unsick(s, tokens(s)), 'beginCombat');
    expect(combat.pending?.player).toBe('p1');
    expect(activate(combat)).toEqual([]);
    // ... and not during the opponent's turn
    const theirs = advanceTo(s, 2, 'main1');
    expect(theirs.turn.activePlayer).toBe('p2');
    expect(legal(pass(theirs), 'p1', 'activate').filter((a) => a.object === merc)).toEqual([]);
  });
});

describe('CR 509.1b: a Spirit token "can\'t block or be blocked by non-Spirit creatures"', () => {
  const SPIRIT_MAKER = card('Test Medium', 'Creature — Human', 'When Test Medium enters, create a 1/1 colorless Spirit creature token with "This token can\'t block or be blocked by non-Spirit creatures."', ['1', '1']);
  const blockers = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
  const rejected = (f: () => GameState): boolean => { try { f(); return false; } catch (e) { return /rejected|illegal|not allowed|can't/i.test(String(e)); } };
  it('is parsed, with no manual part', () => expect(parsed(SPIRIT_MAKER)).toBe(true));
  it('the token attacks: a non-Spirit creature cannot block it, a Spirit creature can', () => {
    let s = cast(scenario([], { p1: { hand: ['Test Medium'] }, p2: { battlefield: ['Test Bear', 'Test Ghost'] }, defs: [SPIRIT_MAKER, BEAR, SPIRIT_CREATURE] }), 'Test Medium');
    const [spirit] = tokens(s);
    s = unsick(s, tokens(s));
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const ghost = find(s, 'Test Ghost', 'battlefield', 'p2');
    const b = passUntil(declareAttackers(toDeclareAttackers(s), [[spirit!]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    expect(blockers(b).candidates.some((c) => c.id === bear && c.attackers.includes(spirit!))).toBe(false);
    expect(blockers(b).candidates.some((c) => c.id === ghost && c.attackers.includes(spirit!))).toBe(true);
    expect(rejected(() => declareBlockers(b, [[bear, spirit!]]))).toBe(true);
    expect(declareBlockers(b, [[ghost, spirit!]]).combat?.blockers.some((x) => x.id === ghost)).toBe(true);
  });
  it('the token cannot block a non-Spirit attacker, and can block a Spirit attacker', () => {
    const s0 = scenario([], { p2: { hand: ['Test Medium'], battlefield: ['Test Bear', 'Test Ghost'] }, p1: { battlefield: ['Test Bear', 'Test Ghost'] }, defs: [SPIRIT_MAKER, BEAR, SPIRIT_CREATURE] });
    // the opponent makes the token on their own turn: pass to their main phase
    let s = advanceTo(s0, 2, 'main1');
    s = cast(s, 'Test Medium', [], 'p2');
    const spirit = tokens(s, 'p2')[0]!;
    s = tweak(s, (t) => { t.objects[spirit]!.controlledSinceTurn = 0; });
    s = advanceTo(s, 3, 'declareAttackers');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ghost = find(s, 'Test Ghost', 'battlefield', 'p1');
    const b1 = passUntil(declareAttackers(s, [[bear]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    expect(blockers(b1).candidates.some((c) => c.id === spirit)).toBe(false);
    const b2 = passUntil(declareAttackers(s, [[ghost]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    expect(blockers(b2).candidates.some((c) => c.id === spirit && c.attackers.includes(ghost))).toBe(true);
  });
});

describe('CR 509.1b: a Drone token with flying and "This token can block only creatures with flying."', () => {
  const FORGE = card('Test Forge', 'Sorcery', 'Create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."');
  const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', ['2', '2']);
  const blockers = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
  it('is full, and the token has flying and the block restriction', () => {
    expect(full(FORGE)).toBe(true);
    const s = cast(scenario([], { p1: { hand: ['Test Forge'] }, defs: [FORGE] }), 'Test Forge');
    const [drone] = tokens(s);
    expect(hasKeyword(chars(s, drone!), 'flying')).toBe(true);
    expect(JSON.stringify(defOf(s, drone!).faces[0]!.abilities)).toContain('"mode":"onlyIf"');
  });
  it('blocks a flying attacker and cannot block a ground attacker', () => {
    const s0 = scenario([], { p2: { hand: ['Test Forge'], battlefield: [] }, p1: { battlefield: ['Test Bear', 'Test Flyer'] }, defs: [FORGE, BEAR, FLYER] });
    let s = advanceTo(s0, 2, 'main1');
    s = cast(s, 'Test Forge', [], 'p2');
    const drone = tokens(s, 'p2')[0]!;
    s = tweak(s, (t) => { t.objects[drone]!.controlledSinceTurn = 0; });
    s = advanceTo(s, 3, 'declareAttackers');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const flyer = find(s, 'Test Flyer', 'battlefield', 'p1');
    const b = passUntil(declareAttackers(s, [[bear], [flyer]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    expect(blockers(b).candidates.some((c) => c.id === drone && c.attackers.includes(flyer))).toBe(true);
    expect(blockers(b).candidates.some((c) => c.id === drone && c.attackers.includes(bear))).toBe(false);
  });
});

describe("CR 608.2h, 506.4: \"Return target nonland permanent to its owner's hand. If it was attacking, create a 1/1 colorless Drone artifact creature token ...\"", () => {
  const BLAST = card('Test Blast', 'Instant', "Return target nonland permanent to its owner's hand. If it was attacking, create a 1/1 colorless Drone artifact creature token with flying and \"This token can block only creatures with flying.\"");
  it('is full', () => expect(full(BLAST)).toBe(true));
  it('the token is created when the target was an attacking creature (last known information), and not when it was not attacking', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { hand: ['Test Blast'] }, defs: [BLAST, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const attacking = passUntil(declareAttackers(toDeclareAttackers(s0), [[bear]]), (x) => x.turn.step === 'declareAttackers' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's priority after attackers are declared");
    const s1 = cast(attacking, 'Test Blast', [[obj(bear)]], 'p2');
    expect(tokens(s1, 'p2').length).toBe(1);
    expect(s1.zones.hand['p1']!.some((id) => s1.objects[id]!.defId === 'Test Bear')).toBe(true);
    // not attacking: in p1's main phase p2 holds priority after p1 passes
    const quiet = cast(pass(s0), 'Test Blast', [[obj(bear)]], 'p2');
    expect(tokens(quiet, 'p2').length).toBe(0);
    expect(quiet.zones.hand['p1']!.some((id) => quiet.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
});

describe('CR 702.122a: a Vehicle token "with crew 1"', () => {
  const PILOT = card('Test Pilot', 'Creature — Human Pilot', 'When Test Pilot enters, create a 3/2 colorless Vehicle artifact token with crew 1.', ['1', '1']);
  const SOLDIER = card('Test Fire Soldier', 'Creature — Human Soldier', 'When Test Fire Soldier enters, create a 2/2 red Soldier creature token with firebending 1.', ['1', '1']);
  it('both are full', () => {
    expect(full(PILOT)).toBe(true);
    expect(full(SOLDIER)).toBe(true);
  });
  it('the Vehicle token can be crewed by tapping a creature with power 1 or more and then is a 3/2 artifact creature until end of turn', () => {
    let s = cast(scenario([], { p1: { hand: ['Test Pilot'], battlefield: ['Test Bear'] }, defs: [PILOT, BEAR] }), 'Test Pilot');
    const [veh] = tokens(s);
    expect(chars(s, veh!).types).not.toContain('Creature');
    s = unsick(s, tokens(s));
    const crew = legal(s, 'p1', 'activate').find((a) => a.object === veh);
    expect(crew).toBeDefined();
    s = act(s, crew!.action);
    expect(s.pending?.kind).toBe('chooseObjects'); // the crew cost: tap untapped creatures with total power 1 or more (CR 702.122a)
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'battlefield', 'p1')] }));
    expect(chars(s, veh!).types).toContain('Creature');
    expect(pt(s, veh!)).toBe('3/2');
  });
  it('the Soldier token has firebending 1 as a keyword ability with its parameter', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Fire Soldier'] }, defs: [SOLDIER] }), 'Test Fire Soldier');
    const [soldier] = tokens(s);
    expect(defOf(s, soldier!).faces[0]!.abilities).toMatchObject([{ kind: 'keyword', keyword: 'firebending', amount: 1 }]);
  });
});

describe('CR 111.4, 205.4a, 704.5j: Mowu, a legendary 3/3 green Dog creature token', () => {
  const KEEPER = card('Test Keeper', 'Creature — Human', 'When Test Keeper enters, create Mowu, a legendary 3/3 green Dog creature token.', ['1', '1']);
  const KEEPER2 = card('Test Keeper Two', 'Creature — Human', 'When Test Keeper Two enters, create Mowu, a legendary 3/3 green Dog creature token.', ['1', '1']);
  it('is parsed, with no manual part', () => expect(parsed(KEEPER)).toBe(true));
  it('the token is named Mowu, legendary, green, a 3/3 Dog creature', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Keeper'] }, defs: [KEEPER] }), 'Test Keeper');
    const [mowu] = tokens(s);
    expect(defOf(s, mowu!).name).toBe('Mowu');
    const c = chars(s, mowu!);
    expect(c.supertypes).toContain('Legendary');
    expect([...c.colors]).toEqual(['G']);
    expect(pt(s, mowu!)).toBe('3/3');
    expect([...c.subtypes]).toEqual(['Dog']);
  });
  it('two Mowu tokens are two legendary permanents with the same name: the legend rule leaves one (CR 704.5j)', () => {
    let s = cast(scenario([], { p1: { hand: ['Test Keeper', 'Test Keeper Two'] }, defs: [KEEPER, KEEPER2] }), 'Test Keeper');
    s = cast(s, 'Test Keeper Two');
    s = settle(s);
    // the legend rule asks which one to keep (a choice of objects) unless the engine has already applied it
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 5; guard++) {
      const d = s.pending as unknown as { options: ObjectId[] };
      s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
    }
    expect(tokens(s).filter((id) => defOf(s, id).name === 'Mowu').length).toBe(1);
  });
});

describe('CR 111.4, 702.6a: a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}', () => {
  const SMITH = card('Test Smith', 'Creature — Dwarf', 'When Test Smith enters, create a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}.', ['1', '1']);
  const WEARER = card('Test Smith Two', 'Creature — Dwarf', 'When Test Smith Two enters, create a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}. Attach it to Test Smith Two.', ['1', '1']);
  it('is full', () => expect(full(SMITH)).toBe(true));
  it('the token is an Equipment named Axe with the equip ability; equipping a creature gives it +1/+0', () => {
    let s = cast(scenario([], { p1: { hand: ['Test Smith'], battlefield: ['Test Bear', 'Plains', 'Plains'] }, defs: [SMITH, BEAR] }), 'Test Smith');
    const axe = tokens(s).find((id) => defOf(s, id).name === 'Axe')!;
    expect(axe).toBeDefined();
    expect([...chars(s, axe).subtypes]).toEqual(['Equipment']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const equip = legal(s, 'p1', 'activate').find((a) => a.object === axe);
    expect(equip).toBeDefined();
    s = resolveAll(act(s, equip!.action), [[obj(bear)]]);
    expect(s.objects[axe]!.attachedTo).toBe(bear);
    expect(pt(s, bear)).toBe('3/2');
  });
  it('"Attach it to ~" after the token is created attaches the token to the creature that made it (CR 701.3, 301.5)', () => {
    expect(full(WEARER)).toBe(true);
    const s = cast(scenario([], { p1: { hand: ['Test Smith Two'] }, defs: [WEARER] }), 'Test Smith Two');
    const axe = tokens(s).find((id) => defOf(s, id).name === 'Axe')!;
    const smith = find(s, 'Test Smith Two', 'battlefield', 'p1');
    expect(s.objects[axe]!.attachedTo).toBe(smith);
    expect(pt(s, smith)).toBe('2/1');
  });
});

describe('CR 201.5a, 603.2: the name of a named token inside its quoted ability is the token itself', () => {
  const FALCON = card('Test Falcon', 'Creature — Human Hero', 'When Test Falcon enters, create Redwing, a legendary 1/1 blue Bird Scout creature token with flying and "Whenever Redwing attacks, surveil 1."', ['1', '1']);
  const HUNTER = card('Test Hunter', 'Creature — Human Barbarian', 'When Test Hunter enters, create Zabu, a legendary 2/2 green Cat creature token with "Landfall -- Whenever a land you control enters, put a +1/+1 counter on Zabu."', ['2', '2']);
  it('both are parsed with no manual ability', () => {
    for (const d of [FALCON, HUNTER]) expect(parsed(d)).toBe(true);
  });
  it('Redwing has a triggered ability on attack and flying; the ability is the token\'s own (a trigger on itself)', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Falcon'] }, defs: [FALCON] }), 'Test Falcon');
    const [redwing] = tokens(s);
    const d = defOf(s, redwing!);
    expect(d.name).toBe('Redwing');
    expect(JSON.stringify(d.faces[0]!.abilities)).toContain('"ev":"attacks"');
    expect(JSON.stringify(d.faces[0]!.abilities)).toContain('"self":true');
    expect(hasKeyword(chars(s, redwing!), 'flying')).toBe(true);
  });
  it('Zabu gets a +1/+1 counter whenever a land enters under its controller\'s control (landfall, CR 207.2c)', () => {
    let s = cast(scenario([], { p1: { hand: ['Test Hunter', 'Plains'] }, defs: [HUNTER] }), 'Test Hunter');
    const [zabu] = tokens(s);
    expect(defOf(s, zabu!).faces[0]!.abilities[0]!.label).toBe('Landfall');
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') }));
    expect(s.objects[zabu!]!.counters['+1/+1']).toBe(1);
    expect(pt(s, zabu!)).toBe('3/3');
  });
});

describe("CR 111.4, 201.5a, 508.1d: a token given a name is never the card: \"target opponent creates The Void\" and \"tokens named Koma's Coil\"", () => {
  const SENTRY = card('Test Sentry', 'Legendary Creature — Human Hero', 'When Test Sentry enters, target opponent creates The Void, a legendary 5/5 black Horror Villain creature token with flying, indestructible, and "The Void attacks each combat if able."', ['2', '2']);
  const KOMA = card('Koma, Test Serpent', 'Legendary Creature — Serpent', "Whenever Koma deals combat damage to a player, create four 3/3 blue Serpent creature tokens named Koma's Coil.", ['3', '3']);
  const HOLE = card('Test Sentry Hole', 'Instant', 'Target opponent creates The Void, a legendary 5/5 black Horror Villain creature token with flying, indestructible, and "The Void attacks each combat if able."');
  it('are parsed without a manual part', () => {
    expect(parsed(SENTRY)).toBe(true);
    expect(parsed(KOMA)).toBe(true);
  });
  it("The Void is created under the opponent's control, named The Void, and has to attack each combat if able (the name inside the quotes is the token)", () => {
    let s = cast(scenario([], { p1: { hand: ['Test Sentry Hole'] }, defs: [HOLE] }), 'Test Sentry Hole', [[{ kind: 'player', id: 'p2' }]]);
    const mine = tokens(s, 'p1');
    const void_ = tokens(s, 'p2');
    expect(mine).toEqual([]);
    expect(void_.length).toBe(1);
    expect(defOf(s, void_[0]!).name).toBe('The Void');
    expect(pt(s, void_[0]!)).toBe('5/5');
    expect(hasKeyword(chars(s, void_[0]!), 'indestructible')).toBe(true);
    expect(JSON.stringify(defOf(s, void_[0]!).faces[0]!.abilities)).toContain('"mode":"mustIfAble"');
    // CR 508.1d: on its controller's turn it must attack if able
    s = unsick(s, void_);
    const t2 = advanceTo(s, 2, 'declareAttackers');
    expect(t2.pending?.kind).toBe('declareAttackers');
    expect(() => declareAttackers(t2, [])).toThrow();
    expect(declareAttackers(t2, [[void_[0]!]]).combat?.attackers.some((a) => a.id === void_[0])).toBe(true);
  });
  it("Koma's Coil tokens are named Koma's Coil, not \"~'s Coil\" and not the card (the name is a characteristic of the token)", () => {
    let s = scenario([], { p1: { battlefield: ['Koma, Test Serpent'] }, defs: [KOMA] });
    const koma = find(s, 'Koma, Test Serpent', 'battlefield', 'p1');
    s = attackUnblocked(s, [koma]);
    const coils = tokens(s).filter((id) => defOf(s, id).name === "Koma's Coil");
    expect(coils.length).toBe(4);
    expect(pt(s, coils[0]!)).toBe('3/3');
  });
});

describe('CR 606.4, 113.1c: "Planeswalkers you control have "[-2]: Create a 2/2 colorless Wizard Soldier creature token named Cadet. Surveil 1.""', () => {
  const WAY = card('Test Way', 'Legendary Enchantment', 'When Test Way enters, nothing happens.\nPlaneswalkers you control have "[−2]: Create a 2/2 colorless Wizard Soldier creature token named Cadet. Surveil 1."');
  it('the grant is parsed without a manual part and the quoted ability has a loyalty cost of -2', () => {
    const grant = WAY.faces[0]!.abilities.find((a) => a.kind === 'static');
    expect(grant).toBeDefined();
    expect(JSON.stringify(grant)).toContain('"loyalty":-2');
    expect(JSON.stringify(grant)).toContain('"name":"Cadet"');
  });
});
