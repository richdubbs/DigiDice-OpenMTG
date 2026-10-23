/**
 * WP31: the "through the real spine" placeholders of test/m5/cards (cards.test.ts, pipeline.test.ts) and test/m5/lifedamage/cards.test.ts, now that WP10-WP15
 * have merged. Each card carries the JSON of its design section 13 worked example and is played with real actions (`applyAction`): announced by WP7,
 * resolved by WP10's `resolveStackObject`, its events proposed through WP11's pipeline and performed by the real performers. Nothing is mocked here (the other
 * files of these directories replace the pipeline and the spine with fakes, so they can't hold these tests).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, Decision, DecisionAnswer, GameState, ObjectId } from '../../../src/index';
import { activateManaAbility } from '../../../src/rules/mana';
import { act, answer, find, lifeOf, logHas, scenario, synth } from '../helpers';
import { objectTarget, playerTarget } from '../announce/support';
import { eventsOf, run } from '../propose/support';
import { withExamples } from '../zones/support';
import { EXAMPLES } from '../model/examples';

type Answerer = (d: Decision, s: GameState) => DecisionAnswer | 'pass';

/** Answer every decision with `f` (paying automatically) and pass priority while the stack is not empty; stop with an empty stack at priority. */
function settle(s0: GameState, f: Answerer, max = 60): { s: GameState; asked: Decision[] } {
  let s = s0;
  const asked: Decision[] = [];
  for (let i = 0; i < max; i++) {
    const d = s.pending;
    if (!d) break;
    if (d.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: d.player });
      continue;
    }
    if (d.kind === 'payCost') {
      s = answer(s, { kind: 'payCost', auto: true });
      continue;
    }
    asked.push(d);
    const a = f(d, s);
    if (a === 'pass') throw new Error(`unexpected decision ${d.kind}`);
    s = answer(s, a);
  }
  return { s, asked };
}

/** A synthetic card with the abilities of its design section 13 worked example (the fixture index has no such card). */
function designed(name: string, cost: string, type: string, pt?: [string, string]): CardDef {
  const ex = EXAMPLES.find((e) => e.name === name);
  if (!ex) throw new Error(`no worked example ${name}`);
  return synth({ name, cost, type, abilities: ex.faces[0]!.abilities, ...(pt ? { pt } : {}) });
}
const PLUME = designed('Paradise Plume', '{4}', 'Artifact');

const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);

describe('CR 608.2d (WP10, WP14): Path to Exile end to end', () => {
  const board = (): GameState => scenario(['Grizzly Bears', 'Plains', 'Forest'], {
    defs: [designed('Path to Exile', '{W}', 'Instant')],
    p1: { hand: ['Path to Exile'], battlefield: ['Plains'] },
    p2: { battlefield: ['Grizzly Bears'], library: ['Forest', 'Grizzly Bears'] },
  });

  it('the creature is exiled; its controller (p2) is asked "may", searches for a basic land, it enters tapped, the library is shuffled', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const { s, asked } = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Path to Exile', 'hand') }), (d, t) => {
      if (d.kind === 'chooseTargets') return { kind: 'chooseTargets', targets: [objectTarget(bears)] };
      if (d.kind === 'yesNo') return { kind: 'yesNo', yes: true };
      if (d.kind === 'chooseObjects') return { kind: 'chooseObjects', ids: d.options.filter((o) => names(t, [o])[0] === 'Forest') };
      return 'pass';
    });
    expect(asked.map((d) => [d.kind, d.player])).toEqual([['chooseTargets', 'p1'], ['yesNo', 'p2'], ['chooseObjects', 'p2']]);
    expect(names(s, s.zones.exile)).toEqual(['Grizzly Bears']);
    const forest = s.zones.battlefield.find((id) => names(s, [id])[0] === 'Forest' && s.objects[id]!.controller === 'p2');
    expect(forest !== undefined && s.objects[forest]!.tapped).toBe(true);
    expect(logHas(s, /shuffles/i) || s.log.some((l) => l.rules?.includes('CR 701.24a'))).toBe(true);
  });

  it('answered "no": nothing is searched, the land stays in the library', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const { s, asked } = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Path to Exile', 'hand') }), (d) =>
      d.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: [objectTarget(bears)] } : d.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : 'pass');
    expect(asked.map((d) => d.kind)).toEqual(['chooseTargets', 'yesNo']);
    expect(names(s, s.zones.library.p2!)).toContain('Forest');
    expect(names(s, s.zones.exile)).toEqual(['Grizzly Bears']);
  });
});

describe('CR 606.4, 701.20e (WP10, WP14): Jace, the Mind Sculptor +2 end to end', () => {
  const board = (): GameState => scenario(['Island', 'Swamp'], {
    defs: [designed('Jace, the Mind Sculptor', '{2}{U}{U}', 'Legendary Planeswalker — Jace')],
    p1: { battlefield: [{ name: 'Jace, the Mind Sculptor', counters: { loyalty: 3 } }] },
    p2: { library: ['Swamp', 'Island'] },
  });

  it.each([[true, 'bottom'], [false, 'top']] as const)('the `may` answered %s: the looked-at card ends on the %s of the library, Jace has 5 loyalty', (yes, where) => {
    const s0 = board();
    const jace = find(s0, 'Jace, the Mind Sculptor', 'battlefield');
    const topCard = s0.zones.library.p2![0]!;
    const { s, asked } = settle(act(s0, { type: 'activate', player: 'p1', source: jace, ability: 'p:0:0' }), (d) =>
      d.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: [playerTarget('p2')] } : d.kind === 'yesNo' ? { kind: 'yesNo', yes } : 'pass');
    expect(asked.map((d) => d.kind)).toEqual(['chooseTargets', 'yesNo']);
    expect(s.objects[jace]!.counters.loyalty).toBe(5);
    const lib = s.zones.library.p2!;
    const at = where === 'bottom' ? lib[lib.length - 1]! : lib[0]!;
    expect(names(s, [at])[0]).toBe(names(s0, [topCard])[0]);
  });
});

describe('CR 608.2c, 701.20a (WP10, WP13, WP14): Fact or Fiction end to end', () => {
  it('the top five are revealed, the opponent separates them, p1 keeps a pile: it goes to the hand, the other to the graveyard', () => {
    const lib = ['Island', 'Forest', 'Plains', 'Swamp', 'Mountain', 'Island'];
    const s0 = scenario(['Island', 'Forest', 'Plains', 'Swamp', 'Mountain'], {
      defs: [designed('Fact or Fiction', '{3}{U}', 'Instant')],
      p1: { hand: ['Fact or Fiction'], battlefield: ['Island', 'Island', 'Island', 'Island'], library: lib },
    });
    const top5 = s0.zones.library.p1!.slice(0, 5);
    const { s, asked } = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Fact or Fiction', 'hand') }), (d) => {
      if (d.player === 'p2' && d.kind === 'chooseObjects') return { kind: 'chooseObjects', ids: d.options.slice(0, 2) }; // pile A: two cards
      if (d.kind === 'chooseOption') return { kind: 'chooseOption', ids: [d.options[0]!.id] };
      if (d.kind === 'chooseObjects') return { kind: 'chooseObjects', ids: d.options.slice(0, 2) };
      return 'pass';
    });
    expect(asked.some((d) => d.player === 'p2')).toBe(true); // an opponent separates (CR 701.20)
    const hand = names(s, s.zones.hand.p1!);
    const yard = names(s, s.zones.graveyard.p1!).filter((n) => n !== 'Fact or Fiction');
    expect(hand.length + yard.length).toBe(5);
    expect([...hand, ...yard].sort()).toEqual(names(s0, top5).sort());
    expect([2, 3]).toContain(hand.length); // one of the two piles the opponent made (two cards and three cards)
  });
});

describe('CR 605.3b (WP13): a mana ability activated through the milestone 3 path emits manaAdded with viaActivation', () => {
  it('Paradise Plume (the color chosen as it entered) taps for that color', () => {
    const s0 = scenario(['Plains'], { defs: [PLUME], p1: { hand: ['Paradise Plume'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    const { s } = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Paradise Plume', 'hand') }), (d) =>
      d.kind === 'chooseColor' ? { kind: 'chooseColor', color: 'G' } : d.kind === 'chooseOption' ? { kind: 'chooseOption', ids: [d.options.find((o) => /green/i.test(o.label))?.id ?? d.options[0]!.id] } : 'pass');
    const plume = find(s, 'Paradise Plume', 'battlefield');
    const r = run(s, (g) => activateManaAbility(g, 'p1', plume, 'p:0:2', {}));
    expect(r.result).toEqual(['G']);
    expect(eventsOf(r.g, 'manaAdded')).toMatchObject([{ player: 'p1', sourceId: plume, viaActivation: true }]);
    // the player's action: the mana arrives in the pool, the Plume is tapped (before WP31 this paid {T} and added nothing)
    const tapped = act(s, { type: 'activate', player: 'p1', source: plume, ability: 'p:0:2' });
    expect(tapped.players[0]!.manaPool.map((u) => u.type)).toEqual(['G']);
    expect(tapped.objects[plume]!.tapped).toBe(true);
  });
});

describe('CR 603.2, 608.2d (WP10): Paradise Plume\'s trigger "you may gain 1 life" end to end', () => {
  // A fifth Plains: whatever four lands pay for the Plume, {W} is left for the white spell.
  const WHITE = synth({ name: 'Test White Cat', cost: '{W}', type: 'Creature — Cat', pt: ['1', '1'], abilities: [] });
  const plumeBoard = (): GameState => scenario(['Plains', 'Grizzly Bears', 'Forest'], {
    defs: [PLUME, WHITE],
    p1: { hand: ['Paradise Plume', 'Grizzly Bears', 'Grizzly Bears', 'Test White Cat'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Forest', 'Forest', 'Forest', 'Forest'] },
  });
  const colorGreen = (d: Decision): DecisionAnswer | 'pass' => (d.kind === 'chooseColor' ? { kind: 'chooseColor', color: 'G' } : d.kind === 'chooseOption' ? { kind: 'chooseOption', ids: [d.options.find((o) => /green/i.test(o.label))?.id ?? d.options[0]!.id] } : 'pass');

  it.each([[true, 21], [false, 20]] as const)('a green spell is cast: asked "may", answered %s, life %i', (yes, life) => {
    const s0 = plumeBoard();
    const placed = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Paradise Plume', 'hand') }), colorGreen).s;
    const { s, asked } = settle(act(placed, { type: 'cast', player: 'p1', card: find(placed, 'Grizzly Bears', 'hand') }), (d) => (d.kind === 'yesNo' ? { kind: 'yesNo', yes } : 'pass'));
    expect(asked.map((d) => d.kind)).toEqual(['yesNo']);
    expect(lifeOf(s, 'p1')).toBe(life);
  });

  it('a white spell is cast with the Plume set to green: nothing triggers, nothing is asked, life is unchanged', () => {
    const s0 = plumeBoard();
    const placed = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Paradise Plume', 'hand') }), colorGreen).s;
    const { s, asked } = settle(act(placed, { type: 'cast', player: 'p1', card: find(placed, 'Test White Cat', 'hand') }), (d) => (d.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : 'pass'));
    expect(asked).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test White Cat')).toBe(true);
  });
});

describe('design 8.10 #2 (WP14, WP12): Swords to Plowshares end to end', () => {
  it('the creature is exiled and its controller gains life equal to its power as it last existed (CR 608.2h): a 2/2 with a +1/+1 counter gives 3', () => {
    const s0 = withExamples(scenario(['Swords to Plowshares', 'Plains', 'Grizzly Bears'], {
      p1: { hand: ['Swords to Plowshares'], battlefield: ['Plains'] },
      p2: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 1 } }] },
    }), 'Swords to Plowshares');
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const { s } = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Swords to Plowshares', 'hand') }), (d) =>
      d.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: [objectTarget(bears)] } : 'pass');
    expect(names(s, s.zones.exile)).toEqual(['Grizzly Bears']);
    expect(lifeOf(s, 'p2')).toBe(23);
  });
});

describe('CR 120.3, design 10.5 (WP10, WP12): Magma Spray end to end', () => {
  it('2 damage to the creature (it dies), and the "exile it instead" rider stays a manual reminder chip until end of turn (milestone 6 replacement)', () => {
    const s0 = scenario(['Mountain', 'Grizzly Bears'], {
      defs: [designed('Magma Spray', '{R}', 'Instant')],
      p1: { hand: ['Magma Spray'], battlefield: ['Mountain'] },
      p2: { battlefield: ['Grizzly Bears'] },
    });
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const { s } = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Magma Spray', 'hand') }), (d) =>
      d.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: [objectTarget(bears)] } : d.kind === 'manualResolve' ? { kind: 'manualResolve', ops: [] } : 'pass');
    expect(s.objects[bears]).toBeUndefined(); // it left the battlefield (CR 704.5g)
    expect(s.reminders.map((r) => r.text)).toContain('If that creature would die this turn, exile it instead.');
  });
});

describe('CR 510.2, 603.2 (WP10, WP12, WP13): Sword of Fire and Ice end to end', () => {
  it('the equipped creature deals combat damage to a player: the trigger targets, deals 2 damage and its controller draws a card', () => {
    let s = scenario(['Grizzly Bears', 'Plains'], {
      defs: [designed('Sword of Fire and Ice', '{3}', 'Artifact — Equipment')],
      p1: { battlefield: ['Sword of Fire and Ice', 'Grizzly Bears', 'Plains', 'Plains'] },
    });
    const [sword, bears] = [find(s, 'Sword of Fire and Ice', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield')];
    s = { ...s, objects: { ...s.objects, [sword]: { ...s.objects[sword]!, attachedTo: bears } } };
    const handBefore = s.zones.hand.p1!.length;
    let attacked = false;
    for (let i = 0; i < 40 && !(attacked && s.turn.step === 'endCombat'); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') {
        s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bears, defender: 'p2' }] });
        attacked = true;
      } else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [playerTarget('p2')] });
      else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else throw new Error(`unexpected ${d.kind}`);
    }
    expect(lifeOf(s, 'p2')).toBe(20 - 4 - 2); // 4 combat damage (2/2 +2/+2), then 2 from the trigger
    expect(s.zones.hand.p1!.length).toBe(handBefore + 1);
  });
});

// Triggered mana abilities (CR 605.1b) are not resolved by the spine yet: `feature:trigger.mana` is not registered (STATUS W2 gap 5), and
// test/m5/triggers/mana-trigger.test.ts pins that such an ability is never stacked or approximated. The placeholder for them was deleted (WP31).
