/**
 * WP31, design 9.4: the rule actions wired at the proposal pipeline and at the milestone 3/4 primitives (draw, enter, leave, beExiled, beDestroyed,
 * beRegenerated, dealDamage, receiveDamage, haveCountersPut, payLife). One test (or more) per action, through the REAL call-sites with restrictions written
 * as model JSON on permanents or as resolved effects; nothing is faked.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, type AbilityDef, type CardDef } from '../../../src/index';
import { addRegenerationShield, destroy } from '../../../src/rules/destroy';
import { dealDamage } from '../../../src/rules/damage';
import { givePoison, lifeBudget } from '../../../src/rules/life';
import { addCounters } from '../../../src/rules/counters';
import { RULE_HOOK_ACTIONS, UNWIRED_RULE_ACTIONS, enterDenial } from '../../../src/statics/hooks';
import { advanceTo, legal, logHas, pass, synth, tweak } from '../helpers';
import { run } from '../propose/support';
import { EACH_PLAYER, ENCHANTMENT, SELF, VANILLA, YOU, cant, staticOf, withRuleEffect } from './fixtures';
import { TARGET, board, castAndResolve, count, creatureTarget, find, here, spellCard } from './wp31-support';

const BEARS = VANILLA('Test Bears');
const each = (filter: object) => ({ ref: 'each', filter }) as const;
/** An artifact (or a creature) with these abilities. */
const synth2 = (name: string, abilities: AbilityDef[], type = 'Artifact', pt?: [string, string]): CardDef => synth({ name, cost: '{1}', type, abilities, ...(pt ? { pt } : {}) });

describe('WP31: the actions of this file are wired and advertised', () => {
  it.each(['draw', 'enter', 'leave', 'beExiled', 'beDestroyed', 'beRegenerated', 'dealDamage', 'receiveDamage', 'haveCountersPut', 'payLife'])('rule:%s', (a) => {
    expect(Object.hasOwn(RULE_HOOK_ACTIONS, `rule:${a}`)).toBe(true);
    expect(Object.hasOwn(UNWIRED_RULE_ACTIONS, a)).toBe(false);
    expect(ENGINE_CAPABILITIES.has(`rule:${a}`)).toBe(true);
  });
});

describe('CR 121.1, 614.17: "Players can\'t draw cards." (rule:draw)', () => {
  const noDraw = ENCHANTMENT('Test Maralen Field', [staticOf("Players can't draw cards.", [cant(EACH_PLAYER, 'draw')])]);
  const divination = spellCard('Test Divination', 'Draw two cards.', [{ op: 'draw', who: YOU, count: 2 }]);

  it('a spell\'s draw draws nothing; without the restriction it draws two', () => {
    const s = board([noDraw, divination], { battlefield: ['Test Maralen Field'], hand: ['Test Divination'] });
    const t = castAndResolve(s, 'Test Divination');
    expect(count(t, 'hand', 'p1')).toBe(0);
    expect(count(t, 'library', 'p1')).toBe(count(s, 'library', 'p1'));
    const free = castAndResolve(board([divination], { hand: ['Test Divination'] }), 'Test Divination');
    expect(count(free, 'hand', 'p1')).toBe(2);
  });

  it('CR 504.1: the draw step draws nothing, and a player with an empty library who can\'t draw doesn\'t lose (CR 704.5b)', () => {
    const s = tweak(board([noDraw], { battlefield: ['Test Maralen Field'] }), (t) => {
      for (const id of t.zones.library.p2!) delete t.objects[id];
      t.zones.library.p2 = [];
    });
    const t = advanceTo(s, 2, 'main1');
    expect(count(t, 'hand', 'p2')).toBe(0);
    expect(t.players[1]!.hasLost).toBe(false);
    expect(t.players[1]!.drewFromEmptyLibrary).not.toBe(true);
    expect(logHas(t, /can't draw cards/, 'CR 614.17')).toBe(true);
  });

  it('a resolved "target player can\'t draw cards this turn" (a fixed player) stops only that player', () => {
    const s = withRuleEffect(board([divination], { hand: ['Test Divination'] }), cant({ ref: 'fixed', players: ['p2'] }, 'draw'));
    expect(count(castAndResolve(s, 'Test Divination'), 'hand', 'p1')).toBe(2);
  });
});

describe('CR 614.17d: "can\'t enter the battlefield" (rule:enter)', () => {
  const worms = ENCHANTMENT('Test Worms', [staticOf("Lands can't enter the battlefield.", [cant(each({ types: ['Land'] }), 'enter')])]);
  const cage = ENCHANTMENT('Test Cage', [staticOf("Creature cards in graveyards can't enter the battlefield.", [cant(each({ types: ['Creature'], zone: 'graveyard' }), 'enter')])]);
  const reanimate = spellCard('Test Reanimate', 'Return all creature cards from your graveyard to the battlefield.', [
    { op: 'move', what: each({ types: ['Creature'], zone: 'graveyard', owner: 'you' }), to: { zone: 'battlefield', controller: 'owner' } },
  ]);

  it('CR 305.1: a land that can\'t enter can\'t be played (judged as it would exist on the battlefield)', () => {
    const s = board([worms], { battlefield: ['Test Worms'], hand: ['Forest'] });
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
    expect(enterDenial(s, find(s, 'Forest', 'hand'), 'p1')?.rules).toContain('CR 614.17d');
    expect(legal(board([], { hand: ['Forest'] }), 'p1', 'playLand')).toHaveLength(1);
  });

  it('a restriction on cards in their current zone (Grafdigger\'s Cage): the creature card stays in the graveyard; a creature spell still enters', () => {
    const s = board([cage, reanimate, BEARS], { battlefield: ['Test Cage'], hand: ['Test Reanimate', 'Test Bears'], graveyard: ['Test Bears'] });
    const t = castAndResolve(s, 'Test Reanimate');
    expect(t.zones.graveyard.p1!.some((id) => t.objects[id]!.defId === 'Test Bears')).toBe(true);
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Test Bears')).toBe(false);
    const cast = castAndResolve(t, 'Test Bears');
    expect(cast.zones.battlefield.some((id) => cast.objects[id]!.defId === 'Test Bears')).toBe(true);
  });

  it('CR 608.3e: a permanent spell that can\'t enter resolves into its owner\'s graveyard', () => {
    const noBears = ENCHANTMENT('Test No Bears', [staticOf("Creatures can't enter the battlefield.", [cant(each({ types: ['Creature'] }), 'enter')])]);
    const s = castAndResolve(board([noBears, BEARS], { battlefield: ['Test No Bears'], hand: ['Test Bears'] }), 'Test Bears');
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Bears')).toBe(true);
  });
});

describe('CR 614.17: "can\'t leave the battlefield" and "can\'t be exiled" (rule:leave, rule:beExiled)', () => {
  const anchored = VANILLA('Test Anchored', ['2', '2'], [staticOf("This creature can't leave the battlefield.", [cant(SELF, 'leave')])]);
  const unexilable = VANILLA('Test Unexilable', ['2', '2'], [staticOf("This creature can't be exiled.", [cant(SELF, 'beExiled')])]);
  const bounce = spellCard('Test Bounce', "Return target creature to its owner's hand.", [{ op: 'move', what: TARGET, to: { zone: 'hand' } }], [creatureTarget]);
  const swords = spellCard('Test Exile', 'Exile target creature.', [{ op: 'move', what: TARGET, to: { zone: 'exile' } }], [creatureTarget]);

  it('a creature that can\'t leave stays when bounced; another one is returned', () => {
    const s = board([anchored, bounce, BEARS], { battlefield: ['Test Anchored', 'Test Bears'], hand: ['Test Bounce', 'Test Bounce'] });
    const [a, b] = [find(s, 'Test Anchored', 'battlefield'), find(s, 'Test Bears', 'battlefield')];
    expect(here(castAndResolve(s, 'Test Bounce', [a]), a)).toBe(true);
    expect(here(castAndResolve(s, 'Test Bounce', [b]), b)).toBe(false);
  });

  it('CR 614.17b: it can\'t be sacrificed to pay a cost either', () => {
    const altar = synth2('Test Altar', [{ kind: 'activated', text: 'Sacrifice a creature: You gain 1 life.', cost: { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: YOU, amount: 1 }] } }]);
    const s = board([anchored, altar, BEARS], { battlefield: ['Test Anchored', 'Test Altar'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.label.includes('Test Altar'))).toEqual([]);
    const withBears = board([anchored, altar, BEARS], { battlefield: ['Test Anchored', 'Test Altar', 'Test Bears'] });
    expect(legal(withBears, 'p1', 'activate').filter((a) => a.label.includes('Test Altar'))).toHaveLength(1);
  });

  it('a creature that can\'t be exiled is not exiled; it can still be bounced', () => {
    const s = board([unexilable, swords, bounce], { battlefield: ['Test Unexilable'], hand: ['Test Exile', 'Test Bounce'] });
    const id = find(s, 'Test Unexilable', 'battlefield');
    const t = castAndResolve(s, 'Test Exile', [id]);
    expect(here(t, id)).toBe(true);
    expect(t.zones.exile).toEqual([]);
    expect(here(castAndResolve(s, 'Test Bounce', [id]), id)).toBe(false);
  });
});

describe('CR 701.8, 701.19c: "can\'t be destroyed" and "can\'t be regenerated" (rule:beDestroyed, rule:beRegenerated)', () => {
  const sturdy = VANILLA('Test Sturdy', ['2', '2'], [staticOf("This creature can't be destroyed.", [cant(SELF, 'beDestroyed')])]);
  const noRegen = ENCHANTMENT('Test No Regen', [staticOf("Creatures can't be regenerated.", [cant(each({ types: ['Creature'] }), 'beRegenerated')])]);
  const doomBlade = spellCard('Test Doom', 'Destroy target creature.', [{ op: 'destroy', what: TARGET }], [creatureTarget]);

  it('an effect\'s destruction and lethal damage (CR 704.5g) leave it on the battlefield', () => {
    const s = board([sturdy, doomBlade], { battlefield: ['Test Sturdy'], hand: ['Test Doom'] });
    const id = find(s, 'Test Sturdy', 'battlefield');
    expect(here(castAndResolve(s, 'Test Doom', [id]), id)).toBe(true);
    const hurt = pass(tweak(s, (t) => { t.objects[id]!.damage = 5; }));
    expect(here(hurt, id)).toBe(true);
  });

  it('a regeneration shield is not applied, for an effect\'s destruction (the `destroy` op) as for the state-based one', () => {
    const s0 = board([noRegen, BEARS, doomBlade], { battlefield: ['Test No Regen', 'Test Bears'], hand: ['Test Doom'] });
    const id = find(s0, 'Test Bears', 'battlefield');
    const shielded = run(s0, (g) => addRegenerationShield(g, id)).g.s;
    expect(here(castAndResolve(shielded, 'Test Doom', [id]), id)).toBe(false);
    expect(run(shielded, (g) => destroy(g, id)).result).toBe('destroyed');
    const without = run(board([BEARS], { battlefield: ['Test Bears'] }), (g) => addRegenerationShield(g, find(g.s, 'Test Bears', 'battlefield'))).g.s;
    expect(run(without, (g) => destroy(g, find(without, 'Test Bears', 'battlefield'))).result).toBe('regenerated');
  });
});

describe('CR 120.1: "can\'t deal damage" and "can\'t be dealt damage" (rule:dealDamage, rule:receiveDamage, with `other`)', () => {
  const pacified = VANILLA('Test Harmless', ['3', '3'], [staticOf("This creature can't deal damage.", [cant(SELF, 'dealDamage')])]);
  const warded = VANILLA('Test Warded', ['2', '2'], [staticOf("This creature can't be dealt damage by sources your opponents control.", [cant(SELF, 'receiveDamage', { other: { controller: 'opponent' } })])]);

  it('the source deals none', () => {
    const s = board([pacified, BEARS], { battlefield: ['Test Harmless'] }, { battlefield: ['Test Bears'] });
    const [src, to] = [find(s, 'Test Harmless', 'battlefield'), find(s, 'Test Bears', 'battlefield', 'p2')];
    expect(run(s, (g) => dealDamage(g, src, to, 3)).result).toBe(0);
    expect(run(s, (g) => dealDamage(g, src, 'p2', 3)).g.s.players[1]!.life).toBe(20);
  });

  it('CR 109.5: `other` is read for the restriction\'s controller: an opponent\'s source deals none, its controller\'s own source deals it', () => {
    const s = board([warded, BEARS], { battlefield: ['Test Bears'] }, { battlefield: ['Test Warded', 'Test Bears'] });
    const [mine, theirs, w] = [find(s, 'Test Bears', 'battlefield', 'p1'), find(s, 'Test Bears', 'battlefield', 'p2'), find(s, 'Test Warded', 'battlefield', 'p2')];
    expect(run(s, (g) => dealDamage(g, mine, w, 2)).result).toBe(0);
    expect(run(s, (g) => dealDamage(g, theirs, w, 2)).result).toBe(2);
  });

  it('CR 109.5: "can\'t be dealt damage by sources you control": "you" is the restriction\'s controller, so its own source deals none, an opponent\'s deals it', () => {
    const selfWarded = VANILLA('Test Self Warded', ['2', '2'], [staticOf("This creature can't be dealt damage by sources you control.", [cant(SELF, 'receiveDamage', { other: { controller: 'you' } })])]);
    const s = board([selfWarded, BEARS], { battlefield: ['Test Bears'] }, { battlefield: ['Test Self Warded', 'Test Bears'] });
    const [mine, theirs, w] = [find(s, 'Test Bears', 'battlefield', 'p1'), find(s, 'Test Bears', 'battlefield', 'p2'), find(s, 'Test Self Warded', 'battlefield', 'p2')];
    expect(run(s, (g) => dealDamage(g, theirs, w, 2)).result).toBe(0);
    expect(run(s, (g) => dealDamage(g, mine, w, 2)).result).toBe(2);
  });
});

describe('CR 122.6, 614.17: "can\'t have counters put on them" (rule:haveCountersPut)', () => {
  const solemn = ENCHANTMENT('Test Solemnity', [staticOf("Creatures can't have counters put on them.", [cant(each({ types: ['Creature'] }), 'haveCountersPut')])]);
  const noCountersPlayers = ENCHANTMENT('Test Player Ward', [staticOf("Players can't get counters.", [cant(EACH_PLAYER, 'haveCountersPut')])]);
  const growth = spellCard('Test Growth', 'Put two +1/+1 counters on target creature.', [{ op: 'putCounters', on: TARGET, kind: '+1/+1', count: 2 }], [creatureTarget]);

  it('an effect puts none; the primitive (as it enters, wither, costs) puts none either', () => {
    const s = board([solemn, BEARS, growth], { battlefield: ['Test Solemnity', 'Test Bears'], hand: ['Test Growth'] });
    const id = find(s, 'Test Bears', 'battlefield');
    expect(castAndResolve(s, 'Test Growth', [id]).objects[id]!.counters).toEqual({});
    expect(run(s, (g) => addCounters(g, id, '-1/-1', 1)).result).toBe(0);
    expect(run(s, (g) => addCounters(g, id, '-1/-1', -1)).result).toBe(0); // removing is not putting
  });

  it('players: no poison counters (CR 122.1f)', () => {
    const s = board([noCountersPlayers], { battlefield: ['Test Player Ward'] });
    expect(run(s, (g) => givePoison(g, 'p2', 3, 'test')).g.s.players[1]!.poison).toBe(0);
    expect(run(board([]), (g) => givePoison(g, 'p2', 3, 'test')).g.s.players[1]!.poison).toBe(3);
  });

  it('CR 614.17b: a cost that puts a counter on the permanent itself can\'t be paid', () => {
    const grower = synth2('Test Grower', [{ kind: 'activated', text: 'Put a +1/+1 counter on this creature: You gain 1 life.', cost: { other: [{ kind: 'putCounters', counter: '+1/+1', count: 1, self: true }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: YOU, amount: 1 }] } }], 'Creature — Test', ['1', '1']);
    const s = board([solemn, grower], { battlefield: ['Test Solemnity', 'Test Grower'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.label.includes('Test Grower'))).toEqual([]);
    expect(legal(board([grower], { battlefield: ['Test Grower'] }), 'p1', 'activate').filter((a) => a.label.includes('Test Grower'))).toHaveLength(1);
  });
});

describe('CR 119.4, 614.17b: "You can\'t pay life." (rule:payLife)', () => {
  const noPay = ENCHANTMENT('Test No Life Payments', [staticOf("You can't pay life.", [cant(YOU, 'payLife')])]);
  const lifeAbility = synth2('Test Bargain', [{ kind: 'activated', text: 'Pay 2 life: You gain 1 life.', cost: { other: [{ kind: 'payLife', amount: 2 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: YOU, amount: 1 }] } }]);

  it('an ability with a life payment can\'t be activated; the life budget (Phyrexian mana) is 0', () => {
    const s = board([noPay, lifeAbility], { battlefield: ['Test No Life Payments', 'Test Bargain'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.label.includes('Test Bargain'))).toEqual([]);
    expect(lifeBudget(s, 'p1')).toBe(0);
    expect(lifeBudget(s, 'p2')).toBe(20);
    expect(legal(board([lifeAbility], { battlefield: ['Test Bargain'] }), 'p1', 'activate').filter((a) => a.label.includes('Test Bargain'))).toHaveLength(1);
  });
});

