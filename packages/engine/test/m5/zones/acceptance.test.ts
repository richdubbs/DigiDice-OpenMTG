/**
 * WP14 acceptance, part 2 (design 15.1.4, 15.2: "the section 13 cards that use them"; WP14 review): the WP14 parts of Fiend Hunter (move + link, with the
 * race of design 8.10 and a second resolution under Panharmonicon), Rancor, Fire // Ice, Jace, the Mind Sculptor, Cryptic Command, Smothering Tithe and Oko,
 * each run with its section 13 JSON over the faked WP11 pipeline. `may` comes from support.ts; `draw` (WP13) is faked here. The parts that need other
 * packages (Smothering Tithe's and Mana Leak's `pay`, Sneak Attack's `effect` and `delay`, Pact of Negation's delayed trigger) are theirs to test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { drawCards, moveObject } from '../../../src/core/zones';
import type { AbilityDef, EffectProgram, GameState } from '../../../src/index';
import { resolvePlayers } from '../../../src/effects/refs';
import { chosenObject, ctxOn } from '../eval/helpers';
import { find, put, scenario, synth, tweak } from '../helpers';
import { EXAMPLES } from '../model/examples';
import { pipeline } from './pipeline';
import { NEIGHBOR_FAKES, putOnStack, resolveTop, runProgram, runSteps, withExamples } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

// WP13's `draw`, faked like the other neighbors (support.ts): each player draws `count` cards (CR 121.1).
NEIGHBOR_FAKES['draw'] = (cx, st) => {
  const s = st as Extract<typeof st, { op: 'draw' }>;
  const n = typeof s.count === 'number' ? s.count : 1;
  let k = 0;
  for (const p of resolvePlayers(cx, s.who)) k += drawCards(cx.g, p, n).length;
  return { performed: k > 0, count: k };
};

const abilitiesOf = (name: string, face = 0): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces[face]!.abilities;
const programOf = (name: string, startsWith: string, face = 0): EffectProgram => {
  const a = abilitiesOf(name, face).find((x) => (x as { text: string }).text.startsWith(startsWith))!;
  return (a as Extract<AbilityDef, { effect?: EffectProgram }> & { effect: EffectProgram }).effect;
};
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const onBattlefield = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name);

describe('Fiend Hunter (CR 607.2a, design 8.10)', () => {
  const etb = programOf('Fiend Hunter', 'When ~ enters');
  const ltb = programOf('Fiend Hunter', 'When ~ leaves');

  function board(): GameState {
    return withExamples(scenario(['Fiend Hunter', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Fiend Hunter'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] } }), 'Fiend Hunter');
  }
  /** Fiend Hunter dies (test setup): the leaves-the-battlefield ability then reads its last known links (CR 607.2a, 400.7). */
  const dies = (s: GameState, hunter: string): GameState => tweak(s, (t) => { moveObject(new Game(t), hunter, 'graveyard', { cause: 'destroy' }); });

  it('CR 607.2a: the enters ability exiles the creature and the leaves ability returns it under its owner\'s control', () => {
    const s = board();
    const hunter = find(s, 'Fiend Hunter', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r1 = runProgram(s, { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter, targets: [[chosenObject(bears)]] }, etb, [{ kind: 'yesNo', yes: true }]);
    expect(r1.state.zones.exile.map((id) => nameOf(r1.state, id))).toEqual(['Grizzly Bears']);
    const r2 = runProgram(dies(r1.state, hunter), { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter }, ltb);
    const back = onBattlefield(r2.state, 'Grizzly Bears');
    expect(back).toHaveLength(1);
    expect(r2.state.objects[back[0]!]!.controller).toBe('p2');
  });

  it('design 8.10, CR 607.2a: the race: if the leaves ability resolves first, nothing is linked yet, nothing returns, and the creature exiled after stays exiled', () => {
    const s = board();
    const hunter = find(s, 'Fiend Hunter', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = structuredClone(s);
    const enters = putOnStack(t, { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter, targets: [[chosenObject(bears)]] }); // on the stack, not resolved
    const gone = dies(t, hunter);
    const r1 = runProgram(gone, { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter }, ltb); // resolves first: nothing to return
    expect(r1.results[0]!.performed).toBe(false);
    // Now the enters ability resolves (its source is gone: CR 113.7a, it still resolves) and exiles the Bears; nothing will ever return them.
    const after = r1.state;
    after.zones.stack = after.zones.stack.filter((id) => id !== r1.id);
    expect(after.zones.stack[after.zones.stack.length - 1]).toBe(enters);
    runSteps(ctxOn(after, enters, etb, [{ kind: 'yesNo', yes: true }]), etb.steps);
    expect(after.zones.exile.some((id) => nameOf(after, id) === 'Grizzly Bears')).toBe(true);
    expect(onBattlefield(after, 'Grizzly Bears')).toEqual([]);
    expect(after.lki[hunter]!.object.links).toBeUndefined(); // the source was gone, so nothing was linked (CR 607.2a, 400.7)
  });

  it('CR 607.2a, 603.2d (Panharmonicon): the enters ability resolving twice exiles two creatures, and the leaves ability returns both', () => {
    const s = board();
    const hunter = find(s, 'Fiend Hunter', 'battlefield');
    const [bears, giant] = [find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const r1 = runProgram(s, { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter, targets: [[chosenObject(bears)]] }, etb, [{ kind: 'yesNo', yes: true }]);
    const r2 = runProgram(r1.state, { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter, targets: [[chosenObject(giant)]] }, etb, [{ kind: 'yesNo', yes: true }]);
    expect(r2.state.zones.exile).toHaveLength(2);
    const r3 = runProgram(dies(r2.state, hunter), { name: 'Fiend Hunter', kind: 'triggered', sourceId: hunter }, ltb);
    expect([onBattlefield(r3.state, 'Grizzly Bears').length, onBattlefield(r3.state, 'Hill Giant').length]).toEqual([1, 1]);
  });
});

describe('Rancor (CR 603.10a, 400.7e)', () => {
  it('CR 603.10a: put into a graveyard from the battlefield, it returns to its owner\'s hand (the event\'s subject is the card in the graveyard)', () => {
    const s0 = withExamples(scenario(['Rancor', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }), 'Rancor');
    let rancor = '';
    const s = tweak(s0, (t) => {
      rancor = put(t, 'p1', 'battlefield', 'Rancor');
      t.objects[rancor]!.attachedTo = find(t, 'Grizzly Bears', 'battlefield');
      moveObject(new Game(t), rancor, 'graveyard', { cause: 'sba' }); // e.g. the creature died and state-based action 704.5m put it there
    });
    const inGrave = s.lki[rancor]!.newId!;
    const r = runProgram(s, { name: 'Rancor', kind: 'triggered', sourceId: rancor, event: { ev: 'zoneChange', roles: { subject: { objects: [{ id: inGrave, zone: 'graveyard' }] } }, before: {} } },
      programOf('Rancor', 'When ~ is put'));
    expect(r.state.zones.hand['p1']!.map((id) => nameOf(r.state, id))).toEqual(['Rancor']);
  });
});

describe('Fire // Ice (CR 709.3)', () => {
  it('CR 701.26a, 709.3b: Ice taps the target permanent and its caster draws a card', () => {
    const s0 = withExamples(scenario(['Fire // Ice', 'Grizzly Bears', 'Island'], { p1: { library: ['Island', 'Island'] }, p2: { battlefield: ['Grizzly Bears'] } }), 'Fire // Ice');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const t = structuredClone(s0);
    const ice = putOnStack(t, { name: 'Fire // Ice', targets: [[chosenObject(bears)]] });
    t.objects[ice]!.stack!.face = 1; // the Ice half was cast (CR 709.3)
    const r = resolveTop(t);
    expect(r.results.map((x) => x.performed)).toEqual([true, true]);
    expect(r.state.objects[bears]!.tapped).toBe(true);
    expect(r.state.zones.hand['p1']).toHaveLength(1);
  });
});

describe('Cryptic Command (CR 700.2, 608.2b)', () => {
  function board(): { t: GameState; bolt: string; bears: string } {
    const s = withExamples(scenario(['Cryptic Command', 'Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Island'], {
      p1: { library: ['Island'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', { name: 'Hill Giant' }] },
    }), 'Cryptic Command');
    const t = structuredClone(s);
    const bolt = putOnStack(t, { name: 'Lightning Bolt', owner: 'p2' });
    return { t, bolt, bears: find(t, 'Grizzly Bears', 'battlefield') };
  }

  it('CR 701.6a, 400.7: counter target spell and return target permanent to its owner\'s hand', () => {
    const { t, bolt, bears } = board();
    const cc = putOnStack(t, { name: 'Cryptic Command', targets: [[chosenObject(bolt)], [chosenObject(bears)]] });
    t.objects[cc]!.stack!.modes = [0, 1];
    const r = resolveTop(t);
    expect(r.state.zones.graveyard['p2']!.map((id) => nameOf(r.state, id))).toContain('Lightning Bolt');
    expect(r.state.zones.hand['p2']!.map((id) => nameOf(r.state, id))).toEqual(['Grizzly Bears']);
  });

  it('CR 701.26a: tap all creatures your opponents control, and draw a card', () => {
    const { t } = board();
    const cc = putOnStack(t, { name: 'Cryptic Command' });
    t.objects[cc]!.stack!.modes = [2, 3];
    const r = resolveTop(t);
    const theirs = r.state.zones.battlefield.filter((id) => r.state.objects[id]!.controller === 'p2' && nameOf(r.state, id) !== 'Lightning Bolt');
    expect(theirs.every((id) => r.state.objects[id]!.tapped)).toBe(true);
    expect(r.state.objects[find(r.state, 'Hill Giant', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(r.state.zones.hand['p1']).toHaveLength(1);
  });

  it('CR 608.2b: with the countered spell gone, the bounce still happens', () => {
    const { t, bolt, bears } = board();
    const cc = putOnStack(t, { name: 'Cryptic Command', targets: [[chosenObject(bolt)], [chosenObject(bears)]] });
    t.objects[cc]!.stack!.modes = [0, 1];
    t.zones.stack = t.zones.stack.filter((id) => id !== bolt);
    t.objects[bolt]!.zone = 'graveyard';
    t.zones.graveyard['p2']!.push(bolt);
    const r = resolveTop(t);
    expect(r.resolved).toBe(true);
    expect(r.state.zones.hand['p2']!.map((id) => nameOf(r.state, id))).toEqual(['Grizzly Bears']);
  });
});

describe('Jace, the Mind Sculptor (CR 606)', () => {
  it('CR 400.7: "-1: Return target creature to its owner\'s hand"', () => {
    const jace = synth({ name: 'Jace, the Mind Sculptor', cost: '{2}{U}{U}', type: 'Legendary Planeswalker — Jace', abilities: abilitiesOf('Jace, the Mind Sculptor') });
    let id = '';
    const s = tweak(scenario(['Grizzly Bears'], { defs: [jace], p2: { battlefield: ['Grizzly Bears'] } }), (t) => { id = put(t, 'p1', 'battlefield', { name: 'Jace, the Mind Sculptor', counters: { loyalty: 3 } }); });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = runProgram(s, { name: 'Jace, the Mind Sculptor', kind: 'activated', sourceId: id, targets: [[chosenObject(bears)]] }, programOf('Jace, the Mind Sculptor', '-1'));
    expect(r.state.zones.hand['p2']!.map((id) => nameOf(r.state, id))).toEqual(['Grizzly Bears']);
  });
});

describe('Smothering Tithe and Oko, Thief of Crowns: predefined tokens (CR 111.10)', () => {
  it('CR 111.10a: Smothering Tithe\'s "you create a Treasure token" (the `else` of its pay step, WP10\'s)', () => {
    const tithe = synth({ name: 'Smothering Tithe', cost: '{3}{W}', type: 'Enchantment', abilities: abilitiesOf('Smothering Tithe') });
    const s = scenario([], { defs: [tithe], p1: { battlefield: ['Smothering Tithe'] } });
    const pay = programOf('Smothering Tithe', 'Whenever').steps[0] as Extract<EffectProgram['steps'][number], { op: 'pay' }>;
    const r = runProgram(s, { name: 'Smothering Tithe', kind: 'triggered', sourceId: find(s, 'Smothering Tithe', 'battlefield') }, { targets: [], steps: pay.else! });
    const tok = r.state.zones.battlefield.filter((id) => r.state.objects[id]!.kind === 'token');
    expect(tok.map((id) => [nameOf(r.state, id), r.state.objects[id]!.controller])).toEqual([['Treasure Token', 'p1']]);
  });

  it('CR 111.10b: Oko\'s "+2: Create a Food token"', () => {
    const oko = synth({ name: 'Oko, Thief of Crowns', cost: '{1}{G}{U}', type: 'Legendary Planeswalker — Oko', abilities: abilitiesOf('Oko, Thief of Crowns') });
    let id = '';
    const s = tweak(scenario([], { defs: [oko] }), (t) => { id = put(t, 'p1', 'battlefield', { name: 'Oko, Thief of Crowns', counters: { loyalty: 4 } }); });
    const r = runProgram(s, { name: 'Oko, Thief of Crowns', kind: 'activated', sourceId: id }, programOf('Oko, Thief of Crowns', '+2'));
    const tok = r.state.zones.battlefield.filter((id) => r.state.objects[id]!.kind === 'token');
    expect(tok.map((id) => nameOf(r.state, id))).toEqual(['Food Token']);
  });
});
