/**
 * edh-players-22 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.8a, 109.5, 603.10a       "Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls."
 *   CR 122.1d, 614.17               "Stun counters can't be removed from permanents your opponents control."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as unknown as OracleCard);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer the decisions that come up until a player has priority. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.objects?.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 120; guard++) s = drive(pass(s), script, asked);
  return s;
}
const cast = (s: GameState, player: PlayerId, name: string, script: Script = {}, asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
const names = (s: GameState, zone: 'battlefield' | 'graveyard', p?: PlayerId): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield : s.zones.graveyard[p!]!).filter((id) => p === undefined || s.objects[id]!.controller === p || zone === 'graveyard').map((id) => s.defs[s.objects[id]!.defId]!.name);
const idOf = (s: GameState, name: string, p?: PlayerId): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p))!;

const JUSTICE = card('Test Karma Wheel', 'Enchantment', 'Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls.');
const IDOL = card('Test Gold Idol', 'Artifact', '');
const BEAST = card('Test Plain Beast', 'Creature — Beast', '', { pt: ['2', '2'] });
const SMASH_ART = card('Test Smash Artifact', 'Instant', 'Destroy target artifact.');
const SMASH_ANY = card('Test Smash Anything', 'Instant', 'Destroy target permanent.');
const BOLT = card('Test Small Bolt', 'Instant', 'Test Small Bolt deals 5 damage to target creature.');
const CHAFF = card('Test Chaff Rock', 'Artifact', '');
const DEFS = [JUSTICE, IDOL, BEAST, SMASH_ART, SMASH_ANY, BOLT, CHAFF];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

describe('CR 701.8a, 109.5, 603.10a: "Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls."', () => {
  const game = (): GameState => mpScenario({
    defs: DEFS, options: { startingPlayer: 'p2' },
    zones: {
      p1: { battlefield: ['Test Karma Wheel', 'Test Gold Idol', 'Test Plain Beast'] },
      p2: { battlefield: ['Test Chaff Rock'], hand: ['Test Smash Artifact', 'Test Smash Anything', 'Test Small Bolt'] },
      p3: { battlefield: ['Test Gold Idol'] },
    },
  });
  it("p2 destroys p1's artifact: p1 may destroy a permanent p2 controls (not another opponent's)", () => {
    const s0 = game();
    const s = cast(s0, 'p2', 'Test Smash Artifact', { targets: [[obj(idOf(s0, 'Test Gold Idol', 'p1'))], [obj(idOf(s0, 'Test Chaff Rock', 'p2'))]], yes: [true] });
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Gold Idol');
    expect(names(s, 'battlefield', 'p2')).not.toContain('Test Chaff Rock');
    expect(names(s, 'battlefield', 'p3')).toContain('Test Gold Idol');
  });
  it("the target must be a permanent the destroying opponent controls: another opponent's permanent is refused", () => {
    const s0 = game();
    let s = drive(act(s0, { type: 'cast', player: 'p2', card: find(s0, 'Test Smash Artifact', 'hand', 'p2') }), { targets: [[obj(idOf(s0, 'Test Gold Idol', 'p1'))]] });
    for (let i = 0; i < 20 && s.pending?.kind === 'priority' && s.zones.stack.length > 0 && s.zones.stack.some((x) => s.objects[x]!.stack?.kind === 'spell'); i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [obj(idOf(s0, 'Test Gold Idol', 'p3'))] })).toThrow();
  });
  it('the controller may decline ("you may")', () => {
    const s0 = game();
    const s = cast(s0, 'p2', 'Test Smash Artifact', { targets: [[obj(idOf(s0, 'Test Gold Idol', 'p1'))], [obj(idOf(s0, 'Test Chaff Rock', 'p2'))]], yes: [false] });
    expect(names(s, 'battlefield', 'p2')).toContain('Test Chaff Rock');
  });
  it('negative: the destroyed permanent is a creature: no trigger', () => {
    const s0 = game();
    const asked: string[] = [];
    const s = cast(s0, 'p2', 'Test Smash Anything', { targets: [[obj(idOf(s0, 'Test Plain Beast', 'p1'))]] }, asked);
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Plain Beast');
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual([]);
    expect(names(s, 'battlefield', 'p2')).toContain('Test Chaff Rock');
  });
  it('negative: the destroyer is the controller itself, not an opponent: no trigger', () => {
    const s0 = mpScenario({
      defs: DEFS, options: { startingPlayer: 'p1' },
      zones: { p1: { battlefield: ['Test Karma Wheel', 'Test Gold Idol'], hand: ['Test Smash Artifact'] }, p2: { battlefield: ['Test Chaff Rock'] } },
    });
    const asked: string[] = [];
    const s = cast(s0, 'p1', 'Test Smash Artifact', { targets: [[obj(idOf(s0, 'Test Gold Idol', 'p1'))]] }, asked);
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Gold Idol');
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual([]);
    expect(names(s, 'battlefield', 'p2')).toContain('Test Chaff Rock');
  });
  it("negative: p2 destroys another opponent's artifact (p3's): not a permanent you control: no trigger", () => {
    const s0 = game();
    const asked: string[] = [];
    const s = cast(s0, 'p2', 'Test Smash Artifact', { targets: [[obj(idOf(s0, 'Test Gold Idol', 'p3'))]] }, asked);
    expect(names(s, 'battlefield', 'p3')).not.toContain('Test Gold Idol');
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual([]);
  });
  it('negative: destroyed by lethal damage (a state-based action), not by a spell or ability destroying: a noncreature permanent is not damaged, and a creature is excluded anyway', () => {
    const s0 = game();
    const asked: string[] = [];
    const s = cast(s0, 'p2', 'Test Small Bolt', { targets: [[obj(idOf(s0, 'Test Plain Beast', 'p1'))]] }, asked);
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Plain Beast');
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual([]);
  });
});

const WARDEN = card('Test Dream Warden', 'Creature — Nightmare', "Stun counters can't be removed from permanents your opponents control.", { pt: ['1', '1'] });
const WAKE = card('Test Quick Wake', 'Instant', 'Untap target creature.');
const counters = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });

describe('CR 122.1d, 614.17: "Stun counters can\'t be removed from permanents your opponents control."', () => {
  const defs = [WARDEN, WAKE, BEAST, ...DEFS.slice(0, 0)];
  it('is automated', () => {
    for (const d of [WARDEN, WAKE]) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
  const toUntap = (s0: GameState): GameState => passUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
  it("p2's tapped creature with a stun counter: its untap step leaves it tapped with the counter (ruling 2024-09-20)", () => {
    const s0 = mpScenario({ defs, options: { startingPlayer: 'p1' }, zones: { p1: { battlefield: ['Test Dream Warden'] }, p2: { battlefield: [{ name: 'Test Plain Beast', tapped: true, counters: { stun: 1 } }] } } });
    const beast = s0.zones.battlefield.find((id) => s0.objects[id]!.owner === 'p2')!;
    const s = toUntap(s0);
    expect(s.objects[beast]!.tapped).toBe(true);
    expect(counters(s, beast)).toEqual({ stun: 1 });
  });
  it('without the Warden the same untap step removes the counter and leaves it tapped; the next untaps it', () => {
    const s0 = mpScenario({ defs, options: { startingPlayer: 'p1' }, zones: { p2: { battlefield: [{ name: 'Test Plain Beast', tapped: true, counters: { stun: 1 } }] } } });
    const beast = s0.zones.battlefield.find((id) => s0.objects[id]!.owner === 'p2')!;
    const s = toUntap(s0);
    expect(s.objects[beast]!.tapped).toBe(true);
    expect(counters(s, beast)).toEqual({});
  });
  it("an untap effect on an opponent's stunned creature does nothing; on the Warden's controller's own it still removes the counter", () => {
    const s0 = mpScenario({
      defs, options: { startingPlayer: 'p1' },
      zones: { p1: { battlefield: ['Test Dream Warden', { name: 'Test Plain Beast', tapped: true, counters: { stun: 1 } }], hand: ['Test Quick Wake', 'Test Quick Wake'] }, p2: { battlefield: [{ name: 'Test Plain Beast', tapped: true, counters: { stun: 1 } }] } },
    });
    const mine = s0.zones.battlefield.find((id) => s0.objects[id]!.owner === 'p1' && s0.defs[s0.objects[id]!.defId]!.name === 'Test Plain Beast')!;
    const theirs = s0.zones.battlefield.find((id) => s0.objects[id]!.owner === 'p2')!;
    let s = cast(s0, 'p1', 'Test Quick Wake', { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]!.tapped).toBe(true);
    expect(counters(s, theirs)).toEqual({ stun: 1 });
    s = cast(s, 'p1', 'Test Quick Wake', { targets: [[obj(mine)]] });
    expect(s.objects[mine]!.tapped).toBe(true);
    expect(counters(s, mine)).toEqual({});
  });
});

const TOWER = card('Test Watch Tower', 'Land', "{T}: Add {C}.\n{1}, {T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.");
const SHIELDED = card('Test Veiled Guard', 'Creature — Wizard', 'Hexproof', { pt: ['2', '2'] });
const SHIELDED_FROM = card('Test Veiled Scout', 'Creature — Wizard', 'Hexproof from red', { pt: ['2', '2'] });
const SHROUDED = card('Test Shrouded Guard', 'Creature — Wizard', 'Shroud', { pt: ['2', '2'] });
const AURA = card('Test Quiet Aura', 'Enchantment', 'You have hexproof.');
const PING = card('Test Hex Bolt', 'Instant', 'Test Hex Bolt deals 1 damage to any target.');
const REDPING = compileCard({ name: 'Test Red Bolt', layout: 'normal', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Test Red Bolt deals 1 damage to any target.', colors: ['R'] } as unknown as OracleCard);
const HDEFS = [TOWER, SHIELDED, SHIELDED_FROM, SHROUDED, AURA, PING, REDPING];

describe('CR 702.11b-c, 609.4, 115.1: "Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn\'t have hexproof."', () => {
  it('is automated', () => {
    for (const d of HDEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
  const game = (): GameState => mpScenario({
    defs: HDEFS, options: { startingPlayer: 'p1' },
    zones: {
      p1: { battlefield: ['Test Watch Tower', 'Plains', 'Test Veiled Guard'], hand: ['Test Hex Bolt', 'Test Red Bolt'] },
      p2: { battlefield: ['Test Veiled Guard', 'Test Veiled Scout', 'Test Shrouded Guard'], hand: ['Test Hex Bolt'] },
      p3: { battlefield: ['Test Quiet Aura'] },
    },
  });
  const refused = (s: GameState, player: PlayerId, t: TargetChoice, name = 'Test Hex Bolt'): boolean => {
    try { answer(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), { kind: 'chooseTargets', targets: [t] }); return false; } catch { return true; }
  };
  const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
  const tower = (s: GameState): GameState => settle(drive(act(s, { type: 'activate', player: 'p1', source: idOf(s, 'Test Watch Tower'), ability: 'p:0:1' })));
  const guard = (s: GameState, p: PlayerId, name = 'Test Veiled Guard'): ObjectId => idOf(s, name, p);
  it("before the Tower's ability: hexproof creatures and the player with hexproof can't be targeted by p1", () => {
    const s = game();
    expect(refused(s, 'p1', obj(guard(s, 'p2')))).toBe(true);
    expect(refused(s, 'p1', pl('p3'))).toBe(true);
    expect(refused(s, 'p1', obj(guard(s, 'p2', 'Test Veiled Scout')), 'Test Red Bolt')).toBe(true); // hexproof from red stops a red spell
  });
  it("after it: p1 may target the opponents' hexproof creatures (also \"hexproof from red\") and an opponent with hexproof", () => {
    const s = tower(game());
    expect(refused(s, 'p1', obj(guard(s, 'p2')))).toBe(false);
    expect(refused(s, 'p1', obj(guard(s, 'p2', 'Test Veiled Scout')))).toBe(false); // (colorless: hexproof from red never applied to it)
    expect(refused(s, 'p1', obj(guard(s, 'p2', 'Test Veiled Scout')), 'Test Red Bolt')).toBe(false);
    expect(refused(s, 'p1', pl('p3'))).toBe(false);
  });
  it('negative: shroud still applies', () => {
    const s = tower(game());
    expect(refused(s, 'p1', obj(guard(s, 'p2', 'Test Shrouded Guard')))).toBe(true);
  });
  it("negative: only the spells and abilities p1 controls: p2, who then has priority, can't target p1's hexproof creature or p3 (who has hexproof)", () => {
    const s = pass(tower(game()));
    expect(s.pending?.kind).toBe('priority');
    expect(s.pending?.player).toBe('p2');
    expect(refused(s, 'p2', pl('p4'))).toBe(false); // legal at all
    expect(refused(s, 'p2', obj(guard(s, 'p1')))).toBe(true);
    expect(refused(s, 'p2', pl('p3'))).toBe(true);
  });
  it('the hexproof is not lost: it lasts only until end of turn', () => {
    let s = tower(game());
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's next turn");
    expect(refused(s, 'p1', obj(guard(s, 'p2')))).toBe(true);
  });
});

describe('edh-players-22 review: rulings pinned', () => {
  const kgame = (): GameState => mpScenario({
    defs: [...DEFS, card('Test Edict', 'Instant', 'Target player sacrifices an artifact.')], options: { startingPlayer: 'p2' },
    zones: { p1: { battlefield: ['Test Karma Wheel', 'Test Gold Idol'] }, p2: { battlefield: ['Test Chaff Rock'], hand: ['Test Edict', 'Test Smash Anything'] } },
  });
  it('Karmic Justice ruling 2023-09-01: a sacrifice does not trigger it', () => {
    const s0 = kgame();
    const asked: string[] = [];
    const s = cast(s0, 'p2', 'Test Edict', { targets: [[{ kind: 'player', id: 'p1' } as TargetChoice]] }, asked);
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Gold Idol');
    expect(asked.filter((a) => a.startsWith('yesNo'))).toEqual([]);
  });
  it('Karmic Justice ruling 2023-09-01: destroying Karmic Justice itself triggers it', () => {
    const s0 = kgame();
    const s = cast(s0, 'p2', 'Test Smash Anything', { targets: [[obj(idOf(s0, 'Test Karma Wheel', 'p1'))], [obj(idOf(s0, 'Test Chaff Rock', 'p2'))]], yes: [true] });
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Karma Wheel');
    expect(names(s, 'battlefield', 'p2')).not.toContain('Test Chaff Rock');
  });
  it('Fear of Sleep Paralysis ruling 2024-09-20: an opponent cannot pay a {Q} cost with a tapped permanent whose stun counter stays', () => {
    const ENGINE = card('Test Quiet Engine', 'Artifact', '{Q}: You gain 1 life.');
    const s0 = mpScenario({ defs: [WARDEN, ENGINE], options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: ['Test Dream Warden'] }, p2: { battlefield: [{ name: 'Test Quiet Engine', tapped: true, counters: { stun: 1 } }] } } });
    expect(ENGINE.automation.level).toBe('full');
    const engine = idOf(s0, 'Test Quiet Engine', 'p2');
    expect(() => act(s0, { type: 'activate', player: 'p2', source: engine, ability: 'p:0:0' })).toThrow();
    const s1 = mpScenario({ defs: [ENGINE], options: { startingPlayer: 'p2' }, zones: { p2: { battlefield: [{ name: 'Test Quiet Engine', tapped: true }] } } });
    expect(() => act(s1, { type: 'activate', player: 'p2', source: idOf(s1, 'Test Quiet Engine', 'p2'), ability: 'p:0:0' })).not.toThrow();
  });
});
