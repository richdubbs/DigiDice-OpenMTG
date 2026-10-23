/**
 * Standard round 5, slice r5-fxb: the shapes and engine mechanisms of this slice played through applyAction with synthetic cards compiled by the game's default
 * compiler (invented wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { isTargetable } from '../../../src/rules/targets';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
type Face = { name: string; type_line: string; oracle_text: string; mana_cost?: string; power?: string; toughness?: string; colors?: string[] };
function dfc(name: string, cost: string, faces: Face[]): CardDef {
  return compileCard({ name, layout: 'transform', mana_cost: cost, type_line: faces.map((f) => f.type_line).join(' // '), colors: [], card_faces: faces.map((f) => ({ mana_cost: '', colors: [], ...f })) } as unknown as OracleCard);
}
/** Every ability of the card automated (no manual node) and the card full: what a template or mechanism makes of it. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual')) && d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; x?: number };
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseNumber' && opts.x !== undefined) s = answer(s, { kind: 'chooseNumber', n: opts.x });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 20; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function queued(opts: Opts): Opts {
  return { ...opts, targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1'), ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q), q);
}
/** Cast without resolving: the spell stays on the stack with p1 holding priority. */
function castOnly(s0: GameState, name: string, opts: Opts = {}): GameState {
  return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), queued(opts));
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability, ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q), q);
}
/** Pass priority (declaring the given attackers, no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts & { attack?: ObjectId[] } = {}, max = 400): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: s.pending.player === 'p1' ? (opts.attack ?? []).map((a) => ({ attacker: a, defender: 'p2' })) : [] } as never);
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
const onBattlefield = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
const keywordsOf = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.map((k) => k.keyword);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1'], '{R}');

describe('CR 611.2a, 611.2c, 613.1f: "Goblin creatures you control also gain haste until end of turn." after another instruction (eff.r5fxb.group.alsoGain)', () => {
  const RALLIER = card('Test Rallier', 'Creature — Goblin Knight', 'When this creature enters, creatures you control get +1/+0 until end of turn. Goblin creatures you control also gain haste until end of turn.', ['3', '3']);
  it('is automated; every creature you control gets +1/+0, only the Goblins gain haste, and both end with the turn (CR 514.2)', () => {
    expect(automated(RALLIER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rallier'], battlefield: ['Test Bear', 'Test Goblin'] }, p2: { battlefield: ['Test Goblin'] }, defs: [RALLIER, BEAR, GOBLIN] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p1');
    const theirs = find(s, 'Test Goblin', 'battlefield', 'p2');
    s = cast(s, 'Test Rallier');
    const rallier = find(s, 'Test Rallier', 'battlefield', 'p1');
    expect(getChars(s, bear)).toMatchObject({ power: '3', toughness: '2' });
    expect(keywordsOf(s, bear)).not.toContain('haste');
    expect(keywordsOf(s, goblin)).toContain('haste');
    expect(keywordsOf(s, rallier)).toContain('haste'); // a Goblin you control as the effect begins (CR 611.2c)
    expect(keywordsOf(s, theirs)).not.toContain('haste');
    expect(getChars(s, theirs)).toMatchObject({ power: '1' });
    s = passTo(s, (x) => x.turn.number === 2);
    expect(keywordsOf(s, goblin)).not.toContain('haste');
    expect(getChars(s, bear)).toMatchObject({ power: '2' });
  });
});

describe('CR 702.170c, 702.170d, 400.7: "Exile target spell. It becomes plotted." (eff.r5fxb.becomesPlotted, designateObject plotted)', () => {
  const SNARE = card('Test Snare', 'Creature — Bird Rogue', 'Flash\nWhen this creature enters, exile target spell. It becomes plotted.', ['2', '2']);
  const OMEN = card('Test Omen', 'Sorcery', 'You gain 3 life.', undefined, '{2}{W}');
  it('is automated; the exiled card is plotted, and its owner casts it without paying its mana cost on a later turn, not the same turn', () => {
    expect(automated(SNARE)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Omen', 'Test Snare'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [SNARE, OMEN] });
    s = castOnly(s, 'Test Omen');
    expect(s.zones.stack).toHaveLength(1);
    const spell = s.zones.stack[0]!;
    s = cast(s, 'Test Snare', { targets: [[obj(spell)]] });
    expect(s.zones.stack).toHaveLength(0);
    const exiled = find(s, 'Test Omen', 'exile', 'p1');
    expect(s.objects[exiled]!.chosen?.['plotted']).toBe(1);
    expect(life(s, 'p1')).toBe(20); // the spell never resolved
    expect(applyAction(s, { type: 'cast', player: 'p1', card: exiled, method: 'plot' } as never).error).toBeDefined(); // CR 702.170d: a later turn only
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    // every land tapped: the plotted card is cast without paying its mana cost (CR 118.9)
    s = tweak(s, (t) => { for (const id of t.zones.battlefield) t.objects[id]!.tapped = true; });
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Omen', 'exile', 'p1'), method: 'plot' } as never)));
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 614.1d, 614.12, 616.1: "Lands you control enter untapped." (eff.r5fxb.enters.untapped.filter, body enters.untapped)', () => {
  const CAVERN = card('Test Cavern', 'Enchantment', 'Lands you control enter untapped.');
  const TAPLAND = card('Test Tapland', 'Land', 'This land enters tapped.\n{T}: Add {G}.');
  const SPROUT = card('Test Sprout', 'Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
  it('is automated; a land that enters tapped by its own ability enters untapped when its controller applies the untapped effect last (CR 616.1)', () => {
    expect(automated(CAVERN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tapland'], battlefield: ['Test Cavern'] }, defs: [CAVERN, TAPLAND] });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Tapland', 'hand', 'p1') });
    // both replacement effects apply to the land's entering: its controller orders them (CR 616.1)
    expect(s.pending?.kind).toBe('chooseReplacement');
    const d = s.pending as unknown as { options: { id: string; label: string }[] };
    s = answer(s, { kind: 'chooseReplacement', id: d.options.find((o) => o.label.startsWith('Test Tapland'))!.id });
    s = settle(s);
    expect(s.objects[find(s, 'Test Tapland', 'battlefield', 'p1')]!.tapped).toBe(false);
  });
  it('applied first, the tapped effect applied after it still taps the land (CR 616.1: the order is the controller\'s)', () => {
    let s = scenario([], { p1: { hand: ['Test Tapland'], battlefield: ['Test Cavern'] }, defs: [CAVERN, TAPLAND] });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Tapland', 'hand', 'p1') });
    const d = s.pending as unknown as { options: { id: string; label: string }[] };
    s = settle(answer(s, { kind: 'chooseReplacement', id: d.options.find((o) => o.label.startsWith('Test Cavern'))!.id }));
    expect(s.objects[find(s, 'Test Tapland', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('a land an instruction puts onto the battlefield tapped enters untapped (unverified: the Spelunking rulings)', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Sprout'], library: ['Forest'], battlefield: ['Test Cavern'] }, defs: [CAVERN, SPROUT] });
    s = cast(s, 'Test Sprout', { answers: [] });
    s = settle(s, { picks: [[find(s, 'Forest', 'library', 'p1')]] });
    s = drain(s);
    const [forest] = onBattlefield(s, 'Forest');
    expect(forest).toBeDefined();
    expect(s.objects[forest!]!.tapped).toBe(false);
  });
});

describe('CR 103.4, 119.1, 701.27a: "Then if your life total is less than or equal to half your starting life total, untap ~ and transform it." (eff.r5fxb.untapSelf.andTransformIt)', () => {
  const KNIGHT = dfc('Test Dark Knight', '{2}{B}', [
    { name: 'Test Dark Knight', type_line: 'Legendary Creature — Human Knight', oracle_text: 'Whenever this creature deals damage, you lose that much life. Then if your life total is less than or equal to half your starting life total, untap this creature and transform it.', power: '3', toughness: '3', mana_cost: '{2}{B}' },
    { name: 'Test Redeemed Knight', type_line: 'Legendary Creature — Human Knight', oracle_text: 'Lifelink', power: '4', toughness: '4' },
  ]);
  it('is automated; above half your starting life it stays as it is, at half or less it untaps and transforms', () => {
    expect(automated(KNIGHT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Dark Knight'] }, defs: [KNIGHT] });
    const knight = find(s, 'Test Dark Knight', 'battlefield', 'p1');
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.life = 14; });
    s = passTo(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', { attack: [knight] });
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(11); // 11 > 10: not yet
    expect(s.objects[knight]!.tapped).toBe(true);
    expect(getChars(s, knight).name).toBe('Test Dark Knight');
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    s = passTo(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', { attack: [knight] });
    expect(life(s, 'p1')).toBe(8); // 8 <= 10 (CR 103.4: the starting life total is 20)
    expect(s.objects[knight]!.tapped).toBe(false);
    expect(getChars(s, knight).name).toBe('Test Redeemed Knight');
  });
});

describe('CR 702.122b-c: "target creature that crewed it this turn" (filter crewedThisTurn, GameObject.crewedBy)', () => {
  const SKIFF = card('Test Skiff', 'Artifact — Vehicle', 'Whenever this Vehicle attacks, put a +1/+1 counter on target creature that crewed it this turn.\nCrew 1', ['3', '3']);
  it('is automated; the creature tapped to crew it is a legal target, another creature is not, and the record ends with the turn', () => {
    expect(automated(SKIFF)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Skiff', 'Test Bear', 'Test Goblin'] }, defs: [SKIFF, BEAR, GOBLIN] });
    const skiff = find(s, 'Test Skiff', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p1');
    const crew = legal(s, 'p1', 'activate').find((a) => a.object === skiff && !a.isMana)!;
    s = settle(act(s, crew.action), { picks: [[goblin]] });
    s = drain(s);
    expect(s.objects[skiff]!.crewedBy).toEqual([goblin]);
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: skiff, defender: 'p2' }] } as never);
    for (let guard = 0; guard < 10 && s.pending?.kind !== 'chooseTargets'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(options).toContain(goblin);
    expect(options).not.toContain(bear);
    s = answer(s, { kind: 'chooseTargets', targets: [obj(goblin)] });
    s = drain(settle(s));
    expect(s.objects[goblin]!.counters['+1/+1']).toBe(1);
    s = passTo(s, (x) => x.turn.number === 2);
    expect(s.objects[skiff]!.crewedBy).toBeUndefined(); // CR 514.2: this turn's only
    expect(findAll(s, 'Test Skiff', 'battlefield', 'p1')).toHaveLength(1);
  });
});

function walker(name: string, subtype: string, loyalty = '3'): CardDef {
  // (put onto the battlefield directly in the tests below, so each is given loyalty counters there: CR 306.5b, 704.5i)
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: `Legendary Planeswalker — ${subtype}`, oracle_text: '', colors: [], loyalty } as unknown as OracleCard);
}

describe('CR 205.3j, 701.34: "Proliferate X times, where X is the number of planeswalker types among planeswalkers you control." (distinct planeswalkerTypes)', () => {
  const SAGE = card('Test Sage', 'Creature — Gorgon Wizard', '{T}: Proliferate X times, where X is the number of planeswalker types among planeswalkers you control.', ['2', '4']);
  const A1 = walker('Test Ajani One', 'Ajani');
  const A2 = walker('Test Ajani Two', 'Ajani');
  const CH = walker('Test Chandra', 'Chandra');
  const THEIRS = walker('Test Nissa', 'Nissa');
  it('is automated; two Ajani and a Chandra are two planeswalker types (an opponent\'s Nissa does not count): two proliferations', () => {
    expect(automated(SAGE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Sage', ...['Test Ajani One', 'Test Ajani Two', 'Test Chandra'].map((name) => ({ name, counters: { loyalty: 3 } })), { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, p2: { battlefield: [{ name: 'Test Nissa', counters: { loyalty: 3 } }] }, defs: [SAGE, A1, A2, CH, THEIRS, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const sage = find(s, 'Test Sage', 'battlefield', 'p1');
    const bearOnly: DecisionAnswer = { kind: 'chooseOption', ids: [`object:${bear}`] } as DecisionAnswer;
    s = activate(s, sage, { answers: [bearOnly, bearOnly, bearOnly] });
    expect(s.zones.stack).toHaveLength(0);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(3);
  });
});

describe('CR 105.3, 702.11d, 613.1e-f: "Until end of turn, ~ becomes the color of your choice and gains hexproof from that color." (eff.r5fxb.durFirst.becomesChosenColor.hexproofFromIt)', () => {
  const GECKO = card('Test Gecko', 'Creature — Lizard', '{1}: Until end of turn, this creature becomes the color of your choice and gains hexproof from that color.', ['2', '3'], '{1}{G}', ['G']);
  const RED_BOLT = card('Test Red Bolt', 'Instant', 'This spell deals 1 damage to target creature.', undefined, '{R}', ['R']);
  const BLUE_BOLT = card('Test Blue Bolt', 'Instant', 'This spell deals 1 damage to target creature.', undefined, '{U}', ['U']);
  it('is automated; choosing red, it is red and an opponent\'s red spell can\'t target it while a blue one can; both end with the turn', () => {
    expect(automated(GECKO)).toBe(true);
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Gecko', 'Plains'] }, p2: { hand: ['Test Red Bolt', 'Test Blue Bolt'] }, defs: [GECKO, RED_BOLT, BLUE_BOLT] });
    const gecko = find(s, 'Test Gecko', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: gecko, ability: 'p:0:0' } as never));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseColor');
    s = drain(settle(answer(s, { kind: 'chooseColor', color: 'R' })));
    expect(getChars(s, gecko).colors).toEqual(['R']);
    const hex = getChars(s, gecko).keywords.find((k) => k.keyword === 'hexproof');
    expect(hex?.quality).toBe('color:R');
    // CR 702.11d: hexproof from red: no red spell or ability an opponent controls can target it; a blue one can, and its controller's red one can
    expect(isTargetable(s, gecko, 'p2', find(s, 'Test Red Bolt', 'hand', 'p2'))).toBe(false);
    expect(isTargetable(s, gecko, 'p2', find(s, 'Test Blue Bolt', 'hand', 'p2'))).toBe(true);
    expect(isTargetable(s, gecko, 'p1', find(s, 'Test Red Bolt', 'hand', 'p2'))).toBe(true);
    s = passTo(s, (x) => x.turn.number === 2);
    expect(getChars(s, gecko).colors).toEqual(['G']);
    expect(getChars(s, gecko).keywords.some((k) => k.keyword === 'hexproof')).toBe(false);
  });
});

describe('CR 603.10a, 608.2h, 111.4: "create a ... token with base power and toughness each equal to the total power of those creatures" (TokenDesc base P/T; stat sum of a referred group)', () => {
  const NEXUS = card('Test Nexus', 'Legendary Artifact', 'Whenever one or more nontoken creatures you control die, create a green Fungus Dinosaur creature token with base power and toughness each equal to the total power of those creatures.');
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  it('is automated; a Bear (2) and an Ox (2) pumped to 4 die at once: one 6/6 token, from their power as they last existed', () => {
    expect(automated(NEXUS)).toBe(true);
    const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5'], '{3}{G}');
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Nexus', 'Test Bear', { name: 'Test Ox', counters: { '+1/+1': 2 } }] }, defs: [NEXUS, WRATH, BEAR, OX] });
    s = cast(s, 'Test Wrath');
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect(getChars(s, tokens[0]!)).toMatchObject({ power: '6', toughness: '6', subtypes: ['Fungus', 'Dinosaur'], colors: ['G'] });
  });
});

describe('CR 120.3, 603.2, 115.1: "~ deals that amount of damage to target creature that player controls." (that amount of; the damaged player of the trigger)', () => {
  const FEAR = card('Test Fear', 'Enchantment Creature — Nightmare', 'Whenever a source you control deals noncombat damage to an opponent, this creature deals that amount of damage to target creature that player controls.', ['4', '4']);
  const SHOCK = card('Test Shock', 'Instant', 'This spell deals 2 damage to target player.', undefined, '{0}', ['R']);
  it('is automated; 2 damage to the opponent makes it deal 2 to a creature of theirs, and only theirs can be targeted', () => {
    expect(automated(FEAR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Fear', 'Test Bear'] }, p2: { battlefield: ['Test Ox'] }, defs: [FEAR, SHOCK, BEAR, card('Test Ox', 'Creature — Ox', '', ['2', '5'])] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    s = castOnly(s, 'Test Shock', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = pass(pass(s));
    for (let guard = 0; guard < 6 && s.pending?.kind !== 'chooseTargets'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(options).toEqual([ox]);
    expect(options).not.toContain(mine);
    s = drain(settle(answer(s, { kind: 'chooseTargets', targets: [obj(ox)] })));
    expect(life(s, 'p2')).toBe(18);
    expect(s.objects[ox]!.damage).toBe(2);
  });
});

describe('CR 613.1f, 120.1, 608.2h: "... loses all abilities until end of turn. Target creature you control deals damage equal to its power to that permanent." (the source\'s own power; no damage to itself)', () => {
  const GRAPPLE = card('Test Grapple', 'Instant', "Target creature or planeswalker an opponent controls that's red or white loses all abilities until end of turn. Target creature you control deals damage equal to its power to that permanent.", undefined, '{0}', ['G']);
  it('is automated; the red creature loses its abilities and takes damage equal to the power of your creature', () => {
    expect(automated(GRAPPLE)).toBe(true);
    const RED = card('Test Red Ox', 'Creature — Ox', 'Indestructible', ['2', '5'], '{R}', ['R']);
    const BIG = card('Test Big', 'Creature — Beast', '', ['4', '4']);
    let s = scenario([], { p1: { hand: ['Test Grapple'], battlefield: ['Test Big'] }, p2: { battlefield: ['Test Red Ox', 'Test Bear'] }, defs: [GRAPPLE, RED, BIG, BEAR] });
    const red = find(s, 'Test Red Ox', 'battlefield', 'p2');
    const big = find(s, 'Test Big', 'battlefield', 'p1');
    s = cast(s, 'Test Grapple', { targets: [[obj(red)], [obj(big)]] });
    expect(s.objects[big]!.damage).toBe(0);
    expect(findAll(s, 'Test Red Ox', 'battlefield', 'p2')).toHaveLength(1);
    expect(s.objects[red]!.damage).toBe(4);
    expect(getChars(s, red).keywords).toEqual([]);
  });
});

describe('CR 603.7, 603.7a, 505.1, 608.2h: "If you control a Wizard, add an amount of {C} equal to the amount of mana spent to cast that spell at the beginning of your next main phase."', () => {
  const SCULPT = card('Test Sculpt', 'Instant', 'Counter target spell. If you control a Wizard, add an amount of {C} equal to the amount of mana spent to cast that spell at the beginning of your next main phase.', undefined, '{0}', ['U']);
  const WIZ = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
  const BIGSPELL = card('Test Ritual', 'Sorcery', 'You gain 1 life.', undefined, '{3}');
  it('is automated; countering a 3-mana spell in your precombat main phase gives {C}{C}{C} at the beginning of your postcombat main phase, not before', () => {
    expect(automated(SCULPT)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Ritual', 'Test Sculpt'], battlefield: ['Test Wizard', 'Plains', 'Plains', 'Plains'] }, defs: [SCULPT, WIZ, BIGSPELL] });
    s = castOnly(s, 'Test Ritual');
    const spell = s.zones.stack[0]!;
    s = cast(s, 'Test Sculpt', { targets: [[obj(spell)]] });
    expect(life(s, 'p1')).toBe(20);
    const pool = (x: GameState): number => (x.players.find((p) => p.id === 'p1')! as unknown as { manaPool: { type: string }[] }).manaPool.filter((m) => m.type === 'C').length;
    expect(pool(s)).toBe(0);
    expect(s.delayedTriggers).toHaveLength(1);
    s = passTo(s, (x) => x.turn.step === 'main2' && x.zones.stack.length > 0);
    s = drain(s);
    expect(s.turn.step).toBe('main2');
    expect(pool(s)).toBe(3);
  });
  it('without a Wizard nothing is added (CR 608.2c: the condition is checked as the spell resolves)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Ritual', 'Test Sculpt'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [SCULPT, BIGSPELL] });
    s = castOnly(s, 'Test Ritual');
    s = cast(s, 'Test Sculpt', { targets: [[obj(s.zones.stack[0]!)]] });
    expect(s.delayedTriggers).toHaveLength(0);
  });
});

describe('CR 611.2a, 613.4c, 120.3: "~ gets +1/+1 until end of turn and deals 1 damage to each opponent." (eff.r4static.self.pump.damage, promoted at merge wave 8; the r5-fxb copy dropped)', () => {
  const SAGE = card('Test Flame Sage', 'Creature — Avatar Wizard', 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn and deals 1 damage to each opponent.', ['2', '2']);
  const CANTRIP = card('Test Cantrip', 'Instant', 'Draw a card.');
  it('is automated; a noncreature spell pumps it and deals 1 damage to the opponent, not to you', () => {
    expect(automated(SAGE)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Cantrip'], battlefield: ['Test Flame Sage'], library: ['Plains'] }, defs: [SAGE, CANTRIP] });
    const sage = find(s, 'Test Flame Sage', 'battlefield', 'p1');
    s = cast(s, 'Test Cantrip');
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
    expect(getChars(s, sage)).toMatchObject({ power: '3', toughness: '3' });
  });
});

describe('CR 611.2b, 406.3, 601.2 (promoted, design 10.4: eff.e29.permit.play.group.durFirst.while, eff.e25.exile.faceDown): "... exile them face down. For as long as they remain exiled, you may play them if you control a Wizard."', () => {
  const SHAPE = card('Test Shape', 'Sorcery', 'Look at the top two cards of your library and exile them face down. For as long as they remain exiled, you may play them if you control a Wizard.');
  const WIZ = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
  const OMEN = card('Test Omen', 'Sorcery', 'You gain 3 life.');
  it('is automated; the exiled cards are face down and can be played only while you control a Wizard', () => {
    expect(automated(SHAPE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Shape'], library: ['Test Omen', 'Test Omen'], battlefield: ['Test Wizard'] }, defs: [SHAPE, WIZ, OMEN] });
    s = cast(s, 'Test Shape');
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Omen');
    expect(exiled).toHaveLength(2);
    expect(exiled.every((id) => s.objects[id]!.faceDown)).toBe(true);
    const wizard = find(s, 'Test Wizard', 'battlefield', 'p1');
    const noWizard = tweak(s, (t) => { t.zones.battlefield = t.zones.battlefield.filter((id) => id !== wizard); delete t.objects[wizard]; });
    expect(applyAction(noWizard, { type: 'cast', player: 'p1', card: exiled[0]! } as never).error).toBeDefined();
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: exiled[0]! } as never)));
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 601.2c, 115.1, 608.2f: "For each player, destroy up to one target creature that player controls." (TargetSpec.perPlayer, PlayerTarget hole)', () => {
  const JUNK = card('Test Junk Wagon', 'Artifact Creature — Construct', 'When this creature enters, for each player, destroy up to one target creature that player controls. If a creature you controlled was destroyed this way, put two +1/+1 counters on this creature.', ['3', '3']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5']);
  it('is automated; one creature of each player is destroyed, and yours puts two +1/+1 counters on it', () => {
    expect(automated(JUNK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Junk Wagon'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ox', 'Test Goblin'] }, defs: [JUNK, BEAR, OX, GOBLIN] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Junk Wagon', { targets: [[obj(bear), obj(ox)]] });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
    expect(findAll(s, 'Test Ox', 'battlefield', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Goblin', 'battlefield', 'p2')).toHaveLength(1);
    const wagon = find(s, 'Test Junk Wagon', 'battlefield', 'p1');
    expect(s.objects[wagon]!.counters['+1/+1']).toBe(2);
  });
  it('two targets controlled by one player are refused (at most one for each player); none of yours destroyed puts no counters', () => {
    let s = scenario([], { p1: { hand: ['Test Junk Wagon'] }, p2: { battlefield: ['Test Ox', 'Test Goblin'] }, defs: [JUNK, BEAR, OX, GOBLIN] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Junk Wagon', 'hand', 'p1') } as never));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseTargets');
    const twice = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(ox), obj(goblin)] } });
    expect(twice.state.pending?.kind).toBe('chooseTargets'); // asked again (CR 601.2c)
    s = drain(settle(answer(s, { kind: 'chooseTargets', targets: [obj(goblin)] })));
    expect(findAll(s, 'Test Goblin', 'battlefield', 'p2')).toHaveLength(0);
    expect(s.objects[find(s, 'Test Junk Wagon', 'battlefield', 'p1')]!.counters['+1/+1']).toBeUndefined();
  });
});

describe('CR 601.2c, 107.3, 608.2h: "For each opponent, put X -1/-1 counters on up to one target creature that player controls, where X is ..." and "gain control of ... until end of turn. Untap those creatures."', () => {
  const FANG = card('Test Fang', 'Creature — Snake', 'When this creature enters, for each opponent, put X -1/-1 counters on up to one target creature that player controls, where X is the number of cards in your hand.', ['2', '2']);
  const PRIMORDIAL = card('Test Primordial', 'Creature — Avatar', 'When this creature enters, for each opponent, gain control of up to one target creature that player controls until end of turn. Untap those creatures. They gain haste until end of turn.', ['6', '4']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5']);
  it('is automated; X is the number of cards in your hand as it resolves', () => {
    expect(automated(FANG)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Fang', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Ox'] }, defs: [FANG, OX, BEAR] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Fang', { targets: [[obj(ox)]] });
    expect(s.objects[ox]!.counters['-1/-1']).toBe(2);
  });
  it('is automated; the opponent\'s tapped creature is yours, untapped and hasty until the turn ends (CR 613.1b, 611.2a)', () => {
    expect(automated(PRIMORDIAL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Primordial'] }, p2: { battlefield: [{ name: 'Test Ox', tapped: true }] }, defs: [PRIMORDIAL, OX] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Primordial', { targets: [[obj(ox)]] });
    expect(getChars(s, ox).controller).toBe('p1');
    expect(s.objects[ox]!.tapped).toBe(false);
    expect(keywordsOf(s, ox)).toContain('haste');
    s = passTo(s, (x) => x.turn.number === 2);
    expect(getChars(s, ox).controller).toBe('p2');
  });
});

describe('CR 719.3a-b, 120.1, 508.1: Case "To solve" conditions on the turn\'s history (happened distinct sources; creatures attacked)', () => {
  const MASKS = card('Test Masks Case', 'Enchantment — Case', 'To solve — Three or more sources you controlled dealt damage this turn. (If unsolved, solve at the beginning of your end step.)\nSolved — {T}: You gain 5 life.');
  const EXPRESS = card('Test Express Case', 'Enchantment — Case', 'To solve — Three or more creatures attacked this turn. (If unsolved, solve at the beginning of your end step.)\nSolved — {T}: You gain 5 life.');
  const PING = card('Test Pinger', 'Creature — Human', '{0}: This creature deals 1 damage to target player.', ['1', '1']);
  it('is automated; three different sources you control dealing damage solve it at your end step; one source dealing damage three times does not', () => {
    expect(automated(MASKS)).toBe(true);
    const at = (pingers: number, times: number): GameState => {
      let s = scenario([], { p1: { battlefield: ['Test Masks Case', ...Array(pingers).fill('Test Pinger')] }, defs: [MASKS, PING] });
      const ids = findAll(s, 'Test Pinger', 'battlefield', 'p1');
      for (let k = 0; k < times; k++) s = activate(s, ids[k % ids.length]!, { targets: [[{ kind: 'player', id: 'p2' }]] });
      return passTo(s, (x) => x.turn.step === 'end' && x.zones.stack.length === 0 && x.pending?.kind === 'priority');
    };
    const three = at(3, 3);
    expect(life(three, 'p2')).toBe(17);
    expect(three.objects[find(three, 'Test Masks Case', 'battlefield', 'p1')]!.solved).toBe(true);
    const one = at(1, 3);
    expect(life(one, 'p2')).toBe(17);
    expect(one.objects[find(one, 'Test Masks Case', 'battlefield', 'p1')]!.solved).toBeUndefined();
  });
  it('is automated; three creatures attacking solve it, two do not', () => {
    expect(automated(EXPRESS)).toBe(true);
    for (const [n, solved] of [[3, true], [2, undefined]] as const) {
      let s = scenario([], { p1: { battlefield: ['Test Express Case', ...Array(n).fill('Test Bear')] }, defs: [EXPRESS, BEAR] });
      s = passTo(s, (x) => x.turn.step === 'end' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', { attack: findAll(s, 'Test Bear', 'battlefield', 'p1') });
      expect(s.objects[find(s, 'Test Express Case', 'battlefield', 'p1')]!.solved).toBe(solved);
    }
  });
});

describe('CR 105.2, 111.4: "create a 2/2 Elemental creature token that\'s all colors" (TokenDesc)', () => {
  const BALLAD = card('Test Ballad', 'Sorcery', "Create a 2/2 Elemental creature token that's all colors.");
  it('is automated; the token is white, blue, black, red and green', () => {
    expect(automated(BALLAD)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Ballad'] }, defs: [BALLAD] });
    s = cast(s, 'Test Ballad');
    const [tok] = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(getChars(s, tok!).colors.slice().sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(getChars(s, tok!)).toMatchObject({ power: '2', toughness: '2', subtypes: ['Elemental'] });
  });
});

describe('CR 603.10a, 700.9, 301.5: "Whenever a modified creature you control leaves the battlefield, ..." reads what was attached as it left (LastKnown.attached)', () => {
  const CLOSET = card('Test Closet', 'Artifact', 'Whenever a modified creature you control leaves the battlefield, put a +1/+1 counter on this artifact.');
  const AURA = card('Test Charm', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', undefined, '{W}');
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}');
  it('is automated; an enchanted creature (your Aura) and an equipped one dying with a plain one: two counters, though the Aura is gone afterwards', () => {
    expect(automated(CLOSET)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Closet', 'Test Bear', 'Test Goblin'] }, defs: [CLOSET, AURA, WRATH, SWORD, BEAR, GOBLIN] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p1');
    s = tweak(s, (t) => {
      t.objects[put(t, 'p1', 'battlefield', 'Test Charm')]!.attachedTo = bear; // attached as the test begins (an Aura that is put onto the battlefield, CR 303.4f)
      t.objects[put(t, 'p1', 'battlefield', 'Test Sword')]!.attachedTo = goblin;
    });
    s = cast(s, 'Test Wrath');
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
    expect(findAll(s, 'Test Charm', 'battlefield', 'p1')).toHaveLength(0); // CR 704.5m: the Aura went to the graveyard
    expect(s.objects[find(s, 'Test Closet', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(2);
  });
  it('an unmodified creature leaving puts no counter', () => {
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Closet', 'Test Bear'] }, defs: [CLOSET, WRATH, BEAR] });
    s = cast(s, 'Test Wrath');
    expect(s.objects[find(s, 'Test Closet', 'battlefield', 'p1')]!.counters['+1/+1']).toBeUndefined();
  });
});

describe('CR 603.10a, 122.8, 301.5: "Put ~\'s counters on that creature and attach an Equipment that was attached to ~ to that creature." (filter wasAttachedTo, LastKnown.attached.ids)', () => {
  const ZACK = card('Test Soldier', 'Legendary Creature — Human Soldier', "{0}, Sacrifice this creature: Target creature you control gains indestructible until end of turn. Put this creature's counters on that creature and attach an Equipment that was attached to this creature to that creature.", ['0', '1']);
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}');
  it('is automated; the target gets the sacrificed creature\'s counters, indestructible and its Equipment', () => {
    expect(automated(ZACK)).toBe(true);
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Soldier', counters: { '+1/+1': 2 } }, 'Test Bear'] }, defs: [ZACK, SWORD, BEAR] });
    const zack = find(s, 'Test Soldier', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    let sword = '';
    s = tweak(s, (t) => { sword = put(t, 'p1', 'battlefield', 'Test Sword'); t.objects[sword]!.attachedTo = zack; });
    s = activate(s, zack, { targets: [[obj(bear)]], picks: [[sword]] });
    expect(findAll(s, 'Test Soldier', 'battlefield', 'p1')).toHaveLength(0);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(s.objects[sword]!.attachedTo).toBe(bear);
    expect(keywordsOf(s, bear)).toContain('indestructible');
    expect(getChars(s, bear)).toMatchObject({ power: '5', toughness: '4' });
  });
});

describe('CR 201.5a, 113.10 (a quoted ability an object grants to itself names it by its name): "Iron Fist gains \\"{T}: Iron Fist deals damage equal to his power to any other target\\" until end of turn."', () => {
  const FIST = compileCard({ name: 'Test Fist, Living Weapon', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Legendary Creature — Human Warrior', colors: ['G'], power: '2', toughness: '3',
    oracle_text: 'Whenever you cast a spell that targets a creature you control, Test Fist gains "{T}: Test Fist deals damage equal to his power to any other target" until end of turn.' } as OracleCard);
  const PUMP = card('Test Pump', 'Instant', 'Target creature gets +2/+2 until end of turn.', undefined, '{0}', ['G']);
  it('is automated; after a spell targets one of your creatures it can tap to deal damage equal to its power to another target, until the turn ends', () => {
    expect(automated(FIST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Pump'], battlefield: ['Test Fist, Living Weapon'] }, p2: { battlefield: [] }, defs: [FIST, PUMP] });
    const fist = find(s, 'Test Fist, Living Weapon', 'battlefield', 'p1');
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === fist && !a.isMana)).toHaveLength(0);
    s = cast(s, 'Test Pump', { targets: [[obj(fist)]] });
    expect(getChars(s, fist)).toMatchObject({ power: '4' });
    const granted = legal(s, 'p1', 'activate').find((a) => a.object === fist && !a.isMana)!;
    expect(granted).toBeDefined();
    s = drain(settle(act(s, granted.action), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(life(s, 'p2')).toBe(16);
    expect(s.objects[fist]!.tapped).toBe(true);
  });
});

describe('CR 603.7a, 505.1, 608.2h: "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell\'s mana value." (eff.r5fxb.delayedMana.yourNextMain.lead)', () => {
  const DRAIN = card('Test Drain', 'Instant', "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.", undefined, '{0}', ['U']);
  const BIGSPELL = card('Test Ritual', 'Sorcery', 'You gain 1 life.', undefined, '{2}{W}');
  it('is automated; the mana value is fixed as it resolves, and the mana comes at the beginning of your next main phase', () => {
    expect(automated(DRAIN)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Ritual', 'Test Drain'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [DRAIN, BIGSPELL] });
    s = castOnly(s, 'Test Ritual');
    s = cast(s, 'Test Drain', { targets: [[obj(s.zones.stack[0]!)]] });
    expect(s.delayedTriggers).toHaveLength(1);
    expect(s.delayedTriggers[0]!.vars['delayedMana']).toBe(3);
    s = passTo(s, (x) => x.turn.step === 'main2' && x.zones.stack.length > 0);
    s = drain(s);
    expect((s.players.find((p) => p.id === 'p1')! as unknown as { manaPool: { type: string }[] }).manaPool.filter((m) => m.type === 'C')).toHaveLength(3);
  });
});
