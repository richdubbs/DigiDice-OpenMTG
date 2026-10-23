/**
 * WP31, design 9.4: the rule actions wired at the op handlers, the costs and the resolution of an Aura spell (beCountered, untap, transform, search, discard,
 * sacrifice, beSacrificed, beEnchanted, beAttached). One test (or more) per action through the REAL call-sites, with restrictions written as model JSON;
 * nothing is faked.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, type AbilityDef, type CardDef } from '../../../src/index';
import { RULE_HOOK_ACTIONS, UNWIRED_RULE_ACTIONS } from '../../../src/statics/hooks';
import { act, advanceTo, castAuto, legal, logHas, passBoth, synth, tweak } from '../helpers';
import { objectTarget } from '../announce/support';
import { EACH_PLAYER, ENCHANTMENT, PACIFISM, SELF, UNCOUNTERABLE, VANILLA, YOU, cant, staticOf } from './fixtures';
import { TARGET, board, castAndResolve, count, creatureTarget, find, here, spellCard } from './wp31-support';

const BEARS = VANILLA('Test Bears');
const each = (filter: object) => ({ ref: 'each', filter }) as const;
const withAbilities = (name: string, abilities: AbilityDef[], type = 'Artifact', pt?: [string, string]): CardDef => synth({ name, cost: '{1}', type, abilities, ...(pt ? { pt } : {}) });

describe('WP31: the actions of this file are wired and advertised; the rest stay unwired with a reason', () => {
  it.each(['beCountered', 'untap', 'transform', 'search', 'discard', 'sacrifice', 'beSacrificed', 'beEnchanted', 'beAttached', 'preventDamage'])('rule:%s', (a) => {
    expect(Object.hasOwn(RULE_HOOK_ACTIONS, `rule:${a}`)).toBe(true);
    expect(Object.hasOwn(UNWIRED_RULE_ACTIONS, a)).toBe(false);
    expect(ENGINE_CAPABILITIES.has(`rule:${a}`)).toBe(true);
  });

  // FAST4 T33: attackPlayer is wired ("can't attack you", statics/hooks.ts#canAttack, CR 508.1b-c)
  it('exactly tap, beTapped, gainAbility and spendMana stay unwired, each with its reason', () => {
    expect(Object.keys(UNWIRED_RULE_ACTIONS).sort()).toEqual(['beTapped', 'gainAbility', 'spendMana', 'tap']);
    for (const why of Object.values(UNWIRED_RULE_ACTIONS)) expect(why!.length).toBeGreaterThan(20);
  });
});

describe('CR 701.6a, 101.2: "can\'t be countered" at the counter handler (rule:beCountered)', () => {
  const counterspell = spellCard('Test Counterspell', 'Counter target spell.', [{ op: 'counter', what: TARGET }], [{ id: 't0', kind: 'object', filter: { zone: 'stack', stackKind: 'spell' }, min: 1, max: 1, text: 'target spell' }], 'Instant');
  const shield = ENCHANTMENT('Test Shield', [staticOf("Creature spells you control can't be countered.", [cant(each({ zone: 'stack', types: ['Creature'], controller: 'you' }), 'beCountered')])]);

  /** p1 casts `name`, then p2 casts the counterspell on it and both pass once: the counterspell resolves. */
  function counterIt(defs: CardDef[], p1: { battlefield?: string[]; hand?: string[] }, name: string) {
    const s = board([counterspell, ...defs], p1, { hand: ['Test Counterspell'] });
    const cast = act(castAuto(s, name), { type: 'pass', player: 'p1' });
    const spell = cast.zones.stack[0]!;
    const countered = passBoth(castAuto(cast, 'Test Counterspell', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [objectTarget(spell)] }] }));
    return { countered, spell };
  }

  it('"This spell can\'t be countered." stays on the stack, and then resolves', () => {
    const { countered, spell } = counterIt([UNCOUNTERABLE], { hand: ['Test Uncounterable'] }, 'Test Uncounterable');
    expect(countered.zones.stack).toEqual([spell]);
    expect(logHas(countered, /can't be countered/, 'CR 701.6a')).toBe(true);
  });

  it('a static of another permanent ("creature spells you control can\'t be countered"); without it the spell is countered', () => {
    const shielded = counterIt([shield, BEARS], { battlefield: ['Test Shield'], hand: ['Test Bears'] }, 'Test Bears');
    expect(shielded.countered.zones.stack).toEqual([shielded.spell]);
    const plain = counterIt([BEARS], { hand: ['Test Bears'] }, 'Test Bears');
    expect(plain.countered.zones.stack).toEqual([]);
    expect(plain.countered.zones.graveyard.p1!.some((id) => plain.countered.objects[id]!.defId === 'Test Bears')).toBe(true);
  });
});

describe('CR 701.26b: "can\'t untap" at the untap handler and the {Q} cost (rule:untap)', () => {
  const frozen = ENCHANTMENT('Test Freeze', [staticOf("Creatures can't untap.", [cant(each({ types: ['Creature'] }), 'untap')])]);
  const untapper = spellCard('Test Untap', 'Untap target creature.', [{ op: 'untap', what: TARGET }], [creatureTarget]);

  it('the tapped creature stays tapped; without the restriction it untaps', () => {
    const tapped = (defs: CardDef[], bf: string[]) => tweak(board([untapper, BEARS, ...defs], { battlefield: bf, hand: ['Test Untap'] }), (t) => { t.objects[find(t, 'Test Bears', 'battlefield')]!.tapped = true; });
    const s = tapped([frozen], ['Test Freeze', 'Test Bears']);
    const id = find(s, 'Test Bears', 'battlefield');
    expect(castAndResolve(s, 'Test Untap', [id]).objects[id]!.tapped).toBe(true);
    const free = tapped([], ['Test Bears']);
    expect(castAndResolve(free, 'Test Untap', [find(free, 'Test Bears', 'battlefield')]).objects[find(free, 'Test Bears', 'battlefield')]!.tapped).toBe(false);
  });

  it('CR 107.6, 614.17b: an {Q} ability of a permanent that can\'t untap can\'t be activated', () => {
    const q = withAbilities('Test Q Bears', [{ kind: 'activated', text: '{Q}: You gain 1 life.', cost: { untap: true }, effect: { targets: [], steps: [{ op: 'gainLife', who: YOU, amount: 1 }] } }], 'Creature — Bear', ['2', '2']);
    const setup = (defs: CardDef[], bf: string[]) => tweak(board([q, ...defs], { battlefield: bf }), (t) => { t.objects[find(t, 'Test Q Bears', 'battlefield')]!.tapped = true; });
    expect(legal(setup([frozen], ['Test Freeze', 'Test Q Bears']), 'p1', 'activate').filter((a) => a.label.includes('Test Q Bears'))).toEqual([]);
    expect(legal(setup([], ['Test Q Bears']), 'p1', 'activate').filter((a) => a.label.includes('Test Q Bears'))).toHaveLength(1);
  });
});

describe('CR 701.27: "can\'t transform" at the changeFace handler (rule:transform)', () => {
  const stuck = ENCHANTMENT('Test Stuck', [staticOf("Permanents can't transform.", [cant(each({}), 'transform')])]);
  const DELVER = 'Delver of Secrets // Insectile Aberration';
  const flip = spellCard('Test Flip', 'Transform target creature.', [{ op: 'changeFace', what: TARGET, to: 'transform' }], [creatureTarget]);

  it('Delver of Secrets keeps its face; without the restriction it transforms', () => {
    const s = board([stuck, flip], { battlefield: ['Test Stuck', DELVER], hand: ['Test Flip'] }, {}, [DELVER]);
    const id = find(s, DELVER, 'battlefield');
    const t = castAndResolve(s, 'Test Flip', [id]);
    expect(t.objects[id]!.face).toBe(0);
    expect(logHas(t, /doesn't transform/)).toBe(true);
    const free = board([flip], { battlefield: [DELVER], hand: ['Test Flip'] }, {}, [DELVER]);
    expect(castAndResolve(free, 'Test Flip', [find(free, DELVER, 'battlefield')]).objects[find(free, DELVER, 'battlefield')]!.face).toBe(1);
  });
});

describe('CR 701.23: "Players can\'t search libraries." at the search handler (rule:search)', () => {
  const doubt = ENCHANTMENT('Test Doubt', [staticOf("Players can't search libraries.", [cant(EACH_PLAYER, 'search')])]);
  const tutor = spellCard('Test Tutor', 'Search your library for a card, put it into your hand, then shuffle.', [
    { op: 'search', who: YOU, zone: 'library', filter: {}, max: 1, as: 'found' },
    { op: 'move', what: { ref: 'bound', name: 'found' }, to: { zone: 'hand' } },
    { op: 'shuffle', who: YOU },
  ] as never);

  it('nothing is found (the library is still shuffled); without the restriction a card is found', () => {
    const s = board([doubt, tutor], { battlefield: ['Test Doubt'], hand: ['Test Tutor'] });
    const t = castAndResolve(s, 'Test Tutor');
    expect(count(t, 'hand', 'p1')).toBe(0);
    expect(logHas(t, /can't search libraries/, 'CR 701.23a')).toBe(true);
    expect(t.pending?.kind).toBe('priority');
    const free = castAndResolve(board([tutor], { hand: ['Test Tutor'] }), 'Test Tutor');
    expect(free.pending?.kind).toBe('chooseObjects'); // the search asks which card to find (CR 701.23a)
  });
});

describe('CR 701.9, 514.1: "can\'t discard cards" at the discard handler, discard costs and the cleanup discard (rule:discard)', () => {
  const noDiscard = ENCHANTMENT('Test Keep', [staticOf("You can't discard cards.", [cant(YOU, 'discard')])]);
  const mindRot = spellCard('Test Mind Rot', 'You discard two cards.', [{ op: 'discard', who: YOU, count: 2 }]);
  const looter = withAbilities('Test Looter', [{ kind: 'activated', text: 'Discard a card: You gain 1 life.', cost: { other: [{ kind: 'discard', count: 1 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: YOU, amount: 1 }] } } as AbilityDef]);

  it('the handler discards nothing; without the restriction two cards go', () => {
    const s = board([noDiscard, mindRot, BEARS], { battlefield: ['Test Keep'], hand: ['Test Mind Rot', 'Test Bears', 'Test Bears'] });
    expect(count(castAndResolve(s, 'Test Mind Rot'), 'hand', 'p1')).toBe(2);
    expect(count(castAndResolve(board([mindRot, BEARS], { hand: ['Test Mind Rot', 'Test Bears', 'Test Bears'] }), 'Test Mind Rot'), 'hand', 'p1')).toBe(0);
  });

  it('CR 614.17b: a discard cost can\'t be paid', () => {
    expect(legal(board([noDiscard, looter, BEARS], { battlefield: ['Test Keep', 'Test Looter'], hand: ['Test Bears'] }), 'p1', 'activate').filter((a) => a.label.includes('Test Looter'))).toEqual([]);
    expect(legal(board([looter, BEARS], { battlefield: ['Test Looter'], hand: ['Test Bears'] }), 'p1', 'activate').filter((a) => a.label.includes('Test Looter'))).toHaveLength(1);
  });

  it('CR 514.1: the cleanup step discards nothing, so the hand stays above seven', () => {
    const nine = Array(9).fill('Test Bears') as string[];
    const t = advanceTo(board([noDiscard, BEARS], { battlefield: ['Test Keep'], hand: nine }), 2, 'upkeep');
    expect(count(t, 'hand', 'p1')).toBe(9);
    expect(logHas(t, /can't discard cards/, 'CR 514.1')).toBe(true);
  });
});

describe('CR 701.21a: "can\'t be sacrificed" and "can\'t sacrifice" (rule:beSacrificed, rule:sacrifice)', () => {
  const suit = ENCHANTMENT('Test Suit', [staticOf("Creatures you control can't be sacrificed.", [cant(each({ types: ['Creature'], controller: 'you' }), 'beSacrificed')])]);
  const noSac = ENCHANTMENT('Test No Sac', [staticOf("You can't sacrifice permanents.", [cant(YOU, 'sacrifice')])]);
  const edict = spellCard('Test Edict', 'Each player sacrifices a creature.', [{ op: 'sacrificeChoice', who: { ref: 'each', who: 'player' }, filter: { types: ['Creature'] }, count: 1 }]);
  const petal = withAbilities('Test Petal', [{ kind: 'activated', text: 'Sacrifice this artifact: Add {G}.', cost: { other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: YOU, units: [['G']] }] } } as AbilityDef]);

  it('"each player sacrifices a creature": p1\'s creatures can\'t be sacrificed, p2 sacrifices one', () => {
    const s = board([suit, edict, BEARS], { battlefield: ['Test Suit', 'Test Bears'], hand: ['Test Edict'] }, { battlefield: ['Test Bears'] });
    const t = castAndResolve(s, 'Test Edict');
    expect(here(t, find(s, 'Test Bears', 'battlefield', 'p1'))).toBe(true);
    expect(here(t, find(s, 'Test Bears', 'battlefield', 'p2'))).toBe(false);
  });

  it('a player who can\'t sacrifice: the mana ability that sacrifices its source can\'t be activated', () => {
    const s = board([noSac, petal], { battlefield: ['Test No Sac', 'Test Petal'] });
    expect(legal(s, 'p1').filter((a) => a.label.includes('Test Petal'))).toEqual([]);
    expect(legal(board([petal], { battlefield: ['Test Petal'] }), 'p1').filter((a) => a.label.includes('Test Petal')).length).toBeGreaterThan(0);
  });
});

describe('CR 303.4i: an Aura spell resolving onto what it can\'t enchant goes to the graveyard (rule:beEnchanted, rule:beAttached)', () => {
  const warded = VANILLA('Test Unenchantable', ['2', '2'], [staticOf("This creature can't be enchanted.", [cant(SELF, 'beEnchanted')])]);
  const unattachable = VANILLA('Test Bare', ['2', '2'], [staticOf("This creature can't have permanents attached to it.", [cant(SELF, 'beAttached')])]);

  it.each([['beEnchanted', warded], ['beAttached', unattachable]] as const)('%s: Pacifism resolves into its owner\'s graveyard; it enchants another creature', (_a, def) => {
    const s = board([def, PACIFISM, BEARS], { hand: ['Pacifism', 'Pacifism'] }, { battlefield: [def.name, 'Test Bears'] });
    const id = find(s, def.name, 'battlefield', 'p2');
    const t = castAndResolve(s, 'Pacifism', [id]);
    expect(t.zones.battlefield.some((x) => t.objects[x]!.defId === 'Pacifism')).toBe(false);
    expect(t.zones.graveyard.p1!.some((x) => t.objects[x]!.defId === 'Pacifism')).toBe(true);
    expect(logHas(t, /can't be attached/, 'CR 303.4i')).toBe(true);
    const bears = find(s, 'Test Bears', 'battlefield', 'p2');
    const ok = castAndResolve(s, 'Pacifism', [bears]);
    expect(ok.zones.battlefield.some((x) => ok.objects[x]!.defId === 'Pacifism' && ok.objects[x]!.attachedTo === bears)).toBe(true);
  });
});
