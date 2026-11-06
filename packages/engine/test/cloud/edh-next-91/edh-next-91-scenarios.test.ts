/**
 * Commander top-rank round part 7, edh-next-91: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Alice (p1) is the active player of turn 1; Bob (p2) defends. CR cites are from memory unless noted (unverified in the record).
 *
 *   CR 120.2, 510.2, 603.2    "Whenever combat damage is dealt to you, ..." (Risona, Asari Commander)
 *   CR 201.5c, 603.4, 608.2c  a legendary name with an apostrophe inside a word is still known by its first word (Drizzt Do'Urden)
 *   CR 101.4, 608.2c, 608.2d  "Each opponent may return a creature card ... For each opponent who does, ..." (Tempt with Immortality)
 *   CR 601.2i, 603.2, 701.5a  "Whenever the first noncreature spell of a turn is cast, counter that spell." (Nullstone Gargoyle)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const bfNames = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).filter((n) => n !== 'Plains');
const yardNames = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).filter((n) => n !== 'Plains');

interface Script { targets?: ObjectId[]; yes?: boolean | ((who: PlayerId) => boolean); pick?: (options: ObjectId[], who: PlayerId, s: GameState) => ObjectId[]; until?: (s: GameState) => boolean }
/** Answers whatever is asked and passes priority until the stack is empty (and `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending as unknown as { kind: string; player: PlayerId; options?: ObjectId[]; min?: number; objects?: ObjectId[] } | null;
    if (p === null || p === undefined) break;
    if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = pass(s); continue; }
    let a: DecisionAnswer;
    if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : (p.objects ?? []).slice(0, p.min ?? 1).map((id) => ({ kind: 'object', id })) } as DecisionAnswer;
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: typeof sc.yes === 'function' ? sc.yes(p.player) : sc.yes ?? true } as DecisionAnswer;
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: sc.pick !== undefined ? sc.pick(p.options ?? [], p.player, s) : (p.options ?? []).slice(0, p.min ?? 0) } as DecisionAnswer;
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
    s = answer(s, a);
  }
  return s;
}
const cast = (s: GameState, player: PlayerId, name: string, sc: Script = {}): GameState => run(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), sc);
const onBf = (s: GameState, name: string): ObjectId => find(s, name, 'battlefield');

// ---- Risona, Asari Commander ----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 120.2, 510.2, 603.2: "Whenever combat damage is dealt to you, ..." is the same event as "Whenever you are dealt combat damage"', () => {
  const WATCH = card('Test Watchful Wall', 'Creature — Wall', 'Whenever combat damage is dealt to you, you gain 1 life.', { pt: ['0', '4'] });
  const BEAR = card('Test Charging Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BURN = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to each opponent.');
  const start = (): GameState => mpScenario({ players: 3, defs: [WATCH, BEAR, BURN], zones: { p1: { battlefield: ['Test Charging Bear', 'Test Watchful Wall'] }, p2: { battlefield: ['Test Watchful Wall'], hand: ['Test Spark'] } } });
  it('is automated', () => { expect(noManual(WATCH)).toEqual([]); });
  it('the controller of the Wall gains 1 life when combat damage is dealt to them: 20 - 2 + 1 = 19, and the other player\'s Wall does not trigger', () => {
    let s = start();
    const bear = onBf(s, 'Test Charging Bear');
    s = declareAttackers(toDeclareAttackers(s), [[bear, 'p2']]);
    s = run(s, { until: (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2' });
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: noncombat damage to the controller is not combat damage (no life gained): 20 - 2 = 18', () => {
    const t = mpScenario({ players: 3, defs: [WATCH, BURN], zones: { p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Watchful Wall'] } } });
    const u = cast(t, 'p1', 'Test Spark');
    expect(life(u, 'p2')).toBe(18);
  });
});

// ---- Drizzt Do'Urden ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 201.5c, 603.4: a legendary name with an apostrophe inside a word is known by its first word ("When Brannoc enters"), Marit Lage\'s Slumber style names are not', () => {
  const HERO = card('Brannoc Do\'Hast', 'Legendary Creature — Elf Ranger', 'When Brannoc enters, create a 1/1 white Soldier creature token.\nWhenever a creature dies, if it had power greater than Brannoc\'s power, put a number of +1/+1 counters on Brannoc equal to the difference.', { pt: ['1', '1'] });
  const BIG = card('Test Big Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const TINY = card('Test Tiny Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  it('is automated', () => { expect(noManual(HERO)).toEqual([]); });
  it('enters trigger makes a Soldier token', () => {
    const s0 = mpScenario({ players: 3, defs: [HERO], zones: { p1: { hand: ['Brannoc Do\'Hast'] } } });
    const s = cast(s0, 'p1', 'Brannoc Do\'Hast');
    expect(bfNames(s, 'p1').length).toBe(2); // Brannoc and the Soldier token
  });
  it('a creature with power 4 dying gives Brannoc 3 counters (the difference from his power 1); a creature with power 1 gives none (the negative)', () => {
    const mk = (victim: string): GameState => mpScenario({ players: 3, defs: [HERO, BIG, TINY, SMITE], zones: { p1: { battlefield: ['Brannoc Do\'Hast'], hand: ['Test Smite'] }, p2: { battlefield: [victim] } } });
    let s = mk('Test Big Ox');
    s = cast(s, 'p1', 'Test Smite', { targets: [find(s, 'Test Big Ox', 'battlefield', 'p2')] });
    expect(Number(getChars(s, onBf(s, 'Brannoc Do\'Hast')).power)).toBe(4);
    let t = mk('Test Tiny Mouse');
    t = cast(t, 'p1', 'Test Smite', { targets: [find(t, 'Test Tiny Mouse', 'battlefield', 'p2')] });
    expect(Number(getChars(t, onBf(t, 'Brannoc Do\'Hast')).power)).toBe(1);
  });
});

// ---- Tempt with Immortality -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 608.2c, 608.2d: "Each opponent may return a creature card from their graveyard to the battlefield. For each opponent who does, return a creature card from your graveyard to the battlefield."', () => {
  const OFFER = card('Test Tempting Rite', 'Sorcery', 'Tempting offer — Return a creature card from your graveyard to the battlefield. Each opponent may return a creature card from their graveyard to the battlefield. For each opponent who does, return a creature card from your graveyard to the battlefield.');
  const mkCreature = (n: string): CardDef => card(n, 'Creature — Zombie', '', { pt: ['1', '1'] });
  const defs = [OFFER, mkCreature('Test Zed A'), mkCreature('Test Zed B'), mkCreature('Test Zed C'), mkCreature('Test Zed D')];
  const start = (): GameState => mpScenario({
    players: 3, defs, zones: { p1: { hand: ['Test Tempting Rite'], graveyard: ['Test Zed A', 'Test Zed B', 'Test Zed C'] }, p2: { graveyard: ['Test Zed D'] }, p3: { graveyard: [] } },
  });
  it('is automated', () => { expect(noManual(OFFER)).toEqual([]); });
  it('one opponent returns their card (Bob has one, Carol has none): the caster returns one for the first sentence and ONE more for that opponent: 2 of 3 cards back', () => {
    const s = cast(start(), 'p1', 'Test Tempting Rite', { pick: (o) => o.slice(0, 1) });
    expect(bfNames(s, 'p1').length).toBe(2);
    expect(bfNames(s, 'p2')).toEqual(['Test Zed D']);
    expect(yardNames(s, 'p1').filter((n) => n.startsWith('Test Zed')).length).toBe(1);
  });
  it('negative: when no opponent returns a card (they decline) the caster returns only the first one', () => {
    const s = cast(start(), 'p1', 'Test Tempting Rite', { pick: (o, who) => (who === 'p1' ? o.slice(0, 1) : []) });
    expect(bfNames(s, 'p1').length).toBe(1);
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(yardNames(s, 'p2')).toEqual(['Test Zed D']);
  });
});

// ---- Nullstone Gargoyle ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 603.2: "Whenever the first noncreature spell of a turn is cast, counter that spell." counts the spells of EVERY player', () => {
  const GARGOYLE = card('Test Stone Gargoyle', 'Artifact Creature — Gargoyle', 'Whenever the first noncreature spell of a turn is cast, counter that spell.', { pt: ['2', '2'] });
  const CANTRIP = card('Test Cantrip', 'Instant', 'Draw a card.');
  const CRITTER = card('Test Critter', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [GARGOYLE, CANTRIP, CRITTER];
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { battlefield: ['Test Stone Gargoyle'], hand: ['Test Cantrip', 'Test Cantrip', 'Test Critter'] }, p2: { hand: ['Test Cantrip'] } } });
  it('is automated', () => { expect(noManual(GARGOYLE)).toEqual([]); });
  it('the first noncreature spell is countered (no draw); the second noncreature spell of the turn resolves (draws a card)', () => {
    let s = start();
    const before = s.zones.hand.p1!.length;
    s = cast(s, 'p1', 'Test Cantrip');
    expect(s.zones.hand.p1!.length).toBe(before - 1); // countered: no card drawn
    expect(yardNames(s, 'p1')).toContain('Test Cantrip');
    s = cast(s, 'p1', 'Test Cantrip');
    expect(s.zones.hand.p1!.length).toBe(before - 1); // resolved: -1 for the cast, +1 for the draw
  });
  it('negative: a creature spell is no noncreature spell (it resolves) and does not use up the "first"', () => {
    let s = start();
    s = cast(s, 'p1', 'Test Critter');
    expect(bfNames(s, 'p1')).toContain('Test Critter');
    s = cast(s, 'p1', 'Test Cantrip'); // still the first noncreature spell: countered
    expect(yardNames(s, 'p1')).toContain('Test Cantrip');
  });
  it('the Gargoyle of ANOTHER player counts Alice\'s spells too: Bob\'s Gargoyle counters Alice\'s first noncreature spell, her second resolves', () => {
    const t = mpScenario({ players: 3, defs, zones: { p2: { battlefield: ['Test Stone Gargoyle'] }, p1: { hand: ['Test Cantrip', 'Test Cantrip'] } } });
    let s = cast(t, 'p1', 'Test Cantrip');
    expect(handNames(s, 'p1').length).toBe(1);
    const size = s.zones.hand.p1!.length;
    s = cast(s, 'p1', 'Test Cantrip');
    expect(s.zones.hand.p1!.length).toBe(size); // the second resolved: -1 for the cast, +1 for the draw
  });
});

// ---- Nantuko Cultivator ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 701.9a: "you may discard any number of land cards. Put that many +1/+1 counters on this creature and draw that many cards."', () => {
  const DIGGER = card('Test Digger', 'Creature — Insect', 'When this creature enters, you may discard any number of land cards. Put that many +1/+1 counters on this creature and draw that many cards.', { pt: ['1', '1'] });
  const ROCK = card('Test Pebble', 'Artifact', '');
  const start = (): GameState => mpScenario({ players: 3, defs: [DIGGER, ROCK], zones: { p1: { hand: ['Test Digger', 'Plains', 'Plains', 'Plains', 'Test Pebble'] } } });
  it('is automated', () => { expect(noManual(DIGGER)).toEqual([]); });
  it('discarding two of three lands puts two counters and draws two cards (the same number twice)', () => {
    const s0 = start();
    const before = s0.zones.hand.p1!.length; // 5
    const s = cast(s0, 'p1', 'Test Digger', { pick: (o) => o.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Plains').slice(0, 2) });
    expect(Number(getChars(s, onBf(s, 'Test Digger')).power)).toBe(3);
    expect(s.zones.hand.p1!.length).toBe(before - 1 - 2 + 2); // cast it, discard two lands, draw two
    expect(yardNames(s, 'p1').filter((n) => n === 'Plains').length).toBe(2);
  });
  it('negative: discarding none puts no counters and draws nothing; a nonland card is never offered', () => {
    const s0 = start();
    const before = s0.zones.hand.p1!.length;
    const s = cast(s0, 'p1', 'Test Digger', { pick: () => [] });
    expect(Number(getChars(s, onBf(s, 'Test Digger')).power)).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(before - 1);
    let offered: string[] = [];
    cast(s0, 'p1', 'Test Digger', { pick: (o) => { offered = o.map((id) => s0.defs[s0.objects[id]!.defId]!.name); return []; } });
    expect(offered.filter((n) => n !== 'Plains')).toEqual([]);
  });
});
