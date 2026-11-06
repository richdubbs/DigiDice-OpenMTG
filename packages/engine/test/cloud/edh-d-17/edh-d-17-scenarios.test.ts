/**
 * Commander coordinator D, round edh-d-17 (EDHREC ranks 13,751-15,000, fifth pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites from memory of the Comprehensive Rules
 * (cloud session): listed as unverified in the record.
 *
 *   CR 701.21a, 208.1, 608.2c   "Each player sacrifices a creature of their choice. Create an X/X ... token, where X is the total power of the creatures sacrificed this way." (Reign of the Pit)
 *   CR 608.2c, 404.1            "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can't, draw a card." (Roots of Wisdom)
 *   CR 607.2d, 701.20a, 401.4   "Reveal the top four cards ... Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom ..." (Brass Herald)
 *   CR 615.1, 615.6, 105.1      "Prevent all damage that would be dealt to another target creature this turn by sources of the color of your choice." (Avacyn, Guardian Angel)
 *   CR 406.1, 108.3, 604.3      "... power and toughness are each equal to the number of instant and sorcery cards in your graveyard plus the number of cards with flashback you own in exile." (Seize the Storm)
 *   CR 707.2, 707.4, 109.2      "Each other creature becomes a copy of target nonlegendary creature until end of turn." (Mirrorweave)
 *   CR 601.2f, 715.1, 205.2a    "~ costs {1} less to cast for each card you own in exile and in your graveyard that's an instant card, a sorcery card, or a card that has an Adventure." (Sailors' Bane)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, findAll, scenario, answer as answerDecision } from '../../m3/scenario';
import { applyAction } from '../../../src/index';
import { card, full, named, tokens, resolveAll, settle } from '../cmd3/helpers';

const sz = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId);
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

describe('CR 701.21a, 208.1, 608.2c: "Each player sacrifices a creature of their choice. Create an X/X black Demon creature token with flying, where X is the total power of the creatures sacrificed this way." (Reign of the Pit)', () => {
  const REIGN = card('Test Pit Rite', 'Sorcery', 'Each player sacrifices a creature of their choice. Create an X/X black Demon creature token with flying, where X is the total power of the creatures sacrificed this way.');
  const MINE = card('Test Mine Bear', 'Creature — Bear', '', ['3', '3']);
  const THEIRS = card('Test Their Ogre', 'Creature — Ogre', '', ['5', '5']);
  const game = (theirs: string[]): GameState => scenario([], { p1: { hand: ['Test Pit Rite'], battlefield: ['Test Mine Bear'] }, p2: { battlefield: theirs }, defs: [REIGN, MINE, THEIRS] });
  it('is full', () => expect(full(REIGN)).toBe(true));
  it('the token has the total power of every creature sacrificed (3 + 5 = 8), each player sacrificing one', () => {
    const s = resolveAll(act(game(['Test Their Ogre']), { type: 'cast', player: 'p1', card: find(game(['Test Their Ogre']), 'Test Pit Rite', 'hand', 'p1') }));
    const demon = tokens(s, 'p1');
    expect(demon).toHaveLength(1);
    expect(stat(s, demon[0]!)).toBe('8/8');
    expect(named(s, 'Test Mine Bear')).toHaveLength(0);
    expect(named(s, 'Test Their Ogre')).toHaveLength(0);
  });
  it('negative: a player with no creature sacrifices none, and only the power of what was sacrificed counts (3/3)', () => {
    const g = game([]);
    const s = resolveAll(act(g, { type: 'cast', player: 'p1', card: find(g, 'Test Pit Rite', 'hand', 'p1') }));
    const demon = tokens(s, 'p1');
    expect(demon).toHaveLength(1);
    expect(stat(s, demon[0]!)).toBe('3/3');
  });
});

describe('CR 608.2c, 404.1: "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can\'t, draw a card." (Roots of Wisdom)', () => {
  const ROOTS = card('Test Root Study', 'Sorcery', "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can't, draw a card.");
  const ELF = card('Test Quiet Elf', 'Creature — Elf Druid', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(ROOTS)).toBe(true));
  it('an Elf card in the graveyard comes back (a land card would too); the card is not drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Root Study'], graveyard: ['Test Quiet Elf', 'Test Plain Bear'], library: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, p2: {}, defs: [ROOTS, ELF, BEAR] });
    const handBefore = s0.zones.hand['p1']!.length;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Root Study', 'hand', 'p1') }), { objects: [find(s0, 'Test Quiet Elf', 'graveyard', 'p1')] });
    expect(sz(s, 'hand')).toContain('Test Quiet Elf');
    expect(sz(s, 'hand')).not.toContain('Test Plain Bear');
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1 + 1); // the spell left the hand, the Elf came in; nothing drawn
  });
  it('negative: with no land card and no Elf card in the graveyard (the milled cards included) the card is drawn instead', () => {
    const s0 = scenario([], { p1: { hand: ['Test Root Study'], graveyard: ['Test Plain Bear'], library: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, p2: {}, defs: [ROOTS, BEAR] });
    const handBefore = s0.zones.hand['p1']!.length;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Root Study', 'hand', 'p1') }));
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1 + 1); // the drawn card replaces the spell
    expect(sz(s, 'hand')).not.toContain('Test Plain Bear');
  });
});

describe('CR 607.2d, 701.20a, 401.4: "Reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order." (Brass Herald)', () => {
  const HERALD = card('Test Type Herald', 'Artifact Creature — Golem', 'As this creature enters, choose a creature type.\nWhen this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.\nCreatures of the chosen type get +1/+1.', ['4', '4']);
  const ELF = card('Test Quiet Elf', 'Creature — Elf Druid', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const ELFSPELL = card('Test Elf Charm', 'Instant — Elf', '', undefined);
  it('is full', () => expect(full(HERALD)).toBe(true));
  it('only the revealed creature cards of the chosen type go to the hand; the other revealed cards go to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Type Herald'], library: ['Test Quiet Elf', 'Test Plain Bear', 'Test Quiet Elf', 'Test Elf Charm', 'Test Quiet Elf'] }, p2: {}, defs: [HERALD, ELF, BEAR, ELFSPELL] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Type Herald', 'hand', 'p1') });
    for (let i = 0; i < 30 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'chooseName') s = answerDecision(s, { kind: 'chooseName', name: 'Elf' });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else s = settle(s);
    }
    const hand = sz(s, 'hand');
    expect(hand.filter((n) => n === 'Test Quiet Elf')).toHaveLength(2); // the 1st and 3rd of the top four; the 5th was not revealed
    expect(hand).not.toContain('Test Plain Bear');
    expect(hand).not.toContain('Test Elf Charm'); // an Elf card that is not a creature card
    const lib = sz(s, 'library');
    expect(lib.slice(-2).sort()).toEqual(['Test Elf Charm', 'Test Plain Bear']);
  });
});

describe('CR 615.1, 615.6, 105.1: "Prevent all damage that would be dealt to another target creature this turn by sources of the color of your choice." (Avacyn, Guardian Angel)', () => {
  const ANGEL = card('Test Guard Angel', 'Legendary Creature — Angel', '{0}: Prevent all damage that would be dealt to another target creature this turn by sources of the color of your choice.\n{0}: Prevent all damage that would be dealt to target player or planeswalker this turn by sources of the color of your choice.', ['4', '4']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['5', '5']);
  const RED = card('Test Red Bolt', 'Instant', 'Test Red Bolt deals 2 damage to target creature.', undefined);
  const GREEN = card('Test Green Bite', 'Instant', 'Test Green Bite deals 2 damage to target creature.', undefined);
  const RED_P = card('Test Red Burn', 'Instant', 'Test Red Burn deals 2 damage to target player.', undefined);
  const withColor = (c: typeof RED, color: string) => ({ ...c, faces: c.faces.map((f) => ({ ...f, colors: [color] })) });
  it('is full', () => expect(full(ANGEL)).toBe(true));
  it('the chosen color is fixed as the ability resolves: damage from a source of that color is prevented, from another color it is not', () => {
    const redBolt = withColor(RED, 'R') as typeof RED;
    const greenBite = withColor(GREEN, 'G') as typeof GREEN;
    const g = scenario([], { p1: { hand: ['Test Red Bolt', 'Test Green Bite'], battlefield: ['Test Guard Angel', 'Test Plain Bear'] }, p2: {}, defs: [ANGEL, BEAR, redBolt, greenBite] });
    const bear = find(g, 'Test Plain Bear', 'battlefield');
    const angel = find(g, 'Test Guard Angel', 'battlefield');
    // activate the first ability on the bear, choosing red
    let s = act(g, { type: 'activate', player: 'p1', source: angel, ability: 'p:0:0' });
    if (s.pending?.kind === 'chooseTargets') s = answerDecision(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
    for (let i = 0; i < 12 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'chooseColor') s = answerDecision(s, { kind: 'chooseColor', color: 'R' });
      else if (s.pending?.kind === 'payCost') s = answerDecision(s, { kind: 'payCost', auto: true });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    const hit = (s1: GameState, name: string): number => {
      const s2 = resolveAll(act(s1, { type: 'cast', player: 'p1', card: find(s1, name, 'hand', 'p1') }), { targets: [{ kind: 'object', id: bear }] });
      return s2.objects[bear]!.damage;
    };
    expect(hit(s, 'Test Red Bolt')).toBe(0);
    expect(hit(s, 'Test Green Bite')).toBe(2);
  });
  it('is the target\'s damage only: "another target creature" cannot be the angel itself (the ability is not offered with the angel as the only creature)', () => {
    const g = scenario([], { p1: { battlefield: ['Test Guard Angel'] }, p2: {}, defs: [ANGEL] });
    const angel = find(g, 'Test Guard Angel', 'battlefield');
    const r = applyAction(g, { type: 'activate', player: 'p1', source: angel, ability: 'p:0:0' });
    expect(r.error).toBeDefined();
  });
});

describe('CR 406.1, 108.3, 604.3: "power and toughness are each equal to the number of instant and sorcery cards in your graveyard plus the number of cards with flashback you own in exile." (Seize the Storm)', () => {
  const STORM = card('Test Storm Rite', 'Sorcery', 'Create a red Elemental creature token with trample and "This token\'s power and toughness are each equal to the number of instant and sorcery cards in your graveyard plus the number of cards with flashback you own in exile."');
  const SPELL_I = card('Test Quick Charm', 'Instant', '', undefined);
  const SPELL_S = card('Test Slow Charm', 'Sorcery', '', undefined);
  const FB = card('Test Echo Charm', 'Sorcery', 'Flashback {3}', undefined);
  it('is full', () => expect(full(STORM)).toBe(true));
  it('counts instants and sorceries in your graveyard plus your cards with flashback in exile, not an opponent\'s card with flashback nor a card in the graveyard twice-over', () => {
    const g = scenario([], { p1: { hand: ['Test Storm Rite'], graveyard: ['Test Quick Charm', 'Test Slow Charm'], exile: ['Test Echo Charm'] }, p2: { exile: ['Test Echo Charm'] }, defs: [STORM, SPELL_I, SPELL_S, FB] });
    const s = resolveAll(act(g, { type: 'cast', player: 'p1', card: find(g, 'Test Storm Rite', 'hand', 'p1') }));
    const [t] = tokens(s, 'p1');
    expect(stat(s, t!)).toBe('4/4'); // 2 in the graveyard + the resolved Test Storm Rite itself (a sorcery in the graveyard) + 1 of mine in exile (the opponent's is not counted)
  });
});

describe('CR 707.2, 707.4, 109.2: "Each other creature becomes a copy of target nonlegendary creature until end of turn." (Mirrorweave)', () => {
  const WEAVE = card('Test Mirror Spell', 'Instant', 'Each other creature becomes a copy of target nonlegendary creature until end of turn.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const DRAKE = card('Test Plain Drake', 'Creature — Drake', 'Flying', ['3', '3']);
  const KING = card('Test Great King', 'Legendary Creature — Human', '', ['6', '6']);
  it('is full', () => expect(full(WEAVE)).toBe(true));
  it('every creature but the target (including the opponent\'s) becomes a copy of the target; the target itself is unchanged', () => {
    const g = scenario([], { p1: { hand: ['Test Mirror Spell'], battlefield: ['Test Plain Bear', 'Test Plain Drake'] }, p2: { battlefield: ['Test Great King'] }, defs: [WEAVE, BEAR, DRAKE, KING] });
    const drake = find(g, 'Test Plain Drake', 'battlefield');
    const bear = find(g, 'Test Plain Bear', 'battlefield');
    const king = find(g, 'Test Great King', 'battlefield');
    const s = resolveAll(act(g, { type: 'cast', player: 'p1', card: find(g, 'Test Mirror Spell', 'hand', 'p1') }), { targets: [{ kind: 'object', id: drake }] });
    expect(stat(s, bear)).toBe('3/3');
    expect(stat(s, king)).toBe('3/3');
    expect(getChars(s, bear)!.name).toBe('Test Plain Drake');
    expect(stat(s, drake)).toBe('3/3');
  });
  it('negative: a legendary creature is not a legal target', () => {
    const g = scenario([], { p1: { hand: ['Test Mirror Spell'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Great King'] }, defs: [WEAVE, BEAR, KING] });
    const king = find(g, 'Test Great King', 'battlefield');
    const r = applyAction(act(g, { type: 'cast', player: 'p1', card: find(g, 'Test Mirror Spell', 'hand', 'p1') }), { type: 'pass', player: 'p1' });
    void r;
    const s = act(g, { type: 'cast', player: 'p1', card: find(g, 'Test Mirror Spell', 'hand', 'p1') });
    expect(JSON.stringify(s.pending)).not.toContain(king);
  });
});

describe('CR 601.2f, 715.1, 205.2a: "~ costs {1} less to cast for each card you own in exile and in your graveyard that\'s an instant card, a sorcery card, or a card that has an Adventure." (Sailors\' Bane)', () => {
  const BANE = card('Test Sea Beast', 'Creature — Dragon Turtle', 'This spell costs {1} less to cast for each card you own in exile and in your graveyard that\'s an instant card, a sorcery card, or a card that has an Adventure.', ['9', '9'], '{3}');
  const INSTANT = card('Test Quick Charm', 'Instant', '', undefined);
  const SORCERY = card('Test Slow Charm', 'Sorcery', '', undefined);
  const ADV = card('Test Tale Knight', 'Creature — Knight // Test Tale Spell', '', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(BANE)).toBe(true));
  it('three qualifying cards (an instant in the graveyard, a sorcery in exile, another instant) make a {3} spell free; two do not', () => {
    const three = scenario([], { p1: { hand: ['Test Sea Beast'], graveyard: ['Test Quick Charm', 'Test Slow Charm'], exile: ['Test Quick Charm'] }, p2: {}, defs: [BANE, INSTANT, SORCERY] });
    expect(applyAction(three, { type: 'cast', player: 'p1', card: find(three, 'Test Sea Beast', 'hand', 'p1') }).error).toBeUndefined();
    const two = scenario([], { p1: { hand: ['Test Sea Beast'], graveyard: ['Test Quick Charm', 'Test Plain Bear'], exile: ['Test Slow Charm'] }, p2: {}, defs: [BANE, INSTANT, SORCERY, BEAR] });
    expect(applyAction(two, { type: 'cast', player: 'p1', card: find(two, 'Test Sea Beast', 'hand', 'p1') }).error).toBeDefined(); // {1} left to pay and no mana
  });
  it('negative: cards an opponent owns do not count', () => {
    const g = scenario([], { p1: { hand: ['Test Sea Beast'], graveyard: ['Test Quick Charm'] }, p2: { graveyard: ['Test Slow Charm', 'Test Slow Charm'], exile: ['Test Quick Charm'] }, defs: [BANE, INSTANT, SORCERY] });
    void ADV;
    expect(applyAction(g, { type: 'cast', player: 'p1', card: find(g, 'Test Sea Beast', 'hand', 'p1') }).error).toBeDefined();
  });
});
void findAll;
