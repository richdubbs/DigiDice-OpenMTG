/**
 * edh-next-108 (concept lane sac-random): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. The rulings were fetched from Scryfall in the cloud
 * session; the CR cites are from memory (unverified: no rules/cr in a cloud checkout).
 *
 *   CR 701.21a, 107.1a      "sacrifices a tenth of the creatures they control of their choice, rounded up": per opponent, rounded up, own creatures only
 *   CR 701.21a, 608.2c      "If they do": only when the other player sacrificed
 *   CR 406.1, 601.2, 118.9  "cast any number of spells from among cards exiled this way" after sacrificing/discarding
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, put } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil, step } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
void applyAction; void answer; void findAll; void legal; void namesOn; void obj; void pl; void lifeOf;

interface Script {
  yes?: boolean[];
  targets?: TargetChoice[][];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  options?: string[][];
  numbers?: number[];
}
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
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
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
// (two skips met in one untap step ask which to apply first, CR 616.1: the first option is taken)
const toTurn = (s0: GameState, n: number): GameState => {
  let s = s0;
  for (let guard = 0; guard < 400; guard++) {
    if (s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority') return s;
    if (s.pending?.kind === 'chooseReplacement') { s = answer(s, { kind: 'chooseReplacement', id: s.pending.options[0]!.id }); continue; }
    s = passUntil(s, (x) => (x.turn.number === n && x.turn.step === 'main1') || x.pending?.kind === 'chooseReplacement', `turn ${n}`);
  }
  throw new Error(`never reached turn ${n}`);
};
void put; void toTurn;


const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const bear = (n: number): { name: string }[] => Array.from({ length: n }, () => ({ name: 'Test Bear' }));
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
const count = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Test Bear').length;

// ---- Legate Lanius -------------------------------------------------------------------------------------------------------------------------------------------------------

const DECIMATE = card('Test Decimator', 'Creature — Human', 'When this creature enters, each opponent sacrifices a tenth of the creatures they control of their choice, rounded up.', { pt: ['2', '2'] });
describe('CR 701.21a, 107.1a: "each opponent sacrifices a tenth of the creatures they control of their choice, rounded up."', () => {
  const setup = (): GameState => mpScenario({
    defs: [DECIMATE, BEAR],
    zones: { p1: { hand: ['Test Decimator'], battlefield: bear(11) }, p2: { battlefield: bear(11) }, p3: { battlefield: bear(10) }, p4: { battlefield: bear(1) } },
  });
  it('is automated', () => expect(full(DECIMATE)).toBe(true));
  it('each opponent counts THEIR OWN creatures: 11 -> 2 sacrificed, 10 -> 1, 1 -> 1 (rounded up); the caster keeps all of theirs', () => {
    const s = cast(setup(), 'Test Decimator');
    expect(count(s, 'p2')).toBe(9);
    expect(count(s, 'p3')).toBe(9);
    expect(count(s, 'p4')).toBe(0);
    expect(count(s, 'p1')).toBe(11);
  });
  it('an opponent with no creatures sacrifices nothing (the negative case)', () => {
    const s = cast(mpScenario({ defs: [DECIMATE, BEAR], zones: { p1: { hand: ['Test Decimator'] }, p2: { battlefield: bear(3) } } }), 'Test Decimator');
    expect(count(s, 'p2')).toBe(2);
    expect(count(s, 'p3')).toBe(0);
  });
});

// ---- Gisa's Favorite Shovel / Invoke Despair --------------------------------------------------------------------------------------------------------------------------

const TAX = card('Test Tax', 'Sorcery', 'Target opponent sacrifices a creature of their choice. If they do, you gain 3 life.');
const TAX2 = card('Test Levy', 'Sorcery', 'Target opponent sacrifices a creature of their choice. If they can\'t, you gain 3 life.');
describe('CR 701.21a, 608.2c: "If they do" / "If they can\'t" after another player\'s sacrifice', () => {
  it('both are automated', () => { expect(full(TAX)).toBe(true); expect(full(TAX2)).toBe(true); });
  it('"If they do": the opponent sacrificed a creature, so you gain 3 life; with no creature to sacrifice you gain nothing', () => {
    const withBear = cast(mpScenario({ defs: [TAX, BEAR], zones: { p1: { hand: ['Test Tax'] }, p2: { battlefield: bear(1) } } }), 'Test Tax', { targets: [[pl('p2')]] });
    expect(count(withBear, 'p2')).toBe(0);
    expect(lifeOf(withBear, 'p1')).toBe(23);
    const without = cast(mpScenario({ defs: [TAX, BEAR], zones: { p1: { hand: ['Test Tax'] } } }), 'Test Tax', { targets: [[pl('p2')]] });
    expect(lifeOf(without, 'p1')).toBe(20);
  });
  it('"If they can\'t": you gain 3 life only when the opponent had nothing to sacrifice', () => {
    const withBear = cast(mpScenario({ defs: [TAX2, BEAR], zones: { p1: { hand: ['Test Levy'] }, p2: { battlefield: bear(1) } } }), 'Test Levy', { targets: [[pl('p2')]] });
    expect(count(withBear, 'p2')).toBe(0);
    expect(lifeOf(withBear, 'p1')).toBe(20);
    const without = cast(mpScenario({ defs: [TAX2, BEAR], zones: { p1: { hand: ['Test Levy'] } } }), 'Test Levy', { targets: [[pl('p2')]] });
    expect(lifeOf(without, 'p1')).toBe(23);
  });
});

// ---- Hellcarver Demon ------------------------------------------------------------------------------------------------------------------------------------------------------

const CARVE = card('Test Carver', 'Creature — Demon', 'When this creature enters, sacrifice all other permanents you control and discard your hand. Exile the top three cards of your library. You may cast any number of spells from among cards exiled this way without paying their mana costs.', { pt: ['3', '3'] });
const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}' });
describe('CR 701.21a, 701.9a, 406.1, 601.2, 118.9: "... You may cast any number of spells from among cards exiled this way without paying their mana costs."', () => {
  const setup = (): GameState => mpScenario({ defs: [CARVE, BEAR, CUB], zones: { p1: { hand: ['Test Carver', 'Plains'], battlefield: bear(2), library: ['Plains', 'Test Cub', 'Plains', 'Test Cub', 'Test Cub'] } } });
  it('is automated', () => expect(full(CARVE)).toBe(true));
  it('your permanents and hand are gone, the three exiled cards are the ones you may cast: casting two puts two spells on the stack, the land and the third stay in exile', () => {
    const before = setup();
    // casting the sorcery itself leaves it on the stack; the chosen spells resolve with the stack settled
    const after = cast(before, 'Test Carver', { objects: [(o, st) => o.filter((id) => st.defs[st.objects[id]!.defId]!.name === 'Test Cub').slice(0, 2)] });
    expect(count(after, 'p1')).toBe(0);
    expect(names(after, after.zones.battlefield.filter((id) => after.defs[after.objects[id]!.defId]!.name === 'Test Carver'))).toEqual(['Test Carver']);
    expect(names(after, after.zones.hand.p1!)).toEqual([]);
    expect(names(after, after.zones.battlefield.filter((id) => after.objects[id]!.controller === 'p1' && after.defs[after.objects[id]!.defId]!.name === 'Test Cub')).length).toBe(2);
  });
  it('casting none leaves all three in exile (the negative case); only the top three are exiled', () => {
    const before = setup();
    const after = cast(before, 'Test Carver', { objects: [() => []] });
    expect(after.zones.exile.length).toBe(3);
    expect(after.zones.library.p1!.length).toBe(before.zones.library.p1!.length - 3);
  });
});
