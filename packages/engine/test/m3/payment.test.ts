import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src/index';
import { act, answer, castAuto, find, findAll, isTapped, life, pool, reject, scenario } from './scenario';

const tappedNames = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).map((id) => s.objects[id]!.defId);
const untappedNames = (s: GameState): string[] => s.zones.battlefield.filter((id) => !s.objects[id]!.tapped).map((id) => s.objects[id]!.defId);
const stackNames = (s: GameState): string[] => s.zones.stack.map((id) => s.objects[id]!.defId);
const cast = (s: GameState, name: string, extra: object = {}): GameState => act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), ...extra });
const payAuto = (s: GameState): GameState => answer(s, { kind: 'payCost', auto: true });

describe('paying mana costs (CR 601.2g-h, 106, 107.4)', () => {
  it('CR 601.2h: a creature with exact mana is cast by tapping exactly the lands it needs', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Forest'] } });
    s = castAuto(s, 'Grizzly Bears');
    expect(stackNames(s)).toEqual(['Grizzly Bears']);
    expect(tappedNames(s)).toEqual(['Forest', 'Forest']);
    expect(pool(s, 'p1')).toBe('');
    expect(s.players[0]!.turnStats.spellsCast).toBe(1);
  });

  it('CR 601.2h: the payCost decision shows the cost, the mana sources and whether automatic payment works', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = cast(s, 'Grizzly Bears');
    expect(s.pending).toMatchObject({ kind: 'payCost', player: 'p1', costText: '{1}{G}', autoPayable: true, cancellable: true });
    if (s.pending?.kind !== 'payCost') throw new Error('expected payCost');
    expect(s.pending.manaSources.map((m) => [m.abilityKey, m.produces])).toEqual([['r:basic:G', ['G']], ['r:basic:G', ['G']]]);
    // CR 601.2a: the spell is already on the stack while it is being paid for.
    expect(stackNames(s)).toEqual(['Grizzly Bears']);
  });

  it('auto-pay keeps flexible sources untapped: a dual land is saved when basic lands can pay', () => {
    let s = scenario(['Grizzly Bears', 'Forest', 'Mountain', 'Taiga'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Taiga', 'Forest', 'Mountain'] } });
    s = castAuto(s, 'Grizzly Bears');
    expect(tappedNames(s).sort()).toEqual(['Forest', 'Mountain']);
    expect(untappedNames(s)).toEqual(['Taiga']);
  });

  it('auto-pay taps lands before mana creatures, and an any-color source last', () => {
    let s = scenario(['Grizzly Bears', 'Forest', 'Llanowar Elves', 'Birds of Paradise'], {
      p1: { hand: ['Grizzly Bears'], battlefield: ['Birds of Paradise', 'Llanowar Elves', 'Forest', 'Forest'] },
    });
    s = castAuto(s, 'Grizzly Bears');
    expect(tappedNames(s)).toEqual(['Forest', 'Forest']);
    // With one Forest the second mana comes from the less flexible creature (Elves), not the five-color Birds.
    s = scenario(['Grizzly Bears', 'Forest', 'Llanowar Elves', 'Birds of Paradise'], {
      p1: { hand: ['Grizzly Bears'], battlefield: ['Birds of Paradise', 'Llanowar Elves', 'Forest'] },
    });
    s = castAuto(s, 'Grizzly Bears');
    expect(tappedNames(s).sort()).toEqual(['Forest', 'Llanowar Elves']);
    expect(untappedNames(s)).toEqual(['Birds of Paradise']);
  });

  it('auto-pay uses floating mana first', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Forest'] } });
    s = act(s, { type: 'activate', player: 'p1', source: findAll(s, 'Forest', 'battlefield')[0]!, ability: 'r:basic:G' });
    expect(pool(s, 'p1')).toBe('G');
    s = castAuto(s, 'Grizzly Bears');
    expect(tappedNames(s)).toEqual(['Forest', 'Forest']); // the pre-tapped one plus exactly one more
    expect(pool(s, 'p1')).toBe('');
  });

  it('colored requirements win over generic: {1}{G} with Mountain + Forest taps both, never fails on order', () => {
    let s = scenario(['Grizzly Bears', 'Forest', 'Mountain'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Mountain', 'Forest'] } });
    s = castAuto(s, 'Grizzly Bears');
    expect(tappedNames(s).sort()).toEqual(['Forest', 'Mountain']);
  });

  describe('hybrid and monohybrid (CR 107.4e)', () => {
    it('{G/W} is paid with either color', () => {
      let s = scenario(['Kitchen Finks', 'Forest', 'Plains', 'Mountain'], { p1: { hand: ['Kitchen Finks'], battlefield: ['Mountain', 'Forest', 'Plains'] } });
      s = castAuto(s, 'Kitchen Finks'); // {1}{G/W}{G/W}: Forest and Plains pay the hybrid symbols, Mountain the generic
      expect(tappedNames(s).sort()).toEqual(['Forest', 'Mountain', 'Plains']);
    });

    it('a hybrid cost cannot be paid with the wrong colors', () => {
      const s = scenario(['Kitchen Finks', 'Mountain'], { p1: { hand: ['Kitchen Finks'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
      const err = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Kitchen Finks', 'hand'), });
      expect(err.message).toMatch(/can't pay \{1\}\{G\/W\}\{G\/W\}/);
    });

    it('{2/W} is paid with W when possible: Reaper King with one land of each color', () => {
      let s = scenario(['Reaper King', 'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'], {
        p1: { hand: ['Reaper King'], battlefield: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] },
      });
      s = castAuto(s, 'Reaper King');
      expect(untappedNames(s)).toEqual([]);
      expect(stackNames(s)).toEqual(['Reaper King']);
    });

    it('{2/W} falls back to two generic mana: Reaper King (mana value 10) with ten Wastes', () => {
      let s = scenario(['Reaper King', 'Wastes'], { p1: { hand: ['Reaper King'], battlefield: Array(10).fill('Wastes') } });
      s = castAuto(s, 'Reaper King');
      expect(tappedNames(s)).toHaveLength(10);
    });

    it('monohybrid symbols mix: W, U, B colored plus four generic for {2/R}{2/G}', () => {
      let s = scenario(['Reaper King', 'Plains', 'Island', 'Swamp', 'Wastes'], {
        p1: { hand: ['Reaper King'], battlefield: ['Plains', 'Island', 'Swamp', ...Array(4).fill('Wastes')] },
      });
      s = castAuto(s, 'Reaper King');
      expect(tappedNames(s)).toHaveLength(7);
    });

    it('nine lands cannot pay Reaper King\'s ten-mana cost with only colorless', () => {
      const s = scenario(['Reaper King', 'Wastes'], { p1: { hand: ['Reaper King'], battlefield: Array(9).fill('Wastes') } });
      reject(s, { type: 'cast', player: 'p1', card: find(s, 'Reaper King', 'hand') });
    });
  });

  describe('Phyrexian mana (CR 107.4f, 119.4)', () => {
    it('auto-pay pays with mana when it can: Porcelain Legionnaire {2}{W/P} with Plains + two Mountains costs no life', () => {
      let s = scenario(['Porcelain Legionnaire', 'Plains', 'Mountain'], { p1: { hand: ['Porcelain Legionnaire'], battlefield: ['Plains', 'Mountain', 'Mountain'] } });
      s = castAuto(s, 'Porcelain Legionnaire');
      expect(tappedNames(s)).toHaveLength(3);
      expect(life(s, 'p1')).toBe(20);
    });

    it('auto-pay pays 2 life only when mana cannot pay the symbol', () => {
      let s = scenario(['Porcelain Legionnaire', 'Mountain'], { p1: { hand: ['Porcelain Legionnaire'], battlefield: ['Mountain', 'Mountain'] } });
      s = castAuto(s, 'Porcelain Legionnaire');
      expect(tappedNames(s)).toEqual(['Mountain', 'Mountain']);
      expect(life(s, 'p1')).toBe(18);
      expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.lifePaid).toBe(2);
    });

    it('with too few lands it is life for the Phyrexian symbol and mana for the rest: Plains + Mountain pays {2} and 2 life', () => {
      let s = scenario(['Porcelain Legionnaire', 'Plains', 'Mountain'], { p1: { hand: ['Porcelain Legionnaire'], battlefield: ['Plains', 'Mountain'] } });
      s = castAuto(s, 'Porcelain Legionnaire');
      expect(life(s, 'p1')).toBe(18);
      expect(untappedNames(s)).toEqual([]);
    });

    it('a free Phyrexian spell: Gitaxian Probe costs 2 life with no lands', () => {
      let s = scenario(['Gitaxian Probe'], { p1: { hand: ['Gitaxian Probe'] } });
      // W3b: "Look at target player's hand." is understood, so the target is announced before the cost is paid (CR 601.2c, 601.2g)
      s = castAuto(s, 'Gitaxian Probe', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }] });
      expect(life(s, 'p1')).toBe(18);
      expect(stackNames(s)).toEqual(['Gitaxian Probe']);
    });

    it('Dismember {1}{B/P}{B/P} with one Swamp: the Swamp pays {1} and both Phyrexian symbols cost 4 life', () => {
      let s = scenario(['Dismember', 'Swamp'], { p1: { hand: ['Dismember'], battlefield: ['Swamp'] }, manual: ['Dismember'] }); // WP18: its target is not the subject here
      s = castAuto(s, 'Dismember');
      expect(life(s, 'p1')).toBe(16);
    });

    it('CR 119.4: a player can pay life only if their life total is at least the payment', () => {
      const s = scenario(['Dismember', 'Swamp'], { p1: { hand: ['Dismember'], battlefield: ['Swamp'] }, life: 3, manual: ['Dismember'] });
      const err = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Dismember', 'hand') });
      expect(err.message).toMatch(/can't pay/);
    });

    it('CR 119.4: exactly enough life is enough (paying to 0 is allowed; the game then ends by SBA)', () => {
      let s = scenario(['Gitaxian Probe'], { p1: { hand: ['Gitaxian Probe'] }, life: 2 });
      s = castAuto(s, 'Gitaxian Probe', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }] }); // W3b: target announced (CR 601.2c)
      expect(s.result?.winner).toBe('p2'); // CR 704.5a
    });

    it('manual payment chooses which symbols are paid with life', () => {
      let s = scenario(['Porcelain Legionnaire', 'Plains'], { p1: { hand: ['Porcelain Legionnaire'], battlefield: ['Plains', 'Plains', 'Plains'] } });
      const [a, b] = findAll(s, 'Plains', 'battlefield');
      s = cast(s, 'Porcelain Legionnaire');
      s = answer(s, {
        kind: 'payCost', auto: false, lifeForPhyrexian: [1],
        activations: [{ objectId: a!, abilityKey: 'r:basic:W' }, { objectId: b!, abilityKey: 'r:basic:W' }],
      });
      expect(life(s, 'p1')).toBe(18);
      expect(tappedNames(s)).toEqual(['Plains', 'Plains']);
    });

    it('manual payment cannot use life for a symbol that is not Phyrexian', () => {
      let s = scenario(['Porcelain Legionnaire', 'Plains'], { p1: { hand: ['Porcelain Legionnaire'], battlefield: ['Plains', 'Plains', 'Plains'] } });
      s = cast(s, 'Porcelain Legionnaire');
      const before = s;
      const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'payCost', auto: false, lifeForPhyrexian: [0], activations: [] } });
      expect(err.rules).toContain('CR 107.4f');
      expect(s).toBe(before);
    });
  });

  describe('colorless {C}, X and snow {S}', () => {
    it('CR 107.4c: {C} needs colorless mana: Thought-Knot Seer {3}{C} with Wastes + three Forests', () => {
      let s = scenario(['Thought-Knot Seer', 'Wastes', 'Forest'], { p1: { hand: ['Thought-Knot Seer'], battlefield: ['Forest', 'Forest', 'Forest', 'Wastes'] } });
      s = castAuto(s, 'Thought-Knot Seer');
      expect(untappedNames(s)).toEqual([]);
    });

    it('CR 107.4c: four Forests cannot pay {C}', () => {
      const s = scenario(['Thought-Knot Seer', 'Forest'], { p1: { hand: ['Thought-Knot Seer'], battlefield: Array(4).fill('Forest') } });
      reject(s, { type: 'cast', player: 'p1', card: find(s, 'Thought-Knot Seer', 'hand') });
    });

    it('Sol Ring pays {C} and one generic with a single activation', () => {
      let s = scenario(['Thought-Knot Seer', 'Sol Ring', 'Forest'], { p1: { hand: ['Thought-Knot Seer'], battlefield: ['Sol Ring', 'Forest', 'Forest'] } });
      s = castAuto(s, 'Thought-Knot Seer');
      expect(tappedNames(s).sort()).toEqual(['Forest', 'Forest', 'Sol Ring']);
    });

    it('CR 107.3, 601.2b: X is chosen when casting (0 up to what the player can pay) and counts as generic mana', () => {
      let s = scenario(['Endless One', 'Forest'], { p1: { hand: ['Endless One'], battlefield: ['Forest', 'Forest', 'Forest'] } });
      s = cast(s, 'Endless One');
      expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 3, cancellable: true });
      s = answer(s, { kind: 'chooseNumber', n: 2 });
      expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{2}' });
      s = payAuto(s);
      expect(tappedNames(s)).toEqual(['Forest', 'Forest']);
      const spell = s.objects[s.zones.stack[0]!]!;
      expect(spell.stack!.x).toBe(2);
    });

    it('CR 202.3e: the mana value of a spell on the stack counts X', async () => {
      const { getChars } = await import('../../src/index');
      let s = scenario(['Endless One', 'Forest'], { p1: { hand: ['Endless One'], battlefield: ['Forest', 'Forest', 'Forest'] } });
      s = cast(s, 'Endless One');
      s = answer(s, { kind: 'chooseNumber', n: 3 });
      s = payAuto(s);
      expect(getChars(s, s.zones.stack[0]!).manaValue).toBe(3);
    });

    it('X larger than the player can pay is not a legal answer', () => {
      let s = scenario(['Endless One', 'Forest'], { p1: { hand: ['Endless One'], battlefield: ['Forest', 'Forest'] } });
      s = cast(s, 'Endless One');
      reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseNumber', n: 3 } });
    });

    it('CR 107.3: with no mana available X is 0 and nothing needs to be paid', () => {
      let s = scenario(['Endless One'], { p1: { hand: ['Endless One'] } });
      s = cast(s, 'Endless One');
      expect(s.pending!.kind).toBe('priority');
      expect(stackNames(s)).toEqual(['Endless One']);
      expect(s.objects[s.zones.stack[0]!]!.stack!.x).toBe(0);
    });

    it('CR 107.4h: {S} needs mana from a snow source', () => {
      let s = scenario(['Icehide Golem', 'Snow-Covered Forest'], { p1: { hand: ['Icehide Golem'], battlefield: ['Snow-Covered Forest'] } });
      s = castAuto(s, 'Icehide Golem');
      expect(tappedNames(s)).toEqual(['Snow-Covered Forest']);
      const plain = scenario(['Icehide Golem', 'Forest'], { p1: { hand: ['Icehide Golem'], battlefield: ['Forest'] } });
      reject(plain, { type: 'cast', player: 'p1', card: find(plain, 'Icehide Golem', 'hand') });
    });

    it('CR 107.4h: floating snow mana also pays {S}, ordinary floating mana does not', () => {
      let s = scenario(['Icehide Golem', 'Snow-Covered Forest', 'Forest'], { p1: { hand: ['Icehide Golem'], battlefield: ['Snow-Covered Forest', 'Forest'] } });
      s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Snow-Covered Forest', 'battlefield'), ability: 'r:basic:G' });
      s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Forest', 'battlefield'), ability: 'r:basic:G' });
      s = castAuto(s, 'Icehide Golem');
      expect(pool(s, 'p1')).toBe('G'); // the non-snow G is left over
      expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent![0]!.snow).toBe(true);
    });
  });

  describe('manual payment', () => {
    it('the player lists the mana abilities to use; unused lands stay untapped', () => {
      let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Forest'] } });
      const [a, , c] = findAll(s, 'Forest', 'battlefield');
      s = cast(s, 'Grizzly Bears');
      s = answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: a!, abilityKey: 'r:basic:G' }, { objectId: c!, abilityKey: 'r:basic:G' }] });
      expect(isTapped(s, a!)).toBe(true);
      expect(isTapped(s, c!)).toBe(true);
      expect(untappedNames(s)).toEqual(['Forest']);
    });

    it('extra mana produced stays in the pool until the end of the step', () => {
      let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Forest'] } });
      const ids = findAll(s, 'Forest', 'battlefield');
      s = cast(s, 'Grizzly Bears');
      s = answer(s, { kind: 'payCost', auto: false, activations: ids.map((objectId) => ({ objectId, abilityKey: 'r:basic:G' })) });
      expect(pool(s, 'p1')).toBe('G');
    });

    it('a choice of mana type is given with the activation', () => {
      let s = scenario(['Grizzly Bears', 'Birds of Paradise', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Birds of Paradise', 'Forest'] } });
      s = cast(s, 'Grizzly Bears');
      s = answer(s, {
        kind: 'payCost', auto: false,
        activations: [{ objectId: find(s, 'Birds of Paradise', 'battlefield'), abilityKey: 'p:0:1', color: 'G' }, { objectId: find(s, 'Forest', 'battlefield'), abilityKey: 'r:basic:G' }],
      });
      expect(stackNames(s)).toEqual(['Grizzly Bears']);
    });

    it('insufficient mana is rejected with an explanation, the decision stays open and the player can cancel', () => {
      let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
      s = cast(s, 'Grizzly Bears');
      const pending = s.pending!;
      const err = reject(s, { type: 'answer', player: 'p1', decisionId: pending.id, answer: { kind: 'payCost', auto: false, activations: [{ objectId: find(s, 'Forest', 'battlefield'), abilityKey: 'r:basic:G' }] } });
      expect(err.message).toMatch(/doesn't pay \{1\}\{G\}/);
      expect(s.pending).toBe(pending);
      s = act(s, { type: 'cancel', player: 'p1' });
      expect(s.zones.stack).toEqual([]);
    });

    it('a mana ability that cannot be activated (tapped land) is rejected', () => {
      let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: [{ name: 'Forest', tapped: true }, 'Forest', 'Forest'] } });
      s = cast(s, 'Grizzly Bears');
      const [t] = findAll(s, 'Forest', 'battlefield');
      const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'payCost', auto: false, activations: [{ objectId: t!, abilityKey: 'r:basic:G' }] } });
      expect(err.message).toMatch(/already tapped/);
    });

  });

  describe('cancel (CR 733.1)', () => {
    const strip = (s: GameState) => ({ ...s, log: [], actionCount: 0, counters: { ...s.counters, log: 0 }, pending: null, suspended: null });

    it('cancelling during payment restores the exact previous state: card back in hand, lands untapped, nothing on the stack', () => {
      const s0 = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
      let s = cast(s0, 'Grizzly Bears');
      expect(s.pending!.kind).toBe('payCost');
      s = act(s, { type: 'cancel', player: 'p1' });
      expect(strip(s)).toEqual(strip(s0));
      expect(s.pending).toEqual(s0.pending);
      expect(s.log[s.log.length - 1]!.rules).toEqual(['CR 733.1']);
    });

    it('cancelling after manual mana was produced inside the payment also restores the lands and the pool', () => {
      const s0 = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
      let s = cast(s0, 'Grizzly Bears');
      // A failed manual answer changes nothing, then cancel.
      reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'payCost', auto: false, activations: [{ objectId: find(s, 'Forest', 'battlefield'), abilityKey: 'r:basic:G' }] } });
      s = act(s, { type: 'cancel', player: 'p1' });
      expect(strip(s)).toEqual(strip(s0));
    });

    it('cancelling the X choice or the target choice also reverses the cast', () => {
      const s0 = scenario(['Endless One', 'Forest'], { p1: { hand: ['Endless One'], battlefield: ['Forest', 'Forest'] } });
      let s = cast(s0, 'Endless One');
      expect(s.pending!.kind).toBe('chooseNumber');
      s = act(s, { type: 'cancel', player: 'p1' });
      expect(strip(s)).toEqual(strip(s0));
    });

    it('only the deciding player can cancel', () => {
      let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
      s = cast(s, 'Grizzly Bears');
      reject(s, { type: 'cancel', player: 'p2' });
    });
  });
});

describe('hidden information while casting (CR 400.2, 733.1)', () => {
  it('until the cast is settled the opponent sees the state it started from (a cancelled cast reveals nothing); then the spell on the stack', async () => {
    const { viewFor, HIDDEN_DEF } = await import('../../src/index');
    let s = scenario(['Grizzly Bears', 'Hill Giant', 'Forest'], { p1: { hand: ['Grizzly Bears', 'Hill Giant'], battlefield: ['Forest', 'Forest'] } });
    s = cast(s, 'Grizzly Bears');
    const v = viewFor(s, 'p2');
    expect(v.zones.stack).toEqual([]); // the card is still in p1's hand as far as p2 can tell
    expect(v.zones.hand.p1).toHaveLength(2); // m4: under the view's aliases
    expect(v.zones.hand.p1!.every((id) => v.objects[id]?.defId === HIDDEN_DEF)).toBe(true);
    expect(v.pending!.kind).toBe('priority'); // p1's payCost details are not shown to p2
    expect(v.midAction).toBe(true);
    const mine = viewFor(s, 'p1');
    expect(mine.pending!.kind).toBe('payCost');
    expect(mine.objects[s.zones.stack[0]!]!.defId).toBe('Grizzly Bears');
    expect(JSON.stringify(v)).not.toContain('Hill Giant');
    expect(JSON.stringify(v)).not.toContain('Grizzly Bears');
    s = answer(s, { kind: 'payCost', auto: true });
    const settled = viewFor(s, 'p2');
    expect(settled.objects[s.zones.stack[0]!]!.defId).toBe('Grizzly Bears');
    expect(settled.midAction).toBe(false);
  });
});
