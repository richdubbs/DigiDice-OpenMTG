/**
 * W3b: where an activated ability functions (CR 113.6j, 113.6m). A cost that moves the card itself out of the hand or the graveyard ("Discard ~",
 * "Exile ~ from your graveyard") can be paid only there, and an effect that moves ~ out of a zone ("Return ~ from your graveyard ...") functions only
 * there. The lowering states that zone (`ActivatedAbilityDef.zone`, parser/lower/activation.ts#activationZone), the engine offers the ability only from
 * it (rules/abilities.ts#activationZones), and a zone that cannot be stated is manual. `activatedForms` fails closed for a definition from any source
 * whose cost needs the source somewhere the ability does not function (model/forms.ts, `feature:activate.selfCostZone`).
 * Synthetic wordings (design 6.10) except where a real card's own text is the subject; those read the local index and are skipped without it.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, compileCard, markUnsanctioned, type ActivatedAbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { activatedForms, selfCostZones } from '../../../src/model/forms';
import { activationZone } from '../../../src/parser/lower/activation';
import { act, answer, find, legal, passBoth, reject, scenario, zoneNames } from '../../m3/scenario';
import { localIndex } from '../parser/support';
import { abilities, card, compile, creature } from './helpers';

const index = localIndex();
const real = (name: string): OracleCard | undefined => index?.find((c) => c.name === name);

/** The keys of the abilities p1 may activate on this object now. */
const offered = (s: GameState, id: ObjectId): string[] => legal(s, 'p1', 'activate').filter((a) => a.object === id).map((a) => (a.action as { ability: string }).ability);
const activatedOf = (def: CardDef): ActivatedAbilityDef[] => abilities(def).filter((a): a is ActivatedAbilityDef => a.kind === 'activated');

describe('CR 113.6j, 113.6m: the lowering states where an activated ability functions', () => {
  it('CR 113.6j, 701.9a: "Discard this card" can be paid only from the hand, so the ability functions there', () => {
    const def = compileCard(creature('{1}{U}, Discard this card: Draw a card.'));
    expect(activatedOf(def)[0]).toMatchObject({ kind: 'activated', zone: ['hand'], cost: { other: [{ kind: 'discard', self: true }] } });
    expect(def.automation.level).toBe('full');
  });

  it('CR 113.6j: "Exile this card from your graveyard" functions in the graveyard', () => {
    const def = compileCard(creature('{2}, Exile this card from your graveyard: You gain 2 life.'));
    expect(activatedOf(def)[0]).toMatchObject({ zone: ['graveyard'], cost: { other: [{ kind: 'exileFrom', zone: 'graveyard', self: true }] } });
    expect(def.automation.level).toBe('full');
  });

  it('CR 113.6j: "Exile this card from your hand" and "Reveal this card from your hand" function in the hand', () => {
    expect(activatedOf(compileCard(creature('{1}, Exile this card from your hand: You gain 2 life.')))[0]).toMatchObject({ zone: ['hand'] });
    const reveal = abilities(compileCard(creature('{1}, Reveal this card from your hand: You gain 2 life.')))[0]!;
    expect(reveal).toMatchObject({ zone: ['hand'] }); // automated or not, it functions in the hand
  });

  it('CR 113.6: a cost that only involves the permanent ("{T}", "Sacrifice this creature") keeps the default, the battlefield', () => {
    for (const text of ['{T}: You gain 1 life.', '{1}, Sacrifice this creature: You gain 2 life.', '{2}: You gain 1 life.']) {
      const a = activatedOf(compileCard(creature(text)))[0]!;
      expect(a.zone, text).toBeUndefined();
    }
  });

  it('CR 113.6m: an effect that moves the card out of the graveyard functions only there (Reassembling Skeleton\'s wording)', () => {
    const a = abilities(compileCard(creature('{1}{B}: Return this card from your graveyard to the battlefield tapped.')))[0]!;
    expect(a).toMatchObject({ zone: ['graveyard'] });
  });

  it('CR 113.6j: a cost that needs the card in two zones at once ("{T}, Discard this card") can never be paid: manual, never full', () => {
    const def = compileCard(creature('{T}, Discard this card: Draw a card.'));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', shape: 'activated' });
    expect((abilities(def)[0] as { reason: string }).reason).toMatch(/two zones at once.*CR 113\.6j/);
    expect(def.automation.level).not.toBe('full');
  });

  it('activationZone: the cost and the effect, the CR 113.6m exception, and the zones the engine offers activations from', () => {
    const discard = { other: [{ kind: 'discard' as const, count: 1, self: true }] };
    const yard = { other: [{ kind: 'exileFrom' as const, zone: 'graveyard' as const, count: 1, self: true }] };
    const sac = { other: [{ kind: 'sacrifice' as const, filter: { self: true }, count: 1, self: true }] };
    expect(activationZone(discard, 'draw a card.')).toEqual({ zone: ['hand'] });
    expect(activationZone(yard, 'create a treasure token.')).toEqual({ zone: ['graveyard'] });
    expect(activationZone({ mana: [] }, 'return ~ from your graveyard to your hand.')).toEqual({ zone: ['graveyard'] });
    expect(activationZone({ tap: true }, 'you gain 1 life.')).toEqual({});
    // CR 113.6m: "unless ... a previous part of its cost ... specifies that the object is put into that zone"
    expect(activationZone(sac, 'return ~ from your graveyard to the battlefield at the beginning of the next end step.')).toEqual({});
    expect(activationZone(discard, 'return ~ from your graveyard to your hand at the beginning of the next end step.')).toEqual({ zone: ['hand'] });
    // a quoted ability functions on the object that gets it (CR 113.6, 113.1c)
    expect(activationZone({}, 'target creature gains "{1}: return ~ from your graveyard to your hand." until end of turn.')).toEqual({});
    // conflicts and zones with no activation are manual
    expect(activationZone({ tap: true }, 'return ~ from your graveyard to your hand.')).toMatchObject({ manual: expect.stringMatching(/CR 113\.6j, 113\.6m/) });
    expect(activationZone(yard, 'activate only if ~ is in your hand.')).toMatchObject({ manual: expect.any(String) });
    expect(activationZone({ ...discard, tap: true }, 'draw a card.')).toMatchObject({ manual: expect.stringMatching(/two zones/) });
    expect(activationZone({}, 'return ~ from exile to your hand.')).toMatchObject({ manual: expect.stringMatching(/only in the exile/) });
    // an unparsed cost part that moves ~ still names its zone
    expect(activationZone({ other: [{ kind: 'manual', text: 'exile ~ from your graveyard along with another card' }] }, 'draw a card.')).toEqual({ zone: ['graveyard'] });
  });
});

describe('CR 113.6j: a definition whose cost needs its source where the ability does not function is never automated (any source)', () => {
  const base = { kind: 'activated' as const, text: 'x', effect: { targets: [], steps: [{ op: 'draw' as const, who: { ref: 'you' as const }, count: 1 }] } };

  it('selfCostZones reads the parts that act on the source itself', () => {
    expect(selfCostZones({ tap: true })).toEqual(['battlefield']);
    expect(selfCostZones({ other: [{ kind: 'discard', count: 1, self: true }] })).toEqual(['hand']);
    expect(selfCostZones({ other: [{ kind: 'reveal', zone: 'hand', count: 1, self: true }] })).toEqual(['hand']);
    expect(selfCostZones({ other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }, { kind: 'payLife', amount: 2 }] })).toEqual(['graveyard']);
    expect(selfCostZones({ other: [{ kind: 'discard', count: 1 }, { kind: 'exileFrom', zone: 'graveyard', count: 1 }] })).toEqual([]); // other cards
    expect(selfCostZones({ untap: true, other: [{ kind: 'discard', count: 1, self: true }] })).toEqual(['battlefield', 'hand']);
  });

  it('activatedForms: "Discard ~" with no zone (the bug) needs feature:activate.selfCostZone, which no table advertises; with zone hand it does not', () => {
    const cost = { other: [{ kind: 'discard' as const, count: 1, self: true }] };
    expect(activatedForms({ ...base, cost })).toContain('feature:activate.selfCostZone');
    expect(activatedForms({ ...base, cost, zone: ['hand'] })).not.toContain('feature:activate.selfCostZone');
    expect(activatedForms({ ...base, cost: { tap: true, ...cost }, zone: ['hand'] })).toContain('feature:activate.selfCostZone');
    expect(activatedForms({ ...base, cost: { tap: true } })).not.toContain('feature:activate.selfCostZone');
    expect(ENGINE_CAPABILITIES.has('feature:activate.selfCostZone')).toBe(false);
  });

  it('CR 113.6j: such a definition is not offered from any zone, and the engine says why (fail closed at run time)', () => {
    const def = compileCard(card('{U}, Discard this card: Draw a card.', { name: 'Test Lost Channel', type_line: 'Artifact', mana_cost: '{1}' }));
    const broken: CardDef = { ...def, faces: def.faces.map((f) => ({ ...f, abilities: f.abilities.map((a) => (a.kind === 'activated' ? (({ zone: _z, ...rest }) => rest)(a) : a)) })) };
    expect(activatedOf(broken)[0]!.zone).toBeUndefined();
    let s = scenario(['Island'], { p1: { hand: ['Test Lost Channel'], battlefield: ['Island'] }, defs: [broken] });
    const inHand = find(s, 'Test Lost Channel', 'hand');
    expect(offered(s, inHand)).toEqual([]);
    expect(reject(s, { type: 'activate', player: 'p1', source: inHand, ability: 'p:0:0' }).rules).toContain('CR 113.6');
    s = scenario(['Island'], { p1: { battlefield: ['Test Lost Channel', 'Island'] }, defs: [broken] });
    const onField = find(s, 'Test Lost Channel', 'battlefield');
    expect(offered(s, onField)).toEqual([]);
    expect(reject(s, { type: 'activate', player: 'p1', source: onField, ability: 'p:0:0' }).message).toMatch(/feature:activate\.selfCostZone/);
  });
});

describe('CR 113.6j, 113.6m: abilities that function outside the battlefield are offered there and played through applyAction', () => {
  it('CR 113.6j, 701.9a: a synthetic channel card is activated from the hand: discarded as a cost, draws on resolution; not offered from the battlefield', () => {
    const def = compileCard(card('{U}, Discard this card: Draw a card.', { name: 'Test Channeler', type_line: 'Artifact', mana_cost: '{1}' }));
    let s = scenario(['Island'], { p1: { hand: ['Test Channeler'], battlefield: ['Island'] }, defs: [def] });
    const id = find(s, 'Test Channeler', 'hand');
    expect(offered(s, id)).toEqual(['p:0:0']);
    const handBefore = s.zones.hand.p1!.length;
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Channeler']); // CR 602.2b, 601.2h: paid before it resolves
    s = passBoth(s);
    expect(s.zones.stack).toEqual([]);
    expect(s.zones.hand.p1!.length).toBe(handBefore); // one card discarded, one drawn
    const onField = scenario(['Island'], { p1: { battlefield: ['Test Channeler', 'Island'] }, defs: [def] });
    expect(offered(onField, find(onField, 'Test Channeler', 'battlefield'))).toEqual([]);
  });

  it('CR 113.6j: a synthetic card exiles itself from the graveyard as a cost; not offered from the hand or the battlefield', () => {
    const def = compileCard(creature('{1}, Exile this card from your graveyard: You gain 3 life.', { name: 'Test Ashwalker' }));
    let s = scenario(['Island'], { p1: { graveyard: ['Test Ashwalker'], battlefield: ['Island'] }, defs: [def] });
    const id = find(s, 'Test Ashwalker', 'graveyard');
    expect(offered(s, id)).toEqual(['p:0:0']);
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.exile.map((x) => s.objects[x]!.defId)).toEqual(['Test Ashwalker']);
    s = passBoth(s);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(23);
    for (const zone of ['hand', 'battlefield'] as const) {
      const t = scenario(['Island'], { p1: zone === 'hand' ? { hand: ['Test Ashwalker'], battlefield: ['Island'] } : { battlefield: ['Test Ashwalker', 'Island'] }, defs: [def] });
      expect(offered(t, find(t, 'Test Ashwalker', zone)), zone).toEqual([]);
    }
  });

  it.skipIf(real('Mnemonic Sphere') === undefined)('CR 113.6j: Mnemonic Sphere\'s Channel ability is activated from the hand, its sacrifice ability only on the battlefield', () => {
    const def = compileCard(real('Mnemonic Sphere')!);
    expect(def.automation.level).toBe('full');
    const [sac, channel] = activatedOf(def);
    expect(sac!.zone).toBeUndefined();
    expect(channel).toMatchObject({ zone: ['hand'], label: 'Channel' });
    let s = scenario(['Island'], { p1: { hand: ['Mnemonic Sphere'], battlefield: ['Island'] }, defs: [def] });
    const id = find(s, 'Mnemonic Sphere', 'hand');
    expect(offered(s, id)).toEqual(['p:0:1']);
    const handBefore = s.zones.hand.p1!.length;
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Mnemonic Sphere']);
    expect(s.zones.hand.p1!.length).toBe(handBefore);
    const onField = scenario(['Island'], { p1: { battlefield: ['Mnemonic Sphere', 'Island', 'Island'] }, defs: [def] });
    expect(offered(onField, find(onField, 'Mnemonic Sphere', 'battlefield'))).toEqual(['p:0:0']);
  });

  it.skipIf(real('Halo Scarab') === undefined)('CR 113.6j: Halo Scarab exiles itself from the graveyard and creates a Treasure; not offered from the hand or the battlefield', () => {
    const def = compileCard(real('Halo Scarab')!);
    expect(def.automation.level).toBe('full');
    expect(activatedOf(def)[0]).toMatchObject({ zone: ['graveyard'] });
    let s = scenario(['Island'], { p1: { graveyard: ['Halo Scarab'], battlefield: ['Island', 'Island'] }, defs: [def] });
    const id = find(s, 'Halo Scarab', 'graveyard');
    expect(offered(s, id)).toEqual(['p:0:0']);
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.zones.exile.map((x) => s.objects[x]!.defId)).toEqual(['Halo Scarab']);
    expect(s.zones.battlefield.map((x) => s.defs[s.objects[x]!.defId]!.name)).toContain('Treasure Token'); // the predefined Treasure (CR 111.10a)
    for (const zone of ['hand', 'battlefield'] as const) {
      const t = scenario(['Island'], { p1: zone === 'hand' ? { hand: ['Halo Scarab'], battlefield: ['Island', 'Island'] } : { battlefield: ['Halo Scarab', 'Island', 'Island'] }, defs: [def] });
      expect(offered(t, find(t, 'Halo Scarab', zone)), zone).toEqual([]);
    }
  });

  it.skipIf(real('Reassembling Skeleton') === undefined)('CR 113.6m example: Reassembling Skeleton\'s ability may be activated only while it is in the graveyard', () => {
    const def = compileCard(real('Reassembling Skeleton')!);
    expect(abilities(def)[0]).toMatchObject({ zone: ['graveyard'] });
    let s = scenario(['Swamp'], { p1: { graveyard: ['Reassembling Skeleton'], battlefield: ['Swamp', 'Swamp'] }, defs: [def] });
    const id = find(s, 'Reassembling Skeleton', 'graveyard');
    expect(offered(s, id)).toEqual(['p:0:0']);
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    // FAST1 T4: the effect is read now (eff.return.self.gy.bf.tapped, CR 113.6m): the Skeleton returns to the battlefield tapped, out of the graveyard
    const back = s.zones.battlefield.filter((x) => s.defs[s.objects[x]!.defId]!.name === 'Reassembling Skeleton');
    expect(back.map((x) => s.objects[x]!.tapped)).toEqual([true]);
    expect(s.zones.graveyard['p1']!.some((x) => s.defs[s.objects[x]!.defId]!.name === 'Reassembling Skeleton')).toBe(false);
    const onField = scenario(['Swamp'], { p1: { battlefield: ['Reassembling Skeleton', 'Swamp', 'Swamp'] }, defs: [def] });
    expect(offered(onField, find(onField, 'Reassembling Skeleton', 'battlefield'))).toEqual([]);
  });

  it.skipIf(real('Simian Spirit Guide') === undefined)('CR 605.1a, 605.3a, 113.6j: Simian Spirit Guide stays a manual mana ability that functions in the hand; nothing offers it from the battlefield', () => {
    const def = compileCard(real('Simian Spirit Guide')!);
    expect(def.automation.level).toBe('manual');
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', shape: 'activated', mana: true, zone: ['hand'] });
    const s = scenario(['Island'], { p1: { battlefield: ['Simian Spirit Guide'] }, defs: [def] });
    expect(offered(s, find(s, 'Simian Spirit Guide', 'battlefield'))).toEqual([]);
  });

  it('CR 605.1a, 113.6j: a synthetic "Exile this card from your hand: Add {R}." is a manual mana ability of the hand, not run by hand on the battlefield', () => {
    const def = compileCard(creature('Exile this card from your hand: Add {R}.', { name: 'Test Spirit Guide' }));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', shape: 'activated', mana: true, zone: ['hand'] });
    const s = scenario(['Island'], { p1: { battlefield: ['Test Spirit Guide'] }, defs: [def] });
    const id = find(s, 'Test Spirit Guide', 'battlefield');
    expect(offered(s, id)).toEqual([]);
    expect(reject(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }).rules).toEqual(['CR 113.6', 'CR 113.6j']);
  });

  it('CR 100.7, 113.6j: an unsanctioned card\'s abilities become manual but keep the zones they function in (and their restrictions), as the degrade pass does', () => {
    const def = markUnsanctioned(compileCard(creature('Exile this card from your hand: Add {R}.\n{2}, Exile this card from your graveyard: You gain 2 life. Activate only as a sorcery.', { name: 'Test Playtest Guide' })));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', mana: true, zone: ['hand'] });
    expect(abilities(def)[1]).toMatchObject({ kind: 'manual', shape: 'activated', zone: ['graveyard'], sorcerySpeed: true });
    const s = scenario(['Island'], { p1: { battlefield: ['Test Playtest Guide'] }, defs: [def] });
    expect(offered(s, find(s, 'Test Playtest Guide', 'battlefield'))).toEqual([]);
  });
});
