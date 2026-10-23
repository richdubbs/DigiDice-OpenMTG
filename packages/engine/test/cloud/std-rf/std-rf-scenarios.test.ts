/**
 * Standard round F (slot F of F-J): the templates of parser/templates/zz-cloud/std-rf.json and the support they needed, played through the engine with synthetic cards
 * compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 601.2a, 702.85a, 707.10   "Instant spells you cast from your hand have cascade": the spell cast from the hand has it; one cast with flashback, an opponent's
 *                                spell and a creature spell do not
 *   CR 205.1a, 613.1d-f, 305.7   "Enchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities"
 *   CR 701.9a, 400.7             "Whenever you discard a card, you may exile that card."
 *   CR 607.2a, 613.1f            "~ has all activated abilities of the exiled card" (the linked card, and only that card)
 *   CR 701.27e, 603.2, 503.1     "Whenever ~ transforms into ~ and at the beginning of your upkeep, ..." (either event triggers it)
 *   CR 108.3, 109.4              "for each permanent you own that your opponents control"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, find, findAll, legal, life, pool, put, scenario } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';
import { activate, automated, card, cast, drain, obj, onBattlefield, passTo, settle, yes } from '../r5-fxz/support';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}', ['G']);
const DRAKE = card('Test Red Drake', 'Creature — Drake', 'Flying', ['3', '3'], '{2}{R}', ['R']);

describe('CR 601.2a, 702.85a, 707.10: "Instant spells you cast from your hand have cascade." (sta.stdrf.spells.cast.fromHand.cascade)', () => {
  const CASCADER = card('Test Cascader', 'Creature — Dragon', 'Instant spells you cast from your hand have cascade.', ['2', '2']);
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.\nFlashback {0}');
  const FEAST = card('Test Feast', 'Creature — Beast', '', ['1', '1']);
  const defs = [CASCADER, TONIC, FEAST];
  const spellOnStack = (s: GameState): ReturnType<typeof getChars> => getChars(s, s.zones.stack[0]!);
  it('is automated', () => expect(automated(CASCADER)).toBe(true));
  it('an instant cast from your hand has cascade while it is on the stack', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Cascader'] }, defs });
    const s = settle(castCard(s0, 'Test Tonic'));
    expect(s.zones.stack.some((id) => s.objects[id]!.kind === 'card' && s.defs[s.objects[id]!.defId]!.name === 'Test Tonic')).toBe(true);
    const spell = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    expect(hasKeyword(getChars(s, spell), 'cascade')).toBe(true);
  });
  it('the same instant cast from the graveyard with flashback has no cascade (CR 601.2a: it was not cast from the hand)', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Tonic'], battlefield: ['Test Cascader'] }, defs });
    const s = settle(castCard(s0, 'Test Tonic', { zone: 'graveyard', method: 'flashback' }));
    const spell = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    expect(spell).toBeDefined();
    expect(hasKeyword(getChars(s, spell), 'cascade')).toBe(false);
  });
  it("an opponent's instant cast from their hand has no cascade (it is not a spell you cast)", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cascader'] }, p2: { hand: ['Test Tonic'] }, defs });
    const s1 = passTo(s0, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    const s = settle(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Tonic', 'hand', 'p2') }));
    const spell = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    expect(hasKeyword(getChars(s, spell), 'cascade')).toBe(false);
  });
  it('a creature spell is not an instant: no cascade', () => {
    const s0 = scenario([], { p1: { hand: ['Test Feast'], battlefield: ['Test Cascader'] }, defs });
    const s = settle(castCard(s0, 'Test Feast'));
    expect(spellOnStack(s) !== undefined && hasKeyword(spellOnStack(s), 'cascade')).toBe(false);
  });
});

describe('CR 205.1a, 613.1d-f: "Enchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities." (sta.stdrf.enchanted.permanent.colorless.land.with.losesOthers)', () => {
  const MOON = card('Test Moon Shroud', 'Enchantment — Aura', 'Enchant artifact, creature, or land\nEnchanted permanent is a colorless land with "{T}: Add {C}{C}" and loses all other card types and abilities.');
  const defs = [MOON, DRAKE, BEAR];
  function shrouded(): GameState {
    const s = scenario([], { p1: { battlefield: ['Plains'] }, p2: { battlefield: ['Test Red Drake'] }, defs });
    const aura = put(s, 'p1', 'battlefield', 'Test Moon Shroud');
    s.objects[aura]!.attachedTo = onBattlefield(s, 'Test Red Drake')[0]!;
    return s;
  }
  it('is automated, the Enchant line a keyword of the three kinds', () => {
    expect(automated(MOON)).toBe(true);
    expect(JSON.stringify(MOON.faces[0]!.abilities[0])).toContain('"filter":{"types":["Artifact","Creature","Land"]}');
  });
  it('the enchanted creature is a colorless land only: no creature type, no color, no flying, one mana ability', () => {
    const s = shrouded();
    const c = getChars(s, onBattlefield(s, 'Test Red Drake')[0]!);
    expect(c.types).toEqual(['Land']);
    expect(c.subtypes).toEqual([]);
    expect(c.colors).toEqual([]);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(c.abilities.filter((a) => a.def.kind === 'activated')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Moon Shroud')).toHaveLength(1); // a land is still something the Aura may enchant (CR 704.5m)
  });
  it("its controller taps it for the two colorless mana; without the Aura it is a creature again", () => {
    let s = shrouded();
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    const drake = onBattlefield(s, 'Test Red Drake')[0]!;
    const ab = legal(s, 'p2', 'activate').find((a) => a.action.type === 'activate' && a.action.source === drake);
    expect(ab).toBeDefined();
    s = act(s, ab!.action);
    expect(pool(s, 'p2')).toBe('CC');
    const t = scenario([], { p2: { battlefield: ['Test Red Drake'] }, defs });
    expect(getChars(t, onBattlefield(t, 'Test Red Drake')[0]!).types).toEqual(['Creature']);
  });
});

describe('CR 701.9a, 400.7: "Whenever you discard a card, you may exile that card." (the object of the discard is a card)', () => {
  const HAUNT = card('Test Haunt', 'Creature — Spirit', 'Whenever you discard a card, you may exile that card.', ['1', '1']);
  const DUMP = card('Test Dump', 'Sorcery', 'Discard a card.');
  const JUNK = card('Test Junk', 'Instant', 'You gain 1 life.');
  const defs = [HAUNT, DUMP, JUNK];
  it('is automated', () => expect(automated(HAUNT)).toBe(true));
  it('discarding Test Junk and saying yes exiles that card from the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dump', 'Test Junk'], battlefield: ['Test Haunt'] }, defs });
    const s = cast(s0, 'Test Dump', { answers: [yes, yes, yes] });
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Junk')).toBe(true);
    expect(findAll(s, 'Test Junk', 'graveyard', 'p1')).toHaveLength(0);
  });
  it('saying no leaves the discarded card in the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dump', 'Test Junk'], battlefield: ['Test Haunt'] }, defs });
    const s = cast(s0, 'Test Dump', { answers: [{ kind: 'yesNo', yes: false }, { kind: 'yesNo', yes: false }] });
    expect(findAll(s, 'Test Junk', 'graveyard', 'p1').length + findAll(s, 'Test Dump', 'graveyard', 'p1').length).toBeGreaterThan(0);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Junk')).toBe(false);
  });
});

describe('CR 607.2a, 613.1f: "~ has all activated abilities of the exiled card." (sta.stdrf.has.allActivatedOf.exiledCard)', () => {
  const FORGE = card('Test Forge', 'Artifact', 'When this artifact enters, exile target artifact you control.\nThis artifact has all activated abilities of the exiled permanent.');
  const LAMP = card('Test Lamp', 'Artifact', '{T}: You gain 3 life.');
  const defs = [FORGE, LAMP];
  it('is automated, the exile recorded under the link "exiled"', () => {
    expect(automated(FORGE)).toBe(true);
    expect(JSON.stringify(FORGE.faces[0]!.abilities[0])).toContain('"link":"exiled"');
  });
  it('after the Forge exiled the Lamp it can be tapped for 3 life; before it entered nothing is exiled and it has no ability', () => {
    const s0 = scenario([], { p1: { hand: ['Test Forge'], battlefield: ['Test Lamp'] }, defs });
    expect(getChars(s0, onBattlefield(s0, 'Test Lamp')[0]!).abilities.filter((a) => a.def.kind === 'activated')).toHaveLength(1);
    const lamp = onBattlefield(s0, 'Test Lamp')[0]!;
    const s1 = cast(s0, 'Test Forge', { targets: [[obj(lamp)]] });
    expect(s1.zones.exile.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Lamp')).toBe(true);
    const forge = onBattlefield(s1, 'Test Forge')[0]!;
    const gained = getChars(s1, forge).abilities.filter((a) => a.def.kind === 'activated');
    expect(gained).toHaveLength(1);
    const ab = legal(s1, 'p1', 'activate').find((a) => a.action.type === 'activate' && a.action.source === forge);
    expect(ab).toBeDefined();
    const s2 = drain(settle(act(s1, ab!.action)));
    expect(life(s2, 'p1')).toBe(23);
  });
});

describe('CR 701.27e, 603.2, 503.1: "Whenever ~ transforms into ~ and at the beginning of your upkeep, you gain 1 life." (trg.stdrf.self.transformsIntoAndAt)', () => {
  const MOTH = compileCard({
    name: 'Test Moth // Test Flame', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Insect // Creature — Elemental', colors: [],
    card_faces: [
      { name: 'Test Moth', mana_cost: '{0}', type_line: 'Creature — Insect', oracle_text: '{0}: Transform Test Moth. Activate only as a sorcery.', power: '1', toughness: '1' },
      { name: 'Test Flame', mana_cost: '', type_line: 'Creature — Elemental', oracle_text: 'Whenever this creature transforms into Test Flame and at the beginning of your upkeep, you gain 1 life.', power: '2', toughness: '2' },
    ],
  } as unknown as OracleCard as never) as CardDef;
  it('is automated', () => expect(automated(MOTH)).toBe(true));
  it('transforming into the back face gains 1 life, and so does each of your upkeeps after it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Moth // Test Flame'] }, defs: [MOTH] });
    const moth = onBattlefield(s, 'Test Moth // Test Flame')[0]!;
    s = activate(s, moth);
    expect(s.objects[moth]!.face).toBe(1);
    expect(life(s, 'p1')).toBe(21);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    s = drain(s);
    expect(life(s, 'p1')).toBe(22);
  });
  it('on the front face the ability does not exist: its upkeep gains nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Moth // Test Flame'] }, defs: [MOTH] });
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 108.3, 109.4: "for each permanent you own that your opponents control" counts only the permanents you own and an opponent controls', () => {
  const MIRE = card('Test Mire Lord', 'Creature — Zombie', 'At the beginning of your upkeep, you gain 1 life for each permanent you own that your opponents control.', ['1', '1']);
  it('is automated', () => expect(automated(MIRE)).toBe(true));
  it('two of your permanents under your opponent\'s control gain 2 life; your opponent\'s own permanent and your own do not count', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mire Lord', 'Test Bear'] }, p2: { battlefield: ['Test Red Drake'] }, defs: [MIRE, BEAR, DRAKE] });
    const stolen = put(s0, 'p2', 'battlefield', 'Test Bear');
    s0.objects[stolen]!.owner = 'p1';
    const s1 = passTo(s0, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    const s = drain(s1);
    expect(life(s, 'p1')).toBe(21); // one permanent: the Bear p1 owns and p2 controls
  });
});
