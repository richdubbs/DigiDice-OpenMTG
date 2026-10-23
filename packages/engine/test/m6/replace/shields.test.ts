/**
 * M6-1: shields of every body (m6 design 3.2, "Shields"; CR 614.1, 615.7-615.8, 611.2c): a "the next time" or "this turn" replacement effect made by a resolved
 * spell or ability, with a `modify`, `enters`, `instead` or `skip` body (`feature:shield.<b>`); its subject fixed when it was made; its "you" the effect's
 * controller; used up after its uses.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type GameState, type ReplacementDef } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import { destroy } from '../../../src/rules/destroy';
import { find, inGraveyard, scenario } from '../../m5/helpers';
import { cast, resolveTop, target } from '../../m5/cr-examples/helpers';
import { getCard } from '../../fixtures';
import { run, shieldRecord } from './support';

const exiled = (s: GameState, name: string): boolean => s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('feature:shield.modify: Magma Spray (M6 form, M5 14.2)', () => {
  it('Magma Spray (game path) is full; the creature dealt 2 damage dies and is exiled instead (CR 614.1a, 611.2c)', () => {
    expect(compileCard(getCard('Magma Spray')).automation.level).toBe('full');
    let s = scenario(['Magma Spray', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Magma Spray'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(cast(s, 'Magma Spray', [target(bears)]));
    expect(exiled(s, 'Grizzly Bears')).toBe(true);
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(false);
  });

  it('CR 611.2c, 400.7: the shield follows the creature only while it is the same object; another creature dies normally, and the shield is used once', () => {
    const s = scenario(['Grizzly Bears', 'Hill Giant'], { p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const t = structuredClone(s);
    t.continuousEffects.push(shieldRecord('e50', {
      s: 'replace', replaces: { ev: 'zoneChange', subject: { is: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] } }, from: 'battlefield', to: 'graveyard' },
      body: { b: 'modify', destination: { zone: 'exile' } }, shield: { uses: 1 },
    }));
    const r = run(t, (g) => [destroy(g, giant), destroy(g, bears)]);
    expect(inGraveyard(r.g.s, 'Hill Giant', 'p2')).toBe(true);
    expect(exiled(r.g.s, 'Grizzly Bears')).toBe(true);
    expect(r.g.s.continuousEffects).toHaveLength(0);
  });
});

describe('feature:shield.enters, feature:shield.instead', () => {
  it('feature:shield.enters (Gather Specimens): "this turn, if a creature would enter under an opponent\'s control, it enters under your control instead" — "you" is the shield\'s controller', () => {
    const s = scenario(['Grizzly Bears'], { p2: { graveyard: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'graveyard');
    const t = structuredClone(s);
    const gather: ReplacementDef = { s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, to: 'battlefield' }, body: { b: 'enters', under: { ref: 'you' } }, shield: { uses: 'all' } };
    t.continuousEffects.push(shieldRecord('e51', gather, { controller: 'p1' }));
    const r = run(t, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: bears, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: {} }));
    expect(r.g.s.objects[r.result!.newIds[0]!]!.controller).toBe('p1');
    expect(r.g.s.continuousEffects).toHaveLength(1); // uses: 'all' (this turn)
  });

  it('feature:shield.instead: "the next time you would draw a card this turn, you gain 2 life instead"', () => {
    const s = scenario([]);
    const t = structuredClone(s);
    t.continuousEffects.push(shieldRecord('e52', { s: 'replace', replaces: { ev: 'draw', player: 'you' }, body: { b: 'instead', do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }] }, shield: { uses: 1 } }));
    const hand = t.zones.hand.p1!.length;
    const r = run(t, (g) => [proposeResult(g, { ev: 'draw', player: 'p1' }), proposeResult(g, { ev: 'draw', player: 'p1' })]);
    expect(r.g.s.players[0]!.life).toBe(22);
    expect(r.g.s.zones.hand.p1!.length).toBe(hand + 1); // the second draw happens
  });
});
