/**
 * WP31 review fixes (design 9.4, 5.2): every case runs through the REAL call-sites with restrictions written as model JSON; nothing is faked.
 *   - a restriction's `other` filter at a call-site that has no `other` fails closed, and `feature:restrict.other.<action>` is advertised only for the actions
 *     whose call-sites pass it (CR 101.2, 614.17); the counter handler, the discard handler and the cleanup discard pass it now;
 *   - "can't enter the battlefield" is judged with the face the permanent enters with (CR 614.17d, 712.12, 712.14a);
 *   - the cost forms that bypassed the "can't" checks: discard your hand, forage, collect evidence, a +N loyalty cost (CR 614.17b, 606.4);
 *   - "enters with N counters" is logged only for the counters actually put (CR 122.6, 614.17).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, type AbilityDef, type CardDef, type CostDef, type GameState } from '../../../src/index';
import { capabilitiesOf, classifyCard } from '../../../src/model';
import { cantDo } from '../../../src/rules/cant';
import { act, advanceTo, castAuto, legal, logHas, passBoth, scenario, synth } from '../helpers';
import { objectTarget } from '../announce/support';
import { EXAMPLES } from '../model/examples';
import { ENCHANTMENT, VANILLA, YOU, cant, staticOf } from './fixtures';
import { board, castAndResolve, count, find, here, spellCard } from './wp31-support';

const BEARS = VANILLA('Test Bears');
const each = (filter: object) => ({ ref: 'each', filter }) as const;
const artifact = (name: string, text: string, cost: CostDef): CardDef =>
  synth({ name, cost: '{1}', type: 'Artifact', abilities: [{ kind: 'activated', text, cost, effect: { targets: [], steps: [{ op: 'gainLife', who: YOU, amount: 1 }] } } as AbilityDef] });
const activations = (s: GameState, name: string) => legal(s, 'p1', 'activate').filter((a) => a.label.includes(name));
const levelOf = (abilities: AbilityDef[]) => classifyCard({ faces: [{ abilities, lines: { lines: [], sentences: [] } }], source: 'templates' }, ENGINE_CAPABILITIES).level;

describe('CR 101.2, 614.17: a restriction\'s `other` where the call-site has none fails closed; it is advertised per action', () => {
  const drawOther = staticOf("You can't draw creature cards.", [cant(YOU, 'draw', { other: { types: ['Creature'] } })]);

  it('the restriction is applied (never read as "does not apply"), and its denial says to settle it by hand', () => {
    const s = board([ENCHANTMENT('Test Odd Draw', [drawOther])], { battlefield: ['Test Odd Draw'] });
    const d = cantDo(s, 'draw', 'p1');
    expect(d).not.toBeNull();
    expect(d!.message).toMatch(/settle it by hand/);
  });

  it('feature:restrict.other.<action>: only actions whose call-sites pass `other` are advertised, so such a draw restriction keeps its card partial or manual', () => {
    expect(capabilitiesOf(drawOther)).toContain('feature:restrict.other.draw');
    expect(capabilitiesOf(drawOther)).not.toContain('feature:restrict.other');
    expect(ENGINE_CAPABILITIES.has('feature:restrict.other.draw')).toBe(false);
    expect(levelOf([drawOther])).not.toBe('full');
    for (const a of ['attack', 'block', 'beBlocked', 'beBlockedBy', 'beTargeted', 'cast', 'castFromZone', 'activate', 'playLand', 'beAttached', 'beEnchanted', 'beEquipped', 'dealDamage', 'receiveDamage', 'sacrifice', 'discard', 'beCountered']) {
      expect(ENGINE_CAPABILITIES.has(`feature:restrict.other.${a}`), a).toBe(true);
    }
    for (const a of ['draw', 'search', 'untap', 'transform', 'enter', 'leave', 'beExiled', 'beDestroyed', 'beRegenerated', 'haveCountersPut', 'payLife', 'beSacrificed', 'gainLife', 'loseLife']) {
      expect(ENGINE_CAPABILITIES.has(`feature:restrict.other.${a}`), a).toBe(false);
    }
  });
});

describe('CR 101.2, 701.6a: "Creature spells you control can\'t be countered by blue spells" (beCountered with `other`: the countering spell)', () => {
  const veil = staticOf("Creature spells you control can't be countered by blue spells.", [cant(each({ zone: 'stack', types: ['Creature'], controller: 'you' }), 'beCountered', { other: { colors: ['U'] } })]);
  const target = [{ id: 't0', kind: 'object', filter: { zone: 'stack', stackKind: 'spell' }, min: 1, max: 1, text: 'target spell' }] as const;
  const counterOf = (name: string, cost: string): CardDef =>
    synth({ name, cost, type: 'Instant', abilities: [{ kind: 'spell', text: 'Counter target spell.', effect: { targets: [...target], steps: [{ op: 'counter', what: { ref: 'target', id: 't0' } }] } } as AbilityDef] });
  const blue = counterOf('Test Blue Counter', '{U}');
  const grey = counterOf('Test Grey Counter', '{1}');

  function counterWith(name: string) {
    const s = board([ENCHANTMENT('Test Veil', [veil]), BEARS, blue, grey], { battlefield: ['Test Veil'], hand: ['Test Bears'] }, { hand: [name] });
    const cast = act(castAuto(s, 'Test Bears'), { type: 'pass', player: 'p1' });
    const spell = cast.zones.stack[0]!;
    return { t: passBoth(castAuto(cast, name, { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [objectTarget(spell)] }] })), spell };
  }

  it('a blue counterspell does not counter it; a colorless one does', () => {
    const b = counterWith('Test Blue Counter');
    expect(b.t.zones.stack).toEqual([b.spell]);
    expect(logHas(b.t, /can't be countered/, 'CR 701.6a')).toBe(true);
    const g = counterWith('Test Grey Counter');
    expect(g.t.zones.stack).toEqual([]);
  });

  it('the card is classified full: its call-site passes `other`', () => {
    expect(capabilitiesOf(veil)).toContain('feature:restrict.other.beCountered');
    expect(levelOf([veil])).toBe('full');
  });
});

describe('CR 701.9, 514.1: "You can\'t discard creature cards" (discard with `other`: the discarded card)', () => {
  const keep = ENCHANTMENT('Test Keep Creatures', [staticOf("You can't discard creature cards.", [cant(YOU, 'discard', { other: { types: ['Creature'] } })])]);
  const mindRot = spellCard('Test Mind Rot', 'You discard two cards.', [{ op: 'discard', who: YOU, count: 2 }]);

  it('the handler discards only what may be discarded: the Island goes, both creature cards stay', () => {
    const s = board([keep, mindRot, BEARS], { battlefield: ['Test Keep Creatures'], hand: ['Test Mind Rot', 'Test Bears', 'Test Bears', 'Island'] });
    const t = castAndResolve(s, 'Test Mind Rot');
    expect(t.zones.hand.p1!.map((id) => t.objects[id]!.defId)).toEqual(['Test Bears', 'Test Bears']);
  });

  it('CR 514.1: the cleanup discard offers only the cards that may be discarded', () => {
    const hand = [...(Array(8).fill('Test Bears') as string[]), 'Island'];
    const t = advanceTo(board([keep, BEARS], { battlefield: ['Test Keep Creatures'] , hand }), 2, 'upkeep');
    expect(count(t, 'hand', 'p1')).toBe(8);
    expect(t.zones.hand.p1!.every((id) => t.objects[id]!.defId === 'Test Bears')).toBe(true);
  });
});

describe('CR 614.17d, 712.12, 712.14a: "can\'t enter the battlefield" is judged with the face that enters', () => {
  const AGADEEM = "Agadeem's Awakening // Agadeem, the Undercrypt";
  const INVASION = 'Invasion of Ergamon // Truga Cliffcharger';
  const noEntry = (name: string, type: string) => ENCHANTMENT(name, [staticOf(`${type}s can't enter the battlefield.`, [cant(each({ types: [type] }), 'enter')])]);

  it('CR 712.12: the land face of a modal double-faced card can\'t be played under "Lands can\'t enter the battlefield"', () => {
    const s = board([noEntry('Test Worms', 'Land')], { battlefield: ['Test Worms'], hand: [AGADEEM, 'Forest'] }, {}, [AGADEEM]);
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
  });

  it('CR 712.12: a restriction that matches only the front face does not stop the land face', () => {
    const s = board([noEntry('Test No Sorceries', 'Sorcery')], { battlefield: ['Test No Sorceries'], hand: [AGADEEM] }, {}, [AGADEEM]);
    expect(legal(s, 'p1', 'playLand')).toHaveLength(1);
  });

  const raise = spellCard('Test Raise', 'Put each battle card from your graveyard onto the battlefield transformed.', [
    { op: 'move', what: each({ types: ['Battle'], zone: 'graveyard', owner: 'you' }), to: { zone: 'battlefield', controller: 'owner', transformed: true } },
  ]);
  const raised = (def: CardDef) => {
    const s = board([def, raise], { battlefield: [def.name], hand: ['Test Raise'], graveyard: [INVASION] }, {}, [INVASION]);
    const t = castAndResolve(s, 'Test Raise');
    return t.zones.battlefield.map((id) => t.objects[id]!).find((o) => o.defId === INVASION);
  };

  it('CR 712.14a: a card put onto the battlefield transformed is judged as its back face (a creature), not as its front face (a battle)', () => {
    expect(raised(noEntry('Test No Creatures', 'Creature'))).toBeUndefined();
    expect(raised(noEntry('Test No Battles', 'Battle'))?.face).toBe(1);
  });
});

describe('CR 614.17b: the cost forms that include an event that can\'t happen can\'t be paid', () => {
  const noDiscard = ENCHANTMENT('Test Keep', [staticOf("You can't discard cards.", [cant(YOU, 'discard')])]);
  const keepYard = ENCHANTMENT('Test Rest', [staticOf("Cards in graveyards can't be exiled.", [cant(each({ zone: 'graveyard' }), 'beExiled')])]);

  it('"Discard your hand": not offered under "You can\'t discard cards"; offered without it', () => {
    const wheel = artifact('Test Wheel', 'Discard your hand: You gain 1 life.', { other: [{ kind: 'discard', count: 0, hand: true }] });
    expect(activations(board([noDiscard, wheel, BEARS], { battlefield: ['Test Keep', 'Test Wheel'], hand: ['Test Bears'] }), 'Test Wheel')).toEqual([]);
    expect(activations(board([wheel, BEARS], { battlefield: ['Test Wheel'], hand: ['Test Bears'] }), 'Test Wheel')).toHaveLength(1);
  });

  it('CR 701.59a: collect evidence can\'t exile graveyard cards that can\'t be exiled', () => {
    const evidence = artifact('Test Evidence', 'Collect evidence 2: You gain 1 life.', { other: [{ kind: 'action', action: 'collectEvidence', arg: 2 }] });
    expect(activations(board([keepYard, evidence, BEARS], { battlefield: ['Test Rest', 'Test Evidence'], graveyard: ['Test Bears'] }), 'Test Evidence')).toEqual([]);
    expect(activations(board([evidence, BEARS], { battlefield: ['Test Evidence'], graveyard: ['Test Bears'] }), 'Test Evidence')).toHaveLength(1);
  });

  it('CR 701.61a: forage can\'t exile graveyard cards that can\'t be exiled; with a Food it sacrifices the Food', () => {
    const forager = artifact('Test Forager', 'Forage: You gain 1 life.', { other: [{ kind: 'action', action: 'forage' }] });
    const food = synth({ name: 'Test Food', cost: '{1}', type: 'Artifact — Food', abilities: [] });
    const yard = ['Mountain', 'Mountain', 'Mountain'];
    expect(activations(board([keepYard, forager], { battlefield: ['Test Rest', 'Test Forager'], graveyard: yard }), 'Test Forager')).toEqual([]);
    expect(activations(board([forager], { battlefield: ['Test Forager'], graveyard: yard }), 'Test Forager')).toHaveLength(1);
    const s = board([keepYard, forager, food], { battlefield: ['Test Rest', 'Test Forager', 'Test Food'], graveyard: yard });
    const [a] = activations(s, 'Test Forager');
    expect(a).toBeDefined();
    const t = passBoth(act(s, a!.action));
    expect(t.zones.graveyard.p1!.map((id) => t.objects[id]!.defId)).toContain('Test Food');
    expect(t.zones.exile).toHaveLength(0);
  });
});

describe('CR 606.4, 614.17b: a +N loyalty cost puts counters, so it can\'t be paid when counters can\'t be put on the planeswalker', () => {
  const ex = EXAMPLES.find((e) => e.name === 'Jace, the Mind Sculptor')!;
  const JACE = synth({ name: 'Jace, the Mind Sculptor', cost: '{2}{U}{U}', type: 'Legendary Planeswalker — Jace', abilities: ex.faces[0]!.abilities });
  const solemn = ENCHANTMENT('Test Solemnity', [staticOf("Permanents can't have counters put on them.", [cant(each({}), 'haveCountersPut')])]);
  const jaceBoard = (defs: CardDef[], bf: string[]) =>
    scenario(['Island'], { defs: [JACE, ...defs], p1: { battlefield: [{ name: 'Jace, the Mind Sculptor', counters: { loyalty: 3 } }, ...bf] }, p2: { library: ['Island', 'Island'] } });

  it('+2 is not offered under the restriction; 0 still is (-1 has no creature to target here)', () => {
    const plus = (l: string) => l.includes('+2');
    const free = activations(jaceBoard([], []), 'Jace').map((a) => a.label);
    const held = activations(jaceBoard([solemn], ['Test Solemnity']), 'Jace').map((a) => a.label);
    expect(free.some(plus)).toBe(true);
    expect(held.some(plus)).toBe(false);
    expect(held).toEqual(free.filter((l) => !plus(l)));
    expect(held.length).toBeGreaterThan(0);
  });
});

describe('CR 122.6, 614.17: "enters with N counters" is logged only for the counters actually put', () => {
  const solemn = ENCHANTMENT('Test Solemnity', [staticOf("Creatures can't have counters put on them.", [cant(each({ types: ['Creature'] }), 'haveCountersPut')])]);
  const back = spellCard('Test Return', 'Return each creature card from your graveyard to the battlefield with two +1/+1 counters on it.', [
    { op: 'move', what: each({ types: ['Creature'], zone: 'graveyard', owner: 'you' }), to: { zone: 'battlefield', controller: 'owner', counters: [{ kind: '+1/+1', count: 2 }] } },
  ]);

  it('none put: no "enters with" line; without the restriction the line is there', () => {
    const t = castAndResolve(board([solemn, back, BEARS], { battlefield: ['Test Solemnity'], hand: ['Test Return'], graveyard: ['Test Bears'] }), 'Test Return');
    const id = find(t, 'Test Bears', 'battlefield');
    expect(here(t, id)).toBe(true);
    expect(t.objects[id]!.counters).toEqual({});
    expect(logHas(t, /enters with 2 \+1\/\+1 counters/)).toBe(false);
    const u = castAndResolve(board([back, BEARS], { hand: ['Test Return'], graveyard: ['Test Bears'] }), 'Test Return');
    expect(logHas(u, /enters with 2 \+1\/\+1 counters/)).toBe(true);
  });
});
