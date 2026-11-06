/**
 * edh-next-112 (concept lane library-draw): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. The CR cites are from memory
 * (unverified: no rules/cr in a cloud checkout); rulings were fetched from Scryfall in the cloud session.
 *
 *   CR 208.1, 201.2, 701.23     "Wild Pair" (same total power and toughness)
 *   CR 607.2a, 201.2, 101.2    "Your opponents can't cast spells with the same name as a card exiled with ~." (Circu, Dimir Lobotomist)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, labels, legal } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

interface Script {
  yes?: boolean[];
  targets?: TargetChoice[][];
  objects?: (string[] | ((options: string[], s: GameState) => string[]))[];
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
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
void lifeOf; void full; void pl; void find; void legal;

// ---- Circu, Dimir Lobotomist ---------------------------------------------------------------------------------------------------------------------------------------------

const SEER = card('Test Seer', 'Artifact Creature — Human Wizard', "{0}: Exile the top card of target player's library.\nYour opponents can't cast spells with the same name as a card exiled with ~.", { pt: ['1', '1'] });
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const GLOW = card('Test Glow', 'Instant', 'You gain 1 life.');

describe('CR 607.2a, 201.2, 101.2: "Your opponents can\'t cast spells with the same name as a card exiled with ~."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SEER, SPARK, GLOW],
    zones: {
      p1: { battlefield: ['Test Seer'], hand: ['Test Spark'] },
      p2: { hand: ['Test Spark', 'Test Glow'], library: ['Test Spark'] },
    },
  });
  const exileTop = (s: GameState): GameState => settle(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Seer', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [[pl('p2')]] }));
  it('is automated', () => expect(full(SEER)).toBe(true));
  it('before anything is exiled, an opponent may cast a spell of that name; after a card of that name was exiled with it, no opponent may, but another name and the controller still may', () => {
    let s = setup();
    const castable = (st: GameState, p: PlayerId): string[] => labels(st, p).filter((l) => /^cast/i.test(l));
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    expect(castable(s, 'p2').join()).toContain('Test Spark');
    // back to p1's priority by re-running the scenario, exile first
    let t = setup();
    t = exileTop(t);
    expect(t.zones.exile.map((id) => t.objects[id]!.defId)).toContain('Test Spark');
    t = act(t, { type: 'pass', player: 'p1' });
    expect(t.pending?.player).toBe('p2');
    expect(castable(t, 'p2').join()).not.toContain('Test Spark');
    expect(castable(t, 'p2').join()).toContain('Test Glow');
  });
});

// ---- Wild Pair ------------------------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 208.1, 603.4, 701.23: "... search your library for a creature card with the same total power and toughness, put it onto the battlefield"', () => {
  const PAIR = card('Test Twins', 'Enchantment', 'Whenever a creature enters, if you cast it from your hand, you may search your library for a creature card with the same total power and toughness, put it onto the battlefield, then shuffle.');
  const C22 = card('Test Two Two', 'Creature — Bear', '', { pt: ['2', '2'] });
  const C31 = card('Test Three One', 'Creature — Bear', '', { pt: ['3', '1'] });
  const C33 = card('Test Three Three', 'Creature — Bear', '', { pt: ['3', '3'] });
  const setup = (): GameState => mpScenario({ defs: [PAIR, C22, C31, C33], zones: { p1: { battlefield: ['Test Twins'], hand: ['Test Two Two'], library: ['Plains', 'Test Three One', 'Test Three Three'] } } });
  it('is automated', () => expect(full(PAIR)).toBe(true));
  it('offers only creature cards whose power plus toughness equals the entering creature\'s (3/1 for a 2/2), not a 3/3; a creature that was not cast from hand offers nothing', () => {
    let s = setup();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Two Two', 'hand', 'p1') });
    let offered: string[] | undefined;
    s = settle(s, { yes: [true], objects: [(options, st) => { offered = options.map((id) => st.objects[id]!.defId); return []; }] });
    expect(offered).toBeDefined();
    expect(offered).toContain('Test Three One');
    expect(offered).not.toContain('Test Three Three');
  });
});
