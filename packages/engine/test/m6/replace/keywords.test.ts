/**
 * M6-1: keyword data that uses the replacement loop (m6 design 3.2, "Keyword data that uses the loop"): dredge (CR 702.52) and unearth (CR 702.84), on the real
 * fixture cards Golgari Thug and Dregscape Zombie, compiled by the default compiler (the game path).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type GameState } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import { answer, find, pass, scenario } from '../../m5/helpers';
import { activate, cast, resolveTop, target } from '../../m5/cr-examples/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { destroy } from '../../../src/rules/destroy';
import { getCard } from '../../fixtures';
import { REST_IN_PEACE, run } from './support';

const graveyardNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);

describe('CR 702.52: dredge', () => {
  it('keyword:dredge is a capability, and Golgari Thug (game path) is full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:dredge')).toBe(true);
    expect(compileCard(getCard('Golgari Thug')).automation.level).toBe('full');
  });

  it('CR 702.52a: instead of drawing, its owner may mill 4 cards and return Golgari Thug from the graveyard to the hand', () => {
    const s = scenario(['Golgari Thug'], { p1: { graveyard: ['Golgari Thug'] } });
    const lib = s.zones.library.p1!.length;
    const hand = s.zones.hand.p1!.length;
    const ask = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    expect(ask.need?.kind).toBe('yesNo');
    expect(ask.need!.player).toBe('p1');
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }), [{ kind: 'yesNo', yes: true }]);
    expect(r.g.s.zones.library.p1!.length).toBe(lib - 4);
    expect(r.g.s.zones.hand.p1!.length).toBe(hand + 1);
    expect(r.g.s.zones.hand.p1!.some((id) => r.g.s.defs[r.g.s.objects[id]!.defId]!.name === 'Golgari Thug')).toBe(true);
    expect(graveyardNames(r.g.s, 'p1')).not.toContain('Golgari Thug');
    // declining: the draw happens
    const no = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }), [{ kind: 'yesNo', yes: false }]);
    expect(no.g.s.zones.hand.p1!.length).toBe(hand + 1);
    expect(graveyardNames(no.g.s, 'p1')).toContain('Golgari Thug');
  });

  it('CR 702.52a, 614.5: with Rest in Peace, the four cards dredge mills are exiled (the mill is a new event: Rest in Peace has not been used on it)', () => {
    const s = scenario(['Golgari Thug'], { p1: { graveyard: ['Golgari Thug'] }, p2: { battlefield: ['Rest in Peace'] }, defs: [REST_IN_PEACE] });
    const exile = s.zones.exile.length;
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }), [{ kind: 'yesNo', yes: true }]);
    expect(r.g.s.zones.exile.length).toBe(exile + 4);
    expect(graveyardNames(r.g.s, 'p1')).toEqual([]);
  });

  it('CR 702.52b: with fewer cards in the library than its dredge number, it can\'t be dredged (no question; the draw happens)', () => {
    const s0 = scenario(['Golgari Thug'], { p1: { graveyard: ['Golgari Thug'] } });
    const s = structuredClone(s0);
    s.zones.library.p1 = s.zones.library.p1!.slice(0, 3);
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    expect(r.need).toBeUndefined();
    expect(r.g.s.zones.library.p1!.length).toBe(2);
  });

  it('CR 702.52a, 113.6: dredge functions only in the graveyard (a Golgari Thug on the battlefield replaces nothing)', () => {
    const s = scenario(['Golgari Thug'], { p1: { battlefield: ['Golgari Thug'] } });
    expect(run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' })).need).toBeUndefined();
  });
});

describe('CR 702.84: unearth', () => {
  it('keyword:unearth is a capability, and Dregscape Zombie (game path) is full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:unearth')).toBe(true);
    expect(compileCard(getCard('Dregscape Zombie')).automation.level).toBe('full');
  });

  /** Activate unearth from the graveyard ({B}, as a sorcery) and let it resolve. */
  function unearth(s0: GameState): { s: GameState; zombie: string } {
    const s = resolveTop(activate(s0, find(s0, 'Dregscape Zombie', 'graveyard')));
    return { s, zombie: find(s, 'Dregscape Zombie', 'battlefield') };
  }
  const exiled = (s: GameState): boolean => s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Dregscape Zombie');

  it('CR 702.84a: returned to the battlefield with haste; if it would leave the battlefield, it is exiled instead', () => {
    const s0 = scenario(['Dregscape Zombie', 'Swamp'], { p1: { graveyard: ['Dregscape Zombie'], battlefield: ['Swamp'] } });
    const { s, zombie } = unearth(s0);
    expect(getChars(s, zombie).abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === 'haste')).toBe(true); // CR 702.10
    const killed = run(s, (g) => destroy(g, zombie));
    expect(exiled(killed.g.s)).toBe(true);
    expect(graveyardNames(killed.g.s, 'p1')).not.toContain('Dregscape Zombie');
  });

  it('CR 702.84a, 603.7: it is exiled at the beginning of the next end step', () => {
    const s0 = scenario(['Dregscape Zombie', 'Swamp'], { p1: { graveyard: ['Dregscape Zombie'], battlefield: ['Swamp'] } });
    let { s } = unearth(s0);
    for (let i = 0; i < 60 && !exiled(s); i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    expect(exiled(s)).toBe(true);
    expect(s.turn.number).toBe(1);
    expect(s.turn.step).toBe('end');
  });

  it('CR 702.84a, 113.6: unearth is activated only from the graveyard and only as a sorcery', () => {
    const s0 = scenario(['Dregscape Zombie', 'Swamp'], { p1: { hand: ['Dregscape Zombie'], battlefield: ['Swamp'] } });
    expect(() => activate(s0, find(s0, 'Dregscape Zombie', 'hand'))).toThrow(/no activation/);
  });
});

describe('CR 702.88: rebound', () => {
  it('keyword:rebound is a capability, and Ephemerate (game path) is full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:rebound')).toBe(true);
    expect(compileCard(getCard('Ephemerate')).automation.level).toBe('full');
  });

  const where = (s: GameState): string | undefined => {
    for (const id of Object.keys(s.objects)) if (s.defs[s.objects[id]!.defId]!.name === 'Ephemerate') return s.objects[id]!.zone;
    return undefined;
  };

  it('CR 702.88a: cast from the hand, Ephemerate is exiled as it resolves; at its controller\'s next upkeep it may be cast from exile for free, and then goes to the graveyard', () => {
    let s = scenario(['Ephemerate', 'Plains', 'Grizzly Bears'], { p1: { hand: ['Ephemerate'], battlefield: ['Plains', 'Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(cast(s, 'Ephemerate', [target(bears)]));
    expect(where(s)).toBe('exile');
    let castAgain = false;
    for (let i = 0; i < 120 && !(castAgain && where(s) === 'graveyard'); i++) {
      const d = s.pending!;
      if (d.kind === 'yesNo') {
        castAgain = true;
        expect(d.player).toBe('p1');
        expect(s.turn.number).toBe(3);
        expect(s.turn.step).toBe('upkeep');
        s = answer(s, { kind: 'yesNo', yes: true });
      } else if (d.kind === 'chooseTargets') s = answer(s, target(find(s, 'Grizzly Bears', 'battlefield')));
      else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else s = pass(s);
    }
    expect(castAgain).toBe(true);
    expect(where(s)).toBe('graveyard'); // cast from exile this time: no rebound (CR 702.88a "from your hand")
  });

  it('CR 702.88a: a rebound spell that is countered (or does not resolve) is not exiled by rebound', () => {
    let s = scenario(['Ephemerate', 'Plains', 'Grizzly Bears'], { p1: { hand: ['Ephemerate'], battlefield: ['Plains', 'Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = cast(s, 'Ephemerate', [target(bears)]);
    const spell = s.zones.stack[0]!;
    const r = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: spell, zone: 'stack' }, from: 'stack', to: 'graveyard', destination: { cause: 'counter' } }));
    expect(r.g.s.zones.graveyard.p1!.some((id) => r.g.s.defs[r.g.s.objects[id]!.defId]!.name === 'Ephemerate')).toBe(true);
  });
});
